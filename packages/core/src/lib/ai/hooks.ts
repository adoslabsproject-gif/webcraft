import { Command } from '@tauri-apps/plugin-shell';
import { homeDir } from '@tauri-apps/api/path';
import { fileExists } from '../ipc/fs';
import type { ToolUseBlock } from './types';

/// Tool hook system — same UX pattern as Claude Code: drop a shell script
/// into ~/.webcraft/hooks/{pre,post}-<tool_name>.sh and it runs before/after
/// every invocation of that tool.
///
///   pre-<tool>.sh   receives args JSON on stdin → exit 0 to allow, non-zero
///                   to DENY (stderr is shown to the user as the reason)
///   post-<tool>.sh  receives `{args, result}` JSON on stdin → output ignored
///                   unless it exits non-zero (also surfaced as a warning)
///
/// Catch-all hooks: `pre-*.sh` / `post-*.sh` fire for every tool.
/// Project-local override: `<projectRoot>/.webcraft/hooks/<...>` takes
/// precedence over the global ones in $HOME.

export interface HookOutcome {
  allowed: boolean;
  reason?: string;
}

async function hookCandidatesFor(
  phase: 'pre' | 'post',
  toolName: string,
  projectRoot: string | null,
): Promise<string[]> {
  const home = await homeDir();
  const names = [`${phase}-${toolName}.sh`, `${phase}-${toolName}`, `${phase}-_all.sh`, `${phase}-_all`];
  const dirs: string[] = [];
  if (projectRoot) dirs.push(`${projectRoot}/.webcraft/hooks`);
  dirs.push(`${home}/.webcraft/hooks`);
  const candidates: string[] = [];
  for (const dir of dirs) {
    for (const name of names) candidates.push(`${dir}/${name}`);
  }
  return candidates;
}

async function findFirstExisting(candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    try {
      if (await fileExists(c)) return c;
    } catch {
      /* skip */
    }
  }
  return null;
}

/// Run the pre-hook (if any) and decide whether the tool may proceed.
export async function runPreHook(
  call: ToolUseBlock,
  projectRoot: string | null,
): Promise<HookOutcome> {
  const path = await findFirstExisting(await hookCandidatesFor('pre', call.name, projectRoot));
  if (!path) return { allowed: true };
  try {
    const payload = JSON.stringify({ tool: call.name, id: call.id, args: call.input });
    // Pipe JSON to the hook's stdin via /tmp file (Tauri's Command.create
    // does not expose stdin yet for execute()).
    const tmp = `/tmp/webcraft-hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await Command.create('sh', ['-c', `cat > '${tmp}' << 'EOF_WEBCRAFT'\n${payload}\nEOF_WEBCRAFT`]).execute();
    const r = await Command.create('sh', ['-c', `cat '${tmp}' | '${path}'`]).execute();
    await Command.create('rm', ['-f', tmp]).execute();
    if ((r.code ?? 0) === 0) return { allowed: true };
    const reason = (r.stderr || r.stdout || `pre-hook exited ${r.code}`).slice(0, 1000);
    return { allowed: false, reason };
  } catch (e) {
    return { allowed: true, reason: `pre-hook spawn failed: ${e instanceof Error ? e.message : e}` };
  }
}

/// Run the post-hook (if any). Non-zero exit becomes a console warning but
/// does NOT roll back the tool result (the action already happened).
export async function runPostHook(
  call: ToolUseBlock,
  result: { content: string; isError: boolean },
  projectRoot: string | null,
): Promise<{ warning?: string }> {
  const path = await findFirstExisting(await hookCandidatesFor('post', call.name, projectRoot));
  if (!path) return {};
  try {
    const payload = JSON.stringify({
      tool: call.name,
      id: call.id,
      args: call.input,
      result: { content: result.content, isError: result.isError },
    });
    const tmp = `/tmp/webcraft-hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await Command.create('sh', ['-c', `cat > '${tmp}' << 'EOF_WEBCRAFT'\n${payload}\nEOF_WEBCRAFT`]).execute();
    const r = await Command.create('sh', ['-c', `cat '${tmp}' | '${path}'`]).execute();
    await Command.create('rm', ['-f', tmp]).execute();
    if ((r.code ?? 0) !== 0) {
      return { warning: (r.stderr || r.stdout || `post-hook exited ${r.code}`).slice(0, 500) };
    }
    return {};
  } catch (e) {
    return { warning: `post-hook spawn failed: ${e instanceof Error ? e.message : e}` };
  }
}
