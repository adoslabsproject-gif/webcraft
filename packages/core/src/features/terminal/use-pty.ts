import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';

/// PTY hook — bridges xterm to the Rust PTY backend (portable-pty).

interface UsePtyOptions {
  cwd: string | null;
  onData: (chunk: string) => void;
  onExit?: () => void;
}

export function usePty({ cwd, onData, onExit }: UsePtyOptions) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(onData);
  const exitRef = useRef(onExit);
  dataRef.current = onData;
  exitRef.current = onExit;

  useEffect(() => {
    let unlistenData: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;
    let activeId: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { id } = await invoke<{ id: string }>('pty_spawn', {
          args: { cwd: cwd ?? null, cols: 120, rows: 30 },
        });
        if (cancelled) {
          await invoke('pty_kill', { id }).catch(() => {});
          return;
        }
        activeId = id;
        setSessionId(id);
        unlistenData = await listen<string>(`pty://output:${id}`, (e) => dataRef.current(e.payload));
        unlistenExit = await listen(`pty://exit:${id}`, () => exitRef.current?.());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      unlistenData?.();
      unlistenExit?.();
      if (activeId) invoke('pty_kill', { id: activeId }).catch(() => {});
    };
  }, [cwd]);

  const write = (data: string) => {
    if (!sessionId) return;
    invoke('pty_input', { id: sessionId, data }).catch(() => {});
  };

  const resize = (cols: number, rows: number) => {
    if (!sessionId) return;
    invoke('pty_resize', { id: sessionId, cols, rows }).catch(() => {});
  };

  return { sessionId, error, write, resize };
}
