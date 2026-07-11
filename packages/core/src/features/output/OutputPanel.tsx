import { Eraser } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cleanOutputChunk } from './ansi-cleanup';

/// Output panel — receives `webcraft:run:output` events emitted by the Run
/// button + Dev Server. Append-only log with auto-scroll + clear.
/// Chunks are sanitised through cleanOutputChunk to handle CR overwrites,
/// ANSI escape sequences, and CRLF normalisation so terminal-targeted
/// progress output renders correctly in a plain <pre>.
export function OutputPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const onOutput = (e: Event) => {
      const raw = (e as CustomEvent<string>).detail;
      const text = cleanOutputChunk(raw);
      setLines((prev) => [...prev, text].slice(-200));
    };
    window.addEventListener('webcraft:run:output', onOutput);
    return () => window.removeEventListener('webcraft:run:output', onOutput);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines.length]);

  if (lines.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-fg-dim)]">
        <p className="text-xs">No output yet.</p>
        <p className="text-[10px] text-[var(--color-fg-subtle)]">
          Click ▶ Run on a file or `package.json` script — output streams here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-2 py-1">
        <button
          type="button"
          onClick={() => setLines([])}
          aria-label="Clear"
          className="flex items-center gap-1 rounded p-0.5 text-[10px] text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
        >
          <Eraser className="h-3 w-3" />
          Clear
        </button>
      </div>
      <pre
        ref={scrollRef}
        className="select-text flex-1 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-[1.5] text-[var(--color-fg)]"
      >
        {lines.join('')}
      </pre>
    </div>
  );
}
