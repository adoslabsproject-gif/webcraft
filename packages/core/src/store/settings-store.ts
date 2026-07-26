import { invoke } from '@tauri-apps/api/core';
import { Store } from '@tauri-apps/plugin-store';
import { create } from 'zustand';

/// Persistent settings store.
///
/// Non-secret preferences (provider, model, theme, …) live in
/// tauri-plugin-store (settings.json). API KEYS live in the OS KEYCHAIN
/// (macOS Keychain / Windows Credential Manager / Linux Secret Service)
/// via the Rust `secret_*` commands — they are held in memory for the
/// session and NEVER written to disk unencrypted. Plaintext keys saved by
/// older versions migrate into the keychain on first load and are wiped
/// from settings.json.

export type Provider =
  | 'claude-code'
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'grok'
  | 'gemini';

/// Claude Code headless permission behavior: acceptEdits auto-approves file
/// edits but not arbitrary commands beyond the defaults; plan never touches
/// files; bypassPermissions approves everything (dangerous, explicit opt-in).
export type ClaudeCodePermissionMode = 'acceptEdits' | 'plan' | 'bypassPermissions';

/// User-selectable response style — injected as a directive in the system
/// prompt. Matches Claude Code CLI's `--output-style` flag.
export type OutputStyle = 'default' | 'explanatory' | 'concise' | 'code-only' | 'plan-first';

export const OUTPUT_STYLE_DIRECTIVES: Record<OutputStyle, string> = {
  default: '',
  explanatory:
    'Output style: EXPLANATORY. Before and after every code change, give 2–3 brief educational insights about the implementation choice in a ★ Insight block.',
  concise:
    'Output style: CONCISE. One short sentence per turn. Skip preambles. Code blocks only when explicitly asked.',
  'code-only':
    'Output style: CODE-ONLY. Reply with code blocks and the minimum prose to clarify which file changes where. No insights, no preambles.',
  'plan-first':
    'Output style: PLAN-FIRST. ALWAYS open with a numbered plan of what you will do. Only after the plan, call tools. Concise plan: max 5 bullets.',
};

const DEFAULT_MODELS: Record<Provider, string> = {
  // 'default' = let the CLI pick the model configured in Claude Code.
  'claude-code': 'default',
  anthropic: 'claude-opus-4-7',
  openai: 'gpt-5',
  openrouter: 'anthropic/claude-opus-4-7',
  deepseek: 'deepseek-chat',
  grok: 'grok-4',
  gemini: 'gemini-2.5-pro',
};

const EMPTY_KEYS: Record<Provider, string> = {
  'claude-code': '',
  anthropic: '',
  openai: '',
  openrouter: '',
  deepseek: '',
  grok: '',
  gemini: '',
};

interface SettingsState {
  apiKeys: Record<Provider, string>;
  activeProvider: Provider;
  model: string;
  theme: 'dark' | 'light';
  outputStyle: OutputStyle;
  claudeCodePermissionMode: ClaudeCodePermissionMode;
  /// Token usage accumulated since app start. Reset on reload.
  tokensInput: number;
  tokensOutput: number;
  loaded: boolean;
  load: () => Promise<void>;
  setApiKey: (provider: Provider, key: string) => Promise<void>;
  setActiveProvider: (provider: Provider) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  setTheme: (theme: 'dark' | 'light') => Promise<void>;
  setOutputStyle: (style: OutputStyle) => Promise<void>;
  setClaudeCodePermissionMode: (mode: ClaudeCodePermissionMode) => Promise<void>;
  addTokens: (input: number, output: number) => void;
}

let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load('settings.json', { autoSave: 200, defaults: {} });
  }
  return storePromise;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  apiKeys: { ...EMPTY_KEYS },
  activeProvider: 'anthropic',
  model: DEFAULT_MODELS.anthropic,
  theme: 'dark',
  outputStyle: 'default',
  claudeCodePermissionMode: 'acceptEdits',
  tokensInput: 0,
  tokensOutput: 0,
  loaded: false,

  async load() {
    if (get().loaded) return;
    const store = await getStore();
    const apiKeys = { ...EMPTY_KEYS };
    // MIGRATION: plaintext keys from older versions move into the OS
    // keychain, then get wiped from settings.json — one way, once.
    const legacyKeys = (await store.get<Record<string, string>>('apiKeys')) ?? null;
    if (legacyKeys && Object.values(legacyKeys).some((v) => v)) {
      for (const provider of Object.keys(apiKeys) as Provider[]) {
        const value = legacyKeys[provider];
        if (typeof value === 'string' && value) {
          try {
            await invoke('secret_set', { key: `apikey.${provider}`, value });
          } catch {
            /* keychain locked/unavailable — keep the key in memory below */
          }
          apiKeys[provider] = value;
        }
      }
      await store.delete('apiKeys');
    }
    // Normal path: read each key from the keychain.
    for (const provider of Object.keys(apiKeys) as Provider[]) {
      if (apiKeys[provider]) continue; // just migrated
      try {
        const value = await invoke<string | null>('secret_get', { key: `apikey.${provider}` });
        if (value) apiKeys[provider] = value;
      } catch {
        /* keychain unavailable — provider will show as key-less */
      }
    }
    const storedProvider = (await store.get<string>('activeProvider')) ?? 'anthropic';
    const activeProvider: Provider =
      storedProvider in DEFAULT_MODELS ? (storedProvider as Provider) : 'anthropic';
    const storedModel = await store.get<string>('model');
    // A model persisted for a removed provider (e.g. the old NHA vLLM path)
    // must not leak into the new active provider.
    const model =
      storedModel && storedProvider === activeProvider
        ? storedModel
        : DEFAULT_MODELS[activeProvider];
    const theme = (await store.get<'dark' | 'light'>('theme')) ?? 'dark';
    const outputStyle = (await store.get<OutputStyle>('outputStyle')) ?? 'default';
    const claudeCodePermissionMode =
      (await store.get<ClaudeCodePermissionMode>('claudeCodePermissionMode')) ?? 'acceptEdits';
    set({
      apiKeys,
      activeProvider,
      model,
      theme,
      outputStyle,
      claudeCodePermissionMode,
      loaded: true,
    });
  },

  async setApiKey(provider, key) {
    const apiKeys = { ...get().apiKeys, [provider]: key };
    set({ apiKeys });
    // Keychain only — never settings.json.
    if (key) {
      await invoke('secret_set', { key: `apikey.${provider}`, value: key });
    } else {
      await invoke('secret_delete', { key: `apikey.${provider}` });
    }
  },

  async setActiveProvider(provider) {
    const model = DEFAULT_MODELS[provider];
    set({ activeProvider: provider, model });
    const store = await getStore();
    await store.set('activeProvider', provider);
    await store.set('model', model);
  },

  async setModel(model) {
    set({ model });
    const store = await getStore();
    await store.set('model', model);
  },

  async setTheme(theme) {
    set({ theme });
    const store = await getStore();
    await store.set('theme', theme);
  },

  async setOutputStyle(style) {
    set({ outputStyle: style });
    const store = await getStore();
    await store.set('outputStyle', style);
  },

  async setClaudeCodePermissionMode(mode) {
    set({ claudeCodePermissionMode: mode });
    const store = await getStore();
    await store.set('claudeCodePermissionMode', mode);
  },

  addTokens(input, output) {
    set((s) => ({ tokensInput: s.tokensInput + input, tokensOutput: s.tokensOutput + output }));
  },
}));
