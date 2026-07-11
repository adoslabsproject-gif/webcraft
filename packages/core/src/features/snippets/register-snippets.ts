import * as monaco from 'monaco-editor';
import { useSnippetsStore } from './snippets-store';

/// Wire user + builtin snippets into Monaco's completion provider so they
/// appear in autocomplete with the magic `prefix` trigger ("fc" → React FC).

let registered = false;
let disposables: monaco.IDisposable[] = [];

export function registerSnippetCompletions(): void {
  if (registered) return;
  registered = true;

  const languages = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'python', 'sql', 'html'];
  for (const lang of languages) {
    disposables.push(
      monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['$'],
        provideCompletionItems(model, position) {
          const word = model.getWordUntilPosition(position);
          const range: monaco.IRange = {
            startLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: word.endColumn,
          };
          const snippets = useSnippetsStore.getState().byLanguage(lang);
          return {
            suggestions: snippets.map<monaco.languages.CompletionItem>((s) => ({
              label: s.prefix,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: s.body.join('\n'),
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: { value: s.description, isTrusted: true },
              detail: s.builtin ? 'WebCraft built-in snippet' : 'User snippet',
              range,
            })),
          };
        },
      }),
    );
  }
}

export function unregisterSnippetCompletions(): void {
  for (const d of disposables) d.dispose();
  disposables = [];
  registered = false;
}
