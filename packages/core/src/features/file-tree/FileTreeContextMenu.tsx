import {
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  FilePlus,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Scissors,
  Search,
  SquareTerminal,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

/// Floating context menu for a file-tree row. Positioned absolutely at the
/// cursor coordinates. Click outside or Escape to close.
///
/// Action set is aligned with VSCode / Finder so muscle memory works:
///   Open · Open to Side · ─ · Cut · Copy · Paste · ─ · Copy Path ·
///   Copy Relative Path · ─ · Rename · Duplicate · Delete · ─ ·
///   New File · New Folder · ─ · Reveal in Finder · Open in Terminal ·
///   Find in Folder · ─ · Download · Refresh

export interface ContextAction {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  danger?: boolean;
}

interface MenuGroup {
  actions: ContextAction[];
}

const FILE_MENU: MenuGroup[] = [
  {
    actions: [
      { id: 'open', label: 'Open', icon: FolderOpen, shortcut: '↩' },
      { id: 'open-side', label: 'Open to Side', icon: FilePlus2 },
    ],
  },
  {
    actions: [
      { id: 'cut', label: 'Cut', icon: Scissors, shortcut: '⌘X' },
      { id: 'copy', label: 'Copy', icon: Copy, shortcut: '⌘C' },
      { id: 'paste', label: 'Paste', icon: Clipboard, shortcut: '⌘V' },
    ],
  },
  {
    actions: [
      { id: 'copy-path', label: 'Copy Path', icon: Copy, shortcut: '⌥⌘C' },
      { id: 'copy-relative-path', label: 'Copy Relative Path', icon: Copy },
    ],
  },
  {
    actions: [
      { id: 'rename', label: 'Rename…', icon: Pencil, shortcut: '↵' },
      { id: 'duplicate', label: 'Duplicate', icon: FilePlus },
      { id: 'delete', label: 'Delete', icon: Trash2, shortcut: '⌫', danger: true },
    ],
  },
  {
    actions: [
      { id: 'reveal-finder', label: 'Reveal in Finder', icon: ExternalLink },
      { id: 'open-terminal', label: 'Open in Terminal', icon: SquareTerminal },
      { id: 'find-in-file', label: 'Find References', icon: Search },
    ],
  },
  {
    actions: [{ id: 'download', label: 'Download', icon: Download }],
  },
];

const DIR_MENU: MenuGroup[] = [
  {
    actions: [
      { id: 'new-file', label: 'New File…', icon: FilePlus },
      { id: 'new-folder', label: 'New Folder…', icon: FolderPlus },
    ],
  },
  {
    actions: [
      { id: 'cut', label: 'Cut', icon: Scissors, shortcut: '⌘X' },
      { id: 'copy', label: 'Copy', icon: Copy, shortcut: '⌘C' },
      { id: 'paste', label: 'Paste Here', icon: Clipboard, shortcut: '⌘V' },
    ],
  },
  {
    actions: [
      { id: 'copy-path', label: 'Copy Path', icon: Copy, shortcut: '⌥⌘C' },
      { id: 'copy-relative-path', label: 'Copy Relative Path', icon: Copy },
    ],
  },
  {
    actions: [
      { id: 'rename', label: 'Rename…', icon: Pencil, shortcut: '↵' },
      { id: 'delete', label: 'Delete', icon: Trash2, shortcut: '⌫', danger: true },
    ],
  },
  {
    actions: [
      { id: 'reveal-finder', label: 'Reveal in Finder', icon: ExternalLink },
      { id: 'open-terminal', label: 'Open in Terminal', icon: SquareTerminal },
      { id: 'find-in-folder', label: 'Find in Folder…', icon: Search, shortcut: '⌥⌘F' },
    ],
  },
  {
    actions: [{ id: 'refresh', label: 'Refresh', icon: RefreshCw }],
  },
];

export function FileTreeContextMenu({
  x,
  y,
  isDirectory,
  onClose,
  onAction,
}: {
  x: number;
  y: number;
  isDirectory: boolean;
  onClose: () => void;
  onAction: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const groups = isDirectory ? DIR_MENU : FILE_MENU;

  // Clamp menu position to viewport so it never overflows off-screen.
  const menuW = 240;
  const menuH = Math.min(window.innerHeight - 20, 460);
  const clampedX = Math.min(x, window.innerWidth - menuW - 8);
  const clampedY = Math.min(y, window.innerHeight - menuH - 8);

  return (
    <div
      ref={ref}
      style={{ top: clampedY, left: clampedX, width: menuW }}
      className="fixed z-50 max-h-[460px] overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 shadow-[var(--shadow-lg)] animate-in fade-in-0 zoom-in-95 duration-100"
    >
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 ? <div className="my-1 h-px bg-[var(--color-border-subtle)]" /> : null}
          {group.actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onAction(a.id);
                  onClose();
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  a.danger
                    ? 'text-rose-300 hover:bg-rose-500/10 hover:text-rose-200'
                    : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate">{a.label}</span>
                {a.shortcut ? (
                  <kbd className="shrink-0 rounded bg-[var(--color-bg-subtle)] px-1 font-mono text-[10px] text-[var(--color-fg-subtle)]">
                    {a.shortcut}
                  </kbd>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
