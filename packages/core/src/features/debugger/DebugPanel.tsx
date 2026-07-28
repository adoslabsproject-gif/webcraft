import {
  Bug,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Play,
  RotateCw,
  StepForward,
} from 'lucide-react';
import { useAppStore } from '../../store/app-store';
import { revealLocation } from '../editor/editor-controller';
import { useDebugStore } from './debug-store';

/// Debug tab — run the active file under js-debug: controls, call stack,
/// variables, program output. Breakpoints are set by clicking the editor
/// gutter (red dots).
export function DebugPanel() {
  const phase = useDebugStore((s) => s.phase);
  const frames = useDebugStore((s) => s.frames);
  const scopes = useDebugStore((s) => s.scopes);
  const activeFrameId = useDebugStore((s) => s.activeFrameId);
  const output = useDebugStore((s) => s.output);
  const error = useDebugStore((s) => s.error);
  const stoppedReason = useDebugStore((s) => s.stoppedReason);
  const store = useDebugStore.getState;

  const activeTab = useAppStore((s) => s.editorTabs.find((t) => t.id === s.activeEditorTabId));
  const projectRoot = useAppStore((s) => s.projectRoot);
  const openTab = useAppStore((s) => s.openEditorTab);

  const canStart =
    (phase === 'idle' || phase === 'exited') &&
    Boolean(activeTab?.path && /\.(m?js|cjs|ts|mts)$/.test(activeTab.path));
  const running = phase === 'running' || phase === 'starting';

  return (
    <div className="flex h-full text-[11px]">
      {/* Controls + stack + variables */}
      <div className="flex w-[420px] shrink-0 flex-col border-r border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-1 border-b border-[var(--color-border-subtle)] px-2 py-1">
          <Bug className="h-3 w-3 text-emerald-400" />
          {canStart ? (
            <button
              type="button"
              onClick={() => activeTab && void store().start(activeTab.path, projectRoot ?? '/')}
              title={`Debug ${activeTab?.label ?? 'active file'} with Node (TS runs via node --experimental-strip-types)`}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-emerald-300 hover:bg-[var(--color-bg-hover)]"
            >
              <Play className="h-3 w-3" /> Debug {activeTab?.label ?? 'file'}
            </button>
          ) : (
            <span className="px-1 text-[var(--color-fg-subtle)]">
              {phase === 'starting'
                ? 'Starting…'
                : phase === 'running'
                  ? 'Running'
                  : phase === 'stopped'
                    ? `Paused (${stoppedReason ?? 'breakpoint'})`
                    : 'Open a .js/.ts file to debug'}
            </span>
          )}
          <div className="flex-1" />
          <DebugButton
            title="Continue (F5)"
            disabled={phase !== 'stopped'}
            onClick={() => void store().resume()}
          >
            <Play className="h-3 w-3" />
          </DebugButton>
          <DebugButton
            title="Step over (F10)"
            disabled={phase !== 'stopped'}
            onClick={() => void store().stepOver()}
          >
            <StepForward className="h-3 w-3" />
          </DebugButton>
          <DebugButton
            title="Step into (F11)"
            disabled={phase !== 'stopped'}
            onClick={() => void store().stepIn()}
          >
            <ChevronDown className="h-3 w-3" />
          </DebugButton>
          <DebugButton
            title="Step out (⇧F11)"
            disabled={phase !== 'stopped'}
            onClick={() => void store().stepOut()}
          >
            <RotateCw className="h-3 w-3" />
          </DebugButton>
          <DebugButton
            title="Stop"
            disabled={phase === 'idle'}
            onClick={() => void store().stop()}
            danger
          >
            <CircleStop className="h-3 w-3" />
          </DebugButton>
        </div>

        {error ? (
          <div className="select-text border-b border-[var(--color-danger)]/30 bg-[var(--color-danger-muted)] px-2 py-1 text-[10px] text-[var(--color-danger)]">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-2 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Call stack
          </div>
          {frames.length === 0 ? (
            <div className="px-2 py-1 text-[10px] text-[var(--color-fg-dim)]">
              {running ? 'Running — waiting for a breakpoint…' : 'Not paused.'}
            </div>
          ) : (
            <ul>
              {frames.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void store().selectFrame(f.id);
                      if (f.path) {
                        openTab({
                          id: f.path,
                          path: f.path,
                          label: f.path.split('/').pop() ?? f.path,
                          dirty: false,
                        });
                        revealLocation(f.path, f.line, 1);
                      }
                    }}
                    className={`block w-full truncate px-2 py-0.5 text-left font-mono ${
                      f.id === activeFrameId
                        ? 'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]'
                        : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)]'
                    }`}
                  >
                    {f.name} <span className="text-[var(--color-fg-dim)]">· {f.line}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Variables
          </div>
          {scopes.map((sc) => (
            <div key={sc.variablesReference}>
              <button
                type="button"
                onClick={() => void store().expandScope(sc.variablesReference)}
                className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)]"
              >
                {sc.expanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {sc.name}
              </button>
              {sc.expanded
                ? sc.variables.map((v) => (
                    <div
                      key={v.name}
                      className="select-text truncate py-0.5 pl-7 pr-2 font-mono text-[10px]"
                      title={`${v.name} = ${v.value}`}
                    >
                      <span className="text-sky-300">{v.name}</span>
                      <span className="text-[var(--color-fg-dim)]"> = </span>
                      <span className="text-[var(--color-fg-muted)]">{v.value}</span>
                    </div>
                  ))
                : null}
            </div>
          ))}
        </div>
      </div>

      {/* Program output */}
      <div className="min-w-0 flex-1 overflow-y-auto bg-[var(--color-bg)] p-2">
        <pre className="select-text whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[var(--color-fg-muted)]">
          {output.join('') || '— program output —'}
        </pre>
      </div>
    </div>
  );
}

function DebugButton({
  title,
  disabled,
  onClick,
  danger,
  children,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded p-1 disabled:opacity-30 ${
        danger
          ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger-muted)]'
          : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)]'
      }`}
    >
      {children}
    </button>
  );
}
