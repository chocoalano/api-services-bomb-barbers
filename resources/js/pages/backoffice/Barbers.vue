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
  createBarber,
  deleteBarber,
  fetchAdminBarbers,
  fetchAdminBarberStats,
  fetchAdminBranches,
  fetchBarberSchedule,
  getStoredStaff,
  setBarberStatus,
  updateBarber,
  type AdminBranch,
  type AppointmentListMeta,
  type BarberLiveStatus,
  type BarberRow,
  type BarberSchedule,
  type BarberStats
} from '../../lib/api';

const staff = getStoredStaff();
const isSuperAdmin = computed(
  () => Boolean(staff?.is_global) || (staff?.roles ?? []).includes('super_admin')
);
// Kelola master barber (tambah/edit/hapus). super_admin bebas lintas cabang;
// branch_admin dengan permission `manage_barber` hanya untuk cabangnya (di-scope
// oleh backend + daftar cabang yang sudah difilter per peran).
const canManageBarber = computed(
  () => isSuperAdmin.value || (staff?.permissions ?? []).includes('manage_barber')
);

/* ------------------------------------------------------------------ */
/* Formatters & meta                                                   */
/* ------------------------------------------------------------------ */
const numberFmt = new Intl.NumberFormat('id-ID');
const dateFmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});
const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
};
const formatRating = (v: number) => (v > 0 ? v.toFixed(1) : '—');

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';
const STATUS_META: Record<BarberLiveStatus, { label: string; color: BadgeColor; icon: string }> = {
  available: { label: 'Tersedia', color: 'success', icon: 'i-lucide-circle-check' },
  serving: { label: 'Melayani', color: 'warning', icon: 'i-lucide-scissors' },
  on_break: { label: 'Istirahat', color: 'neutral', icon: 'i-lucide-coffee' },
  offline: { label: 'Offline', color: 'neutral', icon: 'i-lucide-power' }
};
const statusMeta = (s: string) =>
  STATUS_META[s as BarberLiveStatus] ?? { label: s, color: 'neutral' as BadgeColor, icon: 'i-lucide-circle' };

const ALL = 'all';
const STATUS_OPTIONS = [
  { value: 'available', label: 'Tersedia' },
  { value: 'serving', label: 'Melayani' },
  { value: 'on_break', label: 'Istirahat' },
  { value: 'offline', label: 'Offline' }
];
const SORT_OPTIONS = [
  { value: 'display_name', label: 'Nama' },
  { value: 'rating_avg', label: 'Rating' },
  { value: 'rating_count', label: 'Jumlah ulasan' },
  { value: 'created_at', label: 'Bergabung' }
];
const PER_PAGE_OPTIONS = [10, 20, 50, 100].map((n) => ({ value: n, label: `${n} / halaman` }));

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
const filters = reactive({
  q: '',
  live_status: [] as string[],
  branch_id: ALL
});
const sort = reactive({ column: 'display_name', order: 'asc' as 'asc' | 'desc' });
const page = ref(1);
const perPage = ref(20);

const rows = ref<BarberRow[]>([]);
const meta = ref<AppointmentListMeta | null>(null);
const stats = ref<BarberStats | null>(null);
const loading = ref(true);
const error = ref('');
const branchOptions = ref<AdminBranch[]>([]);

const branchSelectItems = computed(() => [
  { value: ALL, label: 'Semua cabang' },
  ...branchOptions.value.map((b) => ({ value: b.id, label: b.name }))
]);
const branchParam = () => (filters.branch_id !== ALL ? filters.branch_id : undefined);

/* ------------------------------------------------------------------ */
/* Column visibility                                                   */
/* ------------------------------------------------------------------ */
type ColumnKey =
  | 'name' | 'branch' | 'staff' | 'phone' | 'status' | 'rating'
  | 'active' | 'completed' | 'joined';
