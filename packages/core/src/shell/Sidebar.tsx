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

  return (
    <aside className="flex w-72 flex-col border-r border-neutral-800 bg-neutral-925">
      {panel === 'explorer' && <FileTree />}
      {panel === 'search' && <SearchPanel />}
      {panel === 'git' && <GitPanel />}
      {panel === 'outline' && <OutlinePanel />}
      {panel === 'settings' && <SettingsPanel />}
    </aside>
  );
}
