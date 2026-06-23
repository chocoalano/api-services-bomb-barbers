import sharp from 'sharp';
import { supabase } from '../../lib/supabase';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_WIDTH = Number(process.env.MEDIA_MAX_WIDTH || 6000);
const MAX_IMAGE_HEIGHT = Number(process.env.MEDIA_MAX_HEIGHT || 6000);
const MAX_IMAGE_PIXELS = Number(process.env.MEDIA_MAX_PIXELS || 25_000_000);
const SIGNED_URL_TTL_SECONDS = Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS || 3600);
const PRIVATE_BUCKET = process.env.SUPABASE_PRIVATE_MEDIA_BUCKET || 'bomb-private-media';
const PUBLIC_BUCKET = process.env.SUPABASE_PUBLIC_MEDIA_BUCKET || 'bomb-public-media';
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

const ensureBucket = async (bucket: string, isPublic: boolean) => {
  const { data } = await supabase.storage.getBucket(bucket);
  if (data) return;

  const { error } = await supabase.storage.createBucket(bucket, {
    public: isPublic,
    fileSizeLimit: MAX_FILE_SIZE_BYTES,
    allowedMimeTypes: Array.from(ALLOWED_MIME_TYPES)
  });
  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw new Error(`Bucket media tidak tersedia: ${error.message}`);
  }
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
  const { error } = await supabase.from('media_assets' as any).insert({
    id,
    owner_type: ownerType,
    owner_id: ownerId,
    bucket,
    object_path: objectPath,
    visibility,
    purpose,
    content_type: 'image/webp',
    size_bytes: size,
    width,
    height
  });

  if (error) {
    await supabase.storage.from(bucket).remove([objectPath]);
    throw new Error(
      error.code === 'PGRST205' || error.code === '42P01'
        ? 'Migration media_assets belum diterapkan'
        : `Gagal mencatat aset media: ${error.message}`
    );
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
    await ensureBucket(PRIVATE_BUCKET, false);

    const assetId = crypto.randomUUID();
    const date = new Date().toISOString().slice(0, 10);
    const objectPath = [
      ownerType,
      uploaderId,
      date,
      `${safePurpose}-${assetId}.webp`
    ].join('/');

    const { error: uploadError } = await supabase.storage
      .from(PRIVATE_BUCKET)
      .upload(objectPath, optimized, {
        contentType: 'image/webp',
        cacheControl: 'private, max-age=300',
        upsert: false
      });
    if (uploadError) {
      throw new Error(`Gagal mengupload gambar ke private storage: ${uploadError.message}`);
    }

    await persistAsset({
      id: assetId,
      ownerType,
      ownerId: uploaderId,
      bucket: PRIVATE_BUCKET,
      objectPath,
      visibility: 'private',
      purpose: safePurpose,
      size: optimized.length,
      width,
      height
    });

    const { data: signed, error: signedError } = await supabase.storage
      .from(PRIVATE_BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    if (signedError || !signed?.signedUrl) {
      throw new Error(`Gagal membuat signed URL media: ${signedError?.message || 'unknown'}`);
    }

    return {
      asset_id: assetId,
      bucket: PRIVATE_BUCKET,
      path: objectPath,
      visibility: 'private',
      signed_url: signed.signedUrl,
      public_url: signed.signedUrl,
      expires_in: SIGNED_URL_TTL_SECONDS,
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
    const { data: asset, error } = await supabase
      .from('media_assets' as any)
      .select('id, bucket, object_path, content_type, size_bytes, width, height, purpose')
      .eq('id', assetId)
      .eq('owner_type', ownerType)
      .eq('owner_id', ownerId)
      .eq('visibility', 'private')
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !asset) {
      throw new Error('Media tidak ditemukan atau bukan milik Anda');
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from(asset.bucket)
      .createSignedUrl(asset.object_path, SIGNED_URL_TTL_SECONDS);
    if (signedError || !signed?.signedUrl) {
      throw new Error('Gagal membuat signed URL media');
    }

    return {
      asset_id: asset.id,
      signed_url: signed.signedUrl,
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
    const { data: asset, error } = await supabase
      .from('media_assets' as any)
      .select('id, bucket, object_path')
      .eq('id', assetId)
      .eq('owner_type', ownerType)
      .eq('owner_id', ownerId)
      .eq('visibility', 'private')
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !asset) {
      throw new Error('Media tidak ditemukan atau bukan milik Anda');
    }

    const { error: removeError } = await supabase.storage
      .from(asset.bucket)
      .remove([asset.object_path]);
    if (removeError) {
      throw new Error(`Gagal menghapus object media: ${removeError.message}`);
    }

    const deletedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('media_assets' as any)
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq('id', assetId);
    if (updateError) {
      throw new Error(`Gagal menandai media terhapus: ${updateError.message}`);
    }
  }

  static async uploadContentImage({
    uploaderId,
    file,
    category
  }: UploadContentInput) {
    const safeCategory = sanitizeCategory(category);
    const { optimized, width, height } = await optimizeImage(file);
    await ensureBucket(PUBLIC_BUCKET, true);

    const assetId = crypto.randomUUID();
    const objectPath = `${safeCategory}/${assetId}.webp`;
    const { error: uploadError } = await supabase.storage
      .from(PUBLIC_BUCKET)
      .upload(objectPath, optimized, {
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
        upsert: false
      });
    if (uploadError) {
      throw new Error(`Gagal mengupload gambar konten: ${uploadError.message}`);
    }

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

    const { data: publicData } = supabase.storage
      .from(PUBLIC_BUCKET)
      .getPublicUrl(objectPath);

    return {
      asset_id: assetId,
      bucket: PUBLIC_BUCKET,
      path: objectPath,
      visibility: 'public',
      public_url: publicData.publicUrl,
      content_type: 'image/webp',
      size: optimized.length,
      width,
      height,
      category: safeCategory
    };
  }
}
