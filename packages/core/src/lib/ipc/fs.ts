import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

/// Filesystem IPC wrapper.
///
/// Uses our own Rust commands (`webcraft_*`) instead of `tauri-plugin-fs`,
/// because plugin-fs's ACL is a bad fit for a desktop IDE where the user
/// has explicitly picked a folder and expects access to *every* file in it
/// (including dot-files like `.gitignore`, files without extensions, etc.).
/// Our commands run native Rust tokio::fs with no scope filtering — exactly
/// what an IDE needs.

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export async function pickFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title: 'Open Folder' });
  return typeof result === 'string' ? result : null;
}

export async function pickFile(
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  const result = await open({
    directory: false,
    multiple: false,
    title: 'Open File',
    ...(filters ? { filters } : {}),
  });
  return typeof result === 'string' ? result : null;
}

/// Native "Save As" dialog — returns the chosen absolute path or null if
/// the user cancelled. Used by untitled buffers on first save.
export async function pickSaveFile(opts?: {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  const result = await save({
    title: 'Save File',
    ...(opts?.defaultPath ? { defaultPath: opts.defaultPath } : {}),
    ...(opts?.filters ? { filters: opts.filters } : {}),
  });
  return typeof result === 'string' ? result : null;
}

export async function listDir(path: string): Promise<FsEntry[]> {
  const entries = await invoke<Array<{ name: string; path: string; is_directory: boolean }>>(
    'webcraft_read_dir',
    { path },
  );
  return entries
    .map((e) => ({ name: e.name, path: e.path, isDirectory: e.is_directory }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>('webcraft_read_file', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  await invoke<void>('webcraft_write_file', { path, content });
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>('webcraft_exists', { path });
}

export async function createDir(path: string): Promise<void> {
  await invoke<void>('webcraft_mkdir', { path });
}

export async function removePath(path: string): Promise<void> {
  await invoke<void>('webcraft_remove', { path });
}

export async function renamePath(from: string, to: string): Promise<void> {
  await invoke<void>('webcraft_rename', { from, to });
}

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  sql: 'sql',
  graphql: 'graphql',
  vue: 'html',
  svelte: 'html',
};

const NAME_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'shell',
  '.gitignore': 'ignore',
  '.dockerignore': 'ignore',
  '.npmrc': 'ini',
};

export function languageForPath(path: string): string {
  const filename = path.split('/').pop()?.toLowerCase() ?? '';
  if (NAME_LANG[filename]) return NAME_LANG[filename];
  const ext = filename.split('.').pop() ?? '';
  return LANG_BY_EXT[ext] ?? 'plaintext';
}
