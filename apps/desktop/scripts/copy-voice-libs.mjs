/// beforeBundleCommand — stage the sherpa-onnx native libraries where the
/// Tauri bundler expects them, per platform:
///
///   macOS   → src-tauri/frameworks-mac/*.dylib  (bundle.macOS.frameworks
///             copies them into WebCraft.app/Contents/Frameworks and the
///             bundler adds the @executable_path/../Frameworks rpath).
///             Without this the app CRASHES AT LAUNCH on every machine:
///             "Library not loaded: @rpath/libonnxruntime.dylib".
///   Windows → src-tauri/resources-win/*.dll     (bundle.resources places
///             them next to the exe, where the loader finds them).
///   Linux   → no-op for now (AppImage bundling resolves linked .so files
///             through linuxdeploy).
///
/// The libs land in a different target dir depending on how cargo was
/// invoked (`target/release` natively, `target/<triple>/release` with
/// `--target`, plus the sherpa-rs download cache) — so we search all of
/// them and copy the newest copy of each library name.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcTauri = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri');

function findLibs(roots, matcher) {
  /** @type {Map<string, {path: string, mtime: number}>} */
  const byName = new Map();
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip build junk that can never contain the shared libs.
        if (entry.name === 'build' || entry.name === 'deps' || entry.name === '.fingerprint')
          continue;
        walk(full, depth + 1);
      } else if (matcher(entry.name)) {
        const mtime = statSync(full).mtimeMs;
        const prev = byName.get(entry.name);
        if (!prev || mtime > prev.mtime) byName.set(entry.name, { path: full, mtime });
      }
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root, 0);
  return byName;
}

function stage(destDir, libs) {
  mkdirSync(destDir, { recursive: true });
  for (const [name, { path }] of libs) {
    cpSync(path, join(destDir, name));
    console.log(`voice-libs: staged ${name} <- ${path}`);
  }
}

if (process.platform === 'darwin') {
  const libs = findLibs(
    [join(srcTauri, 'target')],
    (n) => n.endsWith('.dylib') && (n.includes('sherpa') || n.includes('onnxruntime')),
  );
  if (libs.size === 0) {
    console.error('voice-libs: NO sherpa/onnxruntime dylibs found under src-tauri/target — the app would crash at launch');
    process.exit(1);
  }
  stage(join(srcTauri, 'frameworks-mac'), libs);
} else if (process.platform === 'win32') {
  const libs = findLibs(
    [join(srcTauri, 'target'), join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'sherpa-rs')],
    (n) => n.endsWith('.dll') && (n.includes('sherpa') || n.includes('onnxruntime')),
  );
  if (libs.size === 0) {
    console.error('voice-libs: NO sherpa/onnxruntime DLLs found — voice would fail at runtime');
    process.exit(1);
  }
  stage(join(srcTauri, 'resources-win'), libs);
} else {
  console.log('voice-libs: linux — nothing to stage');
}
