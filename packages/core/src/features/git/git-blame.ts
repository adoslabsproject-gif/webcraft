import { Command } from '@tauri-apps/plugin-shell';
import * as monaco from 'monaco-editor';

/// Git blame gutter — when an editor opens a file inside a git repo,
/// fetch `git blame --line-porcelain` and add a hover-info decoration
/// on each line showing "author · date · subject" of the commit that
/// last touched that line. GitLens-style.

interface BlameLine {
  hash: string;
  author: string;
  date: string;
  summary: string;
}

const cache = new Map<string, BlameLine[]>();

export async function fetchBlame(absPath: string, cwd: string): Promise<BlameLine[]> {
  const key = `${cwd}::${absPath}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const result = await Command.create(
      'git',
      ['blame', '--line-porcelain', '--', absPath],
      { cwd },
    ).execute();
    if (result.code !== 0) return [];
    const lines = parsePorcelain(result.stdout);
    cache.set(key, lines);
    return lines;
  } catch {
    return [];
  }
}

function parsePorcelain(out: string): BlameLine[] {
  const result: BlameLine[] = [];
  const blocks = out.split('\n\t');
  for (const block of blocks) {
    const m = /^([0-9a-f]{40})\b/.exec(block);
    if (!m) continue;
    const hash = m[1] ?? '';
    const author = /\nauthor (.+)/.exec(block)?.[1] ?? 'unknown';
    const ts = /\nauthor-time (\d+)/.exec(block)?.[1];
    const date = ts ? new Date(Number(ts) * 1000).toISOString().slice(0, 10) : '';
    const summary = /\nsummary (.+)/.exec(block)?.[1] ?? '';
    result.push({ hash, author, date, summary });
  }
  return result;
}

export function applyBlameToEditor(
  editor: monaco.editor.IStandaloneCodeEditor,
  blame: BlameLine[],
): monaco.editor.IEditorDecorationsCollection {
  const decorations: monaco.editor.IModelDeltaDecoration[] = blame.map((b, i) => ({
    range: new monaco.Range(i + 1, 1, i + 1, 1),
    options: {
      isWholeLine: false,
      after: {
        content: `   ${b.author.split(' ')[0] ?? 'unknown'} · ${b.date} · ${b.summary.slice(0, 50)}`,
        inlineClassName: 'wc-blame-gutter',
      },
      hoverMessage: {
        value: `**${b.author}** · ${b.date}\n\n\`${b.hash.slice(0, 7)}\` ${b.summary}`,
      },
    },
  }));
  return editor.createDecorationsCollection(decorations);
}

export function clearBlameCache(): void {
  cache.clear();
}
