<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UCard from '@nuxt/ui/components/Card.vue';
import UCheckbox from '@nuxt/ui/components/Checkbox.vue';
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import UPopover from '@nuxt/ui/components/Popover.vue';
import USelect from '@nuxt/ui/components/Select.vue';
import USeparator from '@nuxt/ui/components/Separator.vue';
import USlideover from '@nuxt/ui/components/Slideover.vue';
import UTextarea from '@nuxt/ui/components/Textarea.vue';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import AppLayout from '../../layouts/AppLayout.vue';
import {
  fetchAdminAppointments,
  fetchAdminAppointmentStats,
  fetchAdminBranches,
  fetchBranchBarbers,
  getStoredStaff,
  reassignAppointmentBarber,
  updateAppointmentStatus,
  type AdminBarber,
  type AdminBranch,
  type AppointmentListMeta,
  type AppointmentRow,
  type AppointmentStats
} from '../../lib/api';

/* ------------------------------------------------------------------ */
/* Role & scope                                                        */
/* ------------------------------------------------------------------ */
const staff = getStoredStaff();
const isSuperAdmin = computed(
  () => Boolean(staff?.is_global) || (staff?.roles ?? []).includes('super_admin')
);

/* ------------------------------------------------------------------ */
/* Formatters & relation helpers                                       */
/* ------------------------------------------------------------------ */
const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
});
const formatRupiah = (value: number) => rupiah.format(Number.isFinite(value) ? value : 0);

const dateTimeFmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});
const formatDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
};

const unwrap = <T,>(rel: T | T[] | null | undefined): T | null => {
  if (rel == null) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
};

const customerName = (row: AppointmentRow) => unwrap(row.customers)?.full_name ?? 'Tamu';
const customerPhone = (row: AppointmentRow) => unwrap(row.customers)?.phone ?? '—';
const branchName = (row: AppointmentRow) => unwrap(row.branches)?.name ?? '—';
const barberName = (row: AppointmentRow) => unwrap(row.barbers)?.display_name ?? 'Belum ditugaskan';

const serviceNames = (row: AppointmentRow) => {
  const names = (row.appointment_services ?? [])
    .map((s) => unwrap(s.services)?.name)
    .filter((n): n is string => Boolean(n));
  return names.length ? names.join(', ') : '—';
};
const totalDuration = (row: AppointmentRow) =>
  (row.appointment_services ?? []).reduce((sum, s) => sum + (s.duration_min || 0), 0);
const payment = (row: AppointmentRow) => unwrap(row.payments);
const paymentTotal = (row: AppointmentRow) => payment(row)?.total_amount ?? 0;

/* ------------------------------------------------------------------ */
/* Enum metadata (label + warna badge Nuxt UI)                         */
/* ------------------------------------------------------------------ */
type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

const STATUS_META: Record<string, { label: string; color: BadgeColor }> = {
  pending: { label: 'Pending', color: 'warning' },
  confirmed: { label: 'Terkonfirmasi', color: 'info' },
  in_queue: { label: 'Antre', color: 'neutral' },
  in_service: { label: 'Dilayani', color: 'primary' },
  completed: { label: 'Selesai', color: 'success' },
  cancelled: { label: 'Batal', color: 'error' },
  no_show: { label: 'No-show', color: 'error' }
};
const SOURCE_META: Record<string, { label: string; color: BadgeColor }> = {
  online_booking: { label: 'Online', color: 'info' },
  walk_in: { label: 'Walk-in', color: 'neutral' }
};
const FULFILLMENT_META: Record<string, { label: string; color: BadgeColor }> = {
  in_store: { label: 'Di tempat', color: 'neutral' },
  home_service: { label: 'Home service', color: 'secondary' }
};
const PAYMENT_META: Record<string, { label: string; color: BadgeColor }> = {
  pending: { label: 'Belum bayar', color: 'warning' },
  paid: { label: 'Lunas', color: 'success' },
  failed: { label: 'Gagal', color: 'error' },
  expired: { label: 'Kedaluwarsa', color: 'error' },
  refunded: { label: 'Refund', color: 'neutral' },
  partially_refunded: { label: 'Refund sebagian', color: 'warning' }
};
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  card: 'Kartu',
  bank_transfer: 'Transfer',
  ewallet: 'E-wallet'
};

const statusMeta = (s: string) => STATUS_META[s] ?? { label: s, color: 'neutral' as BadgeColor };
const paymentMeta = (row: AppointmentRow) => {
  const p = payment(row);
  if (!p) return { label: 'Belum ada', color: 'neutral' as BadgeColor };
  return PAYMENT_META[p.status] ?? { label: p.status, color: 'neutral' as BadgeColor };
};

/* ------------------------------------------------------------------ */
/* Filter options                                                      */
/* ------------------------------------------------------------------ */
const STATUS_OPTIONS = Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }));
const SOURCE_OPTIONS = Object.entries(SOURCE_META).map(([value, m]) => ({ value, label: m.label }));
const FULFILLMENT_OPTIONS = Object.entries(FULFILLMENT_META).map(([value, m]) => ({ value, label: m.label }));
const PAYMENT_OPTIONS = Object.entries(PAYMENT_META).map(([value, m]) => ({ value, label: m.label }));

