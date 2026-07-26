import { homeDir } from '@tauri-apps/api/path';
import { Check, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { readFile, writeFile } from '../../lib/ipc/fs';
import { useAppStore } from '../../store/app-store';

/// AI Memory — editable CLAUDE.md files, the same standing instructions the
/// Claude Code CLI reads natively:
///   - Global:  ~/.claude/CLAUDE.md   (applies to every project)
///   - Project: <projectRoot>/CLAUDE.md
///
/// One source of truth for BOTH engines: the Claude Code provider picks the
/// files up by itself; API providers get them injected into the system
/// prompt by use-chat.

export function MemorySettings() {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const [globalPath, setGlobalPath] = useState<string | null>(null);

  useEffect(() => {
    void homeDir().then((home) => setGlobalPath(`${home.replace(/\/$/, '')}/.claude/CLAUDE.md`));
  }, []);

  return (
    <div className="space-y-3">
      {globalPath ? (
        <MemoryFileEditor
          label="Global memory"
          detail="~/.claude/CLAUDE.md — applies to every project (shared with the Claude Code CLI)"
          path={globalPath}
        />
      ) : null}
      {projectRoot ? (
        <MemoryFileEditor
          label="Project memory"
          detail={`${projectRoot}/CLAUDE.md — instructions for this project only`}
          path={`${projectRoot}/CLAUDE.md`}
        />
      ) : (
        <p className="text-[10px] text-neutral-500">
          Open a project folder to edit its project memory (CLAUDE.md).
        </p>
      )}
    </div>
  );
}

function MemoryFileEditor({
  label,
  detail,
  path,
}: {
  label: string;
  detail: string;
  path: string;
}) {
  const [text, setText] = useState('');
  const [original, setOriginal] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = text !== original;

  useEffect(() => {
    let cancelled = false;
    readFile(path)
      .then((content) => {
        if (cancelled) return;
        setText(content);
        setOriginal(content);
      })
      .catch(() => {
        // File does not exist yet — start empty, first save creates it.
        if (cancelled) return;
        setText('');
        setOriginal('');
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  async function save() {
    await writeFile(path, text);
    setOriginal(text);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div>
          <div className="text-xs text-neutral-300">{label}</div>
          <div className="text-[10px] text-neutral-600">{detail}</div>
        </div>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => void save()}
          aria-label={`Save ${label}`}
          className="flex h-6 items-center gap-1 rounded bg-indigo-600 px-2 text-[10px] text-white disabled:opacity-30"
        >
          {saved ? <Check className="h-3 w-3" /> : <Save className="h-3 w-3" />}
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder={
          '# Standing instructions for the AI\n- Always answer in Italian\n- Never use tabs, 2-space indent\n…'
        }
        className="w-full resize-y rounded border border-neutral-800 bg-neutral-900 p-2 font-mono text-[11px] leading-relaxed text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none"
      />
    </div>
  );
}
