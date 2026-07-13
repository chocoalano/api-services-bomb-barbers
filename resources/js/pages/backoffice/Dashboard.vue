<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UCard from '@nuxt/ui/components/Card.vue';
import { computed, onMounted, ref } from 'vue';
import AppLayout from '../../layouts/AppLayout.vue';
import {
  fetchAdminBranches,
  fetchBranchSummary,
  fetchBranchToday,
  fetchHQBranchSummary,
  fetchHQToday,
  getStoredStaff,
  type BranchSummaryRow,
  type DashboardToday
} from '../../lib/api';
import { APP_TIMEZONE } from '../../lib/timezone';

const staff = getStoredStaff();
const isSuperAdmin = computed(
  () => Boolean(staff?.is_global) || (staff?.roles ?? []).includes('super_admin')
);

const loading = ref(true);
const error = ref('');
const today = ref<DashboardToday | null>(null);
const summary = ref<BranchSummaryRow[]>([]);

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
});
const formatRupiah = (value: number) => rupiah.format(Number.isFinite(value) ? value : 0);

const formatDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
};

const unwrapName = (relation: BranchSummaryRow['branches']) => {
  const value = Array.isArray(relation) ? relation[0] : relation;
  return value?.name ?? '—';
};

const metrics = computed(() => {
  const data = today.value;
  if (!data) return [];
  return [
    {
      label: 'Appointment hari ini',
      value: String(data.total_appointments),
      delta: `${data.booking_count} booking · ${data.walk_in_count} walk-in`,
      tone: 'emerald'
    },
    {
      label: 'Selesai',
      value: String(data.total_completed),
      delta: `${data.total_cancelled} batal`,
      tone: data.total_cancelled > 0 ? 'amber' : 'emerald'
    },
    {
      label: 'Pendapatan kotor',
      value: formatRupiah(data.revenue.total),
      delta: `Tip ${formatRupiah(data.revenue.tip)}`,
      tone: 'emerald'
    },
    {
      label: 'Dibatalkan',
      value: String(data.total_cancelled),
      delta: 'hari ini',
      tone: data.total_cancelled > 0 ? 'rose' : 'emerald'
    }
  ];
});

// Baris tabel dinormalisasi agar kolomnya sama untuk kedua peran.
type SummaryRow = {
  key: string;
  label: string;
  appointments: number;
  walkIn: number;
  booking: number;
  revenue: number;
};

const summaryRows = computed<SummaryRow[]>(() => {
  if (isSuperAdmin.value) {
    // Ambil ringkasan terbaru per cabang (data sudah terurut summary_date desc).
    const latestPerBranch = new Map<string, BranchSummaryRow>();
    for (const row of summary.value) {
      const current = latestPerBranch.get(row.branch_id);
      if (!current || row.summary_date > current.summary_date) latestPerBranch.set(row.branch_id, row);
    }
    return [...latestPerBranch.values()].map((row) => ({
      key: row.branch_id,
      label: unwrapName(row.branches),
      appointments: row.total_appointments,
      walkIn: row.walk_in_count,
      booking: row.booking_count,
      revenue: row.total_revenue
    }));
  }

  // branch_admin: ringkasan harian cabangnya (per tanggal, maksimal 14 hari).
  return summary.value.slice(0, 14).map((row) => ({
    key: row.summary_date,
    label: formatDate(row.summary_date),
    appointments: row.total_appointments,
    walkIn: row.walk_in_count,
    booking: row.booking_count,
    revenue: row.total_revenue
  }));
});

const summaryTitle = computed(() =>
  isSuperAdmin.value ? 'Kondisi Cabang' : 'Ringkasan Harian Cabang'
);
const summaryFirstColumn = computed(() => (isSuperAdmin.value ? 'Cabang' : 'Tanggal'));

// Chart komposisi appointment: booking vs walk-in per cabang/tanggal.
// Warna kategorikal tervalidasi (dataviz): booking=biru, walk-in=aqua.
const CHART_COLORS = { booking: '#2a78d6', walkIn: '#1baf7a' };

type ChartBar = {
  key: string;
  label: string;
  booking: number;
  walkIn: number;
  total: number;
  bookingHeight: number;
  walkInHeight: number;
};

