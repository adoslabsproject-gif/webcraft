import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { sidecarUrl } from '../ipc/sidecar';
import { useAppStore } from '../../store/app-store';
import type { ChatMessage, ContentBlock, ToolResultBlock } from './types';

/// Claude Code provider — the user's locally installed `claude` CLI as the
/// chat engine, streamed through the sidecar's /agent/run bridge.
///
/// Unlike API providers, Claude Code runs its OWN agentic loop with its OWN
/// tools (Read/Edit/Bash/…): WebCraft does not execute anything, it renders
/// what happens. Auth is the CLI's login (subscription or key) — no API key
/// stored in WebCraft, no per-token billing when logged in with Pro/Max.
///
/// Conversation continuity lives in Claude Code sessions: the session id
/// from the init event is remembered per project and passed back as
/// --resume, so only the LAST user message is sent as the prompt.

interface StreamCallbacks {
  onText: (delta: string) => void;
  onToolUse?: (block: Extract<ContentBlock, { type: 'tool_use' }>) => void;
  onStop: (reason: string) => void;
  onError: (err: Error) => void;
  onUsage?: (usage: { input: number; output: number }) => void;
  onAssistantBlocks?: (blocks: ContentBlock[]) => void;
  onToolResults?: (results: ToolResultBlock[]) => void;
}

/// CC tool names whose success means the filesystem changed — used to
/// refresh the file tree while the agent works.
const FS_MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']);

/// session id per project root, so switching projects starts fresh while
/// staying in the same project resumes context.
const sessions = new Map<string, string>();

export function resetClaudeCodeSession(projectRoot: string | null): void {
  sessions.delete(projectRoot ?? '');
}

export async function claudeCodeAvailable(): Promise<{
  available: boolean;
  version?: string;
}> {
  try {
    const url = await sidecarUrl('/agent/available');
    const r = await tauriFetch(url);
    if (!r.ok) return { available: false };
    return (await r.json()) as { available: boolean; version?: string };
  } catch {
    return { available: false };
  }
}

function lastUserPrompt(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user') continue;
    const texts = m.content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text);
    if (texts.length > 0) return texts.join('\n\n');
  }
  return '';
}

/// Normalize a CC tool_result content (string | rich block array) to text.
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string' ? part : ((part as { text?: string }).text ?? ''),
      )
      .join('\n');
  }
  return JSON.stringify(content ?? '');
}

