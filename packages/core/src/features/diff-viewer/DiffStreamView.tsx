import { Check, CheckCheck, FileDiff, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { writeFile } from '../../lib/ipc/fs';
import { useAppStore } from '../../store/app-store';
import { type DiffHunk, useDiffStore } from './diff-store';
import { diffLines } from './diff-utils';

/// Live diff stream — chronological list of every file change made by the
/// model (write_file / edit_file tool calls). Each hunk has Accept / Reject
/// buttons; Reject restores the previous file content.
export function DiffStreamView() {
  const hunks = useDiffStore((s) => s.hunks);
  const clear = useDiffStore((s) => s.clear);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [hunks.length]);

  if (hunks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-600">
        <FileDiff className="h-8 w-8" />
        <p className="text-xs">Model edits will appear here in real time.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs">
        <span className="font-semibold uppercase tracking-wider text-neutral-400">
          Diff stream · {hunks.length} ·{' '}
          <span className="text-amber-400">{hunks.filter((h) => h.status === 'pending').length}</span> pending
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={async () => {
              for (const h of hunks) {
                if (h.status === 'pending') useDiffStore.getState().setStatus(h.id, 'accepted');
              }
            }}
            disabled={hunks.every((h) => h.status !== 'pending')}
            className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-500 disabled:opacity-30"
          >
            <CheckCheck className="h-3 w-3" /> Keep all
          </button>
          <button
            type="button"
            onClick={async () => {
              for (const h of hunks) {
                if (h.status === 'pending') {
                  try {
                    await writeFile(h.path, h.oldContent);
                    useDiffStore.getState().setStatus(h.id, 'rejected');
                  } catch {
                    /* skip */
                  }
                }
              }
              useAppStore.getState().notifyFsChange();
            }}
            disabled={hunks.every((h) => h.status !== 'pending')}
            className="flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-[10px] text-white hover:bg-red-500 disabled:opacity-30"
          >
            <X className="h-3 w-3" /> Revert all
          </button>
          <button
            type="button"
            onClick={clear}
            className="flex items-center gap-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-500 hover:text-neutral-200"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-neutral-950 p-2">
        {hunks.map((hunk) => (
          <HunkBlock key={hunk.id} hunk={hunk} />
        ))}
      </div>
    </div>
  );
}

function HunkBlock({ hunk }: { hunk: DiffHunk }) {
  const setStatus = useDiffStore((s) => s.setStatus);
  const ops = diffLines(hunk.oldContent, hunk.newContent);
  const adds = ops.filter((o) => o.kind === 'add').length;
  const dels = ops.filter((o) => o.kind === 'del').length;

  async function accept() {
    setStatus(hunk.id, 'accepted');
  }

  async function reject() {
    try {
      await writeFile(hunk.path, hunk.oldContent);
      setStatus(hunk.id, 'rejected');
      useAppStore.getState().notifyFsChange();
    } catch (e) {
      console.error('Failed to revert', hunk.path, e);
    }
  }

  return (
    <div
      className={`mb-2 overflow-hidden rounded border ${
        hunk.status === 'accepted'
          ? 'border-emerald-500/30'
          : hunk.status === 'rejected'
            ? 'border-red-500/30 opacity-60'
            : 'border-neutral-800'
      } bg-neutral-950/60`}
    >
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-2 py-1 text-xs">
        <div className="flex items-center gap-2 truncate">
          <span className="text-neutral-400">{hunk.kind === 'write' ? 'WRITE' : 'EDIT'}</span>
          <span className="truncate font-mono text-neutral-200">{hunk.path}</span>
          <span className="text-emerald-400">+{adds}</span>
          <span className="text-red-400">-{dels}</span>
        </div>
        {hunk.status === 'pending' ? (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={accept}
              className="flex h-5 items-center gap-1 rounded bg-emerald-600 px-1.5 text-[10px] text-white hover:bg-emerald-500"
            >
              <Check className="h-2.5 w-2.5" /> Keep
            </button>
            <button
              type="button"
              onClick={reject}
              className="flex h-5 items-center gap-1 rounded bg-red-600 px-1.5 text-[10px] text-white hover:bg-red-500"
            >
              <X className="h-2.5 w-2.5" /> Revert
            </button>
          </div>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
            {hunk.status}
          </span>
        )}
      </div>
      <pre className="overflow-x-auto p-2 font-mono text-[11px] leading-relaxed">
        {ops.slice(0, 200).map((op, i) => (
          <div
            key={i}
            className={
              op.kind === 'add'
                ? 'bg-emerald-500/10 text-emerald-300'
                : op.kind === 'del'
                  ? 'bg-red-500/10 text-red-300'
                  : 'text-neutral-500'
            }
          >
            <span className="select-none pr-2 text-neutral-700">
              {op.kind === 'add' ? '+' : op.kind === 'del' ? '-' : ' '}
            </span>
            {op.text || ' '}
          </div>
        ))}
        {ops.length > 200 ? (
          <div className="mt-1 text-neutral-600">… {ops.length - 200} more lines</div>
        ) : null}
      </pre>
    </div>
  );
}
