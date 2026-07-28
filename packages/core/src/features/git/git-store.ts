import { Command } from '@tauri-apps/plugin-shell';
import { create } from 'zustand';
import { removePath, writeFile } from '../../lib/ipc/fs';
import { type FileDiff, parseUnifiedDiff } from './diff-hunks';

/// Git store — porcelain wrapper around the system `git` binary, executed
/// via tauri-plugin-shell. Covers the full daily loop: status, per-file AND
/// per-hunk staging, commit, push/pull/fetch with ahead/behind tracking,
/// and merge-conflict resolution (ours/theirs + abort).

export type FileStatus = 'M' | 'A' | 'D' | 'R' | '?' | 'U';

export interface GitFile {
  status: FileStatus;
  staged: boolean;
  path: string;
  /// True for merge-conflicted paths (UU/AA/DD/AU/UA/UD/DU) — rendered in
  /// their own "Conflicts" group with ours/theirs actions.
  conflicted?: boolean;
}

interface GitState {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  mergeInProgress: boolean;
  files: GitFile[];
  diff: string;
  /// Parsed hunks of the current diff (per-hunk staging UI).
  diffFiles: FileDiff[];
  selectedPath: string | null;
  /// Whether the selected diff shows the STAGED side (--cached).
  selectedStaged: boolean;
  message: string;
  busy: boolean;
  /// True while a network operation (push/pull/fetch) runs.
  syncing: boolean;
  error: string | null;
  refresh: (cwd: string) => Promise<void>;
  setSelected: (cwd: string, path: string | null, staged?: boolean) => Promise<void>;
  stage: (cwd: string, path: string) => Promise<void>;
  unstage: (cwd: string, path: string) => Promise<void>;
  stageHunk: (cwd: string, patch: string) => Promise<void>;
  unstageHunk: (cwd: string, patch: string) => Promise<void>;
  resolveConflict: (cwd: string, path: string, side: 'ours' | 'theirs') => Promise<void>;
  mergeAbort: (cwd: string) => Promise<void>;
  push: (cwd: string) => Promise<void>;
  pull: (cwd: string) => Promise<void>;
  fetch: (cwd: string) => Promise<void>;
  commit: (cwd: string) => Promise<void>;
  setMessage: (m: string) => void;
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const cmd = Command.create('git', args, { cwd });
  const out = await cmd.execute();
  return { stdout: out.stdout, stderr: out.stderr, code: out.code };
}

const CONFLICT_XY = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function parseStatus(porcelain: string): GitFile[] {
  return porcelain
    .split('\n')
    .filter(Boolean)
    .flatMap<GitFile>((line) => {
      const x = line.charAt(0);
      const y = line.charAt(1);
      const path = line.slice(3);
      if (CONFLICT_XY.has(x + y)) {
        return [{ status: 'U', staged: false, path, conflicted: true }];
      }
      const entries: GitFile[] = [];
      if (x !== ' ' && x !== '?') {
        entries.push({ status: toStatus(x), staged: true, path });
      }
      if (y !== ' ' && y !== '?') {
        entries.push({ status: toStatus(y), staged: false, path });
      }
      if (x === '?' && y === '?') {
        entries.push({ status: '?', staged: false, path });
      }
      return entries;
    });
}

function toStatus(c: string): FileStatus {
  if (c === 'M' || c === 'A' || c === 'D' || c === 'R' || c === '?' || c === 'U') return c;
  return 'M';
}

/// Per-hunk apply: the patch goes through a scratch file inside .git/ (never
/// tracked, invisible to status) because tauri-plugin-shell has no stdin
/// piping for one-shot exec.
async function applyPatch(cwd: string, patch: string, reverse: boolean): Promise<string | null> {
  const scratch = `${cwd}/.git/webcraft-hunk.patch`;
  await writeFile(scratch, patch);
  try {
    const args = ['apply', '--cached'];
    if (reverse) args.push('--reverse');
    args.push('.git/webcraft-hunk.patch');
    const r = await git(cwd, args);
    return r.code === 0 ? null : r.stderr.trim() || 'git apply failed';
  } finally {
    await removePath(scratch).catch(() => {});
  }
}

