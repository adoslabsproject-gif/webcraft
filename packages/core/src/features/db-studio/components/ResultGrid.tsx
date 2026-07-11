import { useDbStore } from '../db-store';

/// Last-query result grid — used in the SQL editor tab.
export function ResultGrid() {
  const result = useDbStore((s) => s.result);

  if (!result) {
    return (
      <div className="flex flex-1 items-center justify-center text-[11px] text-neutral-500">
        Run a query to see results.
      </div>
    );
  }
  if (result.error) {
    return (
      <div className="flex-1 overflow-auto p-2 font-mono text-[11px] text-red-300">
        {result.error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-500">
        {result.rows.length} rows · {result.durationMs}ms · {result.rowsAffected} affected
      </div>
      <div className="flex-1 overflow-auto">
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
      </div>
    </div>
  );
}
