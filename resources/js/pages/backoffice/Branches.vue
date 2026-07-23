<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UCard from '@nuxt/ui/components/Card.vue';
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import USelect from '@nuxt/ui/components/Select.vue';
import USeparator from '@nuxt/ui/components/Separator.vue';
import USlideover from '@nuxt/ui/components/Slideover.vue';
import UTextarea from '@nuxt/ui/components/Textarea.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import AppLayout from '../../layouts/AppLayout.vue';
import {
  createBranch,
  deleteBranch,
  fetchAdminBranches,
  fetchBranchOperatingHours,
  getStoredStaff,
  updateBranch,
  updateBranchOperatingHours,
  type AdminBranch,
  type BranchOperatingHour,
  type BranchPayload
} from '../../lib/api';

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

const ALL = 'all';
const staff = getStoredStaff();
const canManageBranch = computed(
  () => Boolean(staff?.is_global) || (staff?.permissions ?? []).includes('manage_branch')
);

const filters = reactive({
  q: '',
  status: ALL,
  coordinate: ALL,
  region_id: ALL,
  sort: 'name',
  order: 'asc'
});

const rows = ref<AdminBranch[]>([]);
const loading = ref(true);
const error = ref('');
const busyId = ref<string | null>(null);

const actionMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);
let messageTimer: ReturnType<typeof setTimeout> | undefined;
const flash = (type: 'success' | 'error', text: string) => {
  actionMessage.value = { type, text };
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (actionMessage.value = null), 3500);
};

const numberFmt = new Intl.NumberFormat('id-ID');
const formatNumber = (value: number) => numberFmt.format(Number.isFinite(value) ? value : 0);

const shortId = (id: string | null) => {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
};

const hasCoordinates = (branch: AdminBranch) =>
  branch.latitude != null &&
  branch.longitude != null &&
  Number.isFinite(branch.latitude) &&
  Number.isFinite(branch.longitude);

const coordinateText = (branch: AdminBranch) =>
  hasCoordinates(branch)
    ? `${branch.latitude?.toFixed(6)}, ${branch.longitude?.toFixed(6)}`
    : '—';

const statusMeta = (branch: AdminBranch): { label: string; color: BadgeColor } =>
  branch.is_active ? { label: 'Aktif', color: 'success' } : { label: 'Nonaktif', color: 'neutral' };

const STATUS_OPTIONS = [
  { value: ALL, label: 'Semua status' },
  { value: 'active', label: 'Aktif' },
  { value: 'inactive', label: 'Nonaktif' }
];

const COORDINATE_OPTIONS = [
  { value: ALL, label: 'Semua koordinat' },
  { value: 'complete', label: 'Koordinat lengkap' },
  { value: 'missing', label: 'Koordinat kosong' }
];

const SORT_OPTIONS = [
  { value: 'name', label: 'Nama cabang' },
  { value: 'status', label: 'Status' },
  { value: 'region_id', label: 'Region' },
  { value: 'created_quality', label: 'Kelengkapan data' }
];

const ORDER_OPTIONS = [
  { value: 'asc', label: 'Naik' },
  { value: 'desc', label: 'Turun' }
];
const FORM_STATUS_OPTIONS = [
  { value: 'active', label: 'Aktif' },
  { value: 'inactive', label: 'Nonaktif' }
];

const regionOptions = computed(() => {
  const unique = [...new Set(rows.value.map((b) => b.region_id).filter((id): id is string => Boolean(id)))];
  return [
    { value: ALL, label: 'Semua region' },
    ...unique.sort((a, b) => a.localeCompare(b)).map((id) => ({ value: id, label: `Region ${shortId(id)}` }))
  ];
});

const completenessScore = (branch: AdminBranch) =>
  Number(Boolean(branch.address)) +
  Number(Boolean(branch.phone)) +
  Number(hasCoordinates(branch)) +
  Number(Boolean(branch.region_id));

const matchesSearch = (branch: AdminBranch) => {
  const q = filters.q.trim().toLowerCase();
  if (!q) return true;
  return [
    branch.name,
    branch.address,
    branch.phone,
    branch.region_id,
    branch.id,
    coordinateText(branch)
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(q));
};

