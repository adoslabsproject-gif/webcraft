import { describe, expect, it } from 'vitest';
import { editDistance } from './edit-distance';

describe('editDistance', () => {
  it('is zero for identical strings', () => {
    expect(editDistance('grep', 'grep')).toBe(0);
    expect(editDistance('', '')).toBe(0);
  });

  it('counts insertions/deletions/substitutions', () => {
    expect(editDistance('cat', 'cats')).toBe(1);
    expect(editDistance('cat', 'at')).toBe(1);
    expect(editDistance('cat', 'car')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });

  it('handles empty vs non-empty', () => {
    expect(editDistance('', 'tool')).toBe(4);
    expect(editDistance('tool', '')).toBe(4);
  });

  it('ranks near tool names closer than far ones (did-you-mean)', () => {
    const toGrep = editDistance('gerp', 'grep');
    const toGlob = editDistance('gerp', 'glob');
    expect(toGrep).toBeLessThan(toGlob);
  });
});
