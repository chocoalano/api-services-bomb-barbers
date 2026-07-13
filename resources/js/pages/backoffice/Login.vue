<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import UApp from '@nuxt/ui/components/App.vue';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UFormField from '@nuxt/ui/components/FormField.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import { computed, ref } from 'vue';
import { loginAdmin, setSession } from '../../lib/api';

const email = ref('');
const password = ref('');
const loading = ref(false);
const errorMessage = ref('');

const canSubmit = computed(() => email.value.trim().length > 0 && password.value.length >= 8);

const submit = async () => {
  if (!canSubmit.value || loading.value) return;

  loading.value = true;
  errorMessage.value = '';

  try {
    const result = await loginAdmin(email.value.trim(), password.value);
    setSession(
      { accessToken: result.data.accessToken, refreshToken: result.data.refreshToken },
      result.data.staff
    );
    window.location.assign('/backoffice/dashboard');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Login gagal diproses.';
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <Head title="Login Admin" />

  <UApp>
    <main class="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_480px]">
      <section class="backoffice-image-panel relative hidden min-h-screen p-8 text-white lg:flex lg:flex-col lg:justify-between">
        <div>
          <div class="inline-flex items-center gap-3 rounded-md bg-white/12 px-3 py-2 backdrop-blur">
            <span class="grid size-9 place-items-center rounded-md bg-emerald-500 text-sm font-bold">BB</span>
            <span class="text-sm font-semibold">Bomb Barbershop</span>
          </div>
        </div>

        <div class="max-w-xl">
          <UBadge color="primary" variant="solid" class="mb-4">Backoffice</UBadge>
          <h1 class="text-4xl font-semibold leading-tight">
            Kendali operasional cabang dalam satu panel.
          </h1>
          <div class="mt-8 grid grid-cols-3 gap-3">
            <div class="rounded-md bg-white/12 p-4 backdrop-blur">
              <p class="text-2xl font-semibold">24</p>
              <p class="mt-1 text-xs text-white/75">Cabang aktif</p>
            </div>
            <div class="rounded-md bg-white/12 p-4 backdrop-blur">
              <p class="text-2xl font-semibold">186</p>
              <p class="mt-1 text-xs text-white/75">Barber</p>
            </div>
            <div class="rounded-md bg-white/12 p-4 backdrop-blur">
              <p class="text-2xl font-semibold">99%</p>
              <p class="mt-1 text-xs text-white/75">SLA antrean</p>
            </div>
          </div>
        </div>
      </section>

      <section class="flex min-h-screen items-center justify-center px-5 py-10">
        <div class="w-full max-w-sm">
          <div class="mb-8 lg:hidden">
            <div class="grid size-11 place-items-center rounded-md bg-emerald-600 text-sm font-bold text-white">
              BB
            </div>
            <h1 class="mt-5 text-2xl font-semibold text-zinc-950">Bomb Barbershop</h1>
            <p class="mt-1 text-sm text-zinc-500">Backoffice</p>
          </div>

          <div class="rounded-md border border-zinc-200 bg-white p-6 shadow-sm">
            <div>
              <p class="text-sm font-medium text-emerald-700">Admin Panel</p>
              <h2 class="mt-1 text-2xl font-semibold text-zinc-950">Masuk</h2>
            </div>

            <form class="mt-6 space-y-4" @submit.prevent="submit">
              <UFormField label="Email">
                <UInput
                  v-model="email"
                  type="email"
                  autocomplete="email"
                  placeholder="admin@bombbarbershop.com"
                  icon="i-lucide-mail"
                  :disabled="loading"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="Kata sandi">
                <UInput
                  v-model="password"
                  type="password"
                  autocomplete="current-password"
                  placeholder="Minimal 8 karakter"
                  icon="i-lucide-lock-keyhole"
                  :disabled="loading"
                  class="w-full"
                />
              </UFormField>

              <div
                v-if="errorMessage"
                class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {{ errorMessage }}
              </div>

              <UButton
                type="submit"
                color="primary"
                block
                icon="i-lucide-log-in"
                :loading="loading"
                :disabled="!canSubmit"
              >
                Masuk
              </UButton>
            </form>
          </div>
        </div>
      </section>
    </main>
  </UApp>
</template>
