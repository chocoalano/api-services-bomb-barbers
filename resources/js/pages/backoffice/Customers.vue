<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UCard from '@nuxt/ui/components/Card.vue';
import UCheckbox from '@nuxt/ui/components/Checkbox.vue';
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import UPopover from '@nuxt/ui/components/Popover.vue';
import USelect from '@nuxt/ui/components/Select.vue';
import USeparator from '@nuxt/ui/components/Separator.vue';
import USlideover from '@nuxt/ui/components/Slideover.vue';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import AppLayout from '../../layouts/AppLayout.vue';
import {
  fetchAdminCustomers,
  fetchAdminCustomerStats,
  getStoredStaff,
  type CustomerListParams,
  type CustomerRow,
  type CustomerStats,
  type AppointmentListMeta
} from '../../lib/api';

const staff = getStoredStaff();
const isSuperAdmin = computed(
  () => Boolean(staff?.is_global) || (staff?.roles ?? []).includes('super_admin')
);

/* ------------------------------------------------------------------ */
/* Formatters                                                          */
/* ------------------------------------------------------------------ */
const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
});
const formatRupiah = (v: number) => rupiah.format(Number.isFinite(v) ? v : 0);

const numberFmt = new Intl.NumberFormat('id-ID');

const dateFmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});
const dateTimeFmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});
const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
};
const formatDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
};

/* ------------------------------------------------------------------ */
/* Filter options                                                      */
/* ------------------------------------------------------------------ */
// Reka UI (Nuxt UI Select) melarang value string kosong → sentinel 'all'.
const ALL = 'all';
const STATUS_OPTIONS = [
  { value: ALL, label: 'Semua status' },
  { value: 'active', label: 'Aktif' },
  { value: 'inactive', label: 'Non-aktif' }
];
const SORT_OPTIONS = [
  { value: 'full_name', label: 'Nama' },
  { value: 'created_at', label: 'Terdaftar' },
  { value: 'points_balance', label: 'Poin' }
];
const PER_PAGE_OPTIONS = [10, 20, 50, 100].map((n) => ({ value: n, label: `${n} / halaman` }));

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
const filters = reactive({
  q: '',
  status: ALL as 'all' | 'active' | 'inactive'
});
const sort = reactive({ column: 'full_name', order: 'asc' as 'asc' | 'desc' });
const page = ref(1);
const perPage = ref(20);

const rows = ref<CustomerRow[]>([]);
const meta = ref<AppointmentListMeta | null>(null);
const stats = ref<CustomerStats | null>(null);
const loading = ref(true);
const error = ref('');

/* ------------------------------------------------------------------ */
/* Column visibility                                                   */
/* ------------------------------------------------------------------ */
type ColumnKey =
  | 'name' | 'phone' | 'email' | 'points' | 'status'
  | 'appointments' | 'completed' | 'spent' | 'last_visit' | 'created';
type Column = { key: ColumnKey; label: string; always?: boolean };
const ALL_COLUMNS: Column[] = [
  { key: 'name', label: 'Nama', always: true },
  { key: 'phone', label: 'Telepon' },
  { key: 'email', label: 'Email' },
  { key: 'points', label: 'Poin' },
  { key: 'status', label: 'Status' },
  { key: 'appointments', label: 'Appointment' },
  { key: 'completed', label: 'Selesai' },
  { key: 'spent', label: 'Total belanja' },
  { key: 'last_visit', label: 'Kunjungan terakhir' },
  { key: 'created', label: 'Terdaftar' }
];
const DEFAULT_HIDDEN: ColumnKey[] = ['email', 'completed', 'created'];
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
/* Metric cards                                                        */
/* ------------------------------------------------------------------ */
const metricCards = computed(() => {
  const s = stats.value;
  return [
    { label: 'Total pelanggan', value: s?.total ?? 0, icon: 'i-lucide-users', tone: 'primary' as const },
    { label: 'Aktif', value: s?.active ?? 0, icon: 'i-lucide-user-check', tone: 'success' as const },
    { label: 'Non-aktif', value: s?.inactive ?? 0, icon: 'i-lucide-user-x', tone: 'neutral' as const },
    { label: 'Baru (30 hari)', value: s?.new_30d ?? 0, icon: 'i-lucide-user-plus', tone: 'info' as const }
  ];
});

