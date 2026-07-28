/// Unified-diff parsing for per-hunk staging — pure functions, no I/O.
///
/// `git diff` output is split into per-file sections, each with its header
/// lines (diff --git / index / --- / +++) and a list of @@ hunks. To stage
/// ONE hunk we rebuild a minimal patch (file header + that hunk) and feed
/// it to `git apply --cached`; `--reverse` unstages it the same way.

export interface DiffHunk {
  /// The @@ -a,b +c,d @@ line (with any trailing context).
  header: string;
  /// Hunk body lines (context/+/-), excluding the @@ header.
  lines: string[];
  /// Complete minimal patch: file header + this hunk, apply-ready.
  patch: string;
}

export interface FileDiff {
  /// File header lines (diff --git, index, ---, +++, mode changes…).
  headerLines: string[];
  /// Path taken from the +++ line (or --- for deletions), without a/ b/.
  path: string;
  hunks: DiffHunk[];
}

function pathFromHeader(headerLines: string[]): string {
  for (const line of headerLines) {
    if (line.startsWith('+++ b/')) return line.slice(6);
    if (line.startsWith('--- a/')) return line.slice(6);
  }
  const git = headerLines.find((l) => l.startsWith('diff --git '));
  if (git) {
    const m = / b\/(.+)$/.exec(git);
    if (m?.[1]) return m[1];
  }
  return '';
}

/// Parse `git diff` output into files and hunks. Tolerant of empty input
/// and of the "\ No newline at end of file" marker (kept inside the hunk).
export function parseUnifiedDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  if (!diff.trim()) return files;

  const lines = diff.split('\n');
  let current: FileDiff | null = null;
  let hunk: { header: string; lines: string[] } | null = null;

  const flushHunk = () => {
    if (current && hunk) {
      // patch is filled in the final pass, after trailing-empty cleanup.
      current.hunks.push({ header: hunk.header, lines: hunk.lines, patch: '' });
    }
    hunk = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushHunk();
      current = { headerLines: [line], path: '', hunks: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('@@')) {
      flushHunk();
      hunk = { header: line, lines: [] };
      continue;
    }
    if (hunk) {
      // Hunk bodies only contain ' ', '+', '-', '\' lines; anything else
      // (shouldn't happen inside `git diff`) ends the hunk defensively.
      if (
        line.startsWith(' ') ||
        line.startsWith('+') ||
        line.startsWith('-') ||
        line.startsWith('\\') ||
        line === ''
      ) {
        // '' only occurs as the final split artifact — the per-file cleanup
        // below pops trailing empties off each hunk.
        hunk.lines.push(line);
        continue;
      }
      flushHunk();
    }
    current.headerLines.push(line);
  }
  flushHunk();

  for (const f of files) {
    f.path = pathFromHeader(f.headerLines);
    for (const h of f.hunks) {
      // Drop trailing empty lines picked up from the final split, THEN
      // build the apply-ready patch from the clean hunk body.
      while (h.lines.length > 0 && h.lines[h.lines.length - 1] === '') h.lines.pop();
      h.patch = `${[...f.headerLines, h.header, ...h.lines].join('\n')}\n`;
    }
  }
  return files;
}
