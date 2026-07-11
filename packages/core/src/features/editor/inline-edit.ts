import * as monaco from 'monaco-editor';
import { createProvider, providerSupportsTools } from '../../lib/ai/router';
import { useSettingsStore } from '../../store/settings-store';
import { getEditor } from './editor-controller';

/// Cursor ⌘K — inline AI edit. Triggered by ⌘K in Monaco.
///   1. Read current selection (or whole file if no selection)
///   2. Prompt user for the edit instruction via a floating input above the selection
///   3. Stream model's rewrite, replacing the selection live
///   4. Accept/Reject buttons appear after streaming completes
///
/// This is the centrepiece of the "AI IDE" experience — fast, surgical, in-buffer.

const SYSTEM = `You are an inline code editor. The user selected a code block and gave an instruction.
Output ONLY the rewritten code. No markdown fences. No explanations. No prose.
Preserve indentation exactly. If the instruction is impossible, return the original code unchanged.`;

interface InlineEditOptions {
  editor: monaco.editor.IStandaloneCodeEditor;
  instruction: string;
  onProgress: (newCode: string) => void;
  onDone: (newCode: string) => void;
  onError: (err: Error) => void;
  signal: AbortSignal;
}

export async function runInlineEdit(opts: InlineEditOptions): Promise<void> {
  const { editor, instruction, onProgress, onDone, onError, signal } = opts;
  const model = editor.getModel();
  if (!model) {
    onError(new Error('No active editor model'));
    return;
  }

  let selection = editor.getSelection();
  if (!selection || selection.isEmpty()) {
    // Whole-file edit
    selection = model.getFullModelRange();
  }
  const source = model.getValueInRange(selection);
  const language = model.getLanguageId();

  const settings = useSettingsStore.getState();
  const provider = createProvider({
    provider: settings.activeProvider,
    apiKey: settings.apiKeys[settings.activeProvider],
  });
  if (!provider) {
    onError(new Error(`${settings.activeProvider} needs an API key (Settings).`));
    return;
  }

  const userMsg =
    `# Language: ${language}\n` +
    `# Instruction: ${instruction}\n\n` +
    `# Code:\n${source}\n\n` +
    `# Rewritten code (ONLY code, no fences):`;

  let accumulated = '';
  try {
    await provider.stream({
      model: settings.model,
      system: SYSTEM,
      messages: [
        {
          id: 'inline-edit',
          role: 'user',
          content: [{ type: 'text', text: userMsg }],
          createdAt: Date.now(),
        },
      ],
      // No tools for inline edit — must produce raw code only.
      ...(providerSupportsTools(settings.activeProvider) ? { tools: [] } : {}),
      signal,
      callbacks: {
        onText: (delta) => {
          accumulated += delta;
          onProgress(stripFences(accumulated));
        },
        onToolUse: () => {},
        onStop: () => {},
        onError: (e) => onError(e),
        onUsage: (u) => useSettingsStore.getState().addTokens(u.input, u.output),
      },
    });
  } catch (e) {
    onError(e instanceof Error ? e : new Error(String(e)));
    return;
  }

  onDone(stripFences(accumulated));
}

/// Strip ```lang fences the model might emit despite the system prompt.
function stripFences(text: string): string {
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```\s*$/m.exec(text.trim());
  if (fenced) return fenced[1] ?? '';
  return text;
}

/// Register ⌘K action on Monaco. Called once during editor onMount.
export function registerInlineEditAction(
  editor: monaco.editor.IStandaloneCodeEditor,
  openPrompt: () => void,
): monaco.IDisposable {
  return editor.addAction({
    id: 'webcraft.inlineEdit',
    label: 'AI: Inline Edit',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
    contextMenuGroupId: 'webcraft-ai',
    run: () => openPrompt(),
  });
}

/// Programmatically replace the selection with edited content + decorate
/// the range with a "pending accept/reject" marker.
export function applyInlineReplacement(
  editor: monaco.editor.IStandaloneCodeEditor,
  range: monaco.IRange,
  newText: string,
): monaco.IRange {
  const model = editor.getModel();
  if (!model) return range;
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [
    { range, text: newText, forceMoveMarkers: true },
  ];
  model.pushEditOperations([], edits, () => null);
  // New range covering the replacement
  const lines = newText.split('\n');
  const endLine = range.startLineNumber + lines.length - 1;
  const endCol =
    lines.length === 1 ? range.startColumn + newText.length : (lines.at(-1)?.length ?? 0) + 1;
  return {
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: endLine,
    endColumn: endCol,
  };
}

/// Hook the global controller — useful for non-editor callers (Command Palette).
export function getCurrentEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return getEditor();
}
