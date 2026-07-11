import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { applyInlineReplacement, runInlineEdit } from './inline-edit';
import { getEditor } from './editor-controller';

/// Floating prompt overlay for ⌘K inline edits. Rendered by EditorArea.
///
/// Lifecycle:
///   open=false               → invisible
///   open=true, busy=false    → text input + Run button (focus textarea)
///   open=true, busy=true     → live streaming preview in editor, Stop button here
///   open=true, done=true     → Accept / Reject buttons; edit applied but
///                              the original range is saved so Reject reverts.

interface InlineEditPromptProps {
  open: boolean;
  onClose: () => void;
}

export function InlineEditPrompt({ open, onClose }: InlineEditPromptProps) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const originalTextRef = useRef<string>('');
  const originalRangeRef = useRef<{ startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null>(null);
  const currentRangeRef = useRef<{ startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null>(null);

  useEffect(() => {
    if (open && !busy && !done) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, busy, done]);

  useEffect(() => {
    if (!open) {
      setInstruction('');
      setBusy(false);
      setDone(false);
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  async function start() {
    const editor = getEditor();
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    let sel = editor.getSelection();
    if (!sel || sel.isEmpty()) sel = model.getFullModelRange();
    originalRangeRef.current = sel.toJSON();
    originalTextRef.current = model.getValueInRange(sel);
    currentRangeRef.current = sel.toJSON();

    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    let lastApplied = originalTextRef.current;

    await runInlineEdit({
      editor,
      instruction,
      signal: abort.signal,
      onProgress: (newCode) => {
        // Replace the current accumulating range with the new draft.
        if (!currentRangeRef.current) return;
        const updatedRange = applyInlineReplacement(editor, currentRangeRef.current, newCode);
        currentRangeRef.current = updatedRange;
        lastApplied = newCode;
      },
      onDone: (newCode) => {
        if (currentRangeRef.current) {
          const updatedRange = applyInlineReplacement(editor, currentRangeRef.current, newCode);
          currentRangeRef.current = updatedRange;
        }
        lastApplied = newCode;
        setBusy(false);
        setDone(true);
      },
      onError: () => {
        setBusy(false);
        // Revert to original
        if (originalRangeRef.current && currentRangeRef.current) {
          applyInlineReplacement(editor, currentRangeRef.current, originalTextRef.current);
        }
        onClose();
      },
    });
    // No-op reference to silence lint about unused-after-write
    void lastApplied;
  }

  function accept() {
    onClose();
  }

  function reject() {
    const editor = getEditor();
    if (editor && currentRangeRef.current) {
      applyInlineReplacement(editor, currentRangeRef.current, originalTextRef.current);
    }
    onClose();
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  if (!open) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-40 flex justify-center">
      <div className="pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-md border border-indigo-500/40 bg-[var(--color-bg-elevated)] px-3 py-2 shadow-[var(--shadow-lg)] backdrop-blur-md">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
        {done ? (
          <>
            <span className="flex-1 text-xs text-[var(--color-fg-muted)]">
              Edit applied. Accept or reject?
            </span>
            <button
              type="button"
              onClick={reject}
              className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] text-[var(--color-fg-muted)] hover:bg-rose-500/10 hover:text-rose-300"
            >
              <X className="h-3 w-3" /> Reject
            </button>
            <button
              type="button"
              onClick={accept}
              className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
            >
              <Check className="h-3 w-3" /> Accept
            </button>
          </>
        ) : busy ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-300" />
            <span className="flex-1 text-xs text-[var(--color-fg-muted)]">Generating edit…</span>
            <button
              type="button"
              onClick={stop}
              className="flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-500"
            >
              Stop
            </button>
          </>
        ) : (
          <>
            <input
              ref={inputRef}
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && instruction.trim()) {
                  e.preventDefault();
                  void start();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onClose();
                }
              }}
              placeholder="Describe the edit — Enter to run, Esc to cancel"
              className="flex-1 bg-transparent text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)]"
            />
            <button
              type="button"
              onClick={() => void start()}
              disabled={!instruction.trim()}
              className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Run
            </button>
          </>
        )}
      </div>
    </div>
  );
}
