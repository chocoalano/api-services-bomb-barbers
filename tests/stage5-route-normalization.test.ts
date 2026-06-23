/**
 * Stage 5 — Normalisasi route
 *
 * Verifikasi:
 *  1. Route canonical baru (/customers/*, /barbers/*) bekerja dengan benar
 *  2. Route deprecated lama masih bekerja (backward compat)
 *  3. Route deprecated mengembalikan header Deprecation, Sunset, Link
 *  4. Route canonical TIDAK mengembalikan header Deprecation
 *  5. Singular duplicates (/payment, /review, /notifications) sudah diperbaiki
 *  6. /staff/* dan /barber/* keduanya deprecated ke /barbers/*
 *  7. /branches/* deprecated ke /customers/catalog/branches/*
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import { SUNSET_DATE } from '../src/shared/deprecation';

const API = '/api/v1';
const PASS = 'password123';

let customerToken = '';
let barberToken = '';
let branchId = '';

// ── Helper ────────────────────────────────────────────────────────────────────

const hit = async (method: string, path: string, token?: string, body?: any) => {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    })
  );
  return {
    status: res.status,
    body: await res.json() as any,
    headers: res.headers
  };
};

const isDeprecated = (headers: Headers) => headers.get('Deprecation') === 'true';
const hasSunset = (headers: Headers) => headers.get('Sunset') === SUNSET_DATE;
const canonicalLink = (headers: Headers): string | null => {
  const link = headers.get('Link');
  if (!link) return null;
  const m = link.match(/<([^>]+)>;\s*rel="canonical"/);
  return m ? m[1] : null;
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Customer login via canonical route
  const cr = await hit('POST', `${API}/customers/auth/login`, undefined, {
    email: 'fajar.customer@example.com',
    password: PASS
  });
  customerToken = cr.body?.data?.accessToken ?? '';

  // Barber login via canonical route
  const br = await hit('POST', `${API}/barbers/auth/login`, undefined, {
    email: 'budi@bombbarbers.com',
    password: PASS
  });
  barberToken = br.body?.data?.accessToken ?? '';

  // Resolve branch ID
  const { data: branch } = await supabase.from('branches').select('id').limit(1).single();
  branchId = branch?.id ?? '';
});

// ── 1. Canonical customer auth ─────────────────────────────────────────────────

describe('POST /api/v1/customers/auth/login — rute canonical', () => {
  it('login berhasil dengan 200', async () => {
    const { status } = await hit('POST', `${API}/customers/auth/login`, undefined, {
      email: 'fajar.customer@example.com',
      password: PASS
    });
    expect(status).toBe(200);
  });

  it('tidak ada header Deprecation', async () => {
    const { headers } = await hit('POST', `${API}/customers/auth/login`, undefined, {
      email: 'fajar.customer@example.com',
      password: PASS
    });
    expect(isDeprecated(headers)).toBe(false);
  });
});

// ── 2. Deprecated customer auth ────────────────────────────────────────────────

describe('POST /api/v1/customer/auth/login — alias deprecated', () => {
  it('masih mengembalikan 200 (backward compat)', async () => {
    const { status } = await hit('POST', `${API}/customer/auth/login`, undefined, {
      email: 'fajar.customer@example.com',
      password: PASS
    });
    expect(status).toBe(200);
  });

  it('mengembalikan header Deprecation: true', async () => {
    const { headers } = await hit('POST', `${API}/customer/auth/login`, undefined, {
      email: 'fajar.customer@example.com',
      password: PASS
    });
    expect(isDeprecated(headers)).toBe(true);
  });

  it('mengembalikan header Sunset dengan tanggal penghentian', async () => {
    const { headers } = await hit('POST', `${API}/customer/auth/login`, undefined, {
      email: 'fajar.customer@example.com',
      password: PASS
    });
    expect(hasSunset(headers)).toBe(true);
  });

  it('Link header mengarah ke rute canonical', async () => {
    const { headers } = await hit('POST', `${API}/customer/auth/login`, undefined, {
      email: 'fajar.customer@example.com',
      password: PASS
    });
    expect(canonicalLink(headers)).toBe('/api/v1/customers/auth/login');
  });
});

// ── 3. Catalog canonical (/customers/catalog/branches) ────────────────────────

describe('GET /api/v1/customers/catalog/branches — rute canonical', () => {
  it('mengembalikan daftar cabang dengan 200', async () => {
    const { status, body } = await hit('GET', `${API}/customers/catalog/branches`);
    expect(status).toBe(200);
    expect(Array.isArray(body.data ?? body)).toBe(true);
  });

  it('tidak ada header Deprecation', async () => {
    const { headers } = await hit('GET', `${API}/customers/catalog/branches`);
    expect(isDeprecated(headers)).toBe(false);
  });

  it('detail cabang canonical /:id', async () => {
    const { status } = await hit('GET', `${API}/customers/catalog/branches/${branchId}`);
    expect(status).toBe(200);
  });
});

// ── 4. Deprecated /branches → /customers/catalog/branches ────────────────────

describe('GET /api/v1/branches — alias deprecated', () => {
  it('masih mengembalikan 200', async () => {
    const { status } = await hit('GET', `${API}/branches`);
    expect(status).toBe(200);
  });

  it('mengembalikan Deprecation: true', async () => {
    const { headers } = await hit('GET', `${API}/branches`);
    expect(isDeprecated(headers)).toBe(true);
  });

  it('mengembalikan Sunset header', async () => {
    const { headers } = await hit('GET', `${API}/branches`);
    expect(hasSunset(headers)).toBe(true);
  });

  it('Link mengarah ke /customers/catalog/branches', async () => {
    const { headers } = await hit('GET', `${API}/branches`);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/catalog/branches');
  });

  it('/:id deprecated dan Link mengarah ke /customers/catalog/branches/:id', async () => {
    const { headers } = await hit('GET', `${API}/branches/${branchId}`);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/catalog/branches/:id');
  });

  it('/:id/barbers deprecated', async () => {
    const { headers } = await hit('GET', `${API}/branches/${branchId}/barbers`);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/catalog/branches/:id/barbers');
  });

  it('/:id/services deprecated', async () => {
    const { headers } = await hit('GET', `${API}/branches/${branchId}/services`);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/catalog/branches/:id/services');
  });

  it('/:id/available-slots deprecated', async () => {
    const { headers } = await hit('GET', `${API}/branches/${branchId}/available-slots`);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/catalog/branches/:id/available-slots');
  });
});

// ── 5. Content canonical ───────────────────────────────────────────────────────

describe('GET /api/v1/customers/content/* — rute canonical', () => {
  it('/customers/content/banners → 200 tanpa Deprecation', async () => {
    const { status, headers } = await hit('GET', `${API}/customers/content/banners`);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(false);
  });

  it('/customers/content/gallery → 200 tanpa Deprecation', async () => {
    const { status, headers } = await hit('GET', `${API}/customers/content/gallery`);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(false);
  });

  it('/customers/notifications (auth) → 200 tanpa Deprecation', async () => {
    const { status, headers } = await hit('GET', `${API}/customers/notifications`, customerToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(false);
  });
});

// ── 6. Deprecated /banners, /gallery, /notifications ─────────────────────────

describe('Content deprecated aliases', () => {
  it('/banners → Deprecation: true, Link ke /customers/content/banners', async () => {
    const { headers } = await hit('GET', `${API}/banners`);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/content/banners');
  });

  it('/gallery → Deprecation: true, Link ke /customers/content/gallery', async () => {
    const { headers } = await hit('GET', `${API}/gallery`);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/content/gallery');
  });

  it('/notifications (tanpa prefix customer) → Deprecation: true', async () => {
    const { headers } = await hit('GET', `${API}/notifications`, customerToken);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/notifications');
  });

  it('/customer/notifications → Deprecation: true, Link ke /customers/notifications', async () => {
    const { headers } = await hit('GET', `${API}/customer/notifications`, customerToken);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/notifications');
  });
});

// ── 7. Invoice deprecated (/invoices → /customers/invoices) ──────────────────

describe('Invoice deprecated aliases', () => {
  it('/customers/invoices/:id (canonical) tidak ada header Deprecation', async () => {
    const { headers } = await hit('GET', `${API}/customers/invoices/INV-FAKE-000`);
    expect(isDeprecated(headers)).toBe(false);
  });

  it('/invoices/:id → Deprecation: true, Link ke /customers/invoices', async () => {
    const { headers } = await hit('GET', `${API}/invoices/INV-FAKE-000`);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/invoices/:invoiceNumber');
  });
});

// ── 8. Media deprecated (/media/upload, /customer/media) ─────────────────────

describe('Media deprecated aliases', () => {
  it('/customers/media/upload (canonical) tidak ada header Deprecation', async () => {
    // 400 expected karena tidak ada file, tapi route terdaftar dan tidak ada header deprecated
    const { headers } = await hit('POST', `${API}/customers/media/upload`, customerToken, {});
    expect(isDeprecated(headers)).toBe(false);
  });

  it('/media/upload → Deprecation: true, Link ke /customers/media/upload', async () => {
    const { headers } = await hit('POST', `${API}/media/upload`, customerToken, {});
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/media/upload');
  });

  it('/customer/media/upload → Deprecation: true', async () => {
    const { headers } = await hit('POST', `${API}/customer/media/upload`, customerToken, {});
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/media/upload');
  });
});

// ── 9. Payment singular → deprecated (/payment → /payments) ──────────────────

describe('Payment singular deprecated', () => {
  const fakeId = '00000000-0000-4000-8000-000000000099';

  it('POST /customers/appointments/:id/payments (canonical) tidak ada Deprecation', async () => {
    const { headers } = await hit('POST', `${API}/customers/appointments/${fakeId}/payments`, customerToken, { amount: 100 });
    expect(isDeprecated(headers)).toBe(false);
  });

  it('POST /customer/appointments/:id/payment (singular) → Deprecation: true', async () => {
    const { headers } = await hit('POST', `${API}/customer/appointments/${fakeId}/payment`, customerToken, { amount: 100 });
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/appointments/:id/payments');
  });

  it('POST /customer/appointments/:id/payments (lama) → Deprecation: true', async () => {
    const { headers } = await hit('POST', `${API}/customer/appointments/${fakeId}/payments`, customerToken, { amount: 100 });
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/appointments/:id/payments');
  });
});

// ── 10. Review singular → deprecated (/review → /reviews) ────────────────────

describe('Review singular deprecated', () => {
  const fakeId = '00000000-0000-4000-8000-000000000099';

  it('POST /customers/appointments/:id/reviews (canonical) tidak ada Deprecation', async () => {
    const { headers } = await hit('POST', `${API}/customers/appointments/${fakeId}/reviews`, customerToken, { rating: 5 });
    expect(isDeprecated(headers)).toBe(false);
  });

  it('POST /customer/appointments/:id/review (singular) → Deprecation: true', async () => {
    const { headers } = await hit('POST', `${API}/customer/appointments/${fakeId}/review`, customerToken, { rating: 5 });
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/appointments/:id/reviews');
  });

  it('POST /customer/appointments/:id/reviews (lama plural) → Deprecation: true', async () => {
    const { headers } = await hit('POST', `${API}/customer/appointments/${fakeId}/reviews`, customerToken, { rating: 5 });
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/appointments/:id/reviews');
  });
});

// ── 11. Customer appointments canonical ───────────────────────────────────────

describe('Customer appointments — canonical vs deprecated', () => {
  it('GET /customers/appointments (canonical) → 200 tanpa Deprecation', async () => {
    const { status, headers } = await hit('GET', `${API}/customers/appointments`, customerToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(false);
  });

  it('GET /customer/appointments (deprecated) → Deprecation: true', async () => {
    const { headers } = await hit('GET', `${API}/customer/appointments`, customerToken);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/customers/appointments');
  });
});

// ── 12. Barber auth canonical ──────────────────────────────────────────────────

describe('POST /api/v1/barbers/auth/login — canonical', () => {
  it('login barber berhasil dengan 200', async () => {
    const { status } = await hit('POST', `${API}/barbers/auth/login`, undefined, {
      email: 'budi@bombbarbers.com',
      password: PASS
    });
    expect(status).toBe(200);
  });

  it('tidak ada header Deprecation', async () => {
    const { headers } = await hit('POST', `${API}/barbers/auth/login`, undefined, {
      email: 'budi@bombbarbers.com',
      password: PASS
    });
    expect(isDeprecated(headers)).toBe(false);
  });
});

// ── 13. Barber auth deprecated ────────────────────────────────────────────────

describe('POST /api/v1/barber/auth/login — deprecated', () => {
  it('masih mengembalikan 200', async () => {
    const { status } = await hit('POST', `${API}/barber/auth/login`, undefined, {
      email: 'budi@bombbarbers.com',
      password: PASS
    });
    expect(status).toBe(200);
  });

  it('Deprecation: true, Link ke /barbers/auth/login', async () => {
    const { headers } = await hit('POST', `${API}/barber/auth/login`, undefined, {
      email: 'budi@bombbarbers.com',
      password: PASS
    });
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/auth/login');
  });
});

describe('POST /api/v1/staff/auth/login — deprecated', () => {
  it('masih mengembalikan 200', async () => {
    const { status } = await hit('POST', `${API}/staff/auth/login`, undefined, {
      email: 'budi@bombbarbers.com',
      password: PASS
    });
    expect(status).toBe(200);
  });

  it('Deprecation: true, Link ke /barbers/auth/login', async () => {
    const { headers } = await hit('POST', `${API}/staff/auth/login`, undefined, {
      email: 'budi@bombbarbers.com',
      password: PASS
    });
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/auth/login');
  });
});

// ── 14. Barber queue canonical vs deprecated ──────────────────────────────────

describe('Barber queue — canonical vs deprecated', () => {
  it('GET /barbers/queue (canonical) → 200 tanpa Deprecation', async () => {
    const { status, headers } = await hit('GET', `${API}/barbers/queue`, barberToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(false);
  });

  it('GET /barber/queue (deprecated) → Deprecation: true, Link ke /barbers/queue', async () => {
    const { status, headers } = await hit('GET', `${API}/barber/queue`, barberToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/queue');
  });

  it('GET /staff/queue (deprecated) → Deprecation: true, Link ke /barbers/queue', async () => {
    const { status, headers } = await hit('GET', `${API}/staff/queue`, barberToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/queue');
  });
});

// ── 15. Barber dashboard canonical vs deprecated ──────────────────────────────

describe('Barber dashboard — canonical vs deprecated', () => {
  it('GET /barbers/dashboard/today (canonical) → 200 tanpa Deprecation', async () => {
    const { status, headers } = await hit('GET', `${API}/barbers/dashboard/today`, barberToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(false);
  });

  it('GET /barber/dashboard/today (deprecated) → Deprecation: true', async () => {
    const { status, headers } = await hit('GET', `${API}/barber/dashboard/today`, barberToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/dashboard/today');
  });

  it('GET /staff/dashboard/today (deprecated) → Deprecation: true', async () => {
    const { status, headers } = await hit('GET', `${API}/staff/dashboard/today`, barberToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/dashboard/today');
  });

  it('GET /barbers/stats/daily (canonical) → 200 tanpa Deprecation', async () => {
    const { status, headers } = await hit('GET', `${API}/barbers/stats/daily`, barberToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(false);
  });

  it('GET /barber/stats/daily (deprecated) → Deprecation: true', async () => {
    const { headers } = await hit('GET', `${API}/barber/stats/daily`, barberToken);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/stats/daily');
  });

  it('GET /staff/stats/daily (deprecated) → Deprecation: true', async () => {
    const { headers } = await hit('GET', `${API}/staff/stats/daily`, barberToken);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/stats/daily');
  });

  it('GET /staff/earnings (deprecated) → Link ke /barbers/earnings', async () => {
    const { headers } = await hit('GET', `${API}/staff/earnings`, barberToken);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/earnings');
  });
});

// ── 16. Barber commissions ────────────────────────────────────────────────────

describe('Barber commissions — canonical vs deprecated', () => {
  it('GET /barbers/commissions (canonical) → tanpa Deprecation', async () => {
    const { status, headers } = await hit('GET', `${API}/barbers/commissions`, barberToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(false);
  });

  it('GET /barber/commissions (deprecated) → Deprecation: true', async () => {
    const { headers } = await hit('GET', `${API}/barber/commissions`, barberToken);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/commissions');
  });
});

// ── 17. Barber portfolio ──────────────────────────────────────────────────────

describe('Barber portfolio — canonical vs deprecated', () => {
  it('GET /barbers/portfolio (canonical) → tanpa Deprecation', async () => {
    const { status, headers } = await hit('GET', `${API}/barbers/portfolio`, barberToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(false);
  });

  it('GET /barber/portfolio (deprecated) → Deprecation: true', async () => {
    const { headers } = await hit('GET', `${API}/barber/portfolio`, barberToken);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/portfolio');
  });
});

// ── 18. Barber appointments history canonical vs deprecated ───────────────────

describe('Barber appointments history — canonical vs deprecated', () => {
  it('GET /barbers/appointments/history (canonical) → 200 tanpa Deprecation', async () => {
    const { status, headers } = await hit('GET', `${API}/barbers/appointments/history`, barberToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(false);
  });

  it('GET /barber/appointments/history (deprecated) → Deprecation: true', async () => {
    const { status, headers } = await hit('GET', `${API}/barber/appointments/history`, barberToken);
    expect(status).toBe(200);
    expect(isDeprecated(headers)).toBe(true);
    expect(canonicalLink(headers)).toBe('/api/v1/barbers/appointments/history');
  });
});

// ── 19. Sunset date konsisten ─────────────────────────────────────────────────

describe('Sunset header konsisten di semua deprecated routes', () => {
  const cases = [
    { path: `${API}/branches`, method: 'GET' },
    { path: `${API}/banners`, method: 'GET' },
    { path: `${API}/gallery`, method: 'GET' },
  ];

  for (const { path, method } of cases) {
    it(`${method} ${path} mengembalikan Sunset: ${SUNSET_DATE}`, async () => {
      const { headers } = await hit(method, path);
      expect(headers.get('Sunset')).toBe(SUNSET_DATE);
    });
  }

  it('GET /barber/queue mengembalikan Sunset header', async () => {
    const { headers } = await hit('GET', `${API}/barber/queue`, barberToken);
    expect(headers.get('Sunset')).toBe(SUNSET_DATE);
  });
});

// ── 20. Unauthenticated canonical routes → 401/403 ───────────────────────────

describe('Autentikasi di route canonical', () => {
  it('GET /customers/appointments tanpa token → ≥401', async () => {
    const { status } = await hit('GET', `${API}/customers/appointments`);
    expect(status).toBeGreaterThanOrEqual(401);
  });

  it('GET /barbers/queue tanpa token → ≥401', async () => {
    const { status } = await hit('GET', `${API}/barbers/queue`);
    expect(status).toBeGreaterThanOrEqual(401);
  });

  it('GET /barbers/dashboard/today tanpa token → ≥401', async () => {
    const { status } = await hit('GET', `${API}/barbers/dashboard/today`);
    expect(status).toBeGreaterThanOrEqual(401);
  });
});
