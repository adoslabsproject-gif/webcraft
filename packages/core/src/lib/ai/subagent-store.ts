import { create } from 'zustand';
import type { ContentBlock } from './types';

/// Live transcripts of subagents spawned by the main chat (or other features).
/// In-memory only — subagents are short-lived "research threads", not
/// persisted state. UI subscribes to render them as nested panels.

export interface SubagentMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface SubagentTranscript {
  id: string;
  title: string;
  task: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'completed' | 'failed';
  messages: SubagentMessage[];
  finalText?: string;
  error?: string;
}

interface SubagentState {
  transcripts: SubagentTranscript[];
  add: (t: SubagentTranscript) => void;
  update: (id: string, patch: Partial<SubagentTranscript>) => void;
  clear: () => void;
}

export const useSubagentStore = create<SubagentState>((set) => ({
  transcripts: [],
  add: (t) => set((s) => ({ transcripts: [...s.transcripts, t] })),
  update: (id, patch) =>
    set((s) => ({
      transcripts: s.transcripts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  clear: () => set({ transcripts: [] }),
}));
