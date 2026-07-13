<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UCard from '@nuxt/ui/components/Card.vue';
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import USelect from '@nuxt/ui/components/Select.vue';
import USeparator from '@nuxt/ui/components/Separator.vue';
import USlideover from '@nuxt/ui/components/Slideover.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import AppLayout from '../../layouts/AppLayout.vue';
import {
  fetchAdminBranches,
  fetchAdminPaymentDetail,
  fetchBranchPayments,
  type AdminBranch,
  type AdminPaymentDetail,
  type AdminPaymentRow,
  type PaymentInvoiceRelation
} from '../../lib/api';

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

const ALL = 'all';

const filters = reactive({
  q: '',
  branch_id: ALL,
  status: ALL,
  method: ALL,
  provider: ALL,
  date_field: 'created_at',
  date_from: '',
  date_to: '',
  min_amount: '',
  max_amount: '',
  sort: 'created_at',
  order: 'desc'
});

const branches = ref<AdminBranch[]>([]);
const rows = ref<AdminPaymentRow[]>([]);
const loading = ref(true);
const error = ref('');
const actionMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);
let messageTimer: ReturnType<typeof setTimeout> | undefined;
const flash = (type: 'success' | 'error', text: string) => {
  actionMessage.value = { type, text };
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (actionMessage.value = null), 3500);
};

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
});
const numberFmt = new Intl.NumberFormat('id-ID');
const formatRupiah = (value: number) => rupiah.format(Number.isFinite(value) ? value : 0);
const formatNumber = (value: number) => numberFmt.format(Number.isFinite(value) ? value : 0);

const dateTimeFmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});
const formatDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFmt.format(date);
};

const shortId = (id: string | null) => {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
};

const unwrapInvoice = (invoice: PaymentInvoiceRelation) => {
  if (!invoice) return null;
  return Array.isArray(invoice) ? (invoice[0] ?? null) : invoice;
};

const invoiceNumber = (payment: AdminPaymentRow) =>
  unwrapInvoice(payment.invoices)?.invoice_number ?? '—';
const invoicePdfUrl = (payment: AdminPaymentRow | AdminPaymentDetail | null) =>
  payment ? (unwrapInvoice(payment.invoices)?.pdf_url ?? null) : null;

const STATUS_META: Record<string, { label: string; color: BadgeColor }> = {
  pending: { label: 'Pending', color: 'warning' },
  paid: { label: 'Lunas', color: 'success' },
  failed: { label: 'Gagal', color: 'error' },
  expired: { label: 'Kedaluwarsa', color: 'error' },
  refunded: { label: 'Refund', color: 'neutral' },
  partially_refunded: { label: 'Refund sebagian', color: 'warning' },
  cancelled: { label: 'Dibatalkan', color: 'error' }
};
const METHOD_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  card: 'Kartu',
  bank_transfer: 'Transfer bank',
  ewallet: 'E-wallet'
};

const statusMeta = (status: string) =>
  STATUS_META[status] ?? { label: status || '—', color: 'neutral' as BadgeColor };
const methodLabel = (method: string | null) => (method ? (METHOD_LABEL[method] ?? method) : '—');

const branchNameById = computed(() => new Map(branches.value.map((branch) => [branch.id, branch.name])));
const branchName = (branchId: string) => branchNameById.value.get(branchId) ?? shortId(branchId);

