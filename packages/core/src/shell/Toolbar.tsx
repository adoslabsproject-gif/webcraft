import * as Tooltip from '@radix-ui/react-tooltip';
import {
  AlertTriangle,
  ChevronDown,
  Command as CommandIcon,
  FilePlus,
  FolderOpen,
  GitBranch,
  Loader2,
  MessageSquare,
  PanelBottom,
  PanelLeft,
  Play,
  Redo2,
  RefreshCw,
  Replace,
  Save,
  Search,
  Settings,
  SquareTerminal,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EditorActions } from '../features/editor/editor-controller';
import {
  type ActiveRunPlan,
  type RunChoice,
  isWebcraftSourceRoot,
  planActiveRun,
} from '../features/run/runner';
import { pickFolder } from '../lib/ipc/fs';
import { useAppStore } from '../store/app-store';

/// JetBrains-style quick-action toolbar. Sits below the macOS title bar.
/// Groups: File · Edit · Search · View · Run · Git · AI.
///
/// Every button is wired to a REAL action — no `dispatchKey` tricks that
/// silently rely on Monaco having focus. Edit actions (undo/redo/find/replace)
/// go through the editor-controller singleton, so they work even when the
/// AI Chat or DB Studio tab has focus.

export function Toolbar() {
  const setProjectRoot = useAppStore((s) => s.setProjectRoot);
  const openChatTab = useAppStore((s) => s.openChatTab);
  const toggleBottomPanel = useAppStore((s) => s.toggleBottomPanel);
  const setActivityPanel = useAppStore((s) => s.setActivityPanel);
  const setBottomTab = useAppStore((s) => s.setBottomTab);
  const setBottomPanelOpen = useAppStore((s) => s.setBottomPanelOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const newUntitledFile = useAppStore((s) => s.newUntitledFile);
  const projectRoot = useAppStore((s) => s.projectRoot);
  const activeTab = useAppStore((s) =>
    s.editorTabs.find((t) => t.id === s.activeEditorTabId) ?? null,
  );
  const editorTabs = useAppStore((s) => s.editorTabs);

  const [running, setRunning] = useState(false);
  const [runMenu, setRunMenu] = useState<{
    choices: RunChoice[];
    source: string;
    isSelfHost: boolean;
  } | null>(null);

  async function executeChoice(choice: RunChoice) {
    if (running) return;
    setRunMenu(null);
    setRunning(true);
    setBottomTab('output');
    setBottomPanelOpen(true);
    try {
      await choice.runFn();
    } catch (e) {
      window.dispatchEvent(
        new CustomEvent('webcraft:run:output', {
          detail: `\n[Run] failed: ${e instanceof Error ? e.message : String(e)}\n`,
        }),
      );
    } finally {
      setRunning(false);
    }
  }

  async function handleRun() {
    if (running) return;
    // If a menu is already open, close it (toggle behaviour).
    if (runMenu) {
      setRunMenu(null);
      return;
    }
    const filePath = activeTab && activeTab.kind === 'file' ? activeTab.path : null;
    const [plan, isSelfHost] = await Promise.all([
      planActiveRun(filePath, projectRoot),
      isWebcraftSourceRoot(projectRoot),
    ]);
    if (plan.status === 'nothing') {
      setBottomTab('output');
      setBottomPanelOpen(true);
      window.dispatchEvent(
        new CustomEvent('webcraft:run:output', {
          detail:
            '\n[Run] Nothing to run. Open a runnable file (.js/.ts/.py/.sh/etc.) or a project with a package.json script.\n',
        }),
      );
      return;
    }
    // Single choice: run only if it's a real file script AND the project
    // isn't the WebCraft source itself — otherwise show the picker so the
    // user can confirm (avoids accidentally `pnpm dev`-ing the running app).
    if (plan.status === 'one' && !isSelfHost) {
      await executeChoice(plan.choice);
      return;
    }
    const choices = plan.status === 'one' ? [plan.choice] : plan.choices;
    setRunMenu({ choices, source: plan.source, isSelfHost });
  }

  // ⌘S — the Save handler lives in EditorArea and listens at window level,
  // so dispatching a synthetic keydown is the simplest correct path.
  const triggerSave = () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }));

  return (
    <Tooltip.Provider delayDuration={500}>
      <div className="flex h-9 shrink-0 items-center gap-px border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-2">
        {/* File group */}
        <ToolGroup>
          <ToolBtn
            icon={FolderOpen}
            label="Open Folder"
            shortcut="⌘O"
            onClick={async () => {
              const f = await pickFolder();
              if (f) setProjectRoot(f);
            }}
          />
          <ToolBtn icon={FilePlus} label="New File" shortcut="⌘N" onClick={newUntitledFile} />
          <ToolBtn icon={Save} label="Save" shortcut="⌘S" onClick={triggerSave} />
          <ToolBtn
            icon={RefreshCw}
            label="Reload Window"
            onClick={() => window.location.reload()}
          />
        </ToolGroup>

        <ToolSep />

        {/* Edit group — routed through the editor-controller singleton so it
            works regardless of which pane currently has DOM focus. */}
        <ToolGroup>
          <ToolBtn icon={Undo2} label="Undo" shortcut="⌘Z" onClick={EditorActions.undo} />
          <ToolBtn
            icon={Redo2}
            label="Redo"
            shortcut="⇧⌘Z"
            onClick={EditorActions.redo}
          />
        </ToolGroup>

        <ToolSep />

        {/* Search group */}
        <ToolGroup>
          <ToolBtn icon={Search} label="Find" shortcut="⌘F" onClick={EditorActions.find} />
          <ToolBtn
            icon={Replace}
            label="Replace"
            shortcut="⌥⌘F"
            onClick={EditorActions.replace}
          />
          <ToolBtn
            icon={Search}
            label="Find in Files"
            shortcut="⇧⌘F"
            onClick={() => setActivityPanel('search')}
            tone="indigo"
          />
        </ToolGroup>

        <ToolSep />

        {/* View group */}
        <ToolGroup>
          <ToolBtn icon={PanelLeft} label="Toggle Sidebar" shortcut="⌘B" onClick={toggleSidebar} />
          <ToolBtn
            icon={SquareTerminal}
            label="Toggle Terminal"
            shortcut="⌘`"
            onClick={() => {
              setBottomTab('terminal');
              toggleBottomPanel();
            }}
          />
          <ToolBtn
            icon={PanelBottom}
            label="Toggle Bottom Panel"
            onClick={toggleBottomPanel}
          />
          <ToolBtn
            icon={CommandIcon}
            label="Command Palette"
            shortcut="⇧⌘P"
            onClick={() =>
              window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'p', metaKey: true, shiftKey: true }),
              )
            }
          />
        </ToolGroup>

        <ToolSep />

        {/* Run group — REAL run dispatcher with picker dropdown. */}
        <ToolGroup>
          <div className="relative">
            <button
              type="button"
              onClick={handleRun}
              disabled={running}
              aria-label={running ? 'Running…' : 'Run'}
              className="flex h-7 items-center gap-1 rounded px-1.5 text-[var(--color-success)] transition-colors hover:bg-[var(--color-bg-hover)] hover:opacity-90 disabled:opacity-50"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <ChevronDown className="h-2.5 w-2.5 opacity-60" />
            </button>
            {runMenu ? (
              <RunPickerMenu
                choices={runMenu.choices}
                source={runMenu.source}
                isSelfHost={runMenu.isSelfHost}
                onPick={(c) => void executeChoice(c)}
                onClose={() => setRunMenu(null)}
              />
            ) : null}
          </div>
        </ToolGroup>

        <ToolSep />

        {/* Git group */}
        <ToolGroup>
          <ToolBtn
            icon={GitBranch}
            label="Source Control"
            onClick={() => setActivityPanel('git')}
            tone="warning"
          />
        </ToolGroup>

        <ToolSep />

        {/* AI group */}
        <ToolBtn
          icon={MessageSquare}
          label="Open AI Chat"
          shortcut="⌘L"
          onClick={openChatTab}
          tone="accent"
        />

        <div className="flex-1" />

        {editorTabs.length > 0 ? (
          <span className="mr-2 text-[10px] text-[var(--color-fg-dim)]">
            {editorTabs.length} tab{editorTabs.length === 1 ? '' : 's'}
          </span>
        ) : null}

        <ToolGroup>
          <ToolBtn
            icon={Settings}
            label="Settings"
            shortcut="⌘,"
            onClick={() => setActivityPanel('settings')}
          />
        </ToolGroup>
      </div>
    </Tooltip.Provider>
  );
}

function ToolGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-px">{children}</div>;
}

/// Dropdown shown when Play is clicked and there are multiple runnable
/// choices (typically: every script in package.json). Also surfaces the
/// "you're in the WebCraft IDE source itself" warning so the user doesn't
/// accidentally restart the very dev server keeping this window alive.
function RunPickerMenu({
  choices,
  source,
  isSelfHost,
  onPick,
  onClose,
}: {
  choices: RunChoice[];
  source: string;
  isSelfHost: boolean;
  onPick: (c: RunChoice) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 mt-1 min-w-[280px] overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]"
    >
      <div className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
        Run from <code className="font-mono text-[var(--color-fg-muted)]">{source}</code>
      </div>
      {isSelfHost ? (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>You're inside the WebCraft source.</strong> Running <code>dev</code> will
            collide with the dev server keeping this window alive (port 1420). Pick another
            script, or close WebCraft first.
          </span>
        </div>
      ) : null}
      <div className="max-h-[320px] overflow-y-auto">
        {choices.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(c)}
            className="flex w-full items-start gap-2 px-3 py-2 text-left text-[11px] hover:bg-[var(--color-bg-hover)]"
          >
            <Play className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-success)]" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[var(--color-fg)]">
                {c.kind === 'script' ? c.name : c.label}
              </div>
              {c.kind === 'script' ? (
                <div className="truncate font-mono text-[10px] text-[var(--color-fg-subtle)]">
                  {c.cmd}
                </div>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ToolSep() {
  return <div className="mx-1 h-5 w-px bg-[var(--color-border-subtle)]" />;
}

interface ToolBtnProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  onClick: () => void;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'indigo';
  spin?: boolean;
}

function ToolBtn({ icon: Icon, label, shortcut, onClick, tone = 'default', spin }: ToolBtnProps) {
  const toneClass: Record<NonNullable<ToolBtnProps['tone']>, string> = {
    default: 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]',
    accent: 'text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]',
    success: 'text-[var(--color-success)] hover:opacity-90',
    warning: 'text-[var(--color-warning)] hover:opacity-90',
    danger: 'text-[var(--color-danger)] hover:opacity-90',
    indigo: 'text-sky-400 hover:text-sky-300',
  };
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[var(--color-bg-hover)] ${toneClass[tone]}`}
        >
          <Icon className={`h-3.5 w-3.5 ${spin ? 'animate-spin' : ''}`} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1 text-[11px] text-[var(--color-fg)] shadow-[var(--shadow-md)] animate-in fade-in-0 zoom-in-95 duration-150"
        >
          {label}
          {shortcut ? (
            <kbd className="font-mono text-[10px] text-[var(--color-fg-dim)]">{shortcut}</kbd>
          ) : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
