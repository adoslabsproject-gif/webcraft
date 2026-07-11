import Editor from '@monaco-editor/react';
import { Loader2, Play } from 'lucide-react';
import { useDbStore } from '../db-store';

/// Standalone SQL editor — Monaco SQL syntax, Cmd+Enter to run.
export function SqlEditor() {
  const query = useDbStore((s) => s.query);
  const setQuery = useDbStore((s) => s.setQuery);
  const runQuery = useDbStore((s) => s.runQuery);
  const running = useDbStore((s) => s.running);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          SQL · ⌘/Ctrl+Enter to run
        </span>
        <button
          type="button"
          disabled={running}
          onClick={() => void runQuery()}
          className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run
        </button>
      </div>
      <div className="flex-1">
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={query}
          onChange={(v) => setQuery(v ?? '')}
          onMount={(editor, monaco) => {
            editor.addCommand(
              // eslint-disable-next-line no-bitwise
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
              () => void runQuery(),
            );
          }}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  );
}
