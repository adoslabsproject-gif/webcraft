import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  CopyCheck,
  Info,
  RefreshCw,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type Problem, useAppStore } from '../../store/app-store';
import { useSettingsStore } from '../../store/settings-store';
import { shellEnv } from '../../lib/ai/shell-env';
import { execPosix } from '../../lib/ipc/shell';
import { fileExists, writeFile } from '../../lib/ipc/fs';
import { revealLocation } from '../editor/editor-controller';
import { runProjectScan } from './auto-scan';
import { mergeProblems } from './merged';

/// Problems panel — diagnostics with per-issue Copy / How-to-fix / AI-fix
/// actions and a bulk "Copy all" in the header. Messages are selectable
/// (`.select-text` opts back in over the global `user-select: none`).
///
/// Clicking a problem opens the file AND jumps to line:column (the reveal
/// is queued in editor-controller until the model is live) while expanding
/// the full, untruncated detail. Right-click opens a context menu with
/// "Copy problem" / "Copy all problems".
export function ProblemsPanel() {
  const liveProblems = useAppStore((s) => s.problems);
  const scanProblems = useAppStore((s) => s.scanProblems);
  const projectRoot = useAppStore((s) => s.projectRoot);
  const openTab = useAppStore((s) => s.openEditorTab);
  const openChatTab = useAppStore((s) => s.openChatTab);
  const scanning = useAppStore((s) => s.scanningProblems);
  const scanFailure = useAppStore((s) => s.problemsScanFailure);
  const [copiedAll, setCopiedAll] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; problem: Problem } | null>(null);

  const problems = mergeProblems(liveProblems, scanProblems);

  const errorCount = problems.filter((p) => p.severity === 'error').length;
  const warningCount = problems.filter((p) => p.severity === 'warning').length;

  function format(p: Problem): string {
    return `[${p.severity}] ${p.path}:${p.line}:${p.column} — ${p.message}`;
  }

  async function copyAll() {
    await navigator.clipboard.writeText(problems.map(format).join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }

  const scanButton = (
    <button
      type="button"
      onClick={() => void runProjectScan()}
      disabled={!projectRoot || scanning}
      title="Project problems refresh automatically on open and on every save — this forces a re-scan now"
      className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] disabled:opacity-40"
    >
      <RefreshCw className={`h-3 w-3 ${scanning ? 'animate-spin' : ''}`} />
      {scanning ? 'Scanning…' : 'Re-scan'}
    </button>
  );

  if (problems.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-fg-dim)]">
        <CheckCircle2 className="h-8 w-8 text-[var(--color-success)]" />
        <p className="text-xs">
          No problems detected. Open files are checked live; the whole project re-scans
          automatically on open and after every save.
        </p>
        {scanButton}
        {scanFailure ? (
          <p className="max-w-md select-text text-center text-[10px] text-[var(--color-warning)]">
            {scanFailure}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[var(--color-danger)]">
            <AlertCircle className="h-3 w-3" />
            {errorCount} error{errorCount === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1 text-[var(--color-warning)]">
            <AlertTriangle className="h-3 w-3" />
            {warningCount} warning{warningCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {scanButton}
          <button
            type="button"
            onClick={() => void copyAll()}
            className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)]"
          >
            {copiedAll ? (
              <>
                <Check className="h-3 w-3 text-[var(--color-success)]" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy all
              </>
            )}
          </button>
        </div>
      </div>
      {scanFailure ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-warning)]/30 bg-[var(--color-warning-muted)] px-3 py-1 text-[10px] text-[var(--color-warning)]">
          <span className="select-text">{scanFailure}</span>
          <MissingToolActions failure={scanFailure} projectRoot={projectRoot} />
        </div>
      ) : null}
      <ul className="flex-1 divide-y divide-[var(--color-border-subtle)] overflow-y-auto">
        {problems.map((p) => (
          <ProblemRow
            key={p.id}
            problem={p}
            onJump={() => {
              openTab({
                id: p.path,
                path: p.path,
                label: p.path.split('/').pop() ?? p.path,
                dirty: false,
              });
              revealLocation(p.path, p.line, p.column);
            }}
            onAskAi={() => openChatTab()}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, problem: p });
            }}
          />
        ))}
      </ul>
      {menu ? (
        <ProblemContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onCopyOne={() => void navigator.clipboard.writeText(format(menu.problem))}
          onCopyAll={() => void copyAll()}
        />
      ) : null}
    </div>
  );
}

