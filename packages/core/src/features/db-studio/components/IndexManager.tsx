import { AlertTriangle, Loader2, Plus, Sparkles, Trash2, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NhaProvider } from '../../../lib/ai/nha-client';
import { AnthropicProvider } from '../../../lib/ai/anthropic-client';
import { useSettingsStore } from '../../../store/settings-store';
import { useDbStore } from '../db-store';

interface IndexRow {
  schema: string;
  name: string;
  table: string;
  definition: string;
}

const LIST_INDEXES_SQL = `
SELECT schemaname AS schema, indexname AS name, tablename AS table, indexdef AS definition
FROM pg_indexes
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY tablename, indexname`;

const AI_SYSTEM = `You are a Postgres performance expert. Given a table name + its columns + the typical query shapes (joins on FK columns, WHERE on date columns, ORDER BY on certain fields), output ONLY a JSON array of recommended indexes in this exact shape, no prose:
[{"name":"idx_orders_customer","sql":"CREATE INDEX idx_orders_customer ON orders(customer_id);","reason":"Speeds up WHERE customer_id = ? lookups (most common access pattern for orders)"}]
Recommend 2-5 indexes. Focus on FK columns, date columns used in WHERE/ORDER BY, and columns with high cardinality used in lookups. Never recommend an index on a primary key (already implicit).`;

interface AiSuggestion {
  name: string;
  sql: string;
  reason: string;
}

/// Indexes panel — list + create + AI suggestions for the active table.
export function IndexManager({ table, onClose }: { table: string; onClose: () => void }) {
  const runArbitrary = useDbStore((s) => s.runArbitrary);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const model = useSettingsStore((s) => s.model);

  const [indexes, setIndexes] = useState<IndexRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSql, setNewSql] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);

  async function load() {
    setLoading(true);
    const r = await runArbitrary(LIST_INDEXES_SQL);
    setIndexes(
      r.rows
        .filter((row) => row[2] === table)
        .map((row) => ({
          schema: String(row[0]),
          name: String(row[1]),
          table: String(row[2]),
          definition: String(row[3]),
        })),
    );
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, [table]);

  async function addIndex(sql: string) {
    const r = await runArbitrary(sql);
    if (r.error) {
      window.alert(`Index creation failed: ${r.error}`);
      return;
    }
    await load();
    setNewSql('');
  }

  async function dropIndex(name: string) {
    if (!window.confirm(`Drop index ${name}?`)) return;
    await runArbitrary(`DROP INDEX IF EXISTS ${name};`);
    await load();
  }

  async function suggestWithAi() {
    setSuggesting(true);
    try {
      const colsResult = await runArbitrary(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`,
      );
      const provider =
        activeProvider === 'nha'
          ? new NhaProvider()
          : apiKeys.anthropic
            ? new AnthropicProvider(apiKeys.anthropic)
            : null;
      if (!provider) {
        window.alert('No AI provider configured.');
        return;
      }
      const tableDescription = `Table: ${table}\nColumns:\n${colsResult.rows
        .map((r) => `- ${r[0]} (${r[1]})`)
        .join('\n')}`;
      let buf = '';
      await provider.stream({
        model,
        system: AI_SYSTEM,
        messages: [
          { id: 'u', role: 'user', content: [{ type: 'text', text: tableDescription }], createdAt: Date.now() },
        ],
        callbacks: {
          onText: (d) => {
            buf += d;
          },
          onToolUse: () => {},
          onStop: () => {},
          onError: () => {},
        },
      });
      const match = /\[[\s\S]*\]/.exec(buf);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]) as AiSuggestion[];
          setSuggestions(parsed);
        } catch {
          window.alert('AI returned malformed JSON');
        }
      }
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-fg)]">
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            Indexes for <code className="font-mono">{table}</code>
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-xs text-[var(--color-fg-subtle)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading indexes…
            </div>
          ) : (
            <>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                Existing indexes ({indexes.length})
              </h3>
              {indexes.length === 0 ? (
                <p className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning-muted)] p-2 text-[11px] text-[var(--color-warning)]">
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  No indexes besides the implicit primary key. Consider AI suggestions below.
                </p>
              ) : (
                <ul className="space-y-1">
                  {indexes.map((i) => (
                    <li
                      key={i.name}
                      className="group flex items-start gap-2 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2 text-[11px]"
                    >
                      <div className="min-w-0 flex-1">
                        <code className="font-mono text-emerald-300">{i.name}</code>
                        <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-[var(--color-fg-muted)]">
                          {i.definition}
                        </pre>
                      </div>
                      <button
                        type="button"
                        onClick={() => void dropIndex(i.name)}
                        aria-label="Drop"
                        className="opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3 text-[var(--color-danger)]" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mt-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                Add manual index
              </h3>
              <input
                type="text"
                value={newSql}
                onChange={(e) => setNewSql(e.target.value)}
                placeholder={`CREATE INDEX idx_${table}_xxx ON ${table}(column);`}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-[11px] text-[var(--color-fg)]"
              />
              <button
                type="button"
                disabled={!newSql.trim()}
                onClick={() => void addIndex(newSql)}
                className="mt-1 flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                <Plus className="h-3 w-3" /> Create
              </button>

              <h3 className="mt-4 mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                <Sparkles className="h-3 w-3 text-indigo-400" />
                AI-suggested indexes
              </h3>
              <button
                type="button"
                disabled={suggesting}
                onClick={() => void suggestWithAi()}
                className="flex items-center gap-1 rounded border border-indigo-500/40 px-2 py-1 text-[11px] text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-40"
              >
                {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Analyze with AI
              </button>

              {suggestions.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {suggestions.map((s, i) => (
                    <li key={i} className="rounded border border-indigo-500/30 bg-indigo-500/5 p-2 text-[11px]">
                      <div className="flex items-center justify-between">
                        <code className="font-mono text-indigo-300">{s.name}</code>
                        <button
                          type="button"
                          onClick={() => void addIndex(s.sql)}
                          className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-500"
                        >
                          + Apply
                        </button>
                      </div>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-emerald-300">
                        {s.sql}
                      </pre>
                      <p className="mt-1 text-[10px] text-[var(--color-fg-muted)]">{s.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