type Column = { key: ColumnKey; label: string; always?: boolean };
const ALL_COLUMNS: Column[] = [
  { key: 'name', label: 'Nama', always: true },
  { key: 'branch', label: 'Cabang' },
  { key: 'staff', label: 'Akun staff' },
  { key: 'phone', label: 'Telepon' },
  { key: 'status', label: 'Status' },
  { key: 'rating', label: 'Rating' },
  { key: 'active', label: 'Order aktif' },
  { key: 'completed', label: 'Selesai' },
  { key: 'joined', label: 'Bergabung' }
];
const DEFAULT_HIDDEN: ColumnKey[] = ['staff', 'phone', 'joined'];
const visibleCols = reactive<Record<ColumnKey, boolean>>(
  Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, !DEFAULT_HIDDEN.includes(c.key)])) as Record<ColumnKey, boolean>
);
const isVisible = (key: ColumnKey) => visibleCols[key];
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
    { label: 'Total barber', value: numberFmt.format(s?.total ?? 0), icon: 'i-lucide-users', tone: 'primary' as BadgeColor },
    { label: 'Tersedia', value: numberFmt.format(s?.available ?? 0), icon: 'i-lucide-circle-check', tone: 'success' as BadgeColor },
    { label: 'Sedang melayani', value: numberFmt.format(s?.serving ?? 0), icon: 'i-lucide-scissors', tone: 'warning' as BadgeColor },
    { label: 'Rata-rata rating', value: s?.avg_rating ? s.avg_rating.toFixed(2) : '—', icon: 'i-lucide-star', tone: 'info' as BadgeColor }
  ];
});

const activeFilterCount = computed(
  () => (filters.q ? 1 : 0) + filters.live_status.length + (filters.branch_id !== ALL ? 1 : 0)
);

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */
const buildParams = () => ({
  page: page.value,
  per_page: perPage.value,
  branch_id: branchParam(),
  live_status: filters.live_status,
  q: filters.q.trim() || undefined,
  sort: sort.column,
  order: sort.order
});

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    const [list, statData] = await Promise.all([
      fetchAdminBarbers(buildParams()),
      fetchAdminBarberStats({ branch_id: branchParam() })
    ]);
    rows.value = list.data;
    meta.value = list.meta;
    stats.value = statData;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Gagal memuat data barber.';
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
  filters.live_status = [];
  filters.branch_id = ALL;
  reloadFromFilters();
};
const toggleStatusFilter = (value: string) => {
  const idx = filters.live_status.indexOf(value);
  if (idx === -1) filters.live_status.push(value);
  else filters.live_status.splice(idx, 1);
};

watch(() => filters.q, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(reloadFromFilters, 350);
});
watch(
  () => [filters.live_status.slice(), filters.branch_id, sort.column, sort.order, perPage.value],
  reloadFromFilters
);

/* ------------------------------------------------------------------ */
/* Aksi baris (set status live + detail)                               */
/* ------------------------------------------------------------------ */
const actionMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);
let messageTimer: ReturnType<typeof setTimeout> | undefined;
const flash = (type: 'success' | 'error', text: string) => {
  actionMessage.value = { type, text };
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (actionMessage.value = null), 3500);
};

const busyId = ref<string | null>(null);

const detailOpen = ref(false);
const detailRow = ref<BarberRow | null>(null);
const openDetail = (row: BarberRow) => {
  detailRow.value = row;
  detailOpen.value = true;
};

const applyStatus = async (row: BarberRow, status: BarberLiveStatus) => {
  if (status === row.live_status) return;
  busyId.value = row.id;
  try {
    await setBarberStatus(row.branch_id, row.id, status);
    flash('success', `Status ${row.display_name} diubah menjadi "${statusMeta(status).label}".`);
    await load();
    // Sinkronkan slideover detail bila sedang terbuka: `load()` mengganti seluruh
    // objek `rows`, sehingga `detailRow` lama menjadi basi dan badge/tombol status
    // tidak ikut ter-update. Tunjuk ulang ke baris hasil refresh (atau salin status).
    if (detailRow.value?.id === row.id) {
      detailRow.value = rows.value.find((r) => r.id === row.id) ?? { ...detailRow.value, live_status: status };
    }
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal mengubah status barber.');
  } finally {
    busyId.value = null;
  }
};

/* -- Jadwal harian barber (slideover) -- */
const scheduleOpen = ref(false);
const scheduleBarber = ref<BarberRow | null>(null);
const scheduleDate = ref('');
const scheduleLoading = ref(false);
const scheduleData = ref<BarberSchedule | null>(null);

const todayJakarta = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

