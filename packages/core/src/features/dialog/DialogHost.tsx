import { AlertTriangle, Check, Info, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDialogStore } from './dialog-store';

/// Modal renderer for prompt() / confirm() / alert(). Mounted ONCE in
/// AppShell — renders nothing when no request is pending.
///
/// Behaviour:
///   - Enter  = confirm (use current input for prompt)
///   - Esc    = cancel (returns null/false)
///   - Click outside backdrop = cancel
export function DialogHost() {
  const pending = useDialogStore((s) => s.pending);
  const resolve = useDialogStore((s) => s.resolve);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pending?.kind === 'prompt') {
      setInput(pending.defaultValue ?? '');
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        confirm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, input]);

  if (!pending) return null;

  function cancel() {
    resolve(pending!.kind === 'confirm' ? false : null);
  }
  function confirm() {
    if (pending!.kind === 'prompt') {
      resolve(input);
    } else if (pending!.kind === 'confirm') {
      resolve(true);
    } else {
      resolve(null);
    }
  }

  const Icon = pending.kind === 'alert' ? Info : pending.danger ? AlertTriangle : Check;
  const iconColor =
    pending.kind === 'alert'
      ? 'text-sky-400'
      : pending.danger
        ? 'text-rose-400'
        : 'text-indigo-400';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-3">
          <Icon className={`h-4 w-4 ${iconColor}`} />
          <span className="text-sm font-semibold text-[var(--color-fg)]">{pending.title}</span>
          <button
            type="button"
            onClick={cancel}
            aria-label="Close"
            className="ml-auto rounded p-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          {pending.message ? (
            <p className="text-sm text-[var(--color-fg-muted)]">{pending.message}</p>
          ) : null}
          {pending.kind === 'prompt' ? (
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pending.placeholder}
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm text-[var(--color-fg)] focus:border-indigo-500 focus:outline-none"
            />
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2">
          {pending.kind !== 'alert' ? (
            <button
              type="button"
              onClick={cancel}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
            >
              {pending.cancelLabel ?? 'Cancel'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={confirm}
            className={`rounded-md px-3 py-1.5 text-xs font-medium text-white ${
              pending.danger
                ? 'bg-rose-600 hover:bg-rose-500'
                : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
          >
            {pending.confirmLabel ?? (pending.kind === 'alert' ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
