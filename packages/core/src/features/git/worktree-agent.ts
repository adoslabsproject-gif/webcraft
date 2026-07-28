import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { type SubagentTranscript, useSubagentStore } from '../../lib/ai/subagent-store';
import type { ContentBlock, ToolResultBlock } from '../../lib/ai/types';
import { sidecarUrl } from '../../lib/ipc/sidecar';
import { useSettingsStore } from '../../store/settings-store';

/// Worktree agents — the multi-agent pattern the worktree feature exists
/// for: each agent is an independent Claude Code run whose cwd is a
/// separate worktree checkout, so N agents work N branches in parallel
/// with zero file conflicts. Transcripts stream into the Subagents panel.
///
/// Fresh session per launch (no --resume): a worktree task is a one-shot
/// brief; follow-ups belong in the main chat after switching projectRoot.

export async function runWorktreeAgent(
  worktreePath: string,
  branch: string,
  task: string,
): Promise<void> {
  const transcript: SubagentTranscript = {
    id: `wt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: `CC agent · ${branch}`,
    task,
    startedAt: Date.now(),
    status: 'running',
    messages: [{ role: 'user', content: [{ type: 'text', text: task }] }],
  };
  const store = useSubagentStore.getState();
  store.add(transcript);
  const patch = (p: Partial<SubagentTranscript>) =>
    useSubagentStore.getState().update(transcript.id, p);

  let url: string;
  try {
    url = await sidecarUrl('/agent/run');
  } catch {
    patch({ status: 'failed', error: 'Sidecar not running — restart WebCraft.' });
    return;
  }

  const settings = useSettingsStore.getState();
  let res: Response;
  try {
    res = await tauriFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: task,
        cwd: worktreePath,
        model: 'default',
        permissionMode: settings.claudeCodePermissionMode,
        appendSystemPrompt:
          `You are working inside the git worktree at ${worktreePath} (branch ${branch}). ` +
          'Stay inside this directory; commit your work on this branch when done.',
      }),
    });
  } catch (e) {
    patch({ status: 'failed', error: e instanceof Error ? e.message : String(e) });
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    patch({ status: 'failed', error: text.slice(0, 300) || `HTTP ${res.status}` });
    return;
  }

  const messages = transcript.messages;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finalText = '';
  let runError: string | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = event.type as string;

    if (type === 'assistant') {
      const content = (event as { message?: { content?: unknown[] } }).message?.content ?? [];
      const blocks: ContentBlock[] = [];
      for (const raw of content) {
        const b = raw as {
          type?: string;
          text?: string;
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        };
        if (b.type === 'text' && b.text) {
          blocks.push({ type: 'text', text: b.text });
          finalText = b.text;
        } else if (b.type === 'tool_use' && b.id && b.name) {
          blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} });
        }
      }
      if (blocks.length > 0) {
        messages.push({ role: 'assistant', content: blocks });
        patch({ messages: [...messages] });
      }
      return;
    }

    if (type === 'user') {
      const content = (event as { message?: { content?: unknown[] } }).message?.content ?? [];
      const results: ToolResultBlock[] = [];
      for (const raw of content) {
        const b = raw as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
        if (b.type === 'tool_result' && b.tool_use_id) {
          const text =
            typeof b.content === 'string'
              ? b.content
              : Array.isArray(b.content)
                ? b.content
                    .map((p) => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? '')))
                    .join('\n')
                : JSON.stringify(b.content ?? '');
          results.push({ type: 'tool_result', tool_use_id: b.tool_use_id, content: text });
        }
      }
      if (results.length > 0) {
        messages.push({ role: 'user', content: results });
        patch({ messages: [...messages] });
      }
      return;
    }

    if (type === 'result') {
      const r = event as { subtype?: string; result?: string };
      if (r.subtype && r.subtype !== 'success') {
        runError = r.result || `run ended: ${r.subtype}`;
      } else if (r.result) {
        finalText = r.result;
      }
      return;
    }

    if (type === 'sidecar_error') {
      runError = String((event as { message?: string }).message ?? 'sidecar error');
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    }
    if (buf.trim()) handleLine(buf);
  } catch (e) {
    patch({ status: 'failed', error: e instanceof Error ? e.message : String(e) });
    return;
  }

  if (runError) {
    patch({ status: 'failed', error: runError, finishedAt: Date.now() });
  } else {
    patch({ status: 'completed', finalText, finishedAt: Date.now() });
  }
}
