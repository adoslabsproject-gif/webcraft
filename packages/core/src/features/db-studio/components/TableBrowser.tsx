import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useDbStore, type QueryResult } from '../db-store';

const PAGE_SIZE = 50;

/// Generic row browser with pagination over the active table.
export function TableBrowser() {
  const table = useDbStore((s) => s.activeTable);
  const runArbitrary = useDbStore((s) => s.runArbitrary);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!table) return;
    setLoading(true);
    const r = await runArbitrary(
      `SELECT * FROM ${table} LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE};`,
    );
    setResult(r);
    setLoading(false);
  }, [table, page, runArbitrary]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!table) return <div className="p-3 text-xs text-neutral-500">Pick a table to browse rows.</div>;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs">
        <span className="text-neutral-400">
          {table} · page {page + 1}
          {result?.rows.length === PAGE_SIZE ? '+' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded p-0.5 text-neutral-500 hover:text-neutral-200 disabled:opacity-30"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={result ? result.rows.length < PAGE_SIZE : true}
            onClick={() => setPage((p) => p + 1)}
            className="rounded p-0.5 text-neutral-500 hover:text-neutral-200 disabled:opacity-30"
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded p-0.5 text-neutral-500 hover:text-neutral-200"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center p-6 text-neutral-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            <span className="text-xs">Loading rows…</span>
          </div>
        ) : result?.error ? (
          <div className="p-3 font-mono text-[11px] text-red-300">{result.error}</div>
        ) : !result || result.rows.length === 0 ? (
          <div className="p-3 text-xs text-neutral-500">Empty table.</div>
        ) : (
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th
                    key={c}
                    className="sticky top-0 border-b border-neutral-800 bg-neutral-950 px-2 py-1 text-left text-neutral-400"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="border-b border-neutral-900 hover:bg-neutral-900/50">
                  {row.map((cell, j) => (
                    <td key={j} className="px-2 py-1 text-neutral-300">
                      {cell === null || cell === undefined
                        ? '∅'
                        : typeof cell === 'object'
                          ? JSON.stringify(cell)
                          : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
