import { ChevronDown, Loader2, Play } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { type RunChoice, planRun } from './runner';

/// Run button in the editor toolbar. Auto-detects the right runner for the
/// active file; if multiple options (e.g. package.json with N scripts),
/// opens a dropdown.
export function RunButton() {
  const active = useAppStore((s) => s.editorTabs.find((t) => t.id === s.activeEditorTabId));
  const projectRoot = useAppStore((s) => s.projectRoot);
  const setBottomTab = useAppStore((s) => s.setBottomTab);
  const setBottomPanelOpen = useAppStore((s) => s.setBottomPanelOpen);
  const [choices, setChoices] = useState<RunChoice[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) {
      setChoices([]);
      return;
    }
    void planRun(active.path, projectRoot).then(setChoices);
  }, [active, projectRoot]);

  const runChoice = useCallback(
    async (c: RunChoice) => {
      setBusy(true);
      setOpen(false);
      setBottomTab('output');
      setBottomPanelOpen(true);
      try {
        await c.runFn();
      } catch (e) {
        window.dispatchEvent(
          new CustomEvent('webcraft:run:output', {
            detail: `\nRun failed: ${e instanceof Error ? e.message : String(e)}\n`,
          }),
        );
      } finally {
        setBusy(false);
      }
    },
    [setBottomTab, setBottomPanelOpen],
  );

  if (!active || choices.length === 0) return null;

  if (choices.length === 1) {
    const c = choices[0];
    if (!c) return null;
    return (
      <button
        type="button"
        onClick={() => void runChoice(c)}
        disabled={busy}
        title={c.kind === 'script' ? `${c.name}: ${c.cmd}` : c.label}
        className="flex items-center gap-1 rounded bg-[var(--color-success)] px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-90 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        {c.kind === 'script' ? c.name : 'Run'}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="flex items-center gap-1 rounded bg-[var(--color-success)] px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-90 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        Run
        <ChevronDown className="h-2.5 w-2.5" />
      </button>
      {open ? (
        <div
          className="absolute right-0 z-40 mt-1 min-w-[220px] overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]"
          onMouseLeave={() => setOpen(false)}
        >
          {choices.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => void runChoice(c)}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-[var(--color-bg-hover)]"
            >
              <Play className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-success)]" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[var(--color-fg)]">
                  {c.kind === 'script' ? c.name : c.label}
                </div>
                {c.kind === 'script' ? (
                  <div className="truncate font-mono text-[10px] text-[var(--color-fg-subtle)]">
                    {c.cmd}
                  </div>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
