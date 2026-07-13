import { validateEnv } from './lib/env-validation';

// Dijalankan sebagai efek samping saat di-import PALING AWAL (sebelum modul lain
// dievaluasi), sehingga validasi environment/secret berjalan sebelum apa pun
// yang bergantung padanya. (B6/MB3)
validateEnv();
