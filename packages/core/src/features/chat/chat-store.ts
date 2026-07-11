import { create } from 'zustand';
import type { ChatMessage, ContentBlock } from '../../lib/ai/types';

/// Live status of what the chat loop is doing right now — surfaced to the
/// UI so the user sees "Reading file..." / "Editing file..." instead of a
/// blank streaming bar that feels frozen.
export type ChatStatus =
  | { phase: 'idle' }
  | { phase: 'thinking' }
  | { phase: 'streaming-text' }
  | { phase: 'running-tool'; name: string; round: number };

interface ChatState {
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;
  pendingText: string;
  status: ChatStatus;
  appendMessage: (m: ChatMessage) => void;
  setMessageContent: (id: string, content: ContentBlock[]) => void;
  setMessageStreaming: (id: string, streaming: boolean) => void;
  startStream: () => void;
  endStream: () => void;
  setError: (err: string | null) => void;
  setPendingText: (text: string) => void;
  appendPendingText: (delta: string) => void;
  clearPendingText: () => void;
  setStatus: (s: ChatStatus) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  streaming: false,
  error: null,
  pendingText: '',
  status: { phase: 'idle' },

  appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),

  setMessageContent: (id, content) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
    })),

  setMessageStreaming: (id, streaming) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, streaming } : m)),
    })),

  startStream: () =>
    set({ streaming: true, error: null, pendingText: '', status: { phase: 'thinking' } }),
  endStream: () => set({ streaming: false, pendingText: '', status: { phase: 'idle' } }),
  setError: (err) => set({ error: err, streaming: false, status: { phase: 'idle' } }),
  setPendingText: (text) => set({ pendingText: text }),
  appendPendingText: (delta) =>
    set((s) => ({
      pendingText: s.pendingText + delta,
      status: s.status.phase === 'thinking' ? { phase: 'streaming-text' } : s.status,
    })),
  clearPendingText: () => set({ pendingText: '' }),
  setStatus: (status) => set({ status }),
  reset: () =>
    set({ messages: [], streaming: false, error: null, pendingText: '', status: { phase: 'idle' } }),
}));
