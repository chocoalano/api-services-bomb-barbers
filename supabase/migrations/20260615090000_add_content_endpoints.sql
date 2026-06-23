-- Konten aplikasi pelanggan: banners, gallery hasil layanan, dan notifikasi.

CREATE TABLE IF NOT EXISTS "promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" varchar(255) NOT NULL,
  "subtitle" text,
  "image_url" text,
  "target_url" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "subtitle" text;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "image_url" text;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "target_url" text;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "starts_at" timestamp with time zone;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "idx_promotions_active_window"
  ON "promotions" ("is_active", "starts_at", "ends_at", "sort_order")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_barber_portfolios_barber_created_at"
  ON "barber_portfolios" ("barber_id", "created_at");

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_id" uuid NOT NULL,
  "recipient_type" varchar(50) DEFAULT 'customer' NOT NULL,
  "type" varchar(50) DEFAULT 'general' NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now(),
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipient_id" uuid;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipient_type" varchar(50) DEFAULT 'customer';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "type" varchar(50) DEFAULT 'general';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "title" varchar(255);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "body" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "sent_at" timestamp with time zone DEFAULT now();
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read_at" timestamp with time zone;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'user_id'
  ) THEN
    UPDATE "notifications"
    SET "recipient_id" = "user_id"
    WHERE "recipient_id" IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'message'
  ) THEN
    UPDATE "notifications"
    SET "body" = "message"
    WHERE "body" IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'is_read'
  ) THEN
    UPDATE "notifications"
    SET "read_at" = COALESCE("read_at", "created_at")
    WHERE "is_read" = true AND "read_at" IS NULL;
  END IF;
END $$;

UPDATE "notifications" SET "recipient_type" = 'customer' WHERE "recipient_type" IS NULL;
UPDATE "notifications" SET "type" = 'general' WHERE "type" IS NULL;
UPDATE "notifications" SET "title" = 'Notifikasi' WHERE "title" IS NULL;
UPDATE "notifications" SET "body" = '' WHERE "body" IS NULL;
UPDATE "notifications" SET "sent_at" = COALESCE("sent_at", "created_at") WHERE "sent_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_notifications_recipient_unread"
  ON "notifications" ("recipient_type", "recipient_id", "read_at", "created_at")
  WHERE "deleted_at" IS NULL;