const loadSchedule = async () => {
  const barber = scheduleBarber.value;
  if (!barber) return;
  scheduleLoading.value = true;
  try {
    scheduleData.value = await fetchBarberSchedule(barber.branch_id, barber.id, scheduleDate.value);
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal memuat jadwal.');
    scheduleData.value = null;
  } finally {
    scheduleLoading.value = false;
  }
};
const openSchedule = (row: BarberRow) => {
  scheduleBarber.value = row;
  scheduleDate.value = todayJakarta();
  scheduleData.value = null;
  scheduleOpen.value = true;
  loadSchedule();
};
watch(scheduleDate, () => {
  if (scheduleOpen.value) loadSchedule();
});

const scheduleTimeFmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit'
});
const scheduleTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : scheduleTimeFmt.format(d);
};
const unwrap = <T,>(rel: T | T[] | null | undefined): T | null =>
  rel == null ? null : Array.isArray(rel) ? (rel[0] ?? null) : rel;
const scheduleCustomer = (item: BarberSchedule['appointments'][number]) =>
  unwrap(item.customers)?.full_name ?? 'Tamu';
const scheduleServices = (item: BarberSchedule['appointments'][number]) =>
  item.appointment_services.map((s) => unwrap(s.services)?.name).filter(Boolean).join(', ') || '—';

