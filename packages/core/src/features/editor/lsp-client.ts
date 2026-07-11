import * as monaco from 'monaco-editor';
import { sidecarGet, sidecarPost } from '../../lib/ipc/sidecar';
import { useAppStore } from '../../store/app-store';

/// LSP <-> Monaco bridge — registers Hover + Definition + Diagnostics
/// providers against the sidecar's /lsp/* endpoints. We keep this minimal
/// (no full monaco-languageclient) because the renderer doesn't need every
/// LSP capability — the high-value wins are hover, goto-def, references,
/// completion, diagnostics.
///
/// Lifecycle per file:
///   - On editor mount: send `textDocument/didOpen` (notify)
///   - On every keystroke (debounced 250ms): send `textDocument/didChange`
///   - On request (hover/definition): wait for the previous didChange to
///     drain, then `textDocument/hover` / `textDocument/definition`
///   - Diagnostics: poll publishDiagnostics buffer from the sidecar
///
/// Failure mode: if the sidecar /lsp/request returns "No LSP configured"
/// or "spawn failed", the provider returns null and Monaco falls back to
/// its built-in TS/JSON validators. Graceful degradation.

const SUPPORTED = new Set([
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
  'python',
  'go',
  'rust',
  'csharp',
  'java',
  'ruby',
  'php',
]);

function projectRootUri(): string | null {
  const root = useAppStore.getState().projectRoot;
  return root ? `file://${root}` : null;
}

function pathToUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

const openedDocs = new Set<string>();
const versions = new Map<string, number>();
const diagsCache = new Map<string, monaco.editor.IMarkerData[]>();

async function lspRequest(language: string, method: string, params?: unknown): Promise<unknown> {
  const rootUri = projectRootUri();
  if (!rootUri) return null;
  try {
    const { result } = await sidecarPost<{ result: unknown }>('/lsp/request', {
      language,
      rootUri,
      method,
      params,
    });
    return result;
  } catch {
    return null;
  }
}

async function lspNotify(language: string, method: string, params?: unknown): Promise<void> {
  const rootUri = projectRootUri();
  if (!rootUri) return;
  try {
    await sidecarPost<{ ok: boolean }>('/lsp/notify', { language, rootUri, method, params });
  } catch {
    /* ignore */
  }
}

async function ensureSupportedLanguage(language: string): Promise<boolean> {
  if (!SUPPORTED.has(language)) return false;
  try {
    const r = await sidecarGet<{ supported: string[] }>('/lsp/languages');
    return r.supported.includes(language);
  } catch {
    return false;
  }
}

async function didOpen(model: monaco.editor.ITextModel): Promise<void> {
  const language = model.getLanguageId();
  if (!(await ensureSupportedLanguage(language))) return;
  const uri = pathToUri(model.uri.path);
  if (openedDocs.has(uri)) return;
  openedDocs.add(uri);
  versions.set(uri, 1);
  await lspNotify(language, 'textDocument/didOpen', {
    textDocument: {
      uri,
      languageId: language,
      version: 1,
      text: model.getValue(),
    },
  });
}

async function didChange(model: monaco.editor.ITextModel): Promise<void> {
  const language = model.getLanguageId();
  if (!(await ensureSupportedLanguage(language))) return;
  const uri = pathToUri(model.uri.path);
  if (!openedDocs.has(uri)) {
    await didOpen(model);
    return;
  }
  const version = (versions.get(uri) ?? 1) + 1;
  versions.set(uri, version);
  await lspNotify(language, 'textDocument/didChange', {
    textDocument: { uri, version },
    contentChanges: [{ text: model.getValue() }],
  });
}

interface LspPos {
  line: number;
  character: number;
}
interface LspRange {
  start: LspPos;
  end: LspPos;
}
interface LspHover {
  contents?: string | { value: string } | Array<string | { value: string }>;
  range?: LspRange;
}
interface LspLocation {
  uri: string;
  range: LspRange;
}

function lspPosFromMonaco(p: monaco.IPosition): LspPos {
  return { line: p.lineNumber - 1, character: p.column - 1 };
}

function monacoRangeFromLsp(r: LspRange): monaco.IRange {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  };
}

let didChangeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDidChange(model: monaco.editor.ITextModel): void {
  if (didChangeTimer) clearTimeout(didChangeTimer);
  didChangeTimer = setTimeout(() => void didChange(model), 250);
}

