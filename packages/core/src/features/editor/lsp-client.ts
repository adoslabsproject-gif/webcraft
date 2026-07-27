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
        })) as
          | {
              items?: Array<{ label: string; kind?: number; detail?: string; insertText?: string }>;
            }
          | Array<{ label: string }>
          | null;
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
            kind:
              'kind' in it && typeof it.kind === 'number'
                ? (it.kind as monaco.languages.CompletionItemKind)
                : monaco.languages.CompletionItemKind.Variable,
            insertText:
              ('insertText' in it && typeof it.insertText === 'string'
                ? it.insertText
                : it.label) ?? it.label,
            detail: 'detail' in it && typeof it.detail === 'string' ? it.detail : undefined,
            range,
          })),
        };
      },
    } as monaco.languages.CompletionItemProvider),
  );

  // Signature help (parameter hints while typing a call)
  disposables.push(
    monaco.languages.registerSignatureHelpProvider({ scheme: 'file' }, {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [')'],
      async provideSignatureHelp(model, position) {
        const language = model.getLanguageId();
        if (!(await ensureSupportedLanguage(language))) return null;
        await didOpen(model);
        const res = (await lspRequest(language, 'textDocument/signatureHelp', {
          textDocument: { uri: pathToUri(model.uri.path) },
          position: lspPosFromMonaco(position),
        })) as {
          signatures?: Array<{
            label: string;
            documentation?: string | { value: string };
            parameters?: Array<{ label: string | [number, number] }>;
          }>;
          activeSignature?: number;
          activeParameter?: number;
        } | null;
        if (!res?.signatures?.length) return null;
        return {
          value: {
            signatures: res.signatures.map((s) => ({
              label: s.label,
              documentation:
                typeof s.documentation === 'object' ? s.documentation.value : s.documentation,
              parameters: (s.parameters ?? []).map((p) => ({ label: p.label })),
            })),
            activeSignature: res.activeSignature ?? 0,
            activeParameter: res.activeParameter ?? 0,
          },
          dispose() {},
        };
      },
    } as monaco.languages.SignatureHelpProvider),
  );

  // Code actions (quick-fix lightbulb)
  disposables.push(
    monaco.languages.registerCodeActionProvider({ scheme: 'file' }, {
      async provideCodeActions(model, range, context) {
        const language = model.getLanguageId();
        if (!(await ensureSupportedLanguage(language))) return null;
        await didOpen(model);
        const uri = pathToUri(model.uri.path);
        const res = (await lspRequest(language, 'textDocument/codeAction', {
          textDocument: { uri },
          range: {
            start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
            end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
          },
          context: {
            diagnostics: context.markers.map((mk) => ({
              range: {
                start: { line: mk.startLineNumber - 1, character: mk.startColumn - 1 },
                end: { line: mk.endLineNumber - 1, character: mk.endColumn - 1 },
              },
              message: mk.message,
              severity: mk.severity === monaco.MarkerSeverity.Error ? 1 : 2,
            })),
          },
        })) as Array<{
          title: string;
          kind?: string;
          isPreferred?: boolean;
          edit?: LspWorkspaceEdit;
        }> | null;
        if (!res?.length) return null;
        const actions: monaco.languages.CodeAction[] = res
          .filter((a) => a.edit)
          .map((a) => ({
            title: a.title,
            kind: a.kind ?? 'quickfix',
            isPreferred: a.isPreferred ?? false,
            edit: monacoWorkspaceEdit(a.edit!),
            diagnostics: [],
          }));
        return { actions, dispose() {} };
      },
    } as monaco.languages.CodeActionProvider),
  );

  // Rename (F2) — current file edits go through Monaco; edits in files not
  // open in the editor are applied straight to disk.
  disposables.push(
    monaco.languages.registerRenameProvider({ scheme: 'file' }, {
      async provideRenameEdits(model, position, newName) {
        const language = model.getLanguageId();
        if (!(await ensureSupportedLanguage(language))) return null;
        await didOpen(model);
        const uri = pathToUri(model.uri.path);
        const res = (await lspRequest(language, 'textDocument/rename', {
          textDocument: { uri },
          position: lspPosFromMonaco(position),
          newName,
        })) as LspWorkspaceEdit | null;
        if (!res) return null;
        const { current, foreign } = splitWorkspaceEdit(res, uri);
        if (foreign.changes && Object.keys(foreign.changes).length > 0) {
          const { applyWorkspaceEditToDisk } = await import('../../lib/ai/lsp-tools');
          void applyWorkspaceEditToDisk(foreign).then(() => {
            useAppStore.getState().notifyFsChange();
          });
        }
        return monacoWorkspaceEdit(current);
      },
    } as monaco.languages.RenameProvider),
  );

  // Document formatting (⌥⇧F / format-on-save)
  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider({ scheme: 'file' }, {
      async provideDocumentFormattingEdits(model, options) {
        const language = model.getLanguageId();
        if (!(await ensureSupportedLanguage(language))) return null;
        await didOpen(model);
        const res = (await lspRequest(language, 'textDocument/formatting', {
          textDocument: { uri: pathToUri(model.uri.path) },
          options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
        })) as Array<{ range: LspRange; newText: string }> | null;
        if (!res?.length) return null;
        return res.map((e) => ({ range: monacoRangeFromLsp(e.range), text: e.newText }));
      },
    } as monaco.languages.DocumentFormattingEditProvider),
  );

  // Wire content changes to keep the server's mirror in sync + poll the
  // server's publishDiagnostics into Monaco markers (owner 'lsp'), which
  // flow into the Problems tab through the marker pipeline.
  disposables.push(
    monaco.editor.onDidCreateModel((model) => {
      void didOpen(model);
      const sub = model.onDidChangeContent(() => scheduleDidChange(model));
      disposables.push(sub);
    }),
  );
  const diagTimer = setInterval(() => void pollDiagnostics(), 1500);
  disposables.push({ dispose: () => clearInterval(diagTimer) });

  return disposables;
}

