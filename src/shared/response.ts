import { logger } from '../lib/logger';

export const createSuccessResponse = <T>(message: string, data: T, meta?: any) => ({
  success: true,
  code: null,
  message,
  data,
  errors: null,
  meta
});

type ErrorResponseLogOptions = {
  skipLog?: boolean;
  context?: string;
  status?: number | string;
  err?: unknown;
  method?: string;
  path?: string;
};

export const createErrorResponse = (
  message: string,
  errors: any = null,
  code: string | null = null,
  data: any = null,
  logOptions: ErrorResponseLogOptions = {}
) => {
  if (!logOptions.skipLog) {
    const status = Number(logOptions.status ?? 400);
    const payload = {
      context: logOptions.context ?? 'createErrorResponse',
      status: Number.isFinite(status) ? status : 400,
      code,
      errors,
      err: logOptions.err,
      method: logOptions.method,
      path: logOptions.path
    };
    const level = payload.status >= 500 ? 'error' : 'warn';
    logger[level](payload, `[${payload.context}] ${message}`);
  }

  return {
    success: false,
    code,
    message,
    data,
    errors,
    meta: null
  };
};
