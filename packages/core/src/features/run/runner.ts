import { Command } from '@tauri-apps/plugin-shell';
import { listDir, readFile } from '../../lib/ipc/fs';
import { useDevServerStore } from '../dev-server/dev-server-store';

/// Run dispatcher — given a file path, pick the right runner and execute it.
/// Returns a short description of what was launched so the UI can confirm.
///
/// Behavior matrix:
///   .html  → spawn static dev-server on the parent dir + open Preview
///   .js / .mjs / .cjs / .ts → `node` (or `tsx` for .ts), output → terminal
///   .py    → `python3 <file>`
///   .rb    → `ruby <file>`
///   .go    → `go run <file>`
///   .rs    → `cargo run` if Cargo.toml exists, else `rustc && ./out`
///   .sh    → `sh <file>`
///   .php   → `php <file>`
///   package.json    → list npm scripts
///   .sln / .slnx    → list .NET solution actions (build/run/test) + per-project
///   .csproj         → dotnet run/build/test on that project
///   Cargo.toml      → cargo run/build/test
///   go.mod          → go run / go build / go test
///   pyproject.toml  → poetry run / pytest / ruff
///   ?      → empty (Run not applicable)

export type RunChoice =
  | { kind: 'auto'; label: string; runFn: () => Promise<void> }
  | { kind: 'script'; name: string; cmd: string; runFn: () => Promise<void> };

export async function planRun(filePath: string, projectRoot: string | null): Promise<RunChoice[]> {
  const cwd = projectRoot ?? filePath.split('/').slice(0, -1).join('/');
  const name = filePath.split('/').pop() ?? '';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  if (name === 'package.json') {
    return parsePackageJsonScripts(filePath, cwd);
  }
  if (ext === 'sln' || ext === 'slnx') {
    return planDotnetSolution(filePath, cwd);
  }
  if (ext === 'csproj' || ext === 'fsproj' || ext === 'vbproj') {
    return planDotnetProject(filePath, cwd);
  }
  if (name === 'Cargo.toml') {
    return planCargoProject(cwd);
  }
  if (name === 'go.mod') {
    return planGoModule(cwd);
  }
  if (name === 'pyproject.toml') {
    return planPyProject(filePath, cwd);
  }
  if (name === 'requirements.txt') {
    return planPythonRequirements(cwd);
  }

  if (ext === 'html' || ext === 'htm') {
    const fileDir = filePath.split('/').slice(0, -1).join('/');
    return [
      {
        kind: 'auto',
        label: 'Start static server + preview',
        runFn: async () => {
          await useDevServerStore.getState().start({
            runtime: 'static',
            cwd: fileDir,
            command: 'npx --yes sirv-cli --port ${PORT} --single .',
            port: 8080,
          });
        },
      },
    ];
  }

  const RUNNERS: Record<string, { label: string; cmd: string[]; argFile?: boolean }> = {
    js: { label: 'Run with Node', cmd: ['node'], argFile: true },
    mjs: { label: 'Run with Node', cmd: ['node'], argFile: true },
    cjs: { label: 'Run with Node', cmd: ['node'], argFile: true },
    ts: { label: 'Run with tsx', cmd: ['npx', '--yes', 'tsx'], argFile: true },
    tsx: { label: 'Run with tsx', cmd: ['npx', '--yes', 'tsx'], argFile: true },
    py: { label: 'Run with Python', cmd: ['python3'], argFile: true },
    rb: { label: 'Run with Ruby', cmd: ['ruby'], argFile: true },
    sh: { label: 'Run with sh', cmd: ['sh'], argFile: true },
    bash: { label: 'Run with bash', cmd: ['bash'], argFile: true },
    php: { label: 'Run with PHP', cmd: ['php'], argFile: true },
    go: { label: 'Run with Go', cmd: ['go', 'run'], argFile: true },
  };

  const runner = RUNNERS[ext];
  if (!runner) return [];

  return [
    {
      kind: 'auto',
      label: runner.label,
      runFn: async () => {
        const args = [...runner.cmd.slice(1), ...(runner.argFile ? [filePath] : [])];
        const result = await Command.create(runner.cmd[0] ?? 'sh', args, { cwd }).execute();
        const out = `\n$ ${runner.cmd.join(' ')} ${filePath}\n${result.stdout}\n${result.stderr}\n[exit ${result.code}]`;
        window.dispatchEvent(new CustomEvent('webcraft:run:output', { detail: out }));
      },
    },
  ];
}

