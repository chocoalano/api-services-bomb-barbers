Kamu adalah senior backend engineer.

Bangun backend REST API untuk sistem operasional jaringan barbershop multi-cabang bernama "Bomb Barbershop".

Tech stack final:
- Runtime: Bun
- Framework: ElysiaJS
- Language: TypeScript
- Database: Supabase PostgreSQL
- Query Builder: @supabase/supabase-js (Native Supabase SDK)
- Realtime/cache: Redis
- Auth: JWT access token + refresh token
- Validation: TypeBox/Elysia validator
- API version: /api/v1

Prinsip wajib:
1. Gunakan satu tabel `appointments` untuk booking online dan walk-in.
2. Bedakan sumber appointment dengan kolom `source`: `online_booking` atau `walk_in`.
3. Semua nominal uang pakai BIGINT dalam satuan rupiah penuh.
4. Semua primary key pakai UUID.
5. Semua waktu pakai timestamptz.
6. Entitas master memakai soft delete `deleted_at`.
7. RBAC wajib mendukung scope cabang.
8. Super Admin akses global, Admin Cabang dan Barber hanya boleh akses cabangnya.
9. Data realtime seperti status live barber, GPS customer, dan ETA berjalan disimpan di Redis, bukan Postgres.
10. Semua mutasi finansial wajib dicatat ke `audit_logs`.
11. Pisahkan `customers` dan `staff_users`.
12. **Arsitektur Modul**: Setiap modul WAJIB mematuhi arsitektur pemisahan 4 file di dalam direktorinya (misal `src/modules/namamodul/`):
    - `service.ts`: Tempat interaksi database murni (Supabase SDK) dan *business logic*. Tidak boleh memuat hal terkait HTTP/Elysia.
    - `controller.ts`: Tempat mengambil parameter/body dari *request*, memanggil `service.ts`, dan memformat respons menggunakan standar *envelope* (`createSuccessResponse` & `createErrorResponse`).
    - `docs.ts`: Tempat mendeklarasikan skema validasi (*TypeBox*) dan rincian metadata *Swagger* (`tags`, `summary`, `description`). Semua deskripsi dokumentasi WAJIB ditulis menggunakan bahasa Indonesia yang ramah pembaca, jelas, dan sangat komprehensif.
    - `routes.ts`: Tempat mendaftarkan *path endpoint* (seperti `.post()`, `.get()`), mengikatnya dengan *controller* dan *docs*, serta mendaftarkan *middleware*. Tidak boleh ada logika bisnis/database di file ini.

Jangan langsung membuat semua fitur sekaligus. Kerjakan bertahap sesuai prompt berikut.
Setiap tahap harus menghasilkan kode production-ready, migration, service layer, validation, error handling, dan catatan testing.
