import * as monaco from 'monaco-editor';
import { createProvider } from '../../lib/ai/router';
import { useSettingsStore } from '../../store/settings-store';

/// Ghost text autocomplete — Copilot/Cursor Tab style. Suggests a multi-line
/// completion at the cursor position; user presses Tab to accept.
///
/// Strategy:
///   - Debounce 300ms after each keystroke
///   - Send context: 80 lines BEFORE the cursor + 20 lines AFTER (so the
///     model knows what's coming and doesn't generate duplicate code)
///   - System prompt forces "code only, no fences, no explanation"
///   - AbortController per request; new keystroke cancels in-flight call
///   - Single suggestion per call (k=1) — multi-suggestion adds latency

const SYSTEM = `You are a code-completion engine. Given the cursor context, suggest the next 1–10 lines of code.
RULES:
- Output ONLY the code that should appear AFTER the cursor. Nothing before.
- No markdown fences. No explanations. No prose.
- Preserve indentation. Match the language and style of the surrounding code.
- If the surrounding context already contains what would be the completion, output an empty string.
- Stop at a natural boundary (end of statement, end of block, end of expression).`;

const MAX_CONTEXT_BEFORE = 80;
const MAX_CONTEXT_AFTER = 20;
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

/// Completions must be FAST and cheap — never the chat model (which can be
/// a slow frontier model). Per-provider fast tier, chat model as fallback.
const FAST_MODELS: Partial<Record<string, string>> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5-mini',
  openrouter: 'anthropic/claude-haiku-4.5',
  deepseek: 'deepseek-chat',
  grok: 'grok-4-fast',
  gemini: 'gemini-2.5-flash',
};

/// LRU cache keyed by cursor context. Prefix-serving: when the user TYPES
/// the beginning of a cached suggestion, the remainder is served instantly
/// with zero network — the single biggest perceived-latency win.
const CACHE_MAX = 80;
const cache = new Map<string, string>();
/// Most recent suggestion + the context it was made for (prefix-serving).
let lastSuggestion: { before: string; text: string } | null = null;

function cacheKey(before: string, after: string): string {
  return `${before.slice(-600)}⟂${after.slice(0, 200)}`;
}

function cachePut(key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/// If `before` extends lastSuggestion's context by typing INTO the cached
/// suggestion, return what remains of it.
function prefixServe(before: string): string | null {
  if (!lastSuggestion) return null;
  if (!before.startsWith(lastSuggestion.before)) return null;
  const typed = before.slice(lastSuggestion.before.length);
  if (typed.length === 0) return lastSuggestion.text;
  if (lastSuggestion.text.startsWith(typed)) {
    const rest = lastSuggestion.text.slice(typed.length);
    return rest.length > 0 ? rest : null;
  }
  return null;
}

let suggestionAbort: AbortController | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

interface GhostState {
  enabled: boolean;
}
const state: GhostState = { enabled: true };

export function setGhostAutocompleteEnabled(on: boolean): void {
  state.enabled = on;
}

export function isGhostAutocompleteEnabled(): boolean {
  return state.enabled;
}

export function registerGhostAutocomplete(): monaco.IDisposable {
  return monaco.languages.registerInlineCompletionsProvider(
    [
      'typescript',
      'javascript',
      'typescriptreact',
      'javascriptreact',
      'python',
      'rust',
      'go',
      'java',
      'csharp',
      'php',
      'ruby',
      'html',
      'css',
      'json',
      'yaml',
      'sql',
      'markdown',
    ],
    {
      async provideInlineCompletions(model, position) {
        if (!state.enabled) return { items: [] };
        const settings = useSettingsStore.getState();
        if (!settings.loaded) return { items: [] };
        // Ghost completions need a fast single-shot API model. Claude Code
        // runs a full agentic session per call — far too heavy for
        // keystroke-latency completions, so it is excluded here.
        if (
          settings.activeProvider === 'claude-code' ||
          !settings.apiKeys[settings.activeProvider]
        ) {
          return { items: [] };
        }

        // Cancel any in-flight call.
        suggestionAbort?.abort();
        suggestionAbort = new AbortController();
        const localAbort = suggestionAbort;

        // Pull context around the cursor.
        const totalLines = model.getLineCount();
        const startLine = Math.max(1, position.lineNumber - MAX_CONTEXT_BEFORE);
        const endLine = Math.min(totalLines, position.lineNumber + MAX_CONTEXT_AFTER);
        const before = model.getValueInRange({
          startLineNumber: startLine,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const after = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: endLine,
          endColumn: model.getLineMaxColumn(endLine),
        });

        if (before.trim().length < MIN_CHARS) return { items: [] };

        // Zero-latency paths FIRST — before any debounce or network:
        // 1. the user is typing into the previous suggestion → serve the rest
        const served = prefixServe(before);
        if (served) {
          return { items: [ghostItem(served, position)] };
        }
        // 2. exact context seen before → cached completion
        const key = cacheKey(before, after);
        const hit = cache.get(key);
        if (hit) {
          lastSuggestion = { before, text: hit };
          return { items: [ghostItem(hit, position)] };
        }

        // Debounce — wait for a quiet moment before sending.
        await new Promise<void>((resolve) => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(resolve, DEBOUNCE_MS);
        });
        if (localAbort.signal.aborted) return { items: [] };

        const provider = createProvider({
          provider: settings.activeProvider,
          apiKey: settings.apiKeys[settings.activeProvider],
        });
        if (!provider) return { items: [] };

        const language = model.getLanguageId();
        const userMsg =
          `# Language: ${language}\n# Cursor position: <CURSOR>\n\n` +
          '```\n' +
          before +
          '<CURSOR>' +
          after +
          '\n```\n\n' +
          'Continue from <CURSOR> with the next 1–10 lines of code only:';

        let collected = '';
        try {
          await provider.stream({
            model: FAST_MODELS[settings.activeProvider] ?? settings.model,
            system: SYSTEM,
            messages: [
              {
                id: 'ghost',
                role: 'user',
                content: [{ type: 'text', text: userMsg }],
                createdAt: Date.now(),
              },
            ],
            signal: localAbort.signal,
            maxTokens: 256,
            callbacks: {
              onText: (d) => {
                collected += d;
              },
              onToolUse: () => {},
              onStop: () => {},
              onError: () => {},
            },
          });
        } catch {
          return { items: [] };
        }
        if (localAbort.signal.aborted) return { items: [] };

        const cleaned = cleanGhostText(collected);
        if (!cleaned) return { items: [] };

        cachePut(key, cleaned);
        lastSuggestion = { before, text: cleaned };
        return { items: [ghostItem(cleaned, position)], enableForwardStability: true };
      },
      disposeInlineCompletions() {
        /* no-op — items are plain text */
      },
    },
  );
}

function ghostItem(
  text: string,
  position: monaco.IPosition,
): monaco.languages.InlineCompletion {
  return {
    insertText: text,
    range: new monaco.Range(
      position.lineNumber,
      position.column,
      position.lineNumber,
      position.column,
    ),
  };
}

function cleanGhostText(raw: string): string {
  let t = raw.trim();
  // Strip ```lang fences the model might emit despite the system prompt.
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```\s*$/m.exec(t);
  if (fenced) t = fenced[1] ?? '';
  // If the model echoed <CURSOR>, cut at that point.
  const cursorIdx = t.indexOf('<CURSOR>');
  if (cursorIdx >= 0) t = t.slice(0, cursorIdx);
  return t;
}
