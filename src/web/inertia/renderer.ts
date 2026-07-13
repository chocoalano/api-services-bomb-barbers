import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toJakartaResponse } from '../../shared/timezone';

type InertiaProps = Record<string, unknown>;

type InertiaPage = {
  component: string;
  props: InertiaProps & { errors: Record<string, unknown> };
  url: string;
  version: string;
};

type ResponseSet = {
  status?: number | string;
  headers: Record<string, string | number>;
};

type RenderOptions = {
  request: Request;
  set: ResponseSet;
  component: string;
  props?: InertiaProps;
};

type ViteManifestEntry = {
  file: string;
  css?: string[];
};

type ViteManifest = Record<string, ViteManifestEntry>;

const entrypoint = 'resources/js/app.ts';
const manifestPath = resolve(process.cwd(), 'public/build/manifest.json');

let manifestCache: ViteManifest | null = null;
let versionCache: string | null = null;

const isDevAssets = () =>
  process.env.WEB_ASSET_MODE === 'dev' ||
  (process.env.NODE_ENV !== 'production' && !existsSync(manifestPath));

const viteDevServerUrl = () => (process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173').replace(/\/+$/, '');

const escapeJsonForHtml = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const readManifest = () => {
  if (manifestCache) return manifestCache;

  if (!existsSync(manifestPath)) {
    throw new Error('Vite manifest tidak ditemukan. Jalankan `bun run build:web` sebelum menjalankan web server produksi.');
  }

  manifestCache = JSON.parse(readFileSync(manifestPath, 'utf8')) as ViteManifest;
  return manifestCache;
};

export const inertiaAssetVersion = () => {
  if (versionCache) return versionCache;
  if (isDevAssets()) return 'dev';

  const manifestContents = readFileSync(manifestPath, 'utf8');
  versionCache = createHash('sha256').update(manifestContents).digest('hex').slice(0, 16);
  return versionCache;
};

const assetTags = () => {
  if (isDevAssets()) {
    const devServer = viteDevServerUrl();
    return [
      `<script type="module" src="${devServer}/@vite/client"></script>`,
      `<script type="module" src="${devServer}/${entrypoint}"></script>`
    ].join('\n    ');
  }

  const manifest = readManifest();
  const entry = manifest[entrypoint];

  if (!entry) {
    throw new Error(`Entrypoint "${entrypoint}" tidak ditemukan di Vite manifest.`);
  }

  const styles = (entry.css || [])
    .map((asset) => `<link rel="stylesheet" href="/build/${escapeHtml(asset)}">`);

  return [
    ...styles,
    `<script type="module" src="/build/${escapeHtml(entry.file)}"></script>`
  ].join('\n    ');
};

const requestPath = (request: Request) => {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
};

const pageFor = (request: Request, component: string, props: InertiaProps = {}): InertiaPage => ({
  component,
  props: {
    errors: {},
    ...toJakartaResponse(props)
  },
  url: requestPath(request),
  version: inertiaAssetVersion()
});

const htmlShell = (page: InertiaPage) => {
  const appName = process.env.WEB_APP_NAME || 'Bomb Barbershop Backoffice';

  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(appName)}</title>
    ${assetTags()}
  </head>
  <body>
    <script data-page="app" type="application/json">${escapeJsonForHtml(page)}</script>
    <div id="app"></div>
  </body>
</html>`;
};

export const renderInertia = ({ request, set, component, props }: RenderOptions) => {
  const page = pageFor(request, component, props);
  const isInertiaRequest = request.headers.get('x-inertia') === 'true';

  set.headers.Vary = 'X-Inertia';

  if (isInertiaRequest) {
    const clientVersion = request.headers.get('x-inertia-version');

    if (clientVersion && clientVersion !== page.version) {
      set.status = 409;
      set.headers['X-Inertia-Location'] = page.url;
      return null;
    }

    set.headers['X-Inertia'] = 'true';
    set.headers['Content-Type'] = 'application/json; charset=utf-8';
    return page;
  }

  set.headers['Content-Type'] = 'text/html; charset=utf-8';
  return htmlShell(page);
};
