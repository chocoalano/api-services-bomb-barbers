import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { db } from '../../lib/db';
import { mediaAssets } from '../../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { toDbDate } from '../../db/helpers';
import { isDuplicateKeyError } from '../../db/procedures';
import { LocalStorage } from '../../lib/storage';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_WIDTH = Number(process.env.MEDIA_MAX_WIDTH || 6000);
const MAX_IMAGE_HEIGHT = Number(process.env.MEDIA_MAX_HEIGHT || 6000);
const MAX_IMAGE_PIXELS = Number(process.env.MEDIA_MAX_PIXELS || 25_000_000);
const SIGNED_URL_TTL_SECONDS = Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS || 3600);
// Nama "bucket" dipertahankan sebagai label logis pada kolom media_assets.bucket
// (kompatibilitas data lama); pada storage lokal ini hanya penanda public/private.
const PRIVATE_BUCKET = process.env.MEDIA_PRIVATE_BUCKET || 'bomb-private-media';
const PUBLIC_BUCKET = process.env.MEDIA_PUBLIC_BUCKET || 'bomb-public-media';
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VALID_CONTENT_CATEGORIES = new Set(['promotion', 'service', 'portfolio', 'branch', 'general']);

type MediaOwnerType = 'customer' | 'staff';

type UploadMediaInput = {
  ownerType: MediaOwnerType;
  uploaderId: string;
  file: File;
  purpose?: string;
};

type UploadContentInput = {
  uploaderId: string;
  file: File;
  category?: string;
};

const sanitizeSegment = (value: string, fallback: string) =>
  (value.trim().toLowerCase() || fallback)
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 80);

const sanitizePurpose = (purpose?: string) =>
  sanitizeSegment(purpose || 'appointment_reference', 'appointment_reference');

const sanitizeCategory = (category?: string) => {
  const value = category?.trim().toLowerCase() || 'general';
  return VALID_CONTENT_CATEGORIES.has(value) ? value : 'general';
};

const validateImageFile = (file: File) => {
  if (!file) throw new Error('File gambar wajib dikirim');
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error('Format gambar harus JPG, PNG, atau WEBP');
  }
  if (file.size <= 0) throw new Error('File gambar tidak boleh kosong');
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('Ukuran gambar maksimal 5MB');
  }
};

const optimizeImage = async (file: File) => {
  validateImageFile(file);
  const source = Buffer.from(await file.arrayBuffer());

  let metadata;
  try {
    metadata = await sharp(source).metadata();
  } catch {
    throw new Error('Isi file bukan gambar yang valid');
  }

  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) {
    throw new Error('Dimensi gambar tidak dapat dibaca');
  }
  if (
    width > MAX_IMAGE_WIDTH ||
    height > MAX_IMAGE_HEIGHT ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error(
      `Dimensi gambar terlalu besar. Maksimum ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT} dan ${MAX_IMAGE_PIXELS} piksel`
    );
  }

  const optimized = await sharp(source)
    .rotate()
    .webp({ quality: 80 })
    .toBuffer();

  return { optimized, width, height };
};

const persistAsset = async ({
  id,
  ownerType,
  ownerId,
  bucket,
  objectPath,
  visibility,
  purpose,
  size,
  width,
  height
}: {
  id: string;
  ownerType: MediaOwnerType;
  ownerId: string;
  bucket: string;
  objectPath: string;
  visibility: 'private' | 'public';
  purpose: string;
  size: number;
  width: number;
  height: number;
}) => {
  try {
    await db.insert(mediaAssets).values({
      id,
      ownerType,
      ownerId,
      bucket,
      objectPath,
      visibility,
      purpose,
      contentType: 'image/webp',
      sizeBytes: size,
      width,
      height
    } as any);
  } catch (error: any) {
    // Rollback file bila pencatatan gagal (idempotensi upload).
    if (visibility === 'public') await LocalStorage.removePublic(objectPath);
    else await LocalStorage.removePrivate(objectPath);
    if (isDuplicateKeyError(error)) {
      throw new Error('Aset media dengan path tersebut sudah ada');
    }
    throw new Error(`Gagal mencatat aset media: ${error?.message ?? 'unknown'}`);
  }
};

