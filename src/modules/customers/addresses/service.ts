import { randomUUID } from 'crypto';
import { db } from '../../../lib/db';
import { customerAddresses } from '../../../db/schema';
import { and, eq, inArray, desc } from 'drizzle-orm';

const MAX_SAVED_ADDRESSES = 5;

const makeError = (message: string, status = 400, code?: string) => {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = status;
  if (code) error.code = code;
  return error;
};

type AddressInput = {
  service_address?: string;
  location_notes?: string | null;
  latitude?: number | string;
  longitude?: number | string;
};

const parseCoordinate = (value: number | string | undefined, min: number, max: number, label: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || parsed === 0) {
    throw makeError(`${label} tidak valid`, 400, 'INVALID_COORDINATE');
  }
  return parsed;
};

const normalizeInput = (input: AddressInput) => {
  const serviceAddress = (input.service_address ?? '').trim();
  if (serviceAddress.length < 3) {
    throw makeError('service_address wajib diisi (minimal 3 karakter)', 400, 'INVALID_ADDRESS');
  }
  const latitude = parseCoordinate(input.latitude, -90, 90, 'latitude');
  const longitude = parseCoordinate(input.longitude, -180, 180, 'longitude');
  const locationNotes = (input.location_notes ?? '').trim() || null;
  return { service_address: serviceAddress, location_notes: locationNotes, latitude, longitude };
};

// Kunci dedupe: koordinat dibulatkan ~1m + alamat (case-insensitive).
const dedupeKey = (row: { latitude: number | string; longitude: number | string; service_address: string }) =>
  `${Number(row.latitude).toFixed(5)},${Number(row.longitude).toFixed(5)}|${String(row.service_address).trim().toLowerCase()}`;

// Kolom hasil (snake_case) yang dikembalikan ke API.
const ADDRESS_COLUMNS = {
  id: customerAddresses.id,
  service_address: customerAddresses.serviceAddress,
  location_notes: customerAddresses.locationNotes,
  latitude: customerAddresses.latitude,
  longitude: customerAddresses.longitude,
  created_at: customerAddresses.createdAt,
  updated_at: customerAddresses.updatedAt
};

export class CustomerAddressService {
  /** Daftar alamat tersimpan customer (terbaru di depan, maksimal 5). */
  static async list(customerId: string) {
    return db
      .select(ADDRESS_COLUMNS)
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, customerId))
      .orderBy(desc(customerAddresses.updatedAt))
      .limit(MAX_SAVED_ADDRESSES);
  }

  /**
   * Simpan alamat baru. Bila alamat identik (koordinat+teks) sudah ada, perbarui
   * saja (bump updated_at). Bila sudah 5 dan bukan duplikat, hapus yang paling
   * lama agar total tetap maksimal 5.
   */
  static async create(customerId: string, input: AddressInput) {
    const payload = normalizeInput(input);

    const existing = await this.list(customerId);

    // Dedupe: kalau sudah ada yang identik, update itu saja.
    const duplicate = existing.find((row: any) => dedupeKey(row) === dedupeKey(payload));
    if (duplicate) {
      return this.update(customerId, duplicate.id, payload);
    }

    // Evict yang paling lama bila sudah mencapai batas.
    if (existing.length >= MAX_SAVED_ADDRESSES) {
      const toRemove = existing.slice(MAX_SAVED_ADDRESSES - 1); // sisakan 4 terbaru
      const removeIds = toRemove.map((row: any) => row.id);
      if (removeIds.length > 0) {
        await db
          .delete(customerAddresses)
          .where(and(eq(customerAddresses.customerId, customerId), inArray(customerAddresses.id, removeIds)));
      }
    }

    const id = randomUUID();
    await db.insert(customerAddresses).values({
      id,
      customerId,
      serviceAddress: payload.service_address,
      locationNotes: payload.location_notes,
      latitude: String(payload.latitude),
      longitude: String(payload.longitude)
    });

    const [row] = await db.select(ADDRESS_COLUMNS).from(customerAddresses).where(eq(customerAddresses.id, id)).limit(1);
    return row;
  }

  /** Perbarui alamat milik customer (validasi kepemilikan). */
  static async update(customerId: string, id: string, input: AddressInput) {
    const payload = normalizeInput(input);

    await db
      .update(customerAddresses)
      .set({
        serviceAddress: payload.service_address,
        locationNotes: payload.location_notes,
        latitude: String(payload.latitude),
        longitude: String(payload.longitude)
      })
      .where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customerId)));

    const [row] = await db
      .select(ADDRESS_COLUMNS)
      .from(customerAddresses)
      .where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customerId)))
      .limit(1);

    if (!row) throw makeError('Alamat tidak ditemukan', 404, 'ADDRESS_NOT_FOUND');
    return row;
  }

  /** Hapus alamat milik customer (validasi kepemilikan). */
  static async remove(customerId: string, id: string) {
    const [row] = await db
      .select({ id: customerAddresses.id })
      .from(customerAddresses)
      .where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customerId)))
      .limit(1);

    if (!row) throw makeError('Alamat tidak ditemukan', 404, 'ADDRESS_NOT_FOUND');

    await db
      .delete(customerAddresses)
      .where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customerId)));
    return { id };
  }
}
