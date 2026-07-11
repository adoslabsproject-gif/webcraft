import { useEffect } from 'react';
import { ActivityBar } from './ActivityBar';
import { BottomPanel } from './BottomPanel';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';
import { Toolbar } from './Toolbar';
import { wireMenuEvents } from './menu-events';
import { ChatView } from '../features/chat/ChatView';
import { PermissionDialog } from '../features/chat/PermissionDialog';
import { CommandPalette } from '../features/command-palette/CommandPalette';
import { DialogHost } from '../features/dialog/DialogHost';
import { EditorArea } from '../features/editor/EditorArea';
import { useMonacoMarkers } from '../features/problems/use-monaco-markers';
import { ErrorBoundary } from '../lib/ErrorBoundary';
import { codebaseIndex } from '../features/embeddings/codebase-index';
import { useAppStore } from '../store/app-store';

/// Top-level app layout — VSCode/Cursor inspired 3-pane:
///   TitleBar
///   ┌─Activity─┬─Sidebar──┬───Editor + Bottom──┐
///   │         │         │                     │
///   └─────────┴─────────┴─────────────────────┘
///   StatusBar
///
/// AI Chat, DB Studio, and Dev Server all open as full-area tabs in the
/// editor — they need room to breathe and don't belong in cramped rails.
export function AppShell() {
  useMonacoMarkers();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const chatDockedRight = useAppStore((s) => s.chatDockedRight);
  const projectRoot = useAppStore((s) => s.projectRoot);

  // Auto-build the codebase embedding index when a project opens. Runs
  // off the main thread (the sidecar does the encoding), index is in
  // memory only. Re-builds if projectRoot changes; clears on close.
  useEffect(() => {
    if (!projectRoot) {
      codebaseIndex.reset();
      return;
    }
    void codebaseIndex.build(projectRoot);
  }, [projectRoot]);

  useEffect(() => {
    let unlisteners: Array<() => void> = [];
    wireMenuEvents()
      .then((u) => (unlisteners = u))
      .catch(() => {});
    return () => unlisteners.forEach((u) => u());
  }, []);

  // ⌘B → toggle sidebar (VSCode parity).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  return (
    <ErrorBoundary label="AppShell">
      <div className="flex h-screen w-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
        <TitleBar />
        <ErrorBoundary label="Toolbar"><Toolbar /></ErrorBoundary>
        <div className="flex flex-1 overflow-hidden">
          <ErrorBoundary label="ActivityBar"><ActivityBar /></ErrorBoundary>
          {sidebarOpen ? (
            <ErrorBoundary label="Sidebar"><Sidebar /></ErrorBoundary>
          ) : null}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              <ErrorBoundary label="EditorArea"><EditorArea /></ErrorBoundary>
            </div>
            <ErrorBoundary label="BottomPanel"><BottomPanel /></ErrorBoundary>
          </div>
          {chatDockedRight ? (
            <aside className="flex w-[380px] shrink-0 flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]">
              <ErrorBoundary label="ChatRightRail"><ChatView compact /></ErrorBoundary>
            </aside>
          ) : null}
        </div>
        <StatusBar />
        <ErrorBoundary label="CommandPalette"><CommandPalette /></ErrorBoundary>
        <ErrorBoundary label="PermissionDialog"><PermissionDialog /></ErrorBoundary>
        <ErrorBoundary label="DialogHost"><DialogHost /></ErrorBoundary>
      </div>
    </ErrorBoundary>
  );
}
