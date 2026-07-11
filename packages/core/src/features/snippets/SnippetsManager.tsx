import { Copy, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useSnippetsStore } from './snippets-store';

/// Snippets manager modal — list builtin + user snippets, add new, delete user ones.
export function SnippetsManager({ onClose }: { onClose: () => void }) {
  const snippets = useSnippetsStore((s) => s.snippets);
  const add = useSnippetsStore((s) => s.add);
  const remove = useSnippetsStore((s) => s.remove);
  const [editing, setEditing] = useState<{
    language: string;
    prefix: string;
    body: string[];
    description: string;
  }>({ language: 'typescript', prefix: '', body: [''], description: '' });

  function handleAdd() {
    if (!editing.prefix || editing.body.length === 0) return;
    add({
      language: editing.language,
      prefix: editing.prefix,
      body: editing.body,
      description: editing.description,
    });
    setEditing({ language: editing.language, prefix: '', body: [''], description: '' });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-fg)]">
            Snippets
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid flex-1 grid-cols-2 overflow-hidden">
          <ul className="overflow-y-auto border-r border-[var(--color-border-subtle)]">
            {snippets.map((s) => (
              <li key={s.id} className="group flex items-start gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-[11px] hover:bg-[var(--color-bg-hover)]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <code className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-accent)]">
                      {s.prefix}
                    </code>
                    <span className="text-[var(--color-fg-subtle)]">·</span>
                    <span className="text-[var(--color-fg-muted)]">{s.language}</span>
                    {s.builtin ? (
                      <span className="rounded bg-[var(--color-bg-hover)] px-1 py-0.5 text-[9px] uppercase tracking-wider text-[var(--color-fg-dim)]">
                        built-in
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[var(--color-fg)]">{s.description || '—'}</div>
                  <pre className="mt-1 max-h-20 overflow-hidden whitespace-pre-wrap text-[10px] text-[var(--color-fg-subtle)]">
                    {s.body.slice(0, 4).join('\n')}
                    {s.body.length > 4 ? '\n…' : ''}
                  </pre>
                </div>
                <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button type="button" onClick={() => void navigator.clipboard.writeText(s.body.join('\n'))} title="Copy body" className="rounded p-0.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]">
                    <Copy className="h-3 w-3" />
                  </button>
                  {!s.builtin ? (
                    <button type="button" onClick={() => remove(s.id)} title="Delete" className="rounded p-0.5 text-[var(--color-danger)] hover:text-[var(--color-danger)]">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-col overflow-y-auto p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
              New snippet
            </div>
            <div className="mt-2 space-y-2">
              <label className="block text-xs">
                <span className="text-[var(--color-fg-muted)]">Language</span>
                <select
                  value={editing.language}
                  onChange={(e) => setEditing((s) => ({ ...s, language: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-fg)]"
                >
                  {['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'python', 'sql', 'html', 'css', 'go', 'rust'].map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="text-[var(--color-fg-muted)]">Prefix (trigger)</span>
                <input
                  value={editing.prefix ?? ''}
                  onChange={(e) => setEditing((s) => ({ ...s, prefix: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-fg)]"
                />
              </label>
              <label className="block text-xs">
                <span className="text-[var(--color-fg-muted)]">Description</span>
                <input
                  value={editing.description ?? ''}
                  onChange={(e) => setEditing((s) => ({ ...s, description: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-fg)]"
                />
              </label>
              <label className="block text-xs">
                <span className="text-[var(--color-fg-muted)]">Body (use $0, $1 for cursors)</span>
                <textarea
                  rows={8}
                  value={(editing.body ?? []).join('\n')}
                  onChange={(e) => setEditing((s) => ({ ...s, body: e.target.value.split('\n') }))}
                  className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-fg)]"
                />
              </label>
              <button
                type="button"
                onClick={handleAdd}
                className="flex items-center gap-1 rounded bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)]"
              >
                <Plus className="h-3 w-3" />
                Add snippet
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