const SORT_OPTIONS = [
  { value: 'scheduled_at', label: 'Jadwal' },
  { value: 'created_at', label: 'Dibuat' },
  { value: 'status', label: 'Status' },
  { value: 'queue_position', label: 'Antrean' },
  { value: 'completed_at', label: 'Selesai' }
];
const PER_PAGE_OPTIONS = [10, 20, 50, 100].map((n) => ({ value: n, label: `${n} / halaman` }));
const DATE_FIELD_OPTIONS = [
  { value: 'scheduled_at', label: 'Jadwal' },
  { value: 'created_at', label: 'Dibuat' }
];

/* ------------------------------------------------------------------ */
/* Reactive state                                                      */
/* ------------------------------------------------------------------ */
// Sentinel "semua" — Reka UI (Nuxt UI Select) melarang value string kosong,
// jadi opsi "tanpa filter" memakai nilai eksplisit ini lalu dipetakan ke undefined.
const ALL = 'all';

// Prefill pencarian dari query URL (mis. navigasi "Lihat appointment" dari halaman Customer).
const initialQuery =
  typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('q') ?? '';

const filters = reactive({
  q: initialQuery,
  status: [] as string[],
  source: [] as string[],
  fulfillment_type: [] as string[],
  payment_status: [] as string[],
  branch_id: ALL,
  barber_id: ALL,
  date_field: 'scheduled_at' as 'scheduled_at' | 'created_at',
  date_from: '',
  date_to: ''
});
const sort = reactive({ column: 'scheduled_at', order: 'desc' as 'asc' | 'desc' });
const page = ref(1);
const perPage = ref(20);

const rows = ref<AppointmentRow[]>([]);
const meta = ref<AppointmentListMeta | null>(null);
const stats = ref<AppointmentStats | null>(null);
const loading = ref(true);
const error = ref('');

const branchOptions = ref<AdminBranch[]>([]);
const barberOptions = ref<AdminBarber[]>([]);

const branchSelectItems = computed(() => [
  { value: ALL, label: 'Semua cabang' },
  ...branchOptions.value.map((b) => ({ value: b.id, label: b.name }))
]);
const barberSelectItems = computed(() => [
  { value: ALL, label: 'Semua barber' },
  ...barberOptions.value.map((b) => ({ value: b.id, label: b.display_name }))
]);

/* ------------------------------------------------------------------ */
/* Column visibility (data join lintas tabel yang lengkap)             */
/* ------------------------------------------------------------------ */
type ColumnKey =
  | 'schedule' | 'customer' | 'phone' | 'service' | 'duration' | 'branch' | 'barber'
  | 'source' | 'fulfillment' | 'status' | 'queue' | 'payment' | 'method' | 'total' | 'created';

type Column = { key: ColumnKey; label: string; always?: boolean };
const ALL_COLUMNS: Column[] = [
  { key: 'schedule', label: 'Jadwal' },
  { key: 'customer', label: 'Customer', always: true },
  { key: 'phone', label: 'Telepon' },
  { key: 'service', label: 'Layanan' },
  { key: 'duration', label: 'Durasi' },
  { key: 'branch', label: 'Cabang' },
  { key: 'barber', label: 'Barber' },
  { key: 'source', label: 'Sumber' },
  { key: 'fulfillment', label: 'Jenis' },
  { key: 'status', label: 'Status' },
  { key: 'queue', label: 'Antrean' },
  { key: 'payment', label: 'Pembayaran' },
  { key: 'method', label: 'Metode' },
  { key: 'total', label: 'Total' },
  { key: 'created', label: 'Dibuat' }
];
const DEFAULT_HIDDEN: ColumnKey[] = ['phone', 'duration', 'queue', 'method', 'created'];
const visibleCols = reactive<Record<ColumnKey, boolean>>(
  Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, !DEFAULT_HIDDEN.includes(c.key)])) as Record<ColumnKey, boolean>
);
const isVisible = (key: ColumnKey) => visibleCols[key];
// +1 untuk kolom "Aksi" yang selalu tampil.
const visibleColumnCount = computed(() => ALL_COLUMNS.filter((c) => visibleCols[c.key]).length + 1);
const toggleColumn = (key: ColumnKey) => {
  const col = ALL_COLUMNS.find((c) => c.key === key);
  if (col?.always) return;
  visibleCols[key] = !visibleCols[key];
};

/* ------------------------------------------------------------------ */
/* Metric cards (dari endpoint stats, role-scoped)                     */
/* ------------------------------------------------------------------ */
const metricCards = computed(() => {
  const s = stats.value;
  return [
    { label: 'Terjadwal / aktif', value: s?.active ?? 0, icon: 'i-lucide-calendar-days', tone: 'primary' as BadgeColor },
    { label: 'Sedang dilayani', value: s?.in_service ?? 0, icon: 'i-lucide-scissors', tone: 'info' as BadgeColor },
    { label: 'Walk-in', value: s?.walk_in ?? 0, icon: 'i-lucide-footprints', tone: 'neutral' as BadgeColor },
    { label: 'Selesai', value: s?.completed ?? 0, icon: 'i-lucide-check-check', tone: 'success' as BadgeColor },
    { label: 'Batal / no-show', value: (s?.cancelled ?? 0) + (s?.no_show ?? 0), icon: 'i-lucide-calendar-x', tone: 'error' as BadgeColor }
  ];
});