const activeFilterCount = computed(() => (filters.q ? 1 : 0) + (filters.status !== ALL ? 1 : 0));

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */
const buildParams = (): CustomerListParams => ({
  page: page.value,
  per_page: perPage.value,
  q: filters.q.trim() || undefined,
  status: filters.status !== ALL ? filters.status : undefined,
  sort: sort.column,
  order: sort.order
});

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    const [list, statData] = await Promise.all([
      fetchAdminCustomers(buildParams()),
      fetchAdminCustomerStats()
    ]);
    rows.value = list.data;
    meta.value = list.meta;
    stats.value = statData;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Gagal memuat data pelanggan.';
    rows.value = [];
  } finally {
    loading.value = false;
  }
};

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
  filters.status = ALL;
  reloadFromFilters();
};

watch(() => filters.q, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(reloadFromFilters, 350);
});
watch(
  () => [filters.status, sort.column, sort.order, perPage.value],
  reloadFromFilters
);

/* ------------------------------------------------------------------ */
/* Detail slideover                                                    */
/* ------------------------------------------------------------------ */
const detailOpen = ref(false);
const detailRow = ref<CustomerRow | null>(null);
const openDetail = (row: CustomerRow) => {
  detailRow.value = row;
  detailOpen.value = true;
};

/* ------------------------------------------------------------------ */
/* Aksi baris (read-only / kontak — sesuai permission view_customers)  */
/* ------------------------------------------------------------------ */
const actionMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);
let messageTimer: ReturnType<typeof setTimeout> | undefined;
const flash = (type: 'success' | 'error', text: string) => {
  actionMessage.value = { type, text };
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (actionMessage.value = null), 3000);
};

const copyText = async (label: string, value: string | null) => {
  if (!value) {
    flash('error', `${label} tidak tersedia.`);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    flash('success', `${label} disalin: ${value}`);
  } catch {
    flash('error', `Gagal menyalin ${label.toLowerCase()}.`);
  }
};

// Arahkan ke halaman appointment dengan pencarian terisi customer ini.
const viewAppointments = (row: CustomerRow) => {
  const key = row.phone || row.full_name;
  window.location.assign(`/backoffice/appointments?q=${encodeURIComponent(key)}`);
};

// Buka WhatsApp untuk nomor pelanggan (format 62… → hanya digit).
const openWhatsApp = (row: CustomerRow) => {
  const digits = (row.phone || '').replace(/\D/g, '');
  if (!digits) {
    flash('error', 'Nomor telepon tidak tersedia.');
    return;
  }
  window.open(`https://wa.me/${digits}`, '_blank', 'noopener');
};

const rowMenuItems = (row: CustomerRow) => [
  [
    { label: 'Lihat detail', icon: 'i-lucide-eye', onSelect: () => openDetail(row) },
    { label: 'Lihat appointment', icon: 'i-lucide-calendar-clock', onSelect: () => viewAppointments(row) }
  ],
  [
    { label: 'Hubungi WhatsApp', icon: 'i-lucide-message-circle', onSelect: () => openWhatsApp(row) },
    { label: 'Salin telepon', icon: 'i-lucide-copy', onSelect: () => copyText('Nomor telepon', row.phone) },
    { label: 'Salin email', icon: 'i-lucide-mail', onSelect: () => copyText('Email', row.email) }
  ]
];

onMounted(load);

const rangeLabel = computed(() => {
  const m = meta.value;
  if (!m || m.total === 0) return '0 data';
  const start = (m.page - 1) * m.per_page + 1;
  const end = Math.min(m.page * m.per_page, m.total);
  return `${start}–${end} dari ${m.total}`;
});
</script>

