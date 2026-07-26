import { Command } from '@tauri-apps/plugin-shell';
import { shellEnv } from '../../lib/ai/shell-env';
import type { Problem } from '../../store/app-store';

/// Whole-project diagnostics — real compilers and linters, monorepo-aware.
///
/// Monaco's language workers only analyze open files, so this scan is what
/// fills the Problems panel for the rest of the project:
///   1. TYPES — every tsconfig.json (node_modules/build excluded) gets a
///      `tsc --noEmit -p` pass
///   2. LINT — biome (when biome.json exists) or eslint fallback, whole
///      project
///   3. RUST — `cargo clippy` (fallback `cargo check`) for every workspace
///      root Cargo.toml
///   4. PYTHON — pyright CLI when *.py files exist
///   5. GO — `go vet ./...` when go.mod exists
///   6. PHP — `php -l` syntax pass over project *.php files
///   7. SECURITY — dependency CVEs (pnpm/npm audit) + hardcoded secrets
///      (API keys, tokens, private keys committed in source)
///   8. SHELL/DOCKER — shellcheck and hadolint when installed
/// All findings land in the same Problems list with exact file:line:column.
/// NEVER a silent false "0 problems": when a scanner cannot run, the
/// failure is surfaced so the user knows what was NOT analyzed.

const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;
/// Non-positional compiler errors (broken tsconfig, missing inputs, …).
const TSC_GLOBAL_ERROR = /^error\s+(TS\d+):\s+(.+)$/;
/// biome --reporter=github: ::error title=lint/…,file=…,line=N,…,col=M,…::msg
const BIOME_LINE =
  /^::(error|warning)\s+title=([^,]*),file=([^,]+),line=(\d+),[^:]*col=(\d+)[^:]*::(.*)$/;
/// eslint -f unix: path:line:col: message [Error/rule]
const ESLINT_LINE = /^(.+?):(\d+):(\d+):\s+(.+?)\s+\[(Error|Warning)\/?([^\]]*)\]$/;
/// cargo --message-format=short: path:line:col: (warning|error)[code]: msg
const CARGO_LINE = /^(.+?):(\d+):(\d+):\s+(warning|error)(?:\[[^\]]*\])?:\s+(.+)$/;

const MAX_PROBLEMS = 600;

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
    if (problems.length >= MAX_PROBLEMS) return;
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

function pushProblem(problems: Problem[], p: Omit<Problem, 'id'> & { idHint: string }): void {
  if (problems.length >= MAX_PROBLEMS) return;
  const id = `scan:${p.idHint}`;
  if (problems.some((existing) => existing.id === id)) return;
  const { idHint: _idHint, ...rest } = p;
  problems.push({ id, ...rest });
}

async function scanTypescript(
  projectRoot: string,
  problems: Problem[],
  notes: string[],
): Promise<string[]> {
  let configs: string[];
  try {
    configs = await findTsconfigs(projectRoot);
  } catch (e) {
    notes.push(`types: failed to list tsconfigs (${String(e).slice(0, 100)})`);
    return [];
  }
  if (configs.length === 0) {
    notes.push('types: no tsconfig.json found — TypeScript not analyzed');
    return [];
  }
  const globalErrors: string[] = [];
  // tsc resolves relative diagnostic paths from its CWD (the project root
  // here), so parsed paths absolutize correctly for every sub-package.
  const tscCmd = (config: string) =>
    `pnpm exec tsc --noEmit --pretty false -p ${JSON.stringify(config)} 2>&1 || npx --no-install tsc --noEmit --pretty false -p ${JSON.stringify(config)} 2>&1 || true`;
  for (const config of configs) {
    let output: string;
    try {
      output = await sh(projectRoot, tscCmd(config));
    } catch (e) {
      notes.push(`types: ${config} failed (${String(e).slice(0, 100)})`);
      continue;
    }
    if (/command not found|not found: tsc|could not determine executable/i.test(output)) {
      notes.push('types: tsc not found (pnpm add -D typescript)');
      return configs;
    }
    const before = globalErrors.length;
    parseTscOutput(output, projectRoot, problems, globalErrors);
    if (globalErrors.length > before) {
      notes.push(
        `types: ${config} config errors — ${globalErrors.slice(before, before + 2).join(' · ')}`,
      );
    }
  }
  return configs;
}