/* -- Kontak -- */
const copyText = async (label: string, value: string | null | undefined) => {
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
const openWhatsApp = (row: BarberRow) => {
  const digits = (row.staff?.phone || '').replace(/\D/g, '');
  if (!digits) {
    flash('error', 'Nomor telepon tidak tersedia.');
    return;
  }
  window.open(`https://wa.me/${digits}`, '_blank', 'noopener');
};

/* -- Edit barber (super_admin) -- */
const editOpen = ref(false);
const editRow = ref<BarberRow | null>(null);
const editForm = reactive({
  full_name: '',
  email: '',
  phone: '',
  display_name: '',
  bio: '',
  branch_id: '',
  service_radius_km: 5,
  live_status: 'offline' as BarberLiveStatus
});
const editBusy = ref(false);
const openEdit = (row: BarberRow) => {
  editRow.value = row;
  editForm.full_name = row.staff?.full_name ?? '';
  editForm.email = row.staff?.email ?? '';
  editForm.phone = row.staff?.phone ?? '';
  editForm.display_name = row.display_name;
  editForm.bio = row.bio ?? '';
  editForm.branch_id = row.branch_id;
  editForm.service_radius_km = Number(row.service_radius_km ?? 5);
  editForm.live_status = row.live_status;
  editOpen.value = true;
};
const editRadiusValid = computed(() => {
  const radius = Number(editForm.service_radius_km);
  return Number.isFinite(radius) && radius >= 0;
});
const canSaveEdit = computed(
  () =>
    editForm.display_name.trim().length >= 2 &&
    editForm.full_name.trim().length >= 2 &&
    /.+@.+\..+/.test(editForm.email.trim()) &&
    editRadiusValid.value
);
const saveEdit = async () => {
  const row = editRow.value;
  if (!row || !canSaveEdit.value) return;
  editBusy.value = true;
  try {
    await updateBarber(row.id, {
      display_name: editForm.display_name.trim(),
      full_name: editForm.full_name.trim(),
      email: editForm.email.trim(),
      phone: editForm.phone.trim() || null,
      bio: editForm.bio.trim() || null,
      branch_id: editForm.branch_id,
      service_radius_km: Math.round(Number(editForm.service_radius_km))
    });

    // Status kehadiran punya endpoint sendiri karena ikut menyetel presence
    // (Redis + socket). Menulisnya lewat PUT profil hanya mengubah baris DB dan
    // membuat status admin berbeda dari yang dilihat mesin booking.
    if (editForm.live_status !== row.live_status) {
      await setBarberStatus(row.branch_id, row.id, editForm.live_status);
    }

    flash('success', `Data ${editForm.display_name.trim()} berhasil diperbarui.`);
    editOpen.value = false;
    await load();
    if (detailRow.value?.id === row.id) {
      detailRow.value = rows.value.find((r) => r.id === row.id) ?? detailRow.value;
    }
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal memperbarui barber.');
  } finally {
    editBusy.value = false;
  }
};

/* -- Hapus barber (super_admin) -- */
const deleteOpen = ref(false);
const deleteRow = ref<BarberRow | null>(null);
const deleteBusy = ref(false);
const openDelete = (row: BarberRow) => {
  deleteRow.value = row;
  deleteOpen.value = true;
};
const confirmDelete = async () => {
  const row = deleteRow.value;
  if (!row) return;
  deleteBusy.value = true;
  try {
    await deleteBarber(row.id);
    flash('success', `Barber ${row.display_name} dihapus.`);
    deleteOpen.value = false;
    await load();
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal menghapus barber.');
  } finally {
    deleteBusy.value = false;
  }
};

/* -- Tambah barber (super_admin) -- */
const createOpen = ref(false);
const createBusy = ref(false);
const createForm = reactive({
  full_name: '',
  email: '',
  password: '',
  phone: '',
  display_name: '',
  branch_id: ''
});
const createBranchItems = computed(() => branchOptions.value.map((b) => ({ value: b.id, label: b.name })));
const canCreate = computed(
  () =>
    createForm.full_name.trim().length >= 2 &&
    /.+@.+\..+/.test(createForm.email) &&
    createForm.password.length >= 6
);
const openCreate = () => {
  createForm.full_name = '';
  createForm.email = '';
  createForm.password = '';
  createForm.phone = '';
  createForm.display_name = '';
  createForm.branch_id = branchOptions.value[0]?.id ?? '';
  createOpen.value = true;
};
const saveCreate = async () => {
  if (!canCreate.value) return;
  createBusy.value = true;
  try {
    await createBarber({
      full_name: createForm.full_name.trim(),
      email: createForm.email.trim(),
      password: createForm.password,
      phone: createForm.phone.trim() || undefined,
      display_name: createForm.display_name.trim() || undefined,
      branch_id: createForm.branch_id || undefined
    });
    flash('success', `Barber ${createForm.full_name.trim()} berhasil ditambahkan.`);
    createOpen.value = false;
    await load();
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal menambah barber.');
  } finally {
    createBusy.value = false;
  }
};

const rowMenuItems = (row: BarberRow) => {
  const statusItems = (['available', 'serving', 'on_break', 'offline'] as BarberLiveStatus[])
    .filter((s) => s !== row.live_status)
    .map((s) => ({
      label: `Set ${statusMeta(s).label}`,
      icon: statusMeta(s).icon,
      onSelect: () => applyStatus(row, s)
    }));

  const groups: any[] = [
    [
      { label: 'Lihat detail', icon: 'i-lucide-eye', onSelect: () => openDetail(row) },
      { label: 'Lihat jadwal', icon: 'i-lucide-calendar-days', onSelect: () => openSchedule(row) }
    ],
    statusItems,
    [
      { label: 'Hubungi WhatsApp', icon: 'i-lucide-message-circle', onSelect: () => openWhatsApp(row) },
      { label: 'Salin telepon', icon: 'i-lucide-copy', onSelect: () => copyText('Nomor telepon', row.staff?.phone) }
    ]
  ];

  if (canManageBarber.value) {
    groups.push([
      { label: 'Edit barber', icon: 'i-lucide-pencil', onSelect: () => openEdit(row) },
      { label: 'Hapus barber', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => openDelete(row) }
    ]);
  }

  return groups;
};

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
  <Head title="Barber" />

  <AppLayout title="Barber" eyebrow="Staff Operasional">
    <p class="mb-4 text-xs text-zinc-500">
      <span v-if="isSuperAdmin">Menampilkan seluruh barber (super admin).</span>
      <span v-else>Menampilkan barber pada cabang Anda.</span>
      Zona waktu Asia/Jakarta.
    </p>

    <div
      v-if="error"
      class="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </div>

    <!-- Umpan balik aksi -->
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
      <div class="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3">
        <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 class="text-sm font-semibold text-zinc-950">Roster Barber</h2>
            <p class="text-xs text-zinc-500">{{ rangeLabel }} · status live, rating &amp; performa</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UInput
              v-model="filters.q"
              icon="i-lucide-search"
              placeholder="Cari nama barber"
              class="w-full sm:w-56"
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
            <UButton
              v-if="canManageBarber"
              color="primary"
              icon="i-lucide-user-plus"
              @click="openCreate"
            >
              Tambah barber
            </UButton>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <USelect
            v-model="filters.branch_id"
            :items="branchSelectItems"
            value-key="value"
            label-key="label"
            class="w-44"
            icon="i-lucide-store"
          />

          <UPopover>
            <UButton color="neutral" variant="outline" icon="i-lucide-activity" trailing-icon="i-lucide-chevron-down">
              Status<span v-if="filters.live_status.length"> · {{ filters.live_status.length }}</span>
            </UButton>
            <template #content>
              <div class="w-48 space-y-2 p-3">
                <label
                  v-for="opt in STATUS_OPTIONS"
                  :key="opt.value"
                  class="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <UCheckbox
                    :model-value="filters.live_status.includes(opt.value)"
                    @update:model-value="toggleStatusFilter(opt.value)"
                  />
                  {{ opt.label }}
                </label>
              </div>
            </template>
          </UPopover>

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
              <th v-if="isVisible('branch')" class="px-4 py-3">Cabang</th>
              <th v-if="isVisible('staff')" class="px-4 py-3">Akun staff</th>
              <th v-if="isVisible('phone')" class="px-4 py-3">Telepon</th>
              <th v-if="isVisible('status')" class="px-4 py-3">Status</th>
              <th v-if="isVisible('rating')" class="px-4 py-3">Rating</th>
              <th v-if="isVisible('active')" class="px-4 py-3 text-right">Order aktif</th>
              <th v-if="isVisible('completed')" class="px-4 py-3 text-right">Selesai</th>
              <th v-if="isVisible('joined')" class="px-4 py-3">Bergabung</th>
              <th class="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-100">
            <tr v-if="loading">
              <td :colspan="visibleColumnCount" class="px-4 py-10 text-center text-zinc-400">Memuat data…</td>
            </tr>
            <tr v-else-if="rows.length === 0">
              <td :colspan="visibleColumnCount" class="px-4 py-10 text-center text-zinc-400">
                Tidak ada barber yang cocok dengan filter.
              </td>
            </tr>
            <tr v-for="row in rows" v-else :key="row.id" class="hover:bg-zinc-50/60">
              <td v-if="isVisible('name')" class="px-4 py-3 font-medium text-zinc-950">{{ row.display_name }}</td>
              <td v-if="isVisible('branch')" class="px-4 py-3 text-zinc-600">{{ row.branches?.name ?? '—' }}</td>
              <td v-if="isVisible('staff')" class="px-4 py-3 text-zinc-600">{{ row.staff?.full_name ?? '—' }}</td>
              <td v-if="isVisible('phone')" class="whitespace-nowrap px-4 py-3 text-zinc-600">{{ row.staff?.phone ?? '—' }}</td>
              <td v-if="isVisible('status')" class="px-4 py-3">
                <UBadge :color="statusMeta(row.live_status).color" variant="subtle">
                  {{ statusMeta(row.live_status).label }}
                </UBadge>
              </td>
              <td v-if="isVisible('rating')" class="whitespace-nowrap px-4 py-3 text-zinc-700">
                <span v-if="row.rating_avg > 0" class="inline-flex items-center gap-1">
                  <AppIcon name="i-lucide-star" class="size-3.5 text-amber-500" />
                  {{ formatRating(row.rating_avg) }}
                  <span class="text-xs text-zinc-400">({{ row.rating_count }})</span>
                </span>
                <span v-else class="text-zinc-400">—</span>
              </td>
              <td v-if="isVisible('active')" class="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
                {{ row.stats.active_appointments }}
              </td>
              <td v-if="isVisible('completed')" class="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
                {{ row.stats.completed_appointments }}
              </td>
              <td v-if="isVisible('joined')" class="whitespace-nowrap px-4 py-3 text-zinc-500">
                {{ formatDate(row.created_at) }}
              </td>
              <td class="px-4 py-3 text-right">
                <UDropdownMenu :items="rowMenuItems(row)" :content="{ align: 'end' }">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-ellipsis-vertical"
                    :loading="busyId === row.id"
                    aria-label="Aksi barber"
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

    <!-- Slideover detail barber -->
    <USlideover v-model:open="detailOpen" title="Detail Barber" :ui="{ content: 'max-w-md' }">
      <template #body>
        <div v-if="detailRow" class="space-y-5 text-sm">
          <div class="flex items-center gap-3">
            <div class="grid size-12 place-items-center rounded-full bg-emerald-50 text-lg font-semibold text-emerald-700">
              {{ detailRow.display_name.charAt(0).toUpperCase() }}
            </div>
            <div>
              <p class="font-semibold text-zinc-950">{{ detailRow.display_name }}</p>
              <UBadge :color="statusMeta(detailRow.live_status).color" variant="subtle" class="mt-1">
                {{ statusMeta(detailRow.live_status).label }}
              </UBadge>
            </div>
          </div>

          <p v-if="detailRow.bio" class="text-zinc-600">{{ detailRow.bio }}</p>

          <USeparator />

          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Akun staff &amp; cabang</p>
            <dl class="space-y-1">
              <div class="flex items-center gap-2 text-zinc-700">
                <AppIcon name="i-lucide-user" class="size-4 text-zinc-400" />{{ detailRow.staff?.full_name ?? '—' }}
              </div>
              <div class="flex items-center gap-2 text-zinc-700">
                <AppIcon name="i-lucide-phone" class="size-4 text-zinc-400" />{{ detailRow.staff?.phone ?? '—' }}
              </div>
              <div class="flex items-center gap-2 text-zinc-700">
                <AppIcon name="i-lucide-mail" class="size-4 text-zinc-400" />{{ detailRow.staff?.email ?? '—' }}
              </div>
              <div class="flex items-center gap-2 text-zinc-700">
                <AppIcon name="i-lucide-store" class="size-4 text-zinc-400" />{{ detailRow.branches?.name ?? '—' }}
              </div>
            </dl>
          </div>

          <USeparator />

          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Performa</p>
            <dl class="grid grid-cols-2 gap-3">
              <div class="rounded-md bg-zinc-50 p-3">
                <dt class="text-xs text-zinc-500">Rating</dt>
                <dd class="mt-1 text-lg font-semibold text-zinc-950">
                  {{ formatRating(detailRow.rating_avg) }}
                  <span class="text-xs font-normal text-zinc-400">({{ detailRow.rating_count }})</span>
                </dd>
              </div>
              <div class="rounded-md bg-zinc-50 p-3">
                <dt class="text-xs text-zinc-500">Order aktif</dt>
                <dd class="mt-1 text-lg font-semibold text-zinc-950">{{ detailRow.stats.active_appointments }}</dd>
              </div>
              <div class="rounded-md bg-zinc-50 p-3">
                <dt class="text-xs text-zinc-500">Total selesai</dt>
                <dd class="mt-1 text-lg font-semibold text-zinc-950">{{ detailRow.stats.completed_appointments }}</dd>
              </div>
              <div class="rounded-md bg-zinc-50 p-3">
                <dt class="text-xs text-zinc-500">Bergabung</dt>
                <dd class="mt-1 text-sm font-semibold text-zinc-950">{{ formatDate(detailRow.created_at) }}</dd>
              </div>
            </dl>
          </div>

          <USeparator />

          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Ubah status live</p>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="opt in STATUS_OPTIONS"
                :key="opt.value"
                size="sm"
                :color="detailRow.live_status === opt.value ? 'primary' : 'neutral'"
                :variant="detailRow.live_status === opt.value ? 'solid' : 'outline'"
                :disabled="detailRow.live_status === opt.value || busyId === detailRow.id"
                @click="applyStatus(detailRow, opt.value as BarberLiveStatus)"
              >
                {{ opt.label }}
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </USlideover>

    <!-- Slideover jadwal harian barber -->
    <USlideover v-model:open="scheduleOpen" title="Jadwal Barber" :ui="{ content: 'max-w-md' }">
      <template #body>
        <div v-if="scheduleBarber" class="space-y-4 text-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="font-semibold text-zinc-950">{{ scheduleBarber.display_name }}</p>
              <p class="text-xs text-zinc-500">{{ scheduleBarber.branches?.name ?? '—' }}</p>
            </div>
            <UInput v-model="scheduleDate" type="date" class="w-40" />
          </div>

          <USeparator />

          <div v-if="scheduleLoading" class="py-8 text-center text-zinc-400">Memuat jadwal…</div>
          <div v-else-if="!scheduleData || scheduleData.appointments.length === 0" class="py-8 text-center text-zinc-400">
            Tidak ada appointment pada tanggal ini.
          </div>
          <ul v-else class="space-y-2">
            <li
              v-for="item in scheduleData.appointments"
              :key="item.id"
              class="rounded-md border border-zinc-200 p-3"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium text-zinc-900">{{ scheduleTime(item.scheduled_at) }}</span>
                <UBadge :color="statusMeta(item.status).color" variant="subtle">{{ item.status }}</UBadge>
              </div>
              <p class="mt-1 text-zinc-700">{{ scheduleCustomer(item) }}</p>
              <p class="text-xs text-zinc-500">{{ scheduleServices(item) }}</p>
            </li>
          </ul>
        </div>
      </template>
    </USlideover>

    <!-- Modal edit barber (super_admin) -->
    <UModal v-model:open="editOpen" title="Edit Barber">
      <template #body>
        <div v-if="editRow" class="space-y-3 text-sm">
          <p class="text-xs text-zinc-500">
            Mengubah akun kepster (nama, email, telepon) sekaligus profil barbernya.
            Password tidak diatur di sini — kepster mereset lewat admin.
          </p>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Nama lengkap *</label>
            <UInput v-model="editForm.full_name" placeholder="Nama sesuai identitas" class="w-full" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Email *</label>
              <UInput v-model="editForm.email" type="email" placeholder="email@bomb.com" class="w-full" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Telepon</label>
              <UInput v-model="editForm.phone" placeholder="62811…" class="w-full" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Nama tampilan *</label>
              <UInput v-model="editForm.display_name" placeholder="Nama tampilan" class="w-full" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Radius layanan (km)</label>
              <UInput
                v-model.number="editForm.service_radius_km"
                type="number"
                min="0"
                step="1"
                class="w-full"
                icon="i-lucide-radius"
              />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Cabang</label>
              <USelect
                v-model="editForm.branch_id"
                :items="createBranchItems"
                value-key="value"
                label-key="label"
                class="w-full"
                icon="i-lucide-store"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Status</label>
              <USelect
                v-model="editForm.live_status"
                :items="STATUS_OPTIONS"
                value-key="value"
                label-key="label"
                class="w-full"
                icon="i-lucide-activity"
              />
            </div>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Bio</label>
            <UTextarea v-model="editForm.bio" :rows="3" placeholder="Deskripsi singkat…" class="w-full" />
          </div>
          <p v-if="!editRadiusValid" class="text-xs text-red-500">
            Radius layanan harus berupa angka minimal 0.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { editOpen = false; }">Batal</UButton>
          <UButton
            color="primary"
            icon="i-lucide-save"
            :loading="editBusy"
            :disabled="!canSaveEdit"
            @click="saveEdit"
          >
            Simpan
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Modal hapus barber (super_admin) -->
    <UModal v-model:open="deleteOpen" title="Hapus Barber">
      <template #body>
        <p v-if="deleteRow" class="text-sm text-zinc-600">
          Yakin ingin menghapus barber <strong>{{ deleteRow.display_name }}</strong>?
          Tindakan ini tidak dapat dibatalkan.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { deleteOpen = false; }">Batal</UButton>
          <UButton color="error" icon="i-lucide-trash-2" :loading="deleteBusy" @click="confirmDelete">
            Hapus
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Modal tambah barber (super_admin) -->
    <UModal v-model:open="createOpen" title="Tambah Barber">
      <template #body>
        <div class="space-y-3 text-sm">
          <p class="text-xs text-zinc-500">Membuat akun kepster baru (staff + profil barber) langsung ter-approve.</p>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Nama lengkap *</label>
            <UInput v-model="createForm.full_name" placeholder="Nama lengkap" class="w-full" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Email *</label>
              <UInput v-model="createForm.email" type="email" placeholder="email@bomb.com" class="w-full" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Password *</label>
              <UInput v-model="createForm.password" type="password" placeholder="Min 6 karakter" class="w-full" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Telepon</label>
              <UInput v-model="createForm.phone" placeholder="62811…" class="w-full" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Nama tampilan</label>
              <UInput v-model="createForm.display_name" placeholder="Default = nama lengkap" class="w-full" />
            </div>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Cabang</label>
            <USelect
              v-model="createForm.branch_id"
              :items="createBranchItems"
              value-key="value"
              label-key="label"
              class="w-full"
              icon="i-lucide-store"
            />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { createOpen = false; }">Batal</UButton>
          <UButton
            color="primary"
            icon="i-lucide-user-plus"
            :loading="createBusy"
            :disabled="!canCreate"
            @click="saveCreate"
          >
            Tambah
          </UButton>
        </div>
      </template>
    </UModal>
  </AppLayout>
</template>
