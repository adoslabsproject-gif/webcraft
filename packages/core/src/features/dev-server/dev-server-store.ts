import { Command, type Child } from '@tauri-apps/plugin-shell';
import { create } from 'zustand';

/// Dev server orchestration — spawns project runtimes (Node/Static/PHP/
/// Python/Deno/Bun/Ruby/Go) via tauri-plugin-shell. Logs stream into the
/// store; the panel renders them live.

export type Runtime = 'node' | 'static' | 'php' | 'python' | 'deno' | 'bun' | 'ruby' | 'go';

export interface RunningServer {
  id: string;
  runtime: Runtime;
  command: string;
  cwd: string;
  port: number;
  logs: string[];
  status: 'starting' | 'running' | 'exited';
}

export const RUNTIME_DEFAULTS: Record<Runtime, { command: string; defaultPort: number }> = {
  node: { command: 'npm run dev', defaultPort: 3000 },
  static: { command: 'npx --yes sirv-cli --port ${PORT} --single .', defaultPort: 8080 },
  php: { command: 'php -S 0.0.0.0:${PORT}', defaultPort: 8000 },
  python: { command: 'python -m http.server ${PORT}', defaultPort: 8001 },
  deno: { command: 'deno run --allow-net --allow-read --watch main.ts', defaultPort: 8002 },
  bun: { command: 'bun run dev', defaultPort: 3001 },
  ruby: { command: 'ruby -run -e httpd . -p ${PORT}', defaultPort: 8003 },
  go: { command: 'go run .', defaultPort: 8004 },
};

interface DevServerState {
  servers: RunningServer[];
  start: (input: { runtime: Runtime; command?: string; port?: number; cwd: string }) => Promise<void>;
  stop: (id: string) => Promise<void>;
}

const children = new Map<string, Child>();

export const useDevServerStore = create<DevServerState>((set, get) => ({
  servers: [],

  async start({ runtime, command, port, cwd }) {
    const defaults = RUNTIME_DEFAULTS[runtime];
    const resolvedPort = port ?? defaults.defaultPort;
    const resolvedCommand = (command ?? defaults.command).replace(
      /\$\{PORT\}/g,
      String(resolvedPort),
    );
    const id = `srv_${Date.now().toString(36)}`;
    const entry: RunningServer = {
      id,
      runtime,
      command: resolvedCommand,
      cwd,
      port: resolvedPort,
      logs: [`▶ ${resolvedCommand}\n`],
      status: 'starting',
    };
    set((s) => ({ servers: [...s.servers, entry] }));

    const cmd = Command.create('sh', ['-c', resolvedCommand], { cwd });
    cmd.stdout.on('data', (line) => appendLog(id, line, set));
    cmd.stderr.on('data', (line) => appendLog(id, line, set));
    cmd.on('close', (data) => {
      set((s) => ({
        servers: s.servers.map((srv) =>
          srv.id === id
            ? { ...srv, status: 'exited' as const, logs: [...srv.logs, `\n■ exit code ${data.code ?? '?'}\n`] }
            : srv,
        ),
      }));
      children.delete(id);
    });
    try {
      const child = await cmd.spawn();
      children.set(id, child);
      set((s) => ({
        servers: s.servers.map((srv) => (srv.id === id ? { ...srv, status: 'running' } : srv)),
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set((s) => ({
        servers: s.servers.map((srv) =>
          srv.id === id ? { ...srv, status: 'exited', logs: [...srv.logs, `✗ ${msg}\n`] } : srv,
        ),
      }));
    }
    void get();
  },

  async stop(id) {
    const child = children.get(id);
    if (child) {
      try {
        await child.kill();
      } catch {
        /* ignore */
      }
      children.delete(id);
    }
    set((s) => ({
      servers: s.servers.map((srv) => (srv.id === id ? { ...srv, status: 'exited' } : srv)),
    }));
  },
}));

function appendLog(
  id: string,
  line: string,
  set: (fn: (s: { servers: RunningServer[] }) => { servers: RunningServer[] }) => void,
) {
  set((s) => ({
    servers: s.servers.map((srv) =>
      srv.id === id ? { ...srv, logs: [...srv.logs, line + '\n'].slice(-500) } : srv,
    ),
  }));
}