export function registerLspProviders(): monaco.IDisposable[] {
  const disposables: monaco.IDisposable[] = [];

  // Hover
  disposables.push(
    monaco.languages.registerHoverProvider({ scheme: 'file' }, {
      async provideHover(model, position) {
        const language = model.getLanguageId();
        if (!(await ensureSupportedLanguage(language))) return null;
        await didOpen(model);
        const res = (await lspRequest(language, 'textDocument/hover', {
          textDocument: { uri: pathToUri(model.uri.path) },
          position: lspPosFromMonaco(position),
        })) as LspHover | null;
        if (!res || !res.contents) return null;
        const contents: monaco.IMarkdownString[] = [];
        const push = (c: string | { value: string }) =>
          contents.push({ value: typeof c === 'string' ? c : c.value });
        if (Array.isArray(res.contents)) res.contents.forEach(push);
        else push(res.contents);
        return { contents, range: res.range ? monacoRangeFromLsp(res.range) : undefined };
      },
    } as monaco.languages.HoverProvider),
  );

  // Definition (Cmd+Click)
  disposables.push(
    monaco.languages.registerDefinitionProvider({ scheme: 'file' }, {
      async provideDefinition(model, position) {
        const language = model.getLanguageId();
        if (!(await ensureSupportedLanguage(language))) return null;
        await didOpen(model);
        const res = (await lspRequest(language, 'textDocument/definition', {
          textDocument: { uri: pathToUri(model.uri.path) },
          position: lspPosFromMonaco(position),
        })) as LspLocation | LspLocation[] | null;
        if (!res) return null;
        const arr = Array.isArray(res) ? res : [res];
        return arr.map((l) => ({
          uri: monaco.Uri.parse(l.uri),
          range: monacoRangeFromLsp(l.range),
        }));
      },
    } as monaco.languages.DefinitionProvider),
  );

  // References (Find All References)
  disposables.push(
    monaco.languages.registerReferenceProvider({ scheme: 'file' }, {
      async provideReferences(model, position) {
        const language = model.getLanguageId();
        if (!(await ensureSupportedLanguage(language))) return null;
        await didOpen(model);
        const res = (await lspRequest(language, 'textDocument/references', {
          textDocument: { uri: pathToUri(model.uri.path) },
          position: lspPosFromMonaco(position),
          context: { includeDeclaration: true },
        })) as LspLocation[] | null;
        if (!res) return null;
        return res.map((l) => ({
          uri: monaco.Uri.parse(l.uri),
          range: monacoRangeFromLsp(l.range),
        }));
      },
    } as monaco.languages.ReferenceProvider),
  );

  // Completion (LSP-driven)
  disposables.push(
    monaco.languages.registerCompletionItemProvider({ scheme: 'file' }, {
      triggerCharacters: ['.', '/', '"', "'", ':', '@', '<', '#'],
      async provideCompletionItems(model, position) {
        const language = model.getLanguageId();
        if (!(await ensureSupportedLanguage(language))) return { suggestions: [] };
        await didOpen(model);
        const res = (await lspRequest(language, 'textDocument/completion', {
          textDocument: { uri: pathToUri(model.uri.path) },
          position: lspPosFromMonaco(position),
        })) as { items?: Array<{ label: string; kind?: number; detail?: string; insertText?: string }> } | Array<{ label: string }> | null;
        if (!res) return { suggestions: [] };
        const items = Array.isArray(res) ? res : (res.items ?? []);
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        return {
          suggestions: items.map((it) => ({
            label: it.label,
            kind: ('kind' in it && typeof it.kind === 'number'
              ? (it.kind as monaco.languages.CompletionItemKind)
              : monaco.languages.CompletionItemKind.Variable),
            insertText: ('insertText' in it && typeof it.insertText === 'string'
              ? it.insertText
              : it.label) ?? it.label,
            detail: 'detail' in it && typeof it.detail === 'string' ? it.detail : undefined,
            range,
          })),
        };
      },
    } as monaco.languages.CompletionItemProvider),
  );

  // Wire content changes to keep the server's mirror in sync.
  disposables.push(
    monaco.editor.onDidCreateModel((model) => {
      void didOpen(model);
      const sub = model.onDidChangeContent(() => scheduleDidChange(model));
      disposables.push(sub);
    }),
  );

  return disposables;
}

export function getCachedDiagnostics(path: string): monaco.editor.IMarkerData[] {
  return diagsCache.get(pathToUri(path)) ?? [];
}
