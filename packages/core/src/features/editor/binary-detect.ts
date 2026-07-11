/// Binary-file detection — extension-based fallback before we attempt to
/// read a file as UTF-8 text. For files without extension or with ambiguous
/// extensions we rely on the Rust read_to_string failing with a clear
/// "stream did not contain valid UTF-8" message which the editor maps to
/// a friendly "Binary file" placeholder.

const BINARY_EXTENSIONS = new Set<string>([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'tif', 'heic', 'avif', 'svgz', 'psd', 'ai',
  // video / audio
  'mp4', 'mov', 'webm', 'mkv', 'avi', 'flv', 'wmv', 'm4v', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'aiff',
  // docs (treated as binary — no text editor preview)
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf',
  // archives
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'dmg', 'iso', 'tgz', 'tbz2', 'lz', 'zst', 'cab',
  // native executables / libs / object files
  'exe', 'msi', 'app', 'apk', 'ipa', 'deb', 'rpm', 'pkg',
  'dll', 'so', 'dylib', 'a', 'lib', 'o', 'obj',
  // .NET — assemblies + debug symbols + nuget
  'pdb', 'mdb', 'nupkg', 'snupkg', 'resources', 'resx-bin', 'snk', 'pfx',
  // JVM
  'class', 'jar', 'war', 'ear', 'dex',
  // WebAssembly + interpreted bytecode
  'wasm', 'pyc', 'pyo', 'rbc',
  // fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'ttc',
  // DB
  'db', 'sqlite', 'sqlite3', 'realm', 'duckdb', 'parquet',
  // ML model weights (huge, never text)
  'pt', 'pth', 'ckpt', 'safetensors', 'onnx', 'pkl', 'h5', 'gguf', 'ggml', 'bin',
  // misc
  'dat', 'pak', 'tsbuildinfo', 'idx', 'lock-pack',
]);

const BINARY_NAME_HINTS = [
  // Common no-extension binaries
  /^mongod/i,
  /^node$/i,
  /^bun$/i,
  /^deno$/i,
  /^python\d*$/i,
  /^php(-cgi)?$/i,
  /^ruby$/i,
  /^git$/i,
];

export function isLikelyBinary(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (BINARY_EXTENSIONS.has(ext)) return true;
  for (const re of BINARY_NAME_HINTS) {
    if (re.test(filename)) return true;
  }
  return false;
}

export function isUtf8Error(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /stream did not contain valid UTF-?8/i.test(msg);
}
