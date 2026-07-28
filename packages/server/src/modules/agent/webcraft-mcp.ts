/// WebCraft MCP server — exposes the IDE's own capabilities to Claude Code
/// as MCP tools (stdio transport, newline-delimited JSON-RPC). Spawned BY
/// the Claude Code CLI (via --mcp-config) with SIDECAR_PORT in the env;
/// every tool call proxies to the sidecar's HTTP API.
///
/// Deliberately dependency-free: the MCP handshake we need (initialize,
/// tools/list, tools/call) is ~100 lines of JSON-RPC.

import { createInterface } from 'node:readline';

const PORT = Number(process.env.SIDECAR_PORT ?? '0');

interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

const TOOLS: McpTool[] = [
  {
    name: 'db_query',
    description:
      "Run a query against one of WebCraft's DB Studio engines (sqlite/duckdb/libsql: SQL; redis: raw command; mongo: JSON op spec). Provide file for an existing db file or url for a server.",
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['sqlite', 'duckdb', 'libsql', 'redis', 'mongo'] },
        sql: { type: 'string', description: 'Query / command / JSON op spec.' },
        file: { type: 'string', description: 'Existing database file path (sqlite/duckdb).' },
        url: { type: 'string', description: 'Server URL (redis://…, mongodb://…, libsql://…).' },
      },
      required: ['kind', 'sql'],
    },
  },
  {
    name: 'db_tables',
    description: 'List tables/collections/keys of a DB Studio connection.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['sqlite', 'duckdb', 'libsql', 'redis', 'mongo'] },
        file: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'approval_prompt',
    description:
      'Internal: WebCraft permission dialog. Called automatically by Claude Code (--permission-prompt-tool) when a tool needs user approval — never call it yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'Tool requesting permission.' },
        input: { type: 'object', description: 'Input the tool will run with.' },
        tool_use_id: { type: 'string', description: 'Tool use id (optional).' },
      },
      required: ['tool_name', 'input'],
    },
  },
  {
    name: 'semantic_search',
    description:
      "Search the project's code semantically via WebCraft's local embedding index (TF-IDF fallback).",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        root: { type: 'string', description: 'Project root path.' },
        k: { type: 'number' },
      },
      required: ['query', 'root'],
    },
  },
];

async function sidecar(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`sidecar ${path} ${res.status}`);
  return res.json();
}

let connCounter = 0;

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'db_query' || name === 'db_tables') {
    const kind = String(args.kind ?? 'sqlite');
    const connectionId = `${kind}-mcp-${++connCounter}`;
    await sidecar('/db/register', {
      connectionId,
      kind,
      ...(args.file ? { file: String(args.file) } : {}),
      ...(args.url ? { url: String(args.url) } : {}),
    });
    if (name === 'db_query') {
      const result = await sidecar('/db/query', { connectionId, sql: String(args.sql ?? '') });
      return JSON.stringify(result, null, 2);
    }
    const result = await sidecar('/db/tables', { connectionId });
    return JSON.stringify(result, null, 2);
  }
  if (name === 'approval_prompt') {
    // Register the ask with the sidecar, then poll until the WebCraft UI
    // answers (or the broker auto-denies on timeout). The CLI expects the
    // decision JSON as the tool's text content.
    const { id } = (await sidecar('/agent/permission/ask', {
      toolName: String(args.tool_name ?? 'unknown'),
      input: args.input ?? {},
    })) as { id: string };
    while (true) {
      const { decision } = (await sidecar('/agent/permission/state', { id })) as {
        decision: { behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown } | null;
      };
      if (decision) {
        if (decision.behavior === 'allow') {
          return JSON.stringify({
            behavior: 'allow',
            updatedInput: decision.updatedInput ?? args.input ?? {},
          });
        }
        return JSON.stringify({
          behavior: 'deny',
          message: decision.message ?? 'Denied by the user in WebCraft.',
        });
      }
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  if (name === 'semantic_search') {
    await sidecar('/rag/index', { root: String(args.root ?? '') });
    const result = await sidecar('/rag/search', {
      query: String(args.query ?? ''),
      k: Number(args.k ?? 8),
    });
    return JSON.stringify(result, null, 2);
  }
  throw new Error(`unknown tool: ${name}`);
}

function reply(id: number | string | null, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function replyError(id: number | string | null, message: string): void {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } })}\n`,
  );
}

// The CLI owns our stdio: if it closes the pipe mid-write, exit quietly
// instead of crashing with EPIPE.
process.stdout.on('error', () => process.exit(0));
process.stdin.on('end', () => process.exit(0));

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  void (async () => {
    let msg: {
      id?: number | string;
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
    };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const id = msg.id ?? null;
    try {
      switch (msg.method) {
        case 'initialize':
          reply(id, {
            protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'webcraft', version: '0.1.0' },
          });
          break;
        case 'notifications/initialized':
          break; // notification — no response
        case 'tools/list':
          reply(id, { tools: TOOLS });
          break;
        case 'tools/call': {
          const text = await callTool(msg.params?.name ?? '', msg.params?.arguments ?? {});
          reply(id, { content: [{ type: 'text', text }] });
          break;
        }
        case 'ping':
          reply(id, {});
          break;
        default:
          if (id !== null) replyError(id, `method not supported: ${msg.method}`);
      }
    } catch (e) {
      if (id !== null) replyError(id, e instanceof Error ? e.message : String(e));
    }
  })();
});
