import Editor, { type OnMount } from '@monaco-editor/react';
import { FileText, FileX, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { ChatView } from '../chat/ChatView';
import { DbStudioView } from '../db-studio/DbStudioView';
import { DevServerView } from '../dev-server/DevServerView';
import { RunButton } from '../run/RunButton';
import { ToolLibraryView } from '../tool-library/ToolLibraryView';
import { setEditor } from './editor-controller';
import { EditorTabs } from './EditorTabs';
import { registerGhostAutocomplete } from './ghost-autocomplete';
import { InlineEditPrompt } from './InlineEditPrompt';
import { registerInlineEditAction } from './inline-edit';
import { useEditor } from './use-editor';

/// Editor area — Monaco editor backed by real file I/O via tauri-plugin-fs.
///
/// Cmd+S / Ctrl+S triggers save() which writes the buffer to disk and
/// clears the dirty marker on the tab. Binary files show a placeholder
/// instead of throwing a UTF-8 error.
export function EditorArea() {
  const { active, content, language, loading, error, kind, onChange, save } = useEditor();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [inlinePromptOpen, setInlinePromptOpen] = useState(false);
  // Special tab kind (e.g. DB Studio) shortcuts the file-editor branch entirely.
  const activeEditorTab = useAppStore((s) =>
    s.editorTabs.find((t) => t.id === s.activeEditorTabId) ?? null,
  );
  const tabKind = activeEditorTab?.kind ?? 'file';

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's';
      if (isSave) {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  return (
    <div className="relative flex h-full flex-col bg-neutral-900">
      <InlineEditPrompt open={inlinePromptOpen} onClose={() => setInlinePromptOpen(false)} />
      <div className="flex items-center justify-between">
        <div className="flex-1 overflow-hidden">
          <EditorTabs />
        </div>
        <div className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-2">
          <RunButton />
        </div>
      </div>
      {tabKind === 'db-studio' ? (
        <DbStudioView />
      ) : tabKind === 'chat' ? (
        <ChatView />
      ) : tabKind === 'dev-server' ? (
        <DevServerView />
      ) : tabKind === 'tool-library' ? (
        <ToolLibraryView />
      ) : !active ? (
        <EmptyState />
      ) : loading ? (
        <div className="flex h-full items-center justify-center gap-2 text-[var(--color-fg-subtle)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Loading {active.label}…</span>
        </div>
      ) : error ? (
        <div className="p-4 text-xs text-[var(--color-danger)]">{error}</div>
      ) : kind === 'binary' ? (
        <BinaryPlaceholder name={active.label} path={active.path} />
      ) : (
        <Editor
          height="100%"
          path={active.path}
          language={language}
          value={content}
          theme="vs-dark"
          onChange={onChange}
          onMount={(editor) => {
            editorRef.current = editor;
            setEditor(editor);
            registerInlineEditAction(editor, () => setInlinePromptOpen(true));
          }}
          options={{
            minimap: { enabled: true },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true },
            // Copilot/Cursor-style ghost completions
            inlineSuggest: { enabled: true, mode: 'subwordSmart' },
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: true, strings: true },
          }}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--color-fg-dim)]">
      <FileText className="h-12 w-12" />
      <p className="text-sm">No file open</p>
      <p className="text-xs">Click a file in the Explorer to start editing.</p>
    </div>
  );
}

function BinaryPlaceholder({ name, path }: { name: string; path: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[var(--color-fg-dim)]">
      <FileX className="h-12 w-12 text-[var(--color-fg-subtle)]" />
      <p className="text-sm text-[var(--color-fg-muted)]">Binary file — cannot display</p>
      <p className="font-mono text-[11px] text-[var(--color-fg-subtle)]">{name}</p>
      <p className="select-text max-w-md font-mono text-[10px] text-[var(--color-fg-dim)]">{path}</p>
    </div>
  );
}
