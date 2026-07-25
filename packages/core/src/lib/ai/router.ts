import { AnthropicProvider } from './anthropic-client';
import { OpenAiCompatProvider } from './openai-compat-client';
import type { ChatMessage, ContentBlock, ToolDefinition } from './types';
import type { Provider as ProviderId } from '../../store/settings-store';

/// Provider dispatcher — keeps the call surface identical regardless of
/// backend. use-chat.ts depends only on `createProvider` + the common
/// `stream()` shape.
///
/// Anthropic speaks its native Messages API; every other provider (OpenAI,
/// OpenRouter, DeepSeek, Grok, Gemini) goes through the shared
/// OpenAI-compatible client, which bridges OpenAI function calls into
/// Anthropic-shaped ContentBlocks so the chat loop is provider-agnostic.

export interface ProviderStreamCallbacks {
  onText: (delta: string) => void;
  onToolUse?: (block: Extract<ContentBlock, { type: 'tool_use' }>) => void;
  onStop: (reason: string) => void;
  onError: (err: Error) => void;
  /// Reports token usage when the provider knows it (end of stream).
  onUsage?: (usage: { input: number; output: number }) => void;
}

export interface LlmProvider {
  stream(opts: {
    model: string;
    system?: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    /// Optional AbortSignal — when fired the provider must cancel the
    /// HTTP request and reject. use-chat passes this so the user's "Stop"
    /// button can interrupt a long streaming response immediately.
    signal?: AbortSignal;
    callbacks: ProviderStreamCallbacks;
  }): Promise<{ assistantBlocks: ContentBlock[]; stopReason: string }>;
}

export interface CreateProviderInput {
  provider: ProviderId;
  apiKey: string;
}

const OPENAI_COMPAT_ENDPOINTS: Record<
  Exclude<ProviderId, 'anthropic'>,
  { endpoint: string; label: string; extraHeaders?: Record<string, string> }
> = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    label: 'OpenAI',
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    label: 'OpenRouter',
    extraHeaders: { 'X-Title': 'WebCraft IDE' },
  },
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    label: 'DeepSeek',
  },
  grok: {
    endpoint: 'https://api.x.ai/v1/chat/completions',
    label: 'Grok (x.ai)',
  },
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    label: 'Gemini',
  },
};

export function createProvider({ provider, apiKey }: CreateProviderInput): LlmProvider | null {
  if (!apiKey) return null;
  if (provider === 'anthropic') return new AnthropicProvider(apiKey);
  const compat = OPENAI_COMPAT_ENDPOINTS[provider];
  if (!compat) return null;
  return new OpenAiCompatProvider({ ...compat, apiKey });
}

/// Every wired provider supports native function calling (OpenAI-compat
/// providers via `tools`/`tool_choice`, Anthropic via `tool_use`).
export function providerSupportsTools(_provider: ProviderId): boolean {
  return true;
}
