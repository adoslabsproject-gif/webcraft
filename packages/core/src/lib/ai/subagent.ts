import { createProvider, providerSupportsTools } from './router';
import { executeTool } from './tool-executor';
import { TOOLS } from './tools';
import type { ContentBlock, ToolDefinition, ToolResultBlock } from './types';
import { useSettingsStore } from '../../store/settings-store';
import { useSubagentStore, type SubagentTranscript } from './subagent-store';

/// Subagent runner — spawn an isolated LLM conversation with a custom
/// system prompt and a curated subset of tools, then return the final
/// assistant text to the caller. This is the foundation of the Task tool
/// (Claude Code parity): "go research X, come back with a summary".
///
/// Design:
///   - Uses the user's currently selected provider/model
///   - Tool set is configurable per subagent type — defaults are READ-ONLY
///     (read_file, glob, grep, list_directory, get_diagnostics) so a subagent
///     can't accidentally rewrite the codebase mid-research
///   - Cannot recursively spawn more subagents (no Task tool exposed)
///   - Transcript saved in subagent-store so the parent UI can display it

const READ_ONLY_TOOL_NAMES = new Set([
  'read_file',
  'glob',
  'grep',
  'list_directory',
  'find_references',
  'goto_definition',
  'get_diagnostics',
  'get_symbols',
  'get_file_stat',
  'get_imports',
  'get_project_metadata',
  'web_fetch',
  'web_search',
  'git_status',
  'git_diff',
  'git_log',
  'git_blame',
  'git_show',
  'git_branches',
  'semantic_search',
]);

export interface SubagentSpec {
  /// Display label.
  title: string;
  /// System prompt prepended verbatim. The runtime adds a footer reminding
  /// the subagent that it must return its summary as text only.
  systemPrompt: string;
  /// The actual user request driving this subagent.
  task: string;
  /// Tool whitelist. Defaults to READ_ONLY_TOOL_NAMES (research-safe).
  toolWhitelist?: Set<string>;
  /// Max iterations to prevent runaway loops.
  maxRounds?: number;
}

export interface SubagentResult {
  id: string;
  transcript: SubagentTranscript;
  finalText: string;
  toolCalls: number;
  rounds: number;
}

const SUBAGENT_FOOTER = `

═══ SUBAGENT CONTRACT ═══
- You are a focused sub-task assistant. Complete the task above using the available tools.
- Return your final answer as plain text — the parent agent will quote you verbatim.
- Be concise. Do not chat. No questions back.
- Do not spawn more subagents. If you need shell exec, refuse and report back.`;

export async function runSubagent(spec: SubagentSpec): Promise<SubagentResult> {
  const settings = useSettingsStore.getState();
  const provider = createProvider({
    provider: settings.activeProvider,
    apiKey: settings.apiKeys[settings.activeProvider],
  });
  if (!provider) {
    throw new Error(`${settings.activeProvider} needs an API key.`);
  }
  const supportsTools = providerSupportsTools(settings.activeProvider);
  const whitelist = spec.toolWhitelist ?? READ_ONLY_TOOL_NAMES;
  const allowedTools: ToolDefinition[] = TOOLS.filter((t) => whitelist.has(t.name));
  const maxRounds = spec.maxRounds ?? 8;

  const transcript: SubagentTranscript = {
    id: `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: spec.title,
    task: spec.task,
    startedAt: Date.now(),
    status: 'running',
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: spec.task }],
      },
    ],
  };
  useSubagentStore.getState().add(transcript);

  let toolCalls = 0;
  let rounds = 0;
  let finalText = '';

  for (let round = 0; round < maxRounds; round++) {
    rounds++;
    let assistantBlocks: ContentBlock[] = [];
    let stopReason = 'end_turn';
    try {
      const result = await provider.stream({
        model: settings.model,
        system: spec.systemPrompt + SUBAGENT_FOOTER,
        messages: transcript.messages.map((m) => ({
          id: `${transcript.id}_${m.role}_${transcript.messages.indexOf(m)}`,
          role: m.role,
          content: m.content,
          createdAt: transcript.startedAt,
        })),
        ...(supportsTools && allowedTools.length > 0 ? { tools: allowedTools } : {}),
        callbacks: {
          onText: () => {},
          onToolUse: () => {},
          onStop: () => {},
          onError: () => {},
          onUsage: (u) => useSettingsStore.getState().addTokens(u.input, u.output),
        },
      });
      assistantBlocks = result.assistantBlocks;
      stopReason = result.stopReason;
    } catch (e) {
      transcript.status = 'failed';
      transcript.error = e instanceof Error ? e.message : String(e);
      useSubagentStore.getState().update(transcript.id, transcript);
      throw e;
    }

    transcript.messages.push({ role: 'assistant', content: assistantBlocks });

    const textBlocks = assistantBlocks.filter((b): b is { type: 'text'; text: string } => b.type === 'text');
    if (textBlocks.length > 0) {
      finalText = textBlocks.map((t) => t.text).join('\n');
    }

    if (stopReason !== 'tool_use') break;

    const toolUses = assistantBlocks.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    if (toolUses.length === 0) break;

    const toolResults: ToolResultBlock[] = [];
    for (const tu of toolUses) {
      toolCalls++;
      if (!whitelist.has(tu.name)) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `Tool "${tu.name}" not allowed for this subagent. Allowed: ${[...whitelist].join(', ')}`,
          is_error: true,
        });
        continue;
      }
      const { content, isError } = await executeTool(tu);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content,
        ...(isError ? { is_error: true } : {}),
      });
    }
    transcript.messages.push({ role: 'user', content: toolResults });
    useSubagentStore.getState().update(transcript.id, { ...transcript });
  }

  transcript.status = 'completed';
  transcript.finishedAt = Date.now();
  transcript.finalText = finalText;
  useSubagentStore.getState().update(transcript.id, transcript);

  return { id: transcript.id, transcript, finalText, toolCalls, rounds };
}
