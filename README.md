# WebCraft

A desktop AI coding IDE — an agent that reads, writes and refactors real projects on your machine, with a GUI editor, integrated language servers, semantic code search, an embedded database studio and bundled dev-server runtimes.

Built by **Nicola Cucurachi**. Tauri 2 (Rust core) + React 19. MIT.

> **Status:** active development. This README describes what is implemented in the code today, not a roadmap.

## What it does

- **Agentic editing on your real filesystem** — `read_file`, `write_file`, `edit_file`, `multi_edit`, `apply_patch`, `create_dir`, `move_file`/`copy_file`/`delete_file`, `glob`, `grep`, `list_directory`.
- **Code intelligence via real LSP** — a Monaco↔LSP bridge gives hover, go-to-definition, find-references, document symbols and rename, both in the editor and as agent tools (`goto_definition`, `find_references`, `get_symbols`, `rename_symbol`, `format_file`).
- **Diagnostics in the loop** — `get_diagnostics`, `lint_file` (Biome/ESLint), `type_check`, `run_test`, `run_build`; Monaco markers + a Problems panel surface the same errors in the UI.
- **Semantic code search** — a workspace embedding index chunks the project, encodes it locally via the sidecar, and answers `semantic_search` / `@codebase` queries by cosine similarity.
- **DB Studio** — embedded drivers for **SQLite, DuckDB, LibSQL, MongoDB and Redis**, with a schema designer, creation wizard, query editor and result grid. Agent tools: `db_query`, `db_schema`, `db_table_data`.
- **Bundled dev-servers** — spawn the runtime that matches the project: **Node, Bun, Deno, Go, PHP**.
- **Live diff stream** — every `edit`/`write` from the model shows as a red/green hunk; an inline diff + permission dialog gate the changes.
- **Full git, in-agent** — `git_status`, `git_diff`, `git_log`, `git_show`, `git_blame`, `git_branches`, `git_commit` + a live git sidebar.
- **Plan mode** — `enter_plan_mode` / `exit_plan_mode` let the agent design before it edits.
- **MCP + automation** — external MCP servers (`mcp_list_servers`, `mcp_invoke`), `cron_create`/`cron_list`/`cron_delete`, `monitor`, `fetch_url`, project-metadata and dependency tools.
- **Sub-agent delegation** — a focused read-only research sub-agent runs in its own fresh context.

## Providers

Provider-agnostic routing: **Anthropic (Claude), OpenAI, OpenRouter**, and **NHA / Liara** (free tier). API keys live in the OS keychain via `@napi-rs/keyring` — never in localStorage, files or the repo.

## Architecture

```
apps/desktop/            Tauri 2 (Rust core) + React 19 renderer
packages/
  core/                  Renderer features: Monaco editor, chat + diff, file-tree,
                         git, db-studio, dev-server, settings, embeddings index
  server/                Node sidecar — modules/{lsp, rag, db, mcp}
  ai-tools/              Tool definitions
  ai-router/             LLM provider abstraction (Anthropic, OpenAI, OpenRouter, NHA/Liara)
  shared/                Types, zod schemas, IPC contracts
  design-system/         Radix-based components
```

- Tauri 2 sandboxed renderer (no Node in the renderer); Node work runs in the sidecar.
- IPC validated with zod schemas over tRPC v11 / Tauri channels.

## Stack

| Layer | Choice |
|------|--------|
| Desktop shell | Tauri 2 (Rust) |
| Node sidecar | Node 22 + ESM |
| Frontend | React 19 + Vite |
| Editor | Monaco Editor |
| Styling | Tailwind CSS 4 |
| Components | Radix Primitives + Lucide icons |
| State | Zustand 5 |
| IPC | tRPC v11 |
| Monorepo | Nx + pnpm |
| Tests | Vitest 3 |
| Lint/format | Biome 2 |
| Secrets | @napi-rs/keyring |

## Develop

```bash
git clone https://github.com/adoslabsproject-gif/webcraft.git
cd webcraft
npm install
npm run build:cli        # sidecar / core build
npm run desktop:dev      # Tauri dev window  (requires Rust + Node ≥ 20)
```

## License

MIT © 2026 Nicola Cucurachi.
