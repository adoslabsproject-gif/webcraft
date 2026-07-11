import { AlertCircle, Check, Database, Plus } from 'lucide-react';
import { useDbStore } from '../db-store';

/// Connection list — top of the Db Studio sidebar. EVERY connection is
/// clickable now (active or not); clicking a not-yet-wired engine selects
/// it but query attempts return a clear "sidecar pending" message instead
/// of silently failing. Visual treatment: live = solid icon + accent ring,
/// pending = muted icon + small ⚠ badge.
export function DatabaseList({ onNew }: { onNew: () => void }) {
  const connections = useDbStore((s) => s.connections);
  const activeId = useDbStore((s) => s.activeConnectionId);
  const setActive = useDbStore((s) => s.setActiveConnection);

  return (
    <div className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/60 backdrop-blur-sm">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Connections · {connections.length}
        </span>
        <button
          type="button"
          onClick={onNew}
          aria-label="New database"
          title="Create new database"
          className="rounded p-1 text-emerald-400 hover:bg-emerald-500/15"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="max-h-44 overflow-y-auto px-1.5 pb-2">
        {connections.map((c) => {
          const isActive = c.id === activeId;
          const liveTone = c.available;
          return (
            <li key={c.id} className="mb-0.5">
              <button
                type="button"
                onClick={() => setActive(c.id)}
                className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-emerald-500/20 via-emerald-500/10 to-transparent text-[var(--color-fg)] ring-1 ring-inset ring-emerald-500/40 shadow-sm'
                    : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                    liveTone
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-[var(--color-bg-active)] text-[var(--color-fg-dim)]'
                  }`}
                >
                  <Database className="h-3 w-3" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{c.name}</span>
                  <span
                    className={`text-[9px] uppercase tracking-wider ${
                      liveTone ? 'text-emerald-400/70' : 'text-amber-400/70'
                    }`}
                  >
                    {liveTone ? `${c.kind} · live` : `${c.kind} · sidecar pending`}
                  </span>
                </span>
                {isActive ? (
                  <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                ) : !liveTone ? (
                  <AlertCircle className="h-3 w-3 shrink-0 text-amber-400" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
