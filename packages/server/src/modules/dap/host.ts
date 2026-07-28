import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { extendedPath } from '../agent/runner';

/// DAP host — drives Microsoft's js-debug (the VS Code Node/Chrome debug
/// adapter) over TCP. Mirrors the LSP host philosophy: one process, framed
/// JSON-RPC, an event buffer the renderer polls.
///
/// js-debug specifics handled here:
///   - the adapter is downloaded on first use (~12MB tarball, cached under
///     ~/.webcraft/tools/js-debug, version-pinned)
///   - a "launch" on the parent connection triggers a `startDebugging`
///     REVERSE request; we must open a SECOND TCP connection and launch the
///     child config there — that child session is the one that actually
///     hits breakpoints. Breakpoints are mirrored to every connection.

const JSDEBUG_VERSION = 'v1.117.0';
const TOOLS_DIR = path.join(homedir(), '.webcraft', 'tools', 'js-debug');
const MARKER = path.join(TOOLS_DIR, '.version');

interface DapMessage {
  seq?: number;
  type: 'request' | 'response' | 'event';
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: unknown;
  arguments?: unknown;
}

export interface BufferedEvent {
  id: number;
  event: string;
  body: unknown;
}

async function ensureAdapter(): Promise<string> {
  const entry = path.join(TOOLS_DIR, 'js-debug', 'src', 'dapDebugServer.js');
  if (existsSync(entry) && existsSync(MARKER) && readFileSync(MARKER, 'utf-8') === JSDEBUG_VERSION) {
    return entry;
  }
  mkdirSync(TOOLS_DIR, { recursive: true });
  const url = `https://github.com/microsoft/vscode-js-debug/releases/download/${JSDEBUG_VERSION}/js-debug-dap-${JSDEBUG_VERSION}.tar.gz`;
  const tarball = path.join(TOOLS_DIR, 'dap.tgz');
  await new Promise<void>((resolve, reject) => {
    const curl = spawn('curl', ['-fsSL', url, '-o', tarball], {
      env: { ...process.env, PATH: extendedPath() },
    });
    curl.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`js-debug download failed (curl exit ${code})`)),
    );
    curl.on('error', reject);
  });
  await new Promise<void>((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', tarball, '-C', TOOLS_DIR], {
      env: { ...process.env, PATH: extendedPath() },
    });
    tar.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`js-debug extract failed (tar exit ${code})`)),
    );
    tar.on('error', reject);
  });
  if (!existsSync(entry)) throw new Error(`js-debug entry missing after extract: ${entry}`);
  writeFileSync(MARKER, JSDEBUG_VERSION);
  return entry;
}

class DapConnection {
  private socket: net.Socket;
  private buffer = Buffer.alloc(0);
  private seq = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private eventWaiters: { event: string; resolve: () => void }[] = [];
  onEvent: (event: string, body: unknown) => void = () => {};
  onReverseRequest: (msg: DapMessage) => void = () => {};

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', (d) => this.onData(d));
  }

  private onData(d: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, d]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const m = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString());
      if (!m) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const len = Number(m[1]);
      if (this.buffer.length < headerEnd + 4 + len) return;
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + len).toString('utf-8');
      this.buffer = this.buffer.subarray(headerEnd + 4 + len);
      try {
        const msg = JSON.parse(body) as DapMessage;
        if (msg.type === 'response' && msg.request_seq && this.pending.has(msg.request_seq)) {
          const p = this.pending.get(msg.request_seq)!;
          this.pending.delete(msg.request_seq);
          if (msg.success) p.resolve(msg.body);
          else p.reject(new Error(msg.message ?? `${msg.command} failed`));
        } else if (msg.type === 'event' && msg.event) {
          for (let i = this.eventWaiters.length - 1; i >= 0; i--) {
            if (this.eventWaiters[i]!.event === msg.event) {
              this.eventWaiters[i]!.resolve();
              this.eventWaiters.splice(i, 1);
            }
          }
          this.onEvent(msg.event, msg.body);
        } else if (msg.type === 'request') {
          this.onReverseRequest(msg);
        }
      } catch {
        /* skip malformed frame */
      }
    }
  }

  send(payload: object): void {
    const body = JSON.stringify(payload);
    this.socket.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  respond(request: DapMessage, body?: unknown): void {
    this.send({
      type: 'response',
      seq: this.seq++,
      request_seq: request.seq,
      command: request.command,
      success: true,
      body: body ?? {},
    });
  }

  /// Resolves when the named DAP event arrives (or on timeout — best
  /// effort, never rejects: the launch dance must not hang on a missing
  /// `initialized`).
  waitForEvent(event: string, timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve) => {
      const w = { event, resolve };
      this.eventWaiters.push(w);
      setTimeout(() => {
        const i = this.eventWaiters.indexOf(w);
        if (i >= 0) {
          this.eventWaiters.splice(i, 1);
          resolve();
        }
      }, timeoutMs);
    });
  }

  request(command: string, args?: unknown, timeoutMs = 15_000): Promise<unknown> {
    const seq = this.seq++;
    this.send({ type: 'request', seq, command, arguments: args });
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(seq)) {
          this.pending.delete(seq);
          reject(new Error(`DAP ${command} timeout`));
        }
      }, timeoutMs);
    });
  }

  destroy(): void {
    this.socket.destroy();
  }
}

