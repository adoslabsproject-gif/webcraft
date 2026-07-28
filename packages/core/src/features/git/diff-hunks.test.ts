import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff-hunks';

const TWO_FILES_DIFF = `diff --git a/src/alpha.ts b/src/alpha.ts
index 1111111..2222222 100644
--- a/src/alpha.ts
+++ b/src/alpha.ts
@@ -1,4 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 20;
 const c = 3;
 const d = 4;
@@ -10,3 +10,4 @@ function tail() {
   return a;
 }
+// appended
diff --git a/README.md b/README.md
index 3333333..4444444 100644
--- a/README.md
+++ b/README.md
@@ -1,2 +1,2 @@
-# Old title
+# New title
 Body text.
`;

describe('parseUnifiedDiff', () => {
  it('returns empty for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('\n')).toEqual([]);
  });

  it('splits files and hunks with correct paths', () => {
    const files = parseUnifiedDiff(TWO_FILES_DIFF);
    expect(files).toHaveLength(2);
    expect(files[0]!.path).toBe('src/alpha.ts');
    expect(files[0]!.hunks).toHaveLength(2);
    expect(files[1]!.path).toBe('README.md');
    expect(files[1]!.hunks).toHaveLength(1);
  });

  it('builds apply-ready per-hunk patches (header + single hunk)', () => {
    const files = parseUnifiedDiff(TWO_FILES_DIFF);
    const patch = files[0]!.hunks[0]!.patch;
    expect(patch).toContain('diff --git a/src/alpha.ts b/src/alpha.ts');
    expect(patch).toContain('--- a/src/alpha.ts');
    expect(patch).toContain('+++ b/src/alpha.ts');
    expect(patch).toContain('@@ -1,4 +1,4 @@');
    expect(patch).toContain('+const b = 20;');
    // The second hunk must NOT leak into the first hunk's patch.
    expect(patch).not.toContain('@@ -10,3 +10,4 @@');
    expect(patch).not.toContain('+// appended');
    expect(patch.endsWith('\n')).toBe(true);
  });

  it('keeps hunk headers with trailing function context', () => {
    const files = parseUnifiedDiff(TWO_FILES_DIFF);
    expect(files[0]!.hunks[1]!.header).toBe('@@ -10,3 +10,4 @@ function tail() {');
  });

  it('preserves the no-newline marker inside a hunk', () => {
    const diff = `diff --git a/x.txt b/x.txt
index 1111111..2222222 100644
--- a/x.txt
+++ b/x.txt
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;
    const files = parseUnifiedDiff(diff);
    expect(files[0]!.hunks[0]!.lines).toContain('\\ No newline at end of file');
    expect(files[0]!.hunks[0]!.patch).toContain('\\ No newline at end of file');
  });

  it('handles new-file diffs (path from +++ b/)', () => {
    const diff = `diff --git a/newfile.txt b/newfile.txt
new file mode 100644
index 0000000..5555555
--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,2 @@
+hello
+world
`;
    const files = parseUnifiedDiff(diff);
    expect(files[0]!.path).toBe('newfile.txt');
    expect(files[0]!.hunks[0]!.patch).toContain('new file mode 100644');
    expect(files[0]!.hunks[0]!.lines).toEqual(['+hello', '+world']);
  });
});