/// One-click fixes for missing scanner toolchains. NOTHING installs
/// silently: every action is an explicit button press, runs the exact
/// command shown in its tooltip, and re-scans when done.
function MissingToolActions({
  failure,
  projectRoot,
}: {
  failure: string;
  projectRoot: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions: Array<{ id: string; label: string; cmd?: string }> = [];
  if (failure.includes('shellcheck not installed'))
    actions.push({ id: 'shellcheck', label: 'Install shellcheck', cmd: 'brew install shellcheck' });
  if (failure.includes('pyright not found'))
    actions.push({ id: 'pyright', label: 'Install pyright', cmd: 'npm install -g pyright' });
  if (failure.includes('tsc not found'))
    actions.push({ id: 'tsc', label: 'Install TypeScript', cmd: 'npm install -g typescript' });
  if (failure.includes('no biome.json or eslint config') && projectRoot)
    actions.push({ id: 'biome', label: 'Set up biome lint for this project' });
  if (actions.length === 0) return null;

  async function run(action: { id: string; label: string; cmd?: string }) {
    if (!projectRoot || busy) return;
    setBusy(action.id);
    setError(null);
    try {
      const env = await shellEnv(projectRoot);
      if (action.id === 'biome') {
        // Explicit opt-in project setup: minimal config + local dev dep.
        await writeFile(
          `${projectRoot}/biome.json`,
          `${JSON.stringify(
            {
              $schema: 'https://biomejs.dev/schemas/2.0.0/schema.json',
              linter: { enabled: true },
              formatter: { enabled: false },
            },
            null,
            2,
          )}\n`,
        );
        const pm = (await fileExists(`${projectRoot}/pnpm-lock.yaml`))
          ? 'pnpm add -D @biomejs/biome'
          : 'npm install -D @biomejs/biome';
        const r = await execPosix(`${pm} 2>&1 | tail -3`, { cwd: projectRoot, env });
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || `exit ${r.code}`);
      } else if (action.cmd) {
        const r = await execPosix(`${action.cmd} 2>&1 | tail -3`, { cwd: projectRoot, env });
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || `exit ${r.code}`);
      }
      await runProjectScan();
    } catch (e) {
      setError(`${action.label} failed: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={busy !== null}
          onClick={() => void run(a)}
          title={a.cmd ?? 'Writes biome.json and adds @biomejs/biome as a dev dependency'}
          className="flex items-center gap-1 rounded border border-[var(--color-warning)]/50 px-1.5 py-0.5 text-[10px] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
        >
          {busy === a.id ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : null}
          {busy === a.id ? 'Installing…' : a.label}
        </button>
      ))}
      {error ? <span className="select-text text-[var(--color-danger)]">{error}</span> : null}
    </>
  );
}

/// Floating context menu for a problem row — same interaction contract as
/// FileTreeContextMenu: fixed at cursor, click-outside or Escape closes.
function ProblemContextMenu({
  x,
  y,
  onClose,
  onCopyOne,
  onCopyAll,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onCopyOne: () => void;
  onCopyAll: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const items = [
    { id: 'copy-one', label: 'Copy problem', run: onCopyOne },
    { id: 'copy-all', label: 'Copy all problems', run: onCopyAll },
  ];

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] py-1 shadow-xl"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => {
            item.run();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[var(--color-fg)] hover:bg-[var(--color-bg-hover)]"
        >
          <Copy className="h-3 w-3 text-[var(--color-fg-subtle)]" />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ProblemRow({
  problem,
  onJump,
  onAskAi,
  onContextMenu,
}: {
  problem: Problem;
  onJump: () => void;
  onAskAi: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [showHint, setShowHint] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [copied, setCopied] = useState(false);
  const aiReady = useSettingsStore(
    (s) => s.activeProvider === 'claude-code' || Boolean(s.apiKeys[s.activeProvider]),
  );

  const Icon =
    problem.severity === 'error'
      ? AlertCircle
      : problem.severity === 'warning'
        ? AlertTriangle
        : Info;
  const color =
    problem.severity === 'error'
      ? 'text-[var(--color-danger)]'
      : problem.severity === 'warning'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-info)]';
  const label = problem.path.split('/').pop() ?? problem.path;
  const hint = suggestFix(problem.message);
  const formatted = `[${problem.severity}] ${problem.path}:${problem.line}:${problem.column} — ${problem.message}`;

  async function copyOne() {
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const setChatPrefill = useAppStore((s) => s.setChatPrefill);

  function askAi() {
    const prompt = `I have a problem in my code:\n\nFile: ${problem.path}\nLine: ${problem.line}:${problem.column}\nSeverity: ${problem.severity}\nMessage: ${problem.message}\n\nExplain the cause and how to fix it.`;
    setChatPrefill(prompt);
    onAskAi();
  }

  return (
    <li className="hover:bg-[var(--color-bg-hover)]" onContextMenu={onContextMenu}>
      <div className="flex items-start gap-2 px-3 py-1.5 text-[11px]">
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} />
        <div className="min-w-0 flex-1 select-text">
          <button
            type="button"
            onClick={() => {
              onJump();
              setShowDetail((s) => !s);
            }}
            aria-label="Jump to file"
            title="Go to error — click again to collapse the detail"
            className="block w-full truncate text-left text-[var(--color-fg)]"
          >
            {problem.message}
          </button>
          <div className="select-text font-mono text-[10px] text-[var(--color-fg-subtle)]">
            {label}:{problem.line}:{problem.column}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void copyOne()}
            aria-label="Copy"
            title="Copy this problem"
            className="rounded p-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
          >
            {copied ? (
              <CopyCheck className="h-3 w-3 text-[var(--color-success)]" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
          {hint ? (
            <button
              type="button"
              onClick={() => setShowHint((s) => !s)}
              aria-label="How to fix"
              title="How to fix"
              className="rounded p-0.5 text-[var(--color-info)] hover:bg-[var(--color-info-muted)]"
            >
              <Wrench className="h-3 w-3" />
            </button>
          ) : null}
          {aiReady ? (
            <button
              type="button"
              onClick={askAi}
              aria-label="Fix with AI"
              title="Fix with AI"
              className="rounded p-0.5 text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)]"
            >
              <Sparkles className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>
      {showDetail ? (
        <div className="select-text border-t border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2 text-[10px]">
          <div className="whitespace-pre-wrap text-[var(--color-fg)]">{problem.message}</div>
          <div className="mt-1.5 font-mono text-[var(--color-fg-subtle)]">
            {problem.path}:{problem.line}:{problem.column}
          </div>
          <div className={`mt-0.5 font-semibold uppercase tracking-wider ${color}`}>
            {problem.severity}
          </div>
        </div>
      ) : null}
      {showHint && hint ? (
        <div className="select-text border-t border-[var(--color-info)]/20 bg-[var(--color-info-muted)] px-3 py-2 text-[10px] text-[var(--color-info)]">
          <div className="mb-1 font-semibold uppercase tracking-wider">How to fix</div>
          <div className="text-[var(--color-fg-muted)]">{hint.text}</div>
          {hint.codeBlock ? (
            <pre className="mt-1.5 select-text overflow-x-auto rounded bg-[var(--color-bg)] p-2 font-mono text-[10px] text-[var(--color-fg)]">
              {hint.codeBlock}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

interface FixHint {
  text: string;
  codeBlock?: string;
}

function suggestFix(message: string): FixHint | null {
  if (/Unable to load schema/i.test(message)) {
    return {
      text: 'Monaco JSON validator tries to download the $schema URL. Tauri CSP blocks remote fetch. JSON is still validated locally. Safe to ignore or remove the "$schema" key.',
      codeBlock: '"$schema": "..." → delete this line',
    };
  }
  if (/Parameter '.*' implicitly has an 'any' type/.test(message)) {
    return {
      text: 'TypeScript strict mode requires every parameter to have an explicit type. Add a type annotation:',
      codeBlock: 'function foo(x: number) {} // instead of function foo(x) {}',
    };
  }
  if (/Cannot find name/.test(message)) {
    return { text: 'Undefined identifier — missing import or typo in name.' };
  }
  if (/Type '(.*)' is not assignable to type '(.*)'/.test(message)) {
    return {
      text: 'Type mismatch. Either change the value, widen the target type, or assert with `as Target`.',
    };
  }
  if (/'(.*)' is declared but its value is never read/.test(message)) {
    return {
      text: 'Unused. Delete it, or prefix the name with an underscore to silence (e.g. `_unused`).',
    };
  }
  if (/Property '(.*)' does not exist on type/.test(message)) {
    return {
      text: 'Property not declared. Add to interface, narrow with type guard, or use optional chaining `?.`.',
    };
  }
  if (/Expected (\d+) arguments?, but got (\d+)/.test(message)) {
    return { text: 'Function call arity mismatch. Check the signature.' };
  }
  return null;
}
