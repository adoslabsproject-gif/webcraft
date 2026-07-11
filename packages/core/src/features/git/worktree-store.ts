import { Command } from '@tauri-apps/plugin-shell';
import { create } from 'zustand';

/// Git worktree manager — list, create, remove, and switch worktrees.
///
/// Worktrees let you check out multiple branches into separate directories
/// from the same repo, so you can refactor in parallel without `git stash`.
/// Claude Code "background agents" pattern relies on worktrees too:
/// spawn N AI agents, each in its own branch dir, no conflicts.

export interface Worktree {
  /// Absolute path of the worktree checkout.
  path: string;
  /// SHA of the worktree HEAD.
  head: string;
  /// Branch name or 'detached' / 'bare'.
  branch: string;
  /// True for the primary/main worktree (the repo root).
  isPrimary: boolean;
}

interface WorktreeState {
  worktrees: Worktree[];
  busy: boolean;
  error: string | null;
  refresh: (repoRoot: string) => Promise<void>;
  add: (
    repoRoot: string,
    branchName: string,
    opts?: { fromBranch?: string; checkoutPath?: string },
  ) => Promise<void>;
  remove: (repoRoot: string, path: string, force?: boolean) => Promise<void>;
}

async function gitOutput(
  repoRoot: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const r = await Command.create('git', ['-C', repoRoot, ...args], { cwd: repoRoot }).execute();
  return { stdout: r.stdout, stderr: r.stderr, code: r.code ?? 0 };
}

function parseWorktrees(porcelain: string): Worktree[] {
  // `git worktree list --porcelain` outputs blocks separated by blank lines:
  //   worktree /path
  //   HEAD <sha>
  //   branch refs/heads/<name>   (or 'detached' / 'bare')
  const blocks = porcelain.split('\n\n').filter((b) => b.trim());
  const out: Worktree[] = [];
  let isPrimaryAssigned = false;
  for (const block of blocks) {
    const lines = block.split('\n');
    let path = '';
    let head = '';
    let branch = 'detached';
    let isBare = false;
    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice(9).trim();
      else if (line.startsWith('HEAD ')) head = line.slice(5).trim();
      else if (line.startsWith('branch ')) {
        branch = line.slice(7).replace('refs/heads/', '').trim();
      } else if (line === 'bare') {
        isBare = true;
      }
    }
    if (!path) continue;
    out.push({
      path,
      head: head.slice(0, 8),
      branch: isBare ? 'bare' : branch,
      isPrimary: !isPrimaryAssigned,
    });
    isPrimaryAssigned = true;
  }
  return out;
}

export const useWorktreeStore = create<WorktreeState>((set, get) => ({
  worktrees: [],
  busy: false,
  error: null,

  async refresh(repoRoot) {
    set({ busy: true, error: null });
    try {
      const r = await gitOutput(repoRoot, ['worktree', 'list', '--porcelain']);
      if (r.code !== 0) {
        set({ error: r.stderr.trim() || 'git worktree list failed', worktrees: [] });
        return;
      }
      set({ worktrees: parseWorktrees(r.stdout) });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: false });
    }
  },

  async add(repoRoot, branchName, opts) {
    set({ busy: true, error: null });
    try {
      const baseDir = opts?.checkoutPath ?? `${repoRoot}/../${repoRoot.split('/').pop()}-${branchName}`;
      const args = ['worktree', 'add'];
      if (opts?.fromBranch) {
        args.push(baseDir, '-b', branchName, opts.fromBranch);
      } else {
        args.push('-b', branchName, baseDir);
      }
      const r = await gitOutput(repoRoot, args);
      if (r.code !== 0) {
        set({ error: r.stderr.trim() || 'git worktree add failed' });
        return;
      }
      await get().refresh(repoRoot);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: false });
    }
  },

  async remove(repoRoot, path, force) {
    set({ busy: true, error: null });
    try {
      const args = ['worktree', 'remove', path];
      if (force) args.push('--force');
      const r = await gitOutput(repoRoot, args);
      if (r.code !== 0) {
        set({ error: r.stderr.trim() || 'git worktree remove failed' });
        return;
      }
      await get().refresh(repoRoot);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: false });
    }
  },
}));
