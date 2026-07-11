import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../lib/ai/types';
import { MessageBubble } from './MessageBubble';

/// Scrollable chronological message list with auto-scroll-to-bottom on new
/// content. Receives streamingText for the currently-in-flight assistant
/// message so the bubble can render the live token stream.
export function MessageList({
  messages,
  streamingText,
}: {
  messages: ChatMessage[];
  streamingText: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [streamingText]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto py-2">
      {messages.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-neutral-500">
          Start a conversation. The model can read & write files in the open project.
        </div>
      ) : (
        messages.map((m, i) => {
          const isLastAssistant = m.role === 'assistant' && i === messages.length - 1 && m.streaming;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              {...(isLastAssistant ? { streamingText } : {})}
            />
          );
        })
      )}
    </div>
  );
}
