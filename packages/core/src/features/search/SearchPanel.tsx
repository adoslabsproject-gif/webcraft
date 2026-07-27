import { Command } from '@tauri-apps/plugin-shell';
import { Loader2, Replace, Search } from 'lucide-react';
import { useState } from 'react';
import { readFile, writeFile } from '../../lib/ipc/fs';
import { useAppStore } from '../../store/app-store';
import { revealLocation } from '../editor/editor-controller';

interface Hit {
  path: string;
  line: number;
  preview: string;
}

/// Project-wide search & replace — ripgrep when available, grep fallback.
/// Replace applies the regex to every file in the current result set and
/// reports exactly how many occurrences/files changed.
export function SearchPanel() {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const openTab = useAppStore((s) => s.openEditorTab);
  const [pattern, setPattern] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replaceMsg, setReplaceMsg] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function replaceAll() {
    if (!projectRoot || hits.length === 0 || replacing) return;
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'g');
    } catch (e) {
      setError(`Invalid regex: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setReplacing(true);
    setReplaceMsg(null);
    setError(null);
    try {
      const files = [...new Set(hits.map((h) => h.path))];
      let filesChanged = 0;
      let occurrences = 0;
      for (const file of files) {
        const text = await readFile(file);
        const count = (text.match(re) ?? []).length;
        if (count === 0) continue;
        await writeFile(file, text.replace(re, replaceWith));
        filesChanged++;
        occurrences += count;
      }
      useAppStore.getState().notifyFsChange();
      setReplaceMsg(
        `Replaced ${occurrences} occurrence${occurrences === 1 ? '' : 's'} in ${filesChanged} file${filesChanged === 1 ? '' : 's'}.`,
      );
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReplacing(false);
    }
  }

  async function run() {
    if (!pattern.trim() || !projectRoot) return;
    setBusy(true);
    setError(null);
    setHits([]);
    try {
      const raw = await tryRipgrep(pattern, projectRoot).catch(() => tryGrep(pattern, projectRoot));
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
        <div className="mt-1.5 flex gap-1.5">
          <input
            type="text"
            value={replaceWith}
            onChange={(e) => setReplaceWith(e.target.value)}
            disabled={!projectRoot}
            placeholder="Replace with… ($1 groups ok)"
            className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-sky-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void replaceAll()}
            disabled={!projectRoot || hits.length === 0 || replacing}
            title={`Replace in the ${new Set(hits.map((h) => h.path)).size} files of the current results`}
            className="flex shrink-0 items-center gap-1 rounded border border-neutral-800 px-2 py-1.5 text-[10px] text-neutral-300 hover:border-sky-500 hover:text-sky-300 disabled:opacity-40"
          >
            {replacing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Replace className="h-3 w-3" />
            )}
            Replace all
          </button>
        </div>
        {replaceMsg ? <p className="mt-1 text-[10px] text-emerald-400">{replaceMsg}</p> : null}
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
                  onClick={() => {
                    openTab({
                      id: h.path,
                      path: h.path,
                      label: h.path.split('/').pop() ?? h.path,
                      dirty: false,
                    });
                    revealLocation(h.path, h.line, 1);
                  }}
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
  const { execPosix } = await import('../../lib/ipc/shell');
  const out = await execPosix(
    `grep -RInE ${JSON.stringify(pattern)} --exclude-dir=node_modules --exclude-dir=.git --max-count=200 ${JSON.stringify(cwd)} 2>/dev/null | head -500`,
  );
  return out.stdout;
}
