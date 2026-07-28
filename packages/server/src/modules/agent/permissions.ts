/// Interactive permission broker for the Claude Code bridge.
///
/// Flow: the CLI (running with --permission-prompt-tool) calls the
/// `approval_prompt` MCP tool → the MCP server registers the ask here via
/// POST /agent/permission/ask and polls /agent/permission/state — while the
/// renderer polls /agent/permission/pending, shows an Allow/Deny dialog and
/// answers via /agent/permission/answer. Unanswered asks auto-deny after
/// TIMEOUT_MS so a closed window can never hang a run forever.

import { randomUUID } from 'node:crypto';

export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  message?: string;
  updatedInput?: unknown;
}

export interface PermissionAsk {
  id: string;
  toolName: string;
  input: unknown;
  createdAt: number;
  decision: PermissionDecision | null;
}

const TIMEOUT_MS = 10 * 60_000;
const asks = new Map<string, PermissionAsk>();

function sweep(): void {
  const now = Date.now();
  for (const ask of asks.values()) {
    if (!ask.decision && now - ask.createdAt > TIMEOUT_MS) {
      ask.decision = { behavior: 'deny', message: 'permission request timed out in WebCraft' };
    }
    // Drop answered asks after a grace period so the MCP poller can read them.
    if (ask.decision && now - ask.createdAt > TIMEOUT_MS + 60_000) {
      asks.delete(ask.id);
    }
  }
}

export function createAsk(toolName: string, input: unknown): string {
  sweep();
  const id = randomUUID();
  asks.set(id, { id, toolName, input, createdAt: Date.now(), decision: null });
  return id;
}

/// Unanswered asks, oldest first — what the renderer's dialog shows.
export function pendingAsks(): Array<Pick<PermissionAsk, 'id' | 'toolName' | 'input' | 'createdAt'>> {
  sweep();
  return [...asks.values()]
    .filter((a) => !a.decision)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ id, toolName, input, createdAt }) => ({ id, toolName, input, createdAt }));
}

export function answerAsk(id: string, decision: PermissionDecision): boolean {
  const ask = asks.get(id);
  if (!ask || ask.decision) return false;
  ask.decision = decision;
  return true;
}

/// Polled by the MCP tool. `null` while still pending / unknown id.
export function askState(id: string): PermissionDecision | null {
  sweep();
  return asks.get(id)?.decision ?? null;
}

/// Deny everything still pending — called when a run ends or is aborted so
/// stale dialogs don't linger in the UI.
export function denyAllPending(reason: string): void {
  for (const ask of asks.values()) {
    if (!ask.decision) ask.decision = { behavior: 'deny', message: reason };
  }
}
