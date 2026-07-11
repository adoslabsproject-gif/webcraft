import { create } from 'zustand';

/// Snippets store — user-defined + builtin code snippets. Format compatible
/// with VS Code snippets (`prefix` / `body[]` / `description`).
///
/// Builtin library covers: TS/JS (function, component, hook, type),
/// Python (def, class), SQL (CRUD), HTML (boilerplate).
/// User snippets persist via tauri-plugin-store.

export interface Snippet {
  id: string;
  language: string;
  prefix: string;
  body: string[];
  description: string;
  builtin?: boolean;
}

const BUILTIN: Snippet[] = [
  {
    id: 'b-ts-fn',
    language: 'typescript',
    prefix: 'fn',
    body: ['function ${1:name}(${2:args}): ${3:void} {', '\t$0', '}'],
    description: 'TypeScript function',
    builtin: true,
  },
  {
    id: 'b-ts-component',
    language: 'typescriptreact',
    prefix: 'fc',
    body: [
      "import { type FC } from 'react';",
      '',
      'export const ${1:Component}: FC<${2:Props}> = ({ ${3:children} }) => {',
      '\treturn <div>$0</div>;',
      '};',
    ],
    description: 'React function component',
    builtin: true,
  },
  {
    id: 'b-ts-hook',
    language: 'typescriptreact',
    prefix: 'hook',
    body: [
      'export function use${1:Hook}(${2:deps}) {',
      '\tconst [${3:state}, set${3/(.)/${1:/upcase}/}] = useState($4);',
      '\treturn { ${3:state} } as const;',
      '}',
    ],
    description: 'React custom hook',
    builtin: true,
  },
  {
    id: 'b-py-def',
    language: 'python',
    prefix: 'def',
    body: ['def ${1:name}(${2:args}) -> ${3:None}:', '\t"""${4:docstring}"""', '\t$0'],
    description: 'Python function',
    builtin: true,
  },
  {
    id: 'b-py-class',
    language: 'python',
    prefix: 'class',
    body: [
      'class ${1:Name}:',
      '\t"""${2:docstring}"""',
      '\tdef __init__(self${3:, args}):',
      '\t\t$0',
    ],
    description: 'Python class',
    builtin: true,
  },
  {
    id: 'b-sql-select',
    language: 'sql',
    prefix: 'sel',
    body: ['SELECT ${1:*} FROM ${2:table} WHERE ${3:condition};'],
    description: 'SQL select',
    builtin: true,
  },
  {
    id: 'b-html-boilerplate',
    language: 'html',
    prefix: '!',
    body: [
      '<!doctype html>',
      '<html lang="${1:en}">',
      '<head>',
      '\t<meta charset="UTF-8" />',
      '\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '\t<title>${2:Document}</title>',
      '</head>',
      '<body>',
      '\t$0',
      '</body>',
      '</html>',
    ],
    description: 'HTML5 boilerplate',
    builtin: true,
  },
];

interface SnippetsState {
  snippets: Snippet[];
  add: (s: Omit<Snippet, 'id' | 'builtin'>) => void;
  remove: (id: string) => void;
  byLanguage: (language: string) => Snippet[];
}

export const useSnippetsStore = create<SnippetsState>((set, get) => ({
  snippets: BUILTIN,
  add: (s) =>
    set((state) => ({
      snippets: [...state.snippets, { ...s, id: `u-${Date.now().toString(36)}` }],
    })),
  remove: (id) =>
    set((state) => ({
      snippets: state.snippets.filter((s) => s.id !== id),
    })),
  byLanguage: (language) => get().snippets.filter((s) => s.language === language),
}));
