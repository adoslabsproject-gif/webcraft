import { create } from 'zustand';

/// Replacement for `window.prompt` / `window.confirm` / `window.alert` —
/// those are SILENTLY DISABLED in Tauri 2's WKWebView (they return null
/// immediately without showing UI). Any action that relied on them
/// (rename, new file, delete confirm) was a silent no-op for the user.
///
/// This module exposes promise-based prompt() / confirm() / alert() that
/// render via `DialogHost` mounted in AppShell.

export type DialogKind = 'prompt' | 'confirm' | 'alert';

export interface DialogRequest {
  id: string;
  kind: DialogKind;
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface DialogState {
  pending: DialogRequest | null;
  open: (req: DialogRequest) => Promise<string | boolean | null>;
  resolve: (value: string | boolean | null) => void;
}

let inflight: ((v: string | boolean | null) => void) | null = null;

export const useDialogStore = create<DialogState>((set, get) => ({
  pending: null,
  async open(req) {
    set({ pending: req });
    return new Promise((resolve) => {
      inflight = resolve;
    });
  },
  resolve(value) {
    const cur = get().pending;
    if (!cur) return;
    set({ pending: null });
    inflight?.(value);
    inflight = null;
  },
}));

let counter = 0;

/// Prompt for a string. Returns the entered value or null if cancelled.
export async function prompt(
  title: string,
  opts?: { message?: string; defaultValue?: string; placeholder?: string },
): Promise<string | null> {
  const v = await useDialogStore.getState().open({
    id: `prompt_${++counter}`,
    kind: 'prompt',
    title,
    ...(opts?.message !== undefined ? { message: opts.message } : {}),
    ...(opts?.defaultValue !== undefined ? { defaultValue: opts.defaultValue } : {}),
    ...(opts?.placeholder !== undefined ? { placeholder: opts.placeholder } : {}),
  });
  return typeof v === 'string' ? v : null;
}

/// Yes/no confirmation. Returns true if confirmed, false otherwise.
export async function confirm(
  title: string,
  opts?: { message?: string; confirmLabel?: string; danger?: boolean },
): Promise<boolean> {
  const v = await useDialogStore.getState().open({
    id: `confirm_${++counter}`,
    kind: 'confirm',
    title,
    ...(opts?.message !== undefined ? { message: opts.message } : {}),
    ...(opts?.confirmLabel !== undefined ? { confirmLabel: opts.confirmLabel } : {}),
    ...(opts?.danger !== undefined ? { danger: opts.danger } : {}),
  });
  return v === true;
}

/// Info / error message. Returns when dismissed.
export async function alert(title: string, message?: string): Promise<void> {
  await useDialogStore.getState().open({
    id: `alert_${++counter}`,
    kind: 'alert',
    title,
    ...(message !== undefined ? { message } : {}),
  });
}
