<script setup lang="ts">
import UApp from '@nuxt/ui/components/App.vue';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import { computed, onMounted, ref } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import {
  clearSession,
  fetchAdminProfile,
  getAccessToken,
  getStoredStaff,
  logoutAdmin,
  redirectToLogin,
  type StaffSession
} from '../lib/api';

defineProps<{
  title: string;
  eyebrow?: string;
}>();

// Setiap item punya `permission`; item hanya tampil bila staff memiliki
// permission tersebut (atau super_admin/global). Sumber kebenaran = RBAC backend.
type NavItem = {
  label: string;
  href: string;
  icon: string;
  permission: string | string[] | null;
};

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/backoffice/dashboard', icon: 'i-lucide-layout-dashboard', permission: null },
  { label: 'Appointment', href: '/backoffice/appointments', icon: 'i-lucide-calendar-clock', permission: 'manage_appointment' },
  { label: 'Cabang', href: '/backoffice/branches', icon: 'i-lucide-store', permission: 'manage_branch' },
  { label: 'Barber', href: '/backoffice/barbers', icon: 'i-lucide-scissors', permission: 'manage_appointment' },
  { label: 'Barber Mendaftar', href: '/backoffice/barbers-pending', icon: 'i-lucide-user-plus', permission: 'manage_barber' },
  { label: 'Customer', href: '/backoffice/customers', icon: 'i-lucide-users', permission: 'view_customers' },
  { label: 'Keuangan', href: '/backoffice/payments', icon: 'i-lucide-wallet', permission: 'manage_payment' },
  { label: 'Users', href: '/backoffice/users', icon: 'i-lucide-users', permission: ['manage_users', 'manage_staff'] },
  { label: 'Roles', href: '/backoffice/roles', icon: 'i-lucide-shield', permission: ['manage_roles', 'manage_staff'] },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  branch_admin: 'Admin Cabang',
  barber: 'Barber'
};

const ROLE_PRIORITY = ['super_admin', 'branch_admin', 'barber'];

const currentPath = typeof window === 'undefined' ? '' : window.location.pathname;

const staff = ref<StaffSession | null>(null);
const loggingOut = ref(false);
const mobileNavOpen = ref(false);
const notifOpen = ref(false);

const navigation = computed<NavItem[]>(() => {
  const session = staff.value;
  if (!session) return NAV_ITEMS.filter((item) => item.permission === null);
  return NAV_ITEMS.filter(
    (item) => {
      if (item.permission === null || session.is_global) return true;
      const permissions = Array.isArray(item.permission) ? item.permission : [item.permission];
      return permissions.some((permission) => session.permissions.includes(permission));
    }
  );
});

const primaryRole = computed(() => {
  const roles = staff.value?.roles ?? [];
  const ranked = ROLE_PRIORITY.find((role) => roles.includes(role));
  return ranked ?? roles[0] ?? '';
});

const roleLabel = computed(() => ROLE_LABELS[primaryRole.value] || primaryRole.value || 'Staff');

const displayName = computed(() => staff.value?.full_name || 'Pengguna');
const displayEmail = computed(() => staff.value?.email || '');

const initials = computed(() => {
  const name = displayName.value.trim();
  if (!name) return 'BB';
  const parts = name.split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || 'BB';
});

const isActive = (href: string) => currentPath === href || currentPath.startsWith(`${href}/`);

const openMobileNav = () => {
  mobileNavOpen.value = true;
};
const closeMobileNav = () => {
  mobileNavOpen.value = false;
};
const toggleNotif = () => {
  notifOpen.value = !notifOpen.value;
};

const handleLogout = async () => {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await logoutAdmin();
  } finally {
    clearSession();
    redirectToLogin();
  }
};

onMounted(async () => {
  // Tanpa token → langsung ke halaman login (layout hanya untuk sesi aktif).
  if (!getAccessToken()) {
    redirectToLogin();
    return;
  }

  // Render instan dari cache, lalu sinkronkan role dengan backend.
  staff.value = getStoredStaff();
  try {
    staff.value = await fetchAdminProfile();
  } catch {
    // authGetJson sudah menangani 401 (redirect). Error lain: pertahankan cache.
  }
});
</script>

<template>
  <UApp>
    <div class="min-h-screen bg-zinc-50/80 text-zinc-950">
      <!-- Overlay drawer mobile -->
      <div
        v-if="mobileNavOpen"
        class="fixed inset-0 z-30 bg-zinc-950/40 lg:hidden"
        @click="mobileNavOpen = false"
      />

      <aside
        class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-zinc-200 bg-white transition-transform lg:translate-x-0"
        :class="mobileNavOpen ? 'translate-x-0' : '-translate-x-full'"
      >
        <div class="flex h-16 items-center gap-3 border-b border-zinc-200 px-5">
          <div class="grid size-9 place-items-center rounded-md bg-emerald-600 text-sm font-bold text-white">
            BB
          </div>
          <div>
            <p class="text-sm font-semibold leading-5">Bomb Barbershop</p>
            <p class="text-xs text-zinc-500">Backoffice</p>
          </div>
          <UButton
            class="ml-auto lg:hidden"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="Tutup menu"
            @click="closeMobileNav"
          />
        </div>

        <nav class="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <a
            v-for="item in navigation"
            :key="item.href"
            :href="item.href"
            class="flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors"
            :class="isActive(item.href)
              ? 'bg-emerald-50 text-emerald-700'
              : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'"
          >
            <AppIcon :name="item.icon" class="size-4" />
            <span>{{ item.label }}</span>
          </a>
        </nav>

        <!-- Kartu user + logout -->
        <div class="border-t border-zinc-200 p-3">
          <div class="flex items-center gap-3 rounded-md px-2 py-2">
            <div class="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
              {{ initials }}
            </div>
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-zinc-950">{{ displayName }}</p>
              <p class="truncate text-xs text-zinc-500">{{ displayEmail }}</p>
            </div>
          </div>
          <div class="mt-2 flex items-center justify-between px-2">
            <UBadge color="primary" variant="subtle">{{ roleLabel }}</UBadge>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-log-out"
              :loading="loggingOut"
              @click="handleLogout"
            >
              Keluar
            </UButton>
          </div>
        </div>
      </aside>

      <div class="lg:pl-64">
        <header class="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
          <div class="flex min-h-16 items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <div class="flex items-center gap-3">
              <UButton
                class="lg:hidden"
                color="neutral"
                variant="ghost"
                icon="i-lucide-menu"
                aria-label="Buka menu"
                @click="openMobileNav"
              />
              <div>
                <p v-if="eyebrow" class="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  {{ eyebrow }}
                </p>
                <h1 class="text-lg font-semibold text-zinc-950 sm:text-xl">
                  {{ title }}
                </h1>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UBadge color="primary" variant="subtle">Live</UBadge>

              <div class="relative">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-bell"
                  aria-label="Notifikasi"
                  @click="toggleNotif"
                />
                <div
                  v-if="notifOpen"
                  class="absolute right-0 top-12 z-20 w-72 rounded-md border border-zinc-200 bg-white p-4 shadow-lg"
                >
                  <p class="text-sm font-semibold text-zinc-950">Notifikasi</p>
                  <p class="mt-2 text-sm text-zinc-500">Belum ada notifikasi baru.</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main class="px-4 py-5 sm:px-6">
          <slot />
        </main>
      </div>
    </div>
  </UApp>
</template>
