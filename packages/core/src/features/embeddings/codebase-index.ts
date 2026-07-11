import { listDir, readFile } from '../../lib/ipc/fs';
import { sidecarPost } from '../../lib/ipc/sidecar';

/// Workspace-wide embedding index. Walks the project, chunks each file into
/// overlapping windows, encodes them via the sidecar /embeddings/encode
/// endpoint, then keeps a cosine-similarity cache in memory.
///
/// semantic_search queries are answered locally without sending the query
/// vector roundtrip — encode once, sim everywhere.
///
/// Concurrency: chunks are batched and dispatched to the sidecar in batches
/// of 32 to keep latency bounded. Total RAM footprint at 384-dim, 5k chunks
/// is ~15 MB — fine for desktop.

const CHUNK_LINES = 60;
const CHUNK_OVERLAP = 10;
const BATCH_SIZE = 32;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.turbo',
  '.nx',
  'coverage',
  '.vite',
  'out',
  'bin',
  'obj',
  'TestResults',
  '.vs',
  'target',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.venv',
  'venv',
  'env',
  'vendor',
  '.gradle',
  '.idea',
  '.cache',
  '.parcel-cache',
  '.terraform',
  '.DS_Store',
]);
const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'php', 'cs',
  'c', 'h', 'cpp', 'hpp', 'cc', 'm', 'mm',
  'sh', 'bash', 'zsh',
  'html', 'css', 'scss', 'vue', 'svelte', 'astro',
  'json', 'yaml', 'yml', 'toml', 'xml',
  'md', 'mdx', 'rst', 'txt',
  'sql', 'graphql', 'gql', 'proto',
]);

export interface Chunk {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  vector: number[];
}

export interface IndexProgress {
  files: number;
  chunks: number;
  done: boolean;
  current?: string;
}

class CodebaseIndex {
  private chunks: Chunk[] = [];
  private indexedRoot: string | null = null;
  private inflight: Promise<void> | null = null;
  private listeners: Array<(p: IndexProgress) => void> = [];
  private progress: IndexProgress = { files: 0, chunks: 0, done: true };

  getProgress(): IndexProgress {
    return this.progress;
  }

  subscribe(fn: (p: IndexProgress) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l(this.progress);
  }

  reset(): void {
    this.chunks = [];
    this.indexedRoot = null;
    this.progress = { files: 0, chunks: 0, done: true };
    this.emit();
  }

  isIndexedFor(root: string): boolean {
    return this.indexedRoot === root && this.chunks.length > 0;
  }

  async build(root: string): Promise<void> {
    if (this.inflight && this.indexedRoot === root) return this.inflight;
    this.indexedRoot = root;
    this.chunks = [];
    this.progress = { files: 0, chunks: 0, done: false };
    this.emit();
    const task = (async () => {
      const files = await walk(root);
      const chunksBuffer: Omit<Chunk, 'vector'>[] = [];
      let fileN = 0;
      for (const path of files) {
        fileN++;
        this.progress = { ...this.progress, files: fileN, current: path };
        this.emit();
        try {
          const text = await readFile(path);
          for (const c of chunkFile(path, text)) chunksBuffer.push(c);
          // Encode in batches so we don't accumulate forever before sending
          if (chunksBuffer.length >= BATCH_SIZE * 4) {
            await this.encodeAndAppend(chunksBuffer.splice(0));
          }
        } catch {
          /* skip unreadable */
        }
      }
      if (chunksBuffer.length > 0) await this.encodeAndAppend(chunksBuffer);
      this.progress = { files: fileN, chunks: this.chunks.length, done: true };
      this.emit();
    })();
    this.inflight = task;
    try {
      await task;
    } finally {
      this.inflight = null;
    }
  }

  private async encodeAndAppend(batch: Omit<Chunk, 'vector'>[]): Promise<void> {
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      const slice = batch.slice(i, i + BATCH_SIZE);
      try {
        const { vectors } = await sidecarPost<{ vectors: number[][] }>('/embeddings/encode', {
          text: slice.map((c) => c.text),
        });
        for (let j = 0; j < slice.length; j++) {
          const v = vectors[j];
          if (v) this.chunks.push({ ...slice[j]!, vector: v });
        }
        this.progress = { ...this.progress, chunks: this.chunks.length };
        this.emit();
      } catch {
        /* sidecar offline — skip silently, fall back to grep-only mode */
        return;
      }
    }
  }

  async search(query: string, topK = 10): Promise<Array<Chunk & { score: number }>> {
    if (this.chunks.length === 0) return [];
    try {
      const { vectors } = await sidecarPost<{ vectors: number[][] }>('/embeddings/encode', {
        text: [query],
      });
      const q = vectors[0];
      if (!q) return [];
      const scored = this.chunks.map((c) => ({ ...c, score: cosine(q, c.vector) }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK);
    } catch {
      return [];
    }
  }
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

function chunkFile(path: string, text: string): Omit<Chunk, 'vector'>[] {
  const lines = text.split('\n');
  const out: Omit<Chunk, 'vector'>[] = [];
  if (lines.length === 0) return out;
  for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP) {
    const end = Math.min(start + CHUNK_LINES, lines.length);
    const chunk = lines.slice(start, end).join('\n').trim();
    if (chunk.length < 40) continue;
    out.push({ path, startLine: start + 1, endLine: end, text: chunk });
    if (end === lines.length) break;
  }
  return out;
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Array<{ name: string; path: string; isDirectory: boolean }> = [];
    try {
      entries = await listDir(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (e.isDirectory) {
        stack.push(e.path);
      } else {
        const ext = (e.name.split('.').pop() ?? '').toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) out.push(e.path);
      }
    }
  }
  return out;
}

export const codebaseIndex = new CodebaseIndex();
