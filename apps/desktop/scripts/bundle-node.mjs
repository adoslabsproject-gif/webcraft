/// beforeBuildCommand step — bundle the official Node.js runtime so the
/// sidecar (LSP, DB drivers, RAG, MCP, Claude Code bridge) works on
/// machines WITHOUT Node installed. Cached: re-download only when the
/// pinned version changes.
///
/// The build target comes from TAURI_ENV_TARGET_TRIPLE (falls back to the
/// host) so the macOS x86_64 cross-build ships an x64 node, not the arm64
/// host's one.

import { execSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = '22.14.0';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = join(here, '..', 'src-tauri', 'node-runtime');
const marker = join(runtimeDir, '.version');

function distFor() {
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? '';
  let plat;
  if (triple.includes('apple-darwin')) plat = triple.startsWith('aarch64') ? 'darwin-arm64' : 'darwin-x64';
  else if (triple.includes('windows')) plat = 'win-x64';
  else if (triple.includes('linux')) plat = triple.startsWith('aarch64') ? 'linux-arm64' : 'linux-x64';
  else {
    // dev fallback: host platform
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    plat =
      process.platform === 'darwin'
        ? `darwin-${arch}`
        : process.platform === 'win32'
          ? 'win-x64'
          : `linux-${arch}`;
  }
  const base = `node-v${NODE_VERSION}-${plat}`;
  const isZip = plat.startsWith('win');
  return {
    archive: `https://nodejs.org/dist/v${NODE_VERSION}/${base}.${isZip ? 'zip' : 'tar.gz'}`,
    binPath: isZip ? `${base}/node.exe` : `${base}/bin/node`,
    isZip,
  };
}

const { archive, binPath, isZip } = distFor();
const targetBin = join(runtimeDir, isZip ? 'node.exe' : 'node');
const wanted = `${NODE_VERSION}:${archive}`;

if (existsSync(targetBin) && existsSync(marker) && readFileSync(marker, 'utf-8') === wanted) {
  console.log(`bundle-node: cached ${NODE_VERSION}`);
  process.exit(0);
}

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });
const tmp = join(runtimeDir, isZip ? 'node.zip' : 'node.tgz');

console.log(`bundle-node: downloading ${archive}`);
execSync(`curl -fsSL ${JSON.stringify(archive)} -o ${JSON.stringify(tmp)}`, { stdio: 'inherit' });
// bsdtar (present on macOS, Linux runners and Windows 10+) extracts both
// formats; pull only the node binary out of the archive, then move it up.
execSync(
  `tar -xf ${JSON.stringify(tmp)} -C ${JSON.stringify(runtimeDir)} ${JSON.stringify(binPath)}`,
  { stdio: 'inherit' },
);
copyFileSync(join(runtimeDir, ...binPath.split('/')), targetBin);
rmSync(join(runtimeDir, binPath.split('/')[0] ?? ''), { recursive: true, force: true });
rmSync(tmp, { force: true });
if (!isZip) chmodSync(targetBin, 0o755);
if (!existsSync(targetBin)) {
  console.error('bundle-node: extraction failed');
  process.exit(1);
}
writeFileSync(marker, wanted);
console.log(`bundle-node: staged ${targetBin}`);