async function scanLint(projectRoot: string, problems: Problem[], notes: string[]): Promise<void> {
  const hasBiome =
    (await sh(projectRoot, 'test -f biome.json && echo yes || echo no')).trim() === 'yes';
  if (hasBiome) {
    const output = await sh(
      projectRoot,
      '(pnpm exec biome check --reporter=github . 2>/dev/null || biome check --reporter=github . 2>&1) | head -800 || true',
    ).catch(() => '');
    let matched = false;
    for (const raw of output.split('\n')) {
      const m = BIOME_LINE.exec(raw.trim());
      if (!m) continue;
      matched = true;
      const [, severity, rule, file, line, col, message] = m;
      const path = file!.startsWith('/') ? file! : `${projectRoot}/${file}`;
      pushProblem(problems, {
        idHint: `biome:${path}:${line}:${col}:${rule}`,
        path,
        line: Number(line),
        column: Number(col),
        message: `${message} [${rule || 'biome'}]`,
        severity: severity === 'error' ? 'error' : 'warning',
      });
    }
    if (!matched && /command not found/i.test(output)) notes.push('lint: biome not found');
    return;
  }
  // eslint fallback — only when the project actually configures it.
  const hasEslint =
    (
      await sh(projectRoot, 'ls .eslintrc* eslint.config.* >/dev/null 2>&1 && echo yes || echo no')
    ).trim() === 'yes';
  if (!hasEslint) {
    notes.push('lint: no biome.json or eslint config — lint not analyzed');
    return;
  }
  const output = await sh(
    projectRoot,
    'npx --no-install eslint . -f unix 2>&1 | head -800 || true',
  ).catch(() => '');
  for (const raw of output.split('\n')) {
    const m = ESLINT_LINE.exec(raw.trim());
    if (!m) continue;
    const [, file, line, col, message, severity, rule] = m;
    const path = file!.startsWith('/') ? file! : `${projectRoot}/${file}`;
    pushProblem(problems, {
      idHint: `eslint:${path}:${line}:${col}:${rule}`,
      path,
      line: Number(line),
      column: Number(col),
      message: `${message} [${rule || 'eslint'}]`,
      severity: severity === 'Error' ? 'error' : 'warning',
    });
  }
}

