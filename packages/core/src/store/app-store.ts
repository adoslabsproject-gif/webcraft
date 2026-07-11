/// WebCraft global UI state — Zustand store.
///
/// Tracks the active panel in the ActivityBar (left rail), the active editor
/// tab, theme, and bottom-panel state. Atomic store: each feature reads only
/// the slice it needs to avoid re-render storms.

import { create } from 'zustand';

export type ActivityPanel =
  | 'explorer'
  | 'search'
  | 'git'
  | 'chat'
  | 'db-studio'
  | 'dev-server'
  | 'outline'
  | 'settings';

export type BottomTab = 'terminal' | 'diff' | 'output' | 'problems' | 'subagents';

export type EditorTabKind = 'file' | 'db-studio' | 'chat' | 'dev-server' | 'tool-library';

export interface EditorTab {
  id: string;
  path: string;
  label: string;
  dirty: boolean;
  /** Kind drives what EditorArea renders. Defaults to 'file' (Monaco). */
  kind?: EditorTabKind;
}

export const DB_STUDIO_TAB_ID = 'webcraft://db-studio';
export const CHAT_TAB_ID = 'webcraft://ai-chat';
export const DEV_SERVER_TAB_ID = 'webcraft://dev-server';
export const TOOL_LIBRARY_TAB_ID = 'webcraft://tool-library';

export interface Problem {
  id: string;
  path: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

interface AppState {
  activityPanel: ActivityPanel;
  bottomTab: BottomTab;
  bottomPanelOpen: boolean;
  sidebarOpen: boolean;
  /// AI Chat right-rail dock. When true, ChatView renders as a 380px panel
  /// on the right side of the editor — visible WHILE you edit files in the
  /// main area. When false, the chat lives only as a full-area tab (toggle
  /// via the dock button in the ChatView header).
  chatDockedRight: boolean;
  /// Monotonic counter bumped whenever a tool writes/edits/deletes a file.
  /// FileTree subscribes and refreshes on change so the user SEES new files
  /// (e.g. workflow.md just created by the model) without manual refresh.
  fsChangeCounter: number;
  editorTabs: EditorTab[];
  activeEditorTabId: string | null;
  projectRoot: string | null;
  problems: Problem[];
  setActivityPanel: (panel: ActivityPanel) => void;
  setBottomTab: (tab: BottomTab) => void;
  toggleBottomPanel: () => void;
  setBottomPanelOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleChatDock: () => void;
  setChatDocked: (docked: boolean) => void;
  /// Increment fsChangeCounter — call after every fs mutation that should
  /// be reflected in the Explorer.
  notifyFsChange: () => void;
  openEditorTab: (tab: EditorTab) => void;
  closeEditorTab: (id: string) => void;
  setActiveEditorTab: (id: string | null) => void;
  setProjectRoot: (root: string | null) => void;
  setProblems: (problems: Problem[]) => void;
  /** Open the singleton DB Studio tab in the editor area (or focus it if already open). */
  openDbStudioTab: () => void;
  /** Open the singleton AI Chat tab. */
  openChatTab: () => void;
  /** Open the singleton Dev Server tab. */
  openDevServerTab: () => void;
  /** Open the singleton Tool Library tab. */
  openToolLibraryTab: () => void;
  /** Open a new untitled file tab (no fs path until first save). */
  newUntitledFile: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activityPanel: 'explorer',
  bottomTab: 'terminal',
  bottomPanelOpen: true,
  sidebarOpen: true,
  chatDockedRight: false,
  fsChangeCounter: 0,
  editorTabs: [],
  activeEditorTabId: null,
  projectRoot: null,
  problems: [],
  setActivityPanel: (panel: ActivityPanel) => set({ activityPanel: panel }),
  setBottomTab: (tab: BottomTab) => set({ bottomTab: tab, bottomPanelOpen: true }),
  toggleBottomPanel: () => set((s: AppState) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setBottomPanelOpen: (open: boolean) => set({ bottomPanelOpen: open }),
  toggleSidebar: () => set((s: AppState) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),
  toggleChatDock: () => set((s: AppState) => ({ chatDockedRight: !s.chatDockedRight })),
  setChatDocked: (docked: boolean) => set({ chatDockedRight: docked }),
  notifyFsChange: () => set((s: AppState) => ({ fsChangeCounter: s.fsChangeCounter + 1 })),
  setProblems: (problems: Problem[]) => set({ problems }),
  openEditorTab: (tab: EditorTab) =>
    set((s: AppState) => {
      if (s.editorTabs.some((t) => t.id === tab.id)) {
        return { activeEditorTabId: tab.id };
      }
      return {
        editorTabs: [...s.editorTabs, tab],
        activeEditorTabId: tab.id,
      };
    }),
  closeEditorTab: (id: string) =>
    set((s: AppState) => {
      const remaining = s.editorTabs.filter((t) => t.id !== id);
      const nextActive =
        s.activeEditorTabId === id
          ? (remaining.at(-1)?.id ?? null)
          : s.activeEditorTabId;
      return { editorTabs: remaining, activeEditorTabId: nextActive };
    }),
  setActiveEditorTab: (id: string | null) => set({ activeEditorTabId: id }),
  setProjectRoot: (root: string | null) => set({ projectRoot: root }),
  openDbStudioTab: () =>
    set((s: AppState) => openOrFocusSingleton(s, DB_STUDIO_TAB_ID, 'DB Studio', 'db-studio')),
  openChatTab: () =>
    set((s: AppState) => openOrFocusSingleton(s, CHAT_TAB_ID, 'AI Chat', 'chat')),
  openDevServerTab: () =>
    set((s: AppState) => openOrFocusSingleton(s, DEV_SERVER_TAB_ID, 'Dev Server', 'dev-server')),
  openToolLibraryTab: () =>
    set((s: AppState) => openOrFocusSingleton(s, TOOL_LIBRARY_TAB_ID, 'Tool Library', 'tool-library')),
  newUntitledFile: () =>
    set((s: AppState) => {
      // Find the next available untitled-N counter so multiple New File clicks
      // produce distinct tabs (Untitled-1, Untitled-2, …).
      const taken = new Set(
        s.editorTabs
          .filter((t) => t.id.startsWith('webcraft://untitled-'))
          .map((t) => t.id),
      );
      let n = 1;
      while (taken.has(`webcraft://untitled-${n}`)) n++;
      const id = `webcraft://untitled-${n}`;
      const tab: EditorTab = {
        id,
        path: id,
        label: `Untitled-${n}`,
        dirty: false,
        kind: 'file',
      };
      return { editorTabs: [...s.editorTabs, tab], activeEditorTabId: id };
    }),
}));

/// Shared helper for all special tab kinds — keeps the singleton semantics
/// in ONE place. If the tab already exists, only the active id changes.
function openOrFocusSingleton(
  s: AppState,
  id: string,
  label: string,
  kind: EditorTabKind,
): Partial<AppState> {
  if (s.editorTabs.some((t) => t.id === id)) {
    return { activeEditorTabId: id };
  }
  const tab: EditorTab = { id, path: id, label, dirty: false, kind };
  return { editorTabs: [...s.editorTabs, tab], activeEditorTabId: id };
}
