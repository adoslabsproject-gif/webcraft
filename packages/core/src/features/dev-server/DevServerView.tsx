import {
  ExternalLink,
  Eye,
  EyeOff,
  Play,
  Server,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { RUNTIME_DEFAULTS, type Runtime, useDevServerStore } from './dev-server-store';

/// Dev Server full-area view — opened as a singleton tab in the EditorArea.
///
/// Layout:
///   ┌────────────────────────────────────────────────────────────┐
///   │  Toolbar: runtime · command · port · [▶ Start]             │
///   ├──────────────────────┬─────────────────────────────────────┤
///   │  Sub-sidebar         │  Main area (selected server)        │
///   │  - server #1 ●       │  ┌─────────────────────────────┐    │
///   │  - server #2 ●       │  │ status · port · runtime     │    │
///   │  - server #3 ○       │  ├─────────────────────────────┤    │
///   │                      │  │ logs (full height + width)  │    │
///   │                      │  │                             │    │
///   │                      │  └─────────────────────────────┘    │
///   │                      │  ┌─────────────────────────────┐    │
///   │                      │  │ Live preview iframe         │    │
///   │                      │  │ (toggleable)                │    │
///   │                      │  └─────────────────────────────┘    │
///   └──────────────────────┴─────────────────────────────────────┘

const RUNTIMES: { id: Runtime; label: string }[] = [
  { id: 'node', label: 'Node' },
  { id: 'static', label: 'Static (sirv)' },
  { id: 'php', label: 'PHP' },
  { id: 'python', label: 'Python' },
  { id: 'deno', label: 'Deno' },
  { id: 'bun', label: 'Bun' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'go', label: 'Go' },
];

export function DevServerView() {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const servers = useDevServerStore((s) => s.servers);
  const start = useDevServerStore((s) => s.start);

  const [runtime, setRuntime] = useState<Runtime>('node');
  const [command, setCommand] = useState(RUNTIME_DEFAULTS.node.command);
  const [port, setPort] = useState(RUNTIME_DEFAULTS.node.defaultPort);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!selectedId && servers.length > 0) {
      setSelectedId(servers[0]?.id ?? null);
    }
    if (selectedId && !servers.some((s) => s.id === selectedId)) {
      setSelectedId(servers[0]?.id ?? null);
    }
  }, [servers, selectedId]);

  function changeRuntime(r: Runtime) {
    setRuntime(r);
    setCommand(RUNTIME_DEFAULTS[r].command);
    setPort(RUNTIME_DEFAULTS[r].defaultPort);
  }

  const selected = servers.find((s) => s.id === selectedId);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg)]">
      {/* Top toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
          <Server className="h-4 w-4 text-amber-400" />
          Dev Server
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
            multi-runtime · live preview
          </span>
        </div>
        {!projectRoot ? (
          <span className="text-[11px] text-[var(--color-fg-subtle)]">
            Open a folder to enable dev servers
          </span>
        ) : (
          <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
            cwd: {projectRoot}
          </span>
        )}
      </div>

      {/* Runtime + command + port + start */}
      <div className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {RUNTIMES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => changeRuntime(r.id)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                runtime === r.id
                  ? 'border-amber-500 bg-amber-500/10 text-amber-100'
                  : 'border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              Command
            </label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-1.5 font-mono text-xs text-[var(--color-fg)] focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div className="w-24">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              Port
            </label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || 0)}
              className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-1.5 font-mono text-xs text-[var(--color-fg)] focus:border-amber-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            disabled={!projectRoot}
            onClick={() =>
              projectRoot && void start({ runtime, command, port, cwd: projectRoot })
            }
            className="mt-[14px] flex items-center gap-1.5 self-end rounded-md bg-amber-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-amber-500 disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" />
            Start server
          </button>
        </div>
      </div>

      {/* Body: server list + selected detail */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sub-sidebar */}
        <aside className="flex w-[260px] shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/40">
          <div className="border-b border-[var(--color-border-subtle)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Servers · {servers.length}
          </div>
          <div className="flex-1 overflow-y-auto">
            {servers.length === 0 ? (
              <div className="p-3 text-[11px] text-[var(--color-fg-dim)]">
                No server running yet. Pick a runtime above and hit Start.
              </div>
            ) : (
              servers.map((srv) => {
                const isSel = srv.id === selectedId;
                return (
                  <button
                    key={srv.id}
                    type="button"
                    onClick={() => setSelectedId(srv.id)}
                    className={`flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left text-[11px] transition-colors ${
                      isSel
                        ? 'border-amber-400 bg-amber-500/10 text-[var(--color-fg)]'
                        : 'border-transparent text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)]'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        srv.status === 'running'
                          ? 'animate-pulse bg-emerald-400'
                          : srv.status === 'starting'
                            ? 'animate-pulse bg-amber-400'
                            : 'bg-[var(--color-fg-dim)]'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[var(--color-fg)]">
                        {srv.runtime}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-fg-subtle)]">
                        :{srv.port} · {srv.status}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Main area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <ServerDetail
              id={selected.id}
              previewOpen={previewOpen}
              onTogglePreview={() => setPreviewOpen((v) => !v)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-fg-dim)]">
              {servers.length === 0
                ? 'No server running. Start one above.'
                : 'Pick a server from the list.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ServerDetail({
  id,
  previewOpen,
  onTogglePreview,
}: {
  id: string;
  previewOpen: boolean;
  onTogglePreview: () => void;
}) {
  const srv = useDevServerStore((s) => s.servers.find((x) => x.id === id));
  const stop = useDevServerStore((s) => s.stop);
  const logsRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight });
  });

  if (!srv) return null;
  const url = `http://localhost:${srv.port}`;
  const canPreview = srv.status === 'running';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Status header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              srv.status === 'running'
                ? 'animate-pulse bg-emerald-400'
                : srv.status === 'starting'
                  ? 'animate-pulse bg-amber-400'
                  : 'bg-[var(--color-fg-dim)]'
            }`}
          />
          <span className="font-mono text-[var(--color-fg)]">{srv.runtime}</span>
          <span className="text-[var(--color-fg-subtle)]">·</span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-mono text-[var(--color-accent)] hover:underline"
          >
            {url}
            <ExternalLink className="h-3 w-3" />
          </a>
          <span className="ml-2 rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {srv.status}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canPreview}
            onClick={onTogglePreview}
            className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)] disabled:opacity-40"
            title="Toggle live preview"
          >
            {previewOpen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {previewOpen ? 'Hide preview' : 'Show preview'}
          </button>
          {srv.status !== 'exited' ? (
            <button
              type="button"
              onClick={() => void stop(srv.id)}
              className="flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-500"
              title="Stop server"
            >
              <Square className="h-3 w-3" />
              Stop
            </button>
          ) : (
            <span className="rounded bg-[var(--color-bg)] px-2 py-1 text-[11px] text-[var(--color-fg-subtle)]">
              <Trash2 className="mr-1 inline h-3 w-3" />
              Exited
            </span>
          )}
        </div>
      </div>

      {/* Logs + preview split */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={`flex min-h-0 ${previewOpen && canPreview ? 'flex-1' : 'flex-1'} flex-col`}>
          <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
            <Terminal className="h-3 w-3 text-amber-400" />
            Server logs ({srv.logs.length} lines)
          </div>
          <pre
            ref={logsRef}
            className="min-h-0 flex-1 overflow-auto bg-black px-4 py-2 font-mono text-[11px] leading-relaxed text-neutral-200"
          >
            {srv.logs.length === 0 ? (
              <span className="text-neutral-500">— no output yet —</span>
            ) : (
              srv.logs.join('')
            )}
          </pre>
        </div>
        {previewOpen && canPreview ? (
          <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--color-border-subtle)]">
            <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
              <Eye className="h-3 w-3 text-emerald-400" />
              Live preview · {url}
            </div>
            <iframe
              title={`preview-${srv.id}`}
              src={url}
              className="min-h-0 flex-1 border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
