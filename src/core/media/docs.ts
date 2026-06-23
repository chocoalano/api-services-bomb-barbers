import { t } from 'elysia';

export const mediaDocs = {
  upload: {
    type: 'multipart/form-data',
    body: t.Object({
      file: t.File({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        maxSize: '5m',
        description: 'File gambar referensi pelanggan. Format yang diterima adalah JPG, PNG, atau WEBP dengan ukuran maksimal 5MB.'
      }),
      purpose: t.Optional(t.UnionEnum([
        'face_reference',
        'hair_style_reference',
        'appointment_reference',
        'general'
      ], {
        description: 'Tujuan upload gambar. Gunakan face_reference untuk detail wajah, hair_style_reference untuk gaya rambut, appointment_reference untuk lampiran booking umum, atau general untuk kebutuhan lain yang masih terkait pemesanan.'
      }))
    }),
    detail: {
      tags: ['Media'],
      summary: 'Upload Foto Referensi',
      description: 'Digunakan pelanggan atau staff untuk mengunggah foto referensi sebelum membuat pemesanan (contoh gaya rambut, detail wajah). Gambar dioptimasi ke WebP (quality 80) dan disimpan secara lokal. URL publik yang dikembalikan dapat dikirim pada payload booking melalui field media_urls, atau pada endpoint ulasan melalui field photo_url. Admin HQ untuk gambar konten (promo/layanan/cabang) menggunakan POST /api/v1/hq/media/upload.'
    }
  }
};
