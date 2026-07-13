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
import { computed, onMounted, reactive, ref } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import AppLayout from '../../layouts/AppLayout.vue';
import {
  assignStaffRole,
  fetchAdminBranches,
  fetchRoles,
  fetchStaffRoles,
  fetchStaffUsers,
  getStoredStaff,
  revokeStaffRole,
  type AdminBranch,
  type AdminRole,
  type StaffRoleAssignment,
  type StaffUserRow
} from '../../lib/api';
import { jakartaDateStamp } from '../../lib/timezone';

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

const ALL = 'all';
const GLOBAL = 'global';
const staff = getStoredStaff();
const isGlobalStaff = computed(() => Boolean(staff?.is_global) || (staff?.roles ?? []).includes('super_admin'));

const rows = ref<StaffUserRow[]>([]);
const roles = ref<AdminRole[]>([]);
const branches = ref<AdminBranch[]>([]);
const loading = ref(true);
const error = ref('');

const filters = reactive({
  q: '',
  status: ALL,
  role_id: ALL,
  branch_id: ALL,
  scope: ALL,
  sort: 'full_name',
  order: 'asc'
});

const numberFmt = new Intl.NumberFormat('id-ID');
const dateFmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});
const formatNumber = (value: number) => numberFmt.format(Number.isFinite(value) ? value : 0);
const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateFmt.format(date);
};
const shortId = (id: string | null) => {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
};

const roleName = (assignment: StaffRoleAssignment) => assignment.role?.name ?? '—';
const branchName = (assignment: StaffRoleAssignment) => assignment.branch?.name ?? 'Global / HQ';
const uniqueRoleNames = (user: StaffUserRow) =>
  [...new Set(user.staff_user_roles.map(roleName).filter((name) => name !== '—'))];
const uniqueBranchNames = (user: StaffUserRow) =>
  [...new Set(user.staff_user_roles.map(branchName))];
const userHasGlobalRole = (user: StaffUserRow) => user.staff_user_roles.some((assignment) => !assignment.branch_id);

const statusMeta = (user: StaffUserRow): { label: string; color: BadgeColor } =>
  user.is_active ? { label: 'Aktif', color: 'success' } : { label: 'Nonaktif', color: 'neutral' };

const STATUS_OPTIONS = [
  { value: ALL, label: 'Semua status' },
  { value: 'active', label: 'Aktif' },
  { value: 'inactive', label: 'Nonaktif' }
];
const SCOPE_OPTIONS = [
  { value: ALL, label: 'Semua scope' },
  { value: GLOBAL, label: 'Global / HQ' },
  { value: 'branch', label: 'Cabang' },
  { value: 'none', label: 'Belum ada role' }
];
const SORT_OPTIONS = [
  { value: 'full_name', label: 'Nama' },
  { value: 'email', label: 'Email' },
  { value: 'role_count', label: 'Jumlah role' },
  { value: 'created_at', label: 'Tanggal dibuat' }
];
const ORDER_OPTIONS = [
  { value: 'asc', label: 'Naik' },
  { value: 'desc', label: 'Turun' }
];

const roleOptions = computed(() => [
  { value: ALL, label: 'Semua role' },
  ...roles.value.map((role) => ({ value: role.id, label: role.name }))
]);
const branchOptions = computed(() => [
  { value: ALL, label: 'Semua cabang' },
  { value: GLOBAL, label: 'Global / HQ' },
  ...branches.value.map((branch) => ({ value: branch.id, label: branch.name }))
]);
const assignBranchOptions = computed(() => [
  ...(isGlobalStaff.value ? [{ value: GLOBAL, label: 'Global / HQ' }] : []),
  ...branches.value.map((branch) => ({ value: branch.id, label: branch.name }))
]);

const actionMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);
let messageTimer: ReturnType<typeof setTimeout> | undefined;
const flash = (type: 'success' | 'error', text: string) => {
  actionMessage.value = { type, text };
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (actionMessage.value = null), 3500);
};

