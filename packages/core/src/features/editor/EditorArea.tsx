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

/// Welcome screen — shown when no file is open. The fastest path into the
/// product is a single prompt, so it leads with "build a website" example
/// prompts that open the AI chat pre-filled and ready to send.
const EXAMPLE_PROMPTS: { title: string; prompt: string }[] = [
  {
    title: '🎨 Portfolio site',
    prompt:
      'Build a complete portfolio website: dark theme, animated hero, projects grid, about section and contact form. Plain HTML/CSS/JS, no framework. Create all the files, then start a dev server so I can see it.',
  },
  {
    title: '🍝 Restaurant landing',
    prompt:
      'Create a restaurant landing page with a hero, menu section with prices, photo gallery and a booking form. Responsive, elegant serif typography. Create all files and start the dev server.',
  },
  {
    title: '🚀 SaaS landing page',
    prompt:
      'Scaffold a SaaS landing page in React + Vite + Tailwind: sticky navbar, hero with CTA, feature cards, pricing table with 3 tiers, FAQ accordion and footer. Install dependencies, create the project and run it.',
  },
  {
    title: '📝 Blog',
    prompt:
      'Make a minimal personal blog: index page listing posts, individual post pages rendered from markdown files, dark/light toggle. Static — plain HTML/CSS/JS with a small build script. Create everything and serve it.',
  },
  {
    title: '🛒 E-commerce demo',
    prompt:
      'Build a small e-commerce demo with a product grid, cart drawer with quantity controls and a checkout form with validation. React + Vite. Create the project, install deps and start the dev server.',
  },
  {
    title: '📊 Admin dashboard',
    prompt:
      'Create an admin dashboard: sidebar navigation, stat cards, a chart (SVG, no external libs) and a sortable data table. Plain HTML/CSS/JS. Create all files and serve them.',
  },
];

function EmptyState() {
  const openChatTab = useAppStore((s) => s.openChatTab);
  const setChatPrefill = useAppStore((s) => s.setChatPrefill);

  function startWithPrompt(prompt: string) {
    setChatPrefill(prompt);
    openChatTab();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-8 text-[var(--color-fg-dim)]">
      <div className="flex flex-col items-center gap-2">
        <FileText className="h-10 w-10" />
        <p className="text-sm font-medium text-[var(--color-fg-muted)]">
          Build an entire website from a single prompt
        </p>
        <p className="text-xs">
          Pick an example below, or open a file from the Explorer to edit by hand.
        </p>
      </div>
      <button
        type="button"
        onClick={() => openChatTab()}
        className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition-colors hover:bg-indigo-500"
      >
        Open AI Chat
        <kbd className="rounded bg-indigo-500/50 px-1.5 py-0.5 font-mono text-[10px]">⌘L</kbd>
      </button>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {EXAMPLE_PROMPTS.map((example) => (
          <button
            key={example.title}
            type="button"
            onClick={() => startWithPrompt(example.prompt)}
            className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2.5 text-left transition-colors hover:border-indigo-500/50 hover:bg-[var(--color-bg-hover)]"
          >
            <div className="text-xs font-medium text-[var(--color-fg)]">{example.title}</div>
            <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-[var(--color-fg-subtle)]">
              {example.prompt}
            </div>
          </button>
        ))}
      </div>
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
