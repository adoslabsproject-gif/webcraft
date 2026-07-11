import * as monaco from 'monaco-editor';

/// AI Code Lens — registers Monaco CodeLens providers that overlay
/// "✨ Explain · Test · Refactor" actions above every function/method/class
/// declaration. Click on a lens emits `webcraft:codelens:*` events which
/// the ChatView listens to and pre-fills the prompt.

const LANGUAGES = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'];

const FN_PATTERNS: RegExp[] = [
  // function foo(
  /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g,
  // const foo = (
  /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g,
  // class Foo {
  /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g,
];

export function registerAiCodeLens(): monaco.IDisposable {
  const disposables: monaco.IDisposable[] = [];

  for (const lang of LANGUAGES) {
    disposables.push(
      monaco.languages.registerCodeLensProvider(lang, {
        provideCodeLenses(model) {
          const lenses: monaco.languages.CodeLens[] = [];
          const text = model.getValue();
          for (const pat of FN_PATTERNS) {
            // Reset lastIndex for global regex
            pat.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = pat.exec(text)) !== null) {
              const name = m[1];
              if (!name) continue;
              const offset = m.index + (m[0].startsWith('\n') ? 1 : 0);
              const position = model.getPositionAt(offset);
              const range: monaco.IRange = {
                startLineNumber: position.lineNumber,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: 1,
              };
              lenses.push({
                range,
                id: `explain_${offset}`,
                command: {
                  id: 'webcraft.codelens.explain',
                  title: '✨ Explain',
                  arguments: [name, model.uri.path],
                },
              });
              lenses.push({
                range,
                id: `test_${offset}`,
                command: {
                  id: 'webcraft.codelens.test',
                  title: '🧪 Generate test',
                  arguments: [name, model.uri.path],
                },
              });
              lenses.push({
                range,
                id: `refactor_${offset}`,
                command: {
                  id: 'webcraft.codelens.refactor',
                  title: '🔧 Refactor',
                  arguments: [name, model.uri.path],
                },
              });
            }
          }
          return { lenses, dispose() {} };
        },
        resolveCodeLens(_model, lens) {
          return lens;
        },
      }),
    );
  }

  // Register Monaco editor commands that fire DOM events the ChatView listens to.
  const dispatch = (kind: 'explain' | 'test' | 'refactor', name: string, path: string) =>
    window.dispatchEvent(
      new CustomEvent('webcraft:codelens', { detail: { kind, name, path } }),
    );

  disposables.push(
    monaco.editor.registerCommand('webcraft.codelens.explain', (_, name: string, path: string) =>
      dispatch('explain', name, path),
    ),
    monaco.editor.registerCommand('webcraft.codelens.test', (_, name: string, path: string) =>
      dispatch('test', name, path),
    ),
    monaco.editor.registerCommand('webcraft.codelens.refactor', (_, name: string, path: string) =>
      dispatch('refactor', name, path),
    ),
  );

  return {
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