const activeFilterCount = computed(() =>
  filters.status.length +
  filters.source.length +
  filters.fulfillment_type.length +
  filters.payment_status.length +
  (filters.branch_id !== ALL ? 1 : 0) +
  (filters.barber_id !== ALL ? 1 : 0) +
  (filters.date_from ? 1 : 0) +
  (filters.date_to ? 1 : 0) +
  (filters.q ? 1 : 0)
);

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */
const branchParam = () => (filters.branch_id !== ALL ? filters.branch_id : undefined);
const barberParam = () => (filters.barber_id !== ALL ? filters.barber_id : undefined);

const buildParams = () => ({
  page: page.value,
  per_page: perPage.value,
  branch_id: branchParam(),
  status: filters.status,
  source: filters.source,
  fulfillment_type: filters.fulfillment_type,
  payment_status: filters.payment_status,
  barber_id: barberParam(),
  q: filters.q.trim() || undefined,
  date_field: filters.date_field,
  date_from: filters.date_from || undefined,
  date_to: filters.date_to || undefined,
  sort: sort.column,
  order: sort.order
});

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    const [list, statData] = await Promise.all([
      fetchAdminAppointments(buildParams()),
      fetchAdminAppointmentStats({
        branch_id: branchParam(),
        date_field: filters.date_field,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined
      })
    ]);
    rows.value = list.data;
    meta.value = list.meta;
    stats.value = statData;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Gagal memuat data appointment.';
    rows.value = [];
  } finally {
    loading.value = false;
  }
};

// Reload dengan reset ke halaman 1 (perubahan filter/sort).
let searchTimer: ReturnType<typeof setTimeout> | undefined;
const reloadFromFilters = () => {
  page.value = 1;
  load();
};

const onPageChange = (next: number) => {
  if (next < 1 || (meta.value && next > meta.value.total_pages)) return;
  page.value = next;
  load();
};

const resetFilters = () => {
  filters.q = '';
  filters.status = [];
  filters.source = [];
  filters.fulfillment_type = [];
  filters.payment_status = [];
  filters.branch_id = ALL;
  filters.barber_id = ALL;
  filters.date_field = 'scheduled_at';
  filters.date_from = '';
  filters.date_to = '';
  reloadFromFilters();
};

// Toggle helper untuk filter multi-nilai (checkbox di dalam popover).
const toggleFilterValue = (key: 'status' | 'source' | 'fulfillment_type' | 'payment_status', value: string) => {
  const arr = filters[key];
  const idx = arr.indexOf(value);
  if (idx === -1) arr.push(value);
  else arr.splice(idx, 1);
};

/* ------------------------------------------------------------------ */
/* Aksi baris (transisi status, reassign barber, detail)               */
/* ------------------------------------------------------------------ */
const TERMINAL_STATUSES = ['completed', 'cancelled', 'no_show'];

type StatusAction = { to: string; label: string; icon: string; destructive?: boolean };
// Transisi status yang valid & masuk akal per status saat ini (selaras dgn backend).
// Sesuai persis dengan RPC transition_appointment_status_atomic (state machine backend).
const CANCEL_ACTION: StatusAction = { to: 'cancelled', label: 'Batalkan', icon: 'i-lucide-ban', destructive: true };
const NO_SHOW_ACTION: StatusAction = { to: 'no_show', label: 'Tandai tidak hadir', icon: 'i-lucide-user-x', destructive: true };
const STATUS_TRANSITIONS: Record<string, StatusAction[]> = {
  pending: [
    { to: 'confirmed', label: 'Konfirmasi', icon: 'i-lucide-check' },
    CANCEL_ACTION,
    NO_SHOW_ACTION
  ],
  confirmed: [
    { to: 'in_queue', label: 'Masukkan antrean', icon: 'i-lucide-list-checks' },
    { to: 'in_service', label: 'Mulai layani', icon: 'i-lucide-play' },
    CANCEL_ACTION,
    NO_SHOW_ACTION
  ],
  in_queue: [
    { to: 'in_service', label: 'Mulai layani', icon: 'i-lucide-play' },
    CANCEL_ACTION,
    NO_SHOW_ACTION
  ],
  in_service: [
    { to: 'completed', label: 'Selesaikan', icon: 'i-lucide-circle-check' }
  ],
  completed: [],
  cancelled: [],
  no_show: []
};

// Umpan balik inline (tidak memakai toast agar bebas dari konteks inject slot).
const actionMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);
let messageTimer: ReturnType<typeof setTimeout> | undefined;
const flash = (type: 'success' | 'error', text: string) => {
  actionMessage.value = { type, text };
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (actionMessage.value = null), 4000);
};

const busyId = ref<string | null>(null);

// Detail (slideover)
const detailOpen = ref(false);
const detailRow = ref<AppointmentRow | null>(null);
const openDetail = (row: AppointmentRow) => {
  detailRow.value = row;
  detailOpen.value = true;
};

// Konfirmasi transisi destruktif (batal / no-show) dengan alasan opsional.
const statusModalOpen = ref(false);
const statusTarget = ref<{ row: AppointmentRow; action: StatusAction } | null>(null);
const statusReason = ref('');
const openStatusConfirm = (row: AppointmentRow, action: StatusAction) => {
  statusTarget.value = { row, action };
  statusReason.value = '';
  statusModalOpen.value = true;
};

