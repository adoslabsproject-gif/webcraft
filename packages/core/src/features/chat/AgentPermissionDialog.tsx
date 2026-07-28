import { AlertTriangle, Check, X } from 'lucide-react';
import { useEffect } from 'react';
import { useAgentPermissionStore } from './agent-permission-store';

/// Modal for Claude Code bridge permission asks — same UX as the in-app
/// PermissionDialog (Enter = allow, Esc = deny) but backed by the sidecar's
/// permission broker: the CLI is blocked mid-run until the user decides.
/// Shows the tool's exact input so the choice is informed, never blind.
///
/// Mounted once globally inside AppShell next to PermissionDialog.
export function AgentPermissionDialog() {
  const asks = useAgentPermissionStore((s) => s.asks);
  const answer = useAgentPermissionStore((s) => s.answer);
  const ask = asks[0] ?? null;

  useEffect(() => {
    if (!ask) return;
    function onKey(e: KeyboardEvent) {
      if (!ask) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        void answer(ask.id, 'deny');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void answer(ask.id, 'allow');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask, answer]);

  if (!ask) return null;

  let inputPreview: string;
  try {
    inputPreview = JSON.stringify(ask.input, null, 2) ?? '{}';
  } catch {
    inputPreview = String(ask.input);
  }
  if (inputPreview.length > 1500) inputPreview = `${inputPreview.slice(0, 1500)}\n…`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]">
        <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-[var(--color-fg)]">
            Claude Code asks permission
          </span>
          <span className="ml-auto rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-300">
            {ask.toolName}
          </span>
        </div>

        <div className="space-y-3 px-4 py-3">
          <p className="text-sm text-[var(--color-fg-muted)]">
            The agent wants to run <span className="font-mono">{ask.toolName}</span> with this
            input{asks.length > 1 ? ` (${asks.length - 1} more waiting)` : ''}:
          </p>
          <pre className="max-h-48 select-text overflow-auto rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2 font-mono text-[11px] text-[var(--color-fg-muted)]">
            {inputPreview}
          </pre>
          <p className="text-[11px] text-[var(--color-fg-subtle)]">
            <kbd className="rounded bg-[var(--color-bg)] px-1 font-mono">Enter</kbd> Allow ·{' '}
            <kbd className="rounded bg-[var(--color-bg)] px-1 font-mono">Esc</kbd> Deny
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2">
          <button
            type="button"
            onClick={() => void answer(ask.id, 'deny')}
            className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
          >
            <X className="h-3 w-3" />
            Deny
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => void answer(ask.id, 'allow')}
            className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            <Check className="h-3 w-3" />
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
