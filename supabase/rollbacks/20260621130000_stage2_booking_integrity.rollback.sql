-- Rollback Tahap 2.
-- Jalankan hanya setelah worker/API versi Tahap 2 dihentikan.
-- Backup appointment_events terlebih dahulu jika histori transisi perlu dipertahankan.

DROP FUNCTION IF EXISTS transition_appointment_status_atomic(
  uuid, text, integer, varchar, uuid, varchar, text, varchar, jsonb
);

DROP FUNCTION IF EXISTS create_appointment_atomic(
  uuid, uuid, uuid, uuid[], timestamptz, text, varchar, varchar, uuid,
  jsonb, varchar, text, numeric, numeric, text, integer
);

DROP TRIGGER IF EXISTS appointments_ensure_schedule_end ON appointments;
DROP FUNCTION IF EXISTS ensure_appointment_schedule_end();

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_barber_schedule_excl,
  DROP CONSTRAINT IF EXISTS appointments_schedule_range_check,
  DROP CONSTRAINT IF EXISTS appointments_travel_buffer_check;

DROP INDEX IF EXISTS appointments_idempotency_key_unique;
DROP TABLE IF EXISTS appointment_events;

ALTER TABLE appointments
  DROP COLUMN IF EXISTS scheduled_end_at,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS travel_buffer_min,
  DROP COLUMN IF EXISTS schedule_block_start_at,
  DROP COLUMN IF EXISTS schedule_block_end_at;

-- barber_time_off tidak dihapus karena mungkin sudah digunakan sebelum Tahap 2.
-- Extension btree_gist juga dipertahankan agar tidak merusak objek lain.
