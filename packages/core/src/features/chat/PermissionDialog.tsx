import { AlertTriangle, Check, ShieldCheck, X } from 'lucide-react';
import { useEffect } from 'react';
import { usePermissionStore, type PermissionCategory } from '../../lib/ai/permissions';

/// Modal shown when the model wants to perform a destructive action. Same
/// UX pattern as Claude Code CLI — three buttons:
///   ▸ Allow once        runs this single call, asks again next time
///   ▸ Allow for session ("don't ask again") — sticky grant per category
///   ▸ Deny              cancels this call only
///
/// Mounted once globally inside AppShell; renders nothing when pending is
/// null so it doesn't steal layout space.

const CATEGORY_LABEL: Record<PermissionCategory, string> = {
  'edit-files': 'Edit files',
  'delete-files': 'Delete files',
  'rename-files': 'Rename files',
  'create-dirs': 'Create directories',
  'run-command': 'Run shell command',
  'git-write': 'Git write operation',
  network: 'Network request',
};

export function PermissionDialog() {
  const pending = usePermissionStore((s) => s.pending);
  const resolve = usePermissionStore((s) => s.resolve);

  // Keyboard shortcuts: Enter = allow once, Cmd+Enter = allow always, Esc = deny.
  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolve('deny');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        resolve(e.metaKey || e.ctrlKey ? 'allow-always' : 'allow-once');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, resolve]);

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-[var(--color-fg)]">{pending.title}</span>
          <span className="ml-auto rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
            {CATEGORY_LABEL[pending.category]}
          </span>
        </div>

        {/* Detail */}
        <div className="space-y-3 px-4 py-3">
          <p className="text-sm text-[var(--color-fg-muted)]">{pending.detail}</p>
          {pending.preview ? (
            <pre className="max-h-48 overflow-auto rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2 font-mono text-[11px] text-[var(--color-fg-muted)]">
              {pending.preview}
            </pre>
          ) : null}
          <p className="text-[11px] text-[var(--color-fg-subtle)]">
            <kbd className="rounded bg-[var(--color-bg)] px-1 font-mono">Enter</kbd> Allow once ·{' '}
            <kbd className="rounded bg-[var(--color-bg)] px-1 font-mono">⌘ Enter</kbd> Allow
            session · <kbd className="rounded bg-[var(--color-bg)] px-1 font-mono">Esc</kbd> Deny
          </p>
        </div>

        {/* Footer buttons */}
        <div className="flex items-center gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2">
          <button
            type="button"
            onClick={() => resolve('deny')}
            className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
          >
            <X className="h-3 w-3" />
            Deny
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => resolve('allow-once')}
            className="flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/15"
          >
            <Check className="h-3 w-3" />
            Allow once
          </button>
          <button
            type="button"
            onClick={() => resolve('allow-always')}
            className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
            title="Skip the prompt for this category for the rest of this session"
          >
            <ShieldCheck className="h-3 w-3" />
            Allow session
          </button>
        </div>
      </div>
    </div>
  );
}
