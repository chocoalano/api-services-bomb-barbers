/**
 * Storage lokal berbasis filesystem (object storage).
 *
 * - File publik ditulis ke `public/media/<objectPath>` sehingga otomatis disajikan
 *   oleh @elysiajs/static (prefix `/public`) di `${MEDIA_BASE_URL}/public/media/...`.
 * - File privat ditulis ke `storage/private/<objectPath>` (TIDAK disajikan statis)
 *   dan hanya bisa diakses via URL bertanda-tangan HMAC berbatas waktu, divalidasi
 *   route `/media/private/*` (lihat src/lib/media-routes.ts).
 */
import { createHmac } from 'node:crypto';
import { mkdir, writeFile, unlink, readFile, stat } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';

const CWD = process.cwd();
const PUBLIC_ROOT = join(CWD, 'public', 'media');
const PRIVATE_ROOT = join(CWD, process.env.MEDIA_PRIVATE_DIR || 'storage/private');

const MEDIA_BASE_URL = (
  process.env.MEDIA_BASE_URL ||
  process.env.VITE_API_BASE_URL ||
  `http://localhost:${process.env.APP_PORT || 3000}`
).replace(/\/+$/, '');

const SIGN_SECRET =
  process.env.MEDIA_SIGN_SECRET || process.env.JWT_ACCESS_SECRET || 'dev-media-secret';

// Cegah path traversal: objectPath tidak boleh keluar dari root.
function safeJoin(root: string, objectPath: string): string {
  const cleaned = normalize(objectPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = join(root, cleaned);
  if (!full.startsWith(root + sep) && full !== root) {
    throw new Error('Path media tidak valid');
  }
  return full;
}

export const LocalStorage = {
  /** Simpan file publik → dapat diakses lewat public URL statis. */
  async savePublic(objectPath: string, data: Buffer): Promise<void> {
    const full = safeJoin(PUBLIC_ROOT, objectPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  },

  /** Simpan file privat → hanya diakses lewat signed URL. */
  async savePrivate(objectPath: string, data: Buffer): Promise<void> {
    const full = safeJoin(PRIVATE_ROOT, objectPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  },

  publicUrl(objectPath: string): string {
    const clean = objectPath.split('/').map(encodeURIComponent).join('/');
    return `${MEDIA_BASE_URL}/public/media/${clean}`;
  },

  /** URL bertanda-tangan untuk file privat, berlaku `ttlSeconds` detik. */
  signedUrl(objectPath: string, ttlSeconds: number): string {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(objectPath, expires);
    const clean = objectPath.split('/').map(encodeURIComponent).join('/');
    return `${MEDIA_BASE_URL}/media/private/${clean}?expires=${expires}&sig=${sig}`;
  },

  sign(objectPath: string, expires: number): string {
    return createHmac('sha256', SIGN_SECRET).update(`${objectPath}:${expires}`).digest('hex');
  },

  verifySignature(objectPath: string, expires: number, sig: string): boolean {
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
    const expected = this.sign(objectPath, expires);
    if (expected.length !== sig.length) return false;
    return timingSafeEq(expected, sig);
  },

  async readPrivate(objectPath: string): Promise<Buffer> {
    return readFile(safeJoin(PRIVATE_ROOT, objectPath));
  },

  async removePublic(objectPath: string): Promise<void> {
    try {
      await unlink(safeJoin(PUBLIC_ROOT, objectPath));
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
    }
  },

  async removePrivate(objectPath: string): Promise<void> {
    try {
      await unlink(safeJoin(PRIVATE_ROOT, objectPath));
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
    }
  },

  async privateExists(objectPath: string): Promise<boolean> {
    try {
      await stat(safeJoin(PRIVATE_ROOT, objectPath));
      return true;
    } catch {
      return false;
    }
  }
};

function timingSafeEq(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
