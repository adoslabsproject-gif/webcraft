import { GitBranch, GitFork, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useAppStore } from '../../store/app-store';
import { alert, confirm, prompt } from '../dialog/dialog-store';
import { useWorktreeStore } from './worktree-store';

/// Worktree panel — listed inside the Git tab below the file status list.
/// Lets the user spawn parallel branch checkouts (background-agent pattern)
/// and delete them when done. Click on a worktree opens its directory as
/// the new projectRoot.

export function WorktreePanel() {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const setProjectRoot = useAppStore((s) => s.setProjectRoot);
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const busy = useWorktreeStore((s) => s.busy);
  const error = useWorktreeStore((s) => s.error);
  const refresh = useWorktreeStore((s) => s.refresh);
  const add = useWorktreeStore((s) => s.add);
  const remove = useWorktreeStore((s) => s.remove);

  useEffect(() => {
    if (projectRoot) void refresh(projectRoot);
  }, [projectRoot, refresh]);

  async function handleAdd() {
    if (!projectRoot) return;
    const name = await prompt('Create worktree', {
      message: 'Branch name for the new worktree (will be created at ../<repo>-<name>)',
      placeholder: 'feature/ai-rewrite',
    });
    if (!name) return;
    await add(projectRoot, name);
    if (useWorktreeStore.getState().error) {
      await alert('Worktree add failed', useWorktreeStore.getState().error ?? '');
    }
  }

  async function handleRemove(path: string, isPrimary: boolean) {
    if (isPrimary) {
      await alert('Cannot remove', 'The primary worktree (repo root) cannot be removed.');
      return;
    }
    const ok = await confirm(`Remove worktree ${path.split('/').pop()}?`, {
      message: `Delete ${path}. Uncommitted changes will be lost.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok || !projectRoot) return;
    await remove(projectRoot, path, true);
    if (useWorktreeStore.getState().error) {
      await alert('Worktree remove failed', useWorktreeStore.getState().error ?? '');
    }
  }

  return (
    <div className="border-t border-neutral-800 bg-[var(--color-bg-subtle)]/40">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
          <GitFork className="h-3 w-3 text-orange-400" />
          Worktrees · {worktrees.length}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => projectRoot && void refresh(projectRoot)}
            title="Refresh"
            className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!projectRoot || busy}
            title="Create new worktree"
            className="flex items-center gap-1 rounded bg-orange-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-orange-500 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>
      </div>
      {error ? (
        <div className="mx-2 mb-1 rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger-muted)] p-1 text-[10px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}
      <ul>
        {worktrees.length === 0 && !busy ? (
          <li className="px-3 py-2 text-[10px] text-[var(--color-fg-dim)]">
            No worktrees found.
          </li>
        ) : (
          worktrees.map((w) => {
            const name = w.path.split('/').pop() ?? w.path;
            const isActive = w.path === projectRoot;
            return (
              <li
                key={w.path}
                className={`group flex items-center gap-1.5 px-3 py-1.5 transition-colors hover:bg-[var(--color-bg-hover)] ${
                  isActive ? 'border-l-2 border-orange-400 bg-orange-500/10' : ''
                }`}
              >
                <GitBranch className="h-3 w-3 shrink-0 text-orange-300" />
                <button
                  type="button"
                  onClick={() => !isActive && setProjectRoot(w.path)}
                  className="min-w-0 flex-1 text-left"
                  title={w.path}
                >
                  <div className="truncate text-[11px] text-[var(--color-fg)]">{name}</div>
                  <div className="truncate font-mono text-[10px] text-[var(--color-fg-subtle)]">
                    {w.branch} · {w.head || '—'}
                    {w.isPrimary ? ' · primary' : ''}
                  </div>
                </button>
                {!w.isPrimary ? (
                  <button
                    type="button"
                    onClick={() => void handleRemove(w.path, w.isPrimary)}
                    title="Remove worktree"
                    aria-label="Remove"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3 text-rose-400 hover:text-rose-300" />
                  </button>
                ) : null}
              </li>
            );
          })
        )}
        {busy && worktrees.length === 0 ? (
          <li className="flex items-center justify-center gap-2 py-3 text-[10px] text-[var(--color-fg-subtle)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading worktrees…
          </li>
        ) : null}
      </ul>
    </div>
  );
}
