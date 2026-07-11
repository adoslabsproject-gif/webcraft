import { Command } from 'cmdk';
import {
  Database,
  FileCode,
  FilePlus,
  FolderOpen,
  GitBranch,
  MessageSquare,
  Save,
  Search,
  Server,
  Settings,
  Sparkles,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { pickFolder } from '../../lib/ipc/fs';
import { useAppStore } from '../../store/app-store';

/// Global Command Palette (⇧⌘P / Ctrl+Shift+P) — fuzzy search across every
/// app action: panel switches, file ops, view toggles, settings. cmdk powers
/// the matching + keyboard navigation. Closes on Escape or action select.

interface CmdItem {
  id: string;
  group: 'File' | 'View' | 'Tools' | 'Settings';
  label: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const store = useAppStore;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'p' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const items: CmdItem[] = [
    {
      id: 'open-folder',
      group: 'File',
      label: 'Open Folder…',
      shortcut: '⌘O',
      icon: FolderOpen,
      run: async () => {
        const f = await pickFolder();
        if (f) store.getState().setProjectRoot(f);
      },
    },
    {
      id: 'new-file',
      group: 'File',
      label: 'New File',
      shortcut: '⌘N',
      icon: FilePlus,
      run: () => undefined,
    },
    {
      id: 'save',
      group: 'File',
      label: 'Save',
      shortcut: '⌘S',
      icon: Save,
      run: () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }));
      },
    },
    {
      id: 'view-explorer',
      group: 'View',
      label: 'Show Explorer',
      shortcut: '⇧⌘E',
      icon: FileCode,
      run: () => store.getState().setActivityPanel('explorer'),
    },
    {
      id: 'view-search',
      group: 'View',
      label: 'Show Search',
      shortcut: '⇧⌘F',
      icon: Search,
      run: () => store.getState().setActivityPanel('search'),
    },
    {
      id: 'view-git',
      group: 'View',
      label: 'Show Source Control',
      icon: GitBranch,
      run: () => store.getState().setActivityPanel('git'),
    },
    {
      id: 'view-chat',
      group: 'View',
      label: 'Open AI Chat',
      shortcut: '⌘L',
      icon: MessageSquare,
      run: () => store.getState().openChatTab(),
    },
    {
      id: 'view-db',
      group: 'Tools',
      label: 'Open DB Studio',
      icon: Database,
      run: () => store.getState().openDbStudioTab(),
    },
    {
      id: 'view-dev-server',
      group: 'Tools',
      label: 'Open Dev Server',
      icon: Server,
      run: () => store.getState().openDevServerTab(),
    },
    {
      id: 'view-terminal',
      group: 'View',
      label: 'Toggle Terminal',
      shortcut: '⌘`',
      icon: TerminalIcon,
      run: () => {
        const s = store.getState();
        s.setBottomTab('terminal');
        s.toggleBottomPanel();
      },
    },
    {
      id: 'view-settings',
      group: 'Settings',
      label: 'Settings',
      shortcut: '⌘,',
      icon: Settings,
      run: () => store.getState().setActivityPanel('settings'),
    },
    {
      id: 'ai-schema',
      group: 'Tools',
      label: 'AI: Design Database Schema',
      icon: Sparkles,
      run: () => store.getState().setActivityPanel('db-studio'),
    },
  ];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 p-4 pt-[15vh] animate-in fade-in-0 duration-100"
      onClick={() => setOpen(false)}
    >
      <Command
        loop
        className="w-full max-w-xl overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)] animate-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input
          autoFocus
          placeholder="Type a command…"
          className="w-full border-b border-[var(--color-border-subtle)] bg-transparent px-4 py-3 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none"
        />
        <Command.List className="max-h-[60vh] overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-xs text-[var(--color-fg-subtle)]">
            No matching command.
          </Command.Empty>
          {(['File', 'View', 'Tools', 'Settings'] as const).map((group) => (
            <Command.Group
              key={group}
              heading={group}
              className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]"
            >
              {items
                .filter((i) => i.group === group)
                .map((i) => {
                  const Icon = i.icon;
                  return (
                    <Command.Item
                      key={i.id}
                      value={`${i.group} ${i.label}`}
                      onSelect={async () => {
                        setOpen(false);
                        await i.run();
                      }}
                      className="flex cursor-pointer items-center gap-3 rounded px-3 py-1.5 text-xs text-[var(--color-fg-muted)] data-[selected=true]:bg-[var(--color-accent-muted)] data-[selected=true]:text-[var(--color-fg)]"
                    >
                      <Icon className="h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
                      <span className="flex-1">{i.label}</span>
                      {i.shortcut ? (
                        <kbd className="font-mono text-[10px] text-[var(--color-fg-dim)]">
                          {i.shortcut}
                        </kbd>
                      ) : null}
                    </Command.Item>
                  );
                })}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