const uniqueOptions = (values: Array<string | null>, fallbackLabel: (value: string) => string = (value) => value) => [
  { value: ALL, label: 'Semua' },
  ...[...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort((a, b) => fallbackLabel(a).localeCompare(fallbackLabel(b)))
    .map((value) => ({ value, label: fallbackLabel(value) }))
];

const branchOptions = computed(() => [
  { value: ALL, label: 'Semua cabang' },
  ...branches.value.map((branch) => ({ value: branch.id, label: branch.name }))
]);
const statusOptions = computed(() =>
  uniqueOptions(rows.value.map((payment) => payment.status), (status) => statusMeta(status).label)
);
const methodOptions = computed(() =>
  uniqueOptions(rows.value.map((payment) => payment.method), methodLabel)
);
const providerOptions = computed(() =>
  uniqueOptions(rows.value.map((payment) => payment.provider), (provider) => provider.toUpperCase())
);

const DATE_FIELD_OPTIONS = [
  { value: 'created_at', label: 'Tanggal dibuat' },
  { value: 'paid_at', label: 'Tanggal lunas' }
];
const SORT_OPTIONS = [
  { value: 'created_at', label: 'Tanggal dibuat' },
  { value: 'paid_at', label: 'Tanggal lunas' },
  { value: 'total_amount', label: 'Nominal' },
  { value: 'status', label: 'Status' },
  { value: 'method', label: 'Metode' }
];
const ORDER_OPTIONS = [
  { value: 'asc', label: 'Naik' },
  { value: 'desc', label: 'Turun' }
];

const parseAmount = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const dateValue = (payment: AdminPaymentRow, field: string) =>
  field === 'paid_at' ? payment.paid_at : payment.created_at;

const dateInRange = (payment: AdminPaymentRow) => {
  const value = dateValue(payment, filters.date_field);
  if (!value) return !(filters.date_from || filters.date_to);
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;

  if (filters.date_from) {
    const start = new Date(`${filters.date_from}T00:00:00+07:00`).getTime();
    if (timestamp < start) return false;
  }
  if (filters.date_to) {
    const end = new Date(`${filters.date_to}T23:59:59+07:00`).getTime();
    if (timestamp > end) return false;
  }
  return true;
};

const matchesSearch = (payment: AdminPaymentRow) => {
  const q = filters.q.trim().toLowerCase();
  if (!q) return true;
  return [
    invoiceNumber(payment),
    payment.id,
    payment.appointment_id,
    payment.gateway_reference,
    payment.method,
    payment.provider,
    payment.status,
    branchName(payment.branch_id)
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(q));
};

const filteredPayments = computed(() => {
  const minAmount = parseAmount(filters.min_amount);
  const maxAmount = parseAmount(filters.max_amount);

  const data = rows.value.filter((payment) => {
    if (!matchesSearch(payment)) return false;
    if (filters.branch_id !== ALL && payment.branch_id !== filters.branch_id) return false;
    if (filters.status !== ALL && payment.status !== filters.status) return false;
    if (filters.method !== ALL && payment.method !== filters.method) return false;
    if (filters.provider !== ALL && payment.provider !== filters.provider) return false;
    if (minAmount != null && payment.total_amount < minAmount) return false;
    if (maxAmount != null && payment.total_amount > maxAmount) return false;
    return dateInRange(payment);
  });

  const direction = filters.order === 'desc' ? -1 : 1;
  return [...data].sort((a, b) => {
    if (filters.sort === 'total_amount') return (a.total_amount - b.total_amount) * direction;
    if (filters.sort === 'status') return a.status.localeCompare(b.status) * direction;
    if (filters.sort === 'method') return (a.method ?? '').localeCompare(b.method ?? '') * direction;
    const aDate = dateValue(a, filters.sort) ?? '';
    const bDate = dateValue(b, filters.sort) ?? '';
    return aDate.localeCompare(bDate) * direction;
  });
});

const sum = (selector: (payment: AdminPaymentRow) => number) =>
  filteredPayments.value.reduce((total, payment) => total + selector(payment), 0);
const countStatus = (status: string) => filteredPayments.value.filter((payment) => payment.status === status).length;

const metrics = computed(() => [
  {
    label: 'Total transaksi',
    value: formatNumber(filteredPayments.value.length),
    icon: 'i-lucide-receipt-text'
  },
  {
    label: 'Nominal terfilter',
    value: formatRupiah(sum((payment) => payment.total_amount)),
    icon: 'i-lucide-chart-no-axes-combined'
  },
  {
    label: 'Lunas',
    value: formatNumber(countStatus('paid')),
    icon: 'i-lucide-circle-check'
  },
  {
    label: 'Pending / gagal',
    value: formatNumber(countStatus('pending') + countStatus('failed') + countStatus('expired')),
    icon: 'i-lucide-triangle-alert'
  }
]);

const composition = computed(() => [
  { label: 'Layanan', value: formatRupiah(sum((payment) => payment.service_amount)) },
  { label: 'Produk', value: formatRupiah(sum((payment) => payment.product_amount)) },
  { label: 'Tip', value: formatRupiah(sum((payment) => payment.tip_amount)) },
  { label: 'Diskon', value: formatRupiah(sum((payment) => payment.discount_amount)) },
  { label: 'Biaya layanan', value: formatRupiah(sum((payment) => payment.service_fee)) },
  { label: 'Biaya kirim', value: formatRupiah(sum((payment) => payment.delivery_fee)) }
]);

const methodBreakdown = computed(() => {
  const totals = new Map<string, number>();
  for (const payment of filteredPayments.value) {
    const key = methodLabel(payment.method);
    totals.set(key, (totals.get(key) ?? 0) + payment.total_amount);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value: formatRupiah(value) }));
});