/// Run a shell command and stream its result into the Output panel.
function runShell(cmd: string, args: string[], cwd: string): () => Promise<void> {
  return async () => {
    const result = await Command.create(cmd, args, { cwd }).execute();
    const out = `\n$ ${cmd} ${args.join(' ')}\n${result.stdout}\n${result.stderr}\n[exit ${result.code}]`;
    window.dispatchEvent(new CustomEvent('webcraft:run:output', { detail: out }));
  };
}

/// Project classification — drives which dotnet sub-commands make sense.
/// Library = build only. Exe / WinExe = run + build. Test SDK = test + build.
type DotnetProjectKind = 'exe' | 'library' | 'test';

async function classifyDotnetProject(csprojAbsPath: string): Promise<DotnetProjectKind> {
  try {
    const raw = await readFile(csprojAbsPath);
    // Test projects use the Microsoft.NET.Sdk.Test SDK or reference xunit/nunit/mstest.
    if (
      /Sdk="Microsoft\.NET\.Sdk\.Test"/.test(raw) ||
      /<IsPackable>false<\/IsPackable>[\s\S]*Microsoft\.NET\.Test\.Sdk/.test(raw) ||
      /PackageReference\s+Include="(xunit|NUnit|MSTest\.TestFramework|Microsoft\.NET\.Test\.Sdk)"/.test(raw)
    ) {
      return 'test';
    }
    // <OutputType>Exe</OutputType> or WinExe → runnable
    if (/<OutputType>\s*(WinExe|Exe)\s*<\/OutputType>/i.test(raw)) return 'exe';
    return 'library';
  } catch {
    // If we can't read the csproj, fall back to filename heuristic.
    if (/\.Tests?\.csproj$/i.test(csprojAbsPath)) return 'test';
    return 'library';
  }
}

/// .NET solution (.sln / .slnx) — emits one set of choices per project
/// classified by what it actually IS (exe/library/test). Class libraries
/// don't get a useless "run" choice that would crash with NETSDK1144.
async function planDotnetSolution(slnPath: string, cwd: string): Promise<RunChoice[]> {
  const choices: RunChoice[] = [
    {
      kind: 'script',
      name: 'build solution',
      cmd: `dotnet build "${slnPath.split('/').pop() ?? ''}"`,
      runFn: runShell('dotnet', ['build', slnPath], cwd),
    },
    {
      kind: 'script',
      name: 'test solution',
      cmd: 'dotnet test',
      runFn: runShell('dotnet', ['test', slnPath], cwd),
    },
    {
      kind: 'script',
      name: 'restore packages',
      cmd: 'dotnet restore',
      runFn: runShell('dotnet', ['restore', slnPath], cwd),
    },
  ];
  try {
    const raw = await readFile(slnPath);
    const projects = extractProjectsFromSolution(raw);
    // Classify each project in parallel so the picker doesn't stall on big solutions.
    const classified = await Promise.all(
      projects.map(async (rel) => {
        const abs = `${cwd}/${rel}`;
        return { rel, abs, kind: await classifyDotnetProject(abs) };
      }),
    );
    // Sort: runnable exes first (so the user sees the actual app entrypoint
    // at the top), then libraries, then tests.
    const order: Record<DotnetProjectKind, number> = { exe: 0, library: 1, test: 2 };
    classified.sort((a, b) => order[a.kind] - order[b.kind]);

    // Build all per-project choices then prepend in reverse so the order is preserved.
    const perProject: RunChoice[] = [];
    for (const p of classified) {
      const label = p.rel.split('/').pop()?.replace(/\.(cs|fs|vb)proj$/, '') ?? p.rel;
      if (p.kind === 'exe') {
        perProject.push({
          kind: 'script',
          name: `▶ run ${label}`,
          cmd: `dotnet run --project ${p.rel}`,
          runFn: runShell('dotnet', ['run', '--project', p.rel], cwd),
        });
      } else if (p.kind === 'test') {
        perProject.push({
          kind: 'script',
          name: `test ${label}`,
          cmd: `dotnet test ${p.rel}`,
          runFn: runShell('dotnet', ['test', p.rel], cwd),
        });
      } else {
        // Library — only "build" makes sense at the per-project level.
        perProject.push({
          kind: 'script',
          name: `build ${label} (library)`,
          cmd: `dotnet build ${p.rel}`,
          runFn: runShell('dotnet', ['build', p.rel], cwd),
        });
      }
    }
    return [...perProject, ...choices];
  } catch {
    return choices;
  }
}

