import * as Tabs from '@radix-ui/react-tabs';
import { Database, Network, Plus, Sparkles, Zap } from 'lucide-react';
import { useState } from 'react';
import { AiSchemaDesigner } from './components/AiSchemaDesigner';
import { DatabaseList } from './components/DatabaseList';
import { DbCreationWizard } from './components/DbCreationWizard';
import { IndexManager } from './components/IndexManager';
import { QueryHistory } from './components/QueryHistory';
import { RelationDiagram } from './components/RelationDiagram';
import { ResultGrid } from './components/ResultGrid';
import { SchemaDesigner } from './components/SchemaDesigner';
import { SqlEditor } from './components/SqlEditor';
import { TableBrowser } from './components/TableBrowser';
import { TableExplorerSidebar } from './components/TableExplorerSidebar';
import { TableStructure } from './components/TableStructure';
import { useDbStore } from './db-store';

/// DB Studio full-area view — opened as a singleton tab in the EditorArea.
///
/// Layout (DataGrip / DBeaver / TablePlus-style):
///   ┌──────────────────────────────────────────────────────────┐
///   │  Toolbar: + New DB · Designer · AI Schema                │
///   ├────────────────────────┬─────────────────────────────────┤
///   │  Sub-sidebar (320px)   │  Tabs: Browse | Structure | …  │
///   │  - CONNECTIONS list    │  ┌───────────────────────────┐  │
///   │  - TABLES list         │  │ Tab content uses ALL the  │  │
///   │                        │  │ remaining horizontal      │  │
///   │                        │  │ space. No more cramped    │  │
///   │                        │  │ row rendering.            │  │
///   │                        │  └───────────────────────────┘  │
///   └────────────────────────┴─────────────────────────────────┘

const TABS: { id: string; label: string }[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'structure', label: 'Structure' },
  { id: 'sql', label: 'SQL' },
  { id: 'indexes', label: 'Indexes' },
  { id: 'history', label: 'History' },
  { id: 'diagram', label: 'Diagram' },
];

export function DbStudioView() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [tab, setTab] = useState('browse');
  const activeTable = useDbStore((s) => s.activeTable);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg)]">
      {/* Top toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
          <Database className="h-4 w-4 text-emerald-400" />
          DB Studio
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
            phpMyAdmin · modern · multi-engine
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            New database
          </button>
          <button
            type="button"
            onClick={() => setDesignerOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
          >
            <Network className="h-3.5 w-3.5" />
            Designer
          </button>
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/5 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/15"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI Schema
          </button>
        </div>
      </div>

      {/* Body: sub-sidebar + main area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sub-sidebar with Connections + Tables */}
        <aside className="flex w-[320px] shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/40">
          <div className="flex min-h-0 flex-col">
            <DatabaseList onNew={() => setWizardOpen(true)} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--color-border-subtle)]">
            <TableExplorerSidebar />
          </div>
        </aside>

        {/* Main area: tabs + content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <Tabs.List className="flex shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-2">
              {TABS.map((t) => (
                <Tabs.Trigger
                  key={t.id}
                  value={t.id}
                  onClick={() => {
                    if (t.id === 'indexes' && activeTable) setIndexOpen(true);
                  }}
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-xs font-medium uppercase tracking-wider text-[var(--color-fg-subtle)] transition-colors hover:text-[var(--color-fg)] data-[state=active]:border-emerald-400 data-[state=active]:text-[var(--color-fg)]"
                >
                  {t.id === 'indexes' ? <Zap className="h-3.5 w-3.5 text-amber-400" /> : null}
                  {t.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <Tabs.Content value="browse" className="min-h-0 flex-1 overflow-hidden outline-none">
              <TableBrowser />
            </Tabs.Content>
            <Tabs.Content value="structure" className="min-h-0 flex-1 overflow-hidden outline-none">
              <TableStructure />
            </Tabs.Content>
            <Tabs.Content value="sql" className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none">
              <div className="min-h-[160px] flex-1">
                <SqlEditor />
              </div>
              <div className="min-h-[140px] flex-1 border-t border-[var(--color-border-subtle)]">
                <ResultGrid />
              </div>
            </Tabs.Content>
            <Tabs.Content
              value="indexes"
              className="min-h-0 flex-1 overflow-auto p-4 text-xs text-[var(--color-fg-subtle)] outline-none"
            >
              {activeTable ? (
                <button
                  type="button"
                  onClick={() => setIndexOpen(true)}
                  className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-500"
                >
                  <Zap className="h-3.5 w-3.5" /> Manage indexes for {activeTable}
                </button>
              ) : (
                <p>Select a table from the sidebar to manage its indexes (incl. AI suggestions).</p>
              )}
            </Tabs.Content>
            <Tabs.Content value="history" className="min-h-0 flex-1 overflow-hidden outline-none">
              <QueryHistory />
            </Tabs.Content>
            <Tabs.Content value="diagram" className="min-h-0 flex-1 overflow-hidden outline-none">
              <RelationDiagram />
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>

      {wizardOpen ? <DbCreationWizard onClose={() => setWizardOpen(false)} /> : null}
      {aiOpen ? <AiSchemaDesigner onClose={() => setAiOpen(false)} /> : null}
      {designerOpen ? <SchemaDesigner onClose={() => setDesignerOpen(false)} /> : null}
      {indexOpen && activeTable ? (
        <IndexManager table={activeTable} onClose={() => setIndexOpen(false)} />
      ) : null}
    </div>
  );
}
