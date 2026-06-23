export const createSuccessResponse = <T>(message: string, data: T, meta?: any) => ({
  success: true,
  message,
  data,
  errors: null,
  meta
});

export const createErrorResponse = (message: string, errors: any = null) => ({
  success: false,
  message,
  data: null,
  errors,
  meta: null
});
