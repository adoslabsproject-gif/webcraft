import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  GitCommit,
  GitMerge,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import { useAppStore } from '../../store/app-store';
import { generateCommitMessage } from './ai-commit-message';
import { type FileStatus, useGitStore } from './git-store';
import { WorktreePanel } from './WorktreePanel';

/// Git panel — branch + sync (push/pull with ahead/behind), conflicts with
/// ours/theirs resolution, staged/unstaged file lists, per-hunk staging in
/// the diff preview, commit box. Backed by `git` via tauri-plugin-shell.
export function GitPanel() {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const openEditorTab = useAppStore((s) => s.openEditorTab);
  const branch = useGitStore((s) => s.branch);
  const upstream = useGitStore((s) => s.upstream);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);
  const mergeInProgress = useGitStore((s) => s.mergeInProgress);
  const files = useGitStore((s) => s.files);
  const diffFiles = useGitStore((s) => s.diffFiles);
  const selectedPath = useGitStore((s) => s.selectedPath);
  const selectedStaged = useGitStore((s) => s.selectedStaged);
  const message = useGitStore((s) => s.message);
  const busy = useGitStore((s) => s.busy);
  const syncing = useGitStore((s) => s.syncing);
  const error = useGitStore((s) => s.error);
  const store = useGitStore.getState;

  useEffect(() => {
    if (projectRoot) void store().refresh(projectRoot);
  }, [projectRoot, store]);

  if (!projectRoot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-600">
        <GitBranch className="h-8 w-8" />
        <p className="text-xs">Open a folder to see git status.</p>
      </div>
    );
  }

  const conflicts = files.filter((f) => f.conflicted);
  const staged = files.filter((f) => f.staged && !f.conflicted);
  const changed = files.filter((f) => !f.staged && !f.conflicted);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          <GitBranch className="h-3 w-3 shrink-0 text-orange-400" />
          <span className="truncate">{branch ?? 'no git'}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void store().pull(projectRoot)}
            disabled={syncing || !upstream}
            title={upstream ? `Pull from ${upstream}` : 'No upstream configured'}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
          >
            <ArrowDown className="h-3 w-3" />
            {behind > 0 ? <span className="font-mono">{behind}</span> : null}
          </button>
          <button
            type="button"
            onClick={() => void store().push(projectRoot)}
            disabled={syncing}
            title={upstream ? `Push to ${upstream}` : 'Push and set upstream (origin)'}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
          >
            <ArrowUp className="h-3 w-3" />
            {ahead > 0 ? <span className="font-mono">{ahead}</span> : null}
          </button>
          <button
            type="button"
            onClick={() => projectRoot && void store().fetch(projectRoot)}
            disabled={syncing || busy}
            aria-label="Fetch and refresh"
            title="Fetch and refresh"
            className="rounded p-0.5 text-neutral-500 hover:text-neutral-200 disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy || syncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="select-text border-b border-red-500/30 bg-red-500/5 px-3 py-1.5 text-[11px] text-red-300">
          {error}
        </div>
      ) : null}

      {mergeInProgress ? (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
          <GitMerge className="h-3 w-3" />
          <span className="flex-1">
            Merge in progress — resolve conflicts, then commit to conclude.
          </span>
          <button
            type="button"
            onClick={() => void store().mergeAbort(projectRoot)}
            className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] hover:bg-amber-500/15"
          >
            Abort merge
          </button>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conflicts.length > 0 ? (
            <div>
              <div className="border-b border-neutral-800 bg-neutral-925 px-3 py-1 text-[10px] uppercase tracking-wider text-red-400">
                Conflicts · {conflicts.length}
              </div>
              <ul>
                {conflicts.map((f) => (
                  <li
                    key={f.path}
                    className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] hover:bg-neutral-800/40"
                  >
                    <span className="w-3 text-center font-mono text-red-400">U</span>
                    <button
                      type="button"
                      onClick={() =>
                        openEditorTab({
                          id: `${projectRoot}/${f.path}`,
                          path: `${projectRoot}/${f.path}`,
                          label: f.path.split('/').pop() ?? f.path,
                          dirty: false,
                        })
                      }
                      className="flex-1 truncate text-left text-neutral-300"
                      title={`Open ${f.path} to resolve by hand`}
                    >
                      {f.path}
                    </button>
                    <button
                      type="button"
                      onClick={() => void store().resolveConflict(projectRoot, f.path, 'ours')}
                      title="Keep OUR version (current branch)"
                      className="rounded border border-neutral-700 px-1 py-0.5 text-[9px] text-neutral-400 hover:bg-neutral-800"
                    >
                      Ours
                    </button>
                    <button
                      type="button"
                      onClick={() => void store().resolveConflict(projectRoot, f.path, 'theirs')}
                      title="Take THEIR version (incoming branch)"
                      className="rounded border border-neutral-700 px-1 py-0.5 text-[9px] text-neutral-400 hover:bg-neutral-800"
                    >
                      Theirs
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <FileGroup
            title="Staged"
            empty="Nothing staged"
            files={staged}
            selectedPath={selectedPath}
            icon={Minus}
            onAction={(p) => void store().unstage(projectRoot, p)}
            onSelect={(p) => void store().setSelected(projectRoot, p, true)}
          />
          <FileGroup
            title="Changes"
            empty="Working tree clean"
            files={changed}
            selectedPath={selectedPath}
            icon={Plus}
            onAction={(p) => void store().stage(projectRoot, p)}
            onSelect={(p) => void store().setSelected(projectRoot, p, false)}
          />
        </div>

        <div className="border-t border-neutral-800 px-2 py-1.5">
          <textarea
            value={message}
            onChange={(e) => store().setMessage(e.target.value)}
            rows={2}
            placeholder="Commit message"
            className="w-full resize-none rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none"
          />
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              disabled={staged.length === 0 || busy}
              onClick={async () => {
                try {
                  const msg = await generateCommitMessage(projectRoot);
                  store().setMessage(msg);
                } catch (e) {
                  const { alert } = await import('../dialog/dialog-store');
                  await alert('AI commit failed', e instanceof Error ? e.message : String(e));
                }
              }}
              title="Generate commit message from staged diff"
              className="flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/5 px-2 py-1 text-[11px] text-indigo-300 hover:bg-indigo-500/15 disabled:opacity-40"
            >
              <Sparkles className="h-3 w-3" />
              AI
            </button>
            <button
              type="button"
              disabled={!message.trim() || (staged.length === 0 && !mergeInProgress) || busy}
              onClick={() => void store().commit(projectRoot)}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-orange-600 px-2 py-1 text-xs font-medium text-white hover:bg-orange-500 disabled:opacity-40"
            >
              <GitCommit className="h-3 w-3" />
              {mergeInProgress ? 'Commit merge' : `Commit ${staged.length} file${staged.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>

        <div className="max-h-56 flex-1 overflow-auto border-t border-neutral-800 bg-neutral-950 p-2 font-mono text-[11px]">
          {diffFiles.length > 0 ? (
            diffFiles.map((fd) =>
              fd.hunks.map((h, hi) => (
                <div key={`${fd.path}-${hi}`} className="mb-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-indigo-300">{h.header}</span>
                    <button
                      type="button"
                      onClick={() =>
                        void (selectedStaged
                          ? store().unstageHunk(projectRoot, h.patch)
                          : store().stageHunk(projectRoot, h.patch))
                      }
                      title={selectedStaged ? 'Unstage this hunk' : 'Stage this hunk'}
                      className="flex shrink-0 items-center gap-0.5 rounded border border-neutral-700 px-1 py-0.5 text-[9px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                    >
                      {selectedStaged ? (
                        <>
                          <X className="h-2.5 w-2.5" /> Unstage hunk
                        </>
                      ) : (
                        <>
                          <Plus className="h-2.5 w-2.5" /> Stage hunk
                        </>
                      )}
                    </button>
                  </div>
                  {h.lines.map((line, i) => (
                    <div key={i} className={`select-text ${diffLineColor(line)}`}>
                      {line || ' '}
                    </div>
                  ))}
                </div>
              )),
            )
          ) : (
            <span className="text-neutral-600">No diff selected</span>
          )}
        </div>
        <WorktreePanel />
      </div>
    </div>
  );
}

function diffLineColor(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-emerald-300';
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-red-300';
  if (line.startsWith('@@')) return 'text-indigo-300';
  return 'text-neutral-500';
}

function FileGroup({
  title,
  empty,
  files,
  selectedPath,
  onAction,
  onSelect,
  icon: Icon,
}: {
  title: string;
  empty: string;
  files: { status: FileStatus; path: string; staged: boolean }[];
  selectedPath: string | null;
  onAction: (path: string) => void;
  onSelect: (path: string) => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div>
      <div className="border-b border-neutral-800 bg-neutral-925 px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-500">
        {title} · {files.length}
      </div>
      {files.length === 0 ? (
        <div className="px-3 py-1.5 text-[11px] text-neutral-600">{empty}</div>
      ) : (
        <ul>
          {files.map((f) => (
            <li
              key={`${f.path}-${f.staged ? 's' : 'u'}`}
              className={`flex items-center gap-1.5 px-2 py-0.5 text-[11px] hover:bg-neutral-800/40 ${
                selectedPath === f.path ? 'bg-neutral-800/60' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onAction(f.path)}
                className="rounded p-0.5 text-neutral-500 hover:text-neutral-200"
                aria-label={f.staged ? 'Unstage' : 'Stage'}
              >
                <Icon className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onSelect(f.path)}
                className="flex flex-1 items-center gap-1.5 truncate text-left"
              >
                <span className={`w-3 text-center font-mono ${statusColor(f.status)}`}>
                  {f.status}
                </span>
                <span className="truncate text-neutral-300">{f.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusColor(s: FileStatus): string {
  if (s === 'A') return 'text-emerald-400';
  if (s === 'D') return 'text-red-400';
  if (s === 'M') return 'text-amber-400';
  if (s === '?') return 'text-neutral-500';
  return 'text-neutral-400';
}
