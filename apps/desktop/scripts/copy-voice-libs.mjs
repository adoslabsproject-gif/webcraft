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
        if (!prev || st.mtimeMs > prev.mtime)
          byName.set(entry.name, { path: full, mtime: st.mtimeMs });
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
    // as beforeBundleCommand — pre-delete and dereference. Copies are
    // best-effort per file: sherpa's target layouts have produced exotic
    // same-named entries (symlinks to dirs, etc.); a bad candidate must not
    // sink the whole staging when a good copy of the lib exists elsewhere.
    if (resolve(path) === resolve(dest)) continue;
    try {
      rmSync(dest, { force: true });
      cpSync(path, dest, { dereference: true });
      console.log(`voice-libs: staged ${name} <- ${path}`);
    } catch (e) {
      console.warn(`voice-libs: skipped ${path}: ${e.message}`);
    }
  }
}

/// Fail loudly if any required library did not make it into destDir.
function assertStaged(destDir, required) {
  const missing = required.filter((name) => !existsSync(join(destDir, name)));
  if (missing.length > 0) {
    console.error(`voice-libs: REQUIRED libs missing from ${destDir}: ${missing.join(', ')}`);
    process.exit(1);
  }
}

if (process.platform === 'darwin') {
  // Exactly the dylibs the binary links (checked with otool -L): the main
  // executable needs libonnxruntime.1.17.1.dylib + libsherpa-onnx-c-api.
  // dylib, and the c-api's own dependency is the versioned onnxruntime.
  // The unversioned/cxx variants are junk in some layouts (even same-named
  // directories) — never pick them up.
  const REQUIRED = ['libonnxruntime.1.17.1.dylib', 'libsherpa-onnx-c-api.dylib'];
  const libs = findLibs([join(srcTauri, 'target')], (n) => REQUIRED.includes(n));
  const dest = join(srcTauri, 'frameworks-mac');
  stage(dest, libs);
  assertStaged(dest, REQUIRED);
} else if (process.platform === 'win32') {
  const libs = findLibs(
    [
      join(srcTauri, 'target'),
      join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'sherpa-rs'),
    ],
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