<template>
  <Head title="Customer" />

  <AppLayout title="Customer" eyebrow="Basis Data">
    <p class="mb-4 text-xs text-zinc-500">
      <span v-if="isSuperAdmin">Menampilkan seluruh pelanggan (super admin).</span>
      <span v-else>Menampilkan pelanggan yang pernah dilayani cabang Anda.</span>
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

    <!-- Kartu metrik -->
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <UCard v-for="metric in metricCards" :key="metric.label" :ui="{ root: 'rounded-md' }">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm text-zinc-500">{{ metric.label }}</p>
            <p v-if="loading && !stats" class="mt-2 h-7 w-12 animate-pulse rounded bg-zinc-200" />
            <p v-else class="mt-2 text-2xl font-semibold text-zinc-950">{{ numberFmt.format(metric.value) }}</p>
          </div>
          <UBadge :color="metric.tone" variant="subtle" class="size-9 justify-center rounded-md p-0">
            <AppIcon :name="metric.icon" class="size-5" />
          </UBadge>
        </div>
      </UCard>
    </div>

    <!-- Tabel + filter -->
    <section class="mt-5 rounded-md border border-zinc-200 bg-white">
      <div class="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3">
        <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 class="text-sm font-semibold text-zinc-950">Daftar Pelanggan</h2>
            <p class="text-xs text-zinc-500">{{ rangeLabel }} · termasuk ringkasan appointment &amp; belanja</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UInput
              v-model="filters.q"
              icon="i-lucide-search"
              placeholder="Cari nama, telepon, email"
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

        <div class="flex flex-wrap items-center gap-2">
          <USelect
            v-model="filters.status"
            :items="STATUS_OPTIONS"
            value-key="value"
            label-key="label"
            class="w-40"
            icon="i-lucide-user-check"
          />

          <div class="ml-auto flex items-center gap-2">
            <USelect v-model="sort.column" :items="SORT_OPTIONS" value-key="value" label-key="label" class="w-36" />
            <UButton
              color="neutral"
              variant="outline"
              :icon="sort.order === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'"
              @click="() => { sort.order = sort.order === 'asc' ? 'desc' : 'asc'; }"
            />
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
              <th v-if="isVisible('name')" class="px-4 py-3">Nama</th>
              <th v-if="isVisible('phone')" class="px-4 py-3">Telepon</th>
              <th v-if="isVisible('email')" class="px-4 py-3">Email</th>
              <th v-if="isVisible('points')" class="px-4 py-3 text-right">Poin</th>
              <th v-if="isVisible('status')" class="px-4 py-3">Status</th>
              <th v-if="isVisible('appointments')" class="px-4 py-3 text-right">Appointment</th>
              <th v-if="isVisible('completed')" class="px-4 py-3 text-right">Selesai</th>
              <th v-if="isVisible('spent')" class="px-4 py-3 text-right">Total belanja</th>
              <th v-if="isVisible('last_visit')" class="px-4 py-3">Kunjungan terakhir</th>
              <th v-if="isVisible('created')" class="px-4 py-3">Terdaftar</th>
              <th class="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-100">
            <tr v-if="loading">
              <td :colspan="visibleColumnCount" class="px-4 py-10 text-center text-zinc-400">Memuat data…</td>
            </tr>
            <tr v-else-if="rows.length === 0">
              <td :colspan="visibleColumnCount" class="px-4 py-10 text-center text-zinc-400">
                Tidak ada pelanggan yang cocok dengan filter.
              </td>
            </tr>
            <tr v-for="row in rows" v-else :key="row.id" class="hover:bg-zinc-50/60">
              <td v-if="isVisible('name')" class="px-4 py-3 font-medium text-zinc-950">{{ row.full_name }}</td>
              <td v-if="isVisible('phone')" class="whitespace-nowrap px-4 py-3 text-zinc-600">{{ row.phone ?? '—' }}</td>
              <td v-if="isVisible('email')" class="px-4 py-3 text-zinc-600">{{ row.email ?? '—' }}</td>
              <td v-if="isVisible('points')" class="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
                {{ numberFmt.format(row.points_balance) }}
              </td>
              <td v-if="isVisible('status')" class="px-4 py-3">
                <UBadge :color="row.is_active ? 'success' : 'neutral'" variant="subtle">
                  {{ row.is_active ? 'Aktif' : 'Non-aktif' }}
                </UBadge>
              </td>
              <td v-if="isVisible('appointments')" class="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
                {{ row.stats.total_appointments }}
              </td>
              <td v-if="isVisible('completed')" class="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
                {{ row.stats.completed_appointments }}
              </td>
              <td v-if="isVisible('spent')" class="whitespace-nowrap px-4 py-3 text-right font-medium text-zinc-800">
                {{ formatRupiah(row.stats.total_spent) }}
              </td>
              <td v-if="isVisible('last_visit')" class="whitespace-nowrap px-4 py-3 text-zinc-600">
                {{ formatDateTime(row.stats.last_visit_at) }}
              </td>
              <td v-if="isVisible('created')" class="whitespace-nowrap px-4 py-3 text-zinc-500">
                {{ formatDate(row.created_at) }}
              </td>
              <td class="px-4 py-3 text-right">
                <UDropdownMenu :items="rowMenuItems(row)" :content="{ align: 'end' }">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-ellipsis-vertical"
                    aria-label="Aksi pelanggan"
                  />
                </UDropdownMenu>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
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

    <!-- Slideover detail pelanggan -->
    <USlideover v-model:open="detailOpen" title="Detail Pelanggan" :ui="{ content: 'max-w-md' }">
      <template #body>
        <div v-if="detailRow" class="space-y-5 text-sm">
          <div class="flex items-center gap-3">
            <div class="grid size-12 place-items-center rounded-full bg-emerald-50 text-lg font-semibold text-emerald-700">
              {{ detailRow.full_name.charAt(0).toUpperCase() }}
            </div>
            <div>
              <p class="font-semibold text-zinc-950">{{ detailRow.full_name }}</p>
              <UBadge :color="detailRow.is_active ? 'success' : 'neutral'" variant="subtle" class="mt-1">
                {{ detailRow.is_active ? 'Aktif' : 'Non-aktif' }}
              </UBadge>
            </div>
          </div>

          <USeparator />

          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Kontak</p>
            <dl class="space-y-1">
              <div class="flex items-center gap-2 text-zinc-700">
                <AppIcon name="i-lucide-phone" class="size-4 text-zinc-400" />{{ detailRow.phone ?? '—' }}
              </div>
              <div class="flex items-center gap-2 text-zinc-700">
                <AppIcon name="i-lucide-mail" class="size-4 text-zinc-400" />{{ detailRow.email ?? '—' }}
              </div>
            </dl>
          </div>

          <USeparator />

          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Ringkasan {{ isSuperAdmin ? '(semua cabang)' : '(cabang Anda)' }}
            </p>
            <dl class="grid grid-cols-2 gap-3">
              <div class="rounded-md bg-zinc-50 p-3">
                <dt class="text-xs text-zinc-500">Appointment</dt>
                <dd class="mt-1 text-lg font-semibold text-zinc-950">{{ detailRow.stats.total_appointments }}</dd>
              </div>
              <div class="rounded-md bg-zinc-50 p-3">
                <dt class="text-xs text-zinc-500">Selesai</dt>
                <dd class="mt-1 text-lg font-semibold text-zinc-950">{{ detailRow.stats.completed_appointments }}</dd>
              </div>
              <div class="rounded-md bg-zinc-50 p-3">
                <dt class="text-xs text-zinc-500">Total belanja</dt>
                <dd class="mt-1 text-lg font-semibold text-zinc-950">{{ formatRupiah(detailRow.stats.total_spent) }}</dd>
              </div>
              <div class="rounded-md bg-zinc-50 p-3">
                <dt class="text-xs text-zinc-500">Poin</dt>
                <dd class="mt-1 text-lg font-semibold text-zinc-950">{{ numberFmt.format(detailRow.points_balance) }}</dd>
              </div>
            </dl>
          </div>

          <USeparator />

          <dl class="space-y-1 text-zinc-700">
            <div class="flex justify-between"><dt class="text-zinc-500">Kunjungan terakhir</dt><dd>{{ formatDateTime(detailRow.stats.last_visit_at) }}</dd></div>
            <div class="flex justify-between"><dt class="text-zinc-500">Terdaftar</dt><dd>{{ formatDate(detailRow.created_at) }}</dd></div>
          </dl>
        </div>
      </template>
    </USlideover>
  </AppLayout>
</template>
