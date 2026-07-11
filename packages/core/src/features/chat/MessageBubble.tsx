import { Bot, User } from 'lucide-react';
import type { ChatMessage } from '../../lib/ai/types';
import { InlineDiff, tryParseDiffBlock } from './InlineDiff';
import { ToolCallView } from './ToolCallView';

/// Extract fenced ```diff ... ``` blocks from a tool_result body and return
/// { plain, diffBlocks } so the renderer can show the prose line above the
/// rich diff viewer.
function splitDiff(content: string): { plain: string; diffs: string[] } {
  const diffs: string[] = [];
  const plain = content.replace(/```diff\n([\s\S]*?)\n```/g, (_m, body: string) => {
    diffs.push(body);
    return '';
  });
  return { plain: plain.trim(), diffs };
}

/// Render a single chat message: text blocks, tool_use blocks (collapsible),
/// tool_result blocks (folded). Streaming text is rendered by MessageList
/// via the `streamingText` prop append.
export function MessageBubble({ message, streamingText }: { message: ChatMessage; streamingText?: string }) {
  const isUser = message.role === 'user';
  const onlyToolResults = message.content.every((b) => b.type === 'tool_result');

  if (onlyToolResults) {
    return (
      <div className="my-2 px-3">
        {message.content.map((b, i) => {
          if (b.type !== 'tool_result') return null;
          const { plain, diffs } = splitDiff(b.content);
          return (
            <div
              key={i}
              className={`rounded-md border px-2 py-1.5 text-[10px] ${
                b.is_error
                  ? 'border-red-500/30 bg-red-500/5 text-red-300'
                  : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200'
              }`}
            >
              <div className="font-mono text-neutral-500">
                {b.is_error ? 'tool_error' : 'tool_result'}
              </div>
              {plain ? (
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono">
                  {plain.slice(0, 600)}
                  {plain.length > 600 ? ` … (+${plain.length - 600} chars)` : ''}
                </pre>
              ) : null}
              {diffs.map((body, j) => {
                const parsed = tryParseDiffBlock(body);
                if (!parsed) {
                  return (
                    <pre
                      key={j}
                      className="mt-1 whitespace-pre-wrap break-words font-mono"
                    >
                      {body}
                    </pre>
                  );
                }
                return <InlineDiff key={j} lines={parsed} />;
              })}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`my-3 flex gap-2 px-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-neutral-800 text-neutral-400">
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5 text-indigo-400" />}
      </div>
      <div className={`min-w-0 flex-1 ${isUser ? 'text-right' : ''}`}>
        {message.content.map((b, i) => {
          if (b.type === 'text') {
            return (
              <div
                key={i}
                className="whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-200"
              >
                {b.text}
              </div>
            );
          }
          if (b.type === 'tool_use') {
            return <ToolCallView key={i} call={b} />;
          }
          if (b.type === 'image') {
            const src = `data:${b.source.media_type};base64,${b.source.data}`;
            return (
              <img
                key={i}
                src={src}
                alt="user attachment"
                className="my-1 max-h-64 rounded border border-neutral-700 object-contain"
              />
            );
          }
          return null;
        })}
        {message.streaming && streamingText ? (
          <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-200">
            {streamingText}
            <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-neutral-400 align-middle" />
          </div>
        ) : null}
        {message.streaming && message.content.length === 0 && !streamingText ? (
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-accent)] [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-accent)] [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-accent)]" />
            </span>
            <span className="italic">Thinking…</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
