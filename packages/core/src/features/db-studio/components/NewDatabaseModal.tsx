import { X } from 'lucide-react';
import { useState } from 'react';
import { type DbKind, useDbStore } from '../db-store';

const KINDS: { id: DbKind; label: string; available: boolean }[] = [
  { id: 'pglite', label: 'PostgreSQL (PGLite, in-process)', available: true },
  { id: 'sqlite', label: 'SQLite (better-sqlite3)', available: false },
  { id: 'duckdb', label: 'DuckDB (analytics)', available: false },
  { id: 'mongo', label: 'MongoDB (memory)', available: false },
  { id: 'mysql', label: 'MySQL (portable)', available: false },
  { id: 'mariadb', label: 'MariaDB (portable)', available: false },
  { id: 'redis', label: 'Redis (portable)', available: false },
  { id: 'surrealdb', label: 'SurrealDB (multi-model)', available: false },
  { id: 'libsql', label: 'LibSQL (Turso fork)', available: false },
];

/// Modal — pick engine + name, creates a new in-process PGLite database
/// when available.
export function NewDatabaseModal({ onClose }: { onClose: () => void }) {
  const addConnection = useDbStore((s) => s.addConnection);
  const setActive = useDbStore((s) => s.setActiveConnection);
  const [name, setName] = useState('My database');
  const [kind, setKind] = useState<DbKind>('pglite');

  function create() {
    const id = addConnection({ name: name.trim() || 'Untitled', kind, available: kind === 'pglite' });
    setActive(id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md overflow-hidden rounded border border-neutral-800 bg-neutral-925 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-200">
            New database
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-3 p-3">
          <label className="block text-xs">
            <span className="mb-1 block text-neutral-400">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-neutral-400">Engine</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as DbKind)}
              className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 focus:border-indigo-500 focus:outline-none"
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id} disabled={!k.available}>
                  {k.label} {k.available ? '' : '(sidecar pending)'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-800 bg-neutral-950 p-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-xs text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={create}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
