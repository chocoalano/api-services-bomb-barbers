export type ApiEnvelope<T> = {
  success: boolean;
  code: string | null;
  message: string;
  data: T;
  errors: unknown;
  meta: unknown;
};

export type StaffSession = {
  id: string;
  full_name: string;
  email: string;
  roles: string[];
  permissions: string[];
  branch_ids: string[];
  is_global: boolean;
};

export type AdminLoginTokens = {
  accessToken: string;
  refreshToken: string;
  staff: StaffSession;
};

const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export const apiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${configuredBaseUrl}${normalizedPath}`;
};

/* ------------------------------------------------------------------ */
/* Session storage (backoffice)                                        */
/* ------------------------------------------------------------------ */

const ACCESS_TOKEN_KEY = 'bomb.admin.access_token';
const REFRESH_TOKEN_KEY = 'bomb.admin.refresh_token';
const STAFF_KEY = 'bomb.admin.staff';
const LOGIN_PATH = '/backoffice/login';

const hasWindow = typeof window !== 'undefined';

export const getAccessToken = () => (hasWindow ? sessionStorage.getItem(ACCESS_TOKEN_KEY) : null);
export const getRefreshToken = () => (hasWindow ? sessionStorage.getItem(REFRESH_TOKEN_KEY) : null);

export const getStoredStaff = (): StaffSession | null => {
  if (!hasWindow) return null;
  const raw = sessionStorage.getItem(STAFF_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StaffSession;
  } catch {
    return null;
  }
};

export const setSession = (tokens: { accessToken: string; refreshToken: string }, staff?: StaffSession) => {
  if (!hasWindow) return;
  sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  if (staff) sessionStorage.setItem(STAFF_KEY, JSON.stringify(staff));
};

export const clearSession = () => {
  if (!hasWindow) return;
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(STAFF_KEY);
};

export const redirectToLogin = () => {
  if (hasWindow) window.location.assign(LOGIN_PATH);
};

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

// Header default untuk semua panggilan API. `ngrok-skip-browser-warning` membuat
// ngrok melewati halaman interstitial-nya sehingga fetch mendapat JSON, bukan HTML
// peringatan (wajib saat backoffice diakses lewat tunnel ngrok free). Tidak
// berdampak apa pun di luar ngrok.
const BASE_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'ngrok-skip-browser-warning': 'true'
};

export const postJson = async <T>(path: string, payload: unknown) => {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || !envelope.success) {
    throw new Error(envelope.message || 'Request gagal diproses.');
  }

  return envelope;
};

const authedFetch = (path: string, init: RequestInit = {}) => {
  const token = getAccessToken();
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      ...BASE_HEADERS,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    }
  });
};

// Rotasi token diam-diam saat access token kedaluwarsa. Mengembalikan true bila
// berhasil sehingga request bisa diulang sekali.
const tryRefresh = async (): Promise<boolean> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const response = await fetch(apiUrl('/api/v1/admin/auth/refresh'), {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    const envelope = (await response.json()) as ApiEnvelope<AdminLoginTokens>;
    if (!response.ok || !envelope.success) return false;
    setSession(
      { accessToken: envelope.data.accessToken, refreshToken: envelope.data.refreshToken },
      envelope.data.staff
    );
    return true;
  } catch {
    return false;
  }
};

// GET terautentikasi dengan auto-refresh sekali. Bila tetap 401 (sesi mati),
// sesi dibersihkan dan pemanggil diarahkan ke halaman login.
export const authGetJson = async <T>(path: string): Promise<ApiEnvelope<T>> => {
  let response = await authedFetch(path);
  if (response.status === 401 && (await tryRefresh())) {
    response = await authedFetch(path);
  }

  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (response.status === 401) {
    clearSession();
    redirectToLogin();
    throw new Error(envelope?.message || 'Sesi berakhir, silakan masuk kembali.');
  }

  if (!response.ok || !envelope || !envelope.success) {
    throw new Error(envelope?.message || 'Request gagal diproses.');
  }

  return envelope;
};

// Kirim body terautentikasi (POST/PATCH/PUT/DELETE) dengan auto-refresh sekali.
// Bila tetap 401 (sesi mati), sesi dibersihkan dan diarahkan ke login.
export const authSendJson = async <T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  payload?: unknown
): Promise<ApiEnvelope<T>> => {
  const init: RequestInit = {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload)
  };
  let response = await authedFetch(path, init);
  if (response.status === 401 && (await tryRefresh())) {
    response = await authedFetch(path, init);
  }

  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (response.status === 401) {
    clearSession();
    redirectToLogin();
    throw new Error(envelope?.message || 'Sesi berakhir, silakan masuk kembali.');
  }

  if (!response.ok || !envelope || !envelope.success) {
    throw new Error(envelope?.message || 'Request gagal diproses.');
  }

  return envelope;
};

/* ------------------------------------------------------------------ */
/* Auth endpoints                                                      */
/* ------------------------------------------------------------------ */

export const loginAdmin = (email: string, password: string) =>
  postJson<AdminLoginTokens>('/api/v1/admin/auth/login', { email, password });

// Profil + role terkini langsung dari backend (sumber kebenaran RBAC).
export const fetchAdminProfile = async (): Promise<StaffSession> => {
  const envelope = await authGetJson<StaffSession & Record<string, unknown>>('/api/v1/admin/me');
  const data = envelope.data;
  const staff: StaffSession = {
    id: String(data.id),
    full_name: String(data.full_name ?? ''),
    email: String(data.email ?? ''),
    roles: Array.isArray(data.roles) ? (data.roles as string[]) : [],
    permissions: Array.isArray(data.permissions) ? (data.permissions as string[]) : [],
    branch_ids: Array.isArray(data.branch_ids) ? (data.branch_ids as string[]) : [],
    is_global: Boolean(data.is_global)
  };
  // Segarkan cache sesi lokal agar filter navigasi selalu sinkron dengan backend.
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();
  if (accessToken && refreshToken) setSession({ accessToken, refreshToken }, staff);
  return staff;
};

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export type DashboardToday = {
  total_appointments: number;
  booking_count: number;
  walk_in_count: number;
  total_completed: number;
  total_cancelled: number;
  revenue: { total: number; service: number; product: number; tip: number };
  shares: { barber: number; branch: number; hq: number };
};

export type BranchSummaryRow = {
  branch_id: string;
  summary_date: string;
  total_revenue: number;
  total_appointments: number;
  walk_in_count: number;
  booking_count: number;
  no_show_count: number;
  branch_share_total: number;
  hq_share_total: number;
  branches?: { name: string } | { name: string }[] | null;
};

export type AdminBranch = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  region_id: string | null;
};

export type BranchPayload = {
  name: string;
  region_id: string;
  address?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_active?: boolean;
};

const normalizeBranch = (b: AdminBranch & Record<string, unknown>): AdminBranch => ({
  id: String(b.id),
  name: String(b.name ?? '—'),
  address: b.address == null ? null : String(b.address),
  phone: b.phone == null ? null : String(b.phone),
  latitude: b.latitude == null ? null : Number(b.latitude),
  longitude: b.longitude == null ? null : Number(b.longitude),
  is_active: Boolean(b.is_active),
  region_id: b.region_id == null ? null : String(b.region_id)
});

// Daftar cabang yang boleh diakses staff — sudah difilter per peran di backend
// (super_admin: semua; branch_admin: hanya cabangnya). Sumber otoritatif untuk
// menentukan cakupan perhitungan dashboard branch_admin.
export const fetchAdminBranches = () =>
  authGetJson<Array<AdminBranch & Record<string, unknown>>>('/api/v1/admin/branches').then((e) =>
    (e.data ?? []).map(normalizeBranch)
  );

export const createBranch = (payload: BranchPayload) =>
  authSendJson<AdminBranch & Record<string, unknown>>('/api/v1/hq/branches', 'POST', payload).then((e) =>
    normalizeBranch(e.data)
  );

export const updateBranch = (id: string, payload: Partial<BranchPayload>) =>
  authSendJson<AdminBranch & Record<string, unknown>>(`/api/v1/hq/branches/${id}`, 'PUT', payload).then((e) =>
    normalizeBranch(e.data)
  );

export const deleteBranch = (id: string) =>
  authSendJson(`/api/v1/hq/branches/${id}`, 'DELETE').then((e) => e.data);

// Jam operasional cabang per hari (0=Minggu .. 6=Sabtu). Jam dalam format 'HH:MM'.
// Hari libur → is_closed true dan open_time/close_time null.
export type BranchOperatingHour = {
  day_of_week: number;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
};

export const fetchBranchOperatingHours = (id: string) =>
  authGetJson<BranchOperatingHour[]>(`/api/v1/hq/branches/${id}/operating-hours`).then(
    (e) => e.data ?? []
  );

// PUT = replace penuh 7 hari, atomik. Backend menolak jika bukan tepat 7 hari.
export const updateBranchOperatingHours = (id: string, hours: BranchOperatingHour[]) =>
  authSendJson<BranchOperatingHour[]>(
    `/api/v1/hq/branches/${id}/operating-hours`,
    'PUT',
    { operating_hours: hours }
  ).then((e) => e.data ?? []);

// Ringkasan "hari ini" (Asia/Jakarta) — global untuk super_admin, atau per-cabang
// untuk branch_admin. Sumbernya dihitung on-the-fly di backend.
export const fetchHQToday = () =>
  authGetJson<DashboardToday>('/api/v1/hq/dashboard/today').then((e) => e.data);

export const fetchHQBranchSummary = () =>
  authGetJson<BranchSummaryRow[]>('/api/v1/hq/branches/summary').then((e) => e.data);

export const fetchBranchToday = (branchId: string) =>
  authGetJson<DashboardToday>(`/api/v1/admin/branches/${branchId}/dashboard/today`).then((e) => e.data);

export const fetchBranchSummary = (branchId: string) =>
  authGetJson<BranchSummaryRow[]>(`/api/v1/admin/branches/${branchId}/appointments/summary`).then((e) => e.data);

/* ------------------------------------------------------------------ */
/* Appointments (server-side datatable)                                */
/* ------------------------------------------------------------------ */

export type AppointmentRelation<T> = T | T[] | null;

export type AppointmentRow = {
  id: string;
  branch_id: string;
  barber_id: string | null;
  customer_id: string | null;
  source: 'online_booking' | 'walk_in';
  status: 'pending' | 'confirmed' | 'in_queue' | 'in_service' | 'completed' | 'cancelled' | 'no_show';
  approval_status?: string | null;
  scheduled_at: string | null;
  scheduled_end_at: string | null;
  queue_position: number | null;
  checked_in_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancellation_reason: string | null;
  fulfillment_type: 'in_store' | 'home_service' | null;
  service_address: string | null;
  created_at: string;
  updated_at: string;
  branches: AppointmentRelation<{ id: string; name: string }>;
  barbers: AppointmentRelation<{ id: string; display_name: string; live_status: string | null }>;
  customers: AppointmentRelation<{ id: string; full_name: string; phone: string | null; email: string | null }>;
  appointment_services: Array<{
    id: string;
    price_amount: number;
    duration_min: number;
    services: AppointmentRelation<{ id: string; name: string }>;
  }>;
  payments: AppointmentRelation<{
    total_amount: number;
    service_amount: number;
    product_amount: number;
    tip_amount: number;
    discount_amount: number;
    method: string;
    status: string;
    paid_at: string | null;
  }>;
};

export type AppointmentListMeta = {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  has_prev: boolean;
  has_next: boolean;
};

export type AppointmentStats = {
  total: number;
  active: number;
  in_service: number;
  completed: number;
  cancelled: number;
  no_show: number;
  walk_in: number;
  online_booking: number;
  home_service: number;
};

export type AppointmentListParams = {
  page?: number;
  per_page?: number;
  branch_id?: string;
  status?: string[];
  source?: string[];
  fulfillment_type?: string[];
  payment_status?: string[];
  barber_id?: string;
  q?: string;
  date_field?: 'scheduled_at' | 'created_at';
  date_from?: string;
  date_to?: string;
  sort?: string;
  order?: 'asc' | 'desc';
};

const buildQueryString = (params: Record<string, unknown>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
};

export const fetchAdminAppointments = async (
  params: AppointmentListParams
): Promise<{ data: AppointmentRow[]; meta: AppointmentListMeta }> => {
  const envelope = await authGetJson<AppointmentRow[]>(
    `/api/v1/admin/appointments${buildQueryString(params)}`
  );
  const meta = (envelope.meta as AppointmentListMeta | null) ?? {
    total: envelope.data?.length ?? 0,
    page: params.page ?? 1,
    per_page: params.per_page ?? 20,
    total_pages: 1,
    has_prev: false,
    has_next: false
  };
  return { data: envelope.data ?? [], meta };
};

export const fetchAdminAppointmentStats = (
  params: { branch_id?: string; date_field?: string; date_from?: string; date_to?: string } = {}
) =>
  authGetJson<AppointmentStats>(`/api/v1/admin/appointments/stats${buildQueryString(params)}`).then(
    (e) => e.data
  );

// Ubah status appointment (admin). Backend memvalidasi transisi & scope cabang.
export const updateAppointmentStatus = (
  id: string,
  status: string,
  reason?: string
) =>
  authSendJson(`/api/v1/admin/appointments/${id}/status`, 'PATCH', {
    status,
    ...(reason ? { reason } : {})
  }).then((e) => e.data);

// Reassign barber pada appointment aktif. Barber harus di cabang yang sama.
export const reassignAppointmentBarber = (id: string, barberId: string) =>
  authSendJson(`/api/v1/admin/appointments/${id}/barber`, 'PATCH', {
    barber_id: barberId
  }).then((e) => e.data);

export type AdminBarber = { id: string; display_name: string; live_status: string | null };

// Daftar barber pada satu cabang (untuk filter). Hanya bisa diakses jika cabang
// tersebut dalam scope peran staff.
export const fetchBranchBarbers = (branchId: string) =>
  authGetJson<Array<AdminBarber & Record<string, unknown>>>(
    `/api/v1/admin/branches/${branchId}/barbers`
  ).then((e) =>
    (e.data ?? []).map((b) => ({
      id: String(b.id),
      display_name: String(b.display_name ?? '—'),
      live_status: (b.live_status as string | null) ?? null
    }))
  );

/* ------------------------------------------------------------------ */
/* Customers (server-side datatable)                                   */
/* ------------------------------------------------------------------ */

export type CustomerRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  points_balance: number;
  is_active: boolean;
  created_at: string;
  stats: {
    total_appointments: number;
    completed_appointments: number;
    last_visit_at: string | null;
    total_spent: number;
  };
};

export type CustomerStats = {
  total: number;
  active: number;
  inactive: number;
  new_30d: number;
};

export type CustomerListParams = {
  page?: number;
  per_page?: number;
  q?: string;
  status?: 'active' | 'inactive' | '';
  sort?: string;
  order?: 'asc' | 'desc';
};

export const fetchAdminCustomers = async (
  params: CustomerListParams
): Promise<{ data: CustomerRow[]; meta: AppointmentListMeta }> => {
  const envelope = await authGetJson<CustomerRow[]>(
    `/api/v1/admin/customers/list${buildQueryString(params)}`
  );
  const meta = (envelope.meta as AppointmentListMeta | null) ?? {
    total: envelope.data?.length ?? 0,
    page: params.page ?? 1,
    per_page: params.per_page ?? 20,
    total_pages: 1,
    has_prev: false,
    has_next: false
  };
  return { data: envelope.data ?? [], meta };
};

export const fetchAdminCustomerStats = () =>
  authGetJson<CustomerStats>('/api/v1/admin/customers/stats').then((e) => e.data);

/* ------------------------------------------------------------------ */
/* Barbers (server-side datatable)                                     */
/* ------------------------------------------------------------------ */

export type BarberLiveStatus = 'available' | 'serving' | 'on_break' | 'offline';

export type BarberRow = {
  id: string;
  display_name: string;
  live_status: BarberLiveStatus;
  bio: string | null;
  rating_avg: number;
  rating_count: number;
  branch_id: string;
  created_at: string;
  staff: { full_name: string; phone: string | null; email: string | null } | null;
  branches: { id: string; name: string } | null;
  stats: { active_appointments: number; completed_appointments: number };
};

export type BarberStats = {
  total: number;
  available: number;
  serving: number;
  on_break: number;
  offline: number;
  avg_rating: number;
};

export type BarberListParams = {
  page?: number;
  per_page?: number;
  branch_id?: string;
  live_status?: string[];
  q?: string;
  sort?: string;
  order?: 'asc' | 'desc';
};

export const fetchAdminBarbers = async (
  params: BarberListParams
): Promise<{ data: BarberRow[]; meta: AppointmentListMeta }> => {
  const envelope = await authGetJson<BarberRow[]>(
    `/api/v1/admin/barbers${buildQueryString(params)}`
  );
  const meta = (envelope.meta as AppointmentListMeta | null) ?? {
    total: envelope.data?.length ?? 0,
    page: params.page ?? 1,
    per_page: params.per_page ?? 20,
    total_pages: 1,
    has_prev: false,
    has_next: false
  };
  return { data: envelope.data ?? [], meta };
};

export const fetchAdminBarberStats = (params: { branch_id?: string } = {}) =>
  authGetJson<BarberStats>(`/api/v1/admin/barbers/stats${buildQueryString(params)}`).then((e) => e.data);

// Ubah status live barber. Endpoint di-scope per cabang (barber harus di cabang tsb).
export const setBarberStatus = (branchId: string, barberId: string, status: BarberLiveStatus) =>
  authSendJson(`/api/v1/admin/branches/${branchId}/barbers/${barberId}/status`, 'PATCH', {
    status
  }).then((e) => e.data);

export type BarberScheduleItem = {
  id: string;
  status: string;
  source: string;
  scheduled_at: string | null;
  scheduled_end_at: string | null;
  schedule_block_start_at: string | null;
  queue_position: number | null;
  customers: { id: string; full_name: string; phone: string | null } | { id: string; full_name: string; phone: string | null }[] | null;
  appointment_services: Array<{ services: { name: string } | { name: string }[] | null }>;
};

export type BarberSchedule = {
  barber: { id: string; display_name: string; live_status: string };
  date: string;
  appointments: BarberScheduleItem[];
};

// Jadwal harian barber (appointment pada tanggal tertentu). Scoped per cabang.
export const fetchBarberSchedule = (branchId: string, barberId: string, date: string) =>
  authGetJson<BarberSchedule>(
    `/api/v1/admin/branches/${branchId}/barbers/${barberId}/schedule?date=${encodeURIComponent(date)}`
  ).then((e) => e.data);

/* -- Master data barber (HQ / super_admin, permission manage_barber) -- */

export type CreateBarberPayload = {
  full_name: string;
  email: string;
  password: string;
  phone?: string;
  display_name?: string;
  branch_id?: string;
  service_radius_km?: number;
};

export const createBarber = (payload: CreateBarberPayload) =>
  authSendJson('/api/v1/hq/barbers', 'POST', payload).then((e) => e.data);

export type UpdateBarberPayload = {
  display_name?: string;
  bio?: string | null;
  branch_id?: string;
};

export const updateBarber = (id: string, payload: UpdateBarberPayload) =>
  authSendJson(`/api/v1/hq/barbers/${id}`, 'PUT', payload).then((e) => e.data);

export const deleteBarber = (id: string) =>
  authSendJson(`/api/v1/hq/barbers/${id}`, 'DELETE').then((e) => e.data);

/* -- Onboarding barber: pendaftaran menunggu persetujuan (permission manage_barber, per cabang) -- */

type BarberRelStaff = { full_name: string; email: string | null; phone: string | null };
type BarberRelBranch = { id: string; name: string };

export type PendingBarberRow = {
  id: string;
  display_name: string;
  branch_id: string;
  live_status: string;
  approval_status: string;
  bio?: string | null;
  created_at: string;
  staff_users: BarberRelStaff | BarberRelStaff[] | null;
  branches: BarberRelBranch | BarberRelBranch[] | null;
};

// Daftar kepster yang menunggu konfirmasi (approval_status = 'pending'). Di-scope
// per cabang untuk staff non-global oleh backend.
export const fetchPendingBarbers = () =>
  authGetJson<PendingBarberRow[]>('/api/v1/hq/barbers/pending').then((e) => e.data ?? []);

// Setujui / tolak pendaftaran kepster. `reason` opsional (dicatat pada audit log).
export const setBarberApproval = (id: string, action: 'approve' | 'reject', reason?: string) =>
  authSendJson(`/api/v1/hq/barbers/${id}/approval`, 'PATCH', {
    action,
    ...(reason ? { reason } : {})
  }).then((e) => e.data);

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export type PaymentInvoiceRelation =
  | { invoice_number: string | null; pdf_url?: string | null }
  | Array<{ invoice_number: string | null; pdf_url?: string | null }>
  | null;

export type AdminPaymentRow = {
  id: string;
  appointment_id: string | null;
  branch_id: string;
  method: string | null;
  provider: string | null;
  status: string;
  total_amount: number;
  service_amount: number;
  product_amount: number;
  discount_amount: number;
  tip_amount: number;
  service_fee: number;
  delivery_fee: number;
  gateway_reference: string | null;
  paid_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  invoices: PaymentInvoiceRelation;
};

export type AdminPaymentDetail = AdminPaymentRow & {
  appointments?: {
    id: string;
    branch_id: string | null;
    barber_id: string | null;
    customer_id: string | null;
    source: string | null;
    status: string | null;
    scheduled_at?: string | null;
    created_at?: string | null;
  } | null;
};

const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePayment = (
  row: AdminPaymentRow & Record<string, unknown>,
  branchId: string
): AdminPaymentRow => ({
  id: String(row.id),
  appointment_id: row.appointment_id == null ? null : String(row.appointment_id),
  branch_id: row.branch_id == null ? branchId : String(row.branch_id),
  method: row.method == null ? null : String(row.method),
  provider: row.provider == null ? null : String(row.provider),
  status: String(row.status ?? 'unknown'),
  total_amount: asNumber(row.total_amount),
  service_amount: asNumber(row.service_amount),
  product_amount: asNumber(row.product_amount),
  discount_amount: asNumber(row.discount_amount),
  tip_amount: asNumber(row.tip_amount),
  service_fee: asNumber(row.service_fee),
  delivery_fee: asNumber(row.delivery_fee),
  gateway_reference: row.gateway_reference == null ? null : String(row.gateway_reference),
  paid_at: row.paid_at == null ? null : String(row.paid_at),
  created_at: row.created_at == null ? null : String(row.created_at),
  updated_at: row.updated_at == null ? null : String(row.updated_at),
  invoices: (row.invoices as PaymentInvoiceRelation | undefined) ?? null
});

export const fetchBranchPayments = (branchId: string) =>
  authGetJson<Array<AdminPaymentRow & Record<string, unknown>>>(
    `/api/v1/admin/branches/${branchId}/payments`
  ).then((e) => (e.data ?? []).map((payment) => normalizePayment(payment, branchId)));

export const fetchAdminPaymentDetail = (id: string) =>
  authGetJson<AdminPaymentDetail & Record<string, unknown>>(`/api/v1/admin/payments/${id}`).then((e) => {
    const row = e.data;
    return {
      ...normalizePayment(row, String(row.branch_id ?? '')),
      appointments: (row.appointments as AdminPaymentDetail['appointments'] | undefined) ?? null
    };
  });

/* ------------------------------------------------------------------ */
/* Staff users & RBAC                                                  */
/* ------------------------------------------------------------------ */

type Relation<T> = T | T[] | null | undefined;

const unwrapRelation = <T,>(relation: Relation<T>): T | null => {
  if (relation == null) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
};

export type AdminRole = {
  id: string;
  name: string;
  created_at: string | null;
};

export type AdminPermission = {
  id: string;
  code: string;
  created_at: string | null;
};

export type StaffRoleAssignment = {
  id: string | null;
  branch_id: string | null;
  role: AdminRole | null;
  branch: { id: string; name: string } | null;
};

export type StaffUserRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  created_at: string | null;
  staff_user_roles: StaffRoleAssignment[];
};

const normalizeRole = (role: AdminRole & Record<string, unknown>): AdminRole => ({
  id: String(role.id),
  name: String(role.name ?? '—'),
  created_at: role.created_at == null ? null : String(role.created_at)
});

const normalizePermission = (permission: AdminPermission & Record<string, unknown>): AdminPermission => ({
  id: String(permission.id),
  code: String(permission.code ?? '—'),
  created_at: permission.created_at == null ? null : String(permission.created_at)
});

const normalizeStaffRoleAssignment = (row: Record<string, unknown>): StaffRoleAssignment => {
  const role = unwrapRelation(row.roles as Relation<AdminRole & Record<string, unknown>>);
  const branch = unwrapRelation(row.branches as Relation<{ id: string; name: string } & Record<string, unknown>>);
  return {
    id: row.id == null ? null : String(row.id),
    branch_id: row.branch_id == null ? null : String(row.branch_id),
    role: role ? normalizeRole(role) : null,
    branch: branch ? { id: String(branch.id), name: String(branch.name ?? '—') } : null
  };
};

const normalizeStaffUser = (row: StaffUserRow & Record<string, unknown>): StaffUserRow => ({
  id: String(row.id),
  full_name: String(row.full_name ?? '—'),
  email: String(row.email ?? ''),
  phone: row.phone == null ? null : String(row.phone),
  is_active: Boolean(row.is_active),
  created_at: row.created_at == null ? null : String(row.created_at),
  staff_user_roles: Array.isArray(row.staff_user_roles)
    ? (row.staff_user_roles as Array<Record<string, unknown>>).map(normalizeStaffRoleAssignment)
    : []
});

export const fetchStaffUsers = () =>
  authGetJson<Array<StaffUserRow & Record<string, unknown>>>('/api/v1/hq/staff-users').then((e) =>
    (e.data ?? []).map(normalizeStaffUser)
  );

export const fetchRoles = () =>
  authGetJson<Array<AdminRole & Record<string, unknown>>>('/api/v1/hq/roles').then((e) =>
    (e.data ?? []).map(normalizeRole)
  );

export const createRole = (name: string) =>
  authSendJson<AdminRole & Record<string, unknown>>('/api/v1/hq/roles', 'POST', { name }).then((e) =>
    normalizeRole(e.data)
  );

export const fetchPermissions = () =>
  authGetJson<Array<AdminPermission & Record<string, unknown>>>('/api/v1/hq/permissions').then((e) =>
    (e.data ?? []).map(normalizePermission)
  );

export const fetchStaffRoles = (staffUserId: string) =>
  authGetJson<Array<Record<string, unknown>>>(`/api/v1/hq/staff-users/${staffUserId}/roles`).then((e) =>
    (e.data ?? []).map(normalizeStaffRoleAssignment)
  );

export const assignStaffRole = (
  staffUserId: string,
  payload: { role_id: string; branch_id?: string | null }
) =>
  authSendJson(`/api/v1/hq/staff-users/${staffUserId}/roles`, 'POST', {
    role_id: payload.role_id,
    ...(payload.branch_id ? { branch_id: payload.branch_id } : {})
  }).then((e) => e.data);

export const revokeStaffRole = (staffUserId: string, roleId: string) =>
  authSendJson(`/api/v1/hq/staff-users/${staffUserId}/roles/${roleId}`, 'DELETE').then((e) => e.data);

export const logoutAdmin = async () => {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    try {
      await authedFetch('/api/v1/admin/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken })
      });
    } catch {
      // Best-effort: apa pun hasilnya sesi lokal tetap dibersihkan.
    }
  }
  clearSession();
};
