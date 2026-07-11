import { Store } from '@tauri-apps/plugin-store';
import { create } from 'zustand';

/// Persistent settings store backed by tauri-plugin-store.
///
/// Holds API keys for each LLM provider, the active provider/model, theme
/// and editor preferences. The Tauri store writes to a JSON file in the
/// app's local data dir (encrypted at rest by the OS file permissions).
///
/// Note: this is a transitional storage. The real secret store is the OS
/// keychain via @napi-rs/keyring — wired through the Node sidecar — and
/// will replace this for `apiKeys` once the sidecar is online.

export type Provider = 'anthropic' | 'openai' | 'openrouter' | 'nha';

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
  anthropic: 'claude-opus-4-7',
  openai: 'gpt-5',
  openrouter: 'anthropic/claude-opus-4-7',
  // Liara LoRA on Qwen3 32B — vLLM serves it at this absolute path.
  nha: '/opt/models/qwen3-32b',
};

interface SettingsState {
  apiKeys: Record<Provider, string>;
  activeProvider: Provider;
  model: string;
  theme: 'dark' | 'light';
  outputStyle: OutputStyle;
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
  apiKeys: { anthropic: '', openai: '', openrouter: '', nha: '' },
  // Default: NHA Free (Liara). No API key required — works immediately.
  activeProvider: 'nha',
  model: DEFAULT_MODELS.nha,
  theme: 'dark',
  outputStyle: 'default',
  tokensInput: 0,
  tokensOutput: 0,
  loaded: false,

  async load() {
    if (get().loaded) return;
    const store = await getStore();
    const apiKeys =
      ((await store.get<Record<Provider, string>>('apiKeys')) ?? {
        anthropic: '',
        openai: '',
        openrouter: '',
        nha: '',
      });
    const activeProvider = (await store.get<Provider>('activeProvider')) ?? 'nha';
    const model = (await store.get<string>('model')) ?? DEFAULT_MODELS[activeProvider];
    const theme = (await store.get<'dark' | 'light'>('theme')) ?? 'dark';
    const outputStyle = (await store.get<OutputStyle>('outputStyle')) ?? 'default';
    set({ apiKeys, activeProvider, model, theme, outputStyle, loaded: true });
  },

  async setApiKey(provider, key) {
    const apiKeys = { ...get().apiKeys, [provider]: key };
    set({ apiKeys });
    const store = await getStore();
    await store.set('apiKeys', apiKeys);
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

  addTokens(input, output) {
    set((s) => ({ tokensInput: s.tokensInput + input, tokensOutput: s.tokensOutput + output }));
  },
}));
