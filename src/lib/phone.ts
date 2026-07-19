/**
 * Normalisasi nomor telepon Indonesia ke bentuk kanonik E.164 (`+62...`).
 *
 * Tujuan: login/registrasi/pencarian pelanggan cocok apa pun format yang
 * diketik pengguna. Tanpa ini, `08123...`, `+62812...`, dan `62812...` dianggap
 * berbeda sehingga login via No HP sering gagal.
 *
 * Aturan:
 *  - Buang semua karakter selain digit dan tanda `+` di depan.
 *  - Prefiks `0`      → ganti dengan `+62` (mis. `0812...` → `+62812...`).
 *  - Prefiks `62`     → tambahkan `+`      (mis. `62812...` → `+62812...`).
 *  - Prefiks `+62`    → dipertahankan.
 *  - Selain itu (nomor non-ID / tak dikenali): dipertahankan apa adanya
 *    (dengan `+` bila sebelumnya ada) agar tidak merusak data tak terduga.
 *
 * Mengembalikan string kosong bila input kosong/null.
 */
export function normalizePhone(input: unknown): string {
  if (input == null) return '';
  const raw = String(input).trim();
  if (!raw) return '';

  const hadPlus = raw.startsWith('+');
  // Sisakan digit saja.
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('0')) {
    return `+62${digits.slice(1)}`;
  }
  if (digits.startsWith('62')) {
    return `+${digits}`;
  }
  // Nomor tak dikenali (mis. internasional lain) — pertahankan bentuk asalnya
  // sebisa mungkin: hormati `+` bila memang ada.
  return hadPlus ? `+${digits}` : digits;
}
