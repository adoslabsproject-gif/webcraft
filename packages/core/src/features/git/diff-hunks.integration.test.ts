import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff-hunks';

/// Real-git integration: the per-hunk patches rebuilt by parseUnifiedDiff
/// must be accepted verbatim by `git apply --cached` — this is exactly what
/// the store's stageHunk does in the app.

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

describe('parseUnifiedDiff × git apply --cached', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'wc-hunks-'));
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 'test@webcraft.dev']);
    git(repo, ['config', 'user.name', 'WebCraft Test']);
    const base = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    writeFileSync(path.join(repo, 'file.txt'), `${base}\n`);
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'base']);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('stages exactly one hunk of a two-hunk diff', () => {
    // Edit two far-apart spots → two separate hunks.
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    lines[2] = 'line 3 CHANGED';
    lines[27] = 'line 28 CHANGED';
    writeFileSync(path.join(repo, 'file.txt'), `${lines.join('\n')}\n`);

    const diff = git(repo, ['diff']);
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0]!.hunks).toHaveLength(2);

    // Apply ONLY the first hunk to the index.
    const patchFile = path.join(repo, '.git', 'wc-test.patch');
    writeFileSync(patchFile, files[0]!.hunks[0]!.patch);
    git(repo, ['apply', '--cached', patchFile]);

    const stagedDiff = git(repo, ['diff', '--cached']);
    expect(stagedDiff).toContain('+line 3 CHANGED');
    expect(stagedDiff).not.toContain('+line 28 CHANGED');

    // The second hunk stays in the working tree diff.
    const remaining = git(repo, ['diff']);
    expect(remaining).toContain('+line 28 CHANGED');

    // Reverse-apply (= unstage hunk) restores a clean index.
    git(repo, ['apply', '--cached', '--reverse', patchFile]);
    expect(git(repo, ['diff', '--cached'])).toBe('');
  });
});