interface LspWorkspaceEdit {
  changes?: Record<string, Array<{ range: LspRange; newText: string }>>;
}

function splitWorkspaceEdit(
  edit: LspWorkspaceEdit,
  currentUri: string,
): { current: LspWorkspaceEdit; foreign: LspWorkspaceEdit } {
  const current: LspWorkspaceEdit = { changes: {} };
  const foreign: LspWorkspaceEdit = { changes: {} };
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    // Edits for files with an OPEN Monaco model go through Monaco (undo
    // stack, dirty state); everything else is written to disk directly.
    const hasModel = monaco.editor.getModels().some((m) => pathToUri(m.uri.path) === uri);
    if (uri === currentUri || hasModel) current.changes![uri] = edits;
    else foreign.changes![uri] = edits;
  }
  return { current, foreign };
}

function monacoWorkspaceEdit(edit: LspWorkspaceEdit): monaco.languages.WorkspaceEdit {
  const edits: monaco.languages.IWorkspaceTextEdit[] = [];
  for (const [uri, textEdits] of Object.entries(edit.changes ?? {})) {
    for (const e of textEdits) {
      edits.push({
        resource: monaco.Uri.parse(uri),
        versionId: undefined,
        textEdit: { range: monacoRangeFromLsp(e.range), text: e.newText },
      });
    }
  }
  return { edits };
}

const LSP_SEVERITY: Record<number, monaco.MarkerSeverity> = {
  1: monaco.MarkerSeverity.Error,
  2: monaco.MarkerSeverity.Warning,
  3: monaco.MarkerSeverity.Info,
  4: monaco.MarkerSeverity.Hint,
};

async function pollDiagnostics(): Promise<void> {
  const rootUri = projectRootUri();
  if (!rootUri) return;
  for (const model of monaco.editor.getModels()) {
    if (model.uri.scheme !== 'file') continue;
    const language = model.getLanguageId();
    if (!SUPPORTED.has(language)) continue;
    const uri = pathToUri(model.uri.path);
    if (!openedDocs.has(uri)) continue;
    try {
      const { sidecarPost } = await import('../../lib/ipc/sidecar');
      const { diagnostics } = await sidecarPost<{
        diagnostics: Array<{ range: LspRange; message: string; severity?: number; code?: unknown }>;
      }>('/lsp/diagnostics', { language, rootUri, uri });
      const markers: monaco.editor.IMarkerData[] = diagnostics.map((d) => ({
        ...monacoRangeFromLsp(d.range),
        message: d.message,
        severity: LSP_SEVERITY[d.severity ?? 1] ?? monaco.MarkerSeverity.Error,
        ...(d.code != null ? { code: String(d.code) } : {}),
      }));
      diagsCache.set(uri, markers);
      monaco.editor.setModelMarkers(model, 'lsp', markers);
    } catch {
      /* sidecar down — keep whatever markers exist */
    }
  }
}

export function getCachedDiagnostics(path: string): monaco.editor.IMarkerData[] {
  return diagsCache.get(pathToUri(path)) ?? [];
}