const resetFilters = () => {
  filters.q = '';
  filters.branch_id = ALL;
  filters.status = ALL;
  filters.method = ALL;
  filters.provider = ALL;
  filters.date_field = 'created_at';
  filters.date_from = '';
  filters.date_to = '';
  filters.min_amount = '';
  filters.max_amount = '';
  filters.sort = 'created_at';
  filters.order = 'desc';
};

const copyText = async (label: string, value: string | null) => {
  if (!value || value === '—') {
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

const viewAppointment = (payment: AdminPaymentRow) => {
  if (!payment.appointment_id) {
    flash('error', 'Appointment tidak tersedia.');
    return;
  }
  window.location.assign(`/backoffice/appointments?q=${encodeURIComponent(payment.appointment_id)}`);
};

const csvValue = (value: string | number | null) => {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const exportCsv = () => {
  const header = [
    'invoice',
    'payment_id',
    'appointment_id',
    'branch',
    'method',
    'provider',
    'status',
    'total_amount',
    'service_amount',
    'product_amount',
    'discount_amount',
    'tip_amount',
    'gateway_reference',
    'created_at',
    'paid_at'
  ];
  const lines = filteredPayments.value.map((payment) =>
    [
      invoiceNumber(payment),
      payment.id,
      payment.appointment_id,
      branchName(payment.branch_id),
      payment.method,
      payment.provider,
      payment.status,
      payment.total_amount,
      payment.service_amount,
      payment.product_amount,
      payment.discount_amount,
      payment.tip_amount,
      payment.gateway_reference,
      payment.created_at,
      payment.paid_at
    ]
      .map(csvValue)
      .join(',')
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  flash('success', 'CSV transaksi terfilter dibuat.');
};

const detailOpen = ref(false);
const detailLoading = ref(false);
const detailRow = ref<AdminPaymentDetail | null>(null);
const openDetail = async (payment: AdminPaymentRow) => {
  detailOpen.value = true;
  detailLoading.value = true;
  detailRow.value = null;
  try {
    detailRow.value = await fetchAdminPaymentDetail(payment.id);
  } catch (err) {
    flash('error', err instanceof Error ? err.message : 'Gagal memuat detail pembayaran.');
    detailOpen.value = false;
  } finally {
    detailLoading.value = false;
  }
};

const openInvoicePdf = (payment: AdminPaymentRow | AdminPaymentDetail | null) => {
  const url = invoicePdfUrl(payment);
  if (!url) {
    flash('error', 'PDF invoice belum tersedia.');
    return;
  }
  window.open(url, '_blank', 'noopener');
};

const rowMenuItems = (payment: AdminPaymentRow) => [
  [
    { label: 'Lihat detail', icon: 'i-lucide-eye', onSelect: () => openDetail(payment) },
    { label: 'Lihat appointment', icon: 'i-lucide-calendar-clock', onSelect: () => viewAppointment(payment) }
  ],
  [
    { label: 'Salin invoice', icon: 'i-lucide-copy', onSelect: () => copyText('Invoice', invoiceNumber(payment)) },
    { label: 'Salin payment ID', icon: 'i-lucide-hash', onSelect: () => copyText('Payment ID', payment.id) },
    { label: 'Salin appointment ID', icon: 'i-lucide-calendar', onSelect: () => copyText('Appointment ID', payment.appointment_id) },
    { label: 'Salin referensi gateway', icon: 'i-lucide-credit-card', onSelect: () => copyText('Referensi gateway', payment.gateway_reference) }
  ]
];

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    branches.value = await fetchAdminBranches();
    if (branches.value.length === 0) {
      rows.value = [];
      return;
    }
    const results = await Promise.all(branches.value.map((branch) => fetchBranchPayments(branch.id)));
    rows.value = results.flat();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Gagal memuat data pembayaran.';
  } finally {
    loading.value = false;
  }
};

onMounted(load);
</script>

<template>
  <Head title="Keuangan" />

  <AppLayout title="Keuangan" eyebrow="Finance">
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
            <div class="h-6 w-28 rounded bg-zinc-200" />
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
              <h2 class="text-sm font-semibold text-zinc-950">Transaksi Cabang</h2>
              <p class="text-xs text-zinc-500">
                Data diambil dari endpoint pembayaran per cabang sesuai scope akun.
              </p>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row">
              <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-file-down"
                :disabled="filteredPayments.length === 0"
                @click="exportCsv"
              >
                Export CSV
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
              placeholder="Cari invoice, appointment, referensi"
              class="lg:col-span-2"
            />
            <USelect v-model="filters.branch_id" :items="branchOptions" />
            <USelect v-model="filters.status" :items="statusOptions" />
            <USelect v-model="filters.method" :items="methodOptions" />
          </div>
          <div class="mt-3 grid gap-3 lg:grid-cols-6">
            <USelect v-model="filters.provider" :items="providerOptions" />
            <USelect v-model="filters.date_field" :items="DATE_FIELD_OPTIONS" />
            <UInput v-model="filters.date_from" type="date" />
            <UInput v-model="filters.date_to" type="date" />
            <UInput v-model="filters.min_amount" inputmode="numeric" placeholder="Min nominal" />
            <UInput v-model="filters.max_amount" inputmode="numeric" placeholder="Max nominal" />
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <USelect v-model="filters.sort" :items="SORT_OPTIONS" />
            <USelect v-model="filters.order" :items="ORDER_OPTIONS" />
            <div class="flex items-center text-xs text-zinc-500 sm:col-span-2">
              Menampilkan {{ filteredPayments.length }} dari {{ rows.length }} transaksi.
            </div>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-zinc-200 text-sm">
            <thead class="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th class="px-4 py-3">Invoice</th>
                <th class="px-4 py-3">Appointment</th>
                <th class="px-4 py-3">Cabang</th>
                <th class="px-4 py-3">Metode</th>
                <th class="px-4 py-3">Nominal</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3">Waktu</th>
                <th class="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-100">
              <tr v-if="loading">
                <td class="px-4 py-6 text-center text-zinc-400" colspan="8">Memuat transaksi…</td>
              </tr>
              <tr v-else-if="filteredPayments.length === 0">
                <td class="px-4 py-6 text-center text-zinc-400" colspan="8">Tidak ada transaksi sesuai filter.</td>
              </tr>
              <tr v-for="payment in filteredPayments" v-else :key="payment.id">
                <td class="px-4 py-3">
                  <p class="font-medium text-zinc-950">{{ invoiceNumber(payment) }}</p>
                  <p class="text-xs text-zinc-500">{{ shortId(payment.id) }}</p>
                </td>
                <td class="px-4 py-3 font-mono text-xs text-zinc-700">{{ shortId(payment.appointment_id) }}</td>
                <td class="px-4 py-3 text-zinc-700">{{ branchName(payment.branch_id) }}</td>
                <td class="px-4 py-3 text-zinc-700">
                  <p>{{ methodLabel(payment.method) }}</p>
                  <p class="text-xs text-zinc-500">{{ payment.provider ? payment.provider.toUpperCase() : '—' }}</p>
                </td>
                <td class="px-4 py-3">
                  <p class="font-medium text-zinc-950">{{ formatRupiah(payment.total_amount) }}</p>
                  <p class="text-xs text-zinc-500">Tip {{ formatRupiah(payment.tip_amount) }}</p>
                </td>
                <td class="px-4 py-3">
                  <UBadge :color="statusMeta(payment.status).color" variant="subtle">
                    {{ statusMeta(payment.status).label }}
                  </UBadge>
                </td>
                <td class="px-4 py-3 text-zinc-700">
                  <p>{{ formatDateTime(payment.created_at) }}</p>
                  <p class="text-xs text-zinc-500">Lunas {{ formatDateTime(payment.paid_at) }}</p>
                </td>
                <td class="px-4 py-3 text-right">
                  <UDropdownMenu :items="rowMenuItems(payment)" :content="{ align: 'end' }">
                    <UButton
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-ellipsis-vertical"
                      aria-label="Aksi transaksi"
                    />
                  </UDropdownMenu>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-4">
        <div class="rounded-md border border-zinc-200 bg-white p-4">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold text-zinc-950">Komposisi Nominal</h2>
            <UBadge color="neutral" variant="outline">{{ filteredPayments.length }} transaksi</UBadge>
          </div>
          <div class="mt-4 space-y-3">
            <div v-for="item in composition" :key="item.label" class="flex items-center justify-between gap-3">
              <span class="text-sm text-zinc-700">{{ item.label }}</span>
              <span class="text-sm font-semibold text-zinc-950">{{ item.value }}</span>
            </div>
          </div>
        </div>

        <div class="rounded-md border border-zinc-200 bg-white p-4">
          <h2 class="text-sm font-semibold text-zinc-950">Metode Pembayaran</h2>
          <div class="mt-4 space-y-3">
            <p v-if="methodBreakdown.length === 0" class="text-sm text-zinc-400">Belum ada data.</p>
            <div v-for="item in methodBreakdown" v-else :key="item.label" class="flex items-center justify-between gap-3">
              <span class="text-sm text-zinc-700">{{ item.label }}</span>
              <span class="text-sm font-semibold text-zinc-950">{{ item.value }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <USlideover v-model:open="detailOpen" title="Detail Pembayaran" :ui="{ content: 'max-w-lg' }">
      <template #body>
        <div v-if="detailLoading" class="py-10 text-center text-sm text-zinc-400">Memuat detail transaksi…</div>
        <div v-else-if="detailRow" class="space-y-5 text-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-lg font-semibold text-zinc-950">{{ invoiceNumber(detailRow) }}</p>
              <p class="mt-1 font-mono text-xs text-zinc-500">{{ detailRow.id }}</p>
            </div>
            <UBadge :color="statusMeta(detailRow.status).color" variant="subtle">
              {{ statusMeta(detailRow.status).label }}
            </UBadge>
          </div>

          <USeparator />

          <dl class="grid grid-cols-2 gap-3">
            <div class="rounded-md bg-zinc-50 p-3">
              <dt class="text-xs text-zinc-500">Total</dt>
              <dd class="mt-1 text-lg font-semibold text-zinc-950">{{ formatRupiah(detailRow.total_amount) }}</dd>
            </div>
            <div class="rounded-md bg-zinc-50 p-3">
              <dt class="text-xs text-zinc-500">Metode</dt>
              <dd class="mt-1 text-lg font-semibold text-zinc-950">{{ methodLabel(detailRow.method) }}</dd>
            </div>
            <div class="rounded-md bg-zinc-50 p-3">
              <dt class="text-xs text-zinc-500">Layanan</dt>
              <dd class="mt-1 font-semibold text-zinc-950">{{ formatRupiah(detailRow.service_amount) }}</dd>
            </div>
            <div class="rounded-md bg-zinc-50 p-3">
              <dt class="text-xs text-zinc-500">Produk</dt>
              <dd class="mt-1 font-semibold text-zinc-950">{{ formatRupiah(detailRow.product_amount) }}</dd>
            </div>
            <div class="rounded-md bg-zinc-50 p-3">
              <dt class="text-xs text-zinc-500">Tip</dt>
              <dd class="mt-1 font-semibold text-zinc-950">{{ formatRupiah(detailRow.tip_amount) }}</dd>
            </div>
            <div class="rounded-md bg-zinc-50 p-3">
              <dt class="text-xs text-zinc-500">Diskon</dt>
              <dd class="mt-1 font-semibold text-zinc-950">{{ formatRupiah(detailRow.discount_amount) }}</dd>
            </div>
          </dl>

          <USeparator />

          <dl class="space-y-2 text-zinc-700">
            <div class="flex justify-between gap-3">
              <dt class="text-zinc-500">Cabang</dt>
              <dd>{{ branchName(detailRow.branch_id) }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-zinc-500">Provider</dt>
              <dd>{{ detailRow.provider ? detailRow.provider.toUpperCase() : '—' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-zinc-500">Referensi gateway</dt>
              <dd class="max-w-56 truncate font-mono text-xs" :title="detailRow.gateway_reference ?? ''">
                {{ detailRow.gateway_reference ?? '—' }}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-zinc-500">Dibuat</dt>
              <dd>{{ formatDateTime(detailRow.created_at) }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-zinc-500">Lunas</dt>
              <dd>{{ formatDateTime(detailRow.paid_at) }}</dd>
            </div>
          </dl>

          <USeparator />

          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Appointment terkait</p>
            <dl class="space-y-2 text-zinc-700">
              <div class="flex justify-between gap-3">
                <dt class="text-zinc-500">Appointment ID</dt>
                <dd class="font-mono text-xs">{{ detailRow.appointment_id ?? '—' }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-zinc-500">Status appointment</dt>
                <dd>{{ detailRow.appointments?.status ?? '—' }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-zinc-500">Sumber</dt>
                <dd>{{ detailRow.appointments?.source ?? '—' }}</dd>
              </div>
            </dl>
          </div>

          <USeparator />

          <div class="grid grid-cols-2 gap-2">
            <UButton color="neutral" variant="soft" icon="i-lucide-copy" @click="copyText('Invoice', invoiceNumber(detailRow))">
              Salin invoice
            </UButton>
            <UButton color="neutral" variant="soft" icon="i-lucide-hash" @click="copyText('Payment ID', detailRow.id)">
              Salin ID
            </UButton>
            <UButton color="neutral" variant="soft" icon="i-lucide-calendar-clock" @click="viewAppointment(detailRow)">
              Appointment
            </UButton>
            <UButton color="neutral" variant="soft" icon="i-lucide-file-text" @click="openInvoicePdf(detailRow)">
              Invoice PDF
            </UButton>
          </div>
        </div>
      </template>
    </USlideover>
  </AppLayout>
</template>
