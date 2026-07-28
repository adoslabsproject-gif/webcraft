import { create } from 'zustand';
import { sidecarPost } from '../../lib/ipc/sidecar';

/// Interactive permission asks from the Claude Code bridge — distinct from
/// lib/ai/permissions (the in-app tool-executor gate for API providers):
/// these asks originate in the CLI process and travel through the sidecar's
/// permission broker.
///
/// While a CC run streams, ClaudeCodeProvider starts polling the broker;
/// pending asks render in AgentPermissionDialog. Answers go back to the
/// broker, which the CLI's approval_prompt MCP tool is polling in turn.

export interface AgentPermissionAsk {
  id: string;
  toolName: string;
  input: unknown;
  createdAt: number;
}

interface AgentPermissionState {
  asks: AgentPermissionAsk[];
  startPolling: () => void;
  stopPolling: () => void;
  answer: (id: string, behavior: 'allow' | 'deny') => Promise<void>;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollBusy = false;

export const useAgentPermissionStore = create<AgentPermissionState>((set, get) => ({
  asks: [],

  startPolling: () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (pollBusy) return;
      pollBusy = true;
      void sidecarPost<{ asks: AgentPermissionAsk[] }>('/agent/permission/pending', {})
        .then((r) => set({ asks: r.asks }))
        .catch(() => {
          /* sidecar briefly unreachable — keep the last known asks */
        })
        .finally(() => {
          pollBusy = false;
        });
    }, 600);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    set({ asks: [] });
  },

  answer: async (id, behavior) => {
    // Optimistic removal — the broker is the source of truth on next poll.
    set({ asks: get().asks.filter((a) => a.id !== id) });
    await sidecarPost('/agent/permission/answer', { id, behavior }).catch(() => {});
  },
}));
