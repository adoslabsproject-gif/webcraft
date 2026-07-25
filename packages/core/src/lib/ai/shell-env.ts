import { Command } from '@tauri-apps/plugin-shell';

/// Shared PATH resolution for EVERY agent tool that spawns a process.
///
/// Tauri's `Command.create` inherits the bare launchd/systemd PATH
/// (`/usr/bin:/bin:...`) — no Homebrew, no nvm/asdf shims, no cargo, no
/// node_modules/.bin. That is why `pnpm`, `npx`, `cargo`, `rg` all failed
/// with "command not found" inside the agent sandbox.
///
/// Strategy (same as VS Code's shell-environment resolution):
///   1. Ask the user's login shell to print the fully-expanded PATH plus a
///      curated set of well-known tool directories ($HOME-relative ones are
///      expanded BY the shell — env PATH entries are never expanded later).
///   2. Cache the result for the whole session (login shells are slow).
///   3. If every shell fails or times out (broken rc file, Windows where
///      `sh` does not exist), fall back to a static absolute-dir list merged
///      with whatever PATH the process inherited.

const EXTRA_DIRS_SHELL =
  '$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/.deno/bin:$HOME/go/bin';

const STATIC_FALLBACK_DIRS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

const RESOLVE_TIMEOUT_MS = 4000;

let cached: Promise<string> | null = null;

async function tryShell(shell: string): Promise<string | null> {
  try {
    const result = await Promise.race([
      Command.create(shell, [
        '-lc',
        `echo -n "$PATH:${EXTRA_DIRS_SHELL}:${STATIC_FALLBACK_DIRS.join(':')}"`,
      ]).execute(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('shell PATH resolution timed out')), RESOLVE_TIMEOUT_MS),
      ),
    ]);
    if (result.code === 0 && result.stdout.includes('/')) return result.stdout.trim();
    return null;
  } catch {
    return null;
  }
}

function dedupe(path: string): string {
  const seen = new Set<string>();
  return path
    .split(':')
    .filter((dir) => {
      if (!dir || seen.has(dir)) return false;
      seen.add(dir);
      return true;
    })
    .join(':');
}

/// Resolve the user's real PATH once per session. Never throws.
export function resolveUserPath(): Promise<string> {
  if (cached) return cached;
  cached = (async () => {
    // zsh is the macOS default; bash covers most Linux setups; plain sh is
    // the last resort (on macOS it still runs path_helper via /etc/profile).
    for (const shell of ['zsh', 'bash', 'sh']) {
      const path = await tryShell(shell);
      if (path) return dedupe(path);
    }
    return dedupe(STATIC_FALLBACK_DIRS.join(':'));
  })();
  return cached;
}

/// Env block for a spawned tool process: real user PATH, with the project's
/// own node_modules/.bin in front so local binaries (tsc, biome, vite, …)
/// win over global installs — exactly like a terminal inside the project.
export async function shellEnv(projectRoot?: string | null): Promise<Record<string, string>> {
  const userPath = await resolveUserPath();
  const path = projectRoot ? dedupe(`${projectRoot}/node_modules/.bin:${userPath}`) : userPath;
  return { PATH: path };
}
