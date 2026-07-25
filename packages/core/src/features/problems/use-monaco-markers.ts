import * as monaco from 'monaco-editor';
import { useEffect } from 'react';
import { useAppStore } from '../../store/app-store';

/// Subscribe to Monaco's marker collector and forward all diagnostics
/// (TypeScript, JSON, CSS, HTML language services) into app-store.problems
/// so the ProblemsPanel can render them.
export function useMonacoMarkers() {
  const setProblems = useAppStore((s) => s.setProblems);

  useEffect(() => {
    // Markers worth surfacing as user-visible problems exclude noise from
    // language workers that can't reach the network (Tauri CSP blocks
    // external $schema fetches — the file is still valid, the validator
    // just can't fetch the schema to enrich the validation).
    const isNoise = (msg: string): boolean =>
      /Unable to load schema/i.test(msg) ||
      /No schema request service/i.test(msg) ||
      /Failed to load schema/i.test(msg);

    const update = () => {
      // Only markers from real files on disk (scheme 'file'). Monaco also
      // holds models for virtual documents — tool-library snippet previews
      // (webcraft://tool-library/*), untitled buffers — whose diagnostics
      // are not the user's project problems and whose paths don't exist on
      // the filesystem (clicking them would fail with "No such file").
      const markers = monaco.editor
        .getModelMarkers({})
        .filter((m) => m.resource.scheme === 'file' && !isNoise(m.message));
      setProblems(
        markers.map((m, i) => ({
          id: `${m.resource.path}:${m.startLineNumber}:${m.startColumn}:${i}`,
          path: m.resource.path.replace(/^\/+/, '/'),
          line: m.startLineNumber,
          column: m.startColumn,
          message: m.message,
          severity:
            m.severity === monaco.MarkerSeverity.Error
              ? 'error'
              : m.severity === monaco.MarkerSeverity.Warning
                ? 'warning'
                : 'info',
        })),
      );
    };

    const disposable = monaco.editor.onDidChangeMarkers(update);
    update();
    return () => disposable.dispose();
  }, [setProblems]);
}
