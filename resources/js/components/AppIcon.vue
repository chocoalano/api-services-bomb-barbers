<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { computed } from 'vue';

// Ikon standalone untuk konteks non-Nuxt-UI (mis. di dalam <span>/badge kustom).
// Menerima nama format `i-lucide-*` agar konsisten dengan prop `icon` Nuxt UI,
// lalu mengubahnya ke bentuk yang dikenali @iconify/vue (`lucide-*`).
// Ikonnya diambil dari koleksi yang sudah didaftarkan offline di app.ts.
const props = defineProps<{ name: string }>();

const iconName = computed(() => props.name.replace(/^i-/, ''));
</script>

<template>
  <Icon :icon="iconName" aria-hidden="true" />
</template>
