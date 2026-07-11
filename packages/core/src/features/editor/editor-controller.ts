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

export function setEditor(editor: Editor | null): void {
  currentEditor = editor;
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
