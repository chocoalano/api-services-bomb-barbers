import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { errorHandler } from '../src/middleware/error-handler';
import { availabilityDocs } from '../src/modules/customers/availability/docs';
import { mediaDocs } from '../src/modules/customers/media/docs';

const tinyPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5,
  0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
  96, 130
]);

const app = new Elysia()
  .use(errorHandler)
  .post('/api/v1/media/upload', () => ({ ok: true }), mediaDocs.upload)
  .get('/api/v1/branches/:id/available-slots', () => ({ ok: true }), availabilityDocs.getAvailableSlots);

describe('Media and availability endpoint validation', () => {
  it('menerima upload image multipart yang valid', async () => {
    const form = new FormData();
    form.set('file', new File([tinyPng], 'style.png', { type: 'image/png' }));
    form.set('purpose', 'hair_style_reference');

    const response = await app.handle(new Request('http://localhost/api/v1/media/upload', {
      method: 'POST',
      body: form
    }));

    expect(response.status).toBe(200);
  });

  it('menolak upload file non-image', async () => {
    const form = new FormData();
    form.set('file', new File(['not-image'], 'note.txt', { type: 'text/plain' }));

    const response = await app.handle(new Request('http://localhost/api/v1/media/upload', {
      method: 'POST',
      body: form
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('menerima query available-slots dengan service_ids berulang', async () => {
    const response = await app.handle(new Request(
      'http://localhost/api/v1/branches/11111111-1111-1111-1111-111111111111/available-slots?date=2026-06-15&service_ids=22222222-2222-2222-2222-222222222222&service_ids=33333333-3333-3333-3333-333333333333&slot_interval_min=15'
    ));

    expect(response.status).toBe(200);
  });

  it('menolak query available-slots tanpa date', async () => {
    const response = await app.handle(new Request(
      'http://localhost/api/v1/branches/11111111-1111-1111-1111-111111111111/available-slots?service_ids=22222222-2222-2222-2222-222222222222'
    ));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
  });
});
