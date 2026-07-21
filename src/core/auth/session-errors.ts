/**
 * Kosakata bersama backend ⇄ aplikasi tentang "kenapa sesi ini tidak dipakai lagi".
 *
 * ATURAN YANG MENGIKAT (persyaratan klien):
 * pengguna hanya boleh dipulangkan ke layar login bila ia menekan Logout, atau
 * bila server mengirim salah satu kode di {@link TERMINAL_SESSION_ERROR_CODES}.
 * Segala hal lain — 500, 502, 429, timeout, jaringan mati, bahkan 401 tanpa kode —
 * WAJIB diperlakukan aplikasi sebagai gangguan sementara: token disimpan apa
 * adanya dan dicoba lagi nanti.
 *
 * Karena itu kode di bawah harus dikirim dengan hemat dan tepat: setiap satu
 * kode terminal yang salah kirim = satu pengguna terlempar ke login tanpa sebab.
 */

export const SessionErrorCode = {
  /** Sesi dicabut: logout dari perangkat lain, ganti password, atau dicabut admin. */
  SESSION_REVOKED: 'SESSION_REVOKED',
  /** Akun dinonaktifkan (`is_active=false`) atau dihapus. */
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  /** Kepster ditolak/dihapus (`approval_status != 'approved'`). */
  ACCOUNT_REJECTED: 'ACCOUNT_REJECTED',
  /** Refresh token tidak dikenal / bukan milik sesi mana pun. */
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  /**
   * Access token kedaluwarsa. **BUKAN kode terminal** — aplikasi wajib
   * menyegarkan token diam-diam, bukan melogout pengguna.
   */
  TOKEN_EXPIRED: 'TOKEN_EXPIRED'
} as const;

export type SessionErrorCodeValue =
  (typeof SessionErrorCode)[keyof typeof SessionErrorCode];

/** Hanya kode-kode ini yang boleh memulangkan pengguna ke layar login. */
export const TERMINAL_SESSION_ERROR_CODES: SessionErrorCodeValue[] = [
  SessionErrorCode.SESSION_REVOKED,
  SessionErrorCode.ACCOUNT_SUSPENDED,
  SessionErrorCode.ACCOUNT_REJECTED,
  SessionErrorCode.REFRESH_TOKEN_INVALID
];

export const isTerminalSessionErrorCode = (code?: string | null) =>
  !!code && TERMINAL_SESSION_ERROR_CODES.includes(code as SessionErrorCodeValue);

/**
 * Error auth yang membawa kode & status HTTP-nya sendiri, sehingga controller
 * tidak perlu menebak-nebak dari isi pesan.
 */
export class SessionError extends Error {
  readonly code: SessionErrorCodeValue;
  readonly status: number;

  constructor(code: SessionErrorCodeValue, message: string, status = 401) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
    this.status = status;
  }

  static revoked(message = 'Sesi Anda sudah tidak berlaku. Silakan masuk kembali.') {
    return new SessionError(SessionErrorCode.SESSION_REVOKED, message, 401);
  }

  static suspended(message = 'Akun Anda dinonaktifkan. Hubungi admin.') {
    return new SessionError(SessionErrorCode.ACCOUNT_SUSPENDED, message, 403);
  }

  static rejected(message = 'Akun Anda tidak lagi disetujui admin.') {
    return new SessionError(SessionErrorCode.ACCOUNT_REJECTED, message, 403);
  }

  static refreshInvalid(message = 'Refresh token tidak valid') {
    return new SessionError(SessionErrorCode.REFRESH_TOKEN_INVALID, message, 401);
  }

  static tokenExpired(message = 'Token akses kedaluwarsa') {
    return new SessionError(SessionErrorCode.TOKEN_EXPIRED, message, 401);
  }
}

/** Kode terminal yang pantas untuk error apa pun; `null` = jangan logout. */
export const sessionErrorCodeOf = (error: unknown): SessionErrorCodeValue | null =>
  error instanceof SessionError ? error.code : null;
