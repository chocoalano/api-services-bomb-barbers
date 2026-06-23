CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "public"."customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

ALTER TABLE "public"."customers"
  ADD COLUMN IF NOT EXISTS "id" uuid;

UPDATE "public"."customers"
SET "id" = gen_random_uuid()
WHERE "id" IS NULL;

ALTER TABLE "public"."customers"
  ADD COLUMN IF NOT EXISTS "full_name" varchar(255),
  ADD COLUMN IF NOT EXISTS "phone" varchar(50),
  ADD COLUMN IF NOT EXISTS "email" varchar(255),
  ADD COLUMN IF NOT EXISTS "password_hash" varchar(255),
  ADD COLUMN IF NOT EXISTS "points_balance" bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

ALTER TABLE "public"."customers"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "points_balance" SET DEFAULT 0,
  ALTER COLUMN "is_active" SET DEFAULT true,
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "updated_at" SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "public"."customers" WHERE "id" IS NULL
  ) THEN
    ALTER TABLE "public"."customers" ALTER COLUMN "id" SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "pg_constraint"
    WHERE "conrelid" = to_regclass('public.customers')
      AND "contype" = 'p'
  ) AND NOT EXISTS (
    SELECT 1
    FROM "public"."customers"
    GROUP BY "id"
    HAVING count(*) > 1
  ) THEN
    ALTER TABLE "public"."customers" ADD PRIMARY KEY ("id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "public"."customers" WHERE "full_name" IS NULL
  ) THEN
    ALTER TABLE "public"."customers" ALTER COLUMN "full_name" SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "public"."customers" WHERE "phone" IS NULL
  ) THEN
    ALTER TABLE "public"."customers" ALTER COLUMN "phone" SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "public"."customers" WHERE "created_at" IS NULL
  ) THEN
    ALTER TABLE "public"."customers" ALTER COLUMN "created_at" SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "public"."customers" WHERE "updated_at" IS NULL
  ) THEN
    ALTER TABLE "public"."customers" ALTER COLUMN "updated_at" SET NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "customers_phone_unique"
  ON "public"."customers" ("phone")
  WHERE "phone" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "customers_email_unique"
  ON "public"."customers" ("email")
  WHERE "email" IS NOT NULL;
