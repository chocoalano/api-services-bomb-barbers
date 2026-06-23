import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { errorHandler } from '../src/middleware/error-handler';
import { contentDocs } from '../src/modules/customers/content/docs';

const app = new Elysia()
  .use(errorHandler)
  .get('/api/v1/banners', () => ({ ok: true }), contentDocs.getBanners)
  .get('/api/v1/gallery', () => ({ ok: true }), contentDocs.getGallery)
  .get('/api/v1/notifications', () => ({ ok: true }), contentDocs.getCustomerNotifications)
  .get('/api/v1/customer/notifications', () => ({ ok: true }), contentDocs.getCustomerNotifications);

describe('Content endpoint validation', () => {
  it('menerima query valid untuk banners', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/banners?limit=5'));

    expect(response.status).toBe(200);
  });

  it('menerima query valid untuk gallery portfolio barber', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/gallery?limit=12&barber_id=11111111-1111-1111-1111-111111111111&branch_id=22222222-2222-2222-2222-222222222222'));

    expect(response.status).toBe(200);
  });

  it('menerima query valid untuk notifications', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/notifications?limit=10&unread_only=true'));

    expect(response.status).toBe(200);
  });

  it('menolak limit banners di bawah minimum', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/banners?limit=0'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Validasi gagal');
  });
});