export const useGitStore = create<GitState>((set, get) => ({
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  mergeInProgress: false,
  files: [],
  diff: '',
  diffFiles: [],
  selectedPath: null,
  selectedStaged: false,
  message: '',
  busy: false,
  syncing: false,
  error: null,

  async refresh(cwd) {
    set({ busy: true, error: null });
    try {
      const status = await git(cwd, ['status', '--porcelain']);
      if (status.code !== 0) throw new Error(status.stderr || 'git status failed');
      const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
      const upstream = await git(cwd, [
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        '@{u}',
      ]);
      let ahead = 0;
      let behind = 0;
      if (upstream.code === 0) {
        const counts = await git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
        if (counts.code === 0) {
          const [b, a] = counts.stdout.trim().split(/\s+/);
          behind = Number(b ?? 0);
          ahead = Number(a ?? 0);
        }
      }
      const merge = await git(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
      set({
        files: parseStatus(status.stdout),
        branch: branch.code === 0 ? branch.stdout.trim() : null,
        upstream: upstream.code === 0 ? upstream.stdout.trim() : null,
        ahead,
        behind,
        mergeInProgress: merge.code === 0,
        busy: false,
      });
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  async setSelected(cwd, path, staged) {
    set({ selectedPath: path, diff: '', diffFiles: [], selectedStaged: staged ?? false });
    if (!path) return;
    // Explicit side when given; otherwise unstaged first, staged fallback.
    let body = '';
    let showingStaged = staged ?? false;
    if (staged === true) {
      body = (await git(cwd, ['diff', '--cached', '--', path])).stdout;
    } else {
      body = (await git(cwd, ['diff', '--', path])).stdout;
      if (!body && staged === undefined) {
        body = (await git(cwd, ['diff', '--cached', '--', path])).stdout;
        showingStaged = body.length > 0;
      }
    }
    set({ diff: body, diffFiles: parseUnifiedDiff(body), selectedStaged: showingStaged });
  },

  async stage(cwd, path) {
    await git(cwd, ['add', '--', path]);
    await get().refresh(cwd);
  },

  async unstage(cwd, path) {
    await git(cwd, ['reset', 'HEAD', '--', path]);
    await get().refresh(cwd);
  },

  async stageHunk(cwd, patch) {
    const err = await applyPatch(cwd, patch, false);
    if (err) {
      set({ error: `stage hunk: ${err}` });
      return;
    }
    const { selectedPath, selectedStaged } = get();
    await get().refresh(cwd);
    if (selectedPath) await get().setSelected(cwd, selectedPath, selectedStaged);
  },

  async unstageHunk(cwd, patch) {
    const err = await applyPatch(cwd, patch, true);
    if (err) {
      set({ error: `unstage hunk: ${err}` });
      return;
    }
    const { selectedPath, selectedStaged } = get();
    await get().refresh(cwd);
    if (selectedPath) await get().setSelected(cwd, selectedPath, selectedStaged);
  },

  async resolveConflict(cwd, path, side) {
    set({ error: null });
    const co = await git(cwd, ['checkout', side === 'ours' ? '--ours' : '--theirs', '--', path]);
    if (co.code !== 0) {
      set({ error: co.stderr.trim() || `git checkout --${side} failed` });
      return;
    }
    await git(cwd, ['add', '--', path]);
    await get().refresh(cwd);
  },

  async mergeAbort(cwd) {
    set({ error: null });
    const r = await git(cwd, ['merge', '--abort']);
    if (r.code !== 0) set({ error: r.stderr.trim() || 'git merge --abort failed' });
    await get().refresh(cwd);
  },

  async push(cwd) {
    const { branch, upstream } = get();
    set({ syncing: true, error: null });
    // First push of a new branch sets the upstream explicitly.
    const args = upstream ? ['push'] : ['push', '-u', 'origin', branch ?? 'HEAD'];
    const r = await git(cwd, args);
    set({ syncing: false });
    if (r.code !== 0) {
      set({ error: r.stderr.trim() || 'git push failed' });
      return;
    }
    await get().refresh(cwd);
  },

  async pull(cwd) {
    set({ syncing: true, error: null });
    const r = await git(cwd, ['pull']);
    set({ syncing: false });
    if (r.code !== 0) {
      set({ error: r.stderr.trim() || 'git pull failed' });
    }
    // Refresh even on failure — a conflicted pull leaves merge state to show.
    await get().refresh(cwd);
  },

  async fetch(cwd) {
    set({ syncing: true, error: null });
    const r = await git(cwd, ['fetch', '--prune']);
    set({ syncing: false });
    if (r.code !== 0) {
      set({ error: r.stderr.trim() || 'git fetch failed' });
      return;
    }
    await get().refresh(cwd);
  },

  async commit(cwd) {
    const { message } = get();
    if (!message.trim()) return;
    set({ busy: true });
    const r = await git(cwd, ['commit', '-m', message]);
    set({ busy: false });
    if (r.code !== 0) {
      set({ error: r.stderr || 'git commit failed' });
      return;
    }
    set({ message: '' });
    await get().refresh(cwd);
  },

  setMessage(m) {
    set({ message: m });
  },
}));