const matchesSearch = (user: StaffUserRow) => {
  const q = filters.q.trim().toLowerCase();
  if (!q) return true;
  return [
    user.id,
    user.full_name,
    user.email,
    user.phone,
    ...uniqueRoleNames(user),
    ...uniqueBranchNames(user)
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(q));
};

const filteredUsers = computed(() => {
  const data = rows.value.filter((user) => {
    if (!matchesSearch(user)) return false;
    if (filters.status === 'active' && !user.is_active) return false;
    if (filters.status === 'inactive' && user.is_active) return false;
    if (filters.role_id !== ALL && !user.staff_user_roles.some((a) => a.role?.id === filters.role_id)) return false;
    if (filters.branch_id === GLOBAL && !userHasGlobalRole(user)) return false;
    if (filters.branch_id !== ALL && filters.branch_id !== GLOBAL && !user.staff_user_roles.some((a) => a.branch_id === filters.branch_id)) return false;
    if (filters.scope === GLOBAL && !userHasGlobalRole(user)) return false;
    if (filters.scope === 'branch' && !user.staff_user_roles.some((a) => Boolean(a.branch_id))) return false;
    if (filters.scope === 'none' && user.staff_user_roles.length > 0) return false;
    return true;
  });

  const direction = filters.order === 'desc' ? -1 : 1;
  return [...data].sort((a, b) => {
    if (filters.sort === 'email') return a.email.localeCompare(b.email) * direction;
    if (filters.sort === 'role_count') return (a.staff_user_roles.length - b.staff_user_roles.length) * direction;
    if (filters.sort === 'created_at') return ((a.created_at ?? '').localeCompare(b.created_at ?? '')) * direction;
    return a.full_name.localeCompare(b.full_name) * direction;
  });
});

const metrics = computed(() => [
  { label: 'User terfilter', value: formatNumber(filteredUsers.value.length), icon: 'i-lucide-users' },
  { label: 'Aktif', value: formatNumber(filteredUsers.value.filter((user) => user.is_active).length), icon: 'i-lucide-user-check' },
  { label: 'Role global', value: formatNumber(filteredUsers.value.filter(userHasGlobalRole).length), icon: 'i-lucide-globe-2' },
  { label: 'Belum ada role', value: formatNumber(filteredUsers.value.filter((user) => user.staff_user_roles.length === 0).length), icon: 'i-lucide-user-x' }
]);

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    const [staffRows, roleRows, branchRows] = await Promise.all([
      fetchStaffUsers(),
      fetchRoles(),
      fetchAdminBranches()
    ]);
    rows.value = staffRows;
    roles.value = roleRows;
    branches.value = branchRows;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Gagal memuat data user.';
  } finally {
    loading.value = false;
  }
};

const resetFilters = () => {
  filters.q = '';
  filters.status = ALL;
  filters.role_id = ALL;
  filters.branch_id = ALL;
  filters.scope = ALL;
  filters.sort = 'full_name';
  filters.order = 'asc';
};

const replaceUserRoles = (userId: string, assignments: StaffRoleAssignment[]) => {
  rows.value = rows.value.map((user) =>
    user.id === userId ? { ...user, staff_user_roles: assignments } : user
  );
  if (detailRow.value?.id === userId) {
    detailRow.value = { ...detailRow.value, staff_user_roles: assignments };
  }
};

const refreshUserRoles = async (userId: string) => {
  const assignments = await fetchStaffRoles(userId);
  replaceUserRoles(userId, assignments);
};

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

const openEmail = (user: StaffUserRow) => {
  if (!user.email) return;
  window.location.href = `mailto:${user.email}`;
};
const openWhatsApp = (user: StaffUserRow) => {
  const digits = (user.phone ?? '').replace(/\D/g, '');
  if (!digits) {
    flash('error', 'Nomor telepon tidak tersedia.');
    return;
  }
  window.open(`https://wa.me/${digits}`, '_blank', 'noopener');
};

