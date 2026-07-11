import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';

/// MCP (Model Context Protocol) host. Spawns external MCP servers declared
/// in `~/.webcraft/mcp.json` and routes JSON-RPC calls from the renderer to
/// the appropriate server.
///
/// Config format (Claude Desktop compatible):
///   {
///     "mcpServers": {
///       "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
///       "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/zelistore"] }
///     }
///   }
///
/// Each server speaks JSON-RPC over stdio (one JSON message per line, NOT
/// LSP-style Content-Length framing). On boot we send `initialize` then
/// `tools/list` to populate the available tool catalog.

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpServerState {
  name: string;
  status: 'starting' | 'ready' | 'failed';
  tools: McpToolSpec[];
  error?: string;
}

export interface McpToolSpec {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

class McpClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  public state: McpServerState;

  constructor(name: string, config: McpServerConfig) {
    this.state = { name, status: 'starting', tools: [] };
    this.child = spawn(config.command, config.args ?? [], {
      stdio: 'pipe',
      env: { ...process.env, ...(config.env ?? {}) },
    });
    this.child.stdout.on('data', (d: Buffer) => this.onData(d));
    this.child.stderr.on('data', (d: Buffer) => {
      process.stderr.write(`[mcp:${name}] ${d.toString()}`);
    });
    this.child.on('exit', (code) => {
      this.state.status = 'failed';
      this.state.error = `Server exited (${code})`;
      for (const p of this.pending.values()) p.reject(new Error(this.state.error));
      this.pending.clear();
    });
  }

  private onData(d: Buffer): void {
    this.buffer += d.toString('utf-8');
    let nl = this.buffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) {
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message));
            else p.resolve(msg.result);
          }
        } catch {
          /* ignore non-JSON noise */
        }
      }
      nl = this.buffer.indexOf('\n');
    }
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP ${method} timeout`));
        }
      }, 30_000);
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'WebCraft', version: '0.1.0' },
      });
      const list = (await this.request('tools/list')) as { tools?: McpToolSpec[] };
      this.state.tools = list.tools ?? [];
      this.state.status = 'ready';
    } catch (e) {
      this.state.status = 'failed';
      this.state.error = e instanceof Error ? e.message : String(e);
    }
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args });
  }

  shutdown(): void {
    try {
      this.child.kill('SIGTERM');
    } catch {
      /* */
    }
  }
}

const clients = new Map<string, McpClient>();

export async function loadMcpConfig(): Promise<Record<string, McpServerConfig>> {
  const candidates = [
    `${homedir()}/.webcraft/mcp.json`,
    `${homedir()}/.config/webcraft/mcp.json`,
  ];
  for (const path of candidates) {
    try {
      const raw = await readFile(path, 'utf-8');
      const json = JSON.parse(raw) as { mcpServers?: Record<string, McpServerConfig> };
      if (json.mcpServers) return json.mcpServers;
    } catch {
      /* try next */
    }
  }
  return {};
}

export async function startAllConfigured(): Promise<void> {
  const config = await loadMcpConfig();
  for (const [name, spec] of Object.entries(config)) {
    if (clients.has(name)) continue;
    const client = new McpClient(name, spec);
    clients.set(name, client);
    await client.initialize();
  }
}

export function listServers(): McpServerState[] {
  return [...clients.values()].map((c) => c.state);
}

export async function invokeTool(server: string, tool: string, args: unknown): Promise<unknown> {
  const client = clients.get(server);
  if (!client) throw new Error(`Unknown MCP server: "${server}"`);
  if (client.state.status !== 'ready') {
    throw new Error(`MCP server "${server}" is ${client.state.status}: ${client.state.error ?? ''}`);
  }
  return client.callTool(tool, args);
}

export function shutdownAll(): void {
  for (const c of clients.values()) c.shutdown();
  clients.clear();
}
