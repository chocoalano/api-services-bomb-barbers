import { t } from 'elysia';
import {
  CUSTOMER_EXAMPLES,
  CUSTOMER_TAGS,
  customerAuthError,
  customerDetail,
  customerServerError,
  customerUuidField,
  customerValidationError
} from '../swagger';

export const mediaDocs = {
  upload: {
    type: 'multipart/form-data',
    body: t.Object({
      file: t.File({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        maxSize: '5m',
        description: 'File gambar wajib. Format JPG, PNG, atau WEBP dengan ukuran maksimal 5 MB.'
      }),
      purpose: t.Optional(t.UnionEnum([
        'face_reference',
        'hair_style_reference',
        'appointment_reference',
        'general'
      ], {
        description: 'Tujuan penggunaan gambar. Default appointment_reference.',
        examples: ['hair_style_reference']
      }))
    }, {
      examples: [
        {
          file: '(binary image file)'
        },
        {
          file: '(binary image file)',
          purpose: 'hair_style_reference'
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.media,
      summary: 'Upload Foto Referensi Customer',
      description: 'Memvalidasi MIME type, ukuran, dimensi, serta jumlah piksel; mengoptimasi gambar menjadi WebP quality 80; menyimpan object pada bucket private Supabase Storage; mencatat ownership pada media_assets; dan mengembalikan asset_id beserta signed URL sementara.',
      required: ['Authorization: Bearer <customer_access_token>', 'multipart file'],
      optional: ['multipart purpose'],
      successStatus: 201,
      successMessage: 'Gambar berhasil diupload',
      successData: {
        asset_id: '15151515-1515-4515-8515-151515151515',
        bucket: 'bomb-private-media',
        path: `customer/${CUSTOMER_EXAMPLES.customerId}/2026-06-20/hair_style_reference-15151515-1515-4515-8515-151515151515.webp`,
        visibility: 'private',
        signed_url: 'https://project.supabase.co/storage/v1/object/sign/bomb-private-media/example',
        public_url: 'https://project.supabase.co/storage/v1/object/sign/bomb-private-media/example',
        expires_in: 3600,
        content_type: 'image/webp',
        size: 184320,
        width: 1080,
        height: 1350,
        purpose: 'hair_style_reference'
      },
      errors: [
        customerAuthError,
        {
          status: 403,
          description: 'Token valid tetapi role token tidak diizinkan melakukan upload.',
          message: 'Role tidak diizinkan untuk mengupload'
        },
        customerValidationError,
        customerServerError
      ]
    })
  },

  getSignedUrl: {
    params: t.Object({
      id: customerUuidField(
        'UUID media asset private milik customer.',
        '15151515-1515-4515-8515-151515151515'
      )
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.media,
      summary: 'Perbarui Signed URL Media Customer',
      description: 'Membuat signed URL baru untuk media private yang dimiliki customer pada token. URL hanya berlaku sementara dan tidak boleh disimpan sebagai URL publik permanen.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id'],
      successMessage: 'Signed URL media berhasil dibuat',
      successData: {
        asset_id: '15151515-1515-4515-8515-151515151515',
        signed_url: 'https://project.supabase.co/storage/v1/object/sign/bomb-private-media/example',
        expires_in: 3600,
        content_type: 'image/webp',
        size: 184320,
        width: 1080,
        height: 1350,
        purpose: 'hair_style_reference'
      },
      errors: [
        customerAuthError,
        {
          status: 404,
          description: 'Media tidak ditemukan atau bukan milik customer.',
          message: 'Media tidak ditemukan atau bukan milik Anda'
        },
        customerServerError
      ]
    })
  },

  remove: {
    params: t.Object({
      id: customerUuidField(
        'UUID media asset private yang akan dihapus.',
        '15151515-1515-4515-8515-151515151515'
      )
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.media,
      summary: 'Hapus Media Private Customer',
      description: 'Menghapus object dari private storage dan menandai record media_assets sebagai terhapus. Customer hanya dapat menghapus media miliknya sendiri.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id'],
      successMessage: 'Media berhasil dihapus',
      successData: null,
      errors: [
        customerAuthError,
        {
          status: 404,
          description: 'Media tidak ditemukan atau bukan milik customer.',
          message: 'Media tidak ditemukan atau bukan milik Anda'
        },
        customerServerError
      ]
    })
  }
};