function extractProjectsFromSolution(raw: string): string[] {
  // .slnx (XML) → <Project Path="..." />
  const xmlMatches = [...raw.matchAll(/<Project\s+Path="([^"]+)"/g)].map((m) => m[1]!);
  if (xmlMatches.length > 0) return xmlMatches;
  // .sln (classic) → Project("{guid}") = "Name", "path/Name.csproj", "{guid2}"
  return [...raw.matchAll(/Project\("[^"]+"\)\s*=\s*"[^"]+",\s*"([^"]+\.(?:cs|fs|vb)proj)"/g)]
    .map((m) => m[1]!);
}

async function planDotnetProject(csprojPath: string, cwd: string): Promise<RunChoice[]> {
  const kind = await classifyDotnetProject(csprojPath);
  const choices: RunChoice[] = [];
  if (kind === 'exe') {
    choices.push({
      kind: 'script',
      name: '▶ run',
      cmd: `dotnet run --project "${csprojPath}"`,
      runFn: runShell('dotnet', ['run', '--project', csprojPath], cwd),
    });
  } else if (kind === 'test') {
    choices.push({
      kind: 'script',
      name: 'test',
      cmd: `dotnet test "${csprojPath}"`,
      runFn: runShell('dotnet', ['test', csprojPath], cwd),
    });
  }
  choices.push({
    kind: 'script',
    name: kind === 'library' ? 'build (library — not runnable)' : 'build',
    cmd: `dotnet build "${csprojPath}"`,
    runFn: runShell('dotnet', ['build', csprojPath], cwd),
  });
  return choices;
}

async function planCargoProject(cwd: string): Promise<RunChoice[]> {
  return [
    { kind: 'script', name: 'run', cmd: 'cargo run', runFn: runShell('cargo', ['run'], cwd) },
    { kind: 'script', name: 'build', cmd: 'cargo build', runFn: runShell('cargo', ['build'], cwd) },
    { kind: 'script', name: 'test', cmd: 'cargo test', runFn: runShell('cargo', ['test'], cwd) },
    { kind: 'script', name: 'check', cmd: 'cargo check', runFn: runShell('cargo', ['check'], cwd) },
    {
      kind: 'script',
      name: 'release build',
      cmd: 'cargo build --release',
      runFn: runShell('cargo', ['build', '--release'], cwd),
    },
  ];
}

async function planGoModule(cwd: string): Promise<RunChoice[]> {
  return [
    { kind: 'script', name: 'run', cmd: 'go run .', runFn: runShell('go', ['run', '.'], cwd) },
    {
      kind: 'script',
      name: 'build',
      cmd: 'go build ./...',
      runFn: runShell('go', ['build', './...'], cwd),
    },
    { kind: 'script', name: 'test', cmd: 'go test ./...', runFn: runShell('go', ['test', './...'], cwd) },
  ];
}

async function planPyProject(filePath: string, cwd: string): Promise<RunChoice[]> {
  // Detect Poetry / PDM / plain pyproject by reading a small slice.
  const choices: RunChoice[] = [];
  try {
    const raw = await readFile(filePath);
    if (/\[tool\.poetry\]/.test(raw)) {
      choices.push(
        { kind: 'script', name: 'poetry install', cmd: 'poetry install', runFn: runShell('poetry', ['install'], cwd) },
        { kind: 'script', name: 'poetry run pytest', cmd: 'poetry run pytest', runFn: runShell('poetry', ['run', 'pytest'], cwd) },
      );
    }
    if (/\[project\]/.test(raw)) {
      choices.push(
        { kind: 'script', name: 'pip install -e .', cmd: 'pip install -e .', runFn: runShell('pip', ['install', '-e', '.'], cwd) },
      );
    }
  } catch {
    /* fall through */
  }
  choices.push({ kind: 'script', name: 'pytest', cmd: 'pytest', runFn: runShell('pytest', [], cwd) });
  return choices;
}

async function planPythonRequirements(cwd: string): Promise<RunChoice[]> {
  return [
    {
      kind: 'script',
      name: 'pip install -r requirements.txt',
      cmd: 'pip install -r requirements.txt',
      runFn: runShell('pip', ['install', '-r', 'requirements.txt'], cwd),
    },
    { kind: 'script', name: 'pytest', cmd: 'pytest', runFn: runShell('pytest', [], cwd) },
  ];
}

async function parsePackageJsonScripts(filePath: string, _projectRoot: string): Promise<RunChoice[]> {
  // CRITICAL: cwd MUST be the directory containing this package.json, not the
  // workspace projectRoot. Otherwise `npm run start` executes against the wrong
  // tree (e.g. user opened ~/ as projectRoot but a real package.json lives in
  // ~/Sites/Foo/ — scripts like "node src/server.js" resolve relative to cwd
  // and would crash with MODULE_NOT_FOUND).
  const pkgDir = filePath.split('/').slice(0, -1).join('/');
  try {
    const raw = await readFile(filePath);
    const json = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = json.scripts ?? {};
    return Object.entries(scripts).map(([name, cmd]) => ({
      kind: 'script' as const,
      name,
      cmd,
      runFn: async () => {
        const pm = await detectPackageManager(pkgDir);

        // Port conflict pre-flight: detect a hardcoded port in the script
        // command and check if it's already taken. Surface a clear warning
        // so the user knows BEFORE the run fails with the cryptic Vite
        // "Port X already in use" message.
        await maybeWarnPortConflict(name, cmd, pkgDir);

        // Reproduce a real terminal PATH so binaries installed via Homebrew
        // (pnpm), nvm/asdf (node), and the project's own node_modules/.bin
        // (turbo, vite, tsc, next, ...) are all resolvable. Tauri's
        // Command.create otherwise inherits an essentially bare PATH.
        const fullPath = [
          `${pkgDir}/node_modules/.bin`,
          '/opt/homebrew/bin',
          '/opt/homebrew/sbin',
          '/usr/local/bin',
          '/usr/local/sbin',
          '/usr/bin',
          '/bin',
          '/usr/sbin',
          '/sbin',
          '$HOME/.local/bin',
          '$HOME/.bun/bin',
          '$HOME/.deno/bin',
          '$HOME/.cargo/bin',
          '$PATH',
        ].join(':');
        // Force monorepo orchestrators (turbo, nx, lerna) to dump FULL logs
        // of every sub-task — including the one that failed. Without these,
        // a `@medea/ui#build` failure shows just "exited (2)" with no
        // visible reason. Env vars are honoured by each tool natively:
        //   - turbo  → TURBO_LOG_ORDER=stream, TURBO_LOG_OUTPUT=full, TURBO_UI=false
        //   - nx     → NX_VERBOSE_LOGGING=true, FORCE_COLOR=0
        //   - lerna  → npm_config_loglevel=info
        // FORCE_COLOR=0 also keeps the output readable in our non-TTY pane.
        const verboseEnv = [
          'export TURBO_LOG_ORDER=stream',
          'export TURBO_LOG_OUTPUT=full',
          'export TURBO_UI=false',
          'export NX_VERBOSE_LOGGING=true',
          'export FORCE_COLOR=0',
          'export CI=1', // many tools fall back to plain log mode under CI
        ].join('; ');
        const result = await Command.create(
          'sh',
          ['-c', `export PATH="${fullPath}"; ${verboseEnv}; ${pm} run ${name}`],
          { cwd: pkgDir },
        ).execute();
        const header = `\n$ cd ${pkgDir}\n$ ${pm} run ${name}\n`;
        const out = `${header}${result.stdout}\n${result.stderr}\n[exit ${result.code}]`;
        window.dispatchEvent(new CustomEvent('webcraft:run:output', { detail: out }));
      },
    }));
  } catch {
    return [];
  }
}

/// Package manager detection — robust multi-strategy:
///   1. package.json `packageManager` field (corepack spec, authoritative)
///   2. Lockfile presence in pkgDir
///   3. Walk up parent dirs (monorepo: lock lives at workspace root)
///   4. Default: npm
/// Heuristic: detect ports a Vite/Tauri script will try to bind and act on
/// the conflict — auto-kill orphan dev servers from previous failed runs
/// of the same project (the most common cause once we moved WebCraft to
/// 11420). Other conflicts get a warning + suggestion in the Output panel.
async function maybeWarnPortConflict(scriptName: string, cmd: string, pkgDir: string): Promise<void> {
  const SUSPECT = /(vite|tauri|next|webpack-dev-server|astro|nuxt)/i;
  if (!SUSPECT.test(scriptName) && !SUSPECT.test(cmd)) return;
  const candidates = [
    'vite.config.ts',
    'vite.config.js',
    'vite.config.mjs',
    'src-tauri/tauri.conf.json',
  ];
  const ports = new Set<number>([1420, 5173]);
  for (const c of candidates) {
    try {
      const text = await readFile(`${pkgDir}/${c}`);
      for (const m of text.matchAll(/port["']?\s*[:=]\s*['"]?(\d{2,5})/gi)) {
        const p = Number(m[1]);
        if (p > 1024 && p < 65535) ports.add(p);
      }
      for (const m of text.matchAll(/localhost:(\d{2,5})/gi)) {
        const p = Number(m[1]);
        if (p > 1024 && p < 65535) ports.add(p);
      }
    } catch {
      /* missing config — skip */
    }
  }
  const taken: Array<{ port: number; pid: number; command: string }> = [];
  for (const p of ports) {
    const holder = await portHolder(p);
    if (holder) taken.push({ port: p, ...holder });
  }
  if (taken.length === 0) return;

  // Auto-kill orphan dev servers: if the holder is a `node`/`vite`/`webpack`
  // process AND it's an orphan (no parent dev script keeping it alive), we
  // reap it. This matches the common medea-style failure: previous
  // beforeDevCommand bound 1420, then Cargo Tauri crashed and left Vite
  // running unattended.
  const reaped: Array<{ port: number; pid: number; command: string }> = [];
  for (const t of taken) {
    if (await isReapableDevServer(t.pid, t.command)) {
      try {
        await Command.create('kill', ['-9', String(t.pid)]).execute();
        reaped.push(t);
      } catch {
        /* permission denied — fall through to warning */
      }
    }
  }

  if (reaped.length > 0) {
    const lines = reaped.map((r) => `  ✓ killed ${r.command} pid=${r.pid} (was holding port ${r.port})`);
    window.dispatchEvent(
      new CustomEvent('webcraft:run:output', {
        detail: `\n[Run] Reaped orphan dev server${reaped.length === 1 ? '' : 's'} from a previous failed run:\n${lines.join('\n')}\n`,
      }),
    );
    // Give the kernel a beat to actually release the socket before re-binding.
    await new Promise((r) => setTimeout(r, 300));
  }

  // Anything still taken at this point belongs to a NON-reapable process
  // (foreign app, system service, owner-different). Warn with full diagnosis.
  const remaining: typeof taken = [];
  for (const t of taken) {
    if (await portHolder(t.port)) remaining.push(t);
  }
  if (remaining.length === 0) return;
  const lines = remaining.map(
    (r) =>
      `  Port ${r.port} held by ${r.command} (pid ${r.pid}) — kill with: kill -9 ${r.pid}`,
  );
  const msg =
    `\n[Run] ⚠ Port conflict pre-flight (could not auto-reap):\n${lines.join('\n')}\n` +
    `  Or change the port in vite.config / tauri.conf.json (e.g. ${suggestFreePort(remaining[0]!.port)}).\n`;
  window.dispatchEvent(new CustomEvent('webcraft:run:output', { detail: msg }));
}

/// Returns the holder pid+command of the given port, or null if free.
async function portHolder(port: number): Promise<{ pid: number; command: string } | null> {
  try {
    const r = await Command.create('lsof', [
      '-iTCP:' + port,
      '-sTCP:LISTEN',
      '-n',
      '-P',
      '-Fpc',
    ]).execute();
    const out = r.stdout?.trim() ?? '';
    if (!out) return null;
    // lsof -F output: `p<pid>\nc<command>\n` per fd. Take the first.
    const lines = out.split('\n');
    let pid: number | null = null;
    let command = '';
    for (const line of lines) {
      if (line.startsWith('p')) pid = Number(line.slice(1));
      else if (line.startsWith('c')) command = line.slice(1);
      if (pid !== null && command) break;
    }
    return pid !== null ? { pid, command } : null;
  } catch {
    return null;
  }
}

/// A process is "reapable" if it's a recognised dev-server binary AND it's
/// either an orphan (parent is launchd / init) or its parent is no longer
/// running. We're deliberately conservative: only kill things that LOOK
/// like leftover Vite/Webpack/Next/Tauri children.
async function isReapableDevServer(pid: number, command: string): Promise<boolean> {
  const looksDevServer = /^(node|vite|webpack|next|esbuild|bun|deno)/i.test(command);
  if (!looksDevServer) return false;
  try {
    const r = await Command.create('ps', ['-p', String(pid), '-o', 'ppid=,command=']).execute();
    const line = r.stdout?.trim() ?? '';
    if (!line) return true;
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!m) return false;
    const ppid = Number(m[1]);
    const argv = (m[2] ?? '').toLowerCase();
    // Must look like a dev server (vite/webpack/next/tauri in argv)
    const argvHints = /(vite|webpack|webpack-dev-server|next-server|tauri|astro|nuxt)/.test(argv);
    if (!argvHints) return false;
    // Parent must be dead OR launchd/init (1 on macOS/Linux) — that's an orphan.
    if (ppid === 1) return true;
    const parent = await Command.create('ps', ['-p', String(ppid), '-o', 'comm=']).execute();
    return (parent.stdout?.trim() ?? '') === '';
  } catch {
    return false;
  }
}

