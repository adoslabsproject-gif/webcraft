import { Command } from '@tauri-apps/plugin-shell';
import { shellEnv } from '../../lib/ai/shell-env';
import type { Problem } from '../../store/app-store';

/// Whole-project diagnostics — the real compiler, monorepo-aware.
///
/// Monaco's language workers only analyze open files, so this scan is what
/// fills the Problems panel for the rest of the project. It:
///   1. discovers every tsconfig.json in the project (node_modules/build
///      dirs excluded, depth-limited) — single-package AND monorepo layouts
///   2. runs `tsc --noEmit -p <config>` for each, aggregating diagnostics
///      with exact file:line:column
///   3. NEVER reports a silent false "0 problems": when nothing could be
///      analyzed (no tsconfig, no tsc, config errors) the failure is
///      surfaced so the user knows the scan did not run.

const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;
/// Non-positional compiler errors (broken tsconfig, missing inputs, …).
const TSC_GLOBAL_ERROR = /^error\s+(TS\d+):\s+(.+)$/;

export interface ScanResult {
  problems: Problem[];
  /// Human-readable failure when the scan could not analyze the project
  /// (or parts of it). `null` when everything ran — even with 0 findings.
  failure: string | null;
  /// tsconfig paths that were analyzed (relative to project root).
  configs: string[];
}

async function sh(projectRoot: string, cmd: string): Promise<string> {
  const env = await shellEnv(projectRoot);
  const result = await Command.create('sh', ['-c', cmd], { cwd: projectRoot, env }).execute();
  return result.stdout;
}

async function findTsconfigs(projectRoot: string): Promise<string[]> {
  const out = await sh(
    projectRoot,
    `find . -maxdepth 4 -name tsconfig.json -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.next/*' -not -path '*/target/*' 2>/dev/null | sort`,
  );
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\.\//, ''));
}

function parseTscOutput(
  output: string,
  projectRoot: string,
  problems: Problem[],
  globalErrors: string[],
): void {
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    const m = TSC_LINE.exec(line);
    if (m) {
      const [, file, lineNo, colNo, severity, code, message] = m;
      const path = file!.startsWith('/') ? file! : `${projectRoot}/${file}`;
      const id = `scan:${path}:${lineNo}:${colNo}:${code}`;
      if (!problems.some((p) => p.id === id)) {
        problems.push({
          id,
          path,
          line: Number(lineNo),
          column: Number(colNo),
          message: `${message} (${code})`,
          severity: severity === 'error' ? 'error' : 'warning',
        });
      }
      continue;
    }
    const g = TSC_GLOBAL_ERROR.exec(line);
    if (g) globalErrors.push(`${g[1]}: ${g[2]!.slice(0, 160)}`);
  }
}

export async function scanProject(projectRoot: string): Promise<ScanResult> {
  let configs: string[];
  try {
    configs = await findTsconfigs(projectRoot);
  } catch (e) {
    return { problems: [], failure: `Scan failed to list tsconfigs: ${String(e)}`, configs: [] };
  }

  if (configs.length === 0) {
    return {
      problems: [],
      failure:
        'No tsconfig.json found in the project (searched 4 levels deep) — the TypeScript scan has nothing to analyze. Non-TS projects are not scanned yet.',
      configs: [],
    };
  }

  const problems: Problem[] = [];
  const globalErrors: string[] = [];
  const brokenConfigs: string[] = [];
  // tsc resolves relative diagnostic paths from its CWD (the project root
  // here), so parsed paths absolutize correctly for every sub-package.
  const tscCmd = (config: string) =>
    `pnpm exec tsc --noEmit --pretty false -p ${JSON.stringify(config)} 2>&1 || npx --no-install tsc --noEmit --pretty false -p ${JSON.stringify(config)} 2>&1 || true`;

  for (const config of configs) {
    let output: string;
    try {
      output = await sh(projectRoot, tscCmd(config));
    } catch (e) {
      brokenConfigs.push(`${config}: ${String(e).slice(0, 120)}`);
      continue;
    }
    if (/command not found|not found: tsc|could not determine executable/i.test(output)) {
      return {
        problems: [],
        failure:
          'TypeScript compiler not found: install it in the project (pnpm add -D typescript) or globally (npm i -g typescript).',
        configs,
      };
    }
    const before = globalErrors.length;
    parseTscOutput(output, projectRoot, problems, globalErrors);
    if (globalErrors.length > before) brokenConfigs.push(config);
  }

  const failure =
    globalErrors.length > 0
      ? `Some configs could not be fully analyzed (${brokenConfigs.join(', ')}): ${[...new Set(globalErrors)].slice(0, 3).join(' · ')}`
      : null;
  return { problems, failure, configs };
}
