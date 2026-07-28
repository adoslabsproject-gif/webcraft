import { homedir } from 'node:os';
import path from 'node:path';

/// LOCAL text embeddings — all-MiniLM-L6-v2 via transformers.js (ONNX),
/// fully offline after the one-time model download (~25MB, cached under
/// ~/.webcraft/models/embeddings). This is the PRIMARY embedding backend:
/// real semantics, no proxy, no data leaving the machine.
///
/// Lazy: the pipeline loads on first encode (a few seconds), then stays
/// warm. Any failure (download blocked, unsupported platform) is reported
/// to the caller, which falls back to the remote proxy / hash chain.

/// Multilingual on purpose: queries arrive in Italian as much as English
/// (code identifiers are English, comments and prompts often are not).
const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

let pipelinePromise: Promise<FeatureExtractor> | null = null;

async function getPipeline(): Promise<FeatureExtractor> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const transformers = await import('@huggingface/transformers');
      transformers.env.cacheDir = path.join(homedir(), '.webcraft', 'models', 'embeddings');
      const pipe = await transformers.pipeline('feature-extraction', MODEL_ID);
      return pipe as unknown as FeatureExtractor;
    })();
    // A failed load must not poison every future call — allow retry.
    pipelinePromise.catch(() => {
      pipelinePromise = null;
    });
  }
  return pipelinePromise;
}

export async function encodeLocal(texts: string[]): Promise<number[][]> {
  const pipe = await getPipeline();
  const output = await pipe(texts, { pooling: 'mean', normalize: true });
  return output.tolist();
}

export function localModelId(): string {
  return MODEL_ID;
}
