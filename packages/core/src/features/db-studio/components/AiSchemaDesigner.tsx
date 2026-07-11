import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AnthropicProvider } from '../../../lib/ai/anthropic-client';
import { useSettingsStore } from '../../../store/settings-store';
import { useDbStore } from '../db-store';

const SYSTEM = `You are a database schema designer. Given a natural-language description
of a domain, output ONLY a single SQL DDL block (CREATE TABLE statements,
indexes, foreign keys) for PostgreSQL. No prose, no markdown, no comments
outside the SQL — just raw SQL ready to execute.`;

/// AI Schema Designer — describe a domain in natural language, the model
/// generates the DDL, the user reviews then runs it against the active DB.
export function AiSchemaDesigner({ onClose }: { onClose: () => void }) {
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const model = useSettingsStore((s) => s.model);
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const runArbitrary = useDbStore((s) => s.runArbitrary);
  const refreshSchema = useDbStore((s) => s.refreshSchema);

  const [prompt, setPrompt] = useState(
    'A blog: users with email/password, posts (title/body/published_at), comments threaded by parent_id.',
  );
  const [ddl, setDdl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

  async function generate() {
    const key = apiKeys[activeProvider];
    if (!key || activeProvider !== 'anthropic') {
      setError(`Active provider must be Anthropic (with API key). Got: ${activeProvider}.`);
      return;
    }
    setBusy(true);
    setError(null);
    setRunResult(null);
    try {
      const provider = new AnthropicProvider(key);
      let buf = '';
      await provider.stream({
        model,
        system: SYSTEM,
        messages: [
          { id: 'u', role: 'user', content: [{ type: 'text', text: prompt }], createdAt: Date.now() },
        ],
        callbacks: {
          onText: (d) => {
            buf += d;
            setDdl(buf);
          },
          onToolUse: () => {},
          onStop: () => {},
          onError: () => {},
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!ddl.trim()) return;
    const cleaned = ddl.replace(/^```sql\n?/i, '').replace(/```\s*$/i, '');
    setBusy(true);
    const r = await runArbitrary(cleaned);
    setBusy(false);
    if (r.error) {
      setRunResult(`Error: ${r.error}`);
    } else {
      setRunResult('Schema applied successfully.');
      await refreshSchema();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded border border-neutral-800 bg-neutral-925">
        <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 py-2">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-200">
            <Sparkles className="h-3 w-3 text-indigo-400" />
            AI Schema Designer
          </span>
          <button type="button" onClick={onClose} className="text-xs text-neutral-500 hover:text-neutral-200">
            Close
          </button>
        </div>
        <div className="grid flex-1 grid-cols-2 overflow-hidden">
          <div className="flex flex-col border-r border-neutral-800">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
              Describe your domain
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="flex-1 resize-none bg-neutral-950 p-3 text-xs text-neutral-200 focus:outline-none"
            />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">Generated DDL</span>
            </div>
            <textarea
              value={ddl}
              onChange={(e) => setDdl(e.target.value)}
              spellCheck={false}
              className="flex-1 resize-none bg-neutral-950 p-3 font-mono text-[11px] text-emerald-300 focus:outline-none"
              placeholder="-- Generated SQL will stream here"
            />
          </div>
        </div>
        {error ? <div className="border-t border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-300">{error}</div> : null}
        {runResult ? (
          <div className="border-t border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px] text-emerald-300">{runResult}</div>
        ) : null}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-800 bg-neutral-950 p-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="flex items-center gap-1 rounded border border-indigo-500/40 px-3 py-1 text-xs text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Generate
          </button>
          <button
            type="button"
            disabled={busy || !ddl.trim()}
            onClick={() => void execute()}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Apply to DB
          </button>
        </div>
      </div>
    </div>
  );
}
