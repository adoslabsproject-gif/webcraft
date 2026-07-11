import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { pickFolder } from '../lib/ipc/fs';
import { useAppStore } from '../store/app-store';

/// Bridge native menu events → app state. Subscribed once on AppShell mount.

export async function wireMenuEvents(): Promise<UnlistenFn[]> {
  const store = useAppStore.getState;

  const unlisteners = await Promise.all([
    listen('menu:file:open-folder', async () => {
      const folder = await pickFolder();
      if (folder) store().setProjectRoot(folder);
    }),
    listen('menu:file:save', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }));
    }),
    listen('menu:file:close-tab', () => {
      const id = store().activeEditorTabId;
      if (id) store().closeEditorTab(id);
    }),
    listen('menu:view:explorer', () => store().setActivityPanel('explorer')),
    listen('menu:view:search', () => store().setActivityPanel('search')),
    listen('menu:view:git', () => store().setActivityPanel('git')),
    listen('menu:view:chat', () => store().openChatTab()),
    listen('menu:view:db-studio', () => store().openDbStudioTab()),
    listen('menu:view:dev-server', () => store().openDevServerTab()),
    listen('menu:app:settings', () => store().setActivityPanel('settings')),
    listen('menu:view:terminal', () => {
      store().setBottomTab('terminal');
      store().toggleBottomPanel();
    }),
    listen('menu:view:diff', () => {
      store().setBottomTab('diff');
      store().toggleBottomPanel();
    }),
  ]);

  return unlisteners;
}
