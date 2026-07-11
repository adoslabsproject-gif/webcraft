import type { ToolDefinition } from './types';

/// WebCraft tool catalog — 30+ deterministic tools the AI can call.
///
/// Design rules (2026 enterprise IDE):
/// - DETERMINISTIC: no LLM in the middle, no randomness — same input → same output
/// - IDEMPOTENT where possible: re-running a tool with the same input is safe
/// - ATOMIC: multi_edit applies all edits in a transaction or none
/// - TYPED: every input has a strict JSON schema, the model can't pass wrong shapes
/// - SAFE: write/delete tools require absolute paths inside the project root
///
/// Categories:
///   1. Filesystem (read/write/list/move)
///   2. Search & code intelligence (grep, semantic, references, symbols)
///   3. Execution (commands, tests, builds, linters)
///   4. Git (status, diff, log, blame, commit)
///   5. Database (query, schema, tables)
///   6. Network & browser (fetch, screenshot, DOM extract)
///   7. Project metadata (deps, imports, scripts)

export const TOOLS: ToolDefinition[] = [
  // ── 1. Filesystem ─────────────────────────────────────────────────────
  {
    name: 'read_file',
    description: 'Read a file from disk. Optionally specify a line range (1-indexed inclusive).',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path.' },
        start_line: { type: 'string', description: 'Optional 1-indexed start line.' },
        end_line: { type: 'string', description: 'Optional 1-indexed end line.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write content to a file, overwriting it. Creates the file (+ parent dirs) if missing. Emits a diff hunk to the diff stream.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path.' },
        content: { type: 'string', description: 'Full file content.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace exact `old_string` with `new_string` in the file. The match must be unique. Atomic. Emits a diff hunk.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path.' },
        old_string: { type: 'string', description: 'Exact text to find (must be unique).' },
        new_string: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'multi_edit',
    description:
      'Apply N sequential edits to a single file atomically (all or none). Edits must be JSON array of {old_string,new_string}. Order matters: each edit sees the previous edits applied.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path.' },
        edits_json: {
          type: 'string',
          description: 'JSON array: [{"old_string":"...","new_string":"..."}, ...]',
        },
      },
      required: ['path', 'edits_json'],
    },
  },
  {
    name: 'list_directory',
    description:
      'List entries in a directory (non-recursive). Returns one entry per line as "d|f name".',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute directory path.' } },
      required: ['path'],
    },
  },
  {
    name: 'find_files',
    description:
      'Find files in the project matching a glob pattern. Returns up to 500 absolute paths, one per line.',
    input_schema: {
      type: 'object',
      properties: {
        glob: { type: 'string', description: 'Glob pattern, e.g. **/*.ts' },
      },
      required: ['glob'],
    },
  },
  {
    name: 'get_file_stat',
    description: 'Get file metadata: size, mtime, type. Returns JSON.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute file path.' } },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file. Idempotent.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source absolute path.' },
        to: { type: 'string', description: 'Destination absolute path.' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'copy_file',
    description: 'Copy a file to a new path. Overwrites if destination exists.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source absolute path.' },
        to: { type: 'string', description: 'Destination absolute path.' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory recursively. DESTRUCTIVE — confirm intent.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path to remove.' } },
      required: ['path'],
    },
  },

  // ── 2. Search & code intelligence ─────────────────────────────────────
  {
    name: 'grep',
    description:
      'Search the project for a regex pattern (ripgrep). Up to 100 matches. Returns file:line:text.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern (PCRE2 flavor).' },
        glob: { type: 'string', description: 'Optional file glob to limit search.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'semantic_search',
    description:
      'Vector search across the project (LanceDB/TF-IDF). Returns top-k code chunks ranked by semantic similarity to the query.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language query.' },
        k: { type: 'string', description: 'Number of chunks to return (default 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_references',
    description:
      'LSP find-references: every place in the codebase that uses the given symbol. Returns file:line:col.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File containing the symbol.' },
        line: { type: 'string', description: '1-indexed line of the symbol.' },
        column: { type: 'string', description: '1-indexed column of the symbol.' },
      },
      required: ['path', 'line', 'column'],
    },
  },
  {
    name: 'goto_definition',
    description: 'LSP goto-definition for a symbol at the given file/line/column.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        line: { type: 'string' },
        column: { type: 'string' },
      },
      required: ['path', 'line', 'column'],
    },
  },
  {
    name: 'get_diagnostics',
    description:
      'Return all LSP diagnostics (errors, warnings) for a file, or the whole project if path omitted.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Optional file path; omit for project-wide.' } },
      required: [],
    },
  },
  {
    name: 'get_symbols',
    description: 'List all symbols (functions, classes, methods, variables) defined in a file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },

  // ── 3. Execution ──────────────────────────────────────────────────────
  {
    name: 'run_command',
    description:
      'Execute a shell command in the project root (sandboxed). Returns stdout+stderr. Timeout: 60s.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Shell command.' } },
      required: ['command'],
    },
  },
  {
    name: 'run_test',
    description:
      'Run tests (auto-detects vitest/jest/mocha/pytest). Optional test name filter. Returns formatted results.',
    input_schema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional test name pattern.' },
      },
      required: [],
    },
  },
  {
    name: 'run_build',
    description: 'Run the project build (auto-detects from package.json scripts).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'lint_file',
    description: 'Run the project linter (biome/eslint/ruff/etc.) on a file. Returns issues.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'type_check',
    description:
      'Run the type-checker (tsc/mypy/etc.) on the project. Returns errors with file:line:msg.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'format_file',
    description: 'Format a file with the project formatter (biome/prettier/black/gofmt).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },

  // ── 4. Git ────────────────────────────────────────────────────────────
  {
    name: 'git_status',
    description: 'git status --porcelain. Returns one line per changed file.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'git_diff',
    description:
      'git diff (working tree vs HEAD). Optional file to scope. Returns unified diff text.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Optional path.' } },
      required: [],
    },
  },
  {
    name: 'git_log',
    description: 'git log of last N commits (default 20). Returns hash, author, date, subject.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'string', description: 'Number of commits (default 20).' } },
      required: [],
    },
  },
  {
    name: 'git_blame',
    description: 'git blame for a file. Returns line-by-line author + commit.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'git_show',
    description: 'git show <ref>. Shows commit content + diff.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'Commit SHA, branch, or tag.' } },
      required: ['ref'],
    },
  },
  {
    name: 'git_commit',
    description:
      'Stage given files and commit with the message. If no files specified, commits all staged.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message.' },
        files: { type: 'string', description: 'Optional space-separated file list.' },
      },
      required: ['message'],
    },
  },

  // ── 5. Database ───────────────────────────────────────────────────────
  {
    name: 'db_query',
    description:
      'Execute SQL against a registered DB connection. Returns columns + rows JSON. DESTRUCTIVE statements (DROP/DELETE/UPDATE) commit immediately.',
    input_schema: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'Connection ID from db-store.' },
        sql: { type: 'string', description: 'SQL statement.' },
      },
      required: ['connection_id', 'sql'],
    },
  },
  {
    name: 'db_schema',
    description: 'Return all tables + their columns for a connection.',
    input_schema: {
      type: 'object',
      properties: { connection_id: { type: 'string' } },
      required: ['connection_id'],
    },
  },

  // ── 6. Network & browser ──────────────────────────────────────────────
  {
    name: 'fetch_url',
    description:
      'HTTP fetch via the Tauri main process (bypass CORS). GET by default. Returns body text + status.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL (https://…).' },
        method: { type: 'string', description: 'Optional HTTP method (default GET).' },
        body: { type: 'string', description: 'Optional request body.' },
      },
      required: ['url'],
    },
  },

  // ── 7. Project metadata ───────────────────────────────────────────────
  {
    name: 'get_project_metadata',
    description: 'Read package.json + pnpm-workspace.yaml + (tsconfig.json). Returns merged JSON.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_imports',
    description:
      'Parse a file with the language AST and list every import — module + symbols imported.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },

  // ── 8. Filesystem (extras) ────────────────────────────────────────────
  {
    name: 'create_dir',
    description: 'Create a directory (and any missing parent dirs). Idempotent.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path.' } },
      required: ['path'],
    },
  },
  {
    name: 'glob',
    description:
      'Find files by glob pattern (e.g. "src/**/*.{ts,tsx}"). Returns paths sorted by mtime desc.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob (supports **, *, ?, [abc]).' },
        cwd: { type: 'string', description: 'Optional base dir; defaults to projectRoot.' },
      },
      required: ['pattern'],
    },
  },

  // ── 9. Code intelligence (extras) ─────────────────────────────────────
  {
    name: 'rename_symbol',
    description:
      'Rename a symbol across all files in the project (LSP-style). Returns count of files touched.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File containing the symbol declaration.' },
        line: { type: 'string', description: '1-indexed line of the symbol.' },
        new_name: { type: 'string', description: 'Replacement identifier.' },
      },
      required: ['path', 'line', 'new_name'],
    },
  },
  {
    name: 'notebook_edit',
    description:
      'Replace, insert, or delete a cell in a Jupyter (.ipynb) notebook. Edits the JSON safely.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        cell_id: { type: 'string', description: 'Existing cell id (for replace/delete).' },
        new_source: { type: 'string', description: 'New cell content for replace/insert.' },
        mode: { type: 'string', description: 'replace | insert | delete' },
      },
      required: ['path', 'mode'],
    },
  },

  // ── 10. Database (extras) ─────────────────────────────────────────────
  {
    name: 'db_table_data',
    description: 'Page through rows of a table. Returns columns + rows + total.',
    input_schema: {
      type: 'object',
      properties: {
        connection: { type: 'string' },
        table: { type: 'string' },
        offset: { type: 'string', description: 'Starting row (0-based).' },
        limit: { type: 'string', description: 'Page size (default 50).' },
      },
      required: ['connection', 'table'],
    },
  },

  // ── 11. Git (extras) ──────────────────────────────────────────────────
  {
    name: 'git_branches',
    description: 'List local and remote git branches with their tip SHA.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  // ── 12. Web (real, not stub) ──────────────────────────────────────────
  {
    name: 'web_fetch',
    description:
      'Fetch a URL and return text (HTML, JSON, plain). Uses Tauri Rust HTTP — bypasses CORS.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        method: { type: 'string', description: 'GET | POST | PUT | DELETE (default GET).' },
        body: { type: 'string', description: 'Request body for POST/PUT.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_search',
    description:
      'DuckDuckGo HTML search. Returns top results as title + url + snippet. Privacy-safe.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },

  // ── 13. Background work & long-running tasks ──────────────────────────
  {
    name: 'task_create',
    description:
      'Spawn a tracked background task (work item). Returns task_id you can update/get/stop later.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string', description: 'Optional detail.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'task_update',
    description: 'Update a task status (todo | in_progress | completed).',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        status: { type: 'string' },
      },
      required: ['task_id', 'status'],
    },
  },
  {
    name: 'task_list',
    description: 'List all tasks in the current session with their status.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'task_get',
    description: 'Fetch one task by id.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'task_stop',
    description: 'Cancel a running background task.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'monitor',
    description:
      'Watch a background process or file for changes. Returns events as they occur (long-poll).',
    input_schema: {
      type: 'object',
      properties: {
        process_id: { type: 'string' },
        timeout_ms: { type: 'string', description: 'Max wait time (default 30000).' },
      },
      required: ['process_id'],
    },
  },

  // ── 14. Planning (Claude Code parity) ────────────────────────────────
  {
    name: 'enter_plan_mode',
    description:
      'Enter Plan mode — model proposes a step-by-step plan WITHOUT touching files. User reviews before execution.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'exit_plan_mode',
    description: 'Present the final plan and exit Plan mode. Optionally proceeds to execution.',
    input_schema: {
      type: 'object',
      properties: { plan: { type: 'string', description: 'Markdown plan content.' } },
      required: ['plan'],
    },
  },

  // ── 15. Scheduling & notifications ────────────────────────────────────
  {
    name: 'schedule_wakeup',
    description:
      'Schedule a follow-up wake of the chat loop after N seconds (e.g. polling a CI run).',
    input_schema: {
      type: 'object',
      properties: {
        delay_seconds: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['delay_seconds', 'reason'],
    },
  },
  {
    name: 'cron_create',
    description: 'Create a cron job (cron expression + prompt to run at trigger).',
    input_schema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Cron expression (5-field).' },
        prompt: { type: 'string' },
      },
      required: ['expression', 'prompt'],
    },
  },
  {
    name: 'cron_list',
    description: 'List all cron jobs registered in this session.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'cron_delete',
    description: 'Delete a cron job by id.',
    input_schema: {
      type: 'object',
      properties: { cron_id: { type: 'string' } },
      required: ['cron_id'],
    },
  },

  // ── 16. Project insights ──────────────────────────────────────────────
  {
    name: 'get_outdated_deps',
    description: 'Run `npm/pnpm outdated` and parse the table of stale dependencies.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  // ── 17. Extensibility — MCP servers & Skills ─────────────────────────
  {
    name: 'mcp_list_servers',
    description: 'List configured MCP (Model Context Protocol) servers and their available tools.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mcp_invoke',
    description: 'Invoke a tool exposed by an MCP server.',
    input_schema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        tool: { type: 'string' },
        args_json: { type: 'string', description: 'JSON-encoded args object.' },
      },
      required: ['server', 'tool'],
    },
  },
  {
    name: 'skill_list',
    description: 'List user-invocable Skills (slash commands).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'skill_invoke',
    description: 'Execute a registered Skill by name with optional args.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        args: { type: 'string' },
      },
      required: ['name'],
    },
  },

  // ── 18a. Subagent — isolated research thread (Claude Code Task parity)
  {
    name: 'subagent',
    description:
      'Spawn an isolated LLM conversation with a read-only tool subset to research a focused task. Returns the subagent\'s final summary text. Use for "investigate X" / "search for Y" / "summarize Z" — when you want a focused thread that won\'t pollute the main conversation.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short label for the subagent task.' },
        task: { type: 'string', description: 'The exact instruction the subagent receives.' },
        system_prompt: {
          type: 'string',
          description: 'Optional custom system prompt (defaults to a research-oriented one).',
        },
      },
      required: ['title', 'task'],
    },
  },

  // ── 18b. State-of-the-art 2026 — Apply patch (unified diff) ───────────
  {
    name: 'apply_patch',
    description:
      'Apply a unified diff hunk to one or more files. More efficient than multi_edit for large structural changes. Format: standard `--- a/path\\n+++ b/path\\n@@ ... @@\\n+/-/ ` lines.',
    input_schema: {
      type: 'object',
      properties: {
        patch: {
          type: 'string',
          description: 'Unified diff text. Supports multi-file patches separated by file headers.',
        },
      },
      required: ['patch'],
    },
  },
];
