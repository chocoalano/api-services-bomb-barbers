<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UCard from '@nuxt/ui/components/Card.vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import USeparator from '@nuxt/ui/components/Separator.vue';
import USlideover from '@nuxt/ui/components/Slideover.vue';
import UTextarea from '@nuxt/ui/components/Textarea.vue';
import { computed, onMounted, ref } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import AppLayout from '../../layouts/AppLayout.vue';
import {
  fetchPendingBarbers,
  getStoredStaff,
  setBarberApproval,
  type PendingBarberRow
} from '../../lib/api';

const staff = getStoredStaff();
const isSuperAdmin = computed(
  () => Boolean(staff?.is_global) || (staff?.roles ?? []).includes('super_admin')
);
const canManageBarber = computed(
  () => isSuperAdmin.value || (staff?.permissions ?? []).includes('manage_barber')
);

/* -- Formatters -- */
const dateFmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});
const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
};

type Rel<T> = T | T[] | null | undefined;
const unwrap = <T,>(rel: Rel<T>): T | null =>
  rel == null ? null : Array.isArray(rel) ? (rel[0] ?? null) : rel;

const staffName = (row: PendingBarberRow) => unwrap(row.staff_users)?.full_name ?? row.display_name;
const staffEmail = (row: PendingBarberRow) => unwrap(row.staff_users)?.email ?? null;
const staffPhone = (row: PendingBarberRow) => unwrap(row.staff_users)?.phone ?? null;
const branchName = (row: PendingBarberRow) => unwrap(row.branches)?.name ?? '—';

/* -- State -- */
const rows = ref<PendingBarberRow[]>([]);
const loading = ref(true);
const error = ref('');
const busyId = ref<string | null>(null);

const pendingCount = computed(() => rows.value.length);

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    rows.value = await fetchPendingBarbers();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Gagal memuat daftar pendaftaran barber.';
    rows.value = [];
  } finally {
    loading.value = false;
  }
};

/* -- Flash -- */
const actionMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);
let messageTimer: ReturnType<typeof setTimeout> | undefined;
const flash = (type: 'success' | 'error', text: string) => {
  actionMessage.value = { type, text };
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (actionMessage.value = null), 3500);
};

/* -- Detail slideover -- */
const detailOpen = ref(false);
const detailRow = ref<PendingBarberRow | null>(null);
const openDetail = (row: PendingBarberRow) => {
  detailRow.value = row;
  detailOpen.value = true;
};

/* -- Setujui -- */
const approve = async (row: PendingBarberRow) => {
  if (!canManageBarber.value) return;
  busyId.value = row.id;
  try {
    await setBarberApproval(row.id, 'approve');
    flash('success', `Pendaftaran ${staffName(row)} disetujui. Kepster dapat login.`);
    if (detailRow.value?.id === row.id) detailOpen.value = false;
    await load();
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal menyetujui pendaftaran.');
  } finally {
    busyId.value = null;
  }
};

/* -- Tolak (dengan alasan) -- */
const rejectOpen = ref(false);
const rejectRow = ref<PendingBarberRow | null>(null);
const rejectReason = ref('');
const rejectBusy = ref(false);
const openReject = (row: PendingBarberRow) => {
  rejectRow.value = row;
  rejectReason.value = '';
  rejectOpen.value = true;
};
const confirmReject = async () => {
  const row = rejectRow.value;
  if (!row) return;
  rejectBusy.value = true;
  try {
    await setBarberApproval(row.id, 'reject', rejectReason.value.trim() || undefined);
    flash('success', `Pendaftaran ${staffName(row)} ditolak.`);
    rejectOpen.value = false;
    if (detailRow.value?.id === row.id) detailOpen.value = false;
    await load();
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal menolak pendaftaran.');
  } finally {
    rejectBusy.value = false;
  }
};

const rowMenuInitial = (row: PendingBarberRow) =>
  staffName(row).charAt(0).toUpperCase() || '?';

onMounted(load);
</script>

