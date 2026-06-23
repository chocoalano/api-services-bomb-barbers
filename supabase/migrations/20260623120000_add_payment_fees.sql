ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "service_fee" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "delivery_fee" bigint DEFAULT 0 NOT NULL;
