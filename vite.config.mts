import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import inertia from '@inertiajs/vite';
import ui from '@nuxt/ui/vite';

const vitePort = Number(process.env.VITE_PORT || 5173);

export default defineConfig({
  publicDir: false,
  plugins: [
    vue(),
    inertia({ ssr: false }),
    ui({
      router: 'inertia',
      colorMode: false,
      dts: false,
      autoImport: false,
      components: false,
      ui: {
        colors: {
          primary: 'emerald',
          neutral: 'zinc'
        }
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    port: Number.isInteger(vitePort) && vitePort > 0 ? vitePort : 5173
  },
  build: {
    manifest: 'manifest.json',
    outDir: 'public/build',
    emptyOutDir: true,
    rollupOptions: {
      input: 'resources/js/app.ts'
    }
  },
  resolve: {
    alias: {
      '@': '/resources/js'
    }
  }
});
