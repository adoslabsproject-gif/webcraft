import { Command } from '@tauri-apps/plugin-shell';
import { create } from 'zustand';

/// Git store — minimal porcelain wrapper around the system `git` binary,
/// executed via tauri-plugin-shell.

export type FileStatus = 'M' | 'A' | 'D' | 'R' | '?' | 'U';

export interface GitFile {
  status: FileStatus;
  staged: boolean;
  path: string;
}

interface GitState {
  branch: string | null;
  files: GitFile[];
  diff: string;
  selectedPath: string | null;
  message: string;
  busy: boolean;
  error: string | null;
  refresh: (cwd: string) => Promise<void>;
  setSelected: (cwd: string, path: string | null) => Promise<void>;
  stage: (cwd: string, path: string) => Promise<void>;
  unstage: (cwd: string, path: string) => Promise<void>;
  commit: (cwd: string) => Promise<void>;
  setMessage: (m: string) => void;
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const cmd = Command.create('git', args, { cwd });
  const out = await cmd.execute();
  return { stdout: out.stdout, stderr: out.stderr, code: out.code };
}

function parseStatus(porcelain: string): GitFile[] {
  return porcelain
    .split('\n')
    .filter(Boolean)
    .flatMap<GitFile>((line) => {
      const x = line.charAt(0);
      const y = line.charAt(1);
      const path = line.slice(3);
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

export const useGitStore = create<GitState>((set, get) => ({
  branch: null,
  files: [],
  diff: '',
  selectedPath: null,
  message: '',
  busy: false,
  error: null,

  async refresh(cwd) {
    set({ busy: true, error: null });
    try {
      const status = await git(cwd, ['status', '--porcelain']);
      if (status.code !== 0) throw new Error(status.stderr || 'git status failed');
      const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
      set({
        files: parseStatus(status.stdout),
        branch: branch.code === 0 ? branch.stdout.trim() : null,
        busy: false,
      });
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  async setSelected(cwd, path) {
    set({ selectedPath: path, diff: '' });
    if (!path) return;
    const d = await git(cwd, ['diff', '--', path]);
    let body = d.stdout;
    if (!body) {
      const staged = await git(cwd, ['diff', '--cached', '--', path]);
      body = staged.stdout;
    }
    set({ diff: body });
  },

  async stage(cwd, path) {
    await git(cwd, ['add', '--', path]);
    await get().refresh(cwd);
  },

  async unstage(cwd, path) {
    await git(cwd, ['reset', 'HEAD', '--', path]);
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