const filteredBranches = computed(() => {
  const data = rows.value.filter((branch) => {
    if (!matchesSearch(branch)) return false;
    if (filters.status === 'active' && !branch.is_active) return false;
    if (filters.status === 'inactive' && branch.is_active) return false;
    if (filters.coordinate === 'complete' && !hasCoordinates(branch)) return false;
    if (filters.coordinate === 'missing' && hasCoordinates(branch)) return false;
    if (filters.region_id !== ALL && branch.region_id !== filters.region_id) return false;
    return true;
  });

  const direction = filters.order === 'desc' ? -1 : 1;
  return [...data].sort((a, b) => {
    if (filters.sort === 'status') return (Number(a.is_active) - Number(b.is_active)) * direction;
    if (filters.sort === 'region_id') return ((a.region_id ?? '').localeCompare(b.region_id ?? '')) * direction;
    if (filters.sort === 'created_quality') return (completenessScore(a) - completenessScore(b)) * direction;
    return a.name.localeCompare(b.name) * direction;
  });
});

const countWhere = (predicate: (branch: AdminBranch) => boolean) =>
  filteredBranches.value.filter(predicate).length;

const metrics = computed(() => {
  const total = filteredBranches.value.length;
  const active = countWhere((branch) => branch.is_active);
  const withCoordinates = countWhere(hasCoordinates);
  const incomplete = countWhere((branch) => completenessScore(branch) < 4);
  return [
    { label: 'Cabang terfilter', value: formatNumber(total), icon: 'i-lucide-store' },
    { label: 'Cabang aktif', value: formatNumber(active), icon: 'i-lucide-circle-check' },
    { label: 'Koordinat valid', value: formatNumber(withCoordinates), icon: 'i-lucide-map-pinned' },
    { label: 'Data belum lengkap', value: formatNumber(incomplete), icon: 'i-lucide-triangle-alert' }
  ];
});

const coverage = computed(() => {
  const total = filteredBranches.value.length || 0;
  const value = (count: number) => `${formatNumber(count)}/${formatNumber(total)}`;
  return [
    { label: 'Status aktif', value: value(countWhere((branch) => branch.is_active)) },
    { label: 'Alamat terisi', value: value(countWhere((branch) => Boolean(branch.address))) },
    { label: 'Nomor telepon terisi', value: value(countWhere((branch) => Boolean(branch.phone))) },
    { label: 'Koordinat lengkap', value: value(countWhere(hasCoordinates)) },
    { label: 'Region terhubung', value: value(countWhere((branch) => Boolean(branch.region_id))) }
  ];
});

const resetFilters = () => {
  filters.q = '';
  filters.status = ALL;
  filters.coordinate = ALL;
  filters.region_id = ALL;
  filters.sort = 'name';
  filters.order = 'asc';
};

const numericOrNull = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstRegionId = () => rows.value.find((branch) => branch.region_id)?.region_id ?? '';

const copyText = async (label: string, value: string | null) => {
  if (!value) {
    flash('error', `${label} tidak tersedia.`);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    flash('success', `${label} disalin.`);
  } catch {
    flash('error', `Gagal menyalin ${label.toLowerCase()}.`);
  }
};

const openMaps = (branch: AdminBranch) => {
  if (!hasCoordinates(branch)) {
    flash('error', 'Koordinat cabang belum lengkap.');
    return;
  }
  window.open(
    `https://www.google.com/maps/search/?api=1&query=${branch.latitude},${branch.longitude}`,
    '_blank',
    'noopener'
  );
};

const detailOpen = ref(false);
const detailRow = ref<AdminBranch | null>(null);
const openDetail = (branch: AdminBranch) => {
  detailRow.value = branch;
  detailOpen.value = true;
};

