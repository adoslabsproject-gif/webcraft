import { execPosix } from '../ipc/shell';
import { shellEnv } from './shell-env';

/// Agent-run checkpoints — a git snapshot of the ENTIRE worktree (tracked
/// + untracked, .gitignore respected) taken before every agent run, with a
/// safe rollback. No stash, no touching the user's index: we build the
/// snapshot through a TEMPORARY index file and store it on a hidden ref.
///
/// Rollback restores every file to the snapshot AND deletes files the
/// agent created afterwards (computed by tree diff — never `git clean`,
/// which could eat unrelated ignored files).

export interface Checkpoint {
  id: string;
  commit: string;
  label: string;
  createdAt: number;
}

const MAX_CHECKPOINTS = 10;
const checkpoints: Checkpoint[] = [];

async function git(projectRoot: string, cmd: string): Promise<{ code: number | null; out: string }> {
  const env = await shellEnv(projectRoot);
  const r = await execPosix(cmd, { cwd: projectRoot, env });
  return { code: r.code, out: `${r.stdout}\n${r.stderr}`.trim() };
}

async function isGitRepo(projectRoot: string): Promise<boolean> {
  const r = await git(projectRoot, 'git rev-parse --is-inside-work-tree 2>/dev/null');
  return r.out.includes('true');
}

/// Snapshot the worktree. Returns null (silently) when the project is not
/// a git repo — checkpoints are best-effort, never a blocker for the run.
export async function createCheckpoint(
  projectRoot: string,
  label: string,
): Promise<Checkpoint | null> {
  try {
    if (!(await isGitRepo(projectRoot))) return null;
    const id = `ckpt_${Date.now().toString(36)}`;
    // Temp index → add -A → write-tree → dangling commit → hidden ref.
    const script = [
      `export GIT_INDEX_FILE=.git/webcraft-checkpoint-index`,
      `git add -A 2>/dev/null`,
      `TREE=$(git write-tree)`,
      `PARENT=$(git rev-parse -q --verify HEAD || true)`,
      `if [ -n "$PARENT" ]; then COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "webcraft checkpoint"); else COMMIT=$(git commit-tree "$TREE" -m "webcraft checkpoint"); fi`,
      `git update-ref refs/webcraft/${id} "$COMMIT"`,
      `rm -f .git/webcraft-checkpoint-index`,
      `echo "$COMMIT"`,
    ].join(' && ');
    const r = await git(projectRoot, script);
    const commit = r.out.split('\n').pop()?.trim() ?? '';
    if (!/^[0-9a-f]{7,}$/.test(commit)) return null;
    const ckpt: Checkpoint = { id, commit, label: label.slice(0, 60), createdAt: Date.now() };
    checkpoints.push(ckpt);
    while (checkpoints.length > MAX_CHECKPOINTS) {
      const dropped = checkpoints.shift();
      if (dropped) void git(projectRoot, `git update-ref -d refs/webcraft/${dropped.id}`);
    }
    return ckpt;
  } catch {
    return null;
  }
}

export function lastCheckpoint(): Checkpoint | null {
  return checkpoints[checkpoints.length - 1] ?? null;
}

export function listCheckpoints(): Checkpoint[] {
  return [...checkpoints];
}

/// Restore the worktree to a checkpoint:
///   1. every file in the snapshot is checked out over the worktree
///   2. files that exist NOW (tracked or untracked, ignores respected) but
///      were NOT in the snapshot get deleted — the agent created them.
export async function rollbackTo(
  projectRoot: string,
  ckpt: Checkpoint,
): Promise<{ ok: boolean; message: string }> {
  try {
    const script = [
      // 1. restore snapshot content over the worktree via a temp index
      `export GIT_INDEX_FILE=.git/webcraft-rollback-index`,
      `git read-tree ${ckpt.commit}`,
      `git checkout-index -a -f`,
      `unset GIT_INDEX_FILE`,
      `rm -f .git/webcraft-rollback-index`,
      // 2. delete files not present in the snapshot
      `git ls-tree -r --name-only ${ckpt.commit} | sort > .git/webcraft-snap-files`,
      `git ls-files -co --exclude-standard | sort > .git/webcraft-now-files`,
      `comm -13 .git/webcraft-snap-files .git/webcraft-now-files | while IFS= read -r f; do rm -f "$f"; done`,
      `rm -f .git/webcraft-snap-files .git/webcraft-now-files`,
      `echo ROLLBACK_OK`,
    ].join(' && ');
    const r = await git(projectRoot, script);
    if (!r.out.includes('ROLLBACK_OK')) {
      return { ok: false, message: r.out.slice(-300) };
    }
    const { useAppStore } = await import('../../store/app-store');
    useAppStore.getState().notifyFsChange();
    return {
      ok: true,
      message: `Worktree restored to checkpoint "${ckpt.label}" (${new Date(ckpt.createdAt).toLocaleTimeString()}).`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
