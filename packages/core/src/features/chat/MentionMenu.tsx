import { FileCode, Globe, Hash, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { listDir } from '../../lib/ipc/fs';
import { useAppStore } from '../../store/app-store';

/// @-mention dropdown — fires when the user types `@` in the composer.
/// Mirrors Cursor's @-mentions: @file, @symbol, @web, @diagnostics.
///
/// Selection inserts a textual reference (e.g. `@src/app.tsx`) that the
/// model interprets as "include this file's content in my context". The
/// resolver step expands these references into real tool calls or context
/// injection before send.

export interface MentionTarget {
  kind: 'file' | 'symbol' | 'diagnostic' | 'web';
  label: string;
  /// What gets inserted in the textarea (with the leading @).
  insert: string;
}

interface MentionMenuProps {
  query: string;
  onPick: (target: MentionTarget) => void;
  onClose: () => void;
}

const KIND_ICONS = {
  file: FileCode,
  symbol: Hash,
  diagnostic: Search,
  web: Globe,
};

export function MentionMenu({ query, onPick, onClose }: MentionMenuProps) {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const problems = useAppStore((s) => s.problems);
  const [files, setFiles] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(0);

  // Lazy index: list root dir + immediate subdirs (1 level deep is enough
  // for autocomplete; a full ripgrep walk would be overkill for the typing
  // latency budget).
  useEffect(() => {
    if (!projectRoot) return;
    let cancelled = false;
    (async () => {
      try {
        const top = await listDir(projectRoot);
        const all: string[] = [];
        for (const e of top) {
          if (e.isDirectory) {
            if (/(node_modules|\.git|dist|build|target|bin|obj|\.next)/.test(e.name)) continue;
            try {
              const inner = await listDir(e.path);
              for (const f of inner) {
                if (!f.isDirectory) all.push(f.path);
              }
            } catch {
              /* skip */
            }
          } else {
            all.push(e.path);
          }
        }
        if (!cancelled) setFiles(all);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  const matches = useMemo<MentionTarget[]>(() => {
    const q = query.toLowerCase();
    const targets: MentionTarget[] = [];

    // Files
    for (const path of files) {
      const name = path.split('/').pop() ?? path;
      if (name.toLowerCase().includes(q) || (q.length >= 2 && path.toLowerCase().includes(q))) {
        const rel = projectRoot ? path.replace(`${projectRoot}/`, '') : path;
        targets.push({ kind: 'file', label: rel, insert: `@${rel}` });
        if (targets.length > 50) break;
      }
    }

    // Diagnostics (errors/warnings currently in problems[])
    if (q === '' || 'diagnostics'.includes(q) || 'errors'.includes(q) || 'lint'.includes(q)) {
      if (problems.length > 0) {
        targets.unshift({
          kind: 'diagnostic',
          label: `Diagnostics (${problems.length} issues)`,
          insert: '@diagnostics',
        });
      }
    }

    // Web search shortcut
    if (q === '' || 'web'.includes(q) || 'search'.includes(q)) {
      targets.unshift({ kind: 'web', label: 'Web search', insert: '@web:' });
    }

    return targets.slice(0, 30);
  }, [query, files, projectRoot, problems]);

  useEffect(() => {
    setHighlight(0);
  }, [matches.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, matches.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const m = matches[highlight];
        if (m) {
          e.preventDefault();
          e.stopPropagation();
          onPick(m);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [matches, highlight, onPick, onClose]);

  if (matches.length === 0) return null;

  return (
    <div className="pointer-events-auto absolute bottom-full left-2 z-50 mb-1 max-h-[280px] w-[400px] overflow-y-auto rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] py-1 shadow-[var(--shadow-lg)]">
      {matches.map((m, i) => {
        const Icon = KIND_ICONS[m.kind];
        const isActive = i === highlight;
        return (
          <button
            key={`${m.kind}-${m.insert}-${i}`}
            type="button"
            onMouseEnter={() => setHighlight(i)}
            onClick={(e) => {
              e.preventDefault();
              onPick(m);
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
              isActive
                ? 'bg-indigo-500/15 text-[var(--color-fg)]'
                : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-indigo-300" />
            <span className="flex-1 truncate font-mono">{m.label}</span>
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              {m.kind}
            </span>
          </button>
        );
      })}
    </div>
  );
}
