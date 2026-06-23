-- Tahap 2: integritas booking, lifecycle appointment, idempotency, dan timeout.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS barber_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid NOT NULL REFERENCES barbers(id),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  reason text,
  status varchar(20) NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT barber_time_off_valid_range_check CHECK (end_at > start_at),
  CONSTRAINT barber_time_off_status_check
    CHECK (status IN ('pending', 'approved', 'active', 'rejected', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS barber_time_off_barber_range_idx
  ON barber_time_off (barber_id, start_at, end_at);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS scheduled_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(128),
  ADD COLUMN IF NOT EXISTS travel_buffer_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_block_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_block_end_at timestamptz;

UPDATE appointments appointment
SET scheduled_end_at =
  appointment.scheduled_at
  + make_interval(
      mins => greatest(
        coalesce((
          SELECT sum(snapshot.duration_min)::integer
          FROM appointment_services snapshot
          WHERE snapshot.appointment_id = appointment.id
        ), 30),
        1
      )
    )
WHERE appointment.scheduled_at IS NOT NULL
  AND appointment.scheduled_end_at IS NULL;

CREATE OR REPLACE FUNCTION ensure_appointment_schedule_end()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scheduled_at IS NULL THEN
    NEW.scheduled_end_at := NULL;
  ELSIF NEW.scheduled_end_at IS NULL THEN
    -- Fallback untuk jalur legacy/direct insert. RPC booking selalu mengirim
    -- durasi snapshot yang tepat.
    NEW.scheduled_end_at := NEW.scheduled_at + interval '30 minutes';
  END IF;

  IF NEW.scheduled_at IS NULL OR NEW.scheduled_end_at IS NULL THEN
    NEW.schedule_block_start_at := NULL;
    NEW.schedule_block_end_at := NULL;
  ELSE
    NEW.schedule_block_start_at :=
      NEW.scheduled_at - NEW.travel_buffer_min * interval '1 minute';
    NEW.schedule_block_end_at :=
      NEW.scheduled_end_at + NEW.travel_buffer_min * interval '1 minute';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_ensure_schedule_end ON appointments;
CREATE TRIGGER appointments_ensure_schedule_end
BEFORE INSERT OR UPDATE OF scheduled_at, scheduled_end_at, travel_buffer_min ON appointments
FOR EACH ROW EXECUTE FUNCTION ensure_appointment_schedule_end();

UPDATE appointments
SET scheduled_at = scheduled_at
WHERE scheduled_at IS NOT NULL;

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_schedule_range_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_schedule_range_check
  CHECK (
    scheduled_at IS NULL
    OR (
      scheduled_end_at IS NOT NULL
      AND scheduled_end_at > scheduled_at
    )
  );

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_travel_buffer_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_travel_buffer_check
  CHECK (travel_buffer_min BETWEEN 0 AND 120);

CREATE UNIQUE INDEX IF NOT EXISTS appointments_idempotency_key_unique
  ON appointments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM appointments first_appointment
    JOIN appointments second_appointment
      ON first_appointment.id < second_appointment.id
      AND first_appointment.barber_id = second_appointment.barber_id
      AND tstzrange(
        first_appointment.schedule_block_start_at,
        first_appointment.schedule_block_end_at,
        '[)'
      ) && tstzrange(
        second_appointment.schedule_block_start_at,
        second_appointment.schedule_block_end_at,
        '[)'
      )
    WHERE first_appointment.barber_id IS NOT NULL
      AND first_appointment.scheduled_at IS NOT NULL
      AND first_appointment.scheduled_end_at IS NOT NULL
      AND second_appointment.scheduled_at IS NOT NULL
      AND second_appointment.scheduled_end_at IS NOT NULL
      AND first_appointment.status IN ('pending', 'confirmed', 'in_queue', 'in_service')
      AND second_appointment.status IN ('pending', 'confirmed', 'in_queue', 'in_service')
  ) THEN
    RAISE EXCEPTION
      'Tidak dapat memasang constraint jadwal: terdapat appointment aktif yang overlap. Audit dan arsipkan konflik sebelum migration diulang.'
      USING ERRCODE = '23P01';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointments_barber_schedule_excl'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_barber_schedule_excl
      EXCLUDE USING gist (
        barber_id WITH =,
        tstzrange(
          schedule_block_start_at,
          schedule_block_end_at,
          '[)'
        ) WITH &&
      )
      WHERE (
        barber_id IS NOT NULL
        AND scheduled_at IS NOT NULL
        AND scheduled_end_at IS NOT NULL
        AND schedule_block_start_at IS NOT NULL
        AND schedule_block_end_at IS NOT NULL
        AND status IN ('pending', 'confirmed', 'in_queue', 'in_service')
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS appointment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  event_type varchar(50) NOT NULL,
  from_status appointment_status,
  to_status appointment_status NOT NULL,
  actor_type varchar(20) NOT NULL,
  actor_id uuid,
  actor_role varchar(30),
  reason text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_events_actor_type_check
    CHECK (actor_type IN ('customer', 'staff', 'system'))
);

CREATE INDEX IF NOT EXISTS appointment_events_appointment_created_idx
  ON appointment_events (appointment_id, created_at DESC);

ALTER TABLE appointment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_time_off ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION create_appointment_atomic(
  p_branch_id uuid,
  p_barber_id uuid,
  p_customer_id uuid,
  p_service_ids uuid[],
  p_scheduled_at timestamptz,
  p_source text,
  p_idempotency_key varchar,
  p_actor_type varchar,
  p_actor_id uuid,
  p_customer_media_urls jsonb DEFAULT '[]'::jsonb,
  p_fulfillment_type varchar DEFAULT 'in_store',
  p_service_address text DEFAULT NULL,
  p_destination_latitude numeric DEFAULT NULL,
  p_destination_longitude numeric DEFAULT NULL,
  p_location_notes text DEFAULT NULL,
  p_travel_buffer_min integer DEFAULT 15
)
RETURNS appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_existing appointments%ROWTYPE;
  v_appointment appointments%ROWTYPE;
  v_branch branches%ROWTYPE;
  v_barber barbers%ROWTYPE;
  v_service services%ROWTYPE;
  v_service_id uuid;
  v_price_amount bigint;
  v_total_duration_min integer := 0;
  v_scheduled_at timestamptz := coalesce(p_scheduled_at, now());
  v_scheduled_end_at timestamptz;
  v_queue_position integer;
  v_status appointment_status;
  v_open_time time;
  v_close_time time;
  v_local_start timestamp;
  v_local_end timestamp;
  v_buffer_min integer;
BEGIN
  IF p_idempotency_key IS NULL
    OR length(trim(p_idempotency_key)) < 8
    OR length(trim(p_idempotency_key)) > 128
  THEN
    RAISE EXCEPTION 'Idempotency-Key wajib berisi 8 sampai 128 karakter'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('appointment-idempotency:' || trim(p_idempotency_key), 0)
  );

  SELECT *
  INTO v_existing
  FROM appointments
  WHERE idempotency_key = trim(p_idempotency_key);

  IF FOUND THEN
    IF v_existing.branch_id IS DISTINCT FROM p_branch_id
      OR v_existing.barber_id IS DISTINCT FROM p_barber_id
      OR v_existing.customer_id IS DISTINCT FROM p_customer_id
      OR v_existing.source::text IS DISTINCT FROM p_source
    THEN
      RAISE EXCEPTION 'Idempotency-Key sudah digunakan untuk request berbeda'
        USING ERRCODE = '23505';
    END IF;

    RETURN v_existing;
  END IF;

  IF p_source NOT IN ('online_booking', 'walk_in') THEN
    RAISE EXCEPTION 'source appointment tidak valid' USING ERRCODE = '22023';
  END IF;

  IF p_actor_type NOT IN ('customer', 'staff') OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Actor pembuat appointment tidak valid' USING ERRCODE = '22023';
  END IF;

  IF p_source = 'online_booking'
    AND (p_customer_id IS NULL OR p_actor_type <> 'customer' OR p_actor_id <> p_customer_id)
  THEN
    RAISE EXCEPTION 'Booking online wajib dibuat oleh customer pemilik appointment'
      USING ERRCODE = '42501';
  END IF;

  IF p_service_ids IS NULL
    OR cardinality(p_service_ids) = 0
    OR cardinality(p_service_ids) <> (
      SELECT count(DISTINCT service_id)
      FROM unnest(p_service_ids) service_id
    )
  THEN
    RAISE EXCEPTION 'Minimal satu service unik wajib dipilih'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(coalesce(p_customer_media_urls, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'customer_media_urls wajib berupa array JSON'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_branch
  FROM branches
  WHERE id = p_branch_id
    AND deleted_at IS NULL
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan atau tidak aktif'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_source = 'online_booking' AND v_scheduled_at <= now() THEN
    RAISE EXCEPTION 'Booking online tidak boleh dibuat untuk waktu yang sudah lewat'
      USING ERRCODE = '22023';
  END IF;

  IF p_fulfillment_type NOT IN ('in_store', 'home_service') THEN
    RAISE EXCEPTION 'fulfillment_type harus in_store atau home_service'
      USING ERRCODE = '22023';
  END IF;

  IF p_barber_id IS NOT NULL THEN
    SELECT barber.*
    INTO v_barber
    FROM barbers barber
    JOIN staff_users staff ON staff.id = barber.staff_user_id
    WHERE barber.id = p_barber_id
      AND barber.branch_id = p_branch_id
      AND barber.deleted_at IS NULL
      AND staff.deleted_at IS NULL
      AND staff.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Barber tidak aktif atau tidak berasal dari cabang yang dipilih'
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF p_fulfillment_type = 'home_service' THEN
    RAISE EXCEPTION 'barber_id wajib dipilih untuk home_service'
      USING ERRCODE = '22023';
  END IF;

  IF p_fulfillment_type = 'home_service' THEN
    IF nullif(trim(p_service_address), '') IS NULL
      OR p_destination_latitude IS NULL
      OR p_destination_longitude IS NULL
      OR p_destination_latitude NOT BETWEEN -90 AND 90
      OR p_destination_longitude NOT BETWEEN -180 AND 180
    THEN
      RAISE EXCEPTION 'Alamat dan koordinat tujuan yang valid wajib untuk home_service'
        USING ERRCODE = '22023';
    END IF;

    IF v_branch.latitude IS NULL OR v_branch.longitude IS NULL THEN
      RAISE EXCEPTION 'Koordinat cabang belum dikonfigurasi'
        USING ERRCODE = '22023';
    END IF;

    IF (
      6371 * 2 * asin(
        sqrt(
          power(
            sin(
              radians(
                (p_destination_latitude - v_branch.latitude)::double precision
              ) / 2
            ),
            2
          )
          + cos(radians(v_branch.latitude::double precision))
          * cos(radians(p_destination_latitude::double precision))
          * power(
              sin(
                radians(
                  (p_destination_longitude - v_branch.longitude)::double precision
                ) / 2
              ),
              2
            )
        )
      )
    ) > coalesce(v_barber.service_radius_km, 5) THEN
      RAISE EXCEPTION 'Lokasi customer berada di luar radius layanan barber'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  FOREACH v_service_id IN ARRAY p_service_ids
  LOOP
    SELECT *
    INTO v_service
    FROM services
    WHERE id = v_service_id
      AND is_active = true
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Layanan % tidak ditemukan atau tidak aktif', v_service_id
        USING ERRCODE = 'P0002';
    END IF;

    SELECT price.price_amount
    INTO v_price_amount
    FROM service_prices price
    WHERE price.service_id = v_service_id
      AND price.effective_from <= v_scheduled_at
      AND (price.effective_to IS NULL OR price.effective_to >= v_scheduled_at)
      AND (
        price.branch_id = p_branch_id
        OR price.region_id = v_branch.region_id
        OR (price.branch_id IS NULL AND price.region_id IS NULL)
      )
    ORDER BY
      CASE
        WHEN price.branch_id = p_branch_id THEN 1
        WHEN price.region_id = v_branch.region_id THEN 2
        ELSE 3
      END,
      price.effective_from DESC
    LIMIT 1;

    IF v_price_amount IS NULL THEN
      RAISE EXCEPTION 'Harga layanan % tidak tersedia pada jadwal tersebut', v_service_id
        USING ERRCODE = 'P0002';
    END IF;

    v_total_duration_min :=
      v_total_duration_min + greatest(v_service.default_duration_min, 1);
  END LOOP;

  v_scheduled_end_at :=
    v_scheduled_at + make_interval(mins => v_total_duration_min);
  v_buffer_min := CASE
    WHEN p_fulfillment_type = 'home_service'
      THEN greatest(0, least(coalesce(p_travel_buffer_min, 15), 120))
    ELSE 0
  END;

  v_local_start := v_scheduled_at AT TIME ZONE 'Asia/Jakarta';
  v_local_end := v_scheduled_end_at AT TIME ZONE 'Asia/Jakarta';

  SELECT open_time, close_time
  INTO v_open_time, v_close_time
  FROM branch_operating_hours
  WHERE branch_id = p_branch_id
    AND day_of_week = extract(dow FROM v_local_start)::integer
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND
    OR v_local_start::date <> v_local_end::date
    OR v_local_start::time < v_open_time
    OR v_local_end::time > v_close_time
  THEN
    RAISE EXCEPTION 'Jadwal berada di luar jam operasional cabang'
      USING ERRCODE = '22023';
  END IF;

  IF p_barber_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM barber_time_off time_off
    WHERE time_off.barber_id = p_barber_id
      AND time_off.status IN ('approved', 'active')
      AND tstzrange(time_off.start_at, time_off.end_at, '[)')
        && tstzrange(
          v_scheduled_at - v_buffer_min * interval '1 minute',
          v_scheduled_end_at + v_buffer_min * interval '1 minute',
          '[)'
        )
  ) THEN
    RAISE EXCEPTION 'Barber sedang tidak tersedia pada jadwal tersebut'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'appointment-queue:' || p_branch_id::text || ':' || coalesce(p_barber_id::text, 'unassigned'),
      0
    )
  );

  SELECT coalesce(max(queue_position), 0) + 1
  INTO v_queue_position
  FROM appointments
  WHERE branch_id = p_branch_id
    AND barber_id IS NOT DISTINCT FROM p_barber_id
    AND status IN ('pending', 'confirmed', 'in_queue', 'in_service');

  v_status := CASE
    WHEN p_source = 'walk_in' THEN 'in_queue'::appointment_status
    ELSE 'pending'::appointment_status
  END;

  INSERT INTO appointments (
    branch_id,
    barber_id,
    customer_id,
    source,
    status,
    scheduled_at,
    scheduled_end_at,
    queue_position,
    customer_media_urls,
    fulfillment_type,
    service_address,
    destination_latitude,
    destination_longitude,
    location_notes,
    travel_buffer_min,
    idempotency_key
  )
  VALUES (
    p_branch_id,
    p_barber_id,
    p_customer_id,
    p_source::appointment_source,
    v_status,
    v_scheduled_at,
    v_scheduled_end_at,
    v_queue_position,
    coalesce(p_customer_media_urls, '[]'::jsonb),
    p_fulfillment_type,
    CASE WHEN p_fulfillment_type = 'home_service' THEN trim(p_service_address) ELSE NULL END,
    CASE WHEN p_fulfillment_type = 'home_service' THEN p_destination_latitude ELSE NULL END,
    CASE WHEN p_fulfillment_type = 'home_service' THEN p_destination_longitude ELSE NULL END,
    nullif(trim(p_location_notes), ''),
    v_buffer_min,
    trim(p_idempotency_key)
  )
  RETURNING * INTO v_appointment;

  FOREACH v_service_id IN ARRAY p_service_ids
  LOOP
    SELECT *
    INTO v_service
    FROM services
    WHERE id = v_service_id;

    SELECT candidate.price_amount
    INTO v_price_amount
    FROM service_prices candidate
    WHERE candidate.service_id = v_service_id
      AND candidate.effective_from <= v_scheduled_at
      AND (candidate.effective_to IS NULL OR candidate.effective_to >= v_scheduled_at)
      AND (
        candidate.branch_id = p_branch_id
        OR candidate.region_id = v_branch.region_id
        OR (candidate.branch_id IS NULL AND candidate.region_id IS NULL)
      )
    ORDER BY
      CASE
        WHEN candidate.branch_id = p_branch_id THEN 1
        WHEN candidate.region_id = v_branch.region_id THEN 2
        ELSE 3
      END,
      candidate.effective_from DESC
    LIMIT 1;

    INSERT INTO appointment_services (
      appointment_id,
      service_id,
      price_amount,
      duration_min
    )
    VALUES (
      v_appointment.id,
      v_service_id,
      v_price_amount,
      greatest(v_service.default_duration_min, 1)
    );
  END LOOP;

  INSERT INTO appointment_events (
    appointment_id,
    event_type,
    from_status,
    to_status,
    actor_type,
    actor_id,
    actor_role,
    reason,
    metadata
  )
  VALUES (
    v_appointment.id,
    'APPOINTMENT_CREATED',
    NULL,
    v_status,
    p_actor_type,
    p_actor_id,
    CASE WHEN p_actor_type = 'customer' THEN 'customer' ELSE 'admin' END,
    CASE
      WHEN p_source = 'walk_in' THEN 'Appointment walk-in dibuat'
      ELSE 'Booking online dibuat'
    END,
    jsonb_build_object(
      'source', p_source,
      'idempotency_key', trim(p_idempotency_key),
      'scheduled_end_at', v_scheduled_end_at,
      'travel_buffer_min', v_buffer_min
    )
  );

  RETURN v_appointment;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Barber sudah memiliki appointment yang overlap pada jadwal tersebut'
      USING ERRCODE = '23P01';
