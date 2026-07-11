/// Minimal Myers-ish unified diff formatter — used by write_file / edit_file
/// to embed a human-readable diff in the tool_result content.
///
/// Format is standard unified diff inside a fenced ```diff block so the
/// MessageBubble renderer can highlight +/- lines + show line numbers.
///
/// This is intentionally small: the chat-side renderer handles colouring,
/// numbering, and limiting display rows. We just need clean +/-/context lines.

interface DiffOp {
  kind: 'context' | 'add' | 'remove';
  oldLineNo?: number;
  newLineNo?: number;
  text: string;
}

/// Compute a line-level diff using LCS (Longest Common Subsequence) — accurate
/// for typical file sizes (<10k lines) without pulling in a diff dependency.
/// Lines that match are 'context'; missing in new = 'remove'; missing in old = 'add'.
function lcsDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const m = oldLines.length;
  const n = newLines.length;
  // Bound the LCS table to keep memory sane on huge files.
  if (m > 5000 || n > 5000) {
    return naiveDiff(oldLines, newLines);
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ kind: 'context', oldLineNo: i + 1, newLineNo: j + 1, text: oldLines[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: 'remove', oldLineNo: i + 1, text: oldLines[i]! });
      i++;
    } else {
      ops.push({ kind: 'add', newLineNo: j + 1, text: newLines[j]! });
      j++;
    }
  }
  while (i < m) ops.push({ kind: 'remove', oldLineNo: i + 1, text: oldLines[i++]! });
  while (j < n) ops.push({ kind: 'add', newLineNo: j + 1, text: newLines[j++]! });
  return ops;
}

function naiveDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  oldLines.forEach((line, i) => ops.push({ kind: 'remove', oldLineNo: i + 1, text: line }));
  newLines.forEach((line, i) => ops.push({ kind: 'add', newLineNo: i + 1, text: line }));
  return ops;
}

/// Public entry point — render a unified diff string ready to embed as a
/// fenced ```diff block in the tool_result content. Includes a header so
/// the MessageBubble renderer can show the file path + change summary.
export function renderUnifiedDiff(opts: {
  path: string;
  oldContent: string;
  newContent: string;
  kind: 'write' | 'edit';
}): string {
  const { path, oldContent, newContent, kind } = opts;
  const oldLines = oldContent === '' ? [] : oldContent.split('\n');
  const newLines = newContent === '' ? [] : newContent.split('\n');
  const ops = lcsDiff(oldLines, newLines);
  const added = ops.filter((o) => o.kind === 'add').length;
  const removed = ops.filter((o) => o.kind === 'remove').length;

  const header = `--- ${kind === 'write' && oldContent === '' ? '/dev/null' : path}\n+++ ${path}\n`;
  const body = ops
    .map((o) => {
      if (o.kind === 'add') return `+${o.text}`;
      if (o.kind === 'remove') return `-${o.text}`;
      return ` ${o.text}`;
    })
    .join('\n');

  const summary = `${added} added, ${removed} removed`;
  return `\`\`\`diff\n${header}@@ ${summary} @@\n${body}\n\`\`\``;
}
