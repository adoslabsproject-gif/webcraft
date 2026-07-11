import { create } from 'zustand';

/// Permission gate for tool calls — same UX pattern as Claude Code CLI:
/// the first destructive action shows a modal with three choices. The
/// user can grant "allow always" to skip the prompt for THE SAME CATEGORY
/// for the rest of the session (matches `--dangerously-skip-permissions`
/// behaviour but scoped per-category instead of global).
///
/// Categories are coarse on purpose: write_file/edit_file/multi_edit all
/// roll up into 'edit-files' so the user doesn't get prompted twice in a
/// row for what feels like the same operation.

export type PermissionCategory =
  | 'edit-files' // write_file, edit_file, multi_edit
  | 'delete-files' // remove_path
  | 'rename-files'
  | 'create-dirs'
  | 'run-command' // shell exec / run_command
  | 'git-write' // commit / push / branch operations
  | 'network'; // fetch_url to non-localhost

export type PermissionDecision = 'allow-once' | 'allow-always' | 'deny';

export interface PermissionRequest {
  id: string;
  category: PermissionCategory;
  title: string;
  /// Human-readable description (e.g. 'write to /Users/zelistore/Sara/workflow.md').
  detail: string;
  /// Optional code preview shown in monospace inside the modal.
  preview?: string;
}

interface PermissionState {
  /// Pending request awaiting user input. Single-slot (modal blocks the
  /// chat loop so we never have more than one in flight).
  pending: PermissionRequest | null;
  /// Sticky grants/denies for this session — cleared on app reload.
  alwaysDecisions: Map<PermissionCategory, 'allow' | 'deny'>;
  request: (req: PermissionRequest) => Promise<PermissionDecision>;
  resolve: (decision: PermissionDecision) => void;
  reset: () => void;
}

// Single-flight resolver — set when `request` is called, invoked by `resolve`.
let inflightResolve: ((d: PermissionDecision) => void) | null = null;

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pending: null,
  alwaysDecisions: new Map(),

  async request(req) {
    // Sticky grant/deny short-circuits the modal.
    const sticky = get().alwaysDecisions.get(req.category);
    if (sticky === 'allow') return 'allow-always';
    if (sticky === 'deny') return 'deny';

    set({ pending: req });
    return new Promise<PermissionDecision>((resolve) => {
      inflightResolve = resolve;
    });
  },

  resolve(decision) {
    const req = get().pending;
    if (!req) return;
    if (decision === 'allow-always') {
      const next = new Map(get().alwaysDecisions);
      next.set(req.category, 'allow');
      set({ alwaysDecisions: next });
    }
    if (decision === 'deny') {
      // 'deny' here means "deny this single request" — not sticky. The
      // user has a separate mental model for "never ask again": that's
      // explicit and lives elsewhere (Settings reset).
    }
    set({ pending: null });
    inflightResolve?.(decision);
    inflightResolve = null;
  },

  reset() {
    set({ pending: null, alwaysDecisions: new Map() });
    inflightResolve = null;
  },
}));

/// Convenience: call inside a tool handler to gate a destructive action.
/// Returns true if the user (or a sticky grant) allowed it, false if denied.
export async function requirePermission(req: PermissionRequest): Promise<boolean> {
  const decision = await usePermissionStore.getState().request(req);
  return decision === 'allow-once' || decision === 'allow-always';
}