export class ClaudeCodeProvider {
  async stream(opts: {
    model: string;
    system?: string;
    messages: ChatMessage[];
    maxTokens?: number;
    signal?: AbortSignal;
    callbacks: StreamCallbacks;
  }): Promise<{ assistantBlocks: ContentBlock[]; stopReason: string; toolResults?: ToolResultBlock[] }> {
    const { messages, callbacks, signal } = opts;
    const projectRoot = useAppStore.getState().projectRoot;
    const sessionKey = projectRoot ?? '';
    const settings = (await import('../../store/settings-store')).useSettingsStore.getState();

    const prompt = lastUserPrompt(messages);
    if (!prompt) {
      const e = new Error('Empty prompt');
      callbacks.onError(e);
      throw e;
    }

    let url: string;
    try {
      url = await sidecarUrl('/agent/run');
    } catch {
      const e = new Error(
        'Sidecar not running — Claude Code bridge unavailable. Restart WebCraft.',
      );
      callbacks.onError(e);
      throw e;
    }

    let res: Response;
    try {
      res = await tauriFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          cwd: projectRoot ?? undefined,
          sessionId: sessions.get(sessionKey),
          model: opts.model,
          permissionMode: settings.claudeCodePermissionMode,
          appendSystemPrompt: opts.system,
        }),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      const wrapped =
        signal?.aborted === true
          ? new Error('Stream aborted by user')
          : new Error(`Claude Code bridge error: ${e instanceof Error ? e.message : String(e)}`);
      callbacks.onError(wrapped);
      throw wrapped;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      let detail = text.slice(0, 300);
      try {
        detail = (JSON.parse(text) as { error?: string }).error ?? detail;
      } catch {
        /* keep raw */
      }
      const e = new Error(detail || `Claude Code bridge HTTP ${res.status}`);
      callbacks.onError(e);
      throw e;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const assistantBlocks: ContentBlock[] = [];
    const toolResults: ToolResultBlock[] = [];
    let stopReason = 'end_turn';
    let runError: string | null = null;

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return; // non-JSON noise
      }
      const type = event.type as string;

      if (type === 'system' && (event as { subtype?: string }).subtype === 'init') {
        const sid = (event as { session_id?: string }).session_id;
        if (sid) sessions.set(sessionKey, sid);
        return;
      }

      if (type === 'stream_event') {
        const delta = (event as { event?: { delta?: { type?: string; text?: string } } }).event
          ?.delta;
        if (delta?.type === 'text_delta' && delta.text) callbacks.onText(delta.text);
        return;
      }

      if (type === 'assistant') {
        const content = (event as { message?: { content?: unknown[] } }).message?.content ?? [];
        const turnBlocks: ContentBlock[] = [];
        for (const raw of content) {
          const block = raw as { type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
          if (block.type === 'text' && block.text) {
            turnBlocks.push({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use' && block.id && block.name) {
            const tu = {
              type: 'tool_use' as const,
              id: block.id,
              name: block.name,
              input: block.input ?? {},
            };
            turnBlocks.push(tu);
            callbacks.onToolUse?.(tu);
          }
        }
        if (turnBlocks.length > 0) {
          assistantBlocks.push(...turnBlocks);
          callbacks.onAssistantBlocks?.(turnBlocks);
        }
        return;
      }

      if (type === 'user') {
        const content = (event as { message?: { content?: unknown[] } }).message?.content ?? [];
        const turnResults: ToolResultBlock[] = [];
        for (const raw of content) {
          const block = raw as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
          if (block.type === 'tool_result' && block.tool_use_id) {
            turnResults.push({
              type: 'tool_result',
              tool_use_id: block.tool_use_id,
              content: resultText(block.content),
              ...(block.is_error ? { is_error: true } : {}),
            });
            // A completed mutating tool likely changed files on disk —
            // refresh the Explorer so the user SEES the agent working.
            const matching = assistantBlocks.find(
              (b) => b.type === 'tool_use' && b.id === block.tool_use_id,
            );
            if (
              matching &&
              matching.type === 'tool_use' &&
              FS_MUTATING_TOOLS.has(matching.name)
            ) {
              useAppStore.getState().notifyFsChange();
            }
          }
        }
        if (turnResults.length > 0) {
          toolResults.push(...turnResults);
          callbacks.onToolResults?.(turnResults);
        }
        return;
      }

      if (type === 'result') {
        const r = event as {
          subtype?: string;
          result?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        if (r.usage) {
          callbacks.onUsage?.({
            input: r.usage.input_tokens ?? 0,
            output: r.usage.output_tokens ?? 0,
          });
        }
        if (r.subtype && r.subtype !== 'success') {
          runError = r.result || `Claude Code run ended: ${r.subtype}`;
        }
        return;
      }

      if (type === 'sidecar_error') {
        runError = String((event as { message?: string }).message ?? 'sidecar error');
      }
    };

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel().catch(() => {});
          throw new Error('Stream aborted by user');
        }
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) handleLine(line);
      }
      if (buf.trim()) handleLine(buf);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      callbacks.onError(err);
      throw err;
    }

    if (runError) {
      const e = new Error(runError);
      callbacks.onError(e);
      throw e;
    }

    if (assistantBlocks.length === 0) {
      assistantBlocks.push({ type: 'text', text: '(no output)' });
    }
    callbacks.onStop(stopReason);
    return { assistantBlocks, stopReason, toolResults };
  }
}
