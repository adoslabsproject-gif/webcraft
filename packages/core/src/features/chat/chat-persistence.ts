import { Store } from '@tauri-apps/plugin-store';
import { getClaudeCodeSession, setClaudeCodeSession } from '../../lib/ai/claude-code-client';
import type { ChatMessage } from '../../lib/ai/types';
import { useAppStore } from '../../store/app-store';
import { useChatStore } from './chat-store';

/// Conversation history — multiple persisted sessions per project.
///
/// chats.json (tauri store) holds, per project key:
///   { activeId, sessions: [{ id, title, createdAt, updatedAt,
///     ccSessionId?, messages }] }
/// The ACTIVE session auto-saves (debounced) on every chat change; the
/// history dropdown lists all of them; switching swaps the transcript AND
/// the Claude Code resume id so the model's context follows the session.
/// Legacy v1 format (plain ChatMessage[]) migrates to a single session.

export interface ChatSessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface StoredSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  ccSessionId?: string;
  messages: ChatMessage[];
}

interface StoredProject {
  activeId: string;
  sessions: StoredSession[];
}

const MAX_MESSAGES = 300;
const MAX_SESSIONS = 40;
const SAVE_DEBOUNCE_MS = 800;

let storePromise: Promise<Store> | null = null;
let currentKey = '';
let currentProject: StoredProject | null = null;
let loading = false;
let started = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load('chats.json', { autoSave: 200, defaults: {} });
  return storePromise;
}

function keyFor(projectRoot: string | null): string {
  return projectRoot ?? '_no_project';
}

function mkSessionId(): string {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function titleFrom(messages: ChatMessage[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const text = m.content.find((b) => b.type === 'text');
    if (text && text.type === 'text' && text.text.trim()) {
      const t = text.text.trim().replace(/\s+/g, ' ');
      return t.length > 48 ? `${t.slice(0, 45)}…` : t;
    }
  }
  return 'New conversation';
}

/// Drop volatile flags and heavy payloads before writing to disk.
function sanitize(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_MESSAGES).map((m) => ({
    ...m,
    streaming: false,
    content: m.content.map((b) =>
      b.type === 'image' ? { type: 'text' as const, text: '[image attachment]' } : b,
    ),
  }));
}

function emptySession(): StoredSession {
  const now = Date.now();
  return { id: mkSessionId(), title: 'New conversation', createdAt: now, updatedAt: now, messages: [] };
}

function notify(): void {
  for (const l of listeners) l();
}

async function persistProject(): Promise<void> {
  if (!currentProject) return;
  try {
    const store = await getStore();
    await store.set(currentKey, currentProject);
  } catch {
    /* best-effort */
  }
}

function activeSession(): StoredSession | null {
  if (!currentProject) return null;
  return currentProject.sessions.find((s) => s.id === currentProject?.activeId) ?? null;
}

function applySessionToUi(session: StoredSession): void {
  loading = true;
  useChatStore.setState({
    messages: session.messages,
    streaming: false,
    pendingText: '',
    error: null,
    status: { phase: 'idle' },
  });
  const root = useAppStore.getState().projectRoot;
  setClaudeCodeSession(root, session.ccSessionId ?? null);
  loading = false;
}

async function loadFor(key: string): Promise<void> {
  loading = true;
  try {
    const store = await getStore();
    const raw = await store.get<StoredProject | ChatMessage[]>(key);
    if (Array.isArray(raw)) {
      // v1 migration: a bare transcript becomes the single session.
      const session: StoredSession = {
        ...emptySession(),
        title: titleFrom(raw),
        messages: raw,
      };
      currentProject = { activeId: session.id, sessions: [session] };
      await persistProject();
    } else if (raw && Array.isArray(raw.sessions) && raw.sessions.length > 0) {
      currentProject = raw;
    } else {
      const session = emptySession();
      currentProject = { activeId: session.id, sessions: [session] };
    }
  } catch {
    const session = emptySession();
    currentProject = { activeId: session.id, sessions: [session] };
  }
  const session = activeSession() ?? currentProject.sessions[0]!;
  currentProject.activeId = session.id;
  applySessionToUi(session);
  notify();
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const session = activeSession();
    if (!session) return;
    const messages = sanitize(useChatStore.getState().messages);
    session.messages = messages;
    session.updatedAt = Date.now();
    session.title = titleFrom(messages);
    const ccSession = getClaudeCodeSession(useAppStore.getState().projectRoot);
    if (ccSession) session.ccSessionId = ccSession;
    void persistProject().then(notify);
  }, SAVE_DEBOUNCE_MS);
}

// ── Public API (ChatView history UI) ─────────────────────────────────────

export function listChatSessions(): ChatSessionMeta[] {
  if (!currentProject) return [];
  return [...currentProject.sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
    }));
}

export function activeChatSessionId(): string | null {
  return currentProject?.activeId ?? null;
}

export function switchChatSession(id: string): void {
  if (!currentProject) return;
  const session = currentProject.sessions.find((s) => s.id === id);
  if (!session) return;
  currentProject.activeId = id;
  applySessionToUi(session);
  void persistProject().then(notify);
}

export function newChatSession(): void {
  if (!currentProject) return;
  const session = emptySession();
  currentProject.sessions.push(session);
  // Cap history: drop the oldest beyond the limit (keep the new one).
  if (currentProject.sessions.length > MAX_SESSIONS) {
    currentProject.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    currentProject.sessions = currentProject.sessions.slice(0, MAX_SESSIONS);
    if (!currentProject.sessions.some((s) => s.id === session.id)) {
      currentProject.sessions.push(session);
    }
  }
  currentProject.activeId = session.id;
  applySessionToUi(session);
  void persistProject().then(notify);
}

export function deleteChatSession(id: string): void {
  if (!currentProject) return;
  currentProject.sessions = currentProject.sessions.filter((s) => s.id !== id);
  if (currentProject.sessions.length === 0) currentProject.sessions.push(emptySession());
  if (currentProject.activeId === id) {
    const next = [...currentProject.sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]!;
    currentProject.activeId = next.id;
    applySessionToUi(next);
  }
  void persistProject().then(notify);
}

/// Subscribe to history changes (session list / active id). Returns
/// unsubscribe.
export function onChatHistoryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/// Restore the current project's history and start the watchers.
/// Idempotent — call once from the app shell.
export function initChatPersistence(): void {
  if (started) return;
  started = true;

  currentKey = keyFor(useAppStore.getState().projectRoot);
  void loadFor(currentKey);

  useAppStore.subscribe((state) => {
    const key = keyFor(state.projectRoot);
    if (key !== currentKey) {
      currentKey = key;
      void loadFor(key);
    }
  });

  let lastMessages = useChatStore.getState().messages;
  useChatStore.subscribe((state) => {
    if (state.messages === lastMessages) return;
    lastMessages = state.messages;
    if (loading) return;
    scheduleSave();
  });
}
