/// AI chat types — message shape + tool definitions.
///
/// We keep the message format provider-agnostic and translate at the
/// adapter boundary (anthropic-client.ts converts to/from
/// `Anthropic.MessageParam`).

export type Role = 'user' | 'assistant' | 'system';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/// Image attachment — Anthropic-shaped (base64). Provider adapters convert
/// to OpenAI `image_url` for Liara/NHA. The vision-capable sidecar on the
/// server side picks up `image` blocks and routes them through a VL model
/// (Qwen2.5-VL) before handing the conversation back to the chat LLM.
export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

export interface ChatMessage {
  id: string;
  role: Role;
  content: ContentBlock[];
  createdAt: number;
  streaming?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}
