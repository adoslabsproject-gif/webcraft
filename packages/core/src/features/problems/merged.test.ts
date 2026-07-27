import { describe, expect, it } from 'vitest';
import type { Problem } from '../../store/app-store';
import { mergeProblems } from './merged';

const p = (path: string, line: number, column: number, message = 'x'): Problem => ({
  id: `${path}:${line}:${column}`,
  path,
  line,
  column,
  message,
  severity: 'error',
});

describe('mergeProblems', () => {
  it('concatenates disjoint sets', () => {
    const merged = mergeProblems([p('/a.ts', 1, 1)], [p('/b.ts', 2, 2)]);
    expect(merged).toHaveLength(2);
  });

  it('dedupes by path:line:column with live winning', () => {
    const live = p('/a.ts', 1, 1, 'live message');
    const scan = p('/a.ts', 1, 1, 'scan message');
    const merged = mergeProblems([live], [scan]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.message).toBe('live message');
  });

  it('keeps scan findings at different positions in the same file', () => {
    const merged = mergeProblems([p('/a.ts', 1, 1)], [p('/a.ts', 1, 2), p('/a.ts', 9, 1)]);
    expect(merged).toHaveLength(3);
  });

  it('handles empty inputs', () => {
    expect(mergeProblems([], [])).toEqual([]);
    expect(mergeProblems([], [p('/a.ts', 1, 1)])).toHaveLength(1);
  });
});