const createOpen = ref(false);
const createBusy = ref(false);
const createForm = reactive({
  name: '',
  region_id: '',
  address: '',
  phone: '',
  latitude: '',
  longitude: '',
  status: 'active'
});
const canSaveCreate = computed(() => createForm.name.trim().length >= 2 && createForm.region_id.trim().length > 0);
const openCreate = () => {
  createForm.name = '';
  createForm.region_id = firstRegionId();
  createForm.address = '';
  createForm.phone = '';
  createForm.latitude = '';
  createForm.longitude = '';
  createForm.status = 'active';
  createOpen.value = true;
};
const branchPayloadFromForm = (form: typeof createForm): BranchPayload => ({
  name: form.name.trim(),
  region_id: form.region_id.trim(),
  address: form.address.trim() || null,
  phone: form.phone.trim() || null,
  latitude: numericOrNull(form.latitude),
  longitude: numericOrNull(form.longitude),
  is_active: form.status === 'active'
});
const saveCreate = async () => {
  if (!canSaveCreate.value || createBusy.value) return;
  createBusy.value = true;
  try {
    const branch = await createBranch(branchPayloadFromForm(createForm));
    rows.value = [...rows.value, branch];
    createOpen.value = false;
    flash('success', `Cabang ${branch.name} berhasil ditambahkan.`);
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal menambahkan cabang.');
  } finally {
    createBusy.value = false;
  }
};

const editOpen = ref(false);
const editBusy = ref(false);
const editRow = ref<AdminBranch | null>(null);
const editForm = reactive({ ...createForm });
const canSaveEdit = computed(() => Boolean(editRow.value) && editForm.name.trim().length >= 2);
const openEdit = (branch: AdminBranch) => {
  editRow.value = branch;
  editForm.name = branch.name;
  editForm.region_id = branch.region_id ?? '';
  editForm.address = branch.address ?? '';
  editForm.phone = branch.phone ?? '';
  editForm.latitude = branch.latitude == null ? '' : String(branch.latitude);
  editForm.longitude = branch.longitude == null ? '' : String(branch.longitude);
  editForm.status = branch.is_active ? 'active' : 'inactive';
  editOpen.value = true;
};
const replaceBranch = (branch: AdminBranch) => {
  rows.value = rows.value.map((item) => (item.id === branch.id ? branch : item));
  if (detailRow.value?.id === branch.id) detailRow.value = branch;
};
const saveEdit = async () => {
  if (!editRow.value || !canSaveEdit.value || editBusy.value) return;
  editBusy.value = true;
  try {
    const branch = await updateBranch(editRow.value.id, branchPayloadFromForm(editForm));
    replaceBranch(branch);
    editOpen.value = false;
    flash('success', `Cabang ${branch.name} berhasil diperbarui.`);
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal memperbarui cabang.');
  } finally {
    editBusy.value = false;
  }
};

const toggleActive = async (branch: AdminBranch) => {
  if (busyId.value) return;
  busyId.value = branch.id;
  try {
    const updated = await updateBranch(branch.id, { is_active: !branch.is_active });
    replaceBranch(updated);
    flash('success', `${updated.name} sekarang ${updated.is_active ? 'aktif' : 'nonaktif'}.`);
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal mengubah status cabang.');
  } finally {
    busyId.value = null;
  }
};

const deleteOpen = ref(false);
const deleteBusy = ref(false);
const deleteRow = ref<AdminBranch | null>(null);
const openDelete = (branch: AdminBranch) => {
  deleteRow.value = branch;
  deleteOpen.value = true;
};
const confirmDelete = async () => {
  if (!deleteRow.value || deleteBusy.value) return;
  deleteBusy.value = true;
  try {
    await deleteBranch(deleteRow.value.id);
    rows.value = rows.value.filter((branch) => branch.id !== deleteRow.value?.id);
    flash('success', `Cabang ${deleteRow.value.name} berhasil dihapus.`);
    deleteOpen.value = false;
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal menghapus cabang.');
  } finally {
    deleteBusy.value = false;
  }
};

/* ------------------------------------------------------------------ */
/* Jam operasional (buka/tutup per hari, 0=Minggu .. 6=Sabtu)          */
/* ------------------------------------------------------------------ */

const DAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const DEFAULT_OPEN = '08:00';
const DEFAULT_CLOSE = '22:00';

type HoursDraft = {
  day_of_week: number;
  is_closed: boolean;
  open_time: string;
  close_time: string;
};

const hoursOpen = ref(false);
const hoursLoading = ref(false);
const hoursBusy = ref(false);
const hoursRow = ref<AdminBranch | null>(null);
const hoursError = ref('');
const hoursForm = ref<HoursDraft[]>([]);

