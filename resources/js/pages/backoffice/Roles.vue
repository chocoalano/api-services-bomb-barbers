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
  createRole,
  fetchAdminBranches,
  fetchPermissions,
  fetchStaffRoles,
  fetchStaffUsers,
  fetchRoles,
  getStoredStaff,
  revokeStaffRole,
  type AdminBranch,
  type AdminPermission,
  type AdminRole,
  type StaffRoleAssignment,
  type StaffUserRow
} from '../../lib/api';
import { jakartaDateStamp } from '../../lib/timezone';

const ALL = 'all';
const GLOBAL = 'global';
const staff = getStoredStaff();
const isGlobalStaff = computed(() => Boolean(staff?.is_global) || (staff?.roles ?? []).includes('super_admin'));

const roles = ref<AdminRole[]>([]);
const permissions = ref<AdminPermission[]>([]);
const users = ref<StaffUserRow[]>([]);
const branches = ref<AdminBranch[]>([]);
const loading = ref(true);
const error = ref('');

const filters = reactive({
  q: '',
  usage: ALL,
  sort: 'name',
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

const roleAssignments = (roleId: string) =>
  users.value.flatMap((user) =>
    user.staff_user_roles
      .filter((assignment) => assignment.role?.id === roleId)
      .map((assignment) => ({ user, assignment }))
  );
const roleUserCount = (roleId: string) =>
  new Set(roleAssignments(roleId).map((item) => item.user.id)).size;
const roleBranchCount = (roleId: string) =>
  new Set(roleAssignments(roleId).map((item) => item.assignment.branch_id).filter(Boolean)).size;
const hasGlobalAssignment = (roleId: string) =>
  roleAssignments(roleId).some((item) => !item.assignment.branch_id);

const USAGE_OPTIONS = [
  { value: ALL, label: 'Semua usage' },
  { value: 'used', label: 'Dipakai user' },
  { value: 'unused', label: 'Belum dipakai' },
  { value: GLOBAL, label: 'Ada global scope' }
];
const SORT_OPTIONS = [
  { value: 'name', label: 'Nama role' },
  { value: 'user_count', label: 'Jumlah user' },
  { value: 'branch_count', label: 'Jumlah cabang' },
  { value: 'created_at', label: 'Tanggal dibuat' }
];
const ORDER_OPTIONS = [
  { value: 'asc', label: 'Naik' },
  { value: 'desc', label: 'Turun' }
];
const assignBranchOptions = computed(() => [
  ...(isGlobalStaff.value ? [{ value: GLOBAL, label: 'Global / HQ' }] : []),
  ...branches.value.map((branch) => ({ value: branch.id, label: branch.name }))
]);
const userOptions = computed(() => users.value.map((user) => ({ value: user.id, label: `${user.full_name} · ${user.email}` })));

const actionMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);
let messageTimer: ReturnType<typeof setTimeout> | undefined;
const flash = (type: 'success' | 'error', text: string) => {
  actionMessage.value = { type, text };
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (actionMessage.value = null), 3500);
};

const filteredRoles = computed(() => {
  const q = filters.q.trim().toLowerCase();
  const data = roles.value.filter((role) => {
    const assignments = roleAssignments(role.id);
    if (q && ![role.id, role.name].some((value) => value.toLowerCase().includes(q))) return false;
    if (filters.usage === 'used' && assignments.length === 0) return false;
    if (filters.usage === 'unused' && assignments.length > 0) return false;
    if (filters.usage === GLOBAL && !hasGlobalAssignment(role.id)) return false;
    return true;
  });

  const direction = filters.order === 'desc' ? -1 : 1;
  return [...data].sort((a, b) => {
    if (filters.sort === 'user_count') return (roleUserCount(a.id) - roleUserCount(b.id)) * direction;
    if (filters.sort === 'branch_count') return (roleBranchCount(a.id) - roleBranchCount(b.id)) * direction;
    if (filters.sort === 'created_at') return ((a.created_at ?? '').localeCompare(b.created_at ?? '')) * direction;
    return a.name.localeCompare(b.name) * direction;
  });
});

