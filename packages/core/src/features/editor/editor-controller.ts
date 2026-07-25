import type * as monaco from 'monaco-editor';

/// Editor controller — singleton accessor over the live Monaco editor instance.
///
/// EditorArea registers the editor on mount via `setEditor()`; the Toolbar
/// (and any other code that needs to drive editor actions from outside the
/// editor's own focus) invokes `runAction()` against the registered instance.
///
/// This is the same pattern VSCode uses for `vscode.commands.executeCommand`
/// — toolbar buttons MUST work even if focus is on the sidebar, chat, or
/// any other shell pane.

type Editor = monaco.editor.IStandaloneCodeEditor;

let currentEditor: Editor | null = null;

/// Reveal request that outlives editor remounts. Jumping from the Problems
/// panel opens the tab first; the editor then unmounts (loading spinner)
/// and remounts with the new model, so the reveal must wait until an editor
/// whose model matches the requested path is actually live.
let pendingReveal: { path: string; line: number; column: number } | null = null;

export function setEditor(editor: Editor | null): void {
  currentEditor = editor;
  if (editor) {
    editor.onDidChangeModel(() => consumePendingReveal());
    consumePendingReveal();
  }
}

/// Jump to a position in a file. If the file is already the active model the
/// reveal happens immediately; otherwise it stays pending until the editor
/// (re)mounts with that model. Caller is responsible for opening the tab.
export function revealLocation(path: string, line: number, column: number): void {
  pendingReveal = { path, line, column };
  consumePendingReveal();
}

function consumePendingReveal(): void {
  const editor = currentEditor;
  const target = pendingReveal;
  if (!editor || !target) return;
  const model = editor.getModel();
  if (!model || model.uri.path !== target.path) return;
  const position = { lineNumber: target.line, column: target.column };
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  editor.focus();
  pendingReveal = null;
}

export function getEditor(): Editor | null {
  return currentEditor;
}

/// Invoke a Monaco action by id (e.g. 'undo', 'redo', 'actions.find',
/// 'editor.action.startFindReplaceAction'). Returns true if the action ran.
/// Re-focuses the editor so subsequent keystrokes (typed query in Find box)
/// land inside Monaco rather than the toolbar button.
export function runAction(actionId: string): boolean {
  const editor = currentEditor;
  if (!editor) return false;
  editor.focus();
  const action = editor.getAction(actionId);
  if (action) {
    void action.run();
    return true;
  }
  // Built-in commands without an action wrapper (undo/redo) — fall back to
  // the keyboard trigger path which IS available on the editor instance.
  editor.trigger('toolbar', actionId, null);
  return true;
}

/// Convenience wrappers — keep the action ids in ONE place so future renames
/// in Monaco don't scatter through the codebase.
export const EditorActions = {
  undo: () => runAction('undo'),
  redo: () => runAction('redo'),
  find: () => runAction('actions.find'),
  replace: () => runAction('editor.action.startFindReplaceAction'),
  goToLine: () => runAction('editor.action.gotoLine'),
  formatDocument: () => runAction('editor.action.formatDocument'),
  commandPalette: () => runAction('editor.action.quickCommand'),
};
