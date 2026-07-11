import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { ChatMessage, ContentBlock, ToolDefinition } from './types';

/// NHA Free (Liara) — free LLM tier hosted at nothumanallowed.com.
/// Backed by Qwen3 32B + Liara LoRA. No API key required.
///
/// Qwen3 supports native OpenAI-format function calling. We bridge:
///   Anthropic-shaped ToolDefinition  → OpenAI `tools` array
///   OpenAI delta.tool_calls (stream) → Anthropic-shaped ContentBlock[]
///
/// Result: the chat loop in `use-chat.ts` treats Liara IDENTICALLY to Anthropic
/// for tool dispatch — write_file / edit_file / run_command / etc. all work
/// against the free tier with no API key.

interface StreamCallbacks {
  onText: (delta: string) => void;
  onToolUse?: (block: Extract<ContentBlock, { type: 'tool_use' }>) => void;
  onStop: (reason: string) => void;
  onError: (err: Error) => void;
  onUsage?: (usage: { input: number; output: number }) => void;
}

const ENDPOINT = 'https://nothumanallowed.com/api/v1/liara/chat';

/// Streaming tool-call accumulator. OpenAI streams a tool call across many
/// `delta.tool_calls` events — first event carries id+name, subsequent ones
/// append argument fragments. We collect them by index and emit a single
/// `tool_use` block when the call is complete.
interface PendingCall {
  id: string;
  name: string;
  argsBuffer: string;
}

export class NhaProvider {
  async stream(opts: {
    model: string;
    system?: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    signal?: AbortSignal;
    callbacks: StreamCallbacks;
  }): Promise<{ assistantBlocks: ContentBlock[]; stopReason: string }> {
    const { system, messages, maxTokens = 8192, callbacks, tools, signal } = opts;

    const body: Record<string, unknown> = {
      model: opts.model || '/opt/models/qwen3-32b',
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        ...messages.flatMap((m) => toOpenAiMessages(m)),
      ],
      stream: true,
      temperature: 0.7,
    };
    if (tools && tools.length > 0) {
      body.tools = tools.map(toOpenAiTool);
      body.tool_choice = 'auto';
    }

