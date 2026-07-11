import { Database, Library, MessageSquare, Server, X } from 'lucide-react';
import { fileIconFor } from '../file-tree/file-icons';
import { useAppStore } from '../../store/app-store';

const SPECIAL_TAB_VISUALS: Record<string, { Icon: typeof Database; color: string }> = {
  'db-studio': { Icon: Database, color: 'text-emerald-400' },
  chat: { Icon: MessageSquare, color: 'text-indigo-400' },
  'dev-server': { Icon: Server, color: 'text-amber-400' },
  'tool-library': { Icon: Library, color: 'text-cyan-400' },
};

/// Editor tab strip — VSCode-styled tabs. Uses the shared `fileIconFor`
/// (same mapping as the FileTree) for visual consistency. Special tabs
/// (DB Studio, future Settings/Welcome) get a dedicated icon.
export function EditorTabs() {
  const tabs = useAppStore((s) => s.editorTabs);
  const activeId = useAppStore((s) => s.activeEditorTabId);
  const setActive = useAppStore((s) => s.setActiveEditorTab);
  const close = useAppStore((s) => s.closeEditorTab);

  if (tabs.length === 0) return null;

  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] text-xs">
      {tabs.map((tab) => {
        const isSpecial = tab.kind && tab.kind !== 'file';
        const name = tab.path.split('/').pop() ?? tab.label;
        const fileIcon = fileIconFor(name);
        const specialVisual = isSpecial ? SPECIAL_TAB_VISUALS[tab.kind as string] : undefined;
        const Icon = specialVisual?.Icon ?? fileIcon.icon;
        const color = specialVisual?.color ?? fileIcon.color;
        const isActive = tab.id === activeId;
        return (
          <div
            key={tab.id}
            onClick={() => setActive(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                close(tab.id);
              }
            }}
            className={`group relative flex h-full max-w-[200px] cursor-pointer items-center gap-1.5 border-r border-[var(--color-border-subtle)] px-3 transition-colors ${
              isActive
                ? 'bg-[var(--color-bg)] text-[var(--color-fg)]'
                : 'text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg-muted)]'
            }`}
            title={tab.path}
          >
            {isActive ? (
              <span className="absolute inset-x-0 top-0 h-[2px] bg-[var(--color-accent)]" />
            ) : null}
            <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
            <span className="truncate">{tab.label}</span>
            {tab.dirty ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-fg-muted)]" />
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  close(tab.id);
                }}
                className="ml-auto rounded p-0.5 text-[var(--color-fg-subtle)] opacity-0 transition-opacity hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)] group-hover:opacity-100"
                aria-label="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
