import { useAppStore } from '../../store/app-store';
import { readFile, writeFile } from '../ipc/fs';
import { sidecarPost } from '../ipc/sidecar';

/// Real LSP-backed agent tools — goto_definition / find_references /
/// rename_symbol, served by the sidecar's language-server host (which
/// spawns typescript-language-server / pyright / gopls per language).
///
/// One-shot document lifecycle per call: didOpen with the current file
/// content → request → didClose. The language server itself resolves the
/// project (tsconfig etc.) from the rootUri, so cross-file results work.

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  py: 'python',
  go: 'go',
  rs: 'rust',
};

interface LspLocation {
  uri?: string;
  targetUri?: string;
  range?: { start: { line: number; character: number } };
  targetSelectionRange?: { start: { line: number; character: number } };
}

interface TextEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: Array<{ textDocument?: { uri: string }; edits?: TextEdit[] }>;
}

function languageFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const lang = LANG_BY_EXT[ext];
  if (!lang) throw new Error(`No LSP language mapping for .${ext} files`);
  return lang;
}

function toUri(path: string): string {
  return `file://${path}`;
}

function fromUri(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

async function lspContext(path: string) {
  const projectRoot = useAppStore.getState().projectRoot;
  if (!projectRoot) throw new Error('No project root open.');
  const language = languageFor(path);
  const rootUri = toUri(projectRoot);
  const uri = toUri(path);
  const text = await readFile(path);
  return { language, rootUri, uri, text };
}

/// How to install the language server for each language — appended to
/// spawn failures so the error is actionable instead of dead-end.
const LS_INSTALL_HINTS: Record<string, string> = {
  typescript: 'npm install -g typescript-language-server typescript',
  typescriptreact: 'npm install -g typescript-language-server typescript',
  javascript: 'npm install -g typescript-language-server typescript',
  javascriptreact: 'npm install -g typescript-language-server typescript',
  python: 'npm install -g pyright',
  go: 'go install golang.org/x/tools/gopls@latest',
  rust: 'rustup component add rust-analyzer',
};

async function withDocument<T>(
  path: string,
  fn: (ctx: { language: string; rootUri: string; uri: string }) => Promise<T>,
): Promise<T> {
  const { language, rootUri, uri, text } = await lspContext(path);
  try {
    await sidecarPost('/lsp/notify', {
      language,
      rootUri,
      method: 'textDocument/didOpen',
      params: {
        textDocument: { uri, languageId: language, version: 1, text },
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = LS_INSTALL_HINTS[language];
    if (hint && /failed to spawn|not found|ENOENT/i.test(msg)) {
      throw new Error(`Language server for ${language} is not installed. Install it with: ${hint}`);
    }
    throw e;
  }
  try {
    return await fn({ language, rootUri, uri });
  } finally {
    void sidecarPost('/lsp/notify', {
      language,
      rootUri,
      method: 'textDocument/didClose',
      params: { textDocument: { uri } },
    }).catch(() => {});
  }
}

function formatLocations(raw: unknown): string {
  const list: LspLocation[] = Array.isArray(raw)
    ? (raw as LspLocation[])
    : raw
      ? [raw as LspLocation]
      : [];
  if (list.length === 0) return '(no results)';
  return list
    .map((loc) => {
      const uri = loc.uri ?? loc.targetUri ?? '';
      const start = loc.range?.start ?? loc.targetSelectionRange?.start;
      const pos = start ? `:${start.line + 1}:${start.character + 1}` : '';
      return `${fromUri(uri)}${pos}`;
    })
    .join('\n');
}

/// 1-indexed line/column in → LSP 0-indexed position.
function position(line: number, column: number) {
  return { line: line - 1, character: column - 1 };
}

export async function lspDefinition(path: string, line: number, column: number): Promise<string> {
  return withDocument(path, async ({ language, rootUri, uri }) => {
    const result = await sidecarPost<{ result: unknown }>('/lsp/request', {
      language,
      rootUri,
      method: 'textDocument/definition',
      params: { textDocument: { uri }, position: position(line, column) },
    });
    return formatLocations((result as { result?: unknown }).result ?? result);
  });
}

export async function lspReferences(path: string, line: number, column: number): Promise<string> {
  return withDocument(path, async ({ language, rootUri, uri }) => {
    const result = await sidecarPost<{ result: unknown }>('/lsp/request', {
      language,
      rootUri,
      method: 'textDocument/references',
      params: {
        textDocument: { uri },
        position: position(line, column),
        context: { includeDeclaration: true },
      },
    });
    return formatLocations((result as { result?: unknown }).result ?? result);
  });
}

/// Apply a WorkspaceEdit to disk: per file, sort edits bottom-up so earlier
/// offsets stay valid, splice by line/character, write back. Also used by
/// the editor's F2 rename for files without an open Monaco model.
export async function applyWorkspaceEditToDisk(edit: WorkspaceEdit): Promise<string[]> {
  return applyWorkspaceEdit(edit);
}

async function applyWorkspaceEdit(edit: WorkspaceEdit): Promise<string[]> {
  const perFile = new Map<string, TextEdit[]>();
  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      perFile.set(fromUri(uri), edits);
    }
  }
  for (const dc of edit.documentChanges ?? []) {
    if (dc.textDocument?.uri && dc.edits) {
      const path = fromUri(dc.textDocument.uri);
      perFile.set(path, [...(perFile.get(path) ?? []), ...dc.edits]);
    }
  }

  const touched: string[] = [];
  for (const [path, edits] of perFile) {
    const text = await readFile(path);
    const lines = text.split('\n');
    const sorted = [...edits].sort(
      (a, b) =>
        b.range.start.line - a.range.start.line ||
        b.range.start.character - a.range.start.character,
    );
    for (const e of sorted) {
      const { start, end } = e.range;
      const before = lines[start.line]?.slice(0, start.character) ?? '';
      const after = lines[end.line]?.slice(end.character) ?? '';
      const replacement = (before + e.newText + after).split('\n');
      lines.splice(start.line, end.line - start.line + 1, ...replacement);
    }
    await writeFile(path, lines.join('\n'));
    touched.push(path);
  }
  return touched;
}

export async function lspRename(
  path: string,
  line: number,
  column: number,
  newName: string,
): Promise<string> {
  return withDocument(path, async ({ language, rootUri, uri }) => {
    const result = await sidecarPost<{ result?: WorkspaceEdit }>('/lsp/request', {
      language,
      rootUri,
      method: 'textDocument/rename',
      params: { textDocument: { uri }, position: position(line, column), newName },
    });
    const edit = (result as { result?: WorkspaceEdit }).result ?? (result as WorkspaceEdit);
    if (!edit || (!edit.changes && !edit.documentChanges)) {
      return '(no edits — symbol not renameable at that position)';
    }
    const touched = await applyWorkspaceEdit(edit);
    useAppStore.getState().notifyFsChange();
    return `Renamed to "${newName}" in ${touched.length} file${touched.length === 1 ? '' : 's'}:\n${touched.join('\n')}`;
  });
}

const SYMBOL_KINDS: Record<number, string> = {
  1: 'file',
  2: 'module',
  3: 'namespace',
  4: 'package',
  5: 'class',
  6: 'method',
  7: 'property',
  8: 'field',
  9: 'constructor',
  10: 'enum',
  11: 'interface',
  12: 'function',
  13: 'variable',
  14: 'constant',
  15: 'string',
  16: 'number',
  17: 'boolean',
  18: 'array',
  19: 'object',
  20: 'key',
  21: 'null',
  22: 'enum-member',
  23: 'struct',
  24: 'event',
  25: 'operator',
  26: 'type-param',
};

interface DocSymbol {
  name: string;
  kind: number;
  range?: { start: { line: number } };
  selectionRange?: { start: { line: number } };
  location?: { range?: { start: { line: number } } };
  children?: DocSymbol[];
}

function formatSymbols(symbols: DocSymbol[], depth: number): string[] {
  const out: string[] = [];
  for (const s of symbols) {
    const line = (s.selectionRange ?? s.range ?? s.location?.range)?.start.line ?? 0;
    out.push(
      `${'  '.repeat(depth)}${s.name} [${SYMBOL_KINDS[s.kind] ?? s.kind}] (line ${line + 1})`,
    );
    if (s.children?.length) out.push(...formatSymbols(s.children, depth + 1));
  }
  return out;
}

/// Full symbol outline via textDocument/documentSymbol (hierarchical when
/// the server supports it). Returns null when the server yields nothing.
export async function lspDocumentSymbols(path: string): Promise<string | null> {
  return withDocument(path, async ({ language, rootUri, uri }) => {
    const result = await sidecarPost<{ result?: DocSymbol[] }>('/lsp/request', {
      language,
      rootUri,
      method: 'textDocument/documentSymbol',
      params: { textDocument: { uri } },
    });
    const symbols = (result as { result?: DocSymbol[] }).result;
    if (!symbols || symbols.length === 0) return null;
    return formatSymbols(symbols, 0).join('\n');
  });
}

/// Best-effort column when the caller only knows the line: first occurrence
/// of the symbol on that line (1-indexed), else first identifier character.
export async function guessColumn(path: string, line: number, symbol?: string): Promise<number> {
  const text = await readFile(path);
  const target = text.split('\n')[line - 1] ?? '';
  if (symbol) {
    const idx = target.indexOf(symbol);
    if (idx >= 0) return idx + 1;
  }
  const m = /[A-Za-z_$]/.exec(target);
  return m ? m.index + 1 : 1;
}
