-- Stage 3: Live pickup tracking hardening — geofence distance recording.

ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS distance_m numeric(10, 2);
