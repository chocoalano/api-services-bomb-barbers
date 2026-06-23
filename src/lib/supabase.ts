import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  // Fail-fast: jangan boot tanpa kredensial database.
  throw new Error(
    'SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY (atau SUPABASE_SECRET_KEY) wajib di-set.'
  );
}

// Client ini menggunakan Service Role Key, sehingga mem-bypass RLS.
// Digunakan murni untuk urusan backend (seperti storage, auth server-side, dll).
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
