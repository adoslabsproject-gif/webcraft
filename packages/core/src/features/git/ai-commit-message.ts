import { Command } from '@tauri-apps/plugin-shell';
import { createProvider } from '../../lib/ai/router';
import { useSettingsStore } from '../../store/settings-store';

/// Generate a conventional commit message from the currently staged diff.
/// Pattern: <type>(<scope>): <description> — under 72 chars on the subject.
/// Body optional. The model gets the actual `git diff --staged` output.

const SYSTEM = `You are a senior engineer writing concise conventional-commit messages.
Output FORMAT (exact):
  <type>(<optional-scope>): <imperative subject under 72 chars>

  <optional 1-3 line body explaining WHY the change matters>

Rules:
- type ∈ {feat, fix, refactor, docs, test, chore, perf, ci, build, style, revert}
- subject in lowercase, no trailing period, imperative ("add" not "added")
- skip the body if the change is trivial
- NEVER mention file paths in the subject — those live in the diff
- NEVER use emoji
- Output ONLY the message. No fences, no preamble.`;

export async function generateCommitMessage(projectRoot: string): Promise<string> {
  const diffResult = await Command.create('git', ['-C', projectRoot, 'diff', '--staged'], {
    cwd: projectRoot,
  }).execute();
  if (diffResult.code !== 0) {
    throw new Error(`git diff --staged failed: ${diffResult.stderr}`);
  }
  const diff = diffResult.stdout.trim();
  if (!diff) throw new Error('Nothing staged — `git add` first.');

  const settings = useSettingsStore.getState();
  const provider = createProvider({
    provider: settings.activeProvider,
    apiKey: settings.apiKeys[settings.activeProvider],
  });
  if (!provider) {
    throw new Error(`${settings.activeProvider} needs an API key (Settings).`);
  }

  // Cap diff size to keep the prompt under model limits (most commits are <8k chars).
  const capped = diff.length > 12000 ? `${diff.slice(0, 12000)}\n…[truncated]` : diff;

  let collected = '';
  await provider.stream({
    model: settings.model,
    system: SYSTEM,
    messages: [
      {
        id: 'commit-msg',
        role: 'user',
        content: [{ type: 'text', text: `# Staged diff\n\n${capped}` }],
        createdAt: Date.now(),
      },
    ],
    callbacks: {
      onText: (delta) => {
        collected += delta;
      },
      onToolUse: () => {},
      onStop: () => {},
      onError: () => {},
      onUsage: (u) => useSettingsStore.getState().addTokens(u.input, u.output),
    },
  });

  return collected.trim();
}
