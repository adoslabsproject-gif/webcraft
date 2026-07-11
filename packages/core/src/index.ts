/// WebCraft core — public exports consumed by apps/desktop.

export { AppShell } from './shell/AppShell';
export { useAppStore } from './store/app-store';
export { registerSnippetCompletions } from './features/snippets/register-snippets';
export { registerAiCodeLens } from './features/code-lens/ai-code-lens';
export { registerGhostAutocomplete, setGhostAutocompleteEnabled } from './features/editor/ghost-autocomplete';
export { registerLspProviders } from './features/editor/lsp-client';