const chartBars = computed<ChartBar[]>(() => {
  const rows = summaryRows.value;
  const max = Math.max(1, ...rows.map((r) => r.walkIn + r.booking));
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    booking: r.booking,
    walkIn: r.walkIn,
    total: r.walkIn + r.booking,
    bookingHeight: (r.booking / max) * 100,
    walkInHeight: (r.walkIn / max) * 100
  }));
});

const hasChartData = computed(() => chartBars.value.some((b) => b.total > 0));

// Menjumlahkan beberapa ringkasan "hari ini" (untuk branch_admin lintas cabang).
const sumToday = (list: DashboardToday[]): DashboardToday =>
  list.reduce<DashboardToday>(
    (acc, d) => ({
      total_appointments: acc.total_appointments + d.total_appointments,
      booking_count: acc.booking_count + d.booking_count,
      walk_in_count: acc.walk_in_count + d.walk_in_count,
      total_completed: acc.total_completed + d.total_completed,
      total_cancelled: acc.total_cancelled + d.total_cancelled,
      revenue: {
        total: acc.revenue.total + d.revenue.total,
        service: acc.revenue.service + d.revenue.service,
        product: acc.revenue.product + d.revenue.product,
        tip: acc.revenue.tip + d.revenue.tip
      },
      shares: {
        barber: acc.shares.barber + d.shares.barber,
        branch: acc.shares.branch + d.shares.branch,
        hq: acc.shares.hq + d.shares.hq
      }
    }),
    {
      total_appointments: 0,
      booking_count: 0,
      walk_in_count: 0,
      total_completed: 0,
      total_cancelled: 0,
      revenue: { total: 0, service: 0, product: 0, tip: 0 },
      shares: { barber: 0, branch: 0, hq: 0 }
    }
  );

// Menggabungkan ringkasan harian beberapa cabang menjadi satu baris per tanggal.
const mergeSummariesByDate = (rows: BranchSummaryRow[]): BranchSummaryRow[] => {
  const byDate = new Map<string, BranchSummaryRow>();
  for (const row of rows) {
    const current = byDate.get(row.summary_date);
    if (!current) {
      byDate.set(row.summary_date, { ...row, branch_id: 'merged', branches: null });
    } else {
      current.total_appointments += row.total_appointments;
      current.walk_in_count += row.walk_in_count;
      current.booking_count += row.booking_count;
      current.total_revenue += row.total_revenue;
      current.no_show_count += row.no_show_count;
    }
  }
  return [...byDate.values()].sort((a, b) => b.summary_date.localeCompare(a.summary_date));
};

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    if (isSuperAdmin.value) {
      // Super admin: agregat global + snapshot seluruh cabang.
      const [todayData, summaryData] = await Promise.all([fetchHQToday(), fetchHQBranchSummary()]);
      today.value = todayData;
      summary.value = summaryData;
      return;
    }

    // Branch admin: dilingkupi HANYA ke cabang miliknya (daftar dari backend,
    // sudah difilter per peran). Jika punya >1 cabang, seluruhnya dijumlahkan.
    const branches = await fetchAdminBranches();
    if (branches.length === 0) {
      throw new Error('Akun Anda belum terhubung ke cabang mana pun.');
    }

    const [todays, summaries] = await Promise.all([
      Promise.all(branches.map((b) => fetchBranchToday(b.id))),
      Promise.all(branches.map((b) => fetchBranchSummary(b.id)))
    ]);
    today.value = sumToday(todays);
    summary.value = mergeSummariesByDate(summaries.flat());
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Gagal memuat data dashboard.';
  } finally {
    loading.value = false;
  }
};

onMounted(load);
</script>

