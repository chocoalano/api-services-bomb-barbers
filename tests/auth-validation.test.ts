import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { customerAuthDocs } from '../src/modules/customers/auth/docs';
import { CustomerAuthService } from '../src/modules/customers/auth/service';
import { errorHandler } from '../src/middleware/error-handler';

const app = new Elysia()
  .use(errorHandler)
  .post('/api/v1/customer/auth/login', () => ({ success: true }), customerAuthDocs.login);

describe('Customer auth validation', () => {
  it('menerima login dengan email dan password tanpa phone', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/customer/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pelanggan@bombbarbers.com',
        password: 'Password123!'
      })
    }));

    expect(response.status).toBe(200);
  });

  it('menerima login dengan phone dan password tanpa email', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/customer/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '0812345678',
        password: 'Password123!'
      })
    }));

    expect(response.status).toBe(200);
  });

  it('menerima login phone saat email dikirim string kosong', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/customer/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '',
        phone: '0812345678',
        password: 'Password123!'
      })
    }));

    expect(response.status).toBe(200);
  });

  it('menerima login email saat phone dikirim string kosong', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/customer/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pelanggan@bombbarbers.com',
        phone: '',
        password: 'Password123!'
      })
    }));

    expect(response.status).toBe(200);
  });

  it('service menolak login tanpa email dan phone', async () => {
    await expect(CustomerAuthService.login({
      email: '',
      phone: '',
      password: 'Password123!'
    })).rejects.toThrow('Email atau nomor telepon wajib diisi');
  });

  it('mengembalikan pesan jelas saat password bukan string', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/customer/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '0812345678',
        password: 12345678
      })
    }));

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Validasi gagal');
    expect(body.errors).toContainEqual({
      field: 'password',
      message: 'Kata sandi wajib berupa teks dan minimal 8 karakter'
    });
  });

  it('mengembalikan pesan jelas saat password kurang dari 8 karakter', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/customer/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '0812345678',
        password: '123'
      })
    }));

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Validasi gagal');
    expect(body.errors).toContainEqual({
      field: 'password',
      message: 'Kata sandi wajib berupa teks dan minimal 8 karakter'
    });
  });
});