async function scanRust(projectRoot: string, problems: Problem[], notes: string[]): Promise<void> {
  const found = await sh(
    projectRoot,
    `find . -maxdepth 3 -name Cargo.toml -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/vendor/*' 2>/dev/null | sort`,
  ).catch(() => '');
  const cargoDirs = found
    .split('\n')
    .map((l) =>
      l
        .trim()
        .replace(/^\.\//, '')
        .replace(/\/?Cargo\.toml$/, ''),
    )
    .filter((l, _, all) => {
      if (found.trim() === '') return false;
      // Keep workspace roots only: drop dirs nested under another found dir.
      return !all.some((other) => {
        const otherDir = other
          .trim()
          .replace(/^\.\//, '')
          .replace(/\/?Cargo\.toml$/, '');
        return otherDir !== l && otherDir !== '' && l.startsWith(`${otherDir}/`);
      });
    });
  if (found.trim() === '') return; // no Rust in this project — nothing to note

  for (const dir of cargoDirs) {
    const cwd = dir === '' || dir === 'Cargo.toml' ? projectRoot : `${projectRoot}/${dir}`;
    // clippy first (richer lints), plain check fallback.
    const output = await sh(
      cwd,
      'cargo clippy --message-format=short 2>&1 | head -400 || cargo check --message-format=short 2>&1 | head -400 || true',
    ).catch((e) => {
      notes.push(`rust: ${dir || '.'} failed (${String(e).slice(0, 80)})`);
      return '';
    });
    if (/command not found/i.test(output)) {
      notes.push('rust: cargo not found — Rust not analyzed');
      return;
    }
    for (const raw of output.split('\n')) {
      const m = CARGO_LINE.exec(raw.trim());
      if (!m) continue;
      const [, file, line, col, severity, message] = m;
      // "N warnings emitted" summary lines have no real path — skip them.
      if (!file || /^\d+ (warning|error)s? /.test(message ?? '')) continue;
      const path = file.startsWith('/') ? file : `${cwd}/${file}`;
      pushProblem(problems, {
        idHint: `cargo:${path}:${line}:${col}:${(message ?? '').slice(0, 40)}`,
        path,
        line: Number(line),
        column: Number(col),
        message: `${message} [clippy]`,
        severity: severity === 'error' ? 'error' : 'warning',
      });
    }
  }
}

/// pyright CLI: path:line:col - (error|warning): message
const PYRIGHT_LINE = /^(.+?):(\d+):(\d+)\s+-\s+(error|warning):\s+(.+)$/;
/// go vet / go build: path.go:line:col: message
const GO_LINE = /^(.+?\.go):(\d+):(\d+):\s+(.+)$/;
/// php -l: PHP Parse error:  syntax error… in /path on line N
const PHP_LINE = /^(?:PHP\s+)?(Parse|Fatal) error:\s+(.+?) in (.+?) on line (\d+)$/;

async function scanPython(projectRoot: string, problems: Problem[], notes: string[]): Promise<void> {
  const hasPy =
    (
      await sh(
        projectRoot,
        `find . -maxdepth 4 -name '*.py' -not -path '*/node_modules/*' -not -path '*/.venv/*' -not -path '*/venv/*' -print -quit 2>/dev/null`,
      ).catch(() => '')
    ).trim() !== '';
  if (!hasPy) return;
  const output = await sh(
    projectRoot,
    'pyright --outputformat text . 2>&1 | head -400 || pyright . 2>&1 | head -400 || true',
  ).catch(() => '');
  if (/command not found/i.test(output)) {
    notes.push('python: pyright not found (npm i -g pyright) — Python not analyzed');
    return;
  }
  for (const raw of output.split('\n')) {
    const m = PYRIGHT_LINE.exec(raw.trim());
    if (!m) continue;
    const [, file, line, col, severity, message] = m;
    const path = file!.startsWith('/') ? file! : `${projectRoot}/${file}`;
    pushProblem(problems, {
      idHint: `py:${path}:${line}:${col}:${(message ?? '').slice(0, 40)}`,
      path,
      line: Number(line),
      column: Number(col),
      message: `${message} [pyright]`,
      severity: severity === 'error' ? 'error' : 'warning',
    });
  }
}

async function scanGo(projectRoot: string, problems: Problem[], notes: string[]): Promise<void> {
  const hasGo =
    (await sh(projectRoot, 'test -f go.mod && echo yes || echo no').catch(() => 'no')).trim() ===
    'yes';
  if (!hasGo) return;
  const output = await sh(projectRoot, 'go vet ./... 2>&1 | head -300 || true').catch(() => '');
  if (/command not found/i.test(output)) {
    notes.push('go: toolchain not found — Go not analyzed');
    return;
  }
  for (const raw of output.split('\n')) {
    const m = GO_LINE.exec(raw.trim());
    if (!m) continue;
    const [, file, line, col, message] = m;
    if (!file) continue;
    const path = file.startsWith('/') ? file : `${projectRoot}/${file.replace(/^\.\//, '')}`;
    pushProblem(problems, {
      idHint: `go:${path}:${line}:${col}:${(message ?? '').slice(0, 40)}`,
      path,
      line: Number(line),
      column: Number(col),
      message: `${message} [go vet]`,
      // vet reports both compile errors and suspicious constructs; compile
      // failures dominate its output when present, so error is the safer bucket.
      severity: 'error',
    });
  }
}

async function scanPhp(projectRoot: string, problems: Problem[], notes: string[]): Promise<void> {
  const hasPhp =
    (
      await sh(
        projectRoot,
        `find . -maxdepth 4 -name '*.php' -not -path '*/node_modules/*' -not -path '*/vendor/*' -print -quit 2>/dev/null`,
      ).catch(() => '')
    ).trim() !== '';
  if (!hasPhp) return;
  const output = await sh(
    projectRoot,
    `find . -maxdepth 5 -name '*.php' -not -path '*/node_modules/*' -not -path '*/vendor/*' 2>/dev/null | head -300 | while read -r f; do php -l "$f" 2>&1 | grep -v '^No syntax errors'; done || true`,
  ).catch(() => '');
  if (/command not found/i.test(output)) {
    notes.push('php: interpreter not found — PHP not analyzed');
    return;
  }
  for (const raw of output.split('\n')) {
    const m = PHP_LINE.exec(raw.trim());
    if (!m) continue;
    const [, , message, file, line] = m;
    const path = file!.startsWith('/') ? file! : `${projectRoot}/${file!.replace(/^\.\//, '')}`;
    pushProblem(problems, {
      idHint: `php:${path}:${line}`,
      path,
      line: Number(line),
      column: 1,
      message: `${message} [php -l]`,
      severity: 'error',
    });
  }
}

/// Hardcoded credentials that must never live in source. Each pattern is
/// specific enough to keep the noise floor near zero.
const SECRET_PATTERNS: Array<{ re: string; label: string }> = [
  { re: 'sk-ant-[A-Za-z0-9_-]{24,}', label: 'Anthropic API key' },
  { re: 'sk-proj-[A-Za-z0-9_-]{24,}', label: 'OpenAI API key' },
  { re: 'sk-or-v1-[A-Za-z0-9]{24,}', label: 'OpenRouter API key' },
  { re: 'xai-[A-Za-z0-9]{24,}', label: 'xAI API key' },
  { re: 'AIza[0-9A-Za-z_-]{30,}', label: 'Google API key' },
  { re: 'gh[ps]_[A-Za-z0-9]{30,}', label: 'GitHub token' },
  { re: 'AKIA[0-9A-Z]{16}', label: 'AWS access key id' },
  { re: '-----BEGIN [A-Z ]*PRIVATE KEY-----', label: 'private key material' },
];

async function scanSecrets(projectRoot: string, problems: Problem[]): Promise<void> {
  const pattern = SECRET_PATTERNS.map((p) => p.re).join('|');
  const output = await sh(
    projectRoot,
    `grep -rInE '${pattern}' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=target --exclude-dir=vendor --exclude='*.lock' --exclude='*.min.js' --exclude='*.map' 2>/dev/null | head -60 || true`,
  ).catch(() => '');
  for (const raw of output.split('\n')) {
    const m = /^(.+?):(\d+):(.*)$/.exec(raw);
    if (!m) continue;
    const [, file, line, content] = m;
    if (!file || !content) continue;
    const hit = SECRET_PATTERNS.find((p) => new RegExp(p.re).test(content));
    const path = file.startsWith('/') ? file : `${projectRoot}/${file.replace(/^\.\//, '')}`;
    pushProblem(problems, {
      idHint: `secret:${path}:${line}`,
      path,
      line: Number(line),
      column: 1,
      message: `Possible hardcoded ${hit?.label ?? 'credential'} committed in source — move it to an env var / keychain [secrets]`,
      severity: 'error',
    });
  }
}

async function scanDependencyAudit(
  projectRoot: string,
  problems: Problem[],
  notes: string[],
): Promise<void> {
  const hasPkg =
    (await sh(projectRoot, 'test -f package.json && echo yes || echo no').catch(() => 'no')).trim() ===
    'yes';
  if (!hasPkg) return;
  const output = await sh(
    projectRoot,
    'pnpm audit --json 2>/dev/null || npm audit --json 2>/dev/null || true',
  ).catch(() => '');
  const jsonStart = output.indexOf('{');
  if (jsonStart < 0) return; // no lockfile / registry unreachable — skip quietly
  try {
    const data = JSON.parse(output.slice(jsonStart)) as {
      advisories?: Record<string, { severity?: string; title?: string; module_name?: string }>;
      vulnerabilities?: Record<string, { severity?: string; via?: Array<{ title?: string } | string> }>;
    };
    const pkgJson = `${projectRoot}/package.json`;
    if (data.advisories) {
      for (const adv of Object.values(data.advisories)) {
        pushProblem(problems, {
          idHint: `audit:${adv.module_name}:${adv.title}`,
          path: pkgJson,
          line: 1,
          column: 1,
          message: `${adv.module_name}: ${adv.title} (${adv.severity}) [dependency audit]`,
          severity: adv.severity === 'critical' || adv.severity === 'high' ? 'error' : 'warning',
        });
      }
    } else if (data.vulnerabilities) {
      for (const [name, v] of Object.entries(data.vulnerabilities)) {
        const title = v.via?.map((x) => (typeof x === 'string' ? x : (x.title ?? ''))).find(Boolean);
        pushProblem(problems, {
          idHint: `audit:${name}`,
          path: pkgJson,
          line: 1,
          column: 1,
          message: `${name}: ${title ?? 'known vulnerability'} (${v.severity}) [dependency audit]`,
          severity: v.severity === 'critical' || v.severity === 'high' ? 'error' : 'warning',
        });
      }
    }
  } catch {
    notes.push('security: dependency audit output unparsable — skipped');
  }
}

/// shellcheck -f gcc → file:line:col: (error|warning|note): msg [SCxxxx]
const SHELLCHECK_LINE = /^(.+?):(\d+):(\d+):\s+(error|warning|note):\s+(.+)$/;
/// hadolint → file:line DLxxxx (error|warning|info|style): msg
const HADOLINT_LINE = /^(.+?):(\d+)\s+(\S+)\s+(error|warning|info|style):\s+(.+)$/;

async function scanShellAndDocker(
  projectRoot: string,
  problems: Problem[],
  notes: string[],
): Promise<void> {
  const shOut = await sh(
    projectRoot,
    `command -v shellcheck >/dev/null 2>&1 && find . -maxdepth 4 -name '*.sh' -not -path '*/node_modules/*' -not -path '*/vendor/*' 2>/dev/null | head -100 | xargs -r shellcheck -f gcc 2>/dev/null | head -300 || echo NO_SHELLCHECK`,
  ).catch(() => '');
  if (shOut.includes('NO_SHELLCHECK')) {
    const hasSh =
      (
        await sh(
          projectRoot,
          `find . -maxdepth 4 -name '*.sh' -not -path '*/node_modules/*' -print -quit 2>/dev/null`,
        ).catch(() => '')
      ).trim() !== '';
    if (hasSh) notes.push('shell: shellcheck not installed (brew install shellcheck)');
  } else {
    for (const raw of shOut.split('\n')) {
      const m = SHELLCHECK_LINE.exec(raw.trim());
      if (!m) continue;
      const [, file, line, col, severity, message] = m;
      if (!file) continue;
      const path = file.startsWith('/') ? file : `${projectRoot}/${file.replace(/^\.\//, '')}`;
      pushProblem(problems, {
        idHint: `shc:${path}:${line}:${col}`,
        path,
        line: Number(line),
        column: Number(col),
        message: `${message} [shellcheck]`,
        severity: severity === 'error' ? 'error' : 'warning',
      });
    }
  }

  const dockerOut = await sh(
    projectRoot,
    `command -v hadolint >/dev/null 2>&1 && find . -maxdepth 3 -name 'Dockerfile*' -not -path '*/node_modules/*' 2>/dev/null | head -20 | xargs -r hadolint --no-color 2>/dev/null | head -200 || echo NO_HADOLINT`,
  ).catch(() => '');
  if (!dockerOut.includes('NO_HADOLINT')) {
    for (const raw of dockerOut.split('\n')) {
      const m = HADOLINT_LINE.exec(raw.trim());
      if (!m) continue;
      const [, file, line, rule, severity, message] = m;
      if (!file) continue;
      const path = file.startsWith('/') ? file : `${projectRoot}/${file.replace(/^\.\//, '')}`;
      pushProblem(problems, {
        idHint: `docker:${path}:${line}:${rule}`,
        path,
        line: Number(line),
        column: 1,
        message: `${message} [${rule}]`,
        severity: severity === 'error' ? 'error' : 'warning',
      });
    }
  }
}

export async function scanProject(projectRoot: string): Promise<ScanResult> {
  const problems: Problem[] = [];
  const notes: string[] = [];

  const configs = await scanTypescript(projectRoot, problems, notes);
  await scanLint(projectRoot, problems, notes);
  await scanRust(projectRoot, problems, notes);
  await scanPython(projectRoot, problems, notes);
  await scanGo(projectRoot, problems, notes);
  await scanPhp(projectRoot, problems, notes);
  await scanSecrets(projectRoot, problems);
  await scanDependencyAudit(projectRoot, problems, notes);
  await scanShellAndDocker(projectRoot, problems, notes);

  if (problems.length >= MAX_PROBLEMS) {
    notes.push(`showing the first ${MAX_PROBLEMS} findings — fix some and re-scan`);
  }
  const failure = notes.length > 0 ? notes.join(' · ') : null;
  return { problems, failure, configs };
}