function suggestFreePort(taken: number): number {
  return taken + 1000;
}

async function detectPackageManager(pkgDir: string): Promise<'pnpm' | 'yarn' | 'bun' | 'npm'> {
  // 1. Authoritative: `packageManager` field in package.json (corepack standard).
  try {
    const raw = await readFile(`${pkgDir}/package.json`);
    const json = JSON.parse(raw) as { packageManager?: string };
    const pm = json.packageManager?.split('@')[0];
    if (pm === 'pnpm' || pm === 'yarn' || pm === 'bun' || pm === 'npm') return pm;
  } catch {
    /* fall through */
  }

  // 2 + 3. Look for a lockfile here, then walk up to 6 levels (monorepo).
  let dir = pkgDir;
  for (let depth = 0; depth < 6; depth++) {
    try {
      const names = (await listDir(dir)).map((e) => e.name);
      if (names.includes('pnpm-lock.yaml') || names.includes('pnpm-workspace.yaml')) return 'pnpm';
      if (names.includes('yarn.lock')) return 'yarn';
      if (names.includes('bun.lock') || names.includes('bun.lockb')) return 'bun';
      if (names.includes('package-lock.json')) return 'npm';
    } catch {
      break;
    }
    const parent = dir.split('/').slice(0, -1).join('/');
    if (parent === dir || parent === '') break;
    dir = parent;
  }

  return 'npm';
}

