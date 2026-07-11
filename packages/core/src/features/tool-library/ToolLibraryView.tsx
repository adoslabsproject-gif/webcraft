import Editor from '@monaco-editor/react';
import {
  Check,
  Copy,
  Download,
  Filter,
  Library,
  Save,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { writeFile } from '../../lib/ipc/fs';
import { useAppStore } from '../../store/app-store';
import { alert, prompt } from '../dialog/dialog-store';
import {
  CATEGORIES,
  TOOL_TEMPLATES,
  type ToolCategory,
  type ToolTemplate,
} from './templates';

/// Full-area "Tool Library" tab — curated mini-packs of state-of-the-art
/// AI tool code (MCP, function calling, RAG, agentic, multimodal, etc.).
/// Copy to clipboard or save into the open project with one click.
export function ToolLibraryView() {
  const [activeCategory, setActiveCategory] = useState<ToolCategory | 'All'>('All');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ToolTemplate>(TOOL_TEMPLATES[0]!);
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TOOL_TEMPLATES.filter((t) => {
      if (activeCategory !== 'All' && t.category !== activeCategory) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q))
      );
    });
  }, [activeCategory, query]);

  async function copyCode() {
    await navigator.clipboard.writeText(selected.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  async function saveToProject() {
    const projectRoot = useAppStore.getState().projectRoot;
    if (!projectRoot) {
      await alert('No project open', 'Open a project folder first to save the template.');
      return;
    }
    const target = await prompt('Save template', {
      message: 'Where should we put this file? (relative to project root)',
      defaultValue: `tools/${selected.suggestedFileName}`,
    });
    if (!target) return;
    try {
      const fullPath = target.startsWith('/') ? target : `${projectRoot}/${target}`;
      await writeFile(fullPath, selected.code);
      useAppStore.getState().notifyFsChange();
      await alert('Saved', `Wrote ${selected.code.length} bytes to ${fullPath}`);
    } catch (e) {
      await alert('Save failed', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
          <Library className="h-4 w-4 text-cyan-400" />
          Tool Library
          <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan-300">
            2026 state-of-the-art
          </span>
        </div>
        <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
          {TOOL_TEMPLATES.length} templates · {CATEGORIES.length} categories
        </span>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sub-sidebar: filters + template list */}
        <aside className="flex w-[340px] shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/40">
          <div className="border-b border-[var(--color-border-subtle)] p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search templates…"
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] py-1.5 pl-7 pr-2 text-xs text-[var(--color-fg)] focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <CategoryChip
                label="All"
                active={activeCategory === 'All'}
                onClick={() => setActiveCategory('All')}
              />
              {CATEGORIES.map((c) => (
                <CategoryChip
                  key={c}
                  label={c}
                  active={activeCategory === c}
                  onClick={() => setActiveCategory(c)}
                />
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-4 text-[11px] text-[var(--color-fg-dim)]">
                <Filter className="h-4 w-4" />
                No templates match the current filters.
              </div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t)}
                  className={`group flex w-full flex-col items-start gap-1 border-l-2 px-3 py-2 text-left transition-colors ${
                    selected.id === t.id
                      ? 'border-cyan-400 bg-cyan-500/10'
                      : 'border-transparent hover:bg-[var(--color-bg-hover)]'
                  }`}
                >
                  <span className="text-[11px] font-medium text-[var(--color-fg)]">{t.title}</span>
                  <span className="line-clamp-2 text-[10px] text-[var(--color-fg-subtle)]">
                    {t.description}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <span className="rounded bg-cyan-500/10 px-1 py-px text-[9px] font-medium uppercase tracking-wider text-cyan-300">
                      {t.category}
                    </span>
                    <span className="rounded bg-[var(--color-bg)] px-1 py-px font-mono text-[9px] text-[var(--color-fg-muted)]">
                      {t.language}
                    </span>
                    {t.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-[var(--color-bg)] px-1 py-px font-mono text-[9px] text-[var(--color-fg-subtle)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Main area: preview + actions */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-[var(--color-fg)]">{selected.title}</h2>
              <p className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                {selected.description}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan-300">
                  {selected.category}
                </span>
                {selected.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-muted)]"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void copyCode()}
                title="Copy code to clipboard"
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors ${
                  copied ? 'bg-emerald-600' : 'bg-cyan-600 hover:bg-cyan-500'
                }`}
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => void saveToProject()}
                title="Save into the open project"
                className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
              >
                <Save className="h-3 w-3" />
                Save to project
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <Editor
              height="100%"
              language={selected.language}
              value={selected.code}
              theme="vs-dark"
              path={`webcraft://tool-library/${selected.id}.${selected.language === 'typescript' ? 'ts' : selected.language === 'python' ? 'py' : 'js'}`}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                wordWrap: 'on',
                bracketPairColorization: { enabled: true },
              }}
            />
          </div>

          <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-1.5 text-[11px] text-[var(--color-fg-subtle)]">
            <span>
              Suggested filename:{' '}
              <code className="rounded bg-[var(--color-bg)] px-1 font-mono">
                {selected.suggestedFileName}
              </code>
            </span>
            <span className="flex items-center gap-1">
              <Download className="h-3 w-3" />
              {selected.code.split('\n').length} lines · {selected.code.length} chars
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
        active
          ? 'bg-cyan-500/15 text-cyan-300'
          : 'bg-[var(--color-bg)] text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]'
      }`}
    >
      {label}
    </button>
  );
}
