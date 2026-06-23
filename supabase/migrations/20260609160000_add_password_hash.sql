ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "password_hash" VARCHAR(255);
ALTER TABLE "staff_users" ADD COLUMN IF NOT EXISTS "password_hash" VARCHAR(255);