export class DapSession {
  private adapter: ChildProcess | null = null;
  private connections: DapConnection[] = [];
  private events: BufferedEvent[] = [];
  private nextEventId = 1;
  private breakpoints = new Map<string, number[]>();
  private port = 0;

  get active(): boolean {
    return this.connections.length > 0;
  }

  /// The connection that owns the debuggee (last child), where execution
  /// control and stack requests must go.
  private exec(): DapConnection | null {
    return this.connections[this.connections.length - 1] ?? null;
  }

  private pushEvent(event: string, body: unknown): void {
    this.events.push({ id: this.nextEventId++, event, body });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
  }

  private async connect(): Promise<DapConnection> {
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(this.port, '127.0.0.1', () => resolve(s));
      s.on('error', reject);
    });
    const conn = new DapConnection(socket);
    conn.onEvent = (event, body) => this.pushEvent(event, body);
    conn.onReverseRequest = (msg) => {
      void this.handleReverse(conn, msg);
    };
    this.connections.push(conn);
    return conn;
  }

  private async handleReverse(conn: DapConnection, msg: DapMessage): Promise<void> {
    if (msg.command === 'startDebugging') {
      conn.respond(msg);
      try {
        const args = msg.arguments as { configuration?: Record<string, unknown> };
        const child = await this.connect();
        const childReady = child.waitForEvent('initialized');
        await child.request('initialize', {
          clientID: 'webcraft',
          adapterID: 'pwa-node',
          pathFormat: 'path',
          linesStartAt1: true,
          columnsStartAt1: true,
          supportsRunInTerminalRequest: false,
        });
        // DAP ordering: launch does NOT respond until configurationDone,
        // so fire it, wait for `initialized`, set breakpoints, then close
        // the configuration phase — only then await the launch response.
        const launched = child.request('launch', { ...(args.configuration ?? {}) });
        await childReady;
        await this.applyBreakpoints(child);
        await child.request('configurationDone').catch(() => {});
        await launched;
      } catch (e) {
        this.pushEvent('output', {
          category: 'stderr',
          output: `child session failed: ${e instanceof Error ? e.message : e}\n`,
        });
      }
    } else if (msg.command === 'runInTerminal') {
      // We declined the capability; refuse politely if it still arrives.
      conn.send({
        type: 'response',
        seq: 0,
        request_seq: msg.seq,
        command: msg.command,
        success: false,
        message: 'runInTerminal not supported',
      });
    } else {
      conn.respond(msg);
    }
  }

  private async applyBreakpoints(conn: DapConnection): Promise<void> {
    for (const [file, lines] of this.breakpoints) {
      await conn
        .request('setBreakpoints', {
          source: { path: file },
          breakpoints: lines.map((line) => ({ line })),
        })
        .catch(() => {});
    }
  }

  async start(program: string, cwd: string, args: string[] = []): Promise<void> {
    if (this.active) await this.stop();
    const entry = await ensureAdapter();
    this.port = 20000 + Math.floor(Math.random() * 20000);
    this.adapter = spawn(process.execPath, [entry, String(this.port), '127.0.0.1'], {
      env: { ...process.env, PATH: extendedPath() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Wait for the listening line.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('js-debug did not start in 10s')), 10_000);
      this.adapter?.stdout?.on('data', (d: Buffer) => {
        if (d.toString().includes(String(this.port))) {
          clearTimeout(timer);
          resolve();
        }
      });
      this.adapter?.on('error', reject);
      this.adapter?.on('exit', () => reject(new Error('js-debug exited during startup')));
    });

    const conn = await this.connect();
    const ready = conn.waitForEvent('initialized');
    await conn.request('initialize', {
      clientID: 'webcraft',
      adapterID: 'pwa-node',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    });
    // Same dance as the child session: launch responds only after
    // configurationDone, so don't await it up front.
    // TypeScript files run on plain Node via type stripping (Node ≥22.6),
    // no ts-node/tsx dependency required.
    const runtimeArgs = /\.(ts|mts)$/.test(program) ? ['--experimental-strip-types'] : [];
    const launched = conn.request('launch', {
      type: 'pwa-node',
      request: 'launch',
      name: 'WebCraft: debug file',
      program,
      args,
      runtimeArgs,
      cwd,
      console: 'internalConsole',
      env: { PATH: extendedPath() },
    });
    await ready;
    await this.applyBreakpoints(conn);
    await conn.request('configurationDone').catch(() => {});
    await launched;
    this.pushEvent('webcraft-started', { program });
  }

  async setBreakpoints(file: string, lines: number[]): Promise<void> {
    if (lines.length === 0) this.breakpoints.delete(file);
    else this.breakpoints.set(file, lines);
    for (const conn of this.connections) {
      await conn
        .request('setBreakpoints', {
          source: { path: file },
          breakpoints: lines.map((line) => ({ line })),
        })
        .catch(() => {});
    }
  }

  async request(command: string, args?: unknown): Promise<unknown> {
    const conn = this.exec();
    if (!conn) throw new Error('no active debug session');
    return conn.request(command, args);
  }

  pollEvents(since: number): BufferedEvent[] {
    return this.events.filter((e) => e.id > since);
  }

  async stop(): Promise<void> {
    for (const conn of this.connections) {
      await conn.request('disconnect', { terminateDebuggee: true }, 2000).catch(() => {});
      conn.destroy();
    }
    this.connections = [];
    this.adapter?.kill('SIGTERM');
    this.adapter = null;
    this.pushEvent('webcraft-stopped', {});
  }
}

export const dapSession = new DapSession();
