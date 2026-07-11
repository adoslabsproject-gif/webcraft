import { Key, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useDbStore } from '../db-store';

interface Column {
  name: string;
  type: string;
  pk: boolean;
  nullable: boolean;
  unique: boolean;
  default: string;
}

const TYPES = [
  'SERIAL', 'INT', 'BIGINT', 'TEXT', 'VARCHAR(255)', 'BOOLEAN',
  'TIMESTAMPTZ', 'DATE', 'JSONB', 'UUID', 'DECIMAL(10,2)', 'BYTEA',
];

const newCol = (): Column => ({
  name: '',
  type: 'TEXT',
  pk: false,
  nullable: true,
  unique: false,
  default: '',
});

/// Step-by-step Create Table wizard — name + columns (add/remove/edit) +
/// PK / index / FK flags. Generates and runs the DDL.
export function CreateTableWizard({ onClose }: { onClose: () => void }) {
  const runArbitrary = useDbStore((s) => s.runArbitrary);
  const refreshSchema = useDbStore((s) => s.refreshSchema);
  const [tableName, setTableName] = useState('my_table');
  const [columns, setColumns] = useState<Column[]>([
    { name: 'id', type: 'SERIAL', pk: true, nullable: false, unique: false, default: '' },
    { name: 'created_at', type: 'TIMESTAMPTZ', pk: false, nullable: false, unique: false, default: 'now()' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateCol(idx: number, patch: Partial<Column>) {
    setColumns((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function buildDdl(): string {
    const colSql = columns
      .filter((c) => c.name.trim())
      .map((c) => {
        const parts = [`  ${c.name} ${c.type}`];
        if (c.pk) parts.push('PRIMARY KEY');
        if (!c.nullable && !c.pk) parts.push('NOT NULL');
        if (c.unique && !c.pk) parts.push('UNIQUE');
        if (c.default) parts.push(`DEFAULT ${c.default}`);
        return parts.join(' ');
      })
      .join(',\n');
    return `CREATE TABLE ${tableName} (\n${colSql}\n);`;
  }

  async function create() {
    setBusy(true);
    setError(null);
    const ddl = buildDdl();
    const r = await runArbitrary(ddl);
    if (r.error) {
      setError(r.error);
      setBusy(false);
      return;
    }
    await refreshSchema();
    setBusy(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-fg)]">
            Create table
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <label className="block text-xs">
            <span className="text-[var(--color-fg-muted)]">Table name</span>
            <input
              type="text"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)] focus:border-emerald-500 focus:outline-none"
            />
          </label>

          <div className="mt-4 mb-2 flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
              Columns
            </h3>
            <button
              type="button"
              onClick={() => setColumns([...columns, newCol()])}
              className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500"
            >
              <Plus className="h-3 w-3" /> Add column
            </button>
          </div>

          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)] text-left text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Type</th>
                <th className="py-1 pr-2 text-center">PK</th>
                <th className="py-1 pr-2 text-center">Null</th>
                <th className="py-1 pr-2 text-center">Unique</th>
                <th className="py-1 pr-2">Default</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {columns.map((c, i) => (
                <tr key={i} className="border-b border-[var(--color-border-subtle)]">
                  <td className="py-1 pr-2">
                    <input
                      type="text"
                      value={c.name}
                      onChange={(e) => updateCol(i, { name: e.target.value })}
                      placeholder="column_name"
                      className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-fg)]"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      value={c.type}
                      onChange={(e) => updateCol(i, { type: e.target.value })}
                      className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[11px] text-[var(--color-fg)]"
                    >
                      {TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2 text-center">
                    <input type="checkbox" checked={c.pk} onChange={(e) => updateCol(i, { pk: e.target.checked })} />
                    {c.pk ? <Key className="ml-1 inline h-3 w-3 text-amber-400" /> : null}
                  </td>
                  <td className="py-1 pr-2 text-center">
                    <input
                      type="checkbox"
                      checked={c.nullable}
                      onChange={(e) => updateCol(i, { nullable: e.target.checked })}
                    />
                  </td>
                  <td className="py-1 pr-2 text-center">
                    <input
                      type="checkbox"
                      checked={c.unique}
                      onChange={(e) => updateCol(i, { unique: e.target.checked })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="text"
                      value={c.default}
                      onChange={(e) => updateCol(i, { default: e.target.value })}
                      placeholder="(none)"
                      className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-muted)]"
                    />
                  </td>
                  <td className="py-1">
                    <button
                      type="button"
                      onClick={() => setColumns(columns.filter((_, j) => j !== i))}
                      aria-label="Remove"
                      className="rounded p-0.5 text-[var(--color-danger)] hover:bg-[var(--color-danger-muted)]"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="mt-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Generated DDL
          </h3>
          <pre className="overflow-x-auto rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2 font-mono text-[10px] text-emerald-300">
            {buildDdl()}
          </pre>

          {error ? (
            <div className="mt-2 rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger-muted)] p-2 text-[11px] text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-1 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || columns.length === 0 || !tableName.trim()}
            onClick={() => void create()}
            className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            <Sparkles className="h-3 w-3" />
            {busy ? 'Creating…' : 'Create table'}
          </button>
        </div>
      </div>
    </div>
  );
}
