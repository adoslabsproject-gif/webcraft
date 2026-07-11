import * as monaco from 'monaco-editor';
import { useAppStore } from '../../store/app-store';

/// Pulls the live editor state (active file content + Monaco diagnostics)
/// and formats it as a context block injected at the top of every chat
/// message. Lets Liara see what the user is looking at right now — the
/// closest thing to "tool calling" we can get with a non-tool-aware model.

export function buildEditorContext(): string {
  const state = useAppStore.getState();
  const active = state.editorTabs.find((t) => t.id === state.activeEditorTabId);
  const projectRoot = state.projectRoot;

  const parts: string[] = [];

  if (projectRoot) {
    parts.push(`## Project root\n\`${projectRoot}\``);
  }

  if (active) {
    const model = monaco.editor.getModel(monaco.Uri.file(active.path));
    const content = model?.getValue() ?? '';
    const truncated = content.length > 30_000;
    parts.push(
      `## Currently open file\n\`${active.path}\`\n\n\`\`\`\n${truncated ? `${content.slice(0, 30_000)}\n… (truncated, ${content.length - 30_000} more chars)` : content}\n\`\`\``,
    );

    const markers = monaco.editor.getModelMarkers({ resource: monaco.Uri.file(active.path) });
    if (markers.length > 0) {
      const lines = markers
        .slice(0, 30)
        .map(
          (m) =>
            `- [${severityLabel(m.severity)}] L${m.startLineNumber}:${m.startColumn} — ${m.message}`,
        );
      parts.push(`## Diagnostics for the open file\n${lines.join('\n')}`);
    }
  }

  const allProblems = state.problems;
  if (allProblems.length > 0 && !active) {
    const lines = allProblems
      .slice(0, 20)
      .map((p) => `- [${p.severity}] ${p.path}:${p.line}:${p.column} — ${p.message}`);
    parts.push(`## Project-wide problems (top 20)\n${lines.join('\n')}`);
  }

  if (parts.length === 0) return '';
  return parts.join('\n\n');
}

function severityLabel(s: monaco.MarkerSeverity): string {
  if (s === monaco.MarkerSeverity.Error) return 'error';
  if (s === monaco.MarkerSeverity.Warning) return 'warning';
  if (s === monaco.MarkerSeverity.Info) return 'info';
  return 'hint';
}
