import { Command } from '@tauri-apps/plugin-shell';
import { Loader2, Search } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../../store/app-store';

interface Hit {
  path: string;
  line: number;
  preview: string;
}

/// Project-wide search — uses ripgrep when available, falls back to grep.
export function SearchPanel() {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const openTab = useAppStore((s) => s.openEditorTab);
  const [pattern, setPattern] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!pattern.trim() || !projectRoot) return;
    setBusy(true);
    setError(null);
    setHits([]);
    try {
      const raw = await tryRipgrep(pattern, projectRoot).catch(() =>
        tryGrep(pattern, projectRoot),
      );
      const parsed: Hit[] = raw
        .split('\n')
        .filter(Boolean)
        .slice(0, 500)
        .flatMap<Hit>((line) => {
          const m = /^(.+?):(\d+):(.*)$/.exec(line);
          if (!m || !m[1] || !m[2] || m[3] === undefined) return [];
          return [{ path: m[1], line: Number(m[2]), preview: m[3].slice(0, 200) }];
        });
      setHits(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-neutral-800 bg-neutral-950 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          <Search className="h-3 w-3 text-sky-400" />
          Search
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            disabled={!projectRoot}
            placeholder="Regex pattern…"
            className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-sky-500 focus:outline-none disabled:opacity-50"
          />
        </form>
        {!projectRoot ? (
          <p className="mt-1 text-[10px] text-neutral-600">Open a folder to search.</p>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        {busy ? (
          <div className="flex items-center gap-2 p-3 text-xs text-neutral-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Searching…
          </div>
        ) : error ? (
          <div className="p-3 text-xs text-red-400">{error}</div>
        ) : hits.length === 0 ? (
          <div className="p-3 text-[11px] text-neutral-500">
            {pattern ? 'No matches.' : 'Type a pattern and press Enter.'}
          </div>
        ) : (
          <ul className="divide-y divide-neutral-900">
            {hits.map((h, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() =>
                    openTab({ id: h.path, path: h.path, label: h.path.split('/').pop() ?? h.path, dirty: false })
                  }
                  className="block w-full px-3 py-1 text-left text-[11px] hover:bg-neutral-800/40"
                >
                  <div className="truncate font-mono text-sky-300">
                    {h.path.replace(projectRoot ?? '', '') || h.path}:{h.line}
                  </div>
                  <div className="truncate font-mono text-neutral-400">{h.preview}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

async function tryRipgrep(pattern: string, cwd: string): Promise<string> {
  const cmd = Command.create('rg', [
    '--line-number',
    '--no-heading',
    '--color=never',
    '--max-count=200',
    pattern,
    cwd,
  ]);
  const out = await cmd.execute();
  if (out.code !== 0 && !out.stdout) throw new Error(out.stderr || 'ripgrep failed');
  return out.stdout;
}

async function tryGrep(pattern: string, cwd: string): Promise<string> {
  const cmd = Command.create('sh', [
    '-c',
    `grep -RInE ${JSON.stringify(pattern)} --exclude-dir=node_modules --exclude-dir=.git --max-count=200 ${JSON.stringify(cwd)} 2>/dev/null | head -500`,
  ]);
  const out = await cmd.execute();
  return out.stdout;
}
