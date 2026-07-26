import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { EditorActions, getEditor } from '../features/editor/editor-controller';
import { pickFolder, pickSaveFile, writeFile } from '../lib/ipc/fs';
import { useAppStore } from '../store/app-store';

/// Bridge native menu events → app state. Subscribed once on AppShell
/// mount. EVERY id emitted by src-tauri/src/menu.rs MUST have a listener
/// here — a menu item that does nothing on click is a broken promise.

export async function wireMenuEvents(): Promise<UnlistenFn[]> {
  const store = useAppStore.getState;

  const unlisteners = await Promise.all([
    listen('menu:file:open-folder', async () => {
      const folder = await pickFolder();
      if (folder) store().setProjectRoot(folder);
    }),
    listen('menu:file:new', () => store().newUntitledFile()),
    listen('menu:file:save', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }));
    }),
    listen('menu:file:save-as', async () => {
      const editor = getEditor();
      const model = editor?.getModel();
      if (!editor || !model) return;
      const current = store().editorTabs.find((t) => t.id === store().activeEditorTabId);
      const target = await pickSaveFile({
        defaultPath: current?.path ?? `${store().projectRoot ?? ''}/untitled.txt`,
      });
      if (!target) return;
      await writeFile(target, model.getValue());
      store().openEditorTab({
        id: target,
        path: target,
        label: target.split('/').pop() ?? target,
        dirty: false,
      });
      store().notifyFsChange();
    }),
    listen('menu:file:close-tab', () => {
      const id = store().activeEditorTabId;
      if (id) store().closeEditorTab(id);
    }),
    listen('menu:edit:find', () => EditorActions.find()),
    listen('menu:edit:replace', () => EditorActions.replace()),
    listen('menu:edit:find-in-files', () => store().setActivityPanel('search')),
    listen('menu:view:command-palette', () => {
      // The palette's listener sits on `document` (window-dispatched events
      // would never reach it — dispatchEvent does not propagate that way).
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', metaKey: true, shiftKey: true }),
      );
    }),
    listen('menu:help:docs', () => {
      void shellOpen('https://github.com/adoslabsproject-gif/webcraft#readme');
    }),
    listen('menu:help:issue', () => {
      void shellOpen('https://github.com/adoslabsproject-gif/webcraft/issues/new');
    }),
    listen('menu:help:keybindings', () => {
      void shellOpen('https://github.com/adoslabsproject-gif/webcraft#readme');
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
