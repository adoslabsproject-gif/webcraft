import * as Tooltip from '@radix-ui/react-tooltip';
import {
  Database,
  FileCode,
  GitBranch,
  Library,
  ListTree,
  MessageSquare,
  Search,
  Server,
  Settings,
} from 'lucide-react';
import type { ActivityPanel } from '../store/app-store';
import {
  CHAT_TAB_ID,
  DB_STUDIO_TAB_ID,
  DEV_SERVER_TAB_ID,
  TOOL_LIBRARY_TAB_ID,
  useAppStore,
} from '../store/app-store';

const EDITOR_TAB_IDS: Record<string, string> = {
  'db-studio-tab': DB_STUDIO_TAB_ID,
  'chat-tab': CHAT_TAB_ID,
  'dev-server-tab': DEV_SERVER_TAB_ID,
  'tool-library-tab': TOOL_LIBRARY_TAB_ID,
};

/// Premium left activity bar — wider (56px), glassmorphism background,
/// gradient active indicator, large hit targets (40x40), Radix tooltips
/// with shortcut hints. Color-coded per panel for instant identification.
///
/// Two action modes:
///   - 'panel'      → switches the Sidebar slot (Explorer / Search / etc.)
///   - 'editor-tab' → opens a singleton tab in the EditorArea (DB Studio)

type ActivityKind = 'panel' | 'editor-tab';

interface ActivityItem {
  id: ActivityPanel | 'db-studio-tab' | 'chat-tab' | 'dev-server-tab' | 'tool-library-tab';
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  tint: string;
  kind: ActivityKind;
}

const ITEMS: ActivityItem[] = [
  { id: 'explorer', icon: FileCode, label: 'Explorer', shortcut: '⇧⌘E', tint: 'sky', kind: 'panel' },
  { id: 'search', icon: Search, label: 'Search', shortcut: '⇧⌘F', tint: 'violet', kind: 'panel' },
  { id: 'git', icon: GitBranch, label: 'Source Control', tint: 'orange', kind: 'panel' },
  { id: 'outline', icon: ListTree, label: 'Outline', tint: 'amber', kind: 'panel' },
  { id: 'chat-tab', icon: MessageSquare, label: 'AI Chat', shortcut: '⌘L', tint: 'indigo', kind: 'editor-tab' },
  { id: 'db-studio-tab', icon: Database, label: 'DB Studio', tint: 'emerald', kind: 'editor-tab' },
  { id: 'tool-library-tab', icon: Library, label: 'Tool Library', tint: 'cyan', kind: 'editor-tab' },
  { id: 'dev-server-tab', icon: Server, label: 'Dev Server', tint: 'rose', kind: 'editor-tab' },
];

const TINT_COLOR: Record<string, { fg: string; bg: string; glow: string }> = {
  sky:      { fg: 'text-sky-300',     bg: 'bg-sky-500/15',     glow: 'shadow-sky-500/30' },
  violet:   { fg: 'text-violet-300',  bg: 'bg-violet-500/15',  glow: 'shadow-violet-500/30' },
  orange:   { fg: 'text-orange-300',  bg: 'bg-orange-500/15',  glow: 'shadow-orange-500/30' },
  amber:    { fg: 'text-amber-300',   bg: 'bg-amber-500/15',   glow: 'shadow-amber-500/30' },
  indigo:   { fg: 'text-indigo-300',  bg: 'bg-indigo-500/15',  glow: 'shadow-indigo-500/30' },
  emerald:  { fg: 'text-emerald-300', bg: 'bg-emerald-500/15', glow: 'shadow-emerald-500/30' },
  rose:     { fg: 'text-rose-300',    bg: 'bg-rose-500/15',    glow: 'shadow-rose-500/30' },
  cyan:     { fg: 'text-cyan-300',    bg: 'bg-cyan-500/15',    glow: 'shadow-cyan-500/30' },
};

export function ActivityBar() {
  const active = useAppStore((s) => s.activityPanel);
  const setActive = useAppStore((s) => s.setActivityPanel);
  const openDbStudioTab = useAppStore((s) => s.openDbStudioTab);
  const openChatTab = useAppStore((s) => s.openChatTab);
  const openDevServerTab = useAppStore((s) => s.openDevServerTab);
  const openToolLibraryTab = useAppStore((s) => s.openToolLibraryTab);
  const activeTabId = useAppStore((s) => s.activeEditorTabId);
  const chatDockedRight = useAppStore((s) => s.chatDockedRight);
  const toggleChatDock = useAppStore((s) => s.toggleChatDock);

  function handleClick(item: ActivityItem) {
    if (item.kind === 'editor-tab') {
      if (item.id === 'db-studio-tab') openDbStudioTab();
      else if (item.id === 'chat-tab') {
        // If chat is already docked on the right, the icon toggles the rail.
        // Otherwise it opens the full-area tab.
        if (chatDockedRight) toggleChatDock();
        else openChatTab();
      } else if (item.id === 'dev-server-tab') openDevServerTab();
      else if (item.id === 'tool-library-tab') openToolLibraryTab();
      return;
    }
    setActive(item.id as ActivityPanel);
  }

  function isItemActive(item: ActivityItem): boolean {
    if (item.kind === 'editor-tab') {
      if (item.id === 'chat-tab') {
        return chatDockedRight || activeTabId === EDITOR_TAB_IDS['chat-tab'];
      }
      const tabId = EDITOR_TAB_IDS[item.id];
      return Boolean(tabId && activeTabId === tabId);
    }
    return active === item.id;
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      <nav
        className="relative flex w-14 shrink-0 flex-col items-center justify-between border-r border-[var(--color-border-subtle)] bg-gradient-to-b from-[var(--color-bg-subtle)] to-[var(--color-bg)] py-3"
        style={{ backdropFilter: 'blur(20px) saturate(150%)' }}
      >
        <div className="flex flex-col items-center gap-1">
          {ITEMS.map((item) => (
            <ActivityButton
              key={item.id}
              item={item}
              isActive={isItemActive(item)}
              onClick={() => handleClick(item)}
            />
          ))}
        </div>
        <ActivityButton
          item={{ id: 'settings', icon: Settings, label: 'Settings', shortcut: '⌘,', tint: 'sky', kind: 'panel' }}
          isActive={active === 'settings'}
          onClick={() => setActive('settings')}
        />
      </nav>
    </Tooltip.Provider>
  );
}

function ActivityButton({
  item,
  isActive,
  onClick,
}: {
  item: ActivityItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const tint = TINT_COLOR[item.tint] ?? TINT_COLOR.sky;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={item.label}
          className={`group relative flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-150 ${
            isActive
              ? `${tint?.bg} ${tint?.fg} shadow-md ${tint?.glow}`
              : 'text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]'
          }`}
        >
          {isActive ? (
            <>
              <span className={`absolute left-0 h-7 w-[3px] rounded-r-full ${tint?.fg.replace('text-', 'bg-')}`} />
              <span
                className={`absolute inset-0 -z-10 rounded-lg blur-md opacity-40 ${tint?.bg}`}
                aria-hidden="true"
              />
            </>
          ) : null}
          <Icon className="h-[18px] w-[18px]" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={10}
          className="z-50 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/90 px-3 py-1.5 text-[11px] font-medium text-[var(--color-fg)] shadow-[var(--shadow-lg)] backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-150"
        >
          {item.label}
          {item.shortcut ? (
            <kbd className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-dim)]">
              {item.shortcut}
            </kbd>
          ) : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
