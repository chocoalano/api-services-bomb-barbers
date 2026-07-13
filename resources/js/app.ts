import '../css/app.css';

import { createInertiaApp } from '@inertiajs/vue3';
import { addCollection } from '@iconify/vue';
import ui from '@nuxt/ui/vue-plugin';
import lucideIcons from '@iconify-json/lucide/icons.json';
import { createApp, h, type DefineComponent } from 'vue';

// Daftarkan koleksi ikon Lucide secara OFFLINE ke store @iconify/vue.
// Tanpa ini, ikon Nuxt UI (prop `icon="i-lucide-*"`) diambil dari Iconify API
// via jaringan saat runtime — bisa gagal/hilang di produksi. Registrasi ini
// membuat seluruh ikon tersedia lokal (dev & build) tanpa dependensi jaringan.
addCollection(lucideIcons as Parameters<typeof addCollection>[0]);

const appName = import.meta.env.VITE_APP_NAME || 'Bomb Barbershop';

createInertiaApp({
  title: (title) => (title ? `${title} | ${appName}` : appName),
  resolve: async (name) => {
    const pages = import.meta.glob<{ default: DefineComponent }>('./pages/**/*.vue');
    const page = pages[`./pages/${name}.vue`];

    if (!page) {
      throw new Error(`Halaman Inertia "${name}" tidak ditemukan.`);
    }

    return (await page()).default;
  },
  setup({ el, App, props, plugin }) {
    if (!el) return;

    createApp({ render: () => h(App, props) })
      .use(plugin)
      .use(ui)
      .mount(el);
  },
  defaults: {
    form: {
      recentlySuccessfulDuration: 2500
    },
    prefetch: {
      cacheFor: '30s',
      hoverDelay: 120
    }
  }
});
