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
const DEBOUNCE_MS = 350;
const MIN_CHARS = 2;

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
        if (settings.activeProvider !== 'nha' && !settings.apiKeys[settings.activeProvider]) {
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
            model: settings.model,
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

        return {
          items: [
            {
              insertText: cleaned,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
            },
          ],
          enableForwardStability: true,
        };
      },
      freeInlineCompletions() {
        /* no-op — items are plain text */
      },
    },
  );
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
