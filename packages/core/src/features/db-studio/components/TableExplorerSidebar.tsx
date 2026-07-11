import { RefreshCw, Table2 } from 'lucide-react';
import { useEffect } from 'react';
import { useDbStore } from '../db-store';

/// Table list — refreshable, click a table to inspect it in the main area.
export function TableExplorerSidebar() {
  const tables = useDbStore((s) => s.tables);
  const activeTable = useDbStore((s) => s.activeTable);
  const setActiveTable = useDbStore((s) => s.setActiveTable);
  const refreshSchema = useDbStore((s) => s.refreshSchema);
  const activeConnectionId = useDbStore((s) => s.activeConnectionId);

  useEffect(() => {
    void refreshSchema();
  }, [activeConnectionId, refreshSchema]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Tables · {tables.length}
        </span>
        <button
          type="button"
          onClick={() => void refreshSchema()}
          aria-label="Refresh"
          className="rounded p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {tables.length === 0 ? (
          <li className="px-3 py-2 text-[11px] text-neutral-600">
            No tables yet. Use the SQL editor to create one.
          </li>
        ) : (
          tables.map((t) => {
            const full = t.schema === 'public' ? t.name : `${t.schema}.${t.name}`;
            return (
              <li key={full}>
                <button
                  type="button"
                  onClick={() => void setActiveTable(full)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-xs transition-colors ${
                    activeTable === full
                      ? 'bg-emerald-500/10 text-neutral-100'
                      : 'text-neutral-300 hover:bg-neutral-800/60'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Table2 className="h-3 w-3 text-sky-400" />
                    <span className="truncate">{full}</span>
                  </span>
                  {t.rowCount !== null ? (
                    <span className="text-[10px] text-neutral-600">{t.rowCount}</span>
                  ) : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
