import { logger } from './logger';

/**
 * Validasi environment terpusat saat boot (B6, MB3).
 *
 * Di produksi: menolak boot bila env wajib tidak ada, secret lemah/default, atau
 * konfigurasi berbahaya. Di non-produksi: hanya memberi peringatan agar DX mulus.
 */

const WEAK_SECRET_PATTERN = /change[_-]?me|changeme|dev[_-]|example|password123|secret_key|test[_-]?secret/i;
const MIN_SECRET_LENGTH = 32;

type Problem = { level: 'error' | 'warn'; message: string };

const isProduction = () => process.env.NODE_ENV === 'production';

const checkRequired = (problems: Problem[], name: string) => {
  const value = process.env[name];
  if (!value || !value.trim()) {
    problems.push({ level: 'error', message: `Env wajib '${name}' belum di-set.` });
    return null;
  }
  return value;
};

const checkSecretStrength = (problems: Problem[], name: string) => {
  const value = process.env[name];
  if (!value) return; // ketiadaan sudah dicek terpisah
  if (value.length < MIN_SECRET_LENGTH) {
    problems.push({
      level: 'error',
      message: `Secret '${name}' terlalu pendek (<${MIN_SECRET_LENGTH} karakter). Generate dengan: openssl rand -hex 32`
    });
  }
  if (WEAK_SECRET_PATTERN.test(value)) {
    problems.push({
      level: 'error',
      message: `Secret '${name}' terlihat seperti nilai default/lemah. Ganti dengan secret acak yang kuat.`
    });
  }
};

export function validateEnv(): void {
  const problems: Problem[] = [];

  // Selalu wajib (dev & prod) — sudah divalidasi juga di modul masing-masing,
  // di sini dikumpulkan agar pesan boot jelas.
  // Database MySQL (Drizzle ORM).
  const hasDbUrl = !!(process.env.DATABASE_URL || process.env.MYSQL_URL);
  const hasDbParts = !!(process.env.DATABASE_SERVER && process.env.DATABASE_NAME);
  if (!hasDbUrl && !hasDbParts) {
    problems.push({
      level: 'error',
      message:
        "Env database belum di-set — pakai 'DATABASE_URL' (mysql://user:pass@host:port/db) " +
        'atau bagian terpisah DATABASE_SERVER + DATABASE_NAME (+ DATABASE_PORT/USER/PASSWORD).'
    });
  }
  checkRequired(problems, 'JWT_ACCESS_SECRET');
  checkRequired(problems, 'JWT_REFRESH_SECRET');
  checkSecretStrength(problems, 'JWT_ACCESS_SECRET');
  checkSecretStrength(problems, 'JWT_REFRESH_SECRET');

  // Wajib di produksi (di dev boleh default lokal).
  if (isProduction()) {
    checkRequired(problems, 'CORS_ORIGINS');
    checkRequired(problems, 'REDIS_URL');
    checkRequired(problems, 'MIDTRANS_SERVER_KEY');

    // Konsistensi environment Midtrans: prefix key harus cocok dengan mode.
    const midtransKey = process.env.MIDTRANS_SERVER_KEY || '';
    const midtransProd = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    if (midtransKey) {
      const isSandboxKey = midtransKey.startsWith('SB-Mid-server-');
      if (midtransProd && isSandboxKey) {
        problems.push({ level: 'error', message: 'MIDTRANS_IS_PRODUCTION=true tapi MIDTRANS_SERVER_KEY berformat sandbox (SB-Mid-server-).' });
      }
      if (!midtransProd && !isSandboxKey) {
        problems.push({ level: 'warn', message: 'MIDTRANS_IS_PRODUCTION=false tapi MIDTRANS_SERVER_KEY tampak berformat produksi (Mid-server-).' });
      }
    }
  }

  const errors = problems.filter((p) => p.level === 'error');
  const warnings = problems.filter((p) => p.level === 'warn');

  warnings.forEach((w) => logger.warn(w.message));

  if (errors.length > 0) {
    errors.forEach((e) => logger.error(e.message));
    if (isProduction()) {
      throw new Error(
        `Validasi environment gagal (${errors.length} masalah). Perbaiki sebelum menjalankan di produksi.`
      );
    } else {
      logger.warn('Validasi environment menemukan masalah di atas — dibiarkan karena NODE_ENV bukan production.');
    }
  } else {
    logger.info('Validasi environment lulus.');
  }
}
