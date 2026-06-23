import { t } from 'elysia';
import {
  ADMIN_TAGS,
  adminDetail,
  commonMutationErrors
} from '../swagger';

export const adminMediaDocs = {
  upload: {
    type: 'multipart/form-data',
    body: t.Object({
      file: t.File({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        maxSize: '5m',
        description: 'File gambar wajib. Format JPG, PNG, atau WEBP dengan ukuran maksimal 5 MB.'
      }),
      category: t.Optional(t.UnionEnum([
        'promotion',
        'service',
        'portfolio',
        'branch',
        'general'
      ], {
        description: 'Folder kategori penyimpanan. Default general.',
        examples: ['promotion']
      }))
    }, {
      examples: [
        {
          file: '(binary image file)'
        },
        {
          file: '(binary image file)',
          category: 'promotion'
        }
      ]
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.media,
      summary: 'Upload Gambar Konten HQ',
      description: 'Mengoptimasi gambar menjadi WebP quality 80, memvalidasi dimensi, menyimpannya pada bucket Supabase Storage publik khusus konten, mencatat ownership media, dan mengembalikan URL publik.',
      required: ['file', 'Authorization: Bearer <access_token>'],
      optional: ['category'],
      successStatus: 201,
      successMessage: 'Gambar berhasil diupload',
      successData: {
        asset_id: '89898989-8989-4898-8989-898989898989',
        bucket: 'bomb-public-media',
        path: 'promotion/89898989-8989-4898-8989-898989898989.webp',
        visibility: 'public',
        public_url: 'https://project.supabase.co/storage/v1/object/public/bomb-public-media/promotion/89898989-8989-4898-8989-898989898989.webp',
        content_type: 'image/webp',
        size: 184320,
        width: 1080,
        height: 1350,
        category: 'promotion'
      },
      errors: commonMutationErrors
    })
  }
};
