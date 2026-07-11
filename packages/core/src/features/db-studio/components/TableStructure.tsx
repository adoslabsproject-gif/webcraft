import { Key } from 'lucide-react';
import { useDbStore } from '../db-store';

/// Columns + foreign-key list for the active table.
export function TableStructure() {
  const columns = useDbStore((s) => s.activeTableColumns);
  const fks = useDbStore((s) => s.activeTableForeignKeys);
  const table = useDbStore((s) => s.activeTable);

  if (!table) {
    return <div className="p-3 text-xs text-neutral-500">Select a table to inspect its structure.</div>;
  }
  if (columns.length === 0) {
    return <div className="p-3 text-xs text-neutral-500">Loading columns…</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Columns
      </h3>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-neutral-500">
            <th className="py-1.5 pr-3">Name</th>
            <th className="py-1.5 pr-3">Type</th>
            <th className="py-1.5 pr-3">Null</th>
            <th className="py-1.5 pr-3">Default</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.name} className="border-b border-neutral-900">
              <td className="py-1 pr-3 font-mono text-neutral-200">
                <span className="flex items-center gap-1">
                  {c.isPrimaryKey ? <Key className="h-3 w-3 text-amber-400" /> : null}
                  {c.name}
                </span>
              </td>
              <td className="py-1 pr-3 text-neutral-400">{c.dataType}</td>
              <td className="py-1 pr-3 text-neutral-500">{c.isNullable ? 'yes' : 'no'}</td>
              <td className="py-1 pr-3 text-neutral-500">
                {c.defaultValue ?? <span className="text-neutral-700">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {fks.length > 0 ? (
        <>
          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Foreign keys
          </h3>
          <ul className="space-y-1 text-[11px] text-neutral-300">
            {fks.map((fk, i) => (
              <li key={i}>
                <span className="font-mono">{fk.column}</span>
                <span className="text-neutral-600"> → </span>
                <span className="font-mono">
                  {fk.refTable}.{fk.refColumn}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
