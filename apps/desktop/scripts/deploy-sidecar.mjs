/// beforeBuildCommand step — stage the sidecar WITH its production
/// node_modules so the packaged app has real DB drivers (better-sqlite3,
/// duckdb, libsql, ioredis, mongodb are native/heavy and cannot be
/// esbuild-bundled into sidecar.mjs).
///
/// `pnpm deploy` produces a self-contained copy of @webcraft/server
/// (dist/ + prod node_modules with workspace deps resolved) into
/// src-tauri/sidecar-runtime, which tauri.conf ships as a resource.
/// Native modules are compiled per-platform on each CI runner.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(here, '..', '..', '..');
const target = join(here, '..', 'src-tauri', 'sidecar-runtime');

rmSync(target, { recursive: true, force: true });

// hoisted linker → REAL files, no symlinks: the Tauri resource copier
// silently drops pnpm's symlinked top-level entries, which broke module
// resolution inside the packaged app.
execSync(
  `pnpm --filter @webcraft/server --prod --config.node-linker=hoisted deploy ${JSON.stringify(target)}`,
  { cwd: workspaceRoot, stdio: 'inherit' },
);

// Symlinks must not survive into the bundle: the macOS resource copier
// drops them silently and linuxdeploy fails HARD on dangling ones inside
// the AppDir. node_modules/.bin (all symlinks) is not needed at runtime.
rmSync(join(target, 'node_modules', '.bin'), { recursive: true, force: true });
let pruned = 0;
function pruneSymlinks(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isSymbolicLink()) {
      rmSync(full, { force: true });
      pruned++;
    } else if (e.isDirectory()) {
      pruneSymlinks(full);
    }
  }
}
pruneSymlinks(target);
if (pruned > 0) console.log(`deploy-sidecar: pruned ${pruned} symlinks`);

// Foreign-platform prebuilts (e.g. @libsql/linux-x64-musl on a gnu build,
// darwin dirs on Windows) must go: linuxdeploy runs ldd over every ELF in
// the AppDir and aborts on incompatible binaries — and they are dead
// weight on every platform anyway.
const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? '';
const os = triple.includes('darwin')
  ? 'darwin'
  : triple.includes('windows')
    ? 'win32'
    : triple.includes('linux')
      ? 'linux'
      : process.platform;
const cpu = triple.startsWith('aarch64') || (!triple && process.arch === 'arm64') ? 'arm64' : 'x64';
const OS_TOKENS = ['darwin', 'linux', 'win32', 'windows', 'android', 'freebsd', 'ios'];
const CPU_TOKENS = ['arm64', 'aarch64', 'x64', 'x86_64', 'ia32', 'armv7'];
function isForeignPlatformDir(name) {
  const lower = name.toLowerCase();
  const mentionsOs = OS_TOKENS.filter((t) => lower.includes(t));
  const mentionsCpu = CPU_TOKENS.filter((t) => lower.includes(t));
  if (mentionsOs.length === 0 && mentionsCpu.length === 0 && !lower.includes('musl')) return false;
  const osOk =
    mentionsOs.length === 0 || mentionsOs.some((t) => t === os || (os === 'win32' && t === 'windows'));
  const cpuOk =
    mentionsCpu.length === 0 ||
    mentionsCpu.some((t) => (cpu === 'arm64' ? t === 'arm64' || t === 'aarch64' : t === 'x64' || t === 'x86_64'));
  const libcOk = os !== 'linux' ? !lower.includes('musl') : !lower.includes('musl'); // we always build gnu
  return !(osOk && cpuOk && libcOk);
}
let prunedForeign = 0;
function pruneForeign(dir, depth) {
  if (depth > 4) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = join(dir, e.name);
    if (isForeignPlatformDir(e.name)) {
      rmSync(full, { recursive: true, force: true });
      prunedForeign++;
    } else {
      pruneForeign(full, depth + 1);
    }
  }
}
pruneForeign(join(target, 'node_modules'), 0);
console.log(`deploy-sidecar: pruned ${prunedForeign} foreign-platform dirs (target ${os}-${cpu})`);

const entry = join(target, 'dist', 'sidecar.mjs');
if (!existsSync(entry)) {
  console.error(`deploy-sidecar: ${entry} missing — run the server build first`);
  process.exit(1);
}
console.log(`deploy-sidecar: staged ${target}`);
