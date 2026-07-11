import { homeDir } from '@tauri-apps/api/path';
import {
  Boxes,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { sidecarGet, sidecarPost } from '../../lib/ipc/sidecar';
import { createDir, fileExists, readFile, writeFile } from '../../lib/ipc/fs';
import { alert, confirm, prompt } from '../dialog/dialog-store';

/// MCP Servers section of the Settings panel — visual management of the
/// `~/.webcraft/mcp.json` config that the sidecar autoloads at boot.
///
/// Workflow:
///   - Show the live status of each running server (status + tool count)
///   - "+ Add server": prompt for {name, command, args, env}, append to JSON, reload
///   - Remove: drop from JSON, reload
///   - "Reload": re-spawn everything (catches manual JSON edits)

interface McpServerCfg {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpServerStatus {
  name: string;
  status: 'starting' | 'ready' | 'failed';
  tools: Array<{ name: string }>;
  error?: string;
}

async function configPath(): Promise<string> {
  const home = await homeDir();
  return `${home}/.webcraft/mcp.json`;
}

async function readConfig(): Promise<Record<string, McpServerCfg>> {
  const path = await configPath();
  try {
    if (!(await fileExists(path))) return {};
    const json = JSON.parse(await readFile(path)) as { mcpServers?: Record<string, McpServerCfg> };
    return json.mcpServers ?? {};
  } catch {
    return {};
  }
}

async function writeConfig(cfg: Record<string, McpServerCfg>): Promise<void> {
  const path = await configPath();
  const dir = path.split('/').slice(0, -1).join('/');
  await createDir(dir);
  await writeFile(path, JSON.stringify({ mcpServers: cfg }, null, 2));
}

export function McpSettings() {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [config, setConfig] = useState<Record<string, McpServerCfg>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const cfg = await readConfig();
      setConfig(cfg);
      const { servers: live } = await sidecarGet<{ servers: McpServerStatus[] }>('/mcp/servers');
      setServers(live);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function reloadSidecar() {
    setLoading(true);
    try {
      const { servers: live } = await sidecarPost<{ servers: McpServerStatus[] }>('/mcp/reload', {});
      setServers(live);
    } catch (e) {
      await alert('Reload failed', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addServer() {
    const name = await prompt('MCP server name', {
      message: 'Unique identifier (e.g. "github", "filesystem", "puppeteer")',
    });
    if (!name) return;
    const command = await prompt('Command', {
      message: 'Executable to spawn (e.g. "npx", "uvx", "/usr/local/bin/mcp-server-github")',
      defaultValue: 'npx',
    });
    if (!command) return;
    const argsRaw = await prompt('Arguments (space-separated)', {
      message: 'e.g. "-y @modelcontextprotocol/server-github"',
      defaultValue: '',
    });
    const args = argsRaw ? argsRaw.split(/\s+/).filter(Boolean) : [];
    const next = { ...config, [name]: { command, args } };
    try {
      await writeConfig(next);
      await reloadSidecar();
      await refresh();
    } catch (e) {
      await alert('Could not save config', e instanceof Error ? e.message : String(e));
    }
  }

  async function removeServer(name: string) {
    const ok = await confirm(`Remove MCP server "${name}"?`, {
      message: 'Stops the running process and removes it from ~/.webcraft/mcp.json',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const next = { ...config };
    delete next[name];
    await writeConfig(next);
    await reloadSidecar();
    await refresh();
  }

  return (
    <section className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3">
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">MCP Servers</h3>
          <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-indigo-300">
            Model Context Protocol
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            title="Refresh"
            className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => void addServer()}
            className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-500"
          >
            <Plus className="h-3 w-3" />
            Add server
          </button>
        </div>
      </header>

      <p className="mb-2 text-[11px] text-[var(--color-fg-subtle)]">
        Configured at <code className="rounded bg-[var(--color-bg)] px-1 font-mono">~/.webcraft/mcp.json</code>.
        Compatible with Claude Desktop's MCP config format.
      </p>

      {error ? (
        <div className="mb-2 rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger-muted)] p-1.5 text-[11px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      {Object.keys(config).length === 0 && !loading ? (
        <div className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-center text-[11px] text-[var(--color-fg-dim)]">
          No MCP servers configured. Click <strong>Add server</strong> to set one up.
        </div>
      ) : (
        <ul className="space-y-1">
          {Object.entries(config).map(([name, cfg]) => {
            const live = servers.find((s) => s.name === name);
            const status = live?.status ?? 'starting';
            return (
              <li
                key={name}
                className="group flex items-start gap-2 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2 text-[11px]"
              >
                {status === 'ready' ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : status === 'failed' ? (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                ) : (
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--color-fg)]">{name}</span>
                    <span className="rounded bg-[var(--color-bg-subtle)] px-1.5 py-px text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                      {status}
                    </span>
                    {live ? (
                      <span className="text-[10px] text-[var(--color-fg-muted)]">
                        · {live.tools.length} tools
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate font-mono text-[10px] text-[var(--color-fg-subtle)]">
                    {cfg.command} {(cfg.args ?? []).join(' ')}
                  </div>
                  {live?.error ? (
                    <div className="mt-1 font-mono text-[10px] text-rose-300">{live.error}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void removeServer(name)}
                  aria-label={`Remove ${name}`}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5 text-rose-400 hover:text-rose-300" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
