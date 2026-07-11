import {
  Coffee,
  Database,
  FileCode,
  FileImage,
  FileJson,
  FileLock,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Globe,
  Hash,
  Package as PackageIcon,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import { File } from 'lucide-react';

/// File-type icon mapping — matched against extension first, then exact
/// filename (Dockerfile/Makefile etc.) for VS Code parity.

interface IconSpec {
  icon: LucideIcon;
  color: string;
}

const EXT_ICONS: Record<string, IconSpec> = {
  // Code
  ts: { icon: FileCode, color: 'text-sky-400' },
  tsx: { icon: FileCode, color: 'text-sky-400' },
  js: { icon: FileCode, color: 'text-yellow-400' },
  jsx: { icon: FileCode, color: 'text-yellow-400' },
  mjs: { icon: FileCode, color: 'text-yellow-400' },
  cjs: { icon: FileCode, color: 'text-yellow-400' },
  py: { icon: FileCode, color: 'text-emerald-400' },
  rb: { icon: FileCode, color: 'text-red-400' },
  go: { icon: FileCode, color: 'text-cyan-400' },
  rs: { icon: FileCode, color: 'text-orange-300' },
  java: { icon: Coffee, color: 'text-orange-500' },
  kt: { icon: FileCode, color: 'text-violet-400' },
  swift: { icon: FileCode, color: 'text-orange-400' },
  c: { icon: FileCode, color: 'text-blue-400' },
  h: { icon: FileCode, color: 'text-blue-400' },
  cpp: { icon: FileCode, color: 'text-blue-400' },
  hpp: { icon: FileCode, color: 'text-blue-400' },
  cs: { icon: FileCode, color: 'text-violet-400' },
  php: { icon: FileCode, color: 'text-violet-400' },
  sh: { icon: FileCode, color: 'text-emerald-300' },
  bash: { icon: FileCode, color: 'text-emerald-300' },
  zsh: { icon: FileCode, color: 'text-emerald-300' },

  // Markup
  html: { icon: Globe, color: 'text-orange-400' },
  htm: { icon: Globe, color: 'text-orange-400' },
  xml: { icon: FileCode, color: 'text-orange-300' },
  svg: { icon: FileImage, color: 'text-orange-300' },
  vue: { icon: FileCode, color: 'text-emerald-400' },
  svelte: { icon: FileCode, color: 'text-orange-500' },
  astro: { icon: FileCode, color: 'text-orange-400' },

  // Style
  css: { icon: FileCode, color: 'text-pink-400' },
  scss: { icon: FileCode, color: 'text-pink-400' },
  less: { icon: FileCode, color: 'text-pink-400' },
  styl: { icon: FileCode, color: 'text-pink-400' },

  // Data
  json: { icon: FileJson, color: 'text-amber-400' },
  jsonc: { icon: FileJson, color: 'text-amber-400' },
  json5: { icon: FileJson, color: 'text-amber-400' },
  yaml: { icon: SettingsIcon, color: 'text-rose-400' },
  yml: { icon: SettingsIcon, color: 'text-rose-400' },
  toml: { icon: SettingsIcon, color: 'text-rose-400' },
  ini: { icon: SettingsIcon, color: 'text-rose-400' },
  env: { icon: FileLock, color: 'text-emerald-400' },

  // SQL & DB
  sql: { icon: Database, color: 'text-emerald-400' },
  db: { icon: Database, color: 'text-emerald-400' },
  sqlite: { icon: Database, color: 'text-emerald-400' },
  sqlite3: { icon: Database, color: 'text-emerald-400' },

  // Docs & text
  md: { icon: FileText, color: 'text-blue-300' },
  mdx: { icon: FileText, color: 'text-blue-300' },
  txt: { icon: FileText, color: 'text-neutral-300' },
  log: { icon: FileText, color: 'text-neutral-500' },
  pdf: { icon: FileText, color: 'text-red-400' },

  // Image
  png: { icon: FileImage, color: 'text-violet-400' },
  jpg: { icon: FileImage, color: 'text-violet-400' },
  jpeg: { icon: FileImage, color: 'text-violet-400' },
  gif: { icon: FileImage, color: 'text-violet-400' },
  webp: { icon: FileImage, color: 'text-violet-400' },
  ico: { icon: FileImage, color: 'text-violet-400' },

  // Video / audio
  mp4: { icon: FileVideo, color: 'text-pink-300' },
  mov: { icon: FileVideo, color: 'text-pink-300' },
  webm: { icon: FileVideo, color: 'text-pink-300' },

  // Spreadsheet
  csv: { icon: FileSpreadsheet, color: 'text-emerald-400' },
  xlsx: { icon: FileSpreadsheet, color: 'text-emerald-400' },
  xls: { icon: FileSpreadsheet, color: 'text-emerald-400' },

  // Misc
  lock: { icon: FileLock, color: 'text-neutral-500' },
  pem: { icon: FileLock, color: 'text-amber-400' },
  key: { icon: FileLock, color: 'text-amber-400' },
  graphql: { icon: Hash, color: 'text-pink-400' },
  gql: { icon: Hash, color: 'text-pink-400' },
  proto: { icon: FileCode, color: 'text-neutral-300' },
  rs2: { icon: FileType, color: 'text-orange-300' },

  // .NET — project files + build artifacts (the artifacts are hidden by
  // default but if user toggles "Show hidden" they get a sensible icon)
  csproj: { icon: SettingsIcon, color: 'text-violet-400' },
  fsproj: { icon: SettingsIcon, color: 'text-violet-400' },
  vbproj: { icon: SettingsIcon, color: 'text-violet-400' },
  sln: { icon: PackageIcon, color: 'text-violet-400' },
  slnx: { icon: PackageIcon, color: 'text-violet-400' },
  dll: { icon: PackageIcon, color: 'text-neutral-500' },
  pdb: { icon: FileLock, color: 'text-neutral-500' },
  fs: { icon: FileCode, color: 'text-cyan-300' },
  vb: { icon: FileCode, color: 'text-violet-300' },
  razor: { icon: FileCode, color: 'text-violet-400' },
  cshtml: { icon: FileCode, color: 'text-violet-400' },
  xaml: { icon: FileCode, color: 'text-violet-400' },
  axaml: { icon: FileCode, color: 'text-violet-400' },
  nupkg: { icon: PackageIcon, color: 'text-blue-400' },

  // Container & infra
  containerfile: { icon: FileCode, color: 'text-blue-400' },

  // ML / data weights
  onnx: { icon: PackageIcon, color: 'text-purple-400' },
  safetensors: { icon: PackageIcon, color: 'text-purple-400' },
  gguf: { icon: PackageIcon, color: 'text-purple-400' },
  parquet: { icon: Database, color: 'text-emerald-400' },
};

const NAME_ICONS: Record<string, IconSpec> = {
  'package.json': { icon: PackageIcon, color: 'text-emerald-500' },
  'package-lock.json': { icon: FileLock, color: 'text-neutral-500' },
  'pnpm-lock.yaml': { icon: FileLock, color: 'text-neutral-500' },
  'yarn.lock': { icon: FileLock, color: 'text-neutral-500' },
  'bun.lock': { icon: FileLock, color: 'text-neutral-500' },
  'Cargo.toml': { icon: PackageIcon, color: 'text-orange-400' },
  'Cargo.lock': { icon: FileLock, color: 'text-orange-300' },
  'Dockerfile': { icon: FileCode, color: 'text-blue-400' },
  '.dockerignore': { icon: SettingsIcon, color: 'text-neutral-500' },
  '.gitignore': { icon: SettingsIcon, color: 'text-neutral-500' },
  '.gitattributes': { icon: SettingsIcon, color: 'text-neutral-500' },
  '.env': { icon: FileLock, color: 'text-emerald-400' },
  '.env.local': { icon: FileLock, color: 'text-emerald-400' },
  '.env.example': { icon: FileLock, color: 'text-emerald-300' },
  '.npmrc': { icon: SettingsIcon, color: 'text-rose-400' },
  '.nvmrc': { icon: SettingsIcon, color: 'text-emerald-400' },
  Makefile: { icon: FileCode, color: 'text-amber-400' },
  README: { icon: FileText, color: 'text-blue-300' },
  'README.md': { icon: FileText, color: 'text-blue-300' },
  LICENSE: { icon: FileText, color: 'text-neutral-400' },
  'tsconfig.json': { icon: SettingsIcon, color: 'text-sky-400' },
  'tsconfig.base.json': { icon: SettingsIcon, color: 'text-sky-400' },
  'vite.config.ts': { icon: SettingsIcon, color: 'text-violet-400' },
  'tailwind.config.ts': { icon: SettingsIcon, color: 'text-cyan-400' },
  'biome.json': { icon: SettingsIcon, color: 'text-emerald-400' },
  'nx.json': { icon: SettingsIcon, color: 'text-violet-400' },
};

export function fileIconFor(name: string): IconSpec {
  if (NAME_ICONS[name]) return NAME_ICONS[name];
  const lower = name.toLowerCase();
  if (NAME_ICONS[lower]) return NAME_ICONS[lower];
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (EXT_ICONS[ext]) return EXT_ICONS[ext];
  return { icon: File, color: 'text-[var(--color-fg-subtle)]' };
}