// Susun tepat 7 hari (0..6) dari respons backend yang mungkin belum lengkap.
const buildHoursDraft = (rows: BranchOperatingHour[]): HoursDraft[] => {
  const byDay = new Map(rows.map((r) => [r.day_of_week, r]));
  return Array.from({ length: 7 }, (_, day) => {
    const row = byDay.get(day);
    return {
      day_of_week: day,
      is_closed: Boolean(row?.is_closed),
      open_time: row?.open_time ?? DEFAULT_OPEN,
      close_time: row?.close_time ?? DEFAULT_CLOSE
    };
  });
};

const openHours = async (branch: AdminBranch) => {
  hoursRow.value = branch;
  hoursError.value = '';
  hoursForm.value = buildHoursDraft([]);
  hoursOpen.value = true;
  hoursLoading.value = true;
  try {
    hoursForm.value = buildHoursDraft(await fetchBranchOperatingHours(branch.id));
  } catch (err) {
    hoursError.value = err instanceof Error ? err.message : 'Gagal memuat jam operasional.';
  } finally {
    hoursLoading.value = false;
  }
};

// Salin jam hari pertama yang buka ke seluruh hari yang buka.
const applyHoursToAll = () => {
  const source = hoursForm.value.find((d) => !d.is_closed) ?? hoursForm.value[0];
  if (!source) return;
  for (const day of hoursForm.value) {
    if (day.is_closed) continue;
    day.open_time = source.open_time;
    day.close_time = source.close_time;
  }
};

const invalidHourDays = computed(() =>
  hoursForm.value
    .filter((d) => !d.is_closed)
    .filter((d) => !d.open_time || !d.close_time || d.open_time >= d.close_time)
    .map((d) => d.day_of_week)
);

const canSaveHours = computed(
  () => Boolean(hoursRow.value) && !hoursLoading.value && invalidHourDays.value.length === 0
);

const saveHours = async () => {
  if (!hoursRow.value || !canSaveHours.value || hoursBusy.value) return;
  hoursBusy.value = true;
  hoursError.value = '';
  try {
    const payload: BranchOperatingHour[] = hoursForm.value.map((d) => ({
      day_of_week: d.day_of_week,
      is_closed: d.is_closed,
      open_time: d.is_closed ? null : d.open_time,
      close_time: d.is_closed ? null : d.close_time
    }));
    await updateBranchOperatingHours(hoursRow.value.id, payload);
    hoursOpen.value = false;
    flash('success', `Jam operasional ${hoursRow.value.name} berhasil disimpan.`);
  } catch (err) {
    hoursError.value = err instanceof Error ? err.message : 'Gagal menyimpan jam operasional.';
  } finally {
    hoursBusy.value = false;
  }
};

const rowMenuItems = (branch: AdminBranch) => [
  [
    { label: 'Lihat detail', icon: 'i-lucide-eye', onSelect: () => openDetail(branch) },
    { label: 'Buka maps', icon: 'i-lucide-map-pinned', onSelect: () => openMaps(branch) }
  ],
  [
    { label: 'Salin ID cabang', icon: 'i-lucide-copy', onSelect: () => copyText('ID cabang', branch.id) },
    { label: 'Salin koordinat', icon: 'i-lucide-locate-fixed', onSelect: () => copyText('Koordinat', hasCoordinates(branch) ? coordinateText(branch) : null) },
    { label: 'Salin telepon', icon: 'i-lucide-phone', onSelect: () => copyText('Telepon', branch.phone) }
  ],
  ...(canManageBranch.value
    ? [
        [
          { label: 'Edit cabang', icon: 'i-lucide-pencil', onSelect: () => openEdit(branch) },
          { label: 'Atur jam operasional', icon: 'i-lucide-clock', onSelect: () => openHours(branch) },
          {
            label: branch.is_active ? 'Nonaktifkan' : 'Aktifkan',
            icon: branch.is_active ? 'i-lucide-circle-off' : 'i-lucide-circle-check',
            onSelect: () => toggleActive(branch)
          }
        ],
        [{ label: 'Hapus cabang', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => openDelete(branch) }]
      ]
    : [])
];

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    rows.value = await fetchAdminBranches();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Gagal memuat data cabang.';
  } finally {
    loading.value = false;
  }
};

onMounted(load);
</script>

