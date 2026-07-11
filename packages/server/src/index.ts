import { createServer } from 'node:http';
import { TfIdfIndex } from './modules/rag/indexer';

/// WebCraft Node sidecar — loopback HTTP server spawned by the Tauri main
/// process. The renderer hits localhost:<port> for DB queries, RAG search,
/// LSP routing, MCP host, and embedding services.
///
/// Lifecycle: started with `--port <n>` argument; writes its own port to
/// stdout as `SIDECAR_READY <port>` so the Rust spawner can capture it.
///
/// Lazy-loading: heavy modules (DB drivers, MCP SDK, embedding model)
/// are dynamically imported on first use so cold-start stays fast and a
/// missing optional dep doesn't prevent the sidecar from booting.

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = portArg >= 0 ? Number(args[portArg + 1] ?? 0) : 0;

// DbManager is lazy: imported only on first /db/* request so missing
// optional DB driver deps don't crash boot.
let dbManagerPromise: Promise<import('./modules/db/manager').DbManager> | null = null;
function getDbManager() {
  if (!dbManagerPromise) {
    dbManagerPromise = import('./modules/db/manager').then((m) => new m.DbManager());
  }
  return dbManagerPromise;
}

const ragIndex = new TfIdfIndex();

function send(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('access-control-allow-origin', '*');
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: import('node:http').IncomingMessage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') as T);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, version: '0.1.0' });
    }

    if (req.method === 'POST' && req.url === '/db/query') {
      const body = await readJson<{ connectionId: string; sql: string }>(req);
      const dbManager = await getDbManager();
      const result = await dbManager.query(body.connectionId, body.sql);
      return send(res, 200, result);
    }

    if (req.method === 'POST' && req.url === '/db/tables') {
      const body = await readJson<{ connectionId: string }>(req);
      const dbManager = await getDbManager();
      const tables = await dbManager.listTables(body.connectionId);
      return send(res, 200, { tables });
    }

    if (req.method === 'POST' && req.url === '/rag/index') {
      const body = await readJson<{ root: string }>(req);
      const stats = await ragIndex.build(body.root);
      return send(res, 200, stats);
    }

    if (req.method === 'POST' && req.url === '/rag/search') {
      const body = await readJson<{ query: string; k?: number }>(req);
      const hits = ragIndex.search(body.query, body.k ?? 10);
      return send(res, 200, { hits });
    }

    // Future endpoints — stub now so the client API surface is stable:
    if (req.method === 'POST' && req.url === '/embeddings/encode') {
      const body = await readJson<{ text: string | string[]; model?: string }>(req);
      const texts = Array.isArray(body.text) ? body.text : [body.text];
      // Try NHA embedding endpoint first; fall back to deterministic
      // hash-based vector so downstream code keeps flowing even offline.
      const remote = await tryNhaEmbeddings(texts, body.model);
      if (remote) {
        return send(res, 200, { vectors: remote, model: body.model ?? 'nha-embedding' });
      }
      const vectors = texts.map((t) => hashEmbedding(t, 384));
      return send(res, 200, { vectors, model: 'fallback-hash-384' });
    }

    if (req.method === 'POST' && req.url === '/rerank/score') {
      const body = await readJson<{ query: string; candidates: string[]; topK?: number }>(req);
      // Cosine-sim rerank using our embedding endpoint. When NHA's native
      // reranker comes online we'll proxy that here instead.
      const all = await encodeMany([body.query, ...body.candidates]);
      const q = all[0]!;
      const scored = body.candidates.map((text, i) => ({
        text,
        score: cosine(q, all[i + 1]!),
        index: i,
      }));
      scored.sort((a, b) => b.score - a.score);
      const k = body.topK ?? 10;
      return send(res, 200, { ranked: scored.slice(0, k) });
    }

    if (req.method === 'GET' && req.url === '/mcp/servers') {
      const mcp = await import('./modules/mcp/host');
      return send(res, 200, { servers: mcp.listServers() });
    }

    if (req.method === 'POST' && req.url === '/mcp/reload') {
      const mcp = await import('./modules/mcp/host');
      await mcp.startAllConfigured();
      return send(res, 200, { servers: mcp.listServers() });
    }

    if (req.method === 'POST' && req.url === '/mcp/invoke') {
      const body = await readJson<{ server: string; tool: string; args: unknown }>(req);
      const mcp = await import('./modules/mcp/host');
      try {
        const result = await mcp.invokeTool(body.server, body.tool, body.args);
        return send(res, 200, { result });
      } catch (e) {
        return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (req.method === 'GET' && req.url === '/lsp/languages') {
      const lsp = await import('./modules/lsp/host');
      return send(res, 200, { languages: lsp.listActiveLanguages(), supported: Object.keys(lsp.DEFAULT_LSP_SERVERS) });
    }

    if (req.method === 'POST' && req.url === '/lsp/request') {
      const body = await readJson<{
        language: string;
        rootUri: string;
        method: string;
        params?: unknown;
      }>(req);
      const lsp = await import('./modules/lsp/host');
      const session = await lsp.getSession(body.language, body.rootUri);
      const result = await session.request(body.method, body.params);
      return send(res, 200, { result });
    }

    if (req.method === 'POST' && req.url === '/lsp/notify') {
      const body = await readJson<{
        language: string;
        rootUri: string;
        method: string;
        params?: unknown;
      }>(req);
      const lsp = await import('./modules/lsp/host');
      const session = await lsp.getSession(body.language, body.rootUri);
      session.notify(body.method, body.params);
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(port, '127.0.0.1', () => {
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : port;
  // Stdout marker captured by the Tauri spawner.
  process.stdout.write(`SIDECAR_READY ${bound}\n`);
  // Fire-and-forget MCP autoload from ~/.webcraft/mcp.json
  import('./modules/mcp/host')
    .then((m) => m.startAllConfigured())
    .catch((e) => {
      process.stderr.write(`[mcp] autoload failed: ${e instanceof Error ? e.message : e}\n`);
    });
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());

async function tryNhaEmbeddings(texts: string[], model?: string): Promise<number[][] | null> {
  try {
    const res = await fetch('https://nothumanallowed.com/api/v1/liara/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts, model: model ?? 'text-embedding-3-small' }),
      // Short timeout — if the endpoint is missing we want to fall back fast.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    if (!j.data || !Array.isArray(j.data)) return null;
    return j.data.map((d) => d.embedding);
  } catch {
    return null;
  }
}

async function encodeMany(texts: string[]): Promise<number[][]> {
  const remote = await tryNhaEmbeddings(texts);
  if (remote) return remote;
  return texts.map((t) => hashEmbedding(t, 384));
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/// Deterministic fallback embedding — hash-based, 384-dim, unit-normalized.
/// Used when the NHA embedding endpoint is unreachable (offline / 404).
/// SAME text → SAME vector across runs, so downstream cosine-sim still
/// produces self-consistent results in degraded mode.
function hashEmbedding(text: string, dim: number): number[] {
  const out = new Array<number>(dim).fill(0);
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = ((h1 ^ c) * 16777619) >>> 0;
    h2 = ((h2 << 5) + h2 + c) >>> 0;
    out[(h1 + i) % dim] += ((h2 % 200) - 100) / 100;
    out[(h2 + i) % dim] += ((h1 % 200) - 100) / 100;
  }
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}
