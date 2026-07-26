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
import { existsSync, rmSync } from 'node:fs';
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

const entry = join(target, 'dist', 'sidecar.mjs');
if (!existsSync(entry)) {
  console.error(`deploy-sidecar: ${entry} missing — run the server build first`);
  process.exit(1);
}
console.log(`deploy-sidecar: staged ${target}`);
