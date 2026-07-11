import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { Command, type Child } from '@tauri-apps/plugin-shell';
import { useAppStore } from '../../store/app-store';
import { recordHunk } from '../../features/diff-viewer/diff-store';
import { useTaskStore } from '../../features/tasks/task-store';
import { createDir, fileExists, listDir, readFile, removePath, renamePath, writeFile } from '../ipc/fs';
import { requirePermission } from './permissions';
import { renderUnifiedDiff } from './diff-format';
import { runPostHook, runPreHook } from './hooks';
import type { ToolUseBlock } from './types';

/// Execute a tool_use block produced by the model and return the
/// `tool_result` content + isError flag. Every tool here is deterministic.
///
/// Read-before-write guard: write_file/edit_file remember which files
/// the current session has read_file'd, and refuse to overwrite an
/// existing file we haven't read.

const readSession = new Set<string>();
const backgroundProcs = new Map<string, { child: Child; logs: string[] }>();

/// Tool name aliases. The model sometimes calls a tool by a slightly different
/// name than what's registered (history of the catalog, training data drift,
/// or just a common-sense synonym). Map them to the canonical handler instead
/// of failing with "Unknown tool" — failing produces ugly retry loops where
/// the model keeps trying the same wrong name 4 times.
const ALIASES: Record<string, string> = {
  // Catalog says find_files, handler is glob — same operation.
  find_files: 'glob',
  find_file: 'glob',
  find: 'glob',
  search_files: 'glob',
  locate_file: 'glob',
  // Common synonyms the model invents
  search: 'grep',
  search_in_files: 'grep',
  list_dir: 'list_directory',
  ls: 'list_directory',
  cat: 'read_file',
  open_file: 'read_file',
  view_file: 'read_file',
  create_file: 'write_file',
  save_file: 'write_file',
  bash: 'run_command',
  shell: 'run_command',
  exec: 'run_command',
  remove_file: 'delete_file',
  rm: 'delete_file',
  mkdir: 'create_dir',
  mv: 'move_file',
  rename: 'move_file',
  cp: 'copy_file',
};