const applyStatus = async (row: AppointmentRow, to: string, reason?: string) => {
  busyId.value = row.id;
  try {
    await updateAppointmentStatus(row.id, to, reason);
    flash('success', `Status ${customerName(row)} diubah menjadi "${statusMeta(to).label}".`);
    await load();
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal mengubah status.');
  } finally {
    busyId.value = null;
  }
};

const confirmStatusModal = async () => {
  if (!statusTarget.value) return;
  const { row, action } = statusTarget.value;
  statusModalOpen.value = false;
  await applyStatus(row, action.to, statusReason.value.trim() || undefined);
};

// Reassign barber (modal)
const reassignOpen = ref(false);
const reassignRow = ref<AppointmentRow | null>(null);
const reassignBarbers = ref<AdminBarber[]>([]);
const reassignBarberId = ref('');
const reassignBusy = ref(false);
const reassignItems = computed(() =>
  reassignBarbers.value.map((b) => ({ value: b.id, label: b.display_name }))
);
const openReassign = async (row: AppointmentRow) => {
  reassignRow.value = row;
  reassignBarberId.value = row.barber_id ?? '';
  reassignBarbers.value = [];
  reassignOpen.value = true;
  try {
    reassignBarbers.value = await fetchBranchBarbers(row.branch_id);
  } catch {
    reassignBarbers.value = [];
  }
};
const confirmReassign = async () => {
  const row = reassignRow.value;
  if (!row || !reassignBarberId.value || reassignBarberId.value === row.barber_id) {
    reassignOpen.value = false;
    return;
  }
  reassignBusy.value = true;
  try {
    await reassignAppointmentBarber(row.id, reassignBarberId.value);
    flash('success', `Barber untuk ${customerName(row)} berhasil diganti.`);
    reassignOpen.value = false;
    await load();
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal reassign barber.');
  } finally {
    reassignBusy.value = false;
  }
};

// Menyusun item menu aksi per baris (dikelompokkan → dipisah garis).
const rowMenuItems = (row: AppointmentRow) => {
  const groups: any[] = [[{ label: 'Lihat detail', icon: 'i-lucide-eye', onSelect: () => openDetail(row) }]];

  const transitions = STATUS_TRANSITIONS[row.status] ?? [];
  if (transitions.length) {
    groups.push(
      transitions.map((action) => ({
        label: action.label,
        icon: action.icon,
        color: action.destructive ? 'error' : undefined,
        onSelect: () =>
          action.destructive ? openStatusConfirm(row, action) : applyStatus(row, action.to)
      }))
    );
  }

  if (!TERMINAL_STATUSES.includes(row.status)) {
    groups.push([{ label: 'Reassign barber', icon: 'i-lucide-user-round-cog', onSelect: () => openReassign(row) }]);
  }

  return groups;
};

/* ------------------------------------------------------------------ */
/* Watchers                                                            */
/* ------------------------------------------------------------------ */
// Pencarian teks di-debounce agar tidak membanjiri backend.
watch(() => filters.q, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(reloadFromFilters, 350);
});

// Filter lain langsung memuat ulang (reset ke halaman 1).
watch(
  () => [
    filters.status.slice(), filters.source.slice(), filters.fulfillment_type.slice(),
    filters.payment_status.slice(), filters.branch_id, filters.barber_id,
    filters.date_field, filters.date_from, filters.date_to,
    sort.column, sort.order, perPage.value
  ],
  reloadFromFilters
);

// Barber difilter per cabang: dropdown barber hanya aktif saat satu cabang dipilih.
watch(() => filters.branch_id, async (branchId) => {
  filters.barber_id = ALL;
  barberOptions.value = [];
  if (branchId === ALL) return;
  try {
    barberOptions.value = await fetchBranchBarbers(branchId);
  } catch {
    barberOptions.value = [];
  }
});

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */
onMounted(async () => {
  try {
    branchOptions.value = await fetchAdminBranches();
  } catch {
    branchOptions.value = [];
  }
  await load();
});

const rangeLabel = computed(() => {
  const m = meta.value;
  if (!m || m.total === 0) return '0 data';
  const start = (m.page - 1) * m.per_page + 1;
  const end = Math.min(m.page * m.per_page, m.total);
  return `${start}–${end} dari ${m.total}`;
});
</script>

