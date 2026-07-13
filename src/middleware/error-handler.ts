import { Elysia } from "elysia";
import { createErrorResponse } from "../shared/response";
import { logger } from "../lib/logger";

const fieldLabels: Record<string, string> = {
  email: 'Email',
  full_name: 'Nama lengkap',
  password: 'Kata sandi',
  phone: 'Nomor telepon',
  refreshToken: 'Refresh token'
};

const normalizeValidationPath = (path?: string) =>
  (path || 'body').replace(/^\//, '').replace(/\//g, '.');

const getValidationMessage = (error: any) => {
  const field = normalizeValidationPath(error?.path);
  const label = fieldLabels[field] || field;

  if (field === 'password') {
    return 'Kata sandi wajib berupa teks dan minimal 8 karakter';
  }

  if (field === 'phone') {
    return 'Nomor telepon wajib berupa teks dan minimal 8 karakter';
  }

  if (field === 'email') {
    return 'Email harus menggunakan format alamat email yang valid';
  }

  return error?.message ? `${label}: ${error.message}` : `${label} tidak valid`;
};

const formatValidationErrors = (validationError: any) => {
  const errors = Array.isArray(validationError?.all) ? validationError.all : [];

  if (errors.length === 0 && validationError?.customError) {
    return [{ field: 'body', message: String(validationError.customError) }];
  }

  return errors.map((error: any) => ({
    field: normalizeValidationPath(error?.path),
    message: getValidationMessage(error)
  }));
};

export const errorHandler = new Elysia()
  .onError(({ code, error, set, request, path }) => {
    // Konteks request untuk mempermudah diagnosis error di log.
    const reqCtx = { method: request?.method, path: path ?? new URL(request?.url ?? 'http://x').pathname };

    switch (code) {
      case 'VALIDATION': {
        set.status = 400;
        const details = formatValidationErrors(error);
        // Log SEMUA error validasi (400) — sebelumnya lolos tanpa jejak sehingga
        // sulit mendiagnosis "400 Bad Request" pada payload yang tidak sesuai skema.
        logger.warn({ ...reqCtx, code, errors: details }, '[ErrorHandler] Validasi gagal');
        return createErrorResponse("Validasi gagal", details, null, null, { skipLog: true });
      }
      case 'NOT_FOUND':
        set.status = 404;
        logger.warn({ ...reqCtx, code }, '[ErrorHandler] Resource tidak ditemukan');
        return createErrorResponse("Resource Not Found", null, null, null, { skipLog: true });
      default:
        set.status = 500;
        // Jangan bocorkan detail error mentah ke klien di produksi (bisa mengungkap
        // struktur internal/SQL). Log lengkap di server, kirim pesan generik. (M10)
        logger.error({ ...reqCtx, err: error, code }, '[ErrorHandler] Unhandled error');
        const isProduction = process.env.NODE_ENV === 'production';
        const message = isProduction
          ? 'Terjadi kesalahan pada server. Silakan coba lagi nanti.'
          : (error instanceof Error ? error.message : 'Internal Server Error');
        return createErrorResponse(message, null, null, null, { skipLog: true });
    }
  })
  .as('global');