/// Result of `planActiveRun()` — the Toolbar uses this to decide whether to
/// run immediately, show a picker, or surface "nothing to run".
export type ActiveRunPlan =
  | { status: 'nothing' }
  | { status: 'one'; choice: RunChoice; source: string }
  | { status: 'many'; choices: RunChoice[]; source: string };

/// Top-level "Run" planner used by the Toolbar play button.
///
/// Strategy:
///   - Active file is a runnable script (.js/.ts/.py/...) → status 'one'
///   - Active file is package.json → list all scripts as 'many'
///   - No active file + projectRoot has package.json → list all its scripts
///   - Otherwise 'nothing'
///
/// NEVER auto-picks `dev` / `start`. The caller is responsible for surfacing
/// a picker when status === 'many' — that's the only safe default when the
/// user might be sitting inside the very project that's currently running.
export async function planActiveRun(
  filePath: string | null,
  projectRoot: string | null,
): Promise<ActiveRunPlan> {
  // CRITICAL: only honour the active editor tab if the file actually lives
  // INSIDE the current projectRoot. Otherwise a stale tab from a previous
  // project (e.g. user had getloud/package.json open, then opened Sara — the
  // tab survived) would hijack Play and run that foreign project instead of
  // the one whose folder is currently open.
  const activeFileInProject =
    filePath &&
    !filePath.startsWith('webcraft://') &&
    (projectRoot ? filePath.startsWith(`${projectRoot}/`) : true);

  if (activeFileInProject && filePath) {
    const choices = await planRun(filePath, projectRoot);
    if (choices.length === 1 && choices[0]) {
      return { status: 'one', choice: choices[0], source: filePath.split('/').pop() ?? filePath };
    }
    if (choices.length > 1) {
      return { status: 'many', choices, source: filePath.split('/').pop() ?? filePath };
    }
  }
  if (projectRoot) {
    const entry = await detectProjectEntrypoint(projectRoot);
    if (entry) {
      const choices = await planRun(entry.path, projectRoot);
      if (choices.length === 1 && choices[0]) {
        return { status: 'one', choice: choices[0], source: entry.label };
      }
      if (choices.length > 1) {
        return { status: 'many', choices, source: entry.label };
      }
    }
  }
  return { status: 'nothing' };
}

