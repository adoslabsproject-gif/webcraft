import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

/// Claude Code bridge — runs the user's locally installed `claude` CLI in
/// headless mode (`-p --output-format stream-json`) and pipes its NDJSON
/// event stream straight through to the renderer.
///
/// Auth is entirely the CLI's own: whatever the user logged in with
/// (Claude Pro/Max subscription or API key) is what gets used. WebCraft
/// never sees or stores credentials.
///
/// Abort contract: the renderer closing the HTTP request kills the child.

const CANDIDATE_PATHS = [
  `${homedir()}/.local/bin/claude`,
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  `${homedir()}/.claude/local/claude`,
  `${homedir()}/.npm-global/bin/claude`,
];

/// The sidecar inherits Tauri's bare PATH — extend it so `claude` and the
/// tools it spawns (git, node, pnpm…) resolve like in a real terminal.
/// Shared with the LSP host (typescript-language-server & co. live in the
/// same npm-global / homebrew dirs).
export function extendedPath(): string {
  const home = homedir();
  const extra = [
    `${home}/.local/bin`,
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    `${home}/.cargo/bin`,
    `${home}/.bun/bin`,
    `${home}/.deno/bin`,
    `${home}/go/bin`,
  ];
  const current = process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin';
  return [...extra, current].join(':');
}

let cachedBinary: string | null | undefined;

export function locateClaude(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;
  for (const candidate of CANDIDATE_PATHS) {
    if (existsSync(candidate)) {
      cachedBinary = candidate;
      return candidate;
    }
  }
  cachedBinary = null;
  return null;
}

export function agentAvailability(
  cb: (result: { available: boolean; path?: string; version?: string }) => void,
): void {
  const bin = locateClaude();
  if (!bin) return cb({ available: false });
  execFile(bin, ['--version'], { timeout: 5000, env: { ...process.env, PATH: extendedPath() } }, (err, stdout) => {
    if (err) return cb({ available: false, path: bin });
    cb({ available: true, path: bin, version: stdout.trim() });
  });
}

export interface AgentRunRequest {
  prompt: string;
  cwd?: string;
  sessionId?: string;
  model?: string;
  permissionMode?: string;
  appendSystemPrompt?: string;
}

/// Spawn a headless run and stream the CLI's NDJSON events to `res` as
/// chunked NDJSON. Adds sidecar-level events for spawn errors and non-zero
/// exits so the renderer never has to guess why a stream went silent.
export function runAgent(body: AgentRunRequest, req: IncomingMessage, res: ServerResponse): void {
  const bin = locateClaude();
  if (!bin) {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error:
          'Claude Code CLI not found. Install it (https://claude.com/claude-code) and log in, then retry.',
      }),
    );
    return;
  }

  const args = [
    '-p',
    body.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    body.permissionMode || 'acceptEdits',
  ];
  if (body.sessionId) args.push('--resume', body.sessionId);
  if (body.model && body.model !== 'default') args.push('--model', body.model);
  if (body.appendSystemPrompt) args.push('--append-system-prompt', body.appendSystemPrompt);

  res.statusCode = 200;
  res.setHeader('content-type', 'application/x-ndjson');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'no-cache');
  // Flush headers immediately so the renderer can start reading.
  res.flushHeaders?.();

  const child = spawn(bin, args, {
    cwd: body.cwd || homedir(),
    env: { ...process.env, PATH: extendedPath() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderrTail: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => {
    res.write(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail.push(chunk.toString('utf-8'));
    if (stderrTail.length > 40) stderrTail.shift();
  });
  child.on('error', (err) => {
    res.write(`${JSON.stringify({ type: 'sidecar_error', message: `spawn failed: ${err.message}` })}\n`);
    res.end();
  });
  child.on('close', (code) => {
    if (code !== 0) {
      res.write(
        `${JSON.stringify({
          type: 'sidecar_error',
          message: `claude exited with code ${code}: ${stderrTail.join('').slice(-800)}`,
        })}\n`,
      );
    }
    res.end();
  });

  // Renderer aborted (Stop button / window closed) → kill the run.
  req.on('close', () => {
    if (child.exitCode === null) child.kill('SIGTERM');
  });
}