export class MediaService {
  static async uploadAppointmentImage({
    ownerType,
    uploaderId,
    file,
    purpose
  }: UploadMediaInput) {
    const safePurpose = sanitizePurpose(purpose);
    const { optimized, width, height } = await optimizeImage(file);
    // Dokumentasi appointment (foto before/after) HARUS durable: URL-nya disimpan
    // permanen di appointment (`customer_media_urls`). Karena itu disimpan sebagai
    // publik (path UUID tak tertebak) agar URL stabil selamanya.
    const assetId = randomUUID();
    const date = new Date().toISOString().slice(0, 10);
    const objectPath = [
      ownerType,
      uploaderId,
      date,
      `${safePurpose}-${assetId}.webp`
    ].join('/');

    await LocalStorage.savePublic(objectPath, optimized);

    await persistAsset({
      id: assetId,
      ownerType,
      ownerId: uploaderId,
      bucket: PUBLIC_BUCKET,
      objectPath,
      visibility: 'public',
      purpose: safePurpose,
      size: optimized.length,
      width,
      height
    });

    const durableUrl = LocalStorage.publicUrl(objectPath);

    return {
      asset_id: assetId,
      bucket: PUBLIC_BUCKET,
      path: objectPath,
      visibility: 'public',
      // signed_url dipertahankan (= public_url) demi kompatibilitas konsumen lama.
      signed_url: durableUrl,
      public_url: durableUrl,
      expires_in: null,
      content_type: 'image/webp',
      size: optimized.length,
      width,
      height,
      purpose: safePurpose
    };
  }

  static async getPrivateAssetUrl(
    ownerType: MediaOwnerType,
    ownerId: string,
    assetId: string
  ) {
    const [asset] = await db
      .select({
        id: mediaAssets.id,
        bucket: mediaAssets.bucket,
        object_path: mediaAssets.objectPath,
        content_type: mediaAssets.contentType,
        size_bytes: mediaAssets.sizeBytes,
        width: mediaAssets.width,
        height: mediaAssets.height,
        purpose: mediaAssets.purpose
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.ownerType, ownerType),
          eq(mediaAssets.ownerId, ownerId),
          eq(mediaAssets.visibility, 'private'),
          isNull(mediaAssets.deletedAt)
        )
      )
      .limit(1);

    if (!asset) {
      throw new Error('Media tidak ditemukan atau bukan milik Anda');
    }

    const signedUrl = LocalStorage.signedUrl(asset.object_path, SIGNED_URL_TTL_SECONDS);

    return {
      asset_id: asset.id,
      signed_url: signedUrl,
      expires_in: SIGNED_URL_TTL_SECONDS,
      content_type: asset.content_type,
      size: Number(asset.size_bytes),
      width: asset.width,
      height: asset.height,
      purpose: asset.purpose
    };
  }

  static async deletePrivateAsset(
    ownerType: MediaOwnerType,
    ownerId: string,
    assetId: string
  ) {
    const [asset] = await db
      .select({ id: mediaAssets.id, bucket: mediaAssets.bucket, object_path: mediaAssets.objectPath })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.ownerType, ownerType),
          eq(mediaAssets.ownerId, ownerId),
          eq(mediaAssets.visibility, 'private'),
          isNull(mediaAssets.deletedAt)
        )
      )
      .limit(1);

    if (!asset) {
      throw new Error('Media tidak ditemukan atau bukan milik Anda');
    }

    await LocalStorage.removePrivate(asset.object_path);

    await db
      .update(mediaAssets)
      .set({ deletedAt: toDbDate(new Date()) })
      .where(eq(mediaAssets.id, assetId));
  }

  static async uploadContentImage({
    uploaderId,
    file,
    category
  }: UploadContentInput) {
    const safeCategory = sanitizeCategory(category);
    const { optimized, width, height } = await optimizeImage(file);

    const assetId = randomUUID();
    const objectPath = `${safeCategory}/${assetId}.webp`;

    await LocalStorage.savePublic(objectPath, optimized);

    await persistAsset({
      id: assetId,
      ownerType: 'staff',
      ownerId: uploaderId,
      bucket: PUBLIC_BUCKET,
      objectPath,
      visibility: 'public',
      purpose: safeCategory,
      size: optimized.length,
      width,
      height
    });

    return {
      asset_id: assetId,
      bucket: PUBLIC_BUCKET,
      path: objectPath,
      visibility: 'public',
      public_url: LocalStorage.publicUrl(objectPath),
      content_type: 'image/webp',
      size: optimized.length,
      width,
      height,
      category: safeCategory
    };
  }
}

export { PRIVATE_BUCKET };
