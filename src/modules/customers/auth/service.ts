import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { db } from '../../../lib/db';
import { customers, customerWallets } from '../../../db/schema';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { isDuplicateKeyError } from '../../../db/procedures';

type RegisterCustomerInput = {
  full_name: string;
  email?: string | null;
  phone: string;
  password: string;
};

type LoginCustomerInput = {
  email?: string | null;
  phone?: string | null;
  password: string;
};

const validatePassword = (password: unknown) => {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Kata sandi wajib berupa teks');
  }

  if (password.length < 8) {
    throw new Error('Kata sandi minimal 8 karakter');
  }

  return password;
};

export class CustomerAuthService {
  static async register(data: RegisterCustomerInput) {
    const full_name = data.full_name.trim();
    const phone = data.phone.trim();
    const email = data.email?.trim().toLowerCase() || null;
    const password = validatePassword(data.password);

    if (!full_name) {
      throw new Error('Nama lengkap wajib diisi');
    }

    if (!phone) {
      throw new Error('Nomor telepon wajib diisi');
    }

    const [existingPhone] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.phone, phone))
      .limit(1);

    if (existingPhone) {
      throw new Error('Nomor telepon sudah terdaftar');
    }

    if (email) {
      const [existingEmail] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.email, email))
        .limit(1);

      if (existingEmail) {
        throw new Error('Email sudah terdaftar');
      }
    }

    const password_hash = await argon2.hash(password);

    const id = randomUUID();
    try {
      await db.insert(customers).values({ id, fullName: full_name, email, phone, passwordHash: password_hash });
    } catch (error: any) {
      const msg = String(error?.message ?? '');
      if (isDuplicateKeyError(error) && msg.includes('phone')) {
        throw new Error('Nomor telepon sudah terdaftar');
      }
      if (isDuplicateKeyError(error) && msg.includes('email')) {
        throw new Error('Email sudah terdaftar');
      }
      throw new Error('Gagal mendaftarkan akun pelanggan');
    }

    // Pengganti trigger create_wallet_for_new_customer.
    await db
      .insert(customerWallets)
      .values({ id: randomUUID(), customerId: id, balance: '0' })
      .onDuplicateKeyUpdate({ set: { customerId: id } });

    const [newCustomer] = await db
      .select({
        id: customers.id,
        full_name: customers.fullName,
        email: customers.email,
        phone: customers.phone,
        is_active: customers.isActive
      })
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);

    if (!newCustomer) {
      throw new Error('Gagal mendaftarkan akun pelanggan');
    }

    return newCustomer;
  }

  static async login(data: LoginCustomerInput) {
    const email = data.email?.trim().toLowerCase() || null;
    const phone = data.phone?.trim() || null;
    const password = validatePassword(data.password);

    if (!email && !phone) {
      throw new Error('Email atau nomor telepon wajib diisi');
    }

    const [customer] = await db
      .select({ id: customers.id, password_hash: customers.passwordHash, is_active: customers.isActive })
      .from(customers)
      .where(and(isNull(customers.deletedAt), email ? eq(customers.email, email) : eq(customers.phone, phone!)))
      .limit(1);

    if (!customer) {
      throw new Error('Kredensial tidak valid');
    }

    if (!customer.is_active) {
      throw new Error('Akun pelanggan tidak aktif');
    }

    if (!customer.password_hash) {
      throw new Error('Kredensial tidak valid (akun lama tanpa kata sandi)');
    }

    const isValid = await argon2.verify(customer.password_hash, password);
    if (!isValid) {
      throw new Error('Kredensial tidak valid');
    }

    return customer;
  }

  static async verifyRefresh(payload: any) {
    if (!payload || payload.role !== 'customer') {
      throw new Error('Refresh token tidak valid');
    }

    const [customer] = await db
      .select({ id: customers.id, is_active: customers.isActive })
      .from(customers)
      .where(and(eq(customers.id, payload.sub), isNull(customers.deletedAt)))
      .limit(1);

    if (!customer || !customer.is_active) {
      throw new Error('Pelanggan tidak aktif atau tidak ditemukan');
    }

    return customer;
  }

  static async updateProfile(customerId: string, data: { full_name?: string; phone?: string }) {
    const updates: Record<string, string> = {};

    if (data.full_name !== undefined) {
      const name = data.full_name.trim();
      if (!name) throw new Error('Nama lengkap tidak boleh kosong');
      updates.fullName = name;
    }

    if (data.phone !== undefined) {
      const phone = data.phone.trim();
      if (!phone) throw new Error('Nomor telepon tidak boleh kosong');
      const [existing] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.phone, phone), ne(customers.id, customerId)))
        .limit(1);
      if (existing) throw new Error('Nomor telepon sudah digunakan akun lain');
      updates.phone = phone;
    }

    if (Object.keys(updates).length === 0) {
      throw new Error('Tidak ada data yang diperbarui (kirim full_name atau phone)');
    }

    await db
      .update(customers)
      .set(updates)
      .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)));

    const [updated] = await db
      .select({
        id: customers.id,
        full_name: customers.fullName,
        phone: customers.phone,
        email: customers.email,
        points_balance: customers.pointsBalance,
        updated_at: customers.updatedAt
      })
      .from(customers)
      .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)))
      .limit(1);

    if (!updated) throw new Error('Gagal memperbarui profil pelanggan');
    return updated;
  }

  static async getProfile(customerId: string) {
    const [customer] = await db
      .select({
        id: customers.id,
        full_name: customers.fullName,
        phone: customers.phone,
        email: customers.email,
        points_balance: customers.pointsBalance,
        created_at: customers.createdAt
      })
      .from(customers)
      .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)))
      .limit(1);

    if (!customer) {
      throw new Error('Pelanggan tidak ditemukan');
    }

    return customer;
  }
}
