import type { Problem } from '../../store/app-store';

/// THE problem count. Live Monaco markers (open files, unsaved edits) merged
/// with the whole-project scan, deduped by position — live wins. Every
/// surface that shows a number (Problems panel, bottom-tab badge, status
/// bar) MUST use this so the counts never disagree.
export function mergeProblems(live: Problem[], scan: Problem[]): Problem[] {
  const liveKeys = new Set(live.map((p) => `${p.path}:${p.line}:${p.column}`));
  return [...live, ...scan.filter((p) => !liveKeys.has(`${p.path}:${p.line}:${p.column}`))];
}
