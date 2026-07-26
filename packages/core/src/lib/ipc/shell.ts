import { Command } from '@tauri-apps/plugin-shell';
import { fileExists } from './fs';

/// Cross-platform POSIX shell resolution — THE single chokepoint for every
/// feature that runs a `sh -c`-style command string (agent tools, project
/// scan, dev-servers, search, hooks).
///
/// macOS/Linux: plain `sh`.
/// Windows: Git for Windows' bash (allowlisted absolute paths in the Tauri
/// capabilities as `git-bash` / `git-bash-x86`). Git Bash ships the whole
/// coreutils set (grep, find, head, test, …), so the existing POSIX command
/// strings run unchanged. Without it we FAIL LOUDLY with an actionable
/// message instead of the old silent "sh: command not found".

export function isWindows(): boolean {
  return navigator.userAgent.includes('Windows');
}

const GIT_BASH_CANDIDATES: Array<{ scopeName: string; path: string }> = [
  { scopeName: 'git-bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe' },
  { scopeName: 'git-bash-x86', path: 'C:\\Program Files (x86)\\Git\\bin\\bash.exe' },
];

let winBashName: string | null | undefined;

async function windowsBash(): Promise<string | null> {
  if (winBashName !== undefined) return winBashName;
  for (const candidate of GIT_BASH_CANDIDATES) {
    try {
      if (await fileExists(candidate.path)) {
        winBashName = candidate.scopeName;
        return winBashName;
      }
    } catch {
      /* keep looking */
    }
  }
  winBashName = null;
  return null;
}

export const WINDOWS_NO_BASH_HINT =
  'This feature needs a POSIX shell. On Windows, install Git for Windows (it ships bash): https://git-scm.com/download/win — then restart WebCraft.';

export interface ShellSpawn {
  program: string;
  args: string[];
}

/// Resolve the shell invocation for a POSIX command string. Throws with an
/// actionable message when no POSIX shell exists (Windows without Git).
export async function posixShell(cmd: string): Promise<ShellSpawn> {
  if (!isWindows()) return { program: 'sh', args: ['-c', cmd] };
  const bash = await windowsBash();
  if (bash) return { program: bash, args: ['-c', cmd] };
  throw new Error(WINDOWS_NO_BASH_HINT);
}

/// One-call convenience: resolve shell + execute, returning the Command
/// result. Options mirror Command.create's third argument.
export async function execPosix(
  cmd: string,
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const spawn = await posixShell(cmd);
  const result = await Command.create(spawn.program, spawn.args, opts).execute();
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
}

/// For call sites that need the Command object itself (background spawns,
/// event listeners).
export async function createPosix(
  cmd: string,
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<ReturnType<typeof Command.create>> {
  const spawn = await posixShell(cmd);
  return Command.create(spawn.program, spawn.args, opts);
}
