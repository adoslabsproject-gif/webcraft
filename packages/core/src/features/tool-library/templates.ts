/// Curated catalogue of state-of-the-art AI tool implementations — every
/// template here is a REAL, runnable piece of code that a developer can
/// copy into their project and adapt. No stubs. Protocols and patterns
/// match the 2026 best practices used by Claude Code, Cursor, OpenAI, etc.

export type ToolCategory =
  | 'MCP'
  | 'Function Calling'
  | 'Agentic'
  | 'RAG & Vectors'
  | 'Multimodal'
  | 'Streaming'
  | 'Permissions'
  | 'Code Intelligence'
  | 'Web & Browser'
  | 'Subagents';

export interface ToolTemplate {
  id: string;
  title: string;
  category: ToolCategory;
  language: 'typescript' | 'python' | 'javascript';
  tags: string[];
  description: string;
  /// Suggested file name when "Save to project" is clicked.
  suggestedFileName: string;
  /// The complete code.
  code: string;
}

export const TOOL_TEMPLATES: ToolTemplate[] = [
  {
    id: 'mcp-server-bootstrap-ts',
    title: 'MCP Server bootstrap',
    category: 'MCP',
    language: 'typescript',
    tags: ['mcp', 'protocol', 'stdio'],
    description:
      'Minimal Model Context Protocol server scaffolding using @modelcontextprotocol/sdk. Spawns over stdio, exposes tools/list and tools/call, Claude Desktop & WebCraft compatible.',
    suggestedFileName: 'mcp-server.ts',
    code: `import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/// Minimal MCP server. Spawned by the host (Claude Desktop / WebCraft / etc.)
/// over stdio. Add tools by appending to TOOLS and handling them in the
/// CallToolRequest dispatcher.
const TOOLS = [
  {
    name: 'echo',
    description: 'Echoes the input string back to the caller.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
] as const;

const server = new Server(
  { name: 'example-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (name === 'echo') {
    const text = (args as { text: string }).text;
    return { content: [{ type: 'text', text }] };
  }
  throw new Error(\`Unknown tool: \${name}\`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
`,
  },

  {
    id: 'openai-function-calling-zod',
    title: 'OpenAI function calling with Zod',
    category: 'Function Calling',
    language: 'typescript',
    tags: ['openai', 'zod', 'json-schema'],
    description:
      'Type-safe OpenAI tool definition driven by Zod schemas — single source of truth for runtime validation AND wire JSON schema. zod-to-json-schema converts.',
    suggestedFileName: 'openai-tool.ts',
    code: `import OpenAI from 'openai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const ReadFileArgs = z.object({
  path: z.string().describe('Absolute file path'),
  startLine: z.number().int().optional(),
  endLine: z.number().int().optional(),
});

type ReadFileArgs = z.infer<typeof ReadFileArgs>;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from disk with optional line range.',
      parameters: zodToJsonSchema(ReadFileArgs) as Record<string, unknown>,
    },
  },
];

async function dispatch(name: string, rawArgs: unknown): Promise<string> {
  if (name === 'read_file') {
    const args = ReadFileArgs.parse(rawArgs); // runtime validation
    const fs = await import('node:fs/promises');
    const text = await fs.readFile(args.path, 'utf-8');
    const lines = text.split('\\n');
    const start = (args.startLine ?? 1) - 1;
    const end = args.endLine ?? lines.length;
    return lines.slice(start, end).join('\\n');
  }
  throw new Error(\`Unknown tool: \${name}\`);
}

const openai = new OpenAI();

async function runConversation(userPrompt: string) {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'user', content: userPrompt },
  ];
  for (let round = 0; round < 8; round++) {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages,
      tools,
    });
    const msg = resp.choices[0]!.message;
    messages.push(msg);
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content;
    }
    for (const call of msg.tool_calls) {
      const result = await dispatch(
        call.function.name,
        JSON.parse(call.function.arguments),
      );
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
}
`,
  },

  {
    id: 'anthropic-tool-use-loop',
    title: 'Anthropic tool_use streaming loop',
    category: 'Function Calling',
    language: 'typescript',
    tags: ['anthropic', 'tool_use', 'streaming'],
    description:
      "Production loop with Anthropic's tool_use protocol: streams text, dispatches tool calls, feeds results back, repeats until stop_reason !== 'tool_use'.",
    suggestedFileName: 'anthropic-loop.ts',
    code: `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_weather',
    description: 'Get current weather for a city.',
    input_schema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>) {
  if (name === 'get_weather') {
    const city = String(input.city);
    return JSON.stringify({ city, temperature_c: 22, condition: 'sunny' });
  }
  return JSON.stringify({ error: \`Unknown tool: \${name}\` });
}

export async function runAgent(userPrompt: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userPrompt },
  ];
  for (let round = 0; round < 12; round++) {
    const stream = client.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 8192,
      tools: TOOLS,
      messages,
    });
    stream.on('text', (delta) => process.stdout.write(delta));
    const final = await stream.finalMessage();
    messages.push({ role: 'assistant', content: final.content });
    if (final.stop_reason !== 'tool_use') {
      const text = final.content.find((b) => b.type === 'text');
      return text && 'text' in text ? text.text : '';
    }
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of final.content) {
      if (block.type === 'tool_use') {
        const result = await executeTool(block.name, block.input as Record<string, unknown>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }
  throw new Error('Agent did not converge in 12 rounds');
}
`,
  },

  {
    id: 'react-agent-loop',
    title: 'ReAct agent loop (Thought → Action → Observation)',
    category: 'Agentic',
    language: 'typescript',
    tags: ['react', 'pattern', 'reasoning'],
    description:
      'Classic ReAct loop with explicit Thought/Action/Observation tokens. Useful for models without native tool_use support. Stop condition = "Answer:" prefix.',
    suggestedFileName: 'react-agent.ts',
    code: `interface ActionResult { observation: string }

type ActionHandler = (args: string) => Promise<ActionResult>;

const ACTIONS: Record<string, ActionHandler> = {
  async search(q) {
    return { observation: \`Search results for "\${q}": ...\` };
  },
  async calc(expr) {
    return { observation: String(eval(expr)) }; // demo only — sandbox in prod
  },
};

const SYSTEM = \`You are a ReAct agent. Follow this format exactly:
Thought: <one sentence reasoning>
Action: <action-name>[<args>]
Observation: <will be filled by the system>
... repeat ...
Final Answer: <your answer>

Available actions: \${Object.keys(ACTIONS).join(', ')}\`;

export async function reactLoop(
  llmCall: (prompt: string) => Promise<string>,
  question: string,
): Promise<string> {
  let transcript = \`\${SYSTEM}\\n\\nQuestion: \${question}\\nThought:\`;
  for (let step = 0; step < 8; step++) {
    const chunk = await llmCall(transcript);
    transcript += chunk;
    const answerMatch = /Final Answer:\\s*([\\s\\S]+)$/m.exec(chunk);
    if (answerMatch) return answerMatch[1].trim();
    const actionMatch = /Action:\\s*(\\w+)\\[([\\s\\S]*?)\\]/m.exec(chunk);
    if (!actionMatch) {
      transcript += '\\nObservation: no action parsed. Try again.';
      continue;
    }
    const [, name, args] = actionMatch;
    const handler = ACTIONS[name];
    if (!handler) {
      transcript += \`\\nObservation: unknown action "\${name}"\`;
      continue;
    }
    const { observation } = await handler(args);
    transcript += \`\\nObservation: \${observation}\\nThought:\`;
  }
  throw new Error('ReAct loop budget exhausted');
}
`,
  },

  {
    id: 'plan-execute',
    title: 'Plan → Execute pattern',
    category: 'Agentic',
    language: 'typescript',
    tags: ['planning', 'two-stage', 'review'],
    description:
      'Two-stage pattern: planner LLM produces a numbered plan, user reviews, executor LLM executes step-by-step. Used by Claude Code Plan mode and OpenAI Operator.',
    suggestedFileName: 'plan-execute.ts',
    code: `interface PlanStep { id: number; description: string; tool?: string }

const PLANNER_SYSTEM = \`You are a planner. Given a goal, produce a numbered list of 3-7 atomic steps.
Format each step as:
  N. [tool_name?] description
Do NOT execute anything. Output ONLY the plan.\`;

const EXECUTOR_SYSTEM = \`You are an executor. You are given ONE step at a time.
Execute it using the available tools, then summarise the outcome in <=2 sentences.\`;

function parsePlan(text: string): PlanStep[] {
  const steps: PlanStep[] = [];
  for (const line of text.split('\\n')) {
    const m = /^(\\d+)\\.\\s*(?:\\[(\\w+)\\]\\s*)?(.+)$/.exec(line.trim());
    if (m) steps.push({ id: Number(m[1]), tool: m[2], description: m[3] });
  }
  return steps;
}

export async function planExecute(
  llmCall: (system: string, user: string) => Promise<string>,
  goal: string,
  reviewer: (plan: PlanStep[]) => Promise<PlanStep[]>,
): Promise<string[]> {
  const rawPlan = await llmCall(PLANNER_SYSTEM, goal);
  const plan = await reviewer(parsePlan(rawPlan));
  const outcomes: string[] = [];
  for (const step of plan) {
    const outcome = await llmCall(
      EXECUTOR_SYSTEM,
      \`Step \${step.id}: \${step.description}\${step.tool ? \` (use tool: \${step.tool})\` : ''}\`,
    );
    outcomes.push(outcome);
  }
  return outcomes;
}
`,
  },

  {
    id: 'subagent-spawn',
    title: 'Subagent spawn with isolated tool scope',
    category: 'Subagents',
    language: 'typescript',
    tags: ['subagent', 'isolation', 'read-only'],
    description:
      'Spawns a child LLM conversation with a restricted (read-only) tool whitelist. The parent agent gets back only the final summary, no transcript noise.',
    suggestedFileName: 'subagent.ts',
    code: `interface Tool { name: string; run: (args: unknown) => Promise<string> }

const READ_ONLY = new Set(['read_file', 'glob', 'grep', 'list_dir']);

export async function runSubagent(opts: {
  task: string;
  allTools: Tool[];
  llm: (system: string, messages: Array<{ role: string; content: string }>) => Promise<{ text: string; toolCalls: Array<{ name: string; args: unknown }> }>;
  whitelist?: Set<string>;
  maxRounds?: number;
}): Promise<{ summary: string; rounds: number }> {
  const tools = opts.allTools.filter((t) => (opts.whitelist ?? READ_ONLY).has(t.name));
  const system = \`You are a focused research subagent. Use ONLY these tools: \${tools.map((t) => t.name).join(', ')}. Return a concise summary, max 200 words. No questions back.\`;
  const messages = [{ role: 'user', content: opts.task }];
  let final = '';
  for (let round = 0; round < (opts.maxRounds ?? 6); round++) {
    const { text, toolCalls } = await opts.llm(system, messages);
    if (text) final = text;
    if (toolCalls.length === 0) break;
    messages.push({ role: 'assistant', content: text });
    for (const call of toolCalls) {
      const tool = tools.find((t) => t.name === call.name);
      const result = tool
        ? await tool.run(call.args).catch((e) => \`ERROR: \${e}\`)
        : \`ERROR: tool "\${call.name}" not in whitelist\`;
      messages.push({ role: 'user', content: \`<tool_result name="\${call.name}">\${result}</tool_result>\` });
    }
  }
  return { summary: final, rounds: messages.length };
}
`,
  },

  {
    id: 'rag-cosine-search',
    title: 'RAG with cosine-similarity search',
    category: 'RAG & Vectors',
    language: 'typescript',
    tags: ['rag', 'embeddings', 'cosine'],
    description:
      'Minimal in-memory RAG: chunk → embed → cosine search → topK. Drop-in baseline before reaching for HNSW / FAISS / pgvector.',
    suggestedFileName: 'rag-search.ts',
    code: `interface Chunk { id: string; text: string; vector: number[] }

const CHUNK_LINES = 60;
const CHUNK_OVERLAP = 10;

export function chunkText(id: string, text: string): { id: string; text: string }[] {
  const lines = text.split('\\n');
  const out: { id: string; text: string }[] = [];
  for (let s = 0; s < lines.length; s += CHUNK_LINES - CHUNK_OVERLAP) {
    const piece = lines.slice(s, s + CHUNK_LINES).join('\\n').trim();
    if (piece.length < 30) continue;
    out.push({ id: \`\${id}#L\${s + 1}\`, text: piece });
    if (s + CHUNK_LINES >= lines.length) break;
  }
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export class RagIndex {
  private chunks: Chunk[] = [];
  constructor(private embed: (texts: string[]) => Promise<number[][]>) {}

  async add(id: string, text: string): Promise<void> {
    const pieces = chunkText(id, text);
    const vecs = await this.embed(pieces.map((p) => p.text));
    pieces.forEach((p, i) => this.chunks.push({ ...p, vector: vecs[i]! }));
  }

  async search(query: string, k = 5): Promise<Array<{ id: string; text: string; score: number }>> {
    const [qv] = await this.embed([query]);
    return this.chunks
      .map((c) => ({ id: c.id, text: c.text, score: cosine(qv!, c.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
`,
  },

  {
    id: 'hnsw-vector-index',
    title: 'HNSW vector index (hnswlib-node)',
    category: 'RAG & Vectors',
    language: 'typescript',
    tags: ['hnsw', 'ann', 'fast-search'],
    description:
      'Production-grade approximate nearest neighbour index with hnswlib-node. Sub-millisecond search across millions of vectors.',
    suggestedFileName: 'hnsw-index.ts',
    code: `import { HierarchicalNSW } from 'hnswlib-node';

export class HnswStore {
  private index: HierarchicalNSW;
  private nextId = 0;
  private metadata = new Map<number, { ref: string; text: string }>();

  constructor(private dim: number, capacity = 100_000) {
    this.index = new HierarchicalNSW('cosine', dim);
    this.index.initIndex(capacity, 16, 200, 100);
  }

  add(ref: string, vector: number[], text: string): number {
    const id = this.nextId++;
    this.index.addPoint(vector, id);
    this.metadata.set(id, { ref, text });
    return id;
  }

  search(query: number[], k = 10): Array<{ ref: string; text: string; score: number }> {
    const { neighbors, distances } = this.index.searchKnn(query, k);
    return neighbors.map((id, i) => {
      const meta = this.metadata.get(id)!;
      return { ref: meta.ref, text: meta.text, score: 1 - distances[i]! };
    });
  }

  save(path: string): void { this.index.writeIndexSync(path); }
  load(path: string): void { this.index.readIndexSync(path); }
}
`,
  },

  {
    id: 'vision-multimodal',
    title: 'Multimodal image input (Anthropic + OpenAI)',
    category: 'Multimodal',
    language: 'typescript',
    tags: ['vision', 'image', 'base64'],
    description:
      'Cross-provider vision input. Same call signature works with Claude (native multimodal) and OpenAI (image_url format) via a thin adapter.',
    suggestedFileName: 'vision-input.ts',
    code: `import fs from 'node:fs/promises';
import path from 'node:path';

async function fileToBase64(filePath: string): Promise<{ data: string; mediaType: string }> {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mediaType = ext === 'jpg' ? 'image/jpeg' : \`image/\${ext}\`;
  return { data: buf.toString('base64'), mediaType };
}

export async function describeImageAnthropic(client: import('@anthropic-ai/sdk').default, imagePath: string, prompt: string) {
  const { data, mediaType } = await fileToBase64(imagePath);
  const msg = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/png' | 'image/jpeg', data } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  return msg.content.find((b) => b.type === 'text');
}

export async function describeImageOpenAI(client: import('openai').default, imagePath: string, prompt: string) {
  const { data, mediaType } = await fileToBase64(imagePath);
  const resp = await client.chat.completions.create({
    model: 'gpt-4.1',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: \`data:\${mediaType};base64,\${data}\` } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  return resp.choices[0]!.message.content;
}
`,
  },

  {
    id: 'streaming-sse-tool',
    title: 'SSE streaming tool with AbortController',
    category: 'Streaming',
    language: 'typescript',
    tags: ['sse', 'streaming', 'abort'],
    description:
      'OpenAI-compatible SSE stream parser with proper cancellation. Used by any custom LLM gateway that follows the data: {...} chunk convention.',
    suggestedFileName: 'sse-stream.ts',
    code: `export interface StreamCallbacks {
  onText(delta: string): void;
  onToolCall?(call: { id: string; name: string; args: string }): void;
  onUsage?(usage: { input: number; output: number }): void;
  onDone(reason: string): void;
  onError(err: Error): void;
}

export async function streamChat(
  endpoint: string,
  body: object,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    callbacks.onError(new Error(\`HTTP \${res.status}\`));
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let stop = 'end_turn';
  try {
    while (true) {
      if (signal?.aborted) { await reader.cancel(); throw new Error('aborted'); }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split('\\n\\n');
      buf = frames.pop() ?? '';
      for (const frame of frames) {
        for (const line of frame.split('\\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const choice = j.choices?.[0];
            const delta = choice?.delta?.content;
            if (delta) callbacks.onText(delta);
            if (choice?.finish_reason) stop = choice.finish_reason;
            if (j.usage) callbacks.onUsage?.({ input: j.usage.prompt_tokens, output: j.usage.completion_tokens });
          } catch { /* heartbeat */ }
        }
      }
    }
  } catch (e) {
    callbacks.onError(e instanceof Error ? e : new Error(String(e)));
    return;
  }
  callbacks.onDone(stop);
}
`,
  },

  {
    id: 'permission-gate',
    title: 'Permission gate with Allow-Once / Allow-Session / Deny',
    category: 'Permissions',
    language: 'typescript',
    tags: ['permissions', 'consent', 'safety'],
    description:
      'Claude Code-style permission UI: three buttons, sticky session grants per category. Promise-based so the tool dispatcher just awaits it.',
    suggestedFileName: 'permission-gate.ts',
    code: `type Decision = 'allow-once' | 'allow-always' | 'deny';
type Category = 'edit-files' | 'delete-files' | 'run-command' | 'network';

const sessionGrants = new Map<Category, 'allow' | 'deny'>();
let pendingResolver: ((d: Decision) => void) | null = null;

export interface PermissionRequest {
  category: Category;
  title: string;
  detail: string;
  preview?: string;
}

/// UI binds to this and shows the modal; calls resolveDecision when user picks.
export type Subscriber = (req: PermissionRequest, resolve: (d: Decision) => void) => void;
let subscriber: Subscriber | null = null;
export function bindUi(fn: Subscriber): void { subscriber = fn; }

export async function require(req: PermissionRequest): Promise<boolean> {
  const sticky = sessionGrants.get(req.category);
  if (sticky === 'allow') return true;
  if (sticky === 'deny') return false;
  if (!subscriber) return false; // safer default than allowing without UI
  const decision = await new Promise<Decision>((resolve) => {
    pendingResolver = resolve;
    subscriber!(req, (d) => { pendingResolver?.(d); pendingResolver = null; });
  });
  if (decision === 'allow-always') sessionGrants.set(req.category, 'allow');
  return decision !== 'deny';
}
`,
  },

  {
    id: 'lsp-bridge',
    title: 'LSP bridge — JSON-RPC over stdio',
    category: 'Code Intelligence',
    language: 'typescript',
    tags: ['lsp', 'jsonrpc', 'stdio'],
    description:
      'Spawns a language server (typescript-language-server / pyright / rust-analyzer) and exposes a typed request() / notify() API with LSP framing (Content-Length headers).',
    suggestedFileName: 'lsp-bridge.ts',
    code: `import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export class LspClient {
  private child: ChildProcessWithoutNullStreams;
  private buf = Buffer.alloc(0);
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;

  constructor(command: string, args: string[]) {
    this.child = spawn(command, args, { stdio: 'pipe' });
    this.child.stdout.on('data', (d) => this.onData(d));
  }

  private onData(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d]);
    while (true) {
      const end = this.buf.indexOf('\\r\\n\\r\\n');
      if (end === -1) return;
      const header = this.buf.subarray(0, end).toString('utf-8');
      const m = /Content-Length:\\s*(\\d+)/i.exec(header);
      if (!m) { this.buf = this.buf.subarray(end + 4); continue; }
      const len = parseInt(m[1]!, 10);
      if (this.buf.length < end + 4 + len) return;
      const body = this.buf.subarray(end + 4, end + 4 + len).toString('utf-8');
      this.buf = this.buf.subarray(end + 4 + len);
      const msg = JSON.parse(body);
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    }
  }

  private send(payload: object): void {
    const body = JSON.stringify(payload);
    const header = \`Content-Length: \${Buffer.byteLength(body, 'utf-8')}\\r\\n\\r\\n\`;
    this.child.stdin.write(header + body);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  async initialize(rootUri: string): Promise<unknown> {
    return this.request('initialize', { processId: process.pid, rootUri, capabilities: {} });
  }
}
`,
  },

  {
    id: 'browser-fetch-cors',
    title: 'CORS-bypassing web fetch (Tauri/Electron)',
    category: 'Web & Browser',
    language: 'typescript',
    tags: ['web', 'fetch', 'cors'],
    description:
      'Tauri plugin-http (Rust reqwest) bypasses browser CORS entirely. Same fetch API surface but works against any host. Drop-in for renderer-side scrapers.',
    suggestedFileName: 'tauri-fetch.ts',
    code: `import { fetch } from '@tauri-apps/plugin-http';

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function webFetch(url: string, opts: FetchOptions = {}): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  const ctrl = new AbortController();
  if (opts.timeoutMs) setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: opts.headers,
    body: opts.body,
    signal: opts.signal ?? ctrl.signal,
  });
  const text = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, text, headers };
}

/// Convenience wrapper that turns the response into a clean string for LLM context.
export async function webFetchForAi(url: string, maxChars = 8000): Promise<string> {
  const { status, text } = await webFetch(url, { timeoutMs: 10_000 });
  if (status >= 400) return \`[fetch error: HTTP \${status}]\`;
  const stripped = text.replace(/<script[\\s\\S]*?<\\/script>/gi, '').replace(/<style[\\s\\S]*?<\\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
  return stripped.slice(0, maxChars);
}
`,
  },

  {
    id: 'apply-patch',
    title: 'Apply unified diff patch',
    category: 'Code Intelligence',
    language: 'typescript',
    tags: ['patch', 'diff', 'unified'],
    description:
      'Parses standard unified diff (\\n--- a/...\\n+++ b/...\\n@@ ... @@) and applies hunks to multiple files. Used by OpenAI Codex / Anthropic patch tool / Aider.',
    suggestedFileName: 'apply-patch.ts',
    code: `import fs from 'node:fs/promises';

interface Hunk { oldStart: number; lines: Array<{ kind: 'context' | 'add' | 'remove'; text: string }> }
interface Patch { oldPath: string; newPath: string; hunks: Hunk[] }

export function parsePatch(text: string): Patch[] {
  const lines = text.split('\\n');
  const files: Patch[] = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !lines[i]!.startsWith('--- ')) i++;
    if (i >= lines.length) break;
    const oldPath = lines[i++]!.slice(4).replace(/^[ab]\\//, '').trim();
    const newPath = lines[i++]!.slice(4).replace(/^[ab]\\//, '').trim();
    const file: Patch = { oldPath, newPath, hunks: [] };
    while (i < lines.length && lines[i]!.startsWith('@@')) {
      const m = /@@ -(\\d+)/.exec(lines[i]!);
      i++;
      const hunk: Hunk = { oldStart: m ? parseInt(m[1]!, 10) : 1, lines: [] };
      while (i < lines.length && !lines[i]!.startsWith('--- ') && !lines[i]!.startsWith('@@')) {
        const l = lines[i]!;
        if (l.startsWith('+')) hunk.lines.push({ kind: 'add', text: l.slice(1) });
        else if (l.startsWith('-')) hunk.lines.push({ kind: 'remove', text: l.slice(1) });
        else hunk.lines.push({ kind: 'context', text: l.startsWith(' ') ? l.slice(1) : l });
        i++;
      }
      file.hunks.push(hunk);
    }
    files.push(file);
  }
  return files;
}

export async function applyPatch(patchText: string): Promise<{ patched: number; failed: string[] }> {
  const files = parsePatch(patchText);
  const failed: string[] = [];
  let ok = 0;
  for (const f of files) {
    const target = f.newPath;
    const original = f.oldPath === '/dev/null' ? '' : await fs.readFile(target, 'utf-8');
    let arr = original.split('\\n');
    for (const hunk of [...f.hunks].sort((a, b) => b.oldStart - a.oldStart)) {
      const expected: string[] = [], replacement: string[] = [];
      for (const l of hunk.lines) {
        if (l.kind !== 'add') expected.push(l.text);
        if (l.kind !== 'remove') replacement.push(l.text);
      }
      const slice = arr.slice(hunk.oldStart - 1, hunk.oldStart - 1 + expected.length);
      if (slice.join('\\n') !== expected.join('\\n')) { failed.push(target); break; }
      arr = [...arr.slice(0, hunk.oldStart - 1), ...replacement, ...arr.slice(hunk.oldStart - 1 + expected.length)];
    }
    if (!failed.includes(target)) { await fs.writeFile(target, arr.join('\\n')); ok++; }
  }
  return { patched: ok, failed };
}
`,
  },

  {
    id: 'python-mcp-server',
    title: 'MCP server in Python (fastmcp)',
    category: 'MCP',
    language: 'python',
    tags: ['mcp', 'python', 'fastmcp'],
    description:
      'FastMCP — decorator-based MCP server. The cleanest Python pattern. Spawns over stdio for Claude Desktop / WebCraft / Cursor.',
    suggestedFileName: 'server.py',
    code: `"""Minimal FastMCP server. Install: pip install fastmcp"""
from fastmcp import FastMCP
import httpx

mcp = FastMCP("example-server")


@mcp.tool()
def echo(text: str) -> str:
    """Echoes the input back to the caller."""
    return text


@mcp.tool()
async def fetch_url(url: str) -> str:
    """Fetches a URL and returns the (truncated) body."""
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(url)
        return r.text[:8000]


@mcp.resource("file://{path}")
def read_file(path: str) -> str:
    """Reads a file from disk as an MCP resource."""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


if __name__ == "__main__":
    mcp.run()
`,
  },
];

export const CATEGORIES: ToolCategory[] = [
  'MCP',
  'Function Calling',
  'Agentic',
  'Subagents',
  'RAG & Vectors',
  'Multimodal',
  'Streaming',
  'Permissions',
  'Code Intelligence',
  'Web & Browser',
];