/// Probe the project root for known entrypoints. Order matters — the first
/// match wins. Adding a new ecosystem is one entry away.
async function detectProjectEntrypoint(
  root: string,
): Promise<{ path: string; label: string } | null> {
  let entries: string[] = [];
  try {
    entries = (await listDir(root)).map((e) => e.name);
  } catch {
    return null;
  }
  const has = (n: string) => entries.includes(n);
  if (has('package.json')) return { path: `${root}/package.json`, label: 'package.json' };
  // .slnx / .sln — match any file with these extensions (Sara has Sara.slnx)
  const sln = entries.find((n) => /\.(slnx|sln)$/.test(n));
  if (sln) return { path: `${root}/${sln}`, label: sln };
  if (has('Cargo.toml')) return { path: `${root}/Cargo.toml`, label: 'Cargo.toml' };
  if (has('go.mod')) return { path: `${root}/go.mod`, label: 'go.mod' };
  if (has('pyproject.toml')) return { path: `${root}/pyproject.toml`, label: 'pyproject.toml' };
  if (has('requirements.txt')) return { path: `${root}/requirements.txt`, label: 'requirements.txt' };
  // Single .csproj at the root (common for simple .NET apps)
  const csproj = entries.find((n) => /\.(csproj|fsproj|vbproj)$/.test(n));
  if (csproj) return { path: `${root}/${csproj}`, label: csproj };
  return null;
}

/// Heuristic: return true if `projectRoot` is the WebCraft IDE source itself
/// (i.e. the directory hosting THIS running app). Lets the UI warn the user
/// before they accidentally launch `pnpm dev` against the very project that's
/// keeping their editor alive on port 1420.
export async function isWebcraftSourceRoot(projectRoot: string | null): Promise<boolean> {
  if (!projectRoot) return false;
  try {
    const raw = await readFile(`${projectRoot}/package.json`);
    const json = JSON.parse(raw) as { name?: string; workspaces?: unknown };
    if (typeof json.name === 'string' && /^webcraft($|-)/i.test(json.name)) return true;
    // Workspace root that contains `apps/desktop` matching @webcraft/desktop:
    if (json.workspaces) {
      try {
        const desktopPkg = await readFile(`${projectRoot}/apps/desktop/package.json`);
        if (/"@webcraft\/desktop"/.test(desktopPkg)) return true;
      } catch {
        /* not a webcraft workspace */
      }
    }
  } catch {
    /* no package.json or unreadable */
  }
  return false;
}
