import { Elysia } from 'elysia';

/**
 * Security headers untuk semua response (HB2). HSTS hanya di produksi (di balik
 * TLS). CSP `frame-ancestors 'none'` + X-Frame-Options mencegah clickjacking
 * tanpa memblokir pemuatan sub-resource (aman untuk API JSON & aset statis).
 */
export const securityHeaders = new Elysia({ name: 'security-headers' })
  .onRequest(({ set }) => {
    set.headers['X-Content-Type-Options'] = 'nosniff';
    set.headers['X-Frame-Options'] = 'DENY';
    set.headers['Referrer-Policy'] = 'no-referrer';
    set.headers['Permissions-Policy'] = 'geolocation=(), camera=(), microphone=()';
    set.headers['Content-Security-Policy'] = "frame-ancestors 'none'";
    if (process.env.NODE_ENV === 'production') {
      set.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    }
  })
  .as('global');
