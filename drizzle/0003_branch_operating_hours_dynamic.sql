-- Jam buka/tutup layanan dinamis per-branch: hari libur (is_closed) + integritas
-- satu baris jam per cabang per hari.
--
-- 1) Dedup baris ganda yang mungkin sudah ada sebelum UNIQUE dipasang. Pertahankan
--    baris dengan created_at terbaru (ties dipecah oleh id) — konsisten dengan
--    pengaman lama `ORDER BY created_at DESC LIMIT 1`.
DELETE t1 FROM branch_operating_hours t1
JOIN branch_operating_hours t2
  ON t1.branch_id = t2.branch_id
 AND t1.day_of_week = t2.day_of_week
 AND (t1.created_at < t2.created_at
      OR (t1.created_at = t2.created_at AND t1.id < t2.id));
--> statement-breakpoint
-- 2) Kolom hari libur eksplisit.
ALTER TABLE branch_operating_hours
  ADD COLUMN is_closed BOOLEAN NOT NULL DEFAULT FALSE;
--> statement-breakpoint
-- 3) Keunikan (branch_id, day_of_week).
ALTER TABLE branch_operating_hours
  ADD CONSTRAINT branch_operating_hours_branch_day_unique UNIQUE (branch_id, day_of_week);
