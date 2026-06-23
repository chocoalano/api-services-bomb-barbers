ALTER TABLE "barbers"
  ADD COLUMN IF NOT EXISTS "service_radius_km" integer DEFAULT 5 NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'barbers_service_radius_km_check'
  ) THEN
    ALTER TABLE "barbers"
      ADD CONSTRAINT "barbers_service_radius_km_check"
      CHECK ("service_radius_km" > 0);
  END IF;
END $$;
