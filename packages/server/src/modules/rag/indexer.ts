import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/// Lightweight RAG indexer — TF-IDF over source files (no embedding API
/// required, no native bindings). The renderer can ask for "@codebase
/// query" semantic-ish search; the indexer responds with the top-k
/// matching code chunks (file + line range + snippet).
///
/// Phase 2 swap: replace TfIdfIndex with @lancedb/lancedb + voyage-3
/// embeddings (or OpenAI text-embedding-3-large). The IndexEntry shape
/// stays the same so callers don't change.

export interface IndexEntry {
  path: string;
  line: number;
  chunk: string;
  score?: number;
}

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.sh',
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.html',
  '.css',
  '.scss',
  '.sql',
  '.graphql',
  '.vue',
  '.svelte',
]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  '.nx',
  '.next',
  'coverage',
  '.cache',
]);

const CHUNK_LINES = 30;

interface DocFreqMap {
  [term: string]: number;
}

interface ChunkVector {
  path: string;
  line: number;
  text: string;
  tf: Map<string, number>;
  length: number;
}

export class TfIdfIndex {
  private chunks: ChunkVector[] = [];
  private df: DocFreqMap = {};
  private indexedRoot: string | null = null;

  async build(root: string): Promise<{ files: number; chunks: number; durationMs: number }> {
    const start = performance.now();
    this.chunks = [];
    this.df = {};
    this.indexedRoot = root;
    let files = 0;
    for await (const file of walk(root)) {
      files += await this.ingest(file);
    }
    return { files, chunks: this.chunks.length, durationMs: Math.round(performance.now() - start) };
  }

  private async ingest(file: string): Promise<number> {
    const text = await readFile(file, 'utf-8').catch(() => '');
    if (!text) return 0;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += CHUNK_LINES) {
      const slice = lines.slice(i, i + CHUNK_LINES).join('\n');
      if (slice.trim().length === 0) continue;
      const tf = tokenize(slice);
      this.chunks.push({ path: file, line: i + 1, text: slice, tf, length: slice.length });
      for (const term of tf.keys()) {
        this.df[term] = (this.df[term] ?? 0) + 1;
      }
    }
    return 1;
  }

  search(query: string, k = 10): IndexEntry[] {
    const qTf = tokenize(query);
    const n = this.chunks.length;
    if (n === 0 || qTf.size === 0) return [];
    const scored = this.chunks.map((chunk) => {
      let score = 0;
      for (const [term, qCount] of qTf) {
        const cCount = chunk.tf.get(term) ?? 0;
        if (cCount === 0) continue;
        const idf = Math.log(1 + n / ((this.df[term] ?? 0) + 1));
        score += qCount * cCount * idf;
      }
      return { chunk, score: score / Math.sqrt(chunk.length || 1) };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => ({
      path: s.chunk.path,
      line: s.chunk.line,
      chunk: s.chunk.text.slice(0, 1200),
      score: s.score,
    }));
  }

  isReady(root: string): boolean {
    return this.indexedRoot === root && this.chunks.length > 0;
  }
}

function tokenize(text: string): Map<string, number> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .filter((t) => t.length >= 2 && t.length <= 64);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (!TEXT_EXT.has(ext)) continue;
      const st = await stat(full).catch(() => null);
      if (st && st.size < 1_000_000) yield full;
    }
  }
}
