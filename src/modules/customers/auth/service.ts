import * as argon2 from 'argon2';
import { supabase } from '../../../lib/supabase';

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

    const { data: existingPhone, error: phoneLookupError } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (phoneLookupError) {
      throw new Error('Gagal memeriksa nomor telepon pelanggan');
    }

    if (existingPhone) {
      throw new Error('Nomor telepon sudah terdaftar');
    }

    if (email) {
      const { data: existingEmail, error: emailLookupError } = await supabase
        .from('customers')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (emailLookupError) {
        throw new Error('Gagal memeriksa email pelanggan');
      }

      if (existingEmail) {
        throw new Error('Email sudah terdaftar');
      }
    }

    const password_hash = await argon2.hash(password);

    const { data: newCustomer, error } = await supabase
      .from('customers')
      .insert({
        full_name,
        email,
        phone,
        password_hash
      })
      .select('id, full_name, email, phone, is_active')
      .single();

    if (error) {
      if (error.code === '23505' && error.message.includes('customers_phone')) {
        throw new Error('Nomor telepon sudah terdaftar');
      }

      if (error.code === '23505' && error.message.includes('customers_email')) {
        throw new Error('Email sudah terdaftar');
      }

      throw new Error('Gagal mendaftarkan akun pelanggan');
    }

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

    const customerQuery = supabase
      .from('customers')
      .select('id, password_hash, is_active')
      .is('deleted_at', null);

    const { data: customer } = await (email
      ? customerQuery.eq('email', email)
      : customerQuery.eq('phone', phone)
    ).maybeSingle();

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

    const { data: customer } = await supabase
      .from('customers')
      .select('id, is_active')
      .eq('id', payload.sub)
      .is('deleted_at', null)
      .single();

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
      updates.full_name = name;
    }

    if (data.phone !== undefined) {
      const phone = data.phone.trim();
      if (!phone) throw new Error('Nomor telepon tidak boleh kosong');
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('phone', phone)
        .neq('id', customerId)
        .maybeSingle();
      if (existing) throw new Error('Nomor telepon sudah digunakan akun lain');
      updates.phone = phone;
    }

    if (Object.keys(updates).length === 0) {
      throw new Error('Tidak ada data yang diperbarui (kirim full_name atau phone)');
    }

    const { data: updated, error } = await supabase
      .from('customers')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', customerId)
      .is('deleted_at', null)
      .select('id, full_name, phone, email, points_balance, updated_at')
      .single();

    if (error || !updated) throw new Error('Gagal memperbarui profil pelanggan');
    return updated;
  }

  static async getProfile(customerId: string) {
    const { data: customer } = await supabase
      .from('customers')
      .select('id, full_name, phone, email, points_balance, created_at')
      .eq('id', customerId)
      .is('deleted_at', null)
      .single();

    if (!customer) {
      throw new Error('Pelanggan tidak ditemukan');
    }

    return customer;
  }
}