<template>
  <Head title="Cabang" />

  <AppLayout title="Cabang" eyebrow="Master Data">
    <div
      v-if="error"
      class="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </div>
    <div
      v-if="actionMessage"
      class="mb-4 rounded-md border px-4 py-3 text-sm"
      :class="actionMessage.type === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-red-200 bg-red-50 text-red-700'"
    >
      {{ actionMessage.text }}
    </div>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <template v-if="loading">
        <UCard v-for="n in 4" :key="n" :ui="{ root: 'rounded-md' }">
          <div class="animate-pulse space-y-3">
            <div class="h-3 w-24 rounded bg-zinc-200" />
            <div class="h-6 w-20 rounded bg-zinc-200" />
          </div>
        </UCard>
      </template>
      <UCard v-for="metric in metrics" v-else :key="metric.label" :ui="{ root: 'rounded-md' }">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm text-zinc-500">{{ metric.label }}</p>
            <p class="mt-2 text-2xl font-semibold text-zinc-950">{{ metric.value }}</p>
          </div>
          <AppIcon :name="metric.icon" class="size-5 text-emerald-700" />
        </div>
      </UCard>
    </div>

    <div class="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section class="rounded-md border border-zinc-200 bg-white">
        <div class="border-b border-zinc-200 px-4 py-3">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 class="text-sm font-semibold text-zinc-950">Daftar Cabang</h2>
              <p class="text-xs text-zinc-500">
                Data berasal dari endpoint cabang admin dan mengikuti scope RBAC akun.
              </p>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row">
              <UButton
                v-if="canManageBranch"
                color="primary"
                icon="i-lucide-plus"
                @click="openCreate"
              >
                Tambah
              </UButton>
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                :loading="loading"
                @click="load"
              >
                Refresh
              </UButton>
              <UButton color="neutral" variant="soft" icon="i-lucide-rotate-ccw" @click="resetFilters">
                Reset
              </UButton>
            </div>
          </div>

          <div class="mt-4 grid gap-3 lg:grid-cols-5">
            <UInput
              v-model="filters.q"
              icon="i-lucide-search"
              placeholder="Cari nama, alamat, telepon, region"
              class="lg:col-span-2"
            />
            <USelect v-model="filters.status" :items="STATUS_OPTIONS" />
            <USelect v-model="filters.coordinate" :items="COORDINATE_OPTIONS" />
            <USelect v-model="filters.region_id" :items="regionOptions" />
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <USelect v-model="filters.sort" :items="SORT_OPTIONS" />
            <USelect v-model="filters.order" :items="ORDER_OPTIONS" />
            <div class="flex items-center text-xs text-zinc-500 sm:col-span-2">
              Menampilkan {{ filteredBranches.length }} dari {{ rows.length }} cabang.
            </div>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-zinc-200 text-sm">
            <thead class="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th class="px-4 py-3">Cabang</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3">Alamat</th>
                <th class="px-4 py-3">Telepon</th>
                <th class="px-4 py-3">Koordinat</th>
                <th class="px-4 py-3">Region</th>
                <th class="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-100">
              <tr v-if="loading">
                <td class="px-4 py-6 text-center text-zinc-400" colspan="7">Memuat data cabang…</td>
              </tr>
              <tr v-else-if="filteredBranches.length === 0">
                <td class="px-4 py-6 text-center text-zinc-400" colspan="7">Tidak ada cabang sesuai filter.</td>
              </tr>
              <tr v-for="branch in filteredBranches" v-else :key="branch.id">
                <td class="px-4 py-3">
                  <p class="font-medium text-zinc-950">{{ branch.name }}</p>
                  <p class="text-xs text-zinc-500">{{ shortId(branch.id) }}</p>
                </td>
                <td class="px-4 py-3">
                  <UBadge :color="statusMeta(branch).color" variant="subtle">
                    {{ statusMeta(branch).label }}
                  </UBadge>
                </td>
                <td class="max-w-80 px-4 py-3 text-zinc-700">
                  <span class="line-clamp-2">{{ branch.address ?? '—' }}</span>
                </td>
                <td class="px-4 py-3 text-zinc-700">{{ branch.phone ?? '—' }}</td>
                <td class="px-4 py-3 font-mono text-xs text-zinc-700">{{ coordinateText(branch) }}</td>
                <td class="px-4 py-3 text-zinc-700">{{ shortId(branch.region_id) }}</td>
                <td class="px-4 py-3 text-right">
                  <UDropdownMenu :items="rowMenuItems(branch)" :content="{ align: 'end' }">
                    <UButton
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-ellipsis-vertical"
                      :loading="busyId === branch.id"
                      aria-label="Aksi cabang"
                    />
                  </UDropdownMenu>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="rounded-md border border-zinc-200 bg-white p-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold text-zinc-950">Kelengkapan Data</h2>
          <UBadge color="neutral" variant="outline">{{ filteredBranches.length }} cabang</UBadge>
        </div>
        <div class="mt-4 space-y-4">
          <div v-for="item in coverage" :key="item.label" class="flex items-center justify-between gap-3">
            <span class="text-sm text-zinc-700">{{ item.label }}</span>
            <span class="text-sm font-semibold text-zinc-950">{{ item.value }}</span>
          </div>
        </div>
      </section>
    </div>

    <USlideover v-model:open="detailOpen" title="Detail Cabang" :ui="{ content: 'max-w-md' }">
      <template #body>
        <div v-if="detailRow" class="space-y-5 text-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-lg font-semibold text-zinc-950">{{ detailRow.name }}</p>
              <p class="mt-1 font-mono text-xs text-zinc-500">{{ detailRow.id }}</p>
            </div>
            <UBadge :color="statusMeta(detailRow).color" variant="subtle">{{ statusMeta(detailRow).label }}</UBadge>
          </div>

          <USeparator />

          <dl class="space-y-3 text-zinc-700">
            <div>
              <dt class="text-xs font-semibold uppercase tracking-wide text-zinc-400">Alamat</dt>
              <dd class="mt-1">{{ detailRow.address ?? '—' }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-zinc-500">Telepon</dt>
              <dd>{{ detailRow.phone ?? '—' }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-zinc-500">Region</dt>
              <dd class="font-mono text-xs">{{ detailRow.region_id ?? '—' }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-zinc-500">Koordinat</dt>
              <dd class="font-mono text-xs">{{ coordinateText(detailRow) }}</dd>
            </div>
          </dl>

          <USeparator />

          <div class="grid grid-cols-2 gap-2">
            <UButton color="neutral" variant="soft" icon="i-lucide-copy" @click="copyText('ID cabang', detailRow.id)">
              Salin ID
            </UButton>
            <UButton color="neutral" variant="soft" icon="i-lucide-map-pinned" @click="openMaps(detailRow)">
              Maps
            </UButton>
            <UButton
              v-if="canManageBranch"
              color="neutral"
              variant="soft"
              icon="i-lucide-pencil"
              @click="openEdit(detailRow)"
            >
              Edit
            </UButton>
            <UButton
              v-if="canManageBranch"
              color="neutral"
              variant="soft"
              icon="i-lucide-clock"
              @click="openHours(detailRow)"
            >
              Jam operasional
            </UButton>
            <UButton
              v-if="canManageBranch"
              color="neutral"
              variant="soft"
              :icon="detailRow.is_active ? 'i-lucide-circle-off' : 'i-lucide-circle-check'"
              :loading="busyId === detailRow.id"
              @click="toggleActive(detailRow)"
            >
              {{ detailRow.is_active ? 'Nonaktifkan' : 'Aktifkan' }}
            </UButton>
          </div>
        </div>
      </template>
    </USlideover>

    <UModal v-model:open="createOpen" title="Tambah Cabang">
      <template #body>
        <div class="space-y-3 text-sm">
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Nama cabang *</label>
            <UInput v-model="createForm.name" placeholder="Bomb Barbershop ..." class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Region ID *</label>
            <UInput v-model="createForm.region_id" placeholder="UUID region" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Alamat</label>
            <UTextarea v-model="createForm.address" :rows="3" placeholder="Alamat lengkap" class="w-full" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Telepon</label>
              <UInput v-model="createForm.phone" placeholder="021..." class="w-full" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Status</label>
              <USelect v-model="createForm.status" :items="FORM_STATUS_OPTIONS" class="w-full" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Latitude</label>
              <UInput v-model="createForm.latitude" inputmode="decimal" placeholder="-6.175662" class="w-full" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Longitude</label>
              <UInput v-model="createForm.longitude" inputmode="decimal" placeholder="106.599256" class="w-full" />
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { createOpen = false; }">Batal</UButton>
          <UButton color="primary" icon="i-lucide-save" :loading="createBusy" :disabled="!canSaveCreate" @click="saveCreate">
            Simpan
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="editOpen" title="Edit Cabang">
      <template #body>
        <div v-if="editRow" class="space-y-3 text-sm">
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Nama cabang *</label>
            <UInput v-model="editForm.name" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Region ID</label>
            <UInput v-model="editForm.region_id" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Alamat</label>
            <UTextarea v-model="editForm.address" :rows="3" class="w-full" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Telepon</label>
              <UInput v-model="editForm.phone" class="w-full" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Status</label>
              <USelect v-model="editForm.status" :items="FORM_STATUS_OPTIONS" class="w-full" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Latitude</label>
              <UInput v-model="editForm.latitude" inputmode="decimal" class="w-full" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-500">Longitude</label>
              <UInput v-model="editForm.longitude" inputmode="decimal" class="w-full" />
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { editOpen = false; }">Batal</UButton>
          <UButton color="primary" icon="i-lucide-save" :loading="editBusy" :disabled="!canSaveEdit" @click="saveEdit">
            Simpan
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="hoursOpen"
      :title="hoursRow ? `Jam Operasional — ${hoursRow.name}` : 'Jam Operasional'"
      :ui="{ content: 'max-w-lg' }"
    >
      <template #body>
        <div class="space-y-3 text-sm">
          <p class="text-xs text-zinc-500">
            Atur jam buka dan tutup layanan tiap hari. Tandai hari libur agar cabang tidak menerima
            pesanan pada hari tersebut. Jam tutup harus setelah jam buka.
          </p>

          <div
            v-if="hoursError"
            class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            {{ hoursError }}
          </div>

          <div v-if="hoursLoading" class="py-6 text-center text-zinc-400">
            Memuat jam operasional…
          </div>

          <div v-else class="space-y-2">
            <div class="flex justify-end">
              <UButton
                color="neutral"
                variant="soft"
                size="xs"
                icon="i-lucide-copy"
                @click="applyHoursToAll"
              >
                Samakan semua hari
              </UButton>
            </div>

            <div
              v-for="day in hoursForm"
              :key="day.day_of_week"
              class="grid grid-cols-[5.5rem_1fr_1fr_auto] items-center gap-2 rounded-md border border-zinc-200 px-3 py-2"
              :class="{ 'bg-zinc-50': day.is_closed }"
            >
              <span class="text-sm font-medium text-zinc-700">{{ DAY_LABELS[day.day_of_week] }}</span>
              <UInput
                v-model="day.open_time"
                type="time"
                :disabled="day.is_closed"
                :color="!day.is_closed && invalidHourDays.includes(day.day_of_week) ? 'error' : 'neutral'"
                class="w-full"
              />
              <UInput
                v-model="day.close_time"
                type="time"
                :disabled="day.is_closed"
                :color="!day.is_closed && invalidHourDays.includes(day.day_of_week) ? 'error' : 'neutral'"
                class="w-full"
              />
              <label class="flex items-center gap-1.5 text-xs text-zinc-500">
                <input v-model="day.is_closed" type="checkbox" class="size-4 accent-emerald-600" />
                Libur
              </label>
            </div>

            <p v-if="invalidHourDays.length" class="text-xs text-red-600">
              Periksa jam pada:
              {{ invalidHourDays.map((d) => DAY_LABELS[d]).join(', ') }}
              — jam tutup harus setelah jam buka.
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { hoursOpen = false; }">Batal</UButton>
          <UButton
            color="primary"
            icon="i-lucide-save"
            :loading="hoursBusy"
            :disabled="!canSaveHours"
            @click="saveHours"
          >
            Simpan
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="deleteOpen" title="Hapus Cabang">
      <template #body>
        <p v-if="deleteRow" class="text-sm text-zinc-600">
          Yakin ingin menghapus cabang <strong>{{ deleteRow.name }}</strong>?
          Backend akan melakukan soft delete agar histori operasional tetap aman.
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
  </AppLayout>
</template>
