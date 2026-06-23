-- Hardening sinkronisasi customer-barber dan dukungan home service.

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "fulfillment_type" varchar(20) DEFAULT 'in_store' NOT NULL,
  ADD COLUMN IF NOT EXISTS "service_address" text,
  ADD COLUMN IF NOT EXISTS "destination_latitude" numeric(10, 8),
  ADD COLUMN IF NOT EXISTS "destination_longitude" numeric(11, 8),
  ADD COLUMN IF NOT EXISTS "location_notes" text,
  ADD COLUMN IF NOT EXISTS "journey_status" varchar(30) DEFAULT 'not_started' NOT NULL,
  ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_fulfillment_type_check'
  ) THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_fulfillment_type_check"
      CHECK ("fulfillment_type" IN ('in_store', 'home_service'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_journey_status_check'
  ) THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_journey_status_check"
      CHECK ("journey_status" IN ('not_started', 'en_route', 'arrived', 'completed', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_destination_latitude_check'
  ) THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_destination_latitude_check"
      CHECK ("destination_latitude" IS NULL OR "destination_latitude" BETWEEN -90 AND 90);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_destination_longitude_check'
  ) THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_destination_longitude_check"
      CHECK ("destination_longitude" IS NULL OR "destination_longitude" BETWEEN -180 AND 180);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_home_service_destination_check'
  ) THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_home_service_destination_check"
      CHECK (
        "fulfillment_type" = 'in_store'
        OR (
          "barber_id" IS NOT NULL
          AND "service_address" IS NOT NULL
          AND length(trim("service_address")) > 0
          AND "destination_latitude" IS NOT NULL
          AND "destination_longitude" IS NOT NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_version_positive_check'
  ) THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_version_positive_check"
      CHECK ("version" > 0);
  END IF;
END $$;

ALTER TABLE "tracking_sessions"
  ADD COLUMN IF NOT EXISTS "ended_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "ended_reason" varchar(100),
  ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp with time zone DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tracking_sessions_status_check'
  ) THEN
    ALTER TABLE "tracking_sessions"
      ADD CONSTRAINT "tracking_sessions_status_check"
      CHECK ("status" IN ('active', 'completed', 'expired', 'revoked'));
  END IF;
END $$;

-- Sesi yang waktunya sudah habis tidak boleh tetap memblokir sesi baru.
UPDATE tracking_sessions
SET
  status = 'expired',
  ended_at = COALESCE(ended_at, now()),
  ended_reason = COALESCE(ended_reason, 'session_expired'),
  updated_at = now()
WHERE status = 'active'
  AND expires_at <= now();

-- Bersihkan sesi aktif ganda sebelum membuat unique partial index.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY appointment_id
      ORDER BY created_at DESC, id DESC
    ) AS position
  FROM tracking_sessions
  WHERE status = 'active'
)
UPDATE tracking_sessions
SET
  status = 'expired',
  ended_at = now(),
  ended_reason = 'duplicate_session_cleanup',
  updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "tracking_sessions_one_active_per_appointment"
  ON "tracking_sessions" ("appointment_id")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "tracking_sessions_appointment_status_expires"
  ON "tracking_sessions" ("appointment_id", "status", "expires_at");

-- Satu appointment hanya boleh memiliki satu check-in final.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY appointment_id
      ORDER BY checked_in_at DESC, id DESC
    ) AS position
  FROM check_ins
)
DELETE FROM check_ins
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "check_ins_appointment_unique"
  ON "check_ins" ("appointment_id");

CREATE INDEX IF NOT EXISTS "appointments_customer_status_schedule"
  ON "appointments" ("customer_id", "status", "scheduled_at");

CREATE INDEX IF NOT EXISTS "appointments_fulfillment_status"
  ON "appointments" ("fulfillment_type", "status", "scheduled_at");

CREATE OR REPLACE FUNCTION set_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_set_updated_at ON appointments;
CREATE TRIGGER appointments_set_updated_at
BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS tracking_sessions_set_updated_at ON tracking_sessions;
CREATE TRIGGER tracking_sessions_set_updated_at
BEFORE UPDATE ON tracking_sessions
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

-- Semua akses aplikasi melalui backend Service Role. RLS mencegah akses
-- langsung anon/authenticated ke data operasional dan lokasi sensitif.
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
