import {
  AlertCircle,
  Bot,
  Maximize2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import { useEffect } from 'react';
import { CHAT_TAB_ID, useAppStore } from '../../store/app-store';
import { useSettingsStore } from '../../store/settings-store';
import type { ChatStatus } from './chat-store';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';
import { useChat } from './use-chat';

/// AI Chat full-area view — opened as a singleton tab in the EditorArea.
///
/// Layout:
///   ┌───────────────────────────────────────────────────────────┐
///   │  Header: AI CHAT · Liara (free) · Qwen3-32B · [Settings]  │
///   ├───────────────────────────────────────────────────────────┤
///   │                                                           │
///   │          ┌────────────────────────────────┐               │
///   │          │  Message list (max-width 880px │  ← centered   │
///   │          │  for comfortable line length)  │               │
///   │          └────────────────────────────────┘               │
///   │                                                           │
///   ├───────────────────────────────────────────────────────────┤
///   │  Composer (also centered, max-width 880px)                │
///   └───────────────────────────────────────────────────────────┘

export function ChatView({ compact = false }: { compact?: boolean } = {}) {
  const loadSettings = useSettingsStore((s) => s.load);
  const loaded = useSettingsStore((s) => s.loaded);
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const model = useSettingsStore((s) => s.model);
  const apiKey = useSettingsStore((s) => s.apiKeys[activeProvider]);
  const setActivityPanel = useAppStore((s) => s.setActivityPanel);
  const chatDockedRight = useAppStore((s) => s.chatDockedRight);
  const setChatDocked = useAppStore((s) => s.setChatDocked);
  const closeEditorTab = useAppStore((s) => s.closeEditorTab);
  const openChatTab = useAppStore((s) => s.openChatTab);

  const ready = activeProvider === 'nha' || Boolean(apiKey);
  const { messages, streaming, error, pendingText, status, send, stop } = useChat();

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function dockToRight() {
    // Move from tab → docked right rail. Close the tab so we don't show
    // chat in two places at once.
    setChatDocked(true);
    closeEditorTab(CHAT_TAB_ID);
  }

  function expandToTab() {
    // Move from docked → full-area tab.
    setChatDocked(false);
    openChatTab();
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg)]">
      {/* Top header */}
      <div className={`flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] ${compact ? 'px-3 py-1.5' : 'px-4 py-2'}`}>
        <div className={`flex items-center gap-2 ${compact ? 'text-xs' : 'text-sm'} font-semibold text-[var(--color-fg)]`}>
          <MessageSquare className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} text-indigo-400`} />
          AI Chat
          {!compact ? (
            <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-300">
              {activeProvider === 'nha' ? 'Liara · free tier' : activeProvider}
            </span>
          ) : null}
          <span className="font-mono text-[10px] text-[var(--color-fg-subtle)]">
            {labelModel(model)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {compact ? (
            <button
              type="button"
              onClick={expandToTab}
              title="Expand to full-area tab"
              className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={chatDockedRight ? () => setChatDocked(false) : dockToRight}
            title={chatDockedRight ? 'Undock right rail' : 'Dock to right side'}
            className={`rounded p-1 hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)] ${
              chatDockedRight ? 'text-indigo-300' : 'text-[var(--color-fg-subtle)]'
            }`}
          >
            {chatDockedRight ? <PanelRightClose className="h-3 w-3" /> : <PanelRightOpen className="h-3 w-3" />}
          </button>
          {!compact ? (
            <button
              type="button"
              onClick={() => setActivityPanel('settings')}
              className="ml-1 flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
              title="Open Settings"
            >
              <SettingsIcon className="h-3 w-3" />
              Provider & keys
            </button>
          ) : null}
        </div>
      </div>

      {loaded && !ready ? (
        <div className="flex items-center gap-2 border-b border-[var(--color-warning)]/30 bg-[var(--color-warning-muted)] px-4 py-2 text-xs text-[var(--color-warning)]">
          <AlertCircle className="h-3.5 w-3.5" />
          No API key for <strong>{activeProvider}</strong>. Open Settings to add one, or switch
          back to Liara (free, no key needed).
        </div>
      ) : null}

      {error ? (
        <div className="border-b border-[var(--color-danger)]/30 bg-[var(--color-danger-muted)] px-4 py-2 text-xs text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      {streaming ? <StreamingBar status={status} /> : null}

      {/* Conversation column — compact mode (right rail 380px) uses full
          width; full-area tab mode centers a max-width 880px column for
          comfortable reading. */}
      <div className="flex min-h-0 flex-1 justify-center overflow-hidden">
        <div className={`flex w-full ${compact ? '' : 'max-w-[880px]'} min-h-0 flex-1 flex-col`}>
          {messages.length === 0 ? (
            <EmptyChatHero compact={compact} />
          ) : (
            <MessageList messages={messages} streamingText={pendingText} />
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="flex justify-center border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]">
        <div className={`w-full ${compact ? '' : 'max-w-[880px]'}`}>
          <MessageInput
            disabled={!ready}
            streaming={streaming}
            onSubmit={send}
            onStop={stop}
          />
        </div>
      </div>
    </div>
  );
}

function EmptyChatHero({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex flex-1 flex-col items-center justify-center gap-3 text-center ${compact ? 'px-3' : 'px-6 gap-4'}`}>
      <div className={`rounded-full border border-indigo-500/30 bg-indigo-500/10 ${compact ? 'p-2.5' : 'p-4'}`}>
        <Bot className={`${compact ? 'h-6 w-6' : 'h-10 w-10'} text-indigo-300`} />
      </div>
      <h2 className={`${compact ? 'text-sm' : 'text-lg'} font-semibold text-[var(--color-fg)]`}>
        Start a conversation
      </h2>
      <p className={`${compact ? 'text-[11px]' : 'max-w-md text-sm'} text-[var(--color-fg-subtle)]`}>
        The model can read & write files in the open project.
        {!compact ? ' Liara is free — no key needed.' : ''}
      </p>
      <div className={`mt-2 grid ${compact ? 'grid-cols-1' : 'grid-cols-2'} gap-2 text-left`}>
        {[
          'Explain this codebase to me',
          'Find dead code and unused exports',
          'Add a test for the active file',
          'Refactor this function to be pure',
        ].map((s) => (
          <div
            key={s}
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2 text-[11px] text-[var(--color-fg-muted)]"
          >
            <Sparkles className="mr-1 inline h-3 w-3 text-indigo-400" />
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

function labelModel(model: string): string {
  if (model.includes('qwen3')) return 'Qwen3-32B';
  return model.split('/').pop() ?? model;
}

function StreamingBar({ status }: { status: ChatStatus }) {
  const label = (() => {
    if (status.phase === 'thinking') return 'Thinking…';
    if (status.phase === 'streaming-text') return 'Writing reply…';
    if (status.phase === 'running-tool')
      return `Running ${status.name} · round ${status.round}`;
    return 'Generating…';
  })();
  const tint =
    status.phase === 'running-tool' ? 'amber' : 'indigo';
  const dotBg = tint === 'amber' ? 'bg-amber-400' : 'bg-indigo-400';
  const barFromTo = tint === 'amber' ? 'via-amber-400' : 'via-indigo-400';

  return (
    <div className="relative border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]">
      <div className="flex items-center justify-center gap-2 px-4 py-1.5 text-[11px] text-[var(--color-fg-subtle)]">
        <span className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 animate-bounce rounded-full ${dotBg} [animation-delay:-0.3s]`} />
          <span className={`h-1.5 w-1.5 animate-bounce rounded-full ${dotBg} [animation-delay:-0.15s]`} />
          <span className={`h-1.5 w-1.5 animate-bounce rounded-full ${dotBg}`} />
        </span>
        <span className="font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
        <div
          className={`h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent ${barFromTo} to-transparent`}
        />
      </div>
    </div>
  );
}
