import { useAppStore } from '../../store/app-store';
import { scanProject } from './project-scan';

/// Automatic whole-project problem detection — IDE-grade behavior:
///   - scan when a project opens (short delay so the UI settles first)
///   - re-scan (debounced) after every fs change: manual saves bump
///     fsChangeCounter just like agent tool edits, so both trigger it
///   - single-flight: a scan in progress absorbs re-triggers; one queued
///     re-run fires afterwards so the last change is never missed
///
/// State lives in app-store (scanningProblems / scanProblems /
/// problemsScanFailure) so the Problems panel and any future status
/// indicator render the same truth.

let inFlight = false;
let queued = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

export async function runProjectScan(): Promise<void> {
  const store = useAppStore.getState();
  const projectRoot = store.projectRoot;
  if (!projectRoot) return;
  if (inFlight) {
    queued = true;
    return;
  }
  inFlight = true;
  store.setScanningProblems(true);
  try {
    const result = await scanProject(projectRoot);
    const s = useAppStore.getState();
    // Project switched while scanning → discard stale results.
    if (s.projectRoot === projectRoot) {
      s.setScanProblems(result.problems);
      s.setProblemsScanFailure(result.failure);
    }
  } catch (e) {
    useAppStore.getState().setProblemsScanFailure(String(e));
  } finally {
    inFlight = false;
    useAppStore.getState().setScanningProblems(false);
    if (queued) {
      queued = false;
      void runProjectScan();
    }
  }
}

function scheduleScan(delayMs: number): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void runProjectScan(), delayMs);
}

/// Start the watchers. Idempotent — call once from the app shell.
export function initAutoScan(): void {
  if (started) return;
  started = true;

  let lastRoot = useAppStore.getState().projectRoot;
  let lastFsCounter = useAppStore.getState().fsChangeCounter;

  useAppStore.subscribe((state) => {
    if (state.projectRoot !== lastRoot) {
      lastRoot = state.projectRoot;
      state.setScanProblems([]);
      state.setProblemsScanFailure(null);
      if (state.projectRoot) scheduleScan(2000);
    }
    if (state.fsChangeCounter !== lastFsCounter) {
      lastFsCounter = state.fsChangeCounter;
      if (state.projectRoot) scheduleScan(3000);
    }
  });

  if (lastRoot) scheduleScan(2000);
}