<template>
  <Head title="Dashboard Operasional" />

  <AppLayout title="Dashboard Operasional" eyebrow="Backoffice">
    <div
      v-if="error"
      class="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </div>

    <!-- Kartu metrik -->
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
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm text-zinc-500">{{ metric.label }}</p>
            <p class="mt-2 text-2xl font-semibold text-zinc-950">{{ metric.value }}</p>
          </div>
          <UBadge
            :color="metric.tone === 'rose' ? 'error' : metric.tone === 'amber' ? 'warning' : 'primary'"
            variant="subtle"
          >
            {{ metric.delta }}
          </UBadge>
        </div>
      </UCard>
    </div>

    <!-- Chart komposisi appointment (booking vs walk-in) -->
    <section class="mt-5 rounded-md border border-zinc-200 bg-white">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-zinc-950">Komposisi Appointment</h2>
          <p class="text-xs text-zinc-500">
            Booking vs walk-in per {{ isSuperAdmin ? 'cabang' : 'tanggal' }}
          </p>
        </div>
        <div class="flex items-center gap-4 text-xs text-zinc-600">
          <span class="inline-flex items-center gap-1.5">
            <span class="size-2.5 rounded-sm" :style="{ backgroundColor: CHART_COLORS.booking }" />
            Booking
          </span>
          <span class="inline-flex items-center gap-1.5">
            <span class="size-2.5 rounded-sm" :style="{ backgroundColor: CHART_COLORS.walkIn }" />
            Walk-in
          </span>
        </div>
      </div>

      <div class="px-4 py-5">
        <div v-if="loading" class="flex h-52 items-end gap-3">
          <div v-for="n in 6" :key="n" class="h-full flex-1 animate-pulse rounded bg-zinc-100" />
        </div>
        <p v-else-if="!hasChartData" class="py-12 text-center text-sm text-zinc-400">
          Belum ada data appointment untuk ditampilkan.
        </p>
        <div v-else class="overflow-x-auto">
          <div class="flex h-52 min-w-full gap-3">
            <div
              v-for="bar in chartBars"
              :key="bar.key"
              class="group relative flex h-full min-w-10 flex-1 flex-col items-center"
            >
              <!-- Tooltip -->
              <div
                class="pointer-events-none absolute top-0 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block"
              >
                <p class="font-medium">{{ bar.label }}</p>
                <p class="mt-0.5 text-zinc-300">Booking: {{ bar.booking }}</p>
                <p class="text-zinc-300">Walk-in: {{ bar.walkIn }}</p>
                <p class="text-zinc-300">Total: {{ bar.total }}</p>
              </div>

              <!-- Batang bertumpuk (walk-in di atas, booking di bawah) -->
              <div class="flex w-full max-w-14 flex-1 flex-col justify-end gap-0.5">
                <div
                  class="w-full rounded-t-sm transition-opacity group-hover:opacity-80"
                  :style="{ height: `${bar.walkInHeight}%`, backgroundColor: CHART_COLORS.walkIn }"
                />
                <div
                  class="w-full rounded-b-sm transition-opacity group-hover:opacity-80"
                  :style="{ height: `${bar.bookingHeight}%`, backgroundColor: CHART_COLORS.booking }"
                />
              </div>

              <!-- Label sumbu -->
              <span class="mt-2 w-full truncate text-center text-xs text-zinc-500" :title="bar.label">
                {{ bar.label }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="mt-5">
      <section class="rounded-md border border-zinc-200 bg-white">
        <div class="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div>
            <h2 class="text-sm font-semibold text-zinc-950">{{ summaryTitle }}</h2>
            <p class="text-xs text-zinc-500">Snapshot operasional terbaru</p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="loading"
            @click="load"
          >
            Refresh
          </UButton>
        </div>

        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-zinc-200 text-sm">
            <thead class="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th class="px-4 py-3">{{ summaryFirstColumn }}</th>
                <th class="px-4 py-3">Appointment</th>
                <th class="px-4 py-3">Walk-in</th>
                <th class="px-4 py-3">Booking</th>
                <th class="px-4 py-3">Pendapatan</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-100">
              <tr v-if="loading">
                <td class="px-4 py-6 text-center text-zinc-400" colspan="5">Memuat data…</td>
              </tr>
              <tr v-else-if="summaryRows.length === 0">
                <td class="px-4 py-6 text-center text-zinc-400" colspan="5">Belum ada data ringkasan.</td>
              </tr>
              <tr v-for="row in summaryRows" v-else :key="row.key">
                <td class="px-4 py-3 font-medium text-zinc-950">{{ row.label }}</td>
                <td class="px-4 py-3 text-zinc-700">{{ row.appointments }}</td>
                <td class="px-4 py-3 text-zinc-700">{{ row.walkIn }}</td>
                <td class="px-4 py-3 text-zinc-700">{{ row.booking }}</td>
                <td class="px-4 py-3 text-zinc-700">{{ formatRupiah(row.revenue) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </AppLayout>
</template>
