<div align="center">

<img src="assets/hero.svg" alt="WebCraft — desktop AI coding IDE" width="100%" />

<br/>

**A desktop AI coding IDE.** An agent that reads, writes and refactors real projects on your machine — with a GUI editor, integrated language servers, semantic code search, an embedded database studio and bundled dev-server runtimes.

<br/>

[![License](https://img.shields.io/badge/license-MIT-3fb950?style=for-the-badge)](LICENSE)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-core-CE422B?style=for-the-badge&logo=rust&logoColor=white)
![Status](https://img.shields.io/badge/status-active_dev-f0883e?style=for-the-badge)

<samp>Built by <b>Nicola Cucurachi</b> — the model, the Rust core, the tools. Everything here is his work.</samp>

</div>

---

## ✦ Why WebCraft

Most AI coding agents live in the terminal. **WebCraft is a real desktop IDE** where the agent works *inside* the editor:

<table>
<tr>
<td width="50%" valign="top">

**🖥️ A real IDE, not a sandbox toy**
Monaco editor · LSP hover / go-to-def / diagnostics · command palette · integrated PTY terminal · git sidebar · live red/green diff stream.

**🗄️ Database studio, built in**
Query, design and browse **SQLite · DuckDB · LibSQL · MongoDB · Redis** — studio UI is live, driver wiring lands next.

</td>
<td width="50%" valign="top">

**▶️ Runs what it builds**
One-click dev-servers: **Node · Bun · Deno · Go · PHP · Python · Ruby** + static — uses the runtimes on your PATH.

**🔓 No cloud lock-in**
Provider-agnostic routing — **Claude Code (local, subscription) · Anthropic · OpenAI · OpenRouter · DeepSeek · Grok · Gemini**. API keys live in the **OS keychain** (Keychain / Credential Manager / Secret Service), never on disk in plaintext.

</td>
</tr>
</table>

It touches your **real filesystem, real language servers, real git repo**.

---

## ✦ Highlights

> 🧠 **60 agent tools** &nbsp;·&nbsp; ✍️ **LSP** (via installed language servers) &nbsp;·&nbsp; 🔎 **`@codebase` search** &nbsp;·&nbsp; 🩺 **9-engine auto problem scan** &nbsp;·&nbsp; 🗄️ **DB Studio** (PGLite live, 4 engines in wiring) &nbsp;·&nbsp; ▶️ **8 dev-server runtimes** &nbsp;·&nbsp; 🎙️ **local whisper dictation** &nbsp;·&nbsp; 🟢 **live diff stream** &nbsp;·&nbsp; 🔌 **MCP**

---

## ✦ How it works

```mermaid
flowchart LR
    U([👩‍💻 You]) -->|prompt| R
    subgraph DESKTOP["🖥️ Tauri 2 desktop"]
      R["React 19 renderer<br/>Monaco · chat · diff · DB Studio"]
      R <-->|JSON over loopback HTTP + Tauri IPC| S["Node sidecar<br/>lsp · rag · db · mcp"]
    end
    R -->|60 tools| AR["provider router"]
    AR --> P{{"LLM provider"}}
    P --- A["Anthropic"]
    P --- O["OpenAI"]
    P --- OR["OpenRouter"]
    P --- M["DeepSeek · Grok<br/>· Gemini"]
    S --> LSP["language servers"]
    S --> DB[("SQLite · DuckDB · LibSQL<br/>MongoDB · Redis")]
    S --> RAG["embedding index"]
    style DESKTOP fill:#0d1117,stroke:#30363d,color:#c9d1d9
    style P fill:#1f2937,stroke:#818cf8,color:#e5e7eb
```

---

## ✦ Features

### 🖥️ The IDE
`Monaco editor` · `command palette` · `code lens` · `integrated terminal (PTY)` · `file tree` · `project-wide search` · `symbol outline` · `Problems panel` · `diff viewer` · `snippets` · `tool library`

### 🤖 The agent — 60 tools

<details open>
<summary><b>Show the full tool set</b></summary>

<br/>

| Group | Tools |
|------|------|
| **📁 Files** | `read_file` · `write_file` · `edit_file` · `multi_edit` · `apply_patch` · `create_dir` · `move_file` · `copy_file` · `delete_file` · `get_file_stat` · `list_directory` · `glob` · `grep` · `find_files` · `notebook_edit` |
| **🧭 Code intelligence (LSP)** | `goto_definition` · `find_references` · `get_symbols` · `rename_symbol` · `get_imports` |
| **🩺 Diagnostics & run** | `get_diagnostics` · `lint_file` · `type_check` · `format_file` · `run_test` · `run_build` · `run_command` |
| **🔎 Semantic** | `semantic_search` (`@codebase`) |
| **🌿 Git** | `git_status` · `git_diff` · `git_log` · `git_show` · `git_blame` · `git_branches` · `git_commit` |
| **🗄️ Database** | `db_query` · `db_schema` · `db_table_data` |
| **🗺️ Planning & tasks** | `enter_plan_mode` · `exit_plan_mode` · `task_create` · `task_get` · `task_list` · `task_update` · `task_stop` |
| **⏰ Automation** | `cron_create` · `cron_list` · `cron_delete` · `schedule_wakeup` · `monitor` |
| **🔌 Extend** | `mcp_list_servers` · `mcp_invoke` · `skill_list` · `skill_invoke` · `subagent` |
| **🌐 Web & project** | `web_search` · `web_fetch` · `fetch_url` · `get_project_metadata` · `get_outdated_deps` |

</details>

---

## ✦ Architecture

```
apps/desktop/            Tauri 2 (Rust core) + React 19 renderer
packages/
  core/                  Renderer: Monaco editor, chat + diff, file-tree, terminal,
                         git, db-studio, dev-server, embeddings index,
                         command-palette, code-lens, outline, problems, tasks, settings
  server/                Node sidecar — modules/{lsp, rag, db, mcp}
  ai-tools/              Tool definitions (scaffold — tools currently live in core/src/lib/ai)
  ai-router/             LLM provider abstraction (scaffold — routing currently in core)
  shared/                Types, zod schemas, IPC contracts
  design-system/         Radix-based components
```

<table>
<tr><th>Layer</th><th>Choice</th><th>Layer</th><th>Choice</th></tr>
<tr><td>Desktop shell</td><td>Tauri 2 (Rust)</td><td>State</td><td>Zustand 5</td></tr>
<tr><td>Node sidecar</td><td>Node 22 + ESM</td><td>IPC</td><td>JSON over loopback HTTP + Tauri IPC</td></tr>
<tr><td>Frontend</td><td>React 19 + Vite</td><td>Monorepo</td><td>Nx + pnpm</td></tr>
<tr><td>Editor</td><td>Monaco</td><td>CI / Release</td><td>GitHub Actions + tauri-action</td></tr>
<tr><td>Styling</td><td>Tailwind CSS 4</td><td>Lint/format</td><td>Biome 2</td></tr>
<tr><td>Components</td><td>Radix + Lucide</td><td>Secrets</td><td>OS keychain (keyring)</td></tr>
</table>

---

## ✦ Download

Installers for every platform are on the **[Releases page](https://github.com/adoslabsproject-gif/webcraft/releases/latest)**:

| Platform | File |
|----------|------|
| 🍎 macOS (Apple Silicon / Intel) | `WebCraft_x.y.z_aarch64.dmg` / `WebCraft_x.y.z_x64.dmg` |
| 🪟 Windows | `WebCraft_x.y.z_x64-setup.exe` (or `.msi`) |
| 🐧 Linux | `.AppImage` (bundles the voice libraries; deb/rpm will follow) |

> **Builds are not yet code-signed.**
> - **macOS** — if you get *"WebCraft is damaged and can't be opened"* (Gatekeeper's message for un-notarized downloads), run:
>   ```bash
>   xattr -cr /Applications/WebCraft.app
>   open /Applications/WebCraft.app
>   ```
> - **Windows** — accept the SmartScreen prompt (More info → Run anyway).

---

## ✦ Develop

Requires **Rust (stable)**, **Node ≥ 22** and **pnpm ≥ 9**.

```bash
git clone https://github.com/adoslabsproject-gif/webcraft.git
cd webcraft
pnpm install
pnpm dev                 # Tauri dev window (nx run desktop:dev)
pnpm build               # build all packages + desktop bundle
```

---

## ✦ Status

<samp><b>v0.1.0 — active development.</b> Core is in place: editor, agent + 60 tools, 6 LLM providers, semantic search, DB Studio UI, dev-servers, diff stream, git, offline voice dictation (whisper-small via sherpa-onnx — the ~232MB model auto-downloads at first mic use). Installers for macOS, Windows and Linux ship on the <a href="https://github.com/adoslabsproject-gif/webcraft/releases">Releases page</a>. In progress: DB driver wiring (PGLite works today, sqlite/duckdb/libsql/mongo next), OS-keychain secrets, Windows port of the shell-based tools (dev-servers, project scan — POSIX → PowerShell), bundling Node for the sidecar. Issues and PRs welcome.</samp>

<div align="center">

---

<sub>MIT © 2026 <b>Nicola Cucurachi</b></sub>

</div>
