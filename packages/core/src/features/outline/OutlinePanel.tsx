import * as monaco from 'monaco-editor';
import {
  Braces,
  Code2,
  FileType,
  Hash,
  Key,
  ListOrdered,
  Package,
  Type,
  Variable,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/app-store';

/// Outline view — VS Code-style symbols tree of the active file.
/// Backed by Monaco's DocumentSymbolProvider (built-in for TS/JS/JSON/HTML/CSS).

interface Symbol {
  name: string;
  detail: string;
  kind: monaco.languages.SymbolKind;
  range: monaco.IRange;
  children: Symbol[];
}

const KIND_ICON: Record<number, React.ComponentType<{ className?: string }>> = {
  [monaco.languages.SymbolKind.File]: FileType,
  [monaco.languages.SymbolKind.Module]: Package,
  [monaco.languages.SymbolKind.Namespace]: Package,
  [monaco.languages.SymbolKind.Package]: Package,
  [monaco.languages.SymbolKind.Class]: Braces,
  [monaco.languages.SymbolKind.Method]: Code2,
  [monaco.languages.SymbolKind.Property]: Key,
  [monaco.languages.SymbolKind.Field]: Key,
  [monaco.languages.SymbolKind.Constructor]: Code2,
  [monaco.languages.SymbolKind.Enum]: ListOrdered,
  [monaco.languages.SymbolKind.Interface]: Type,
  [monaco.languages.SymbolKind.Function]: Code2,
  [monaco.languages.SymbolKind.Variable]: Variable,
  [monaco.languages.SymbolKind.Constant]: Hash,
  [monaco.languages.SymbolKind.String]: Type,
  [monaco.languages.SymbolKind.Number]: Hash,
  [monaco.languages.SymbolKind.Object]: Braces,
};

const KIND_COLOR: Record<number, string> = {
  [monaco.languages.SymbolKind.Class]: 'text-amber-400',
  [monaco.languages.SymbolKind.Interface]: 'text-sky-400',
  [monaco.languages.SymbolKind.Method]: 'text-violet-400',
  [monaco.languages.SymbolKind.Function]: 'text-violet-400',
  [monaco.languages.SymbolKind.Variable]: 'text-emerald-400',
  [monaco.languages.SymbolKind.Constant]: 'text-emerald-400',
  [monaco.languages.SymbolKind.Property]: 'text-pink-400',
  [monaco.languages.SymbolKind.Field]: 'text-pink-400',
};

export function OutlinePanel() {
  const active = useAppStore((s) => s.editorTabs.find((t) => t.id === s.activeEditorTabId));
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active) {
      setSymbols([]);
      return;
    }
    const uri = monaco.Uri.file(active.path);
    const model = monaco.editor.getModel(uri);
    if (!model) return;

    let cancelled = false;
    setLoading(true);

    // DocumentSymbolProvider runs in the language worker
    const sub = model.onDidChangeContent(() => {
      if (!cancelled) void refresh();
    });

    async function refresh() {
      const providers = monaco.languages.getLanguages();
      void providers; // not directly used — fetch via getSymbols below
      try {
        // Use the language service via Monaco's internal API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const symbolProviders = (monaco.languages as any).getDocumentSymbolProviders?.(model) ?? [];
        for (const p of symbolProviders) {
          const result = await p.provideDocumentSymbols?.(model, { isCancellationRequested: false });
          if (Array.isArray(result) && result.length > 0) {
            if (cancelled) return;
            setSymbols(convertSymbols(result));
            setLoading(false);
            return;
          }
        }
        setSymbols([]);
        setLoading(false);
      } catch {
        setSymbols([]);
        setLoading(false);
      }
    }
    void refresh();
    return () => {
      cancelled = true;
      sub.dispose();
    };
  }, [active]);

  function jump(range: monaco.IRange) {
    if (!active) return;
    const model = monaco.editor.getModel(monaco.Uri.file(active.path));
    if (!model) return;
    // Reveal in any visible editor for that model
    const editors = monaco.editor.getEditors();
    for (const ed of editors) {
      if (ed.getModel() === model) {
        ed.revealRangeInCenter(range);
        ed.setPosition({ lineNumber: range.startLineNumber, column: range.startColumn });
        ed.focus();
        return;
      }
    }
  }

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-xs text-[var(--color-fg-dim)]">
        Open a file to see its outline.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Outline
        </span>
        <span className="text-[10px] text-[var(--color-fg-dim)]">{symbols.length} symbols</span>
      </div>
      {loading && symbols.length === 0 ? (
        <div className="p-3 text-xs text-[var(--color-fg-muted)]">Analyzing…</div>
      ) : symbols.length === 0 ? (
        <div className="p-3 text-[11px] text-[var(--color-fg-subtle)]">
          No symbols (language may not have outline support).
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto py-1">
          {symbols.map((s, i) => (
            <SymbolRow key={i} symbol={s} depth={0} onJump={jump} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SymbolRow({
  symbol,
  depth,
  onJump,
}: {
  symbol: Symbol;
  depth: number;
  onJump: (r: monaco.IRange) => void;
}) {
  const Icon = KIND_ICON[symbol.kind] ?? Code2;
  const color = KIND_COLOR[symbol.kind] ?? 'text-[var(--color-fg-subtle)]';

  return (
    <>
      <li>
        <button
          type="button"
          onClick={() => onJump(symbol.range)}
          style={{ paddingLeft: 8 + depth * 12 }}
          className="flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
        >
          <Icon className={`h-3 w-3 shrink-0 ${color}`} />
          <span className="truncate">{symbol.name}</span>
          {symbol.detail ? (
            <span className="truncate font-mono text-[10px] text-[var(--color-fg-dim)]">
              {symbol.detail}
            </span>
          ) : null}
        </button>
      </li>
      {symbol.children.map((c, i) => (
        <SymbolRow key={i} symbol={c} depth={depth + 1} onJump={onJump} />
      ))}
    </>
  );
}

interface MonacoSymbol {
  name: string;
  detail?: string;
  kind: monaco.languages.SymbolKind;
  range: monaco.IRange;
  children?: MonacoSymbol[];
}

function convertSymbols(raw: MonacoSymbol[]): Symbol[] {
  return raw.map((s) => ({
    name: s.name,
    detail: s.detail ?? '',
    kind: s.kind,
    range: s.range,
    children: s.children ? convertSymbols(s.children) : [],
  }));
}