END;
$$;

CREATE OR REPLACE FUNCTION transition_appointment_status_atomic(
  p_appointment_id uuid,
  p_target_status text,
  p_expected_version integer,
  p_actor_type varchar,
  p_actor_id uuid,
  p_actor_role varchar,
  p_reason text,
  p_event_type varchar DEFAULT 'STATUS_TRANSITION',
  p_customer_media_urls jsonb DEFAULT NULL
)
RETURNS appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_current appointments%ROWTYPE;
  v_updated appointments%ROWTYPE;
  v_target appointment_status;
  v_allowed boolean := false;
  v_now timestamptz := now();
BEGIN
  IF nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Reason wajib disertakan pada setiap transisi status'
      USING ERRCODE = '22023';
  END IF;

  IF p_actor_type NOT IN ('customer', 'staff', 'system') THEN
    RAISE EXCEPTION 'actor_type tidak valid' USING ERRCODE = '22023';
  END IF;

  IF p_actor_type <> 'system' AND p_actor_id IS NULL THEN
    RAISE EXCEPTION 'actor_id wajib untuk actor non-system'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_target := p_target_status::appointment_status;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Status tujuan tidak valid' USING ERRCODE = '22023';
  END;

  SELECT *
  INTO v_current
  FROM appointments
  WHERE id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF v_current.version <> p_expected_version THEN
    RAISE EXCEPTION 'Status appointment berubah oleh proses lain, muat ulang data terbaru'
      USING ERRCODE = '40001';
  END IF;

  IF v_current.status = v_target THEN
    RETURN v_current;
  END IF;

  v_allowed := CASE v_current.status
    WHEN 'pending' THEN v_target IN ('confirmed', 'cancelled', 'no_show')
    WHEN 'confirmed' THEN v_target IN ('in_queue', 'in_service', 'cancelled', 'no_show')
    WHEN 'in_queue' THEN v_target IN ('in_service', 'cancelled', 'no_show')
    WHEN 'in_service' THEN v_target = 'completed'
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transisi status % ke % tidak diizinkan', v_current.status, v_target
      USING ERRCODE = '22023';
  END IF;

  IF p_actor_type = 'customer' THEN
    IF v_current.customer_id IS DISTINCT FROM p_actor_id OR v_target <> 'cancelled' THEN
      RAISE EXCEPTION 'Customer hanya dapat membatalkan appointment miliknya'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_target = 'confirmed'
    AND (p_actor_type <> 'staff' OR p_actor_role NOT IN ('barber', 'admin'))
  THEN
    RAISE EXCEPTION 'Status confirmed hanya dapat diberikan barber atau admin'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_type = 'system' THEN
    IF p_event_type = 'ORDER_ACCEPTANCE_TIMEOUT'
      AND NOT (v_current.status = 'pending' AND v_target = 'cancelled')
    THEN
      RAISE EXCEPTION 'ORDER_ACCEPTANCE_TIMEOUT hanya berlaku untuk appointment pending'
        USING ERRCODE = '22023';
    END IF;

    IF p_event_type = 'APPOINTMENT_NO_SHOW_TIMEOUT'
      AND NOT (v_current.status IN ('confirmed', 'in_queue') AND v_target = 'no_show')
    THEN
      RAISE EXCEPTION 'APPOINTMENT_NO_SHOW_TIMEOUT hanya berlaku untuk appointment confirmed/in_queue'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE appointments
  SET
    status = v_target,
    version = version + 1,
    updated_at = v_now,
    started_at = CASE
      WHEN v_target = 'in_service' THEN coalesce(started_at, v_now)
      ELSE started_at
    END,
    completed_at = CASE
      WHEN v_target = 'completed' THEN coalesce(completed_at, v_now)
      ELSE completed_at
    END,
    cancellation_reason = CASE
      WHEN v_target IN ('cancelled', 'no_show') THEN trim(p_reason)
      ELSE cancellation_reason
    END,
    queue_position = CASE
      WHEN v_target IN ('cancelled', 'no_show') THEN NULL
      ELSE queue_position
    END,
    journey_status = CASE
      WHEN v_target = 'completed' THEN 'completed'
      WHEN v_target IN ('cancelled', 'no_show') THEN 'cancelled'
      ELSE journey_status
    END,
    customer_media_urls = CASE
      WHEN p_customer_media_urls IS NOT NULL THEN p_customer_media_urls
      ELSE customer_media_urls
    END
  WHERE id = p_appointment_id
    AND version = p_expected_version
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Status appointment berubah oleh proses lain, muat ulang data terbaru'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO appointment_events (
    appointment_id,
    event_type,
    from_status,
    to_status,
    actor_type,
    actor_id,
    actor_role,
    reason,
    metadata
  )
  VALUES (
    p_appointment_id,
    coalesce(nullif(trim(p_event_type), ''), 'STATUS_TRANSITION'),
    v_current.status,
    v_target,
    p_actor_type,
    p_actor_id,
    p_actor_role,
    trim(p_reason),
    jsonb_build_object(
      'previous_version', v_current.version,
      'new_version', v_updated.version
    )
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION create_appointment_atomic(
  uuid, uuid, uuid, uuid[], timestamptz, text, varchar, varchar, uuid,
  jsonb, varchar, text, numeric, numeric, text, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION create_appointment_atomic(
  uuid, uuid, uuid, uuid[], timestamptz, text, varchar, varchar, uuid,
  jsonb, varchar, text, numeric, numeric, text, integer
) TO service_role;

REVOKE ALL ON FUNCTION transition_appointment_status_atomic(
  uuid, text, integer, varchar, uuid, varchar, text, varchar, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION transition_appointment_status_atomic(
  uuid, text, integer, varchar, uuid, varchar, text, varchar, jsonb
) TO service_role;
