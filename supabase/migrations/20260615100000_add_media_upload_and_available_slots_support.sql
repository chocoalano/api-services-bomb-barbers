-- Dukungan upload media pemesanan dan penyimpanan URL foto referensi pelanggan.

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "customer_media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_appointments_customer_media_urls"
  ON "appointments" USING gin ("customer_media_urls");

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) VALUES (
  'appointment-media',
  'appointment-media',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