const csvValue = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const exportCsv = () => {
  const header = ['id', 'name', 'email', 'phone', 'status', 'roles', 'branches', 'created_at'];
  const lines = filteredUsers.value.map((user) =>
    [
      user.id,
      user.full_name,
      user.email,
      user.phone,
      user.is_active ? 'active' : 'inactive',
      uniqueRoleNames(user).join('|'),
      uniqueBranchNames(user).join('|'),
      user.created_at
    ].map(csvValue).join(',')
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `staff-users-${jakartaDateStamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  flash('success', 'CSV user terfilter dibuat.');
};

const detailOpen = ref(false);
const detailRow = ref<StaffUserRow | null>(null);
const openDetail = async (user: StaffUserRow) => {
  detailRow.value = user;
  detailOpen.value = true;
  try {
    await refreshUserRoles(user.id);
  } catch {
    // List utama tetap dipakai jika endpoint detail role gagal.
  }
};

const assignOpen = ref(false);
const assignBusy = ref(false);
const assignUser = ref<StaffUserRow | null>(null);
const assignForm = reactive({
  role_id: '',
  branch_id: GLOBAL
});
const canAssign = computed(() => Boolean(assignUser.value && assignForm.role_id && assignForm.branch_id));
const openAssign = (user: StaffUserRow) => {
  assignUser.value = user;
  assignForm.role_id = roles.value[0]?.id ?? '';
  assignForm.branch_id = assignBranchOptions.value[0]?.value ?? '';
  assignOpen.value = true;
};
const saveAssign = async () => {
  if (!assignUser.value || !canAssign.value || assignBusy.value) return;
  assignBusy.value = true;
  try {
    await assignStaffRole(assignUser.value.id, {
      role_id: assignForm.role_id,
      branch_id: assignForm.branch_id === GLOBAL ? null : assignForm.branch_id
    });
    await refreshUserRoles(assignUser.value.id);
    flash('success', `Role berhasil dipasang ke ${assignUser.value.full_name}.`);
    assignOpen.value = false;
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal memasang role.');
  } finally {
    assignBusy.value = false;
  }
};

const revokeOpen = ref(false);
const revokeBusy = ref(false);
const revokeUser = ref<StaffUserRow | null>(null);
const revokeAssignment = ref<StaffRoleAssignment | null>(null);
const openRevoke = (user: StaffUserRow, assignment: StaffRoleAssignment) => {
  revokeUser.value = user;
  revokeAssignment.value = assignment;
  revokeOpen.value = true;
};
const confirmRevoke = async () => {
  const user = revokeUser.value;
  const assignment = revokeAssignment.value;
  if (!user || !assignment?.role || revokeBusy.value) return;
  revokeBusy.value = true;
  try {
    await revokeStaffRole(user.id, assignment.role.id);
    await refreshUserRoles(user.id);
    flash('success', `Role ${assignment.role.name} berhasil dicabut dari ${user.full_name}.`);
    revokeOpen.value = false;
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal mencabut role.');
  } finally {
    revokeBusy.value = false;
  }
};

const rowMenuItems = (user: StaffUserRow) => [
  [
    { label: 'Lihat detail', icon: 'i-lucide-eye', onSelect: () => openDetail(user) },
    { label: 'Pasang role', icon: 'i-lucide-shield-plus', onSelect: () => openAssign(user) }
  ],
  [
    { label: 'Salin user ID', icon: 'i-lucide-copy', onSelect: () => copyText('User ID', user.id) },
    { label: 'Salin email', icon: 'i-lucide-mail', onSelect: () => copyText('Email', user.email) },
    { label: 'Salin telepon', icon: 'i-lucide-phone', onSelect: () => copyText('Telepon', user.phone) }
  ],
  [
    { label: 'Email', icon: 'i-lucide-send', onSelect: () => openEmail(user) },
    { label: 'WhatsApp', icon: 'i-lucide-message-circle', onSelect: () => openWhatsApp(user) }
  ]
];

onMounted(load);
</script>

<template>
  <Head title="Users" />

  <AppLayout title="Users" eyebrow="Access Control">
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

    <section class="mt-5 rounded-md border border-zinc-200 bg-white">
      <div class="border-b border-zinc-200 px-4 py-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 class="text-sm font-semibold text-zinc-950">Staff Users</h2>
            <p class="text-xs text-zinc-500">Kelola assignment role dan scope cabang staff.</p>
          </div>
          <div class="flex flex-col gap-2 sm:flex-row">
            <UButton color="neutral" variant="soft" icon="i-lucide-file-down" :disabled="filteredUsers.length === 0" @click="exportCsv">
              Export CSV
            </UButton>
            <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :loading="loading" @click="load">
              Refresh
            </UButton>
            <UButton color="neutral" variant="soft" icon="i-lucide-rotate-ccw" @click="resetFilters">
              Reset
            </UButton>
          </div>
        </div>

        <div class="mt-4 grid gap-3 lg:grid-cols-6">
          <UInput v-model="filters.q" icon="i-lucide-search" placeholder="Cari nama, email, role, cabang" class="lg:col-span-2" />
          <USelect v-model="filters.status" :items="STATUS_OPTIONS" />
          <USelect v-model="filters.role_id" :items="roleOptions" />
          <USelect v-model="filters.branch_id" :items="branchOptions" />
          <USelect v-model="filters.scope" :items="SCOPE_OPTIONS" />
        </div>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <USelect v-model="filters.sort" :items="SORT_OPTIONS" />
          <USelect v-model="filters.order" :items="ORDER_OPTIONS" />
          <div class="flex items-center text-xs text-zinc-500 sm:col-span-2">
            Menampilkan {{ filteredUsers.length }} dari {{ rows.length }} user.
          </div>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-zinc-200 text-sm">
          <thead class="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
            <tr>
              <th class="px-4 py-3">User</th>
              <th class="px-4 py-3">Kontak</th>
              <th class="px-4 py-3">Status</th>
              <th class="px-4 py-3">Roles</th>
              <th class="px-4 py-3">Scope Cabang</th>
              <th class="px-4 py-3">Dibuat</th>
              <th class="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-100">
            <tr v-if="loading">
              <td class="px-4 py-6 text-center text-zinc-400" colspan="7">Memuat user…</td>
            </tr>
            <tr v-else-if="filteredUsers.length === 0">
              <td class="px-4 py-6 text-center text-zinc-400" colspan="7">Tidak ada user sesuai filter.</td>
            </tr>
            <tr v-for="user in filteredUsers" v-else :key="user.id">
              <td class="px-4 py-3">
                <p class="font-medium text-zinc-950">{{ user.full_name }}</p>
                <p class="font-mono text-xs text-zinc-500">{{ shortId(user.id) }}</p>
              </td>
              <td class="px-4 py-3 text-zinc-700">
                <p>{{ user.email }}</p>
                <p class="text-xs text-zinc-500">{{ user.phone ?? '—' }}</p>
              </td>
              <td class="px-4 py-3">
                <UBadge :color="statusMeta(user).color" variant="subtle">{{ statusMeta(user).label }}</UBadge>
              </td>
              <td class="px-4 py-3">
                <div class="flex max-w-72 flex-wrap gap-1">
                  <UBadge v-for="role in uniqueRoleNames(user)" :key="role" color="primary" variant="subtle">{{ role }}</UBadge>
                  <span v-if="uniqueRoleNames(user).length === 0" class="text-zinc-400">—</span>
                </div>
              </td>
              <td class="px-4 py-3">
                <div class="flex max-w-72 flex-wrap gap-1">
                  <UBadge v-for="branch in uniqueBranchNames(user)" :key="branch" color="neutral" variant="outline">{{ branch }}</UBadge>
                  <span v-if="uniqueBranchNames(user).length === 0" class="text-zinc-400">—</span>
                </div>
              </td>
              <td class="px-4 py-3 text-zinc-700">{{ formatDate(user.created_at) }}</td>
              <td class="px-4 py-3 text-right">
                <UDropdownMenu :items="rowMenuItems(user)" :content="{ align: 'end' }">
                  <UButton color="neutral" variant="ghost" icon="i-lucide-ellipsis-vertical" aria-label="Aksi user" />
                </UDropdownMenu>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <USlideover v-model:open="detailOpen" title="Detail User" :ui="{ content: 'max-w-lg' }">
      <template #body>
        <div v-if="detailRow" class="space-y-5 text-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-lg font-semibold text-zinc-950">{{ detailRow.full_name }}</p>
              <p class="mt-1 text-zinc-600">{{ detailRow.email }}</p>
              <p class="mt-1 font-mono text-xs text-zinc-500">{{ detailRow.id }}</p>
            </div>
            <UBadge :color="statusMeta(detailRow).color" variant="subtle">{{ statusMeta(detailRow).label }}</UBadge>
          </div>

          <USeparator />

          <div class="grid grid-cols-2 gap-2">
            <UButton color="neutral" variant="soft" icon="i-lucide-shield-plus" @click="openAssign(detailRow)">
              Pasang role
            </UButton>
            <UButton color="neutral" variant="soft" icon="i-lucide-copy" @click="copyText('User ID', detailRow.id)">
              Salin ID
            </UButton>
            <UButton color="neutral" variant="soft" icon="i-lucide-mail" @click="openEmail(detailRow)">
              Email
            </UButton>
            <UButton color="neutral" variant="soft" icon="i-lucide-message-circle" @click="openWhatsApp(detailRow)">
              WhatsApp
            </UButton>
          </div>

          <USeparator />

          <div>
            <div class="mb-3 flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold text-zinc-950">Role Assignment</h3>
              <UBadge color="neutral" variant="outline">{{ detailRow.staff_user_roles.length }} assignment</UBadge>
            </div>
            <div v-if="detailRow.staff_user_roles.length === 0" class="rounded-md bg-zinc-50 p-4 text-center text-zinc-400">
              User belum memiliki role.
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="assignment in detailRow.staff_user_roles"
                :key="`${assignment.role?.id ?? 'role'}-${assignment.branch_id ?? 'global'}`"
                class="rounded-md border border-zinc-200 p-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="font-medium text-zinc-950">{{ roleName(assignment) }}</p>
                    <p class="mt-1 text-xs text-zinc-500">{{ branchName(assignment) }}</p>
                  </div>
                  <UButton
                    color="error"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-trash-2"
                    :disabled="!assignment.role"
                    @click="openRevoke(detailRow, assignment)"
                  >
                    Cabut
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </USlideover>

    <UModal v-model:open="assignOpen" title="Pasang Role">
      <template #body>
        <div v-if="assignUser" class="space-y-3 text-sm">
          <p class="text-zinc-600">Target: <strong>{{ assignUser.full_name }}</strong></p>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Role</label>
            <USelect v-model="assignForm.role_id" :items="roles.map((role) => ({ value: role.id, label: role.name }))" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Scope</label>
            <USelect v-model="assignForm.branch_id" :items="assignBranchOptions" class="w-full" />
          </div>
          <p class="text-xs text-zinc-500">Scope Global / HQ hanya akan diterima backend untuk staff global.</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { assignOpen = false; }">Batal</UButton>
          <UButton color="primary" icon="i-lucide-shield-plus" :loading="assignBusy" :disabled="!canAssign" @click="saveAssign">
            Pasang
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="revokeOpen" title="Cabut Role">
      <template #body>
        <p v-if="revokeUser && revokeAssignment?.role" class="text-sm text-zinc-600">
          Cabut role <strong>{{ revokeAssignment.role.name }}</strong> dari
          <strong>{{ revokeUser.full_name }}</strong>?
          Endpoint backend mencabut berdasarkan role id, sehingga semua assignment role tersebut pada user ini akan dilepas.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { revokeOpen = false; }">Batal</UButton>
          <UButton color="error" icon="i-lucide-trash-2" :loading="revokeBusy" @click="confirmRevoke">
            Cabut
          </UButton>
        </div>
      </template>
    </UModal>
  </AppLayout>
</template>
