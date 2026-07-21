-- G1/G2 — masa berlaku sesi + toleransi rotasi refresh token.
--
-- WAJIB dijalankan sebelum menyalakan AUTH_ACCESS_TTL_MINUTES.
--
-- Tidak ada backfill: baris lama tetap memakai `expires_at` sentinel tahun 9999
-- dan tetap sah selamanya. Itulah yang membuat pengaktifan masa berlaku TIDAK
-- melogout siapa pun saat rilis.

ALTER TABLE `auth_sessions`
  ADD COLUMN `prev_refresh_jti_hash` varchar(64) NULL AFTER `refresh_jti_hash`,
  ADD COLUMN `prev_jti_expires_at` datetime(6) NULL AFTER `prev_refresh_jti_hash`;
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_revoked_idx`
  ON `auth_sessions` (`user_type`, `user_id`, `revoked_at`);
