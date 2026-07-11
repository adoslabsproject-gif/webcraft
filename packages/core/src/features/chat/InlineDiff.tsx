import { FileDiff } from 'lucide-react';

/// Render a fenced ```diff block as a coloured, line-numbered viewer —
/// the same UX VSCode/Cursor shows when the AI proposes a file change.
///
/// Expected fenced content shape (unified diff):
///   --- /old/path
///   +++ /new/path
///   @@ N added, M removed @@
///   +new line
///   -old line
///    context line
///   ...
///
/// Returns null if the body doesn't look like a unified diff, so callers
/// can render the original text untouched.

interface DiffLine {
  kind: 'context' | 'add' | 'remove' | 'header' | 'hunk';
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export function tryParseDiffBlock(body: string): DiffLine[] | null {
  const lines = body.split('\n');
  if (lines.length < 3) return null;
  if (!lines[0]?.startsWith('--- ') || !lines[1]?.startsWith('+++ ')) return null;

  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of lines) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      out.push({ kind: 'header', oldNo: null, newNo: null, text: line });
      continue;
    }
    if (line.startsWith('@@')) {
      out.push({ kind: 'hunk', oldNo: null, newNo: null, text: line });
      continue;
    }
    if (line.startsWith('+')) {
      newNo++;
      out.push({ kind: 'add', oldNo: null, newNo, text: line.slice(1) });
    } else if (line.startsWith('-')) {
      oldNo++;
      out.push({ kind: 'remove', oldNo, newNo: null, text: line.slice(1) });
    } else {
      oldNo++;
      newNo++;
      out.push({ kind: 'context', oldNo, newNo, text: line.startsWith(' ') ? line.slice(1) : line });
    }
  }
  return out;
}

export function InlineDiff({ lines }: { lines: DiffLine[] }) {
  // Pull path + summary out of the header for the chip on top.
  const newHeader = lines.find((l) => l.kind === 'header' && l.text.startsWith('+++ '))?.text;
  const path = newHeader?.slice(4) ?? '';
  const hunk = lines.find((l) => l.kind === 'hunk')?.text ?? '';

  const visible = lines.filter((l) => l.kind !== 'header' && l.kind !== 'hunk');
  const added = visible.filter((l) => l.kind === 'add').length;
  const removed = visible.filter((l) => l.kind === 'remove').length;
  const lineWidth = Math.max(2, String(visible.length).length);

  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)]">
      {/* Header strip */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-1.5 text-[11px]">
        <FileDiff className="h-3 w-3 text-indigo-400" />
        <span className="truncate font-mono text-[var(--color-fg-muted)]" title={path}>
          {path.split('/').slice(-3).join('/')}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[10px]">
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono font-medium text-emerald-300">
            +{added}
          </span>
          <span className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono font-medium text-rose-300">
            −{removed}
          </span>
        </span>
      </div>

      {/* Code with line gutters */}
      <pre className="max-h-[420px] overflow-auto bg-[var(--color-bg)] font-mono text-[11px] leading-[1.45]">
        {visible.map((line, i) => {
          const bg =
            line.kind === 'add'
              ? 'bg-emerald-500/10'
              : line.kind === 'remove'
                ? 'bg-rose-500/10'
                : '';
          const fg =
            line.kind === 'add'
              ? 'text-emerald-200'
              : line.kind === 'remove'
                ? 'text-rose-200'
                : 'text-[var(--color-fg-muted)]';
          const sign = line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ';
          return (
            <div key={i} className={`flex ${bg}`}>
              <span className="shrink-0 select-none border-r border-[var(--color-border-subtle)] px-2 text-right font-mono text-[10px] text-[var(--color-fg-dim)]">
                <span className="inline-block" style={{ width: `${lineWidth}ch` }}>
                  {line.oldNo ?? ''}
                </span>
              </span>
              <span className="shrink-0 select-none border-r border-[var(--color-border-subtle)] px-2 text-right font-mono text-[10px] text-[var(--color-fg-dim)]">
                <span className="inline-block" style={{ width: `${lineWidth}ch` }}>
                  {line.newNo ?? ''}
                </span>
              </span>
              <span className={`shrink-0 select-none px-1.5 font-mono ${fg}`}>{sign}</span>
              <span className={`whitespace-pre-wrap break-words pr-3 ${fg}`}>{line.text}</span>
            </div>
          );
        })}
      </pre>

      {hunk ? (
        <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-1 font-mono text-[10px] text-[var(--color-fg-dim)]">
          {hunk}
        </div>
      ) : null}
    </div>
  );
}
