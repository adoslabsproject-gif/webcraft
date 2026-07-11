import { useCallback, useEffect, useState } from 'react';
import { languageForPath, pickSaveFile, readFile, writeFile } from '../../lib/ipc/fs';
import { useAppStore } from '../../store/app-store';
import { isLikelyBinary, isUtf8Error } from './binary-detect';

/// Editor hook: loads file content when the active tab changes, exposes a
/// save() that writes back to disk and clears the dirty marker.
///
/// Binary files are detected (by extension or by Rust UTF-8 failure) and
/// shown as a non-editable placeholder so the editor doesn't error out.

export type EditorKind = 'text' | 'binary';

export function useEditor() {
  const tabs = useAppStore((s) => s.editorTabs);
  const activeId = useAppStore((s) => s.activeEditorTabId);
  const active = tabs.find((t) => t.id === activeId) ?? null;

  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState('plaintext');
  const [kind, setKind] = useState<EditorKind>('text');

  useEffect(() => {
    if (!active) {
      setContent('');
      setOriginalContent('');
      setLanguage('plaintext');
      setKind('text');
      return;
    }
    // Special tab kinds (db-studio, future: settings UI, welcome) don't
    // back a real file — EditorArea renders a dedicated component instead
    // of Monaco, so we skip the read entirely.
    if (active.kind && active.kind !== 'file') {
      setContent('');
      setOriginalContent('');
      setLanguage('plaintext');
      setKind('text');
      setError(null);
      setLoading(false);
      return;
    }
    // Untitled buffers don't back a real path yet — start empty, no fs read.
    // First save() will trigger a "Save As" dialog (handled elsewhere) to
    // bind the buffer to a real path.
    if (active.path.startsWith('webcraft://untitled-')) {
      setContent('');
      setOriginalContent('');
      setLanguage('plaintext');
      setKind('text');
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const name = active.path.split('/').pop() ?? '';
    if (isLikelyBinary(name)) {
      // Skip the read entirely for known-binary files.
      setKind('binary');
      setContent('');
      setOriginalContent('');
      setLanguage('plaintext');
      setLoading(false);
      return;
    }

    setKind('text');
    readFile(active.path)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setOriginalContent(text);
        setLanguage(languageForPath(active.path));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isUtf8Error(e)) {
          // Rust read_to_string failed because the file is not valid UTF-8 —
          // treat as binary and show the placeholder.
          setKind('binary');
          setError(null);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const onChange = useCallback(
    (value: string | undefined) => {
      const next = value ?? '';
      setContent(next);
      const store = useAppStore.getState();
      const tab = store.editorTabs.find((t) => t.id === activeId);
      if (!tab) return;
      const dirty = next !== originalContent;
      if (tab.dirty !== dirty) {
        const updated = store.editorTabs.map((t) =>
          t.id === activeId ? { ...t, dirty } : t,
        );
        useAppStore.setState({ editorTabs: updated });
      }
    },
    [activeId, originalContent],
  );

  const save = useCallback(async () => {
    if (!active || kind === 'binary') return;
    // Untitled buffer: prompt for a real path on first save, then promote the
    // tab (rebind id + path + label so it behaves like any other file tab).
    if (active.path.startsWith('webcraft://untitled-')) {
      const store = useAppStore.getState();
      const targetPath = await pickSaveFile({
        ...(store.projectRoot
          ? { defaultPath: `${store.projectRoot}/${active.label}.txt` }
          : { defaultPath: `${active.label}.txt` }),
      });
      if (!targetPath) return;
      await writeFile(targetPath, content);
      const newLabel = targetPath.split('/').pop() ?? active.label;
      const updated = store.editorTabs.map((t) =>
        t.id === active.id
          ? { ...t, id: targetPath, path: targetPath, label: newLabel, dirty: false }
          : t,
      );
      useAppStore.setState({ editorTabs: updated, activeEditorTabId: targetPath });
      setOriginalContent(content);
      setLanguage(languageForPath(targetPath));
      return;
    }
    await writeFile(active.path, content);
    setOriginalContent(content);
    const store = useAppStore.getState();
    const updated = store.editorTabs.map((t) =>
      t.id === active.id ? { ...t, dirty: false } : t,
    );
    useAppStore.setState({ editorTabs: updated });
  }, [active, content, kind]);

  return { active, content, language, loading, error, kind, onChange, save };
}
