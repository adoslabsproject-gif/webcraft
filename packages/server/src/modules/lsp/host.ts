import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

/// Minimal LSP host running INSIDE the sidecar. Spawns one language server
/// child process per language (typescript-language-server, pyright, gopls,
/// rust-analyzer, etc.) and bridges JSON-RPC stdin/stdout to the renderer
/// via the sidecar HTTP API.
///
/// Protocol: standard LSP framing — `Content-Length: N\r\n\r\n<json>` over
/// the child's stdin/stdout. We parse incoming frames, dispatch responses
/// against pending request IDs, and forward notifications via EventEmitter.
///
/// Language servers are spawned LAZY (on first request for that language)
/// and reused across the session. Missing binaries fail gracefully — the
/// renderer surfaces a "install typescript-language-server" hint.

export interface LspServerSpec {
  command: string;
  args: string[];
  initializationOptions?: Record<string, unknown>;
}

/// Map: language id → command/args of its LSP server.
/// User can override per-project via .webcraft/lsp.json (future).
export const DEFAULT_LSP_SERVERS: Record<string, LspServerSpec> = {
  typescript: { command: 'typescript-language-server', args: ['--stdio'] },
  javascript: { command: 'typescript-language-server', args: ['--stdio'] },
  typescriptreact: { command: 'typescript-language-server', args: ['--stdio'] },
  javascriptreact: { command: 'typescript-language-server', args: ['--stdio'] },
  python: { command: 'pyright-langserver', args: ['--stdio'] },
  go: { command: 'gopls', args: ['serve'] },
  rust: { command: 'rust-analyzer', args: [] },
  csharp: { command: 'omnisharp', args: ['--lsp'] },
  java: { command: 'jdtls', args: [] },
  ruby: { command: 'solargraph', args: ['stdio'] },
  php: { command: 'intelephense', args: ['--stdio'] },
};

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

class LspSession extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private buffer: Buffer = Buffer.alloc(0);
  private pending: Map<number, PendingRequest> = new Map();
  private nextId = 1;
  private initialized = false;
  private capabilities: unknown = null;

  constructor(spec: LspServerSpec, public language: string) {
    super();
    this.child = spawn(spec.command, spec.args, { stdio: 'pipe' });
    this.child.stdout.on('data', (d: Buffer) => this.onData(d));
    this.child.stderr.on('data', (d: Buffer) => {
      // Pyright / typescript-language-server log to stderr verbosely — ignore.
      process.stderr.write(`[lsp:${this.language}] ${d.toString()}`);
    });
    this.child.on('exit', (code) => {
      this.emit('exit', code);
      for (const p of this.pending.values()) p.reject(new Error(`LSP exited (code ${code})`));
      this.pending.clear();
    });
  }

  private onData(d: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, d]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('utf-8');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = parseInt(m[1]!, 10);
      if (this.buffer.length < headerEnd + 4 + length) return;
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf-8');
      this.buffer = this.buffer.subarray(headerEnd + 4 + length);
      try {
        const msg = JSON.parse(body) as {
          id?: number;
          method?: string;
          params?: unknown;
          result?: unknown;
          error?: { message?: string };
        };
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message ?? 'LSP error'));
          else p.resolve(msg.result);
        } else if (msg.method) {
          this.emit('notification', msg.method, msg.params);
        }
      } catch (e) {
        this.emit('parse-error', e);
      }
    }
  }

  private send(payload: object): void {
    const body = JSON.stringify(payload);
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`;
    this.child.stdin.write(header + body);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
      // Safety timeout 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP ${method} timeout`));
        }
      }, 30_000);
    });
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  async initialize(rootUri: string, initOpts?: Record<string, unknown>): Promise<void> {
    if (this.initialized) return;
    this.capabilities = await this.request('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          definition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
          completion: { completionItem: { snippetSupport: true } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          rename: { dynamicRegistration: false, prepareSupport: true },
        },
        workspace: { applyEdit: true, configuration: true },
      },
      initializationOptions: initOpts,
    });
    this.notify('initialized', {});
    this.initialized = true;
  }

  shutdown(): void {
    try {
      this.notify('exit');
      this.child.kill('SIGTERM');
    } catch {
      /* */
    }
  }

  getCapabilities(): unknown {
    return this.capabilities;
  }
}

const sessions: Map<string, LspSession> = new Map();

function languageBin(language: string): LspServerSpec | null {
  return DEFAULT_LSP_SERVERS[language] ?? null;
}

export async function getSession(language: string, rootUri: string): Promise<LspSession> {
  let session = sessions.get(language);
  if (session) return session;
  const spec = languageBin(language);
  if (!spec) throw new Error(`No LSP server configured for language "${language}"`);
  try {
    session = new LspSession(spec, language);
  } catch (e) {
    throw new Error(`Failed to spawn ${spec.command}: ${e instanceof Error ? e.message : e}`);
  }
  await session.initialize(rootUri);
  sessions.set(language, session);
  session.on('exit', () => sessions.delete(language));
  return session;
}

export function listActiveLanguages(): string[] {
  return [...sessions.keys()];
}

export function shutdownAll(): void {
  for (const s of sessions.values()) s.shutdown();
  sessions.clear();
}