const metrics = computed(() => [
  { label: 'Role terfilter', value: formatNumber(filteredRoles.value.length), icon: 'i-lucide-shield' },
  { label: 'Role terpakai', value: formatNumber(filteredRoles.value.filter((role) => roleAssignments(role.id).length > 0).length), icon: 'i-lucide-user-check' },
  { label: 'Global scope', value: formatNumber(filteredRoles.value.filter((role) => hasGlobalAssignment(role.id)).length), icon: 'i-lucide-globe-2' },
  { label: 'Permission catalog', value: formatNumber(permissions.value.length), icon: 'i-lucide-key-round' }
]);

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    const [roleRows, permissionRows, userRows, branchRows] = await Promise.all([
      fetchRoles(),
      fetchPermissions(),
      fetchStaffUsers(),
      fetchAdminBranches()
    ]);
    roles.value = roleRows;
    permissions.value = permissionRows;
    users.value = userRows;
    branches.value = branchRows;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Gagal memuat data role.';
  } finally {
    loading.value = false;
  }
};

const resetFilters = () => {
  filters.q = '';
  filters.usage = ALL;
  filters.sort = 'name';
  filters.order = 'asc';
};

const replaceUserRoles = (userId: string, assignments: StaffRoleAssignment[]) => {
  users.value = users.value.map((user) =>
    user.id === userId ? { ...user, staff_user_roles: assignments } : user
  );
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

const csvValue = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const exportCsv = () => {
  const header = ['id', 'name', 'user_count', 'branch_count', 'has_global_scope', 'created_at'];
  const lines = filteredRoles.value.map((role) =>
    [
      role.id,
      role.name,
      roleUserCount(role.id),
      roleBranchCount(role.id),
      hasGlobalAssignment(role.id) ? 'yes' : 'no',
      role.created_at
    ].map(csvValue).join(',')
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `roles-${jakartaDateStamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  flash('success', 'CSV role terfilter dibuat.');
};

const detailOpen = ref(false);
const detailRole = ref<AdminRole | null>(null);
const openDetail = (role: AdminRole) => {
  detailRole.value = role;
  detailOpen.value = true;
};

const createOpen = ref(false);
const createBusy = ref(false);
const createForm = reactive({ name: '' });
const canCreate = computed(() => /^[a-z][a-z0-9_]{1,99}$/.test(createForm.name.trim()));
const openCreate = () => {
  createForm.name = '';
  createOpen.value = true;
};
const saveCreate = async () => {
  if (!canCreate.value || createBusy.value) return;
  createBusy.value = true;
  try {
    const role = await createRole(createForm.name.trim());
    roles.value = [...roles.value, role];
    createOpen.value = false;
    flash('success', `Role ${role.name} berhasil dibuat.`);
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal membuat role.');
  } finally {
    createBusy.value = false;
  }
};

const assignOpen = ref(false);
const assignBusy = ref(false);
const assignRoleRow = ref<AdminRole | null>(null);
const assignForm = reactive({
  staff_user_id: '',
  branch_id: GLOBAL
});
const canAssign = computed(() => Boolean(assignRoleRow.value && assignForm.staff_user_id && assignForm.branch_id));
const openAssign = (role: AdminRole) => {
  assignRoleRow.value = role;
  assignForm.staff_user_id = users.value[0]?.id ?? '';
  assignForm.branch_id = assignBranchOptions.value[0]?.value ?? '';
  assignOpen.value = true;
};
const saveAssign = async () => {
  if (!assignRoleRow.value || !canAssign.value || assignBusy.value) return;
  assignBusy.value = true;
  try {
    await assignStaffRole(assignForm.staff_user_id, {
      role_id: assignRoleRow.value.id,
      branch_id: assignForm.branch_id === GLOBAL ? null : assignForm.branch_id
    });
    await refreshUserRoles(assignForm.staff_user_id);
    flash('success', `Role ${assignRoleRow.value.name} berhasil dipasang.`);
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
const revokeRoleRow = ref<AdminRole | null>(null);
const openRevoke = (user: StaffUserRow, role: AdminRole) => {
  revokeUser.value = user;
  revokeRoleRow.value = role;
  revokeOpen.value = true;
};
const confirmRevoke = async () => {
  if (!revokeUser.value || !revokeRoleRow.value || revokeBusy.value) return;
  revokeBusy.value = true;
  try {
    await revokeStaffRole(revokeUser.value.id, revokeRoleRow.value.id);
    await refreshUserRoles(revokeUser.value.id);
    flash('success', `Role ${revokeRoleRow.value.name} berhasil dicabut dari ${revokeUser.value.full_name}.`);
    revokeOpen.value = false;
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal mencabut role.');
  } finally {
    revokeBusy.value = false;
  }
};

const rowMenuItems = (role: AdminRole) => [
  [
    { label: 'Lihat detail', icon: 'i-lucide-eye', onSelect: () => openDetail(role) },
    { label: 'Pasang ke user', icon: 'i-lucide-user-plus', onSelect: () => openAssign(role) }
  ],
  [
    { label: 'Salin role ID', icon: 'i-lucide-copy', onSelect: () => copyText('Role ID', role.id) },
    { label: 'Salin nama role', icon: 'i-lucide-shield', onSelect: () => copyText('Nama role', role.name) }
  ]
];

onMounted(load);
</script>

<template>
  <Head title="Roles" />

  <AppLayout title="Roles" eyebrow="Access Control">
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
              <h2 class="text-sm font-semibold text-zinc-950">Role Staff</h2>
              <p class="text-xs text-zinc-500">Kelola role dan pemakaiannya pada staff user.</p>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row">
              <UButton color="primary" icon="i-lucide-plus" @click="openCreate">Tambah role</UButton>
              <UButton color="neutral" variant="soft" icon="i-lucide-file-down" :disabled="filteredRoles.length === 0" @click="exportCsv">
                Export CSV
              </UButton>
              <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :loading="loading" @click="load">
                Refresh
              </UButton>
            </div>
          </div>

          <div class="mt-4 grid gap-3 lg:grid-cols-5">
            <UInput v-model="filters.q" icon="i-lucide-search" placeholder="Cari nama role atau ID" class="lg:col-span-2" />
            <USelect v-model="filters.usage" :items="USAGE_OPTIONS" />
            <USelect v-model="filters.sort" :items="SORT_OPTIONS" />
            <USelect v-model="filters.order" :items="ORDER_OPTIONS" />
          </div>
          <div class="mt-3 flex items-center justify-between gap-3">
            <p class="text-xs text-zinc-500">Menampilkan {{ filteredRoles.length }} dari {{ roles.length }} role.</p>
            <UButton color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" @click="resetFilters">Reset</UButton>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-zinc-200 text-sm">
            <thead class="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th class="px-4 py-3">Role</th>
                <th class="px-4 py-3">User</th>
                <th class="px-4 py-3">Cabang</th>
                <th class="px-4 py-3">Scope</th>
                <th class="px-4 py-3">Dibuat</th>
                <th class="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-100">
              <tr v-if="loading">
                <td class="px-4 py-6 text-center text-zinc-400" colspan="6">Memuat role…</td>
              </tr>
              <tr v-else-if="filteredRoles.length === 0">
                <td class="px-4 py-6 text-center text-zinc-400" colspan="6">Tidak ada role sesuai filter.</td>
              </tr>
              <tr v-for="role in filteredRoles" v-else :key="role.id">
                <td class="px-4 py-3">
                  <p class="font-medium text-zinc-950">{{ role.name }}</p>
                  <p class="font-mono text-xs text-zinc-500">{{ shortId(role.id) }}</p>
                </td>
                <td class="px-4 py-3 text-zinc-700">{{ formatNumber(roleUserCount(role.id)) }}</td>
                <td class="px-4 py-3 text-zinc-700">{{ formatNumber(roleBranchCount(role.id)) }}</td>
                <td class="px-4 py-3">
                  <UBadge :color="hasGlobalAssignment(role.id) ? 'primary' : 'neutral'" variant="subtle">
                    {{ hasGlobalAssignment(role.id) ? 'Global + cabang' : 'Cabang / belum dipakai' }}
                  </UBadge>
                </td>
                <td class="px-4 py-3 text-zinc-700">{{ formatDate(role.created_at) }}</td>
                <td class="px-4 py-3 text-right">
                  <UDropdownMenu :items="rowMenuItems(role)" :content="{ align: 'end' }">
                    <UButton color="neutral" variant="ghost" icon="i-lucide-ellipsis-vertical" aria-label="Aksi role" />
                  </UDropdownMenu>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="rounded-md border border-zinc-200 bg-white p-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold text-zinc-950">Permission Catalog</h2>
          <UBadge color="neutral" variant="outline">{{ permissions.length }}</UBadge>
        </div>
        <p class="mt-2 text-xs text-zinc-500">
          Endpoint saat ini hanya menyediakan daftar permission, belum menyediakan mutasi permission per role.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <UBadge v-for="permission in permissions" :key="permission.id" color="neutral" variant="outline">
            {{ permission.code }}
          </UBadge>
        </div>
      </section>
    </div>

    <USlideover v-model:open="detailOpen" title="Detail Role" :ui="{ content: 'max-w-lg' }">
      <template #body>
        <div v-if="detailRole" class="space-y-5 text-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-lg font-semibold text-zinc-950">{{ detailRole.name }}</p>
              <p class="mt-1 font-mono text-xs text-zinc-500">{{ detailRole.id }}</p>
            </div>
            <UBadge color="primary" variant="subtle">{{ roleUserCount(detailRole.id) }} user</UBadge>
          </div>

          <USeparator />

          <div class="grid grid-cols-2 gap-2">
            <UButton color="neutral" variant="soft" icon="i-lucide-user-plus" @click="openAssign(detailRole)">
              Pasang ke user
            </UButton>
            <UButton color="neutral" variant="soft" icon="i-lucide-copy" @click="copyText('Role ID', detailRole.id)">
              Salin ID
            </UButton>
          </div>

          <USeparator />

          <div>
            <div class="mb-3 flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold text-zinc-950">User Dengan Role Ini</h3>
              <UBadge color="neutral" variant="outline">{{ roleAssignments(detailRole.id).length }} assignment</UBadge>
            </div>
            <div v-if="roleAssignments(detailRole.id).length === 0" class="rounded-md bg-zinc-50 p-4 text-center text-zinc-400">
              Role belum dipasang ke user.
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="item in roleAssignments(detailRole.id)"
                :key="`${item.user.id}-${item.assignment.branch_id ?? 'global'}`"
                class="rounded-md border border-zinc-200 p-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="font-medium text-zinc-950">{{ item.user.full_name }}</p>
                    <p class="mt-1 text-xs text-zinc-500">{{ item.user.email }}</p>
                    <p class="mt-1 text-xs text-zinc-500">{{ item.assignment.branch?.name ?? 'Global / HQ' }}</p>
                  </div>
                  <UButton color="error" variant="ghost" size="sm" icon="i-lucide-trash-2" @click="openRevoke(item.user, detailRole)">
                    Cabut
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </USlideover>

    <UModal v-model:open="createOpen" title="Tambah Role">
      <template #body>
        <div class="space-y-3 text-sm">
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Nama role *</label>
            <UInput v-model="createForm.name" placeholder="cashier" class="w-full" />
          </div>
          <p class="text-xs text-zinc-500">Gunakan snake_case, contoh: cashier, finance_admin, inventory_staff.</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { createOpen = false; }">Batal</UButton>
          <UButton color="primary" icon="i-lucide-save" :loading="createBusy" :disabled="!canCreate" @click="saveCreate">
            Simpan
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="assignOpen" title="Pasang Role ke User">
      <template #body>
        <div v-if="assignRoleRow" class="space-y-3 text-sm">
          <p class="text-zinc-600">Role: <strong>{{ assignRoleRow.name }}</strong></p>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">User</label>
            <USelect v-model="assignForm.staff_user_id" :items="userOptions" class="w-full" />
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
          <UButton color="primary" icon="i-lucide-user-plus" :loading="assignBusy" :disabled="!canAssign" @click="saveAssign">
            Pasang
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="revokeOpen" title="Cabut Role">
      <template #body>
        <p v-if="revokeUser && revokeRoleRow" class="text-sm text-zinc-600">
          Cabut role <strong>{{ revokeRoleRow.name }}</strong> dari
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
