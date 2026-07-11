import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/// Client to the Node sidecar spawned by Tauri main. The sidecar exposes
/// LSP routing, MCP host, vector embeddings, RAG search, DB drivers, and
/// any other native-Node feature that doesn't belong in the renderer.
///
/// Discovery: Rust spawn writes `SIDECAR_READY <port>` to stdout. The
/// `webcraft_sidecar_port` Tauri command returns that port (0 if not yet
/// ready). We poll up to ~5s on first use.

let cachedPort: number | null = null;

async function discoverPort(): Promise<number> {
  if (cachedPort && cachedPort > 0) return cachedPort;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const p = await invoke<number>('webcraft_sidecar_port');
    if (p > 0) {
      cachedPort = p;
      return p;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Sidecar did not become ready within 5s');
}

export async function sidecarUrl(path: string): Promise<string> {
  const port = await discoverPort();
  return `http://127.0.0.1:${port}${path}`;
}

export async function sidecarHealth(): Promise<{ ok: boolean; version: string } | null> {
  try {
    const url = await sidecarUrl('/health');
    const r = await tauriFetch(url);
    if (!r.ok) return null;
    return (await r.json()) as { ok: boolean; version: string };
  } catch {
    return null;
  }
}

export async function sidecarPost<T>(path: string, body: unknown): Promise<T> {
  const url = await sidecarUrl(path);
  const r = await tauriFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`sidecar ${path} ${r.status}: ${text}`);
  }
  return (await r.json()) as T;
}

export async function sidecarGet<T>(path: string): Promise<T> {
  const url = await sidecarUrl(path);
  const r = await tauriFetch(url);
  if (!r.ok) throw new Error(`sidecar ${path} ${r.status}`);
  return (await r.json()) as T;
}
