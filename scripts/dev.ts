/**
 * Orkestrasi dev satu perintah: `bun run dev`.
 *
 * Menjalankan sekaligus:
 *   - api   → REST API (:3000) + Socket.IO (:3001)  [src/server.ts]
 *   - web   → Web host / SPA shell (:5174, mode aset dev)  [src/web/server.ts]
 *   - vite  → Vite dev assets + HMR (:5173)  [node_modules/.bin/vite]
 *
 * Output tiap proses diberi prefix berwarna. Ctrl+C (SIGINT) mematikan semuanya,
 * dan bila salah satu proses mati, sisanya ikut dihentikan agar tidak ada proses
 * yatim yang menahan port.
 */
import type { Subprocess } from 'bun';
import { createServer } from 'node:net';

type Task = {
  name: string;
  color: string;
  cmd: string[];
  env?: Record<string, string>;
};

const RESET = '\x1b[0m';

// ── Preflight: pastikan port yang dibutuhkan bebas ────────────────────────────
// Dev shell (renderer) mereferensikan Vite di :5173 secara default, jadi 5173 juga
// wajib bebas (bukan sekadar auto-increment) agar aset Vue termuat.
const REQUIRED_PORTS: Array<{ port: number; label: string }> = [
  { port: 3000, label: 'API' },
  { port: 3001, label: 'Socket.IO' },
  { port: 5173, label: 'Vite' },
  { port: 5174, label: 'Web' }
];

const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });

const holderOf = (port: number): string => {
  try {
    const out = Bun.spawnSync(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).stdout.toString().trim();
    const line = out.split('\n').find((l) => !l.startsWith('COMMAND'));
    if (!line) return '';
    const [cmd, pid] = line.split(/\s+/);
    return ` (pid ${pid} · ${cmd})`;
  } catch {
    return '';
  }
};

const preflight = async () => {
  const busy = [] as Array<{ port: number; label: string }>;
  for (const p of REQUIRED_PORTS) if (!(await portFree(p.port))) busy.push(p);
  if (busy.length === 0) return;

  process.stderr.write('\x1b[31m\x1b[1mGagal memulai dev stack — port berikut sedang dipakai:\x1b[0m\n');
  for (const b of busy) process.stderr.write(`  \x1b[31m•\x1b[0m :${b.port} (${b.label})${holderOf(b.port)}\n`);
  process.stderr.write(
    '\nKemungkinan `bun run dev` lain masih berjalan. Hentikan dulu, lalu jalankan ulang.\n' +
    'Cepat bebaskan semua port dev:\n' +
    "  \x1b[2mlsof -tiTCP:3000,3001,5173,5174 -sTCP:LISTEN | xargs kill\x1b[0m\n"
  );
  process.exit(1);
};

await preflight();
const tasks: Task[] = [
  { name: 'api ', color: '\x1b[36m', cmd: ['bun', 'run', '--watch', 'src/server.ts'] },
  { name: 'web ', color: '\x1b[35m', cmd: ['bun', 'run', '--watch', 'src/web/server.ts'], env: { WEB_ASSET_MODE: 'dev' } },
  { name: 'vite', color: '\x1b[32m', cmd: ['node_modules/.bin/vite', '--host', '0.0.0.0'] }
];

const children: Subprocess[] = [];
let shuttingDown = false;

const pipe = async (stream: ReadableStream<Uint8Array>, name: string, color: string) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const tag = `${color}[${name.trim()}]${RESET} `;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(tag + line + '\n');
    }
  } catch {
    /* stream ditutup saat shutdown — abaikan */
  }
  if (buf) process.stdout.write(tag + buf + '\n');
};

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* sudah mati */ }
  }
  // Beri waktu graceful, lalu paksa keluar.
  setTimeout(() => process.exit(code), 400);
};

for (const t of tasks) {
  const child = Bun.spawn(t.cmd, {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: '1', ...(t.env ?? {}) },
    stdout: 'pipe',
    stderr: 'pipe',
    onExit(_proc, exitCode) {
      if (shuttingDown) return;
      process.stdout.write(`${t.color}[${t.name.trim()}]${RESET} proses berhenti (code ${exitCode}). Menghentikan yang lain…\n`);
      shutdown(exitCode ?? 1);
    }
  });
  children.push(child);
  void pipe(child.stdout as ReadableStream<Uint8Array>, t.name, t.color);
  void pipe(child.stderr as ReadableStream<Uint8Array>, t.name, t.color);
}

process.stdout.write(
  '\x1b[1mDev stack aktif:\x1b[0m ' +
  '\x1b[36mapi :3000/:3001\x1b[0m · \x1b[35mweb :5174\x1b[0m · \x1b[32mvite :5173\x1b[0m  (Ctrl+C untuk berhenti)\n' +
  'Buka backoffice di \x1b[4mhttp://localhost:5174/backoffice/login\x1b[0m\n'
);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
