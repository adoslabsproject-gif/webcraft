/// WebCraft core — public exports consumed by apps/desktop.

export { registerAiCodeLens } from './features/code-lens/ai-code-lens';
export {
  registerGhostAutocomplete,
  setGhostAutocompleteEnabled,
} from './features/editor/ghost-autocomplete';
export { registerLspProviders } from './features/editor/lsp-client';
export { registerSnippetCompletions } from './features/snippets/register-snippets';
export { AppShell } from './shell/AppShell';
export { useAppStore } from './store/app-store';
