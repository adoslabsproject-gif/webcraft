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

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
        // Regular files only: sherpa's layouts include same-named symlinks
        // pointing at directories, and broken symlinks — both must be
        // skipped or the copy blows up.
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;
        const prev = byName.get(entry.name);
        if (!prev || st.mtimeMs > prev.mtime) byName.set(entry.name, { path: full, mtime: st.mtimeMs });
      }
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root, 0);
  return byName;
}

function stage(destDir, libs) {
  mkdirSync(destDir, { recursive: true });
  for (const [name, { path }] of libs) {
    const dest = join(destDir, name);
    // Idempotent re-runs: the script executes both as a pre-build step and
    // as beforeBundleCommand. Remove any previous copy first and always
    // dereference — some of these libs are symlinks (libonnxruntime.dylib →
    // libonnxruntime.1.17.1.dylib) and re-copying a symlink over its own
    // staged resolution throws "src and dest cannot be the same".
    if (resolve(path) === resolve(dest)) continue;
    rmSync(dest, { force: true });
    cpSync(path, dest, { dereference: true });
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
