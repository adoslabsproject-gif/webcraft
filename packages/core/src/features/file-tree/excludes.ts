/// Build-artifact + machine-noise filter for the FileTree.
///
/// Mirrors what VSCode/JetBrains/Visual Studio hide by default: source files
/// stay visible, machine-generated output stays out of the way unless the
/// user explicitly toggles "Show hidden" (eye icon in the Explorer header).
///
/// CRITICAL: this list is the SAME across every ecosystem so users coming
/// from .NET, Rust, Node, Python, Go etc. all get a clean tree out of the box.

/// Folder names always hidden — never useful to browse manually.
const ALWAYS_HIDDEN_DIRS = new Set<string>([
  '.git',
  '.svn',
  '.hg',
  '.DS_Store',
  '__MACOSX',
]);

/// Folder names hidden by default but revealable via the "Show hidden" toggle.
/// These are build outputs, package caches, IDE state, generated docs etc.
const BUILD_ARTIFACT_DIRS = new Set<string>([
  // JS / TS
  'node_modules',
  '.pnpm-store',
  '.turbo',
  '.nx',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  'coverage',
  '.vite',
  'out',
  // .NET
  'bin',
  'obj',
  'TestResults',
  '.vs',
  // Rust
  'target',
  // Python
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.venv',
  'venv',
  'env',
  '.eggs',
  // Go
  'vendor',
  // Java / Kotlin / Android
  '.gradle',
  '.idea',
  // PHP
  'composer.lock',
  // OS / IDE
  '.cache',
  '.parcel-cache',
  '.terraform',
]);

/// File names hidden by default (machine config / OS noise).
const BUILD_ARTIFACT_FILES = new Set<string>([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.tsbuildinfo',
]);

export function isAlwaysHidden(name: string): boolean {
  return ALWAYS_HIDDEN_DIRS.has(name);
}

export function isBuildArtifact(name: string, isDirectory: boolean): boolean {
  if (isDirectory) return BUILD_ARTIFACT_DIRS.has(name);
  return BUILD_ARTIFACT_FILES.has(name) || name.endsWith('.tsbuildinfo');
}

/// Apply the active filter to a flat directory listing. Always-hidden
/// entries disappear unconditionally; build artifacts disappear when
/// `showHidden` is false.
export function filterTreeEntries<T extends { name: string; isDirectory: boolean }>(
  entries: T[],
  showHidden: boolean,
): T[] {
  return entries.filter((e) => {
    if (isAlwaysHidden(e.name)) return false;
    if (!showHidden && isBuildArtifact(e.name, e.isDirectory)) return false;
    return true;
  });
}
