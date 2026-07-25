import { useAppStore } from '../store/app-store';
import { FileTree } from '../features/file-tree/FileTree';
import { GitPanel } from '../features/git/GitPanel';
import { OutlinePanel } from '../features/outline/OutlinePanel';
import { SearchPanel } from '../features/search/SearchPanel';
import { SettingsPanel } from '../features/settings/SettingsPanel';

/// Sidebar router — renders the panel matching the active ActivityBar slot.
/// DB Studio, AI Chat, and Dev Server are intentionally NOT here: they open
/// as full-area tabs in the EditorArea where they have room to breathe.
export function Sidebar() {
  const panel = useAppStore((s) => s.activityPanel);

  // Settings needs extra room: its rows pair a label with action buttons and
  // at 288px the buttons wrap/overflow their boxes. Other panels keep the
  // compact width.
  const width = panel === 'settings' ? 'w-80' : 'w-72';

  return (
    <aside className={`flex ${width} flex-col border-r border-neutral-800 bg-neutral-925`}>
      {panel === 'explorer' && <FileTree />}
      {panel === 'search' && <SearchPanel />}
      {panel === 'git' && <GitPanel />}
      {panel === 'outline' && <OutlinePanel />}
      {panel === 'settings' && <SettingsPanel />}
    </aside>
  );
}
