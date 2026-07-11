import * as Tabs from '@radix-ui/react-tabs';
import { AlertCircle, Bot, ChevronDown } from 'lucide-react';
import { useSubagentStore } from '../lib/ai/subagent-store';
import { DiffStreamView } from '../features/diff-viewer/DiffStreamView';
import { OutputPanel } from '../features/output/OutputPanel';
import { ProblemsPanel } from '../features/problems/ProblemsPanel';
import { SubagentPanel } from '../features/subagent/SubagentPanel';
import { TerminalPanel } from '../features/terminal/TerminalPanel';
import type { BottomTab } from '../store/app-store';
import { useAppStore } from '../store/app-store';

/// Bottom dock — Terminal / Diff stream / Problems / Output tabs.
export function BottomPanel() {
  const tab = useAppStore((s) => s.bottomTab);
  const setTab = useAppStore((s) => s.setBottomTab);
  const open = useAppStore((s) => s.bottomPanelOpen);
  const toggle = useAppStore((s) => s.toggleBottomPanel);
  const problems = useAppStore((s) => s.problems);
  const errorCount = problems.filter((p) => p.severity === 'error').length;
  const warningCount = problems.filter((p) => p.severity === 'warning').length;
  const subagentRunning = useSubagentStore((s) => s.transcripts.filter((t) => t.status === 'running').length);
  const subagentTotal = useSubagentStore((s) => s.transcripts.length);

  if (!open) return null;

  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-[var(--color-border-subtle)] bg-[var(--color-bg)]">
      <Tabs.Root
        value={tab}
        onValueChange={(v) => setTab(v as BottomTab)}
        className="flex h-full flex-col"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]">
          <Tabs.List className="flex">
            {(
              [
                { id: 'terminal' as BottomTab, label: 'Terminal' },
                { id: 'problems' as BottomTab, label: 'Problems', badge: errorCount + warningCount },
                { id: 'diff' as BottomTab, label: 'Diff' },
                { id: 'output' as BottomTab, label: 'Output' },
                { id: 'subagents' as BottomTab, label: 'Subagents', badge: subagentTotal },
              ] as const
            ).map((t) => (
              <Tabs.Trigger
                key={t.id}
                value={t.id}
                className="flex items-center gap-1.5 border-b-2 border-transparent px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-fg-subtle)] data-[state=active]:border-[var(--color-accent)] data-[state=active]:text-[var(--color-fg)]"
              >
                {t.id === 'problems' && (errorCount > 0 || warningCount > 0) ? (
                  <AlertCircle
                    className={`h-3 w-3 ${
                      errorCount > 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-warning)]'
                    }`}
                  />
                ) : null}
                {t.id === 'subagents' && subagentRunning > 0 ? (
                  <Bot className="h-3 w-3 animate-pulse text-amber-400" />
                ) : null}
                <span>{t.label}</span>
                {'badge' in t && (t.badge ?? 0) > 0 ? (
                  <span className="rounded-full bg-[var(--color-bg-active)] px-1.5 text-[10px] font-mono text-[var(--color-fg)]">
                    {t.badge}
                  </span>
                ) : null}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <button
            type="button"
            onClick={toggle}
            aria-label="Hide panel"
            className="px-2 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        <Tabs.Content value="terminal" className="min-h-0 flex-1 outline-none">
          <TerminalPanel />
        </Tabs.Content>
        <Tabs.Content value="problems" className="min-h-0 flex-1 outline-none">
          <ProblemsPanel />
        </Tabs.Content>
        <Tabs.Content value="diff" className="min-h-0 flex-1 outline-none">
          <DiffStreamView />
        </Tabs.Content>
        <Tabs.Content value="output" className="min-h-0 flex-1 outline-none">
          <OutputPanel />
        </Tabs.Content>
        <Tabs.Content value="subagents" className="min-h-0 flex-1 outline-none">
          <SubagentPanel />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
