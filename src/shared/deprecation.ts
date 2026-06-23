/** Sunset date for all deprecated aliases — 2028-01-01 UTC */
export const SUNSET_DATE = 'Sat, 01 Jan 2028 00:00:00 GMT';

/**
 * Wraps a route handler to add RFC-8594 deprecation headers to every response.
 * Use for old route aliases whose canonical URL has moved.
 *
 * Sets:
 *   Deprecation: true
 *   Sunset: <SUNSET_DATE>
 *   Link: <canonical>; rel="canonical"
 */
export function deprecated(canonical: string, handler: (ctx: any) => any) {
  return async (ctx: any) => {
    ctx.set.headers['Deprecation'] = 'true';
    ctx.set.headers['Sunset'] = SUNSET_DATE;
    ctx.set.headers['Link'] = `<${canonical}>; rel="canonical"`;
    const method = ctx.request?.method ?? '';
    const path = ctx.request ? new URL(ctx.request.url).pathname : '';
    console.warn(`[DEPRECATED] ${method} ${path} → ${canonical}`);
    return handler(ctx);
  };
}

/** OpenAPI/Swagger metadata to mark a route as deprecated. */
export const deprecatedDetail = { detail: { deprecated: true } };
