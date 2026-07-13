import { logger } from '../lib/logger';
import { createErrorResponse } from './response';

type ErrorLike = {
  message?: string;
  status?: number;
  code?: string | null;
  errors?: any;
  data?: any;
  stack?: string;
} & Record<string, any>;

/**
 * Penanganan error terpusat untuk controller: **mencatat error ke logger** lalu
 * membentuk envelope error standar. Dipakai agar tidak ada error yang tertelan
 * diam-diam di blok catch (mis. "400 Bad Request" tanpa jejak apa pun).
 *
 * @param err     Error yang tertangkap.
 * @param set     Objek `set` Elysia untuk menetapkan status HTTP.
 * @param context Label sumber error, mis. `customer.createOnlineBooking`.
 * @param opts.status  Paksa status HTTP tertentu (mis. 404). Default: `err.status || 400`.
 * @param opts.detail  Bila `false`, hanya kirim `message` (tanpa errors/code/data).
 */
export function handleControllerError(
  err: ErrorLike,
  set: { status?: number | string },
  context: string,
  opts: { status?: number; detail?: boolean } = {}
) {
  const status = opts.status ?? (typeof err?.status === 'number' ? err.status : 400);
  set.status = status;

  const meta = { err, context, status, code: err?.code ?? null };
  const message = err?.message ?? 'Terjadi kesalahan';
  // 5xx = kesalahan server (error), 4xx = kesalahan klien (warn) agar level log
  // proporsional dan tidak membanjiri log error dengan kesalahan input biasa.
  if (status >= 500) {
    logger.error(meta, `[${context}] ${message}`);
  } else {
    logger.warn(meta, `[${context}] ${message}`);
  }

  return opts.detail === false
    ? createErrorResponse(message, null, null, null, { skipLog: true })
    : createErrorResponse(message, err?.errors ?? null, err?.code ?? null, err?.data ?? null, { skipLog: true });
}
