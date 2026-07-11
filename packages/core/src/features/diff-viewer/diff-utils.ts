/// Tiny line-based diff (Hunt–McIlroy LCS variant) producing unified hunks.
///
/// Self-contained — no `diff` npm dep, ~100 lines, sufficient for rendering
/// before/after blocks in the live diff stream.

export type DiffOp = { kind: 'eq' | 'add' | 'del'; text: string };

export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;

  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const row: number[] = new Array(m + 1);
    for (let j = 0; j <= m; j++) row[j] = 0;
    dp.push(row);
  }
  for (let i = n - 1; i >= 0; i--) {
    const rowI = dp[i]!;
    const rowNext = dp[i + 1]!;
    const ai = a[i] ?? '';
    for (let j = m - 1; j >= 0; j--) {
      const bj = b[j] ?? '';
      rowI[j] = ai === bj ? (rowNext[j + 1] ?? 0) + 1 : Math.max(rowNext[j] ?? 0, rowI[j + 1] ?? 0);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ai = a[i] ?? '';
    const bj = b[j] ?? '';
    if (ai === bj) {
      ops.push({ kind: 'eq', text: ai });
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      ops.push({ kind: 'del', text: ai });
      i++;
    } else {
      ops.push({ kind: 'add', text: bj });
      j++;
    }
  }
  while (i < n) ops.push({ kind: 'del', text: a[i++] ?? '' });
  while (j < m) ops.push({ kind: 'add', text: b[j++] ?? '' });
  return ops;
}
