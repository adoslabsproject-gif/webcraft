import { Eye, EyeOff, Save, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OutputStyle, Provider } from '../../store/settings-store';
import { useSettingsStore } from '../../store/settings-store';
import { McpSettings } from './McpSettings';

const PROVIDERS: { id: Provider; label: string; hint: string }[] = [
  { id: 'anthropic', label: 'Anthropic', hint: 'Claude API key (sk-ant-...)' },
  { id: 'openai', label: 'OpenAI', hint: 'OpenAI API key (sk-...)' },
  { id: 'openrouter', label: 'OpenRouter', hint: 'OpenRouter key (sk-or-...)' },
  { id: 'nha', label: 'NHA Liara (free)', hint: 'Token from nothumanallowed.com' },
];

/// Settings panel — provider selection + API keys (Tauri store backed).
export function SettingsPanel() {
  const load = useSettingsStore((s) => s.load);
  const loaded = useSettingsStore((s) => s.loaded);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider);
  const model = useSettingsStore((s) => s.model);
  const setModel = useSettingsStore((s) => s.setModel);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-neutral-800 bg-neutral-950 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          <SettingsIcon className="h-3 w-3" />
          Settings
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {!loaded ? (
          <p className="text-xs text-neutral-500">Loading…</p>
        ) : (
          <>
            <Section title="Active provider">
              <div className="grid grid-cols-2 gap-1.5">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveProvider(p.id)}
                    className={`rounded border px-2 py-1.5 text-left text-xs transition-colors ${
                      activeProvider === p.id
                        ? 'border-indigo-500 bg-indigo-500/10 text-neutral-100'
                        : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Model">
              <input
                type="text"
                value={model}
                onChange={(e) => void setModel(e.target.value)}
                className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 font-mono text-xs text-neutral-200 focus:border-indigo-500 focus:outline-none"
              />
            </Section>

            <Section title="API keys">
              {PROVIDERS.map((p) => (
                <ApiKeyField
                  key={p.id}
                  label={p.label}
                  hint={p.hint}
                  value={apiKeys[p.id]}
                  onSave={(v) => setApiKey(p.id, v)}
                />
              ))}
            </Section>

            <Section title="Output style">
              <OutputStylePicker />
            </Section>

            <Section title="MCP">
              <McpSettings />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

const OUTPUT_STYLES: { id: OutputStyle; label: string; hint: string }[] = [
  { id: 'default', label: 'Default', hint: 'Vanilla model behaviour' },
  { id: 'explanatory', label: 'Explanatory', hint: '★ Insight blocks around code changes' },
  { id: 'concise', label: 'Concise', hint: 'One short sentence, no preamble' },
  { id: 'code-only', label: 'Code-only', hint: 'Code blocks + minimum prose' },
  { id: 'plan-first', label: 'Plan-first', hint: 'Numbered plan before any tool call' },
];

function OutputStylePicker() {
  const outputStyle = useSettingsStore((s) => s.outputStyle);
  const setOutputStyle = useSettingsStore((s) => s.setOutputStyle);
  return (
    <div className="grid grid-cols-1 gap-1">
      {OUTPUT_STYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => void setOutputStyle(s.id)}
          className={`rounded border px-2 py-1.5 text-left text-xs transition-colors ${
            outputStyle === s.id
              ? 'border-indigo-500 bg-indigo-500/10 text-neutral-100'
              : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700'
          }`}
        >
          <div className="font-medium">{s.label}</div>
          <div className="text-[10px] text-neutral-500">{s.hint}</div>
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function ApiKeyField({
  label,
  hint,
  value,
  onSave,
}: {
  label: string;
  hint: string;
  value: string;
  onSave: (next: string) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(value);
  const [reveal, setReveal] = useState(false);
  const dirty = draft !== value;

  useEffect(() => setDraft(value), [value]);

  return (
    <div className="mb-2">
      <label className="block text-xs text-neutral-400">{label}</label>
      <div className="mt-0.5 flex gap-1">
        <input
          type={reveal ? 'text' : 'password'}
          value={draft}
          placeholder={hint}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="button"
          aria-label="Toggle reveal"
          onClick={() => setReveal((r) => !r)}
          className="flex h-7 w-7 items-center justify-center rounded border border-neutral-800 text-neutral-500 hover:text-neutral-200"
        >
          {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => void onSave(draft)}
          className="flex h-7 w-7 items-center justify-center rounded bg-indigo-600 text-white disabled:opacity-30"
          aria-label="Save"
        >
          <Save className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
