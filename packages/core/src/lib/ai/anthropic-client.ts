import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ContentBlock, ToolDefinition, ToolUseBlock } from './types';

/// Anthropic provider adapter.
///
/// Wraps the official SDK with streaming + tool calling. Runs in the Tauri
/// renderer (sandboxed WebView) with `dangerouslyAllowBrowser: true` —
/// acceptable here because (a) the user owns the API key and entered it
/// themselves, (b) Tauri's contextIsolation prevents third-party scripts
/// from reading the renderer process, (c) the key never leaves the desktop
/// app (no remote proxy).

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onToolUse: (block: ToolUseBlock) => void;
  onStop: (reason: string) => void;
  onError: (err: Error) => void;
  onUsage?: (usage: { input: number; output: number }) => void;
}

export class AnthropicProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }

  async stream(opts: {
    model: string;
    system?: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    signal?: AbortSignal;
    callbacks: StreamCallbacks;
  }): Promise<{ assistantBlocks: ContentBlock[]; stopReason: string }> {
    const { model, system, messages, tools, maxTokens = 8192, callbacks, signal } = opts;

    const stream = this.client.messages.stream({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
      messages: messages.map(toAnthropicMessage),
    });

    // SDK supports stream.abort() — wire it to the AbortSignal so the user's
    // Stop button cancels the in-flight request server-side, not just the UI.
    if (signal) {
      const onAbort = () => stream.abort();
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const blocks: ContentBlock[] = [];
    let stopReason = 'end_turn';

    try {
      stream.on('text', (delta) => callbacks.onText(delta));

      stream.on('contentBlock', (block) => {
        // contentBlock fires once per assistant block when it finalizes
        if (block.type === 'text') {
          blocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          const tu: ToolUseBlock = {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          };
          blocks.push(tu);
          callbacks.onToolUse(tu);
        }
      });

      const final = await stream.finalMessage();
      stopReason = final.stop_reason ?? 'end_turn';
      if (final.usage) {
        callbacks.onUsage?.({
          input: final.usage.input_tokens ?? 0,
          output: final.usage.output_tokens ?? 0,
        });
      }
      callbacks.onStop(stopReason);
    } catch (e) {
      callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      throw e;
    }

    return { assistantBlocks: blocks, stopReason };
  }
}

function toAnthropicMessage(m: ChatMessage): Anthropic.MessageParam {
  if (m.role === 'system') {
    // System content is passed separately at the top-level `system` param.
    throw new Error('System messages should be hoisted to top-level system param.');
  }
  return {
    role: m.role,
    content: m.content.map((c) => {
      if (c.type === 'text') return { type: 'text', text: c.text };
      if (c.type === 'image') {
        return { type: 'image', source: c.source };
      }
      if (c.type === 'tool_use') {
        return { type: 'tool_use', id: c.id, name: c.name, input: c.input };
      }
      // tool_result
      return {
        type: 'tool_result',
        tool_use_id: c.tool_use_id,
        content: c.content,
        ...(c.is_error ? { is_error: true } : {}),
      };
    }) as Anthropic.MessageParam['content'],
  };
}
