import { useCallback, useRef } from 'react';
import { createProvider, providerSupportsTools } from '../../lib/ai/router';
import { executeTool } from '../../lib/ai/tool-executor';
import { TOOLS } from '../../lib/ai/tools';
import type { ChatMessage, ContentBlock, ToolResultBlock } from '../../lib/ai/types';
import { useAppStore } from '../../store/app-store';
import { useSettingsStore } from '../../store/settings-store';
import { useChatStore } from './chat-store';
import type { PendingImage } from './MessageInput';
import { resolveMentions } from './mention-resolver';
import { buildProjectContext } from './project-context';
import { buildEditorContext } from './use-editor-context';
import { OUTPUT_STYLE_DIRECTIVES } from '../../store/settings-store';

/// Per-session AbortController. Holding it in module scope (not React state)
/// lets a stop() click from one component abort the in-flight stream
/// regardless of which component triggered it (compact rail vs full tab).
let activeAbort: AbortController | null = null;

const SYSTEM_PROMPT_TOOLS = `You are WebCraft, the most advanced AI IDE ever made.

You have direct, DETERMINISTIC access to the user's project via the following tool surface:
- read_file, write_file, edit_file, multi_edit (atomic batch)
- list_directory, find_files (glob), get_file_stat, move_file, copy_file, delete_file, create_dir
- grep (ripgrep), semantic_search (vector), find_references, goto_definition
- get_diagnostics, get_symbols, rename_symbol, format_file
- run_command (sandboxed), run_test, run_build, lint_file, type_check
- git_status, git_diff, git_log, git_blame, git_show, git_commit, git_branches
- db_query, db_schema, db_table_data
- fetch_url, web_search
- get_project_metadata, get_imports

═══ EXECUTION RULES — NON-NEGOTIABLE ═══
1. When the user asks you to modify a file, the sequence is ALWAYS:
     (a) read_file → (b) edit_file OR write_file → (c) brief confirmation text
   Do NOT stop after (a). Do NOT ask "shall I now edit?" — just edit.
   Do NOT emit a text-only message between read_file and edit_file.

2. For a "edit this file: change X, add Y" request, use ONE edit_file call
   (or multi_edit if multiple distinct hunks). Don't read 3 times before editing.

3. Use EXACT tool names from the list above. Tool aliases (find, search,
   cat, ls, save_file, ...) are tolerated but slow you down — use the canonical
   name.

4. NEVER invent file contents. NEVER pretend to have read a file you didn't
   read via read_file in THIS conversation.

5. After write/edit succeeds, you receive a unified diff in the tool_result.
   Acknowledge briefly ("Done — removed WF2, added WF4.") and STOP. Do not
   re-read the file just to confirm.

6. For destructive operations (write, edit, delete, run_command), the user
   may see a permission prompt. Trust the system to handle it — your job is
   to call the tool, not to ask permission inline.

The user's currently open file and diagnostics are injected below.
Be concise. Show your work via tool calls, not via prose.`;

const SYSTEM_PROMPT_NO_TOOLS = `You are WebCraft, an AI assistant embedded in an IDE.

⚠ CRITICAL — YOU HAVE NO TOOL EXECUTION IN THIS CONVERSATION:
- NO shell commands (grep, ls, cat, find — NEVER pretend to run them)
- NO file reads/writes outside the auto-injected open file below
- NO directory listings, NO code execution, NO git commands

If the user asks you to do any of these:
1. REFUSE explicitly — never invent fake output ("[Output di esempio ipotetico]" is hallucination, FORBIDDEN)
2. Explain you can only analyze the auto-injected open file + diagnostics
3. Ask them to paste the content/output they want you to look at
4. To get tool calling, the user must switch provider to "Anthropic" in Settings.

The currently open file and diagnostics are injected below — analyze ONLY that.`;

