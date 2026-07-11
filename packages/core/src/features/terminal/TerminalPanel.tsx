import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as Xterm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/app-store';
import { usePty } from './use-pty';

/// Integrated terminal — xterm.js wired to the Rust portable-pty backend
/// via Tauri commands. A real interactive shell (zsh/bash on Unix, cmd
/// on Windows), supporting curses apps (vim, htop, etc.) thanks to a true
/// PTY pair.
export function TerminalPanel() {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Xterm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const { error, write, resize } = usePty({
    cwd: projectRoot,
    onData: (chunk) => xtermRef.current?.write(chunk),
  });

  // Mount xterm once
  useEffect(() => {
    if (!containerRef.current || xtermRef.current) return;
    const term = new Xterm({
      fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
      fontSize: 12,
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#a5b4fc',
        selectionBackground: '#4f46e544',
      },
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 10000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;
    return () => {
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Forward keystrokes to PTY
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    const sub = term.onData((data) => write(data));
    return () => sub.dispose();
  }, [write]);

  // Resize PTY when xterm container resizes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      fitRef.current?.fit();
      const term = xtermRef.current;
      if (term) resize(term.cols, term.rows);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resize]);

  return (
    <div className="relative h-full bg-neutral-950">
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-red-400">
          {error}
        </div>
      ) : null}
      <div ref={containerRef} className="h-full w-full p-1" />
    </div>
  );
}