<template>
  <Head title="Appointment" />

  <AppLayout title="Appointment" eyebrow="Operasional">
    <!-- Konteks scope peran -->
    <p class="mb-4 text-xs text-zinc-500">
      <span v-if="isSuperAdmin">Menampilkan seluruh cabang (super admin).</span>
      <span v-else>Menampilkan cabang yang menjadi tanggung jawab Anda.</span>
      Zona waktu Asia/Jakarta.
    </p>

    <div
      v-if="error"
      class="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </div>

    <!-- Umpan balik aksi baris -->
    <div
      v-if="actionMessage"
      class="mb-4 rounded-md border px-4 py-3 text-sm"
      :class="actionMessage.type === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-red-200 bg-red-50 text-red-700'"
    >
      {{ actionMessage.text }}
    </div>

    <!-- Kartu metrik (role-scoped, default hari ini) -->
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <UCard v-for="metric in metricCards" :key="metric.label" :ui="{ root: 'rounded-md' }">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm text-zinc-500">{{ metric.label }}</p>
            <p v-if="loading && !stats" class="mt-2 h-7 w-12 animate-pulse rounded bg-zinc-200" />
            <p v-else class="mt-2 text-2xl font-semibold text-zinc-950">{{ metric.value }}</p>
          </div>
          <UBadge :color="metric.tone" variant="subtle" class="size-9 justify-center rounded-md p-0">
            <AppIcon :name="metric.icon" class="size-5" />
          </UBadge>
        </div>
      </UCard>
    </div>

    <!-- Tabel + filter -->
    <section class="mt-5 rounded-md border border-zinc-200 bg-white">
      <!-- Toolbar filter -->
      <div class="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3">
        <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 class="text-sm font-semibold text-zinc-950">Daftar Appointment</h2>
            <p class="text-xs text-zinc-500">{{ rangeLabel }} · join customer, barber, cabang, layanan &amp; pembayaran</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UInput
              v-model="filters.q"
              icon="i-lucide-search"
              placeholder="Cari customer, telepon, email"
              class="w-full sm:w-64"
            />
            <UButton
              v-if="activeFilterCount > 0"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              @click="resetFilters"
            >
              Reset ({{ activeFilterCount }})
            </UButton>
            <UButton
              color="neutral"
              variant="soft"
              icon="i-lucide-refresh-cw"
              :loading="loading"
              @click="load"
            >
              Refresh
            </UButton>
          </div>
        </div>

        <!-- Baris kontrol filter -->
        <div class="flex flex-wrap items-center gap-2">
          <!-- Cabang (super admin memilih; branch admin memilih di antara cabangnya) -->
          <USelect
            v-model="filters.branch_id"
            :items="branchSelectItems"
            value-key="value"
            label-key="label"
            class="w-44"
            icon="i-lucide-store"
          />
          <!-- Barber (aktif saat satu cabang dipilih) -->
          <USelect
            v-model="filters.barber_id"
            :items="barberSelectItems"
            value-key="value"
            label-key="label"
            :disabled="filters.branch_id === ALL"
            class="w-44"
            icon="i-lucide-user"
          />

          <!-- Status (multi) -->
          <UPopover>
            <UButton color="neutral" variant="outline" icon="i-lucide-activity" trailing-icon="i-lucide-chevron-down">
              Status<span v-if="filters.status.length"> · {{ filters.status.length }}</span>
            </UButton>
            <template #content>
              <div class="w-52 space-y-2 p-3">
                <label
                  v-for="opt in STATUS_OPTIONS"
                  :key="opt.value"
                  class="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <UCheckbox
                    :model-value="filters.status.includes(opt.value)"
                    @update:model-value="toggleFilterValue('status', opt.value)"
                  />
                  {{ opt.label }}
                </label>
              </div>
            </template>
          </UPopover>

          <!-- Sumber (multi) -->
          <UPopover>
            <UButton color="neutral" variant="outline" icon="i-lucide-globe" trailing-icon="i-lucide-chevron-down">
              Sumber<span v-if="filters.source.length"> · {{ filters.source.length }}</span>
            </UButton>
            <template #content>
              <div class="w-44 space-y-2 p-3">
                <label
                  v-for="opt in SOURCE_OPTIONS"
                  :key="opt.value"
                  class="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <UCheckbox
                    :model-value="filters.source.includes(opt.value)"
                    @update:model-value="toggleFilterValue('source', opt.value)"
                  />
                  {{ opt.label }}
                </label>
              </div>
            </template>
          </UPopover>

          <!-- Jenis layanan (multi) -->
          <UPopover>
            <UButton color="neutral" variant="outline" icon="i-lucide-map-pin" trailing-icon="i-lucide-chevron-down">
              Jenis<span v-if="filters.fulfillment_type.length"> · {{ filters.fulfillment_type.length }}</span>
            </UButton>
            <template #content>
              <div class="w-44 space-y-2 p-3">
                <label
                  v-for="opt in FULFILLMENT_OPTIONS"
                  :key="opt.value"
                  class="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <UCheckbox
                    :model-value="filters.fulfillment_type.includes(opt.value)"
                    @update:model-value="toggleFilterValue('fulfillment_type', opt.value)"
                  />
                  {{ opt.label }}
                </label>
              </div>
            </template>
          </UPopover>

          <!-- Pembayaran (multi) -->
          <UPopover>
            <UButton color="neutral" variant="outline" icon="i-lucide-wallet" trailing-icon="i-lucide-chevron-down">
              Pembayaran<span v-if="filters.payment_status.length"> · {{ filters.payment_status.length }}</span>
            </UButton>
            <template #content>
              <div class="w-52 space-y-2 p-3">
                <label
                  v-for="opt in PAYMENT_OPTIONS"
                  :key="opt.value"
                  class="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <UCheckbox
                    :model-value="filters.payment_status.includes(opt.value)"
                    @update:model-value="toggleFilterValue('payment_status', opt.value)"
                  />
                  {{ opt.label }}
                </label>
              </div>
            </template>
          </UPopover>

          <!-- Rentang tanggal + pilihan kolom tanggal -->
          <div class="flex items-center gap-1">
            <USelect
              v-model="filters.date_field"
              :items="DATE_FIELD_OPTIONS"
              value-key="value"
              label-key="label"
              class="w-28"
              icon="i-lucide-calendar-clock"
            />
            <UInput v-model="filters.date_from" type="date" class="w-40" />
            <span class="text-xs text-zinc-400">—</span>
            <UInput v-model="filters.date_to" type="date" class="w-40" />
          </div>

          <div class="ml-auto flex items-center gap-2">
            <!-- Urutan -->
            <USelect v-model="sort.column" :items="SORT_OPTIONS" value-key="value" label-key="label" class="w-36" />
            <UButton
              color="neutral"
              variant="outline"
              :icon="sort.order === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'"
              @click="() => { sort.order = sort.order === 'asc' ? 'desc' : 'asc'; }"
            />

            <!-- Column visibility -->
            <UPopover>
              <UButton color="neutral" variant="outline" icon="i-lucide-columns-3" trailing-icon="i-lucide-chevron-down">
                Kolom
              </UButton>
              <template #content>
                <div class="grid w-64 grid-cols-2 gap-2 p-3">
                  <label
                    v-for="col in ALL_COLUMNS"
                    :key="col.key"
                    class="flex cursor-pointer items-center gap-2 text-sm"
                    :class="col.always ? 'opacity-60' : ''"
                  >
                    <UCheckbox
                      :model-value="visibleCols[col.key]"
                      :disabled="col.always"
                      @update:model-value="toggleColumn(col.key)"
                    />
                    {{ col.label }}
                  </label>
                </div>
              </template>
            </UPopover>
          </div>
        </div>
      </div>

      <!-- Tabel -->
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-zinc-200 text-sm">
          <thead class="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              <th v-if="isVisible('schedule')" class="px-4 py-3">Jadwal</th>
              <th v-if="isVisible('customer')" class="px-4 py-3">Customer</th>
              <th v-if="isVisible('phone')" class="px-4 py-3">Telepon</th>
              <th v-if="isVisible('service')" class="px-4 py-3">Layanan</th>
              <th v-if="isVisible('duration')" class="px-4 py-3">Durasi</th>
              <th v-if="isVisible('branch')" class="px-4 py-3">Cabang</th>
              <th v-if="isVisible('barber')" class="px-4 py-3">Barber</th>
              <th v-if="isVisible('source')" class="px-4 py-3">Sumber</th>
              <th v-if="isVisible('fulfillment')" class="px-4 py-3">Jenis</th>
              <th v-if="isVisible('status')" class="px-4 py-3">Status</th>
              <th v-if="isVisible('queue')" class="px-4 py-3">Antre</th>
              <th v-if="isVisible('payment')" class="px-4 py-3">Pembayaran</th>
              <th v-if="isVisible('method')" class="px-4 py-3">Metode</th>
              <th v-if="isVisible('total')" class="px-4 py-3 text-right">Total</th>
              <th v-if="isVisible('created')" class="px-4 py-3">Dibuat</th>
              <th class="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-100">
            <!-- Skeleton -->
            <tr v-if="loading">
              <td :colspan="visibleColumnCount" class="px-4 py-10 text-center text-zinc-400">Memuat data…</td>
            </tr>
            <tr v-else-if="rows.length === 0">
              <td :colspan="visibleColumnCount" class="px-4 py-10 text-center text-zinc-400">
                Tidak ada appointment yang cocok dengan filter.
              </td>
            </tr>
            <tr v-for="row in rows" v-else :key="row.id" class="hover:bg-zinc-50/60">
              <td v-if="isVisible('schedule')" class="whitespace-nowrap px-4 py-3 font-medium text-zinc-950">
                {{ formatDateTime(row.scheduled_at) }}
              </td>
              <td v-if="isVisible('customer')" class="px-4 py-3 text-zinc-800">{{ customerName(row) }}</td>
              <td v-if="isVisible('phone')" class="whitespace-nowrap px-4 py-3 text-zinc-600">{{ customerPhone(row) }}</td>
              <td v-if="isVisible('service')" class="px-4 py-3 text-zinc-600">{{ serviceNames(row) }}</td>
              <td v-if="isVisible('duration')" class="whitespace-nowrap px-4 py-3 text-zinc-600">
                {{ totalDuration(row) }} mnt
              </td>
              <td v-if="isVisible('branch')" class="px-4 py-3 text-zinc-600">{{ branchName(row) }}</td>
              <td v-if="isVisible('barber')" class="px-4 py-3 text-zinc-600">{{ barberName(row) }}</td>
              <td v-if="isVisible('source')" class="px-4 py-3">
                <UBadge :color="(SOURCE_META[row.source]?.color) ?? 'neutral'" variant="subtle">
                  {{ SOURCE_META[row.source]?.label ?? row.source }}
                </UBadge>
              </td>
              <td v-if="isVisible('fulfillment')" class="px-4 py-3">
                <UBadge :color="(FULFILLMENT_META[row.fulfillment_type ?? 'in_store']?.color) ?? 'neutral'" variant="subtle">
                  {{ FULFILLMENT_META[row.fulfillment_type ?? 'in_store']?.label ?? '—' }}
                </UBadge>
              </td>
              <td v-if="isVisible('status')" class="px-4 py-3">
                <UBadge :color="statusMeta(row.status).color" variant="subtle">
                  {{ statusMeta(row.status).label }}
                </UBadge>
              </td>
              <td v-if="isVisible('queue')" class="px-4 py-3 text-zinc-600">
                {{ row.queue_position ?? '—' }}
              </td>
              <td v-if="isVisible('payment')" class="px-4 py-3">
                <UBadge :color="paymentMeta(row).color" variant="subtle">{{ paymentMeta(row).label }}</UBadge>
              </td>
              <td v-if="isVisible('method')" class="px-4 py-3 text-zinc-600">
                {{ payment(row) ? (PAYMENT_METHOD_LABEL[payment(row)!.method] ?? payment(row)!.method) : '—' }}
              </td>
              <td v-if="isVisible('total')" class="whitespace-nowrap px-4 py-3 text-right font-medium text-zinc-800">
                {{ formatRupiah(paymentTotal(row)) }}
              </td>
              <td v-if="isVisible('created')" class="whitespace-nowrap px-4 py-3 text-zinc-500">
                {{ formatDateTime(row.created_at) }}
              </td>
              <td class="px-4 py-3 text-right">
                <UDropdownMenu :items="rowMenuItems(row)" :content="{ align: 'end' }">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-ellipsis-vertical"
                    :loading="busyId === row.id"
                    aria-label="Aksi appointment"
                  />
                </UDropdownMenu>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination server-side -->
      <div class="flex flex-col gap-3 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-3">
          <USelect v-model="perPage" :items="PER_PAGE_OPTIONS" value-key="value" label-key="label" class="w-36" />
          <span class="text-xs text-zinc-500">{{ rangeLabel }}</span>
        </div>
        <div v-if="meta" class="flex items-center gap-1">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-chevron-left"
            :disabled="!meta.has_prev || loading"
            @click="onPageChange(meta.page - 1)"
          />
          <span class="px-2 text-sm text-zinc-600">
            Hal {{ meta.page }} / {{ Math.max(meta.total_pages, 1) }}
          </span>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-chevron-right"
            :disabled="!meta.has_next || loading"
            @click="onPageChange(meta.page + 1)"
          />
        </div>
      </div>
    </section>

    <!-- Slideover detail appointment (data join lengkap) -->
    <USlideover v-model:open="detailOpen" title="Detail Appointment" :ui="{ content: 'max-w-md' }">
      <template #body>
        <div v-if="detailRow" class="space-y-5 text-sm">
          <!-- Ringkasan status -->
          <div class="flex flex-wrap gap-2">
            <UBadge :color="statusMeta(detailRow.status).color" variant="subtle">
              {{ statusMeta(detailRow.status).label }}
            </UBadge>
            <UBadge :color="(SOURCE_META[detailRow.source]?.color) ?? 'neutral'" variant="subtle">
              {{ SOURCE_META[detailRow.source]?.label ?? detailRow.source }}
            </UBadge>
            <UBadge :color="(FULFILLMENT_META[detailRow.fulfillment_type ?? 'in_store']?.color) ?? 'neutral'" variant="subtle">
              {{ FULFILLMENT_META[detailRow.fulfillment_type ?? 'in_store']?.label ?? '—' }}
            </UBadge>
            <UBadge :color="paymentMeta(detailRow).color" variant="subtle">
              {{ paymentMeta(detailRow).label }}
            </UBadge>
          </div>

          <!-- Customer -->
          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Customer</p>
            <dl class="space-y-1">
              <div class="flex items-center gap-2 text-zinc-700">
                <AppIcon name="i-lucide-user" class="size-4 text-zinc-400" />{{ customerName(detailRow) }}
              </div>
              <div class="flex items-center gap-2 text-zinc-700">
                <AppIcon name="i-lucide-phone" class="size-4 text-zinc-400" />{{ customerPhone(detailRow) }}
              </div>
              <div class="flex items-center gap-2 text-zinc-700">
                <AppIcon name="i-lucide-mail" class="size-4 text-zinc-400" />{{ unwrap(detailRow.customers)?.email ?? '—' }}
              </div>
            </dl>
          </div>

          <USeparator />

          <!-- Cabang & barber -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Cabang</p>
              <p class="text-zinc-700">{{ branchName(detailRow) }}</p>
            </div>
            <div>
              <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Barber</p>
              <p class="text-zinc-700">{{ barberName(detailRow) }}</p>
            </div>
          </div>

          <!-- Alamat layanan (home service) -->
          <div v-if="detailRow.fulfillment_type === 'home_service'">
            <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Alamat layanan</p>
            <p class="flex items-start gap-2 text-zinc-700">
              <AppIcon name="i-lucide-map-pin" class="mt-0.5 size-4 shrink-0 text-zinc-400" />
              {{ detailRow.service_address ?? '—' }}
            </p>
          </div>

          <USeparator />

          <!-- Layanan -->
          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Layanan · {{ totalDuration(detailRow) }} menit
            </p>
            <ul class="space-y-1">
              <li
                v-for="svc in detailRow.appointment_services"
                :key="svc.id"
                class="flex items-center justify-between text-zinc-700"
              >
                <span>{{ unwrap(svc.services)?.name ?? '—' }} <span class="text-zinc-400">({{ svc.duration_min }}m)</span></span>
                <span class="font-medium">{{ formatRupiah(svc.price_amount) }}</span>
              </li>
              <li v-if="!detailRow.appointment_services.length" class="text-zinc-400">Belum ada layanan.</li>
            </ul>
          </div>

          <USeparator />

          <!-- Pembayaran -->
          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Pembayaran</p>
            <template v-if="payment(detailRow)">
              <dl class="space-y-1 text-zinc-700">
                <div class="flex justify-between"><dt class="text-zinc-500">Layanan</dt><dd>{{ formatRupiah(payment(detailRow)!.service_amount) }}</dd></div>
                <div class="flex justify-between"><dt class="text-zinc-500">Produk</dt><dd>{{ formatRupiah(payment(detailRow)!.product_amount) }}</dd></div>
                <div class="flex justify-between"><dt class="text-zinc-500">Tip</dt><dd>{{ formatRupiah(payment(detailRow)!.tip_amount) }}</dd></div>
                <div class="flex justify-between"><dt class="text-zinc-500">Diskon</dt><dd>-{{ formatRupiah(payment(detailRow)!.discount_amount) }}</dd></div>
                <div class="flex justify-between border-t border-zinc-100 pt-1 font-semibold"><dt>Total</dt><dd>{{ formatRupiah(payment(detailRow)!.total_amount) }}</dd></div>
                <div class="flex justify-between"><dt class="text-zinc-500">Metode</dt><dd>{{ PAYMENT_METHOD_LABEL[payment(detailRow)!.method] ?? payment(detailRow)!.method }}</dd></div>
                <div class="flex justify-between"><dt class="text-zinc-500">Dibayar</dt><dd>{{ formatDateTime(payment(detailRow)!.paid_at) }}</dd></div>
              </dl>
            </template>
            <p v-else class="text-zinc-400">Belum ada pembayaran.</p>
          </div>

          <USeparator />

          <!-- Linimasa -->
          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Linimasa</p>
            <dl class="space-y-1 text-zinc-700">
              <div class="flex justify-between"><dt class="text-zinc-500">Jadwal</dt><dd>{{ formatDateTime(detailRow.scheduled_at) }}</dd></div>
              <div class="flex justify-between"><dt class="text-zinc-500">Check-in</dt><dd>{{ formatDateTime(detailRow.checked_in_at) }}</dd></div>
              <div class="flex justify-between"><dt class="text-zinc-500">Mulai</dt><dd>{{ formatDateTime(detailRow.started_at) }}</dd></div>
              <div class="flex justify-between"><dt class="text-zinc-500">Selesai</dt><dd>{{ formatDateTime(detailRow.completed_at) }}</dd></div>
              <div class="flex justify-between"><dt class="text-zinc-500">Dibuat</dt><dd>{{ formatDateTime(detailRow.created_at) }}</dd></div>
              <div v-if="detailRow.queue_position != null" class="flex justify-between"><dt class="text-zinc-500">Antrean</dt><dd>#{{ detailRow.queue_position }}</dd></div>
            </dl>
          </div>

          <!-- Alasan pembatalan -->
          <div v-if="detailRow.cancellation_reason" class="rounded-md bg-red-50 px-3 py-2 text-red-700">
            <p class="text-xs font-semibold uppercase tracking-wide">Alasan pembatalan</p>
            <p class="mt-1">{{ detailRow.cancellation_reason }}</p>
          </div>
        </div>
      </template>
    </USlideover>

    <!-- Modal konfirmasi transisi destruktif (batal / no-show) -->
    <UModal v-model:open="statusModalOpen" :title="statusTarget?.action.label ?? 'Konfirmasi'">
      <template #body>
        <div v-if="statusTarget" class="space-y-3 text-sm">
          <p class="text-zinc-600">
            Ubah status appointment <strong>{{ customerName(statusTarget.row) }}</strong>
            menjadi <strong>{{ statusMeta(statusTarget.action.to).label }}</strong>?
          </p>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Alasan (opsional)</label>
            <UTextarea v-model="statusReason" :rows="3" placeholder="Catatan alasan…" class="w-full" />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { statusModalOpen = false; }">Batal</UButton>
          <UButton color="error" icon="i-lucide-check" @click="confirmStatusModal">
            {{ statusTarget?.action.label ?? 'Konfirmasi' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Modal reassign barber -->
    <UModal v-model:open="reassignOpen" title="Reassign Barber">
      <template #body>
        <div v-if="reassignRow" class="space-y-3 text-sm">
          <p class="text-zinc-600">
            Pindahkan appointment <strong>{{ customerName(reassignRow) }}</strong>
            di cabang <strong>{{ branchName(reassignRow) }}</strong> ke barber lain.
          </p>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Barber tujuan</label>
            <USelect
              v-model="reassignBarberId"
              :items="reassignItems"
              value-key="value"
              label-key="label"
              placeholder="Pilih barber"
              icon="i-lucide-user"
              class="w-full"
            />
            <p v-if="reassignBarbers.length === 0" class="mt-1 text-xs text-zinc-400">
              Memuat / tidak ada barber pada cabang ini.
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { reassignOpen = false; }">Batal</UButton>
          <UButton
            color="primary"
            icon="i-lucide-user-round-cog"
            :loading="reassignBusy"
            :disabled="!reassignBarberId || reassignBarberId === reassignRow?.barber_id"
            @click="confirmReassign"
          >
            Reassign
          </UButton>
        </div>
      </template>
    </UModal>
  </AppLayout>
</template>
