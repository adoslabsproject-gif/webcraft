import { create } from 'zustand';
import { sidecarPost } from '../../lib/ipc/sidecar';

/// Debugger state — breakpoints, session lifecycle, stopped-state data
/// (call stack, scopes, variables) fed by polling the sidecar's DAP host.

export interface StackFrame {
  id: number;
  name: string;
  path: string | null;
  line: number;
}

export interface Variable {
  name: string;
  value: string;
  variablesReference: number;
}

export interface Scope {
  name: string;
  variablesReference: number;
  variables: Variable[];
  expanded: boolean;
}

type Phase = 'idle' | 'starting' | 'running' | 'stopped' | 'exited';

interface DebugState {
  phase: Phase;
  /// file → 1-indexed lines
  breakpoints: Record<string, number[]>;
  frames: StackFrame[];
  scopes: Scope[];
  activeFrameId: number | null;
  threadId: number | null;
  output: string[];
  error: string | null;
  stoppedReason: string | null;
  toggleBreakpoint: (file: string, line: number) => void;
  start: (program: string, cwd: string) => Promise<void>;
  stop: () => Promise<void>;
  resume: () => Promise<void>;
  stepOver: () => Promise<void>;
  stepIn: () => Promise<void>;
  stepOut: () => Promise<void>;
  selectFrame: (frameId: number) => Promise<void>;
  expandScope: (ref: number) => Promise<void>;
}

let eventCursor = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function onStopped(threadId: number): Promise<void> {
  const s = useDebugStore;
  try {
    const stack = (await sidecarPost<{ result: { stackFrames?: unknown[] } }>('/dap/request', {
      command: 'stackTrace',
      args: { threadId, startFrame: 0, levels: 20 },
    })) as { result?: { stackFrames?: Array<Record<string, unknown>> } };
    const frames: StackFrame[] = (stack.result?.stackFrames ?? []).map((f) => ({
      id: Number(f.id),
      name: String(f.name ?? '?'),
      path: (f.source as { path?: string } | undefined)?.path ?? null,
      line: Number(f.line ?? 0),
    }));
    s.setState({ frames, threadId, phase: 'stopped' });
    if (frames[0]) await s.getState().selectFrame(frames[0].id);
  } catch {
    s.setState({ phase: 'stopped', threadId });
  }
}

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(() => {
    void (async () => {
      try {
        const { events, active } = await sidecarPost<{
          events: Array<{ id: number; event: string; body: Record<string, unknown> }>;
          active: boolean;
        }>('/dap/events', { since: eventCursor });
        for (const e of events) {
          eventCursor = Math.max(eventCursor, e.id);
          if (e.event === 'output') {
            const text = String(e.body?.output ?? '');
            if (text) {
              useDebugStore.setState((st) => ({ output: [...st.output.slice(-400), text] }));
            }
          } else if (e.event === 'stopped') {
            const threadId = Number(e.body?.threadId ?? 1);
            useDebugStore.setState({
              stoppedReason: String(e.body?.reason ?? 'pause'),
            });
            void onStopped(threadId);
          } else if (e.event === 'continued') {
            useDebugStore.setState({ phase: 'running', frames: [], scopes: [] });
          } else if (e.event === 'terminated' || e.event === 'exited') {
            useDebugStore.setState({ phase: 'exited', frames: [], scopes: [] });
            stopPolling();
          }
        }
        if (!active && useDebugStore.getState().phase === 'running') {
          useDebugStore.setState({ phase: 'exited' });
          stopPolling();
        }
      } catch {
        /* sidecar hiccup — keep polling */
      }
    })();
  }, 300);
}

export const useDebugStore = create<DebugState>((set, get) => ({
  phase: 'idle',
  breakpoints: {},
  frames: [],
  scopes: [],
  activeFrameId: null,
  threadId: null,
  output: [],
  error: null,
  stoppedReason: null,

  toggleBreakpoint(file, line) {
    const current = get().breakpoints[file] ?? [];
    const lines = current.includes(line)
      ? current.filter((l) => l !== line)
      : [...current, line].sort((a, b) => a - b);
    set((s) => ({ breakpoints: { ...s.breakpoints, [file]: lines } }));
    // Live-sync when a session is running.
    if (get().phase !== 'idle' && get().phase !== 'exited') {
      void sidecarPost('/dap/breakpoints', { file, lines }).catch(() => {});
    }
  },

  async start(program, cwd) {
    set({ phase: 'starting', output: [], error: null, frames: [], scopes: [] });
    eventCursor = 0;
    try {
      // Push all breakpoints BEFORE launch so first-line hits work.
      for (const [file, lines] of Object.entries(get().breakpoints)) {
        if (lines.length > 0) await sidecarPost('/dap/breakpoints', { file, lines });
      }
      await sidecarPost('/dap/start', { program, cwd });
      set({ phase: 'running' });
      startPolling();
    } catch (e) {
      set({ phase: 'idle', error: e instanceof Error ? e.message : String(e) });
    }
  },

  async stop() {
    stopPolling();
    await sidecarPost('/dap/stop', {}).catch(() => {});
    set({ phase: 'idle', frames: [], scopes: [], threadId: null });
  },

  async resume() {
    const threadId = get().threadId ?? 1;
    set({ phase: 'running', frames: [], scopes: [] });
    await sidecarPost('/dap/request', { command: 'continue', args: { threadId } }).catch(() => {});
  },

  async stepOver() {
    const threadId = get().threadId ?? 1;
    await sidecarPost('/dap/request', { command: 'next', args: { threadId } }).catch(() => {});
  },

  async stepIn() {
    const threadId = get().threadId ?? 1;
    await sidecarPost('/dap/request', { command: 'stepIn', args: { threadId } }).catch(() => {});
  },

  async stepOut() {
    const threadId = get().threadId ?? 1;
    await sidecarPost('/dap/request', { command: 'stepOut', args: { threadId } }).catch(() => {});
  },

  async selectFrame(frameId) {
    set({ activeFrameId: frameId });
    try {
      const res = (await sidecarPost<{ result: { scopes?: unknown[] } }>('/dap/request', {
        command: 'scopes',
        args: { frameId },
      })) as { result?: { scopes?: Array<Record<string, unknown>> } };
      const scopes: Scope[] = (res.result?.scopes ?? []).slice(0, 3).map((sc) => ({
        name: String(sc.name ?? 'Scope'),
        variablesReference: Number(sc.variablesReference ?? 0),
        variables: [],
        expanded: false,
      }));
      set({ scopes });
      if (scopes[0]) await get().expandScope(scopes[0].variablesReference);
    } catch {
      set({ scopes: [] });
    }
  },

  async expandScope(ref) {
    if (!ref) return;
    try {
      const res = (await sidecarPost<{ result: { variables?: unknown[] } }>('/dap/request', {
        command: 'variables',
        args: { variablesReference: ref },
      })) as { result?: { variables?: Array<Record<string, unknown>> } };
      const vars: Variable[] = (res.result?.variables ?? []).slice(0, 100).map((v) => ({
        name: String(v.name ?? '?'),
        value: String(v.value ?? ''),
        variablesReference: Number(v.variablesReference ?? 0),
      }));
      set((s) => ({
        scopes: s.scopes.map((sc) =>
          sc.variablesReference === ref ? { ...sc, variables: vars, expanded: true } : sc,
        ),
      }));
    } catch {
      /* keep scope collapsed */
    }
  },
}));