function mkId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useChat() {
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const model = useSettingsStore((s) => s.model);
  const outputStyle = useSettingsStore((s) => s.outputStyle);
  const projectRoot = useAppStore((s) => s.projectRoot);

  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const error = useChatStore((s) => s.error);
  const pendingText = useChatStore((s) => s.pendingText);
  const status = useChatStore((s) => s.status);

  const send = useCallback(
    async (text: string, images?: PendingImage[]) => {
      const hasImages = images && images.length > 0;
      if (!text.trim() && !hasImages) return;
      const store = useChatStore.getState();
      if (store.streaming) return;

      const provider = createProvider({ provider: activeProvider, apiKey: apiKeys[activeProvider] });
      if (!provider) {
        store.setError(
          `${activeProvider} needs an API key. Open Settings and add one, or switch to NHA Free (Liara) which works without a key.`,
        );
        return;
      }

      const content: ContentBlock[] = [];
      // Image blocks come first so the model anchors on the visual context.
      if (hasImages) {
        for (const img of images!) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.data },
          });
        }
      }
      // Expand @-mentions: file refs inline file contents, @diagnostics
      // inlines problems list, @web:query is a model cue for web_search.
      if (text.trim()) {
        const { cleanedText, contextBlocks } = await resolveMentions(text);
        const final =
          contextBlocks.length > 0
            ? `${contextBlocks.join('\n\n')}\n\n${cleanedText}`
            : cleanedText;
        content.push({ type: 'text', text: final });
      }

      const userMsg: ChatMessage = {
        id: mkId('msg'),
        role: 'user',
        content,
        createdAt: Date.now(),
      };
      store.appendMessage(userMsg);
      store.startStream();

      // Inject the live editor state (active file + diagnostics + project
      // problems) so even non-tool-aware providers (Liara) can answer
      // questions about what the user is looking at right now.
      const editorCtx = buildEditorContext();
      const projectCtx = await buildProjectContext(projectRoot);
      const styleDirective = OUTPUT_STYLE_DIRECTIVES[outputStyle];
      const baseSystem = providerSupportsTools(activeProvider)
        ? SYSTEM_PROMPT_TOOLS
        : SYSTEM_PROMPT_NO_TOOLS;
      const systemPrompt = [
        baseSystem,
        styleDirective || null,
        projectRoot ? `Current project root: ${projectRoot}` : 'No project folder open yet.',
        projectCtx,
        editorCtx ? `# Live IDE context\n\n${editorCtx}` : null,
      ]
        .filter(Boolean)
        .join('\n\n');

      const abort = new AbortController();
      activeAbort = abort;
      try {
        await runConversation({
          provider,
          providerId: activeProvider,
          model,
          systemPrompt,
          signal: abort.signal,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // User-initiated abort: don't show as error, it was intentional.
        if (abort.signal.aborted || /aborted|abort/i.test(msg)) {
          // no-op — endStream handles UI
        } else {
          store.setError(msg);
        }
      } finally {
        if (activeAbort === abort) activeAbort = null;
        useChatStore.getState().endStream();
      }
    },
    [activeProvider, apiKeys, model, projectRoot, outputStyle],
  );

  const stop = useCallback(() => {
    activeAbort?.abort();
  }, []);

  return { messages, streaming, error, pendingText, status, send, stop };
}

async function runConversation(opts: {
  provider: ReturnType<typeof createProvider>;
  providerId: ReturnType<typeof useSettingsStore.getState>['activeProvider'];
  model: string;
  systemPrompt: string;
  signal: AbortSignal;
}) {
  const { provider, providerId, model, systemPrompt, signal } = opts;
  if (!provider) return;
  const supportsTools = providerSupportsTools(providerId);
  let safety = 0;

  while (safety++ < 12) {
    if (signal.aborted) return;
    const store = useChatStore.getState();
    store.setStatus({ phase: 'thinking' });
    const assistantId = mkId('msg');
    const assistant: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: [],
      createdAt: Date.now(),
      streaming: true,
    };
    store.appendMessage(assistant);
    store.clearPendingText();

    const { assistantBlocks, stopReason } = await provider.stream({
      model,
      system: systemPrompt,
      messages: store.messages.filter((m) => m.role !== 'system' && m.id !== assistantId),
      ...(supportsTools ? { tools: TOOLS } : {}),
      signal,
      callbacks: {
        onText: (d) => useChatStore.getState().appendPendingText(d),
        onToolUse: (tu) =>
          useChatStore
            .getState()
            .setStatus({ phase: 'running-tool', name: tu.name, round: safety }),
        onStop: () => {},
        onError: () => {},
        onUsage: (u) => useSettingsStore.getState().addTokens(u.input, u.output),
      },
    });

    useChatStore.getState().setMessageContent(assistantId, assistantBlocks);
    useChatStore.getState().setMessageStreaming(assistantId, false);
    useChatStore.getState().clearPendingText();

    if (!supportsTools || stopReason !== 'tool_use') return;

    const toolUses = assistantBlocks.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    if (toolUses.length === 0) return;

    const toolResults: ToolResultBlock[] = [];
    for (const tu of toolUses) {
      useChatStore
        .getState()
        .setStatus({ phase: 'running-tool', name: tu.name, round: safety });
      const { content, isError } = await executeTool(tu);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content,
        ...(isError ? { is_error: true } : {}),
      });
    }
    useChatStore.getState().appendMessage({
      id: mkId('msg'),
      role: 'user',
      content: toolResults,
      createdAt: Date.now(),
    });
  }
}
