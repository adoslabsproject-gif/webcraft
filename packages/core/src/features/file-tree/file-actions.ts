import { Command } from '@tauri-apps/plugin-shell';
import { alert, confirm, prompt } from '../dialog/dialog-store';
import { createDir, readFile, removePath, renamePath, writeFile } from '../../lib/ipc/fs';
import { useAppStore } from '../../store/app-store';

/// Centralized file-tree action dispatcher — keeps FileTree.tsx clean and
/// lets the same handler be reused by Command Palette / menu items later.

export interface FileNodeContext {
  id: string;
  name: string;
  isDirectory: boolean;
  projectRoot: string | null;
}

let clipboard: { path: string; cut: boolean } | null = null;

export async function handleFileAction(
  action: string,
  node: FileNodeContext,
  refresh: () => Promise<void> | void,
): Promise<void> {
  const dir = node.id.split('/').slice(0, -1).join('/');

  switch (action) {
    case 'open': {
      if (!node.isDirectory) {
        useAppStore.getState().openEditorTab({
          id: node.id,
          path: node.id,
          label: node.name,
          dirty: false,
        });
      }
      return;
    }
    case 'open-side': {
      if (!node.isDirectory) {
        useAppStore.getState().openEditorTab({
          id: node.id,
          path: node.id,
          label: node.name,
          dirty: false,
        });
      }
      return;
    }
    case 'copy-path':
      await navigator.clipboard.writeText(node.id);
      return;
    case 'copy-relative-path': {
      const rel = node.projectRoot ? node.id.replace(`${node.projectRoot}/`, '') : node.id;
      await navigator.clipboard.writeText(rel);
      return;
    }
    case 'cut':
      clipboard = { path: node.id, cut: true };
      return;
    case 'copy':
      clipboard = { path: node.id, cut: false };
      return;
    case 'paste': {
      if (!clipboard) return;
      const targetDir = node.isDirectory ? node.id : dir;
      const fileName = clipboard.path.split('/').pop() ?? 'file';
      const target = `${targetDir}/${fileName}`;
      if (clipboard.cut) {
        await renamePath(clipboard.path, target);
        clipboard = null;
      } else {
        const content = await readFile(clipboard.path).catch(() => '');
        await writeFile(target, content);
      }
      await refresh();
      return;
    }
    case 'delete': {
      const ok = await confirm(`Delete ${node.name}?`, {
        message: node.isDirectory
          ? 'This will remove the directory and everything inside it. This cannot be undone.'
          : 'The file will be moved to the trash. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (ok) {
        await removePath(node.id);
        useAppStore.getState().notifyFsChange();
        await refresh();
      }
      return;
    }
    case 'rename': {
      const next = await prompt('Rename', {
        message: `Enter a new name for "${node.name}"`,
        defaultValue: node.name,
      });
      if (next && next !== node.name) {
        await renamePath(node.id, `${dir}/${next}`);
        useAppStore.getState().notifyFsChange();
        await refresh();
      }
      return;
    }
    case 'duplicate': {
      if (node.isDirectory) {
        await alert('Not yet supported', 'Directory duplicate not yet implemented.');
        return;
      }
      const content = await readFile(node.id).catch(() => '');
      const base = node.name.replace(/(\.[^.]+)?$/, '');
      const ext = node.name.includes('.') ? `.${node.name.split('.').pop()}` : '';
      await writeFile(`${dir}/${base}_copy${ext}`, content);
      useAppStore.getState().notifyFsChange();
      await refresh();
      return;
    }
    case 'new-file': {
      if (!node.isDirectory) return;
      const name = await prompt('New file', {
        message: `Create a new file in ${node.name}/`,
        placeholder: 'untitled.txt',
      });
      if (name) {
        await writeFile(`${node.id}/${name}`, '');
        useAppStore.getState().notifyFsChange();
        await refresh();
      }
      return;
    }
    case 'new-folder': {
      if (!node.isDirectory) return;
      const name = await prompt('New folder', {
        message: `Create a new folder in ${node.name}/`,
        placeholder: 'new-folder',
      });
      if (name) {
        await createDir(`${node.id}/${name}`);
        useAppStore.getState().notifyFsChange();
        await refresh();
      }
      return;
    }
    case 'refresh':
      await refresh();
      return;
    case 'reveal-finder': {
      try {
        const target = node.isDirectory ? node.id : dir;
        await Command.create('open', [target]).execute();
      } catch (e) {
        await alert('Could not open Finder', e instanceof Error ? e.message : String(e));
      }
      return;
    }
    case 'open-terminal': {
      try {
        const target = node.isDirectory ? node.id : dir;
        // macOS — open the directory in Terminal.app
        await Command.create('open', ['-a', 'Terminal', target]).execute();
      } catch (e) {
        await alert('Could not open Terminal', e instanceof Error ? e.message : String(e));
      }
      return;
    }
    case 'find-in-file':
    case 'find-in-folder':
      useAppStore.getState().setActivityPanel('search');
      return;
    case 'download': {
      if (node.isDirectory) {
        await alert('Not yet supported', 'Directory download not yet implemented.');
        return;
      }
      const content = await readFile(node.id).catch(() => '');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = node.name;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    case 'open-in-explorer': {
      try {
        await Command.create('open', [node.id]).execute();
      } catch (e) {
        await alert('Could not open', e instanceof Error ? e.message : String(e));
      }
      return;
    }
    default:
      console.warn('Unhandled file action:', action);
  }
}
