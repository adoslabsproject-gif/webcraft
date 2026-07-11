import { create } from 'zustand';

/// Diff stream store — append-only log of file changes produced by the
/// model's edit/write tool calls. The DiffStreamView subscribes and
/// renders each hunk live.

export interface DiffHunk {
  id: string;
  path: string;
  oldContent: string;
  newContent: string;
  kind: 'edit' | 'write';
  ts: number;
  status: 'pending' | 'accepted' | 'rejected';
}

interface DiffState {
  hunks: DiffHunk[];
  append: (h: Omit<DiffHunk, 'id' | 'ts' | 'status'>) => void;
  setStatus: (id: string, status: DiffHunk['status']) => void;
  clear: () => void;
}

export const useDiffStore = create<DiffState>((set) => ({
  hunks: [],
  append: (h) =>
    set((s) => ({
      hunks: [
        ...s.hunks,
        {
          ...h,
          id: `hunk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          ts: Date.now(),
          status: 'pending',
        },
      ],
    })),
  setStatus: (id, status) =>
    set((s) => ({ hunks: s.hunks.map((h) => (h.id === id ? { ...h, status } : h)) })),
  clear: () => set({ hunks: [] }),
}));

export function recordHunk(h: Omit<DiffHunk, 'id' | 'ts' | 'status'>) {
  useDiffStore.getState().append(h);
}
