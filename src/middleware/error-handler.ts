import { Elysia } from "elysia";
import { createErrorResponse } from "../shared/response";

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
  .onError(({ code, error, set }) => {
    switch (code) {
      case 'VALIDATION':
        set.status = 400;
        return createErrorResponse("Validasi gagal", formatValidationErrors(error));
      case 'NOT_FOUND':
        set.status = 404;
        return createErrorResponse("Resource Not Found");
      default:
        set.status = 500;
        const message = error instanceof Error ? error.message : "Internal Server Error";
        return createErrorResponse(message);
    }
  })
  .as('global');