<template>
  <Head title="Barber Mendaftar" />

  <AppLayout title="Barber Mendaftar" eyebrow="Onboarding Kepster">
    <p class="mb-4 text-xs text-zinc-500">
      <span v-if="isSuperAdmin">Menampilkan seluruh pendaftaran kepster (super admin).</span>
      <span v-else>Menampilkan pendaftaran kepster pada cabang Anda.</span>
      Zona waktu Asia/Jakarta.
    </p>

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

    <!-- Ringkasan -->
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <UCard :ui="{ root: 'rounded-md' }">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm text-zinc-500">Menunggu persetujuan</p>
            <p v-if="loading" class="mt-2 h-7 w-12 animate-pulse rounded bg-zinc-200" />
            <p v-else class="mt-2 text-2xl font-semibold text-zinc-950">{{ pendingCount }}</p>
          </div>
          <UBadge color="warning" variant="subtle" class="size-9 justify-center rounded-md p-0">
            <AppIcon name="i-lucide-user-plus" class="size-5" />
          </UBadge>
        </div>
      </UCard>
    </div>

    <!-- Tabel -->
    <section class="mt-5 rounded-md border border-zinc-200 bg-white">
      <div class="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-sm font-semibold text-zinc-950">Pendaftaran Kepster</h2>
          <p class="text-xs text-zinc-500">Setujui atau tolak barber baru yang mendaftar.</p>
        </div>
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

      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-zinc-200 text-sm">
          <thead class="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              <th class="px-4 py-3">Nama</th>
              <th class="px-4 py-3">Email</th>
              <th class="px-4 py-3">Telepon</th>
              <th class="px-4 py-3">Cabang</th>
              <th class="px-4 py-3">Mendaftar</th>
              <th class="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-100">
            <tr v-if="loading">
              <td colspan="6" class="px-4 py-10 text-center text-zinc-400">Memuat data…</td>
            </tr>
            <tr v-else-if="rows.length === 0">
              <td colspan="6" class="px-4 py-10 text-center text-zinc-400">
                Tidak ada barber yang menunggu persetujuan.
              </td>
            </tr>
            <tr v-for="row in rows" v-else :key="row.id" class="hover:bg-zinc-50/60">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  <div class="grid size-8 place-items-center rounded-full bg-amber-50 text-sm font-semibold text-amber-700">
                    {{ rowMenuInitial(row) }}
                  </div>
                  <div>
                    <p class="font-medium text-zinc-950">{{ staffName(row) }}</p>
                    <p class="text-xs text-zinc-500">{{ row.display_name }}</p>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 text-zinc-600">{{ staffEmail(row) ?? '—' }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-zinc-600">{{ staffPhone(row) ?? '—' }}</td>
              <td class="px-4 py-3 text-zinc-600">{{ branchName(row) }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-zinc-500">{{ formatDate(row.created_at) }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-2">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-eye"
                    aria-label="Lihat detail"
                    @click="openDetail(row)"
                  />
                  <template v-if="canManageBarber">
                    <UButton
                      color="success"
                      variant="soft"
                      size="sm"
                      icon="i-lucide-check"
                      :loading="busyId === row.id"
                      @click="approve(row)"
                    >
                      Setujui
                    </UButton>
                    <UButton
                      color="error"
                      variant="soft"
                      size="sm"
                      icon="i-lucide-x"
                      :disabled="busyId === row.id"
                      @click="openReject(row)"
                    >
                      Tolak
                    </UButton>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Slideover detail -->
    <USlideover v-model:open="detailOpen" title="Detail Pendaftaran" :ui="{ content: 'max-w-md' }">
      <template #body>
        <div v-if="detailRow" class="space-y-5 text-sm">
          <div class="flex items-center gap-3">
            <div class="grid size-12 place-items-center rounded-full bg-amber-50 text-lg font-semibold text-amber-700">
              {{ rowMenuInitial(detailRow) }}
            </div>
            <div>
              <p class="font-semibold text-zinc-950">{{ staffName(detailRow) }}</p>
              <UBadge color="warning" variant="subtle" class="mt-1">Menunggu persetujuan</UBadge>
            </div>
          </div>

          <p v-if="detailRow.bio" class="text-zinc-600">{{ detailRow.bio }}</p>

          <USeparator />

          <dl class="space-y-2">
            <div class="flex items-center gap-2 text-zinc-700">
              <AppIcon name="i-lucide-user" class="size-4 text-zinc-400" />{{ detailRow.display_name }}
            </div>
            <div class="flex items-center gap-2 text-zinc-700">
              <AppIcon name="i-lucide-mail" class="size-4 text-zinc-400" />{{ staffEmail(detailRow) ?? '—' }}
            </div>
            <div class="flex items-center gap-2 text-zinc-700">
              <AppIcon name="i-lucide-phone" class="size-4 text-zinc-400" />{{ staffPhone(detailRow) ?? '—' }}
            </div>
            <div class="flex items-center gap-2 text-zinc-700">
              <AppIcon name="i-lucide-store" class="size-4 text-zinc-400" />{{ branchName(detailRow) }}
            </div>
            <div class="flex items-center gap-2 text-zinc-700">
              <AppIcon name="i-lucide-clock" class="size-4 text-zinc-400" />{{ formatDate(detailRow.created_at) }}
            </div>
          </dl>

          <template v-if="canManageBarber">
            <USeparator />
            <div class="flex gap-2">
              <UButton
                color="success"
                icon="i-lucide-check"
                class="flex-1 justify-center"
                :loading="busyId === detailRow.id"
                @click="approve(detailRow)"
              >
                Setujui
              </UButton>
              <UButton
                color="error"
                variant="soft"
                icon="i-lucide-x"
                class="flex-1 justify-center"
                :disabled="busyId === detailRow.id"
                @click="openReject(detailRow)"
              >
                Tolak
              </UButton>
            </div>
          </template>
        </div>
      </template>
    </USlideover>

    <!-- Modal tolak -->
    <UModal v-model:open="rejectOpen" title="Tolak Pendaftaran">
      <template #body>
        <div v-if="rejectRow" class="space-y-3 text-sm">
          <p class="text-zinc-600">
            Tolak pendaftaran <strong>{{ staffName(rejectRow) }}</strong>? Kepster tidak akan bisa login.
          </p>
          <div>
            <label class="mb-1 block text-xs font-medium text-zinc-500">Alasan (opsional)</label>
            <UTextarea
              v-model="rejectReason"
              :rows="3"
              placeholder="Alasan penolakan (dicatat pada audit log)…"
              class="w-full"
            />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { rejectOpen = false; }">Batal</UButton>
          <UButton color="error" icon="i-lucide-x" :loading="rejectBusy" @click="confirmReject">
            Tolak Pendaftaran
          </UButton>
        </div>
      </template>
    </UModal>
  </AppLayout>
</template>
