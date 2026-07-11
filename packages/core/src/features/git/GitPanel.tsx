import { GitBranch, GitCommit, Minus, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { useAppStore } from '../../store/app-store';
import { generateCommitMessage } from './ai-commit-message';
import { type FileStatus, useGitStore } from './git-store';
import { WorktreePanel } from './WorktreePanel';

/// Git panel — branch + staged/unstaged file list + diff preview + commit
/// box. Backed by `git` via tauri-plugin-shell.
export function GitPanel() {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const branch = useGitStore((s) => s.branch);
  const files = useGitStore((s) => s.files);
  const diff = useGitStore((s) => s.diff);
  const selectedPath = useGitStore((s) => s.selectedPath);
  const message = useGitStore((s) => s.message);
  const busy = useGitStore((s) => s.busy);
  const error = useGitStore((s) => s.error);
  const refresh = useGitStore((s) => s.refresh);
  const setSelected = useGitStore((s) => s.setSelected);
  const stage = useGitStore((s) => s.stage);
  const unstage = useGitStore((s) => s.unstage);
  const commit = useGitStore((s) => s.commit);
  const setMessage = useGitStore((s) => s.setMessage);

  useEffect(() => {
    if (projectRoot) void refresh(projectRoot);
  }, [projectRoot, refresh]);

  if (!projectRoot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-600">
        <GitBranch className="h-8 w-8" />
        <p className="text-xs">Open a folder to see git status.</p>
      </div>
    );
  }

  const staged = files.filter((f) => f.staged);
  const changed = files.filter((f) => !f.staged);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          <GitBranch className="h-3 w-3 text-orange-400" />
          {branch ?? 'no git'}
        </div>
        <button
          type="button"
          onClick={() => projectRoot && void refresh(projectRoot)}
          disabled={busy}
          aria-label="Refresh"
          className="rounded p-0.5 text-neutral-500 hover:text-neutral-200"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error ? (
        <div className="border-b border-red-500/30 bg-red-500/5 px-3 py-1.5 text-[11px] text-red-300">
          {error}
        </div>
      ) : null}

      <div className="flex flex-1 flex-col overflow-hidden">
        <FileGroup
          title="Staged"
          empty="Nothing staged"
          files={staged}
          selectedPath={selectedPath}
          icon={Minus}
          onAction={(p) => projectRoot && void unstage(projectRoot, p)}
          onSelect={(p) => projectRoot && void setSelected(projectRoot, p)}
        />
        <FileGroup
          title="Changes"
          empty="Working tree clean"
          files={changed}
          selectedPath={selectedPath}
          icon={Plus}
          onAction={(p) => projectRoot && void stage(projectRoot, p)}
          onSelect={(p) => projectRoot && void setSelected(projectRoot, p)}
        />

        <div className="border-t border-neutral-800 px-2 py-1.5">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Commit message"
            className="w-full resize-none rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none"
          />
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              disabled={staged.length === 0 || busy}
              onClick={async () => {
                if (!projectRoot) return;
                try {
                  const msg = await generateCommitMessage(projectRoot);
                  setMessage(msg);
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
              disabled={!message.trim() || staged.length === 0 || busy}
              onClick={() => projectRoot && void commit(projectRoot)}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-orange-600 px-2 py-1 text-xs font-medium text-white hover:bg-orange-500 disabled:opacity-40"
            >
              <GitCommit className="h-3 w-3" />
              Commit {staged.length} file{staged.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>

        <pre className="max-h-48 flex-1 overflow-auto border-t border-neutral-800 bg-neutral-950 p-2 font-mono text-[11px]">
          {diff
            ? diff.split('\n').map((line, i) => (
                <div key={i} className={diffLineColor(line)}>
                  {line || ' '}
                </div>
              ))
            : <span className="text-neutral-600">No diff selected</span>}
        </pre>
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
                <span className={`w-3 text-center font-mono ${statusColor(f.status)}`}>{f.status}</span>
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
