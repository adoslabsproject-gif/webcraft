import { Clock, Play, X } from 'lucide-react';
import { useDbStore } from '../db-store';

/// Last 100 queries with re-run button.
export function QueryHistory() {
  const history = useDbStore((s) => s.history);
  const setQuery = useDbStore((s) => s.setQuery);
  const runQuery = useDbStore((s) => s.runQuery);

  if (history.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-600">
        <Clock className="h-8 w-8" />
        <p className="text-xs">No queries run yet.</p>
      </div>
    );
  }

  return (
    <ul className="h-full overflow-auto divide-y divide-neutral-900">
      {history.map((q) => (
        <li key={q.id} className="flex items-start gap-2 px-3 py-2 text-[11px] hover:bg-neutral-900/60">
          <button
            type="button"
            onClick={() => {
              setQuery(q.sql);
              void runQuery();
            }}
            aria-label="Re-run"
            className="mt-0.5 rounded p-0.5 text-emerald-400 hover:bg-emerald-500/10"
          >
            <Play className="h-3 w-3" />
          </button>
          <div className="min-w-0 flex-1">
            <pre className="truncate font-mono text-neutral-300">{q.sql}</pre>
            <div className="mt-0.5 text-[10px] text-neutral-500">
              {new Date(q.ts).toLocaleTimeString()} · {q.rowCount} rows · {q.durationMs}ms
              {q.error ? <span className="ml-1 text-red-400"> · error</span> : null}
            </div>
          </div>
          {q.error ? <X className="h-3 w-3 shrink-0 text-red-400" /> : null}
        </li>
      ))}
    </ul>
  );
}
