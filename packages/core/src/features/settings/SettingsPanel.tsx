import { Eye, EyeOff, Save, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ClaudeCodePermissionMode, OutputStyle, Provider } from '../../store/settings-store';
import { useSettingsStore } from '../../store/settings-store';
import { McpSettings } from './McpSettings';
import { MemorySettings } from './MemorySettings';

const PROVIDERS: { id: Provider; label: string; hint: string; needsKey: boolean }[] = [
  {
    id: 'claude-code',
    label: 'Claude Code (local)',
    hint: 'Your installed claude CLI — subscription, no API billing',
    needsKey: false,
  },
  { id: 'anthropic', label: 'Anthropic', hint: 'Claude API key (sk-ant-...)', needsKey: true },
  { id: 'openai', label: 'OpenAI', hint: 'OpenAI API key (sk-...)', needsKey: true },
  { id: 'openrouter', label: 'OpenRouter', hint: 'OpenRouter key (sk-or-...)', needsKey: true },
  { id: 'deepseek', label: 'DeepSeek', hint: 'DeepSeek API key (sk-...)', needsKey: true },
  { id: 'grok', label: 'Grok (x.ai)', hint: 'xAI API key (xai-...)', needsKey: true },
  { id: 'gemini', label: 'Gemini', hint: 'Google AI Studio key (AIza...)', needsKey: true },
];

const CC_PERMISSION_MODES: { id: ClaudeCodePermissionMode; label: string; hint: string }[] = [
  {
    id: 'acceptEdits',
    label: 'Accept edits',
    hint: 'File edits auto-approved; risky commands blocked',
  },
  { id: 'plan', label: 'Plan only', hint: 'Read-only: proposes a plan, never touches files' },
  { id: 'bypassPermissions', label: 'Bypass (YOLO)', hint: 'Approves everything — use with care' },
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
                    title={p.label}
                    className={`min-w-0 truncate rounded border px-2 py-1.5 text-left text-xs transition-colors ${
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

            {activeProvider === 'claude-code' ? (
              <Section title="Claude Code permissions">
                <ClaudeCodeModePicker />
              </Section>
            ) : null}

            <Section title="API keys">
              {PROVIDERS.filter((p) => p.needsKey).map((p) => (
                <ApiKeyField
                  key={p.id}
                  label={p.label}
                  hint={p.hint}
                  value={apiKeys[p.id]}
                  onSave={(v) => setApiKey(p.id, v)}
                />
              ))}
            </Section>

            <Section title="AI memory">
              <MemorySettings />
            </Section>

            <Section title="Editor">
              <FormatOnSaveToggle />
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

function FormatOnSaveToggle() {
  const on = useSettingsStore((s) => s.formatOnSave);
  const setOn = useSettingsStore((s) => s.setFormatOnSave);
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => void setOn(e.target.checked)}
        className="h-3.5 w-3.5 accent-indigo-500"
      />
      Format on save
      <span className="text-[10px] text-neutral-500">(LSP formatter on ⌘S)</span>
    </label>
  );
}

function ClaudeCodeModePicker() {
  const mode = useSettingsStore((s) => s.claudeCodePermissionMode);
  const setMode = useSettingsStore((s) => s.setClaudeCodePermissionMode);
  return (
    <div className="grid grid-cols-1 gap-1">
      {CC_PERMISSION_MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => void setMode(m.id)}
          className={`rounded border px-2 py-1.5 text-left text-xs transition-colors ${
            mode === m.id
              ? 'border-indigo-500 bg-indigo-500/10 text-neutral-100'
              : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700'
          }`}
        >
          <div className="font-medium">{m.label}</div>
          <div className="text-[10px] text-neutral-500">{m.hint}</div>
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
          className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="button"
          aria-label="Toggle reveal"
          onClick={() => setReveal((r) => !r)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-800 text-neutral-500 hover:text-neutral-200"
        >
          {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => void onSave(draft)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-indigo-600 text-white disabled:opacity-30"
          aria-label="Save"
        >
          <Save className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
