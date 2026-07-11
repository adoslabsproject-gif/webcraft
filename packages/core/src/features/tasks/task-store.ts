import { create } from 'zustand';

/// Task store — integrated planner used by the AI's task_* tools and by the
/// user-facing Tasks panel. Each task has status pending→in_progress→completed
/// plus blocked / cancelled. Notes accumulate as the work progresses.

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high';

export interface TaskNote {
  ts: number;
  text: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  notes: TaskNote[];
  createdAt: number;
  updatedAt: number;
}

interface TaskState {
  tasks: Task[];
  create: (input: { title: string; description?: string; priority?: TaskPriority }) => Task;
  update: (id: string, patch: Partial<Pick<Task, 'status' | 'priority'>> & { note?: string }) => Task | null;
  get: (id: string) => Task | null;
  list: (filter?: { status?: TaskStatus }) => Task[];
  remove: (id: string) => void;
  clear: () => void;
}

let nextSeq = 0;
function mkId(): string {
  nextSeq += 1;
  return `task_${Date.now().toString(36)}_${nextSeq.toString(36)}`;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],

  create({ title, description, priority }) {
    const task: Task = {
      id: mkId(),
      title,
      description: description ?? '',
      status: 'pending',
      priority: priority ?? 'normal',
      notes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((s) => ({ tasks: [...s.tasks, task] }));
    return task;
  },

  update(id, patch) {
    const current = get().tasks.find((t) => t.id === id);
    if (!current) return null;
    const next: Task = {
      ...current,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.priority ? { priority: patch.priority } : {}),
      ...(patch.note ? { notes: [...current.notes, { ts: Date.now(), text: patch.note }] } : {}),
      updatedAt: Date.now(),
    };
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? next : t)) }));
    return next;
  },

  get(id) {
    return get().tasks.find((t) => t.id === id) ?? null;
  },

  list(filter) {
    const all = get().tasks;
    return filter?.status ? all.filter((t) => t.status === filter.status) : all;
  },

  remove(id) {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },

  clear() {
    set({ tasks: [] });
  },
}));