export async function executeTool(call: ToolUseBlock): Promise<{ content: string; isError: boolean }> {
  try {
    const canonical = ALIASES[call.name] ?? call.name;
    const handler = HANDLERS[canonical];
    if (!handler) {
      const known = Object.keys(HANDLERS).sort();
      const closest = known
        .map((n) => ({ n, d: editDistance(call.name, n) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map((x) => x.n);
      return err(
        `Unknown tool: ${call.name}. Did you mean one of: ${closest.join(', ')}? Available tools: ${known.join(', ')}`,
      );
    }
    const projectRoot = useAppStore.getState().projectRoot;
    // Pre-hook can deny the call; the model receives the reason and can
    // adjust (e.g. user blocked deletes outside src/).
    const pre = await runPreHook(call, projectRoot);
    if (!pre.allowed) {
      return err(`Pre-hook denied ${call.name}: ${pre.reason ?? 'unknown reason'}`);
    }
    const result = await handler(call);
    // Post-hook fires after success or failure — warning is appended to
    // the result content so the model sees it next turn.
    const post = await runPostHook(call, result, projectRoot);
    if (post.warning) {
      return { ...result, content: `${result.content}\n\n[post-hook warning] ${post.warning}` };
    }
    return result;
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

const HANDLERS: Record<string, (call: ToolUseBlock) => Promise<{ content: string; isError: boolean }>> = {
  // ── Filesystem ──────────────────────────────────────────────────────
  read_file: async (c) => {
    const path = str(c, 'path');
    const offset = optInt(c, 'offset');
    const limit = optInt(c, 'limit');
    let text: string;
    try {
      text = await readFile(path);
    } catch (e) {
      // ENOENT / "No such file": list the parent dir and surface fuzzy
      // matches so the model can self-correct on the next turn instead of
      // looping on the same wrong path (e.g. "workflow" → "workflow.md").
      const msg = e instanceof Error ? e.message : String(e);
      if (/No such file|not found|os error 2/i.test(msg)) {
        const parent = path.split('/').slice(0, -1).join('/');
        const basename = path.split('/').pop() ?? path;
        try {
          const entries = await listDir(parent);
          const ranked = entries
            .map((entry) => ({ name: entry.name, d: editDistance(basename, entry.name) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, 5);
          const suggestions = ranked.map((r) => `${parent}/${r.name}`).join('\n  ');
          return err(
            `File not found: ${path}\n\nDid you mean one of these files in ${parent}?\n  ${suggestions}`,
          );
        } catch {
          /* parent dir also unreadable — fall through to raw error */
        }
      }
      throw e;
    }
    readSession.add(path);
    if (offset === undefined && limit === undefined) {
      return ok(text);
    }
    const lines = text.split('\n');
    const start = (offset ?? 1) - 1;
    const end = limit !== undefined ? start + limit : lines.length;
    return ok(lines.slice(start, end).join('\n'));
  },

  write_file: async (c) => {
    const path = str(c, 'path');
    const content = str(c, 'content');
    const exists = await fileExists(path);
    if (exists && !readSession.has(path)) {
      return err(`Refusing to overwrite ${path}: read_file must be called first in this session.`);
    }
    let oldContent = '';
    try {
      if (exists) oldContent = await readFile(path);
    } catch {
      /* new file */
    }
    const granted = await requirePermission({
      id: `write_${path}_${Date.now()}`,
      category: 'edit-files',
      title: exists ? 'Overwrite file' : 'Create new file',
      detail: `${exists ? 'Overwrite' : 'Create'} ${path} (${content.length} bytes)`,
      preview: content.length > 800 ? `${content.slice(0, 800)}…` : content,
    });
    if (!granted) return err(`User denied permission to write ${path}.`);
    await writeFile(path, content);
    readSession.add(path);
    recordHunk({ path, oldContent, newContent: content, kind: 'write' });
    useAppStore.getState().notifyFsChange();
    const diff = renderUnifiedDiff({ path, oldContent, newContent: content, kind: 'write' });
    return ok(`Wrote ${content.length} bytes to ${path}\n\n${diff}`);
  },

  edit_file: async (c) => {
    const path = str(c, 'path');
    const oldString = str(c, 'old_string');
    const newString = str(c, 'new_string');
    const replaceAll = optStr(c, 'replace_all') === 'true';
    if (!readSession.has(path)) {
      return err(`Refusing to edit ${path}: read_file must be called first in this session.`);
    }
    const file = await readFile(path);
    if (!file.includes(oldString)) return err(`old_string not found in ${path}`);
    const occurrences = file.split(oldString).length - 1;
    if (!replaceAll && occurrences > 1) {
      return err(
        `old_string is not unique in ${path} (${occurrences} occurrences). Pass replace_all="true" or give more context.`,
      );
    }
    const next = replaceAll ? file.split(oldString).join(newString) : file.replace(oldString, newString);
    const granted = await requirePermission({
      id: `edit_${path}_${Date.now()}`,
      category: 'edit-files',
      title: 'Edit file',
      detail: `Edit ${path}${replaceAll ? ` (${occurrences} replacements)` : ''}`,
      preview: renderUnifiedDiff({ path, oldContent: file, newContent: next, kind: 'edit' }),
    });
    if (!granted) return err(`User denied permission to edit ${path}.`);
    await writeFile(path, next);
    recordHunk({ path, oldContent: file, newContent: next, kind: 'edit' });
    useAppStore.getState().notifyFsChange();
    const diff = renderUnifiedDiff({ path, oldContent: file, newContent: next, kind: 'edit' });
    return ok(`Edited ${path}${replaceAll ? ` (${occurrences} replacements)` : ''}\n\n${diff}`);
  },

  multi_edit: async (c) => {
    const path = str(c, 'path');
    const editsJson = str(c, 'edits_json');
    if (!readSession.has(path)) {
      return err(`Refusing to edit ${path}: read_file must be called first in this session.`);
    }
    let edits: Array<{ old_string: string; new_string: string; replace_all?: string }>;
    try {
      edits = JSON.parse(editsJson);
    } catch {
      return err('edits_json is not valid JSON');
    }
    const original = await readFile(path);
    let current = original;
    for (const e of edits) {
      if (!current.includes(e.old_string)) {
        return err(`Edit ${edits.indexOf(e) + 1}: old_string not found.`);
      }
      current =
        e.replace_all === 'true'
          ? current.split(e.old_string).join(e.new_string)
          : current.replace(e.old_string, e.new_string);
    }
    const granted = await requirePermission({
      id: `multi_${path}_${Date.now()}`,
      category: 'edit-files',
      title: 'Apply multiple edits',
      detail: `Apply ${edits.length} edits to ${path}`,
      preview: renderUnifiedDiff({ path, oldContent: original, newContent: current, kind: 'edit' }),
    });
    if (!granted) return err(`User denied permission to edit ${path}.`);
    await writeFile(path, current);
    recordHunk({ path, oldContent: original, newContent: current, kind: 'edit' });
    useAppStore.getState().notifyFsChange();
    const diff = renderUnifiedDiff({ path, oldContent: original, newContent: current, kind: 'edit' });
    return ok(`Applied ${edits.length} edits to ${path}\n\n${diff}`);
  },

  list_directory: async (c) => {
    const entries = await listDir(str(c, 'path'));
    return ok(entries.map((e) => `${e.isDirectory ? 'd' : 'f'} ${e.name}`).join('\n'));
  },

  apply_patch: async (c) => {
    const patch = str(c, 'patch');
    const files = parseUnifiedPatch(patch);
    if (files.length === 0) return err('apply_patch: no valid file hunks found in patch');
    const summary: string[] = [];
    for (const f of files) {
      // For new files (--- /dev/null) the existing path is the +++ line.
      const targetPath = f.newPath ?? f.oldPath;
      if (!targetPath) return err('apply_patch: missing target path in hunk');
      if (f.oldPath !== '/dev/null' && !readSession.has(targetPath)) {
        return err(`apply_patch: read_file must be called first for ${targetPath}`);
      }
      const current = f.oldPath === '/dev/null' ? '' : await readFile(targetPath);
      const applied = applyHunksTo(current, f.hunks);
      if (applied === null) {
        return err(
          `apply_patch: hunk did not apply cleanly to ${targetPath}. Re-read the file and produce a fresh patch.`,
        );
      }
      const granted = await requirePermission({
        id: `patch_${targetPath}_${Date.now()}`,
        category: 'edit-files',
        title: f.oldPath === '/dev/null' ? 'Create file from patch' : 'Apply patch to file',
        detail: `${targetPath} (${f.hunks.length} hunk${f.hunks.length === 1 ? '' : 's'})`,
        preview: renderUnifiedDiff({ path: targetPath, oldContent: current, newContent: applied, kind: f.oldPath === '/dev/null' ? 'write' : 'edit' }),
      });
      if (!granted) return err(`User denied permission for ${targetPath}.`);
      await writeFile(targetPath, applied);
      readSession.add(targetPath);
      recordHunk({ path: targetPath, oldContent: current, newContent: applied, kind: f.oldPath === '/dev/null' ? 'write' : 'edit' });
      summary.push(renderUnifiedDiff({ path: targetPath, oldContent: current, newContent: applied, kind: f.oldPath === '/dev/null' ? 'write' : 'edit' }));
    }
    useAppStore.getState().notifyFsChange();
    return ok(`Applied patch to ${files.length} file${files.length === 1 ? '' : 's'}.\n\n${summary.join('\n\n')}`);
  },

  glob: async (c) => {
    const pattern = str(c, 'pattern');
    const path = optStr(c, 'path') ?? useAppStore.getState().projectRoot;
    if (!path) return err('No project root open. Open a folder first.');
    // ripgrep --files + glob filter, ordered by mtime
    try {
      const result = await Command.create('sh', [
        '-c',
        `cd "${path}" && rg --files --glob ${JSON.stringify(pattern)} 2>/dev/null | head -500 | xargs -I{} ls -t "{}" 2>/dev/null || true`,
      ]).execute();
      return ok(result.stdout || '(no matches)');
    } catch (e) {
      return err(String(e));
    }
  },

  get_file_stat: async (c) => {
    const path = str(c, 'path');
    try {
      const exists = await fileExists(path);
      if (!exists) return ok(JSON.stringify({ exists: false }));
      const entries = await listDir(path).catch(() => null);
      if (entries) {
        return ok(JSON.stringify({ exists: true, is_dir: true, entry_count: entries.length }));
      }
      const content = await readFile(path);
      return ok(
        JSON.stringify({
          exists: true,
          is_file: true,
          size_bytes: content.length,
          line_count: content.split('\n').length,
        }),
      );
    } catch (e) {
      return err(String(e));
    }
  },

  move_file: async (c) => {
    const from = str(c, 'from');
    const to = str(c, 'to');
    const granted = await requirePermission({
      id: `mv_${from}_${Date.now()}`,
      category: 'rename-files',
      title: 'Move/Rename file',
      detail: `Move ${from} → ${to}`,
    });
    if (!granted) return err(`User denied permission to move ${from}.`);
    await renamePath(from, to);
    useAppStore.getState().notifyFsChange();
    return ok(`Moved ${from} → ${to}`);
  },

  copy_file: async (c) => {
    const from = str(c, 'from');
    const to = str(c, 'to');
    const content = await readFile(from);
    const granted = await requirePermission({
      id: `cp_${from}_${Date.now()}`,
      category: 'edit-files',
      title: 'Copy file',
      detail: `Copy ${from} → ${to}`,
    });
    if (!granted) return err(`User denied permission to copy ${from}.`);
    await writeFile(to, content);
    useAppStore.getState().notifyFsChange();
    return ok(`Copied ${from} → ${to}`);
  },

  delete_file: async (c) => {
    const path = str(c, 'path');
    const granted = await requirePermission({
      id: `rm_${path}_${Date.now()}`,
      category: 'delete-files',
      title: 'Delete file',
      detail: `Delete ${path}`,
    });
    if (!granted) return err(`User denied permission to delete ${path}.`);
    await removePath(path);
    useAppStore.getState().notifyFsChange();
    return ok(`Deleted ${path}`);
  },

  create_dir: async (c) => {
    const path = str(c, 'path');
    const granted = await requirePermission({
      id: `mkdir_${path}_${Date.now()}`,
      category: 'create-dirs',
      title: 'Create directory',
      detail: `Create directory ${path}`,
    });
    if (!granted) return err(`User denied permission to create ${path}.`);
    await createDir(path);
    useAppStore.getState().notifyFsChange();
    return ok(`Created directory ${path}`);
  },

  // ── Search ──────────────────────────────────────────────────────────
  grep: async (c) => {
    const pattern = str(c, 'pattern');
    const glob = optStr(c, 'glob');
    const type = optStr(c, 'type');
    const ctx = optStr(c, 'context_lines');
    const ignore = optStr(c, 'ignore_case');
    const root = useAppStore.getState().projectRoot;
    if (!root) return err('No project root open.');
    const args = ['--line-number', '--no-heading', '--color=never', '--max-count=100'];
    if (glob) args.push('--glob', glob);
    if (type) args.push('--type', type);
    if (ctx) args.push('-C', ctx);
    if (ignore === 'true') args.push('-i');
    args.push(pattern, root);
    try {
      const out = await Command.create('rg', args).execute();
      return ok(out.stdout.slice(0, 8000) || '(no matches)');
    } catch {
      // grep fallback
      const safe = pattern.replace(/'/g, "'\\''");
      const out = await Command.create('sh', [
        '-c',
        `grep -RInE${ignore === 'true' ? 'i' : ''} ${ctx ? `-C ${ctx}` : ''} '${safe}' --max-count=100 ${root} 2>/dev/null | head -200`,
      ]).execute();
      return ok(out.stdout.slice(0, 8000) || '(no matches)');
    }
  },

  semantic_search: async (c) => {
    const { codebaseIndex } = await import('../../features/embeddings/codebase-index');
    const projectRoot = useAppStore.getState().projectRoot;
    if (!projectRoot) return err('No project root open.');
    if (!codebaseIndex.isIndexedFor(projectRoot)) {
      // Build on first use — keeps cold start lazy.
      await codebaseIndex.build(projectRoot);
    }
    const query = str(c, 'query');
    const k = optInt(c, 'k') ?? 8;
    const hits = await codebaseIndex.search(query, k);
    if (hits.length === 0) {
      return ok('(no results — index empty or sidecar embeddings offline; try grep instead)');
    }
    const formatted = hits
      .map(
        (h, i) =>
          `[${i + 1}] ${(h.score * 100).toFixed(1)}%  ${h.path}:${h.startLine}-${h.endLine}\n${h.text.slice(0, 280)}${h.text.length > 280 ? '…' : ''}`,
      )
      .join('\n\n');
    return ok(formatted);
  },

  find_references: async () => err('find_references requires LSP server. Phase pending.'),
  goto_definition: async () => err('goto_definition requires LSP server. Phase pending.'),
  rename_symbol: async () => err('rename_symbol requires LSP server. Phase pending.'),

  get_diagnostics: async () => {
    const problems = useAppStore.getState().problems;
    return ok(
      problems
        .map((p) => `[${p.severity}] ${p.path}:${p.line}:${p.column} — ${p.message}`)
        .join('\n') || '(no diagnostics)',
    );
  },

  get_symbols: async (c) => {
    const path = str(c, 'path');
    // Best-effort: regex parse for top-level symbols (proper LSP comes later)
    const text = await readFile(path);
    const out: string[] = [];
    const patterns = [
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
      /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/gm,
      /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
      /^(?:export\s+)?interface\s+(\w+)/gm,
      /^(?:export\s+)?type\s+(\w+)/gm,
    ];
    for (const p of patterns) {
      let m: RegExpExecArray | null;
      while ((m = p.exec(text)) !== null) {
        const line = text.slice(0, m.index).split('\n').length;
        out.push(`${m[1]} (line ${line})`);
      }
    }
    return ok(out.join('\n') || '(no symbols)');
  },

  // ── Execution ───────────────────────────────────────────────────────
  run_command: async (c) => {
    const cmd = str(c, 'command');
    const timeout = optInt(c, 'timeout_ms') ?? 60_000;
    const cwd = optStr(c, 'cwd') ?? useAppStore.getState().projectRoot ?? undefined;
    const background = optStr(c, 'run_in_background') === 'true';

    const granted = await requirePermission({
      id: `run_${Date.now()}`,
      category: 'run-command',
      title: background ? 'Run background shell command' : 'Run shell command',
      detail: cwd ? `In ${cwd}` : 'In default working directory',
      preview: `$ ${cmd}`,
    });
    if (!granted) return err('User denied permission to run command.');

    if (background) {
      const command = Command.create('sh', ['-c', cmd], cwd ? { cwd } : {});
      const id = `bg_${Date.now().toString(36)}`;
      const logs: string[] = [];
      command.stdout.on('data', (line) => logs.push(line));
      command.stderr.on('data', (line) => logs.push(line));
      const child = await command.spawn();
      backgroundProcs.set(id, { child, logs });
      return ok(`Spawned background process. process_id=${id}`);
    }

    const command = Command.create('sh', ['-c', cmd], cwd ? { cwd } : {});
    const result = await Promise.race([
      command.execute(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${timeout}ms`)), timeout),
      ),
    ]);
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (result.code !== 0) {
      return err(`Exit ${result.code}:\n${combined.slice(0, 4000)}`);
    }
    return ok(combined.slice(0, 4000) || '(exit 0, no output)');
  },

  run_test: async () => runScript('test'),
  run_build: async () => runScript('build'),

  lint_file: async (c) =>
    runShell(`pnpm exec biome check ${str(c, 'path')} || npx eslint ${str(c, 'path')} || echo "(no linter available)"`),
  type_check: async () => runShell('pnpm exec tsc --noEmit || npx tsc --noEmit'),
  format_file: async (c) =>
    runShell(
      `pnpm exec biome format --write ${str(c, 'path')} || npx prettier --write ${str(c, 'path')}`,
    ),

  // ── Git ─────────────────────────────────────────────────────────────
  git_status: async () => runGit(['status', '--porcelain']),
  git_diff: async (c) => runGit(['diff', ...(optStr(c, 'path') ? ['--', str(c, 'path')] : [])]),
  git_log: async (c) =>
    runGit(['log', `--max-count=${optInt(c, 'limit') ?? 20}`, '--pretty=format:%h %an %ar — %s']),
  git_blame: async (c) => runGit(['blame', '--', str(c, 'path')]),
  git_show: async (c) => runGit(['show', str(c, 'ref')]),
  git_commit: async (c) => {
    const files = optStr(c, 'files');
    if (files) {
      await runGit(['add', ...files.split(/\s+/)]);
    }
    return runGit(['commit', '-m', str(c, 'message')]);
  },
  git_branches: async () => runGit(['branch', '-a']),

  // ── DB ──────────────────────────────────────────────────────────────
  db_query: async (c) => {
    const { useDbStore } = await import('../../features/db-studio/db-store');
    const store = useDbStore.getState();
    const original = store.activeConnectionId;
    store.setActiveConnection(str(c, 'connection_id'));
    const result = await store.runArbitrary(str(c, 'sql'));
    store.setActiveConnection(original);
    return result.error ? err(result.error) : ok(JSON.stringify({ columns: result.columns, rows: result.rows, ms: result.durationMs }));
  },
  db_schema: async (c) => {
    const { useDbStore } = await import('../../features/db-studio/db-store');
    const store = useDbStore.getState();
    const original = store.activeConnectionId;
    store.setActiveConnection(str(c, 'connection_id'));
    await store.refreshSchema();
    const tables = useDbStore.getState().tables;
    store.setActiveConnection(original);
    return ok(JSON.stringify(tables));
  },
  db_table_data: async (c) => {
    const { useDbStore } = await import('../../features/db-studio/db-store');
    const store = useDbStore.getState();
    const original = store.activeConnectionId;
    store.setActiveConnection(str(c, 'connection_id'));
    const limit = optInt(c, 'limit') ?? 50;
    const offset = optInt(c, 'offset') ?? 0;
    const r = await store.runArbitrary(`SELECT * FROM ${str(c, 'table')} LIMIT ${limit} OFFSET ${offset};`);
    store.setActiveConnection(original);
    return r.error ? err(r.error) : ok(JSON.stringify({ columns: r.columns, rows: r.rows }));
  },

  // ── Web ─────────────────────────────────────────────────────────────
  fetch_url: async (c) => {
    const url = str(c, 'url');
    const method = optStr(c, 'method') ?? 'GET';
    const body = optStr(c, 'body');
    const headersJson = optStr(c, 'headers_json');
    const headers: Record<string, string> = headersJson ? JSON.parse(headersJson) : {};
    const res = await tauriFetch(url, {
      method,
      headers,
      ...(body ? { body } : {}),
    });
    const text = await res.text();
    return ok(JSON.stringify({ status: res.status, body: text.slice(0, 8000) }));
  },

  web_search: async (c) => {
    const query = str(c, 'query');
    const max = optInt(c, 'max_results') ?? 10;
    const res = await tauriFetch(
      `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 WebCraft' } },
    );
    const html = await res.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && results.length < max) {
      const rawUrl = m[1] ?? '';
      const rawTitle = m[2] ?? '';
      const rawSnippet = m[3] ?? '';
      results.push({
        url: decodeURIComponent(rawUrl.replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, '')),
        title: stripHtml(rawTitle),
        snippet: stripHtml(rawSnippet),
      });
    }
    return ok(JSON.stringify(results));
  },

  web_fetch: async (c) => {
    const url = str(c, 'url');
    const res = await tauriFetch(url, { method: 'GET' });
    const html = await res.text();
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return ok(cleaned.slice(0, 8000));
  },

  // ── Project ─────────────────────────────────────────────────────────
  get_project_metadata: async () => {
    const root = useAppStore.getState().projectRoot;
    if (!root) return err('No project root open.');
    const out: Record<string, unknown> = {};
    for (const name of ['package.json', 'tsconfig.json', 'biome.json', 'nx.json']) {
      try {
        out[name] = JSON.parse(await readFile(`${root}/${name}`));
      } catch {
        /* not present */
      }
    }
    return ok(JSON.stringify(out, null, 2));
  },

  get_imports: async (c) => {
    const text = await readFile(str(c, 'path'));
    const imports: string[] = [];
    const re = /^\s*import\s+(?:(?:[\w*\s{},$]+)\s+from\s+)?['"]([^'"]+)['"]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      imports.push(m[1] ?? '');
    }
    return ok(imports.join('\n') || '(no imports)');
  },

  get_outdated_deps: async () => runShell('npm outdated --json || true'),

  // ── Tasks ───────────────────────────────────────────────────────────
  task_create: async (c) => {
    const task = useTaskStore.getState().create({
      title: str(c, 'title'),
      description: optStr(c, 'description') ?? '',
      priority: (optStr(c, 'priority') as 'low' | 'normal' | 'high' | undefined) ?? 'normal',
    });
    return ok(`task_id=${task.id} (${task.title})`);
  },
  task_update: async (c) => {
    const id = str(c, 'task_id');
    const status = optStr(c, 'status') as
      | 'pending'
      | 'in_progress'
      | 'completed'
      | 'blocked'
      | 'cancelled'
      | undefined;
    const note = optStr(c, 'notes');
    const updated = useTaskStore.getState().update(id, {
      ...(status ? { status } : {}),
      ...(note ? { note } : {}),
    });
    return updated ? ok(`Updated ${id}`) : err(`Task ${id} not found`);
  },
  task_get: async (c) => {
    const t = useTaskStore.getState().get(str(c, 'task_id'));
    return t ? ok(JSON.stringify(t)) : err('Task not found');
  },
  task_list: async (c) => {
    const filterStatus = optStr(c, 'filter_status');
    const tasks = useTaskStore
      .getState()
      .list(filterStatus ? { status: filterStatus as 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled' } : undefined);
    return ok(tasks.map((t) => `[${t.status}] ${t.id} — ${t.title}`).join('\n') || '(no tasks)');
  },
  task_stop: async (c) => {
    const outcome = (optStr(c, 'outcome') as 'completed' | 'cancelled' | undefined) ?? 'completed';
    const updated = useTaskStore.getState().update(str(c, 'task_id'), { status: outcome });
    return updated ? ok(`Stopped ${str(c, 'task_id')} as ${outcome}`) : err('Task not found');
  },

  // ── Subagent (Claude Code Task tool parity) ─────────────────────────
  // Spawns an isolated LLM conversation with a read-only tool subset.
  // Use for "research" / "investigation" tasks where you don't want the
  // parent agent to lose track of its main goal.
  subagent: async (c) => {
    const { runSubagent } = await import('./subagent');
    const title = str(c, 'title');
    const task = str(c, 'task');
    const systemPrompt = optStr(c, 'system_prompt') ??
      `You are a focused research subagent for a senior software engineer.
Your job: gather facts from the current codebase about the task below.
Use read-only tools (read_file, glob, grep, list_directory, find_references,
goto_definition, get_diagnostics, get_symbols, web_search, web_fetch).
Return your final answer as concise text (max 400 words). No questions back.`;
    try {
      const result = await runSubagent({ title, task, systemPrompt });
      return ok(
        `=== Subagent ${result.id} — ${title} ===\n` +
          `Rounds: ${result.rounds} · Tool calls: ${result.toolCalls}\n\n${result.finalText}`,
      );
    } catch (e) {
      return err(`Subagent failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },

  // ── Plan mode ───────────────────────────────────────────────────────
  enter_plan_mode: async () => {
    window.dispatchEvent(new CustomEvent('webcraft:plan:enter'));
    return ok('Entered plan mode. Use exit_plan_mode when ready to execute.');
  },
  exit_plan_mode: async (c) => {
    const plan = str(c, 'plan_markdown');
    window.dispatchEvent(new CustomEvent('webcraft:plan:exit', { detail: plan }));
    return ok('Plan presented to user.');
  },

  // ── Notebook ────────────────────────────────────────────────────────
  notebook_edit: async (c) => {
    const path = str(c, 'path');
    const cellId = str(c, 'cell_id');
    const mode = str(c, 'mode');
    const newSource = optStr(c, 'new_source') ?? '';
    if (!readSession.has(path)) {
      return err(`Refusing to edit ${path}: read_file must be called first.`);
    }
    const raw = await readFile(path);
    const nb = JSON.parse(raw) as { cells: Array<{ id?: string; source: string[] }> };
    const idx = nb.cells.findIndex((c) => c.id === cellId);
    if (idx < 0) return err(`Cell ${cellId} not found in ${path}`);
    const cell = nb.cells[idx];
    if (!cell) return err(`Cell ${cellId} not found in ${path}`);
    if (mode === 'replace') {
      cell.source = newSource.split('\n');
    } else if (mode === 'delete') {
      nb.cells.splice(idx, 1);
    } else if (mode === 'insert_after') {
      nb.cells.splice(idx + 1, 0, { source: newSource.split('\n') });
    } else {
      return err(`Unknown mode ${mode}`);
    }
    await writeFile(path, JSON.stringify(nb, null, 1));
    return ok(`Notebook ${path} cell ${cellId} ${mode}`);
  },

  // ── Monitor & Schedule ──────────────────────────────────────────────
  monitor: async (c) => {
    const id = str(c, 'process_id');
    const tail = optInt(c, 'tail_lines') ?? 50;
    const proc = backgroundProcs.get(id);
    if (!proc) return err(`No background process ${id}`);
    return ok(proc.logs.slice(-tail).join('\n') || '(no output yet)');
  },
  schedule_wakeup: async () =>
    err('schedule_wakeup requires the background scheduler service. Phase pending.'),
  cron_create: async () => err('cron_create requires the background scheduler. Phase pending.'),
  cron_list: async () => err('cron_list requires the background scheduler. Phase pending.'),
  cron_delete: async () => err('cron_delete requires the background scheduler. Phase pending.'),

  // ── Skills ──────────────────────────────────────────────────────────
  skill_list: async () => ok('(no skills registered in this build)'),
  skill_invoke: async () => err('skill_invoke not yet wired'),

  // ── MCP ─────────────────────────────────────────────────────────────
  mcp_list_servers: async () => {
    try {
      const { sidecarGet } = await import('../ipc/sidecar');
      const { servers } = await sidecarGet<{ servers: Array<{ name: string; status: string; tools: Array<{ name: string }>; error?: string }> }>('/mcp/servers');
      if (!servers || servers.length === 0) {
        return ok('No MCP servers configured. Add servers in ~/.webcraft/mcp.json — see docs/MCP.md.');
      }
      const lines = servers.map(
        (s) => `[${s.status}] ${s.name}${s.error ? ` — ${s.error}` : ''} · ${s.tools.length} tools`,
      );
      return ok(lines.join('\n'));
    } catch (e) {
      return err(`Could not reach sidecar: ${e instanceof Error ? e.message : e}`);
    }
  },
  mcp_invoke: async (c) => {
    const server = str(c, 'server');
    const tool = str(c, 'tool');
    let args: unknown = {};
    const argsJson = optStr(c, 'args_json');
    if (argsJson) {
      try {
        args = JSON.parse(argsJson);
      } catch {
        return err('args_json is not valid JSON');
      }
    }
    try {
      const { sidecarPost } = await import('../ipc/sidecar');
      const { result } = await sidecarPost<{ result: unknown }>('/mcp/invoke', {
        server,
        tool,
        args,
      });
      return ok(typeof result === 'string' ? result : JSON.stringify(result));
    } catch (e) {
      return err(`MCP invoke failed: ${e instanceof Error ? e.message : e}`);
    }
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────
function str(c: ToolUseBlock, key: string): string {
  const v = c.input[key];
  if (typeof v !== 'string') throw new Error(`Tool ${c.name}: missing string arg "${key}"`);
  return v;
}
function optStr(c: ToolUseBlock, key: string): string | undefined {
  const v = c.input[key];
  return typeof v === 'string' ? v : undefined;
}
function optInt(c: ToolUseBlock, key: string): number | undefined {
  const v = c.input[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v) return Number.parseInt(v, 10);
  return undefined;
}
function ok(content: string): { content: string; isError: boolean } {
  return { content, isError: false };
}
function err(content: string): { content: string; isError: boolean } {
  return { content, isError: true };
}
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}
async function runShell(cmd: string): Promise<{ content: string; isError: boolean }> {
  const cwd = useAppStore.getState().projectRoot ?? undefined;
  const result = await Command.create('sh', ['-c', cmd], cwd ? { cwd } : {}).execute();
  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return result.code === 0 ? ok(combined || '(no output)') : err(`Exit ${result.code}:\n${combined}`);
}
async function runGit(args: string[]): Promise<{ content: string; isError: boolean }> {
  const cwd = useAppStore.getState().projectRoot ?? undefined;
  const result = await Command.create('git', args, cwd ? { cwd } : {}).execute();
  return result.code === 0
    ? ok(result.stdout || '(no output)')
    : err(`git exit ${result.code}:\n${result.stderr}`);
}
async function runScript(script: string): Promise<{ content: string; isError: boolean }> {
  for (const pm of ['pnpm', 'yarn', 'npm']) {
    try {
      const cwd = useAppStore.getState().projectRoot ?? undefined;
      const r = await Command.create(pm, ['run', script], cwd ? { cwd } : {}).execute();
      const combined = [r.stdout, r.stderr].filter(Boolean).join('\n');
      return r.code === 0
        ? ok(combined || '(no output)')
        : err(`${pm} run ${script} exit ${r.code}:\n${combined.slice(0, 4000)}`);
    } catch {
      /* try next pm */
    }
  }
  return err(`No package manager found to run ${script}`);
}

/// Unified-diff parser — handles standard `--- a/path` / `+++ b/path` /
/// `@@ -start,len +start,len @@` / `+/- /context` lines.

interface PatchHunk {
  oldStart: number;
  newStart: number;
  lines: Array<{ kind: 'context' | 'add' | 'remove'; text: string }>;
}
interface PatchFile {
  oldPath: string;
  newPath: string;
  hunks: PatchHunk[];
}

function parseUnifiedPatch(text: string): PatchFile[] {
  const lines = text.split('\n');
  const files: PatchFile[] = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !lines[i]!.startsWith('--- ')) i++;
    if (i >= lines.length) break;
    const oldPath = lines[i]!.slice(4).replace(/^[ab]\//, '').trim();
    i++;
    if (i >= lines.length || !lines[i]!.startsWith('+++ ')) break;
    const newPath = lines[i]!.slice(4).replace(/^[ab]\//, '').trim();
    i++;
    const file: PatchFile = { oldPath, newPath, hunks: [] };
    while (i < lines.length && lines[i]!.startsWith('@@')) {
      const header = lines[i]!;
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
      i++;
      const hunk: PatchHunk = {
        oldStart: m ? parseInt(m[1]!, 10) : 1,
        newStart: m ? parseInt(m[2]!, 10) : 1,
        lines: [],
      };
      while (i < lines.length && !lines[i]!.startsWith('--- ') && !lines[i]!.startsWith('@@')) {
        const ln = lines[i]!;
        if (ln.startsWith('+')) hunk.lines.push({ kind: 'add', text: ln.slice(1) });
        else if (ln.startsWith('-')) hunk.lines.push({ kind: 'remove', text: ln.slice(1) });
        else if (ln.startsWith(' ')) hunk.lines.push({ kind: 'context', text: ln.slice(1) });
        else if (ln === '') hunk.lines.push({ kind: 'context', text: '' });
        else break;
        i++;
      }
      file.hunks.push(hunk);
    }
    if (file.hunks.length > 0) files.push(file);
  }
  return files;
}

/// Apply hunks against an existing file content. Returns null if any hunk
/// fails to match (the model must re-read and produce a fresh patch).
function applyHunksTo(content: string, hunks: PatchHunk[]): string | null {
  let lines = content === '' ? [] : content.split('\n');
  // Process hunks in reverse order so earlier line numbers stay stable.
  const sorted = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const hunk of sorted) {
    const expected: string[] = [];
    const replacement: string[] = [];
    for (const ln of hunk.lines) {
      if (ln.kind === 'remove' || ln.kind === 'context') expected.push(ln.text);
      if (ln.kind === 'add' || ln.kind === 'context') replacement.push(ln.text);
    }
    const start = hunk.oldStart - 1;
    const slice = lines.slice(start, start + expected.length);
    if (slice.join('\n') !== expected.join('\n')) {
      // Try a fuzzy search ±20 lines in case line numbers drifted.
      let found = -1;
      for (let off = -20; off <= 20; off++) {
        const candidateStart = start + off;
        if (candidateStart < 0) continue;
        const candidate = lines.slice(candidateStart, candidateStart + expected.length);
        if (candidate.join('\n') === expected.join('\n')) {
          found = candidateStart;
          break;
        }
      }
      if (found === -1) return null;
      lines = [...lines.slice(0, found), ...replacement, ...lines.slice(found + expected.length)];
    } else {
      lines = [...lines.slice(0, start), ...replacement, ...lines.slice(start + expected.length)];
    }
  }
  return lines.join('\n');
}
