import { Store } from '@tauri-apps/plugin-store';

/// Background scheduler — REAL implementation behind the cron_create /
/// cron_list / cron_delete / schedule_wakeup agent tools.
///
/// Jobs are persisted (scheduler.json via tauri-plugin-store) and restored
/// on app boot. A 20s tick loop fires due jobs by injecting their prompt
/// into the chat exactly as if the user typed it (sendChat), so the agent
/// wakes up, runs, and the user sees the whole thing in the transcript.
/// One-shot wake-ups whose fire time passed while the app was closed fire
/// once at the next boot instead of being silently lost.

export interface ScheduledJob {
  id: string;
  kind: 'cron' | 'once';
  /// 5-field cron expression for kind=cron.
  expression?: string;
  prompt: string;
  createdAt: number;
  /// Epoch ms of the next (or only) firing.
  nextRun: number;
}

const TICK_MS = 20_000;

let jobs: ScheduledJob[] = [];
let ticker: ReturnType<typeof setInterval> | null = null;
let storePromise: Promise<Store> | null = null;
let initialized = false;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load('scheduler.json', { autoSave: 200, defaults: {} });
  return storePromise;
}

async function persist(): Promise<void> {
  const store = await getStore();
  await store.set('jobs', jobs);
}

// ── Minimal-but-correct 5-field cron matcher ─────────────────────────────
// Supports: "*", "*/n", "a", "a-b", "a,b,c" (and combinations via commas)
// for minute, hour, day-of-month, month, day-of-week (0=Sunday).

function fieldMatches(field: string, value: number): boolean {
  for (const part of field.split(',')) {
    if (part === '*') return true;
    const step = /^\*\/(\d+)$/.exec(part);
    if (step) {
      if (value % Number(step[1]) === 0) return true;
      continue;
    }
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      if (value >= Number(range[1]) && value <= Number(range[2])) return true;
      continue;
    }
    if (/^\d+$/.test(part) && Number(part) === value) return true;
  }
  return false;
}

export function cronMatches(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [min, hour, dom, month, dow] = fields as [string, string, string, string, string];
  return (
    fieldMatches(min, date.getMinutes()) &&
    fieldMatches(hour, date.getHours()) &&
    fieldMatches(dom, date.getDate()) &&
    fieldMatches(month, date.getMonth() + 1) &&
    fieldMatches(dow, date.getDay())
  );
}

/// Next matching minute after `from` (scan up to 366 days; a valid 5-field
/// expression always matches within a year).
export function nextCronRun(expression: string, from: Date): number | null {
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() < limit) {
    if (cronMatches(expression, cursor)) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

// ── Public API (used by the agent tool handlers) ─────────────────────────

export function validateCron(expression: string): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return 'Expected a 5-field cron expression (min hour dom month dow).';
  for (const f of fields) {
    if (!/^(\*|\*\/\d+|\d+(-\d+)?)(,(\*|\*\/\d+|\d+(-\d+)?))*$/.test(f)) {
      return `Invalid cron field "${f}". Supported: * , */n , a , a-b and comma lists.`;
    }
  }
  return nextCronRun(expression, new Date()) === null
    ? 'Expression never matches within a year.'
    : null;
}

export async function createCronJob(expression: string, prompt: string): Promise<ScheduledJob> {
  const invalid = validateCron(expression);
  if (invalid) throw new Error(invalid);
  const next = nextCronRun(expression, new Date());
  if (next === null) throw new Error('Expression never matches.');
  const job: ScheduledJob = {
    id: `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind: 'cron',
    expression,
    prompt,
    createdAt: Date.now(),
    nextRun: next,
  };
  jobs.push(job);
  await persist();
  return job;
}

export async function createWakeup(delaySeconds: number, prompt: string): Promise<ScheduledJob> {
  if (!Number.isFinite(delaySeconds) || delaySeconds < 5) {
    throw new Error('delay_seconds must be a number >= 5.');
  }
  const job: ScheduledJob = {
    id: `wake_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind: 'once',
    prompt,
    createdAt: Date.now(),
    nextRun: Date.now() + delaySeconds * 1000,
  };
  jobs.push(job);
  await persist();
  return job;
}

export function listJobs(): ScheduledJob[] {
  return [...jobs];
}

export async function deleteJob(id: string): Promise<boolean> {
  const before = jobs.length;
  jobs = jobs.filter((j) => j.id !== id);
  if (jobs.length === before) return false;
  await persist();
  return true;
}

// ── Tick loop ────────────────────────────────────────────────────────────

async function fire(job: ScheduledJob): Promise<void> {
  const { useChatStore } = await import('../../features/chat/chat-store');
  // A run is already streaming: postpone one tick instead of dropping.
  if (useChatStore.getState().streaming) {
    job.nextRun = Date.now() + TICK_MS;
    return;
  }
  const { useAppStore } = await import('../../store/app-store');
  const { sendChat } = await import('../../features/chat/use-chat');
  useAppStore.getState().openChatTab();
  const header =
    job.kind === 'cron'
      ? `[Scheduled job ${job.id} — cron "${job.expression}"]`
      : `[Scheduled wake-up ${job.id}]`;
  void sendChat(`${header}\n${job.prompt}`);

  if (job.kind === 'cron' && job.expression) {
    const next = nextCronRun(job.expression, new Date());
    if (next !== null) {
      job.nextRun = next;
      await persist();
      return;
    }
  }
  await deleteJob(job.id);
}

async function tick(): Promise<void> {
  const now = Date.now();
  for (const job of [...jobs]) {
    if (job.nextRun <= now) await fire(job);
  }
}

/// Restore persisted jobs and start the tick loop. Idempotent; call once
/// from the app shell on boot.
export async function initScheduler(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const store = await getStore();
    jobs = (await store.get<ScheduledJob[]>('jobs')) ?? [];
  } catch {
    jobs = [];
  }
  ticker = setInterval(() => void tick(), TICK_MS);
  // Fire anything that came due while the app was closed.
  void tick();
}

export function shutdownScheduler(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
  initialized = false;
}
