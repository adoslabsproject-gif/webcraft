import { AnthropicProvider } from './anthropic-client';
import { NhaProvider } from './nha-client';
import type { ChatMessage, ContentBlock, ToolDefinition } from './types';
import type { Provider as ProviderId } from '../../store/settings-store';

/// Provider dispatcher — keeps the call surface identical regardless of
/// backend (NHA free / Anthropic / OpenAI / OpenRouter). use-chat.ts depends
/// only on `createProvider` + the common `stream()` shape.
///
/// Tool calling is supported natively by both Anthropic AND NHA Free (Liara).
/// Qwen3-32B emits OpenAI-format function calls; NhaProvider bridges those
/// into Anthropic-shaped ContentBlocks so the chat loop is provider-agnostic.

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

export function createProvider({ provider, apiKey }: CreateProviderInput): LlmProvider | null {
  if (provider === 'nha') return new NhaProvider();
  if (provider === 'anthropic') {
    if (!apiKey) return null;
    return new AnthropicProvider(apiKey);
  }
  return null;
}

export function providerSupportsTools(provider: ProviderId): boolean {
  return provider === 'anthropic' || provider === 'nha';
}
