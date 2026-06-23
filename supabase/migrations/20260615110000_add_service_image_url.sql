-- Dukungan gambar layanan untuk kartu service di aplikasi pelanggan.

ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "image_url" text;

UPDATE "services"
SET "image_url" = 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a'
WHERE "name" = 'Premium Haircut'
  AND ("image_url" IS NULL OR "image_url" = '');

UPDATE "services"
SET "image_url" = 'https://images.unsplash.com/photo-1621605815971-fbc98d665033'
WHERE "name" = 'Beard Trim'
  AND ("image_url" IS NULL OR "image_url" = '');
