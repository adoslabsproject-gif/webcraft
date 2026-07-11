import { AlertTriangle, Check, Coins, Database as IndexIcon, GitBranch, Loader2, MessageSquare, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { codebaseIndex, type IndexProgress } from '../features/embeddings/codebase-index';
import { useAppStore } from '../store/app-store';
import { useSettingsStore } from '../store/settings-store';

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/// Bottom status bar — folder name, real problems count, open-tab count,
/// active AI provider. Honest about what's wired: no scaffold strings, no
/// "sidecar offline" line for a sidecar that isn't even spawned yet.
export function StatusBar() {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const problems = useAppStore((s) => s.problems);
  const tabCount = useAppStore((s) => s.editorTabs.length);
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const model = useSettingsStore((s) => s.model);
  const tokensInput = useSettingsStore((s) => s.tokensInput);
  const tokensOutput = useSettingsStore((s) => s.tokensOutput);
  const totalTokens = tokensInput + tokensOutput;
  const [indexProgress, setIndexProgress] = useState<IndexProgress>(codebaseIndex.getProgress());
  useEffect(() => codebaseIndex.subscribe(setIndexProgress), []);

  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;

  const folderName = projectRoot ? projectRoot.split('/').filter(Boolean).pop() : null;

  return (
    <footer className="flex h-6 items-center justify-between border-t border-neutral-800 bg-indigo-600/90 px-3 text-[11px] text-white">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1" title={projectRoot ?? 'No folder open'}>
          <GitBranch className="h-3 w-3" />
          {folderName ?? 'no folder'}
        </span>
        <span
          className="flex items-center gap-2"
          title={`${errors} errors, ${warnings} warnings`}
        >
          {errors > 0 ? (
            <span className="flex items-center gap-1">
              <XCircle className="h-3 w-3" />
              {errors}
            </span>
          ) : null}
          {warnings > 0 ? (
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {warnings}
            </span>
          ) : null}
          {errors === 0 && warnings === 0 ? (
            <span className="flex items-center gap-1">
              <Check className="h-3 w-3" />0
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex items-center gap-4">
        {tabCount > 0 ? (
          <span title={`${tabCount} open tab${tabCount === 1 ? '' : 's'}`}>
            {tabCount} {tabCount === 1 ? 'tab' : 'tabs'}
          </span>
        ) : null}
        {totalTokens > 0 ? (
          <span
            className="flex items-center gap-1"
            title={`Session tokens: ${tokensInput} input + ${tokensOutput} output`}
          >
            <Coins className="h-3 w-3" />
            {fmtTokens(totalTokens)}
          </span>
        ) : null}
        {indexProgress.chunks > 0 || !indexProgress.done ? (
          <span
            className="flex items-center gap-1"
            title={
              indexProgress.done
                ? `Codebase index: ${indexProgress.files} files, ${indexProgress.chunks} chunks`
                : `Indexing… ${indexProgress.current?.split('/').pop() ?? ''}`
            }
          >
            {indexProgress.done ? (
              <IndexIcon className="h-3 w-3" />
            ) : (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {fmtTokens(indexProgress.chunks)}
          </span>
        ) : null}
        <span className="flex items-center gap-1" title={`AI provider · ${model}`}>
          <MessageSquare className="h-3 w-3" />
          {activeProvider === 'nha' ? 'Liara' : activeProvider}
        </span>
      </div>
    </footer>
  );
}
