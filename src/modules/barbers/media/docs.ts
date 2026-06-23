import { t } from 'elysia';
import {
  BARBER_EXAMPLES,
  BARBER_TAGS,
  barberAuthError,
  barberDetail,
  barberServerError,
  barberUuidField,
  barberValidationError
} from '../swagger';

export const mediaDocs = {
  upload: {
    type: 'multipart/form-data',
    body: t.Object({
      file: t.File({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        maxSize: '5m',
        description: 'File gambar wajib. Format JPG, PNG, atau WEBP, maksimum 5 MB.'
      }),
      purpose: t.Optional(t.UnionEnum([
        'face_reference',
        'hair_style_reference',
        'appointment_reference',
        'general'
      ], {
        description: 'Tujuan upload. Untuk dokumentasi appointment dapat menggunakan appointment_reference; default juga appointment_reference.',
        examples: ['appointment_reference']
      }))
    }, {
      examples: [
        {
          file: '(binary image file)'
        },
        {
          file: '(binary image file)',
          purpose: 'appointment_reference'
        }
      ]
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.media,
      summary: 'Upload Media Barber',
      description: 'Memvalidasi MIME type, ukuran, dimensi, dan jumlah piksel; mengoptimasi gambar menjadi WebP; menyimpannya pada bucket private Supabase Storage milik staff; serta mengembalikan asset_id dan signed URL sementara.',
      required: ['Authorization: Bearer <barber_access_token>', 'multipart file'],
      optional: ['multipart purpose'],
      successStatus: 201,
      successMessage: 'Gambar berhasil diupload',
      successData: {
        asset_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        bucket: 'bomb-private-media',
        path: `staff/${BARBER_EXAMPLES.staffId}/2026-06-20/appointment_reference-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp`,
        visibility: 'private',
        signed_url: 'https://project.supabase.co/storage/v1/object/sign/bomb-private-media/example',
        public_url: 'https://project.supabase.co/storage/v1/object/sign/bomb-private-media/example',
        expires_in: 3600,
        content_type: 'image/webp',
        size: 184320,
        width: 1080,
        height: 1350,
        purpose: 'appointment_reference'
      },
      errors: [
        barberAuthError,
        {
          status: 403,
          description: 'Role JWT bukan customer atau staff.',
          message: 'Role tidak diizinkan untuk mengupload'
        },
        barberValidationError,
        barberServerError
      ]
    })
  },

  getSignedUrl: {
    params: t.Object({
      id: barberUuidField(
        'UUID media asset private milik staff/barber.',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      )
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.media,
      summary: 'Perbarui Signed URL Media Barber',
      description: 'Membuat signed URL baru untuk media private yang dimiliki staff pada token. Ownership media diperiksa sebelum URL diterbitkan.',
      required: ['Authorization: Bearer <barber_access_token>', 'path.id'],
      successMessage: 'Signed URL media berhasil dibuat',
      successData: {
        asset_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        signed_url: 'https://project.supabase.co/storage/v1/object/sign/bomb-private-media/example',
        expires_in: 3600,
        content_type: 'image/webp',
        size: 184320,
        width: 1080,
        height: 1350,
        purpose: 'appointment_reference'
      },
      errors: [
        barberAuthError,
        {
          status: 404,
          description: 'Media tidak ditemukan atau bukan milik staff.',
          message: 'Media tidak ditemukan atau bukan milik Anda'
        },
        barberServerError
      ]
    })
  },

  remove: {
    params: t.Object({
      id: barberUuidField(
        'UUID media asset private yang akan dihapus.',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      )
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.media,
      summary: 'Hapus Media Private Barber',
      description: 'Menghapus object dari private storage dan menandai record media_assets sebagai terhapus. Barber hanya dapat menghapus media yang diunggah oleh akun staff-nya.',
      required: ['Authorization: Bearer <barber_access_token>', 'path.id'],
      successMessage: 'Media berhasil dihapus',
      successData: null,
      errors: [
        barberAuthError,
        {
          status: 404,
          description: 'Media tidak ditemukan atau bukan milik staff.',
          message: 'Media tidak ditemukan atau bukan milik Anda'
        },
        barberServerError
      ]
    })
  }
};
