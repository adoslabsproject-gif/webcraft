import { Store } from '@tauri-apps/plugin-store';
import type { ChatMessage } from '../../lib/ai/types';
import { useAppStore } from '../../store/app-store';
import { useChatStore } from './chat-store';

/// Conversation persistence — transcripts survive app restarts.
///
/// One history per project (keyed by projectRoot; '_no_project' when no
/// folder is open), stored via tauri-plugin-store (chats.json in app data).
/// Switching projects swaps the visible transcript; every chat mutation
/// saves (debounced). Capped at the last 300 messages per project so the
/// store never grows unbounded.
///
/// Note: this restores what you SEE. Conversation *context* for the model
/// is separate — Claude Code resumes its own session per project; API
/// providers replay the restored messages, so both keep continuity.

const MAX_MESSAGES = 300;
const SAVE_DEBOUNCE_MS = 800;

let storePromise: Promise<Store> | null = null;
let currentKey = '';
let loading = false;
let started = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load('chats.json', { autoSave: 200, defaults: {} });
  return storePromise;
}

function keyFor(projectRoot: string | null): string {
  return projectRoot ?? '_no_project';
}

/// Drop volatile flags and heavy payloads before writing to disk: base64
/// image attachments would balloon the store, and a `streaming: true` flag
/// restored after a restart would render a forever-spinning bubble.
function sanitize(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_MESSAGES).map((m) => ({
    ...m,
    streaming: false,
    content: m.content.map((b) =>
      b.type === 'image' ? { type: 'text' as const, text: '[image attachment]' } : b,
    ),
  }));
}

async function loadFor(key: string): Promise<void> {
  loading = true;
  try {
    const store = await getStore();
    const messages = (await store.get<ChatMessage[]>(key)) ?? [];
    useChatStore.setState({
      messages,
      streaming: false,
      pendingText: '',
      error: null,
      status: { phase: 'idle' },
    });
  } catch {
    /* corrupted/missing history — start clean */
    useChatStore.getState().reset();
  } finally {
    loading = false;
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  const key = currentKey;
  saveTimer = setTimeout(() => {
    void (async () => {
      try {
        const store = await getStore();
        await store.set(key, sanitize(useChatStore.getState().messages));
      } catch {
        /* persistence is best-effort — never break the chat over it */
      }
    })();
  }, SAVE_DEBOUNCE_MS);
}

/// Restore the current project's transcript and start the watchers.
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
