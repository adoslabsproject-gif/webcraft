import { Command } from '@tauri-apps/plugin-shell';
import { shellEnv } from '../../lib/ai/shell-env';
import type { Problem } from '../../store/app-store';

/// Whole-project diagnostics — the real compiler, not just open editors.
///
/// Monaco's language workers only analyze files opened as models, so the
/// Problems panel is empty for a freshly opened project even when the build
/// is broken. This scan runs `tsc --noEmit` at the project root (local
/// install first, then npx fallback) and parses every diagnostic into the
/// same Problem shape the panel renders.

const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

export interface ScanResult {
  problems: Problem[];
  /// Human-readable failure when the scan could not run at all (no tsc, no
  /// tsconfig, …). `null` when the scan executed — even with 0 findings.
  failure: string | null;
}

export async function scanProject(projectRoot: string): Promise<ScanResult> {
  const env = await shellEnv(projectRoot);
  // --pretty false → stable machine-parsable one-line diagnostics.
  const cmd =
    'pnpm exec tsc --noEmit --pretty false 2>&1 || npx --no-install tsc --noEmit --pretty false 2>&1';
  let output: string;
  try {
    const result = await Command.create('sh', ['-c', cmd], { cwd: projectRoot, env }).execute();
    output = result.stdout;
    // tsc exits non-zero when it finds errors — that IS the success path
    // here. A real tool failure leaves nothing parsable in stdout.
  } catch (e) {
    return { problems: [], failure: String(e) };
  }

  const problems: Problem[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    const m = TSC_LINE.exec(line);
    if (!m) continue;
    const [, file, lineNo, colNo, severity, code, message] = m;
    const path = file!.startsWith('/') ? file! : `${projectRoot}/${file}`;
    problems.push({
      id: `scan:${path}:${lineNo}:${colNo}:${code}`,
      path,
      line: Number(lineNo),
      column: Number(colNo),
      message: `${message} (${code})`,
      severity: severity === 'error' ? 'error' : 'warning',
    });
  }

  if (problems.length === 0 && /command not found|not found|ENOENT/i.test(output)) {
    return { problems: [], failure: `TypeScript not available in this project: ${output.slice(0, 200)}` };
  }
  return { problems, failure: null };
}