    let res: Response;
    try {
      res = await tauriFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (signal?.aborted) {
        const aborted = new Error('Stream aborted by user');
        callbacks.onError(aborted);
        throw aborted;
      }
      const wrapped = new Error(`Network error reaching Liara: ${msg}`);
      callbacks.onError(wrapped);
      throw wrapped;
    }

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      const e = new Error(`Liara HTTP ${res.status}: ${errText.slice(0, 200)}`);
      callbacks.onError(e);
      throw e;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let collectedText = '';
    let stopReason = 'end_turn';
    const pending: Map<number, PendingCall> = new Map();
    let usageInput = 0;
    let usageOutput = 0;

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel().catch(() => {});
          throw new Error('Stream aborted by user');
        }
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const block of events) {
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              if (stopReason === 'end_turn' && pending.size > 0) stopReason = 'tool_use';
              continue;
            }
            try {
              const json = JSON.parse(payload) as {
                choices?: {
                  delta?: {
                    content?: string;
                    tool_calls?: Array<{
                      index: number;
                      id?: string;
                      type?: string;
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                  finish_reason?: string | null;
                }[];
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              if (json.usage) {
                if (typeof json.usage.prompt_tokens === 'number') usageInput = json.usage.prompt_tokens;
                if (typeof json.usage.completion_tokens === 'number')
                  usageOutput = json.usage.completion_tokens;
              }
              const choice = json.choices?.[0];
              const delta = choice?.delta?.content ?? '';
              if (delta) {
                collectedText += delta;
                callbacks.onText(delta);
              }
              // Accumulate streaming tool_calls
              for (const tc of choice?.delta?.tool_calls ?? []) {
                const idx = tc.index;
                let p = pending.get(idx);
                if (!p) {
                  p = { id: tc.id ?? `call_${idx}`, name: tc.function?.name ?? '', argsBuffer: '' };
                  pending.set(idx, p);
                }
                if (tc.id && !p.id) p.id = tc.id;
                if (tc.function?.name && !p.name) p.name = tc.function.name;
                if (tc.function?.arguments) p.argsBuffer += tc.function.arguments;
              }
              if (choice?.finish_reason) {
                stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason;
              }
            } catch {
              /* skip heartbeats / non-JSON lines */
            }
          }
        }
      }
    } catch (e) {
      callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      throw e;
    }

    // Build the final assistantBlocks. Strip <think>…</think> reasoning
    // (Liara LoRA emits internal monologue we don't want surfaced).
    const cleanText = collectedText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const assistantBlocks: ContentBlock[] = [];
    if (cleanText) assistantBlocks.push({ type: 'text', text: cleanText });
    for (const p of pending.values()) {
      if (!p.name) continue;
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = p.argsBuffer ? (JSON.parse(p.argsBuffer) as Record<string, unknown>) : {};
      } catch {
        // Some models emit trailing-comma or near-JSON — best effort: try a
        // tolerant repair before giving up entirely.
        try {
          parsedInput = JSON.parse(p.argsBuffer.replace(/,\s*([}\]])/g, '$1')) as Record<
            string,
            unknown
          >;
        } catch {
          parsedInput = { __raw: p.argsBuffer };
        }
      }
      const block = { type: 'tool_use' as const, id: p.id, name: p.name, input: parsedInput };
      assistantBlocks.push(block);
      callbacks.onToolUse?.(block);
    }

    if (pending.size > 0 && stopReason !== 'tool_use') stopReason = 'tool_use';
    if (usageInput > 0 || usageOutput > 0) {
      callbacks.onUsage?.({ input: usageInput, output: usageOutput });
    }
    callbacks.onStop(stopReason);
    return { assistantBlocks, stopReason };
  }
}

function toOpenAiTool(t: ToolDefinition): {
  type: 'function';
  function: { name: string; description: string; parameters: ToolDefinition['input_schema'] };
} {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  };
}

/// OpenAI vision content shape — text + image_url parts in an array.
type OpenAiUserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function toOpenAiMessages(
  m: ChatMessage,
): Array<
  | { role: 'user' | 'system'; content: string | OpenAiUserContentPart[] }
  | { role: 'assistant'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string }
> {
  if (m.role === 'user') {
    const parts: OpenAiUserContentPart[] = [];
    const toolResults: Array<{ role: 'tool'; tool_call_id: string; content: string }> = [];
    let hasImage = false;
    for (const block of m.content) {
      if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        hasImage = true;
        const dataUrl = `data:${block.source.media_type};base64,${block.source.data}`;
        parts.push({ type: 'image_url', image_url: { url: dataUrl } });
      } else if (block.type === 'tool_result') {
        toolResults.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content });
      }
    }
    const out: ReturnType<typeof toOpenAiMessages> = [];
    // Tool results MUST come before the next user turn (OpenAI ordering).
    out.push(...toolResults);
    if (parts.length > 0) {
      // If text-only, send as plain string (smaller wire format, broader
      // server compat). If image present, send as multimodal array.
      const content: string | OpenAiUserContentPart[] = hasImage
        ? parts
        : parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text).join('\n\n');
      out.push({ role: 'user', content });
    }
    return out;
  }
  if (m.role === 'assistant') {
    const textParts: string[] = [];
    const toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }> = [];
    for (const block of m.content) {
      if (block.type === 'text') textParts.push(block.text);
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input) },
        });
      }
    }
    if (toolCalls.length > 0) {
      return [
        {
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('\n\n') : null,
          tool_calls: toolCalls,
        },
      ];
    }
    return [{ role: 'assistant', content: textParts.join('\n\n') }];
  }
  return [];
}
