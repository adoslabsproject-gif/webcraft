import { ChevronRight, Folder } from 'lucide-react';
import { useAppStore } from '../store/app-store';

/// Top breadcrumb bar — shows project + active file path.
///
/// The macOS window title bar already shows "WebCraft" (set by Tauri's
/// `productName`), so duplicating it here is redundant. Instead this bar
/// is used as a VS Code-style breadcrumb of "where am I" in the project.
export function TitleBar() {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const active = useAppStore((s) => s.editorTabs.find((t) => t.id === s.activeEditorTabId));
  const projectName = projectRoot?.split('/').filter(Boolean).at(-1) ?? null;

  if (!projectName && !active) {
    return (
      <div className="flex h-7 items-center justify-center border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] text-[10px] text-[var(--color-fg-dim)]">
        No folder opened
      </div>
    );
  }

  const relativePath =
    active && projectRoot
      ? active.path.replace(`${projectRoot}/`, '').split('/')
      : active
        ? [active.label]
        : [];

  return (
    <div className="flex h-7 items-center gap-1 overflow-hidden border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 text-[10px] text-[var(--color-fg-subtle)]">
      {projectName ? (
        <>
          <Folder className="h-3 w-3 shrink-0 text-amber-400/70" />
          <span className="font-medium text-[var(--color-fg-muted)]">{projectName}</span>
        </>
      ) : null}
      {relativePath.map((segment, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 shrink-0 text-[var(--color-fg-dim)]" />
          <span
            className={
              i === relativePath.length - 1
                ? 'text-[var(--color-fg)]'
                : 'text-[var(--color-fg-subtle)]'
            }
          >
            {segment}
          </span>
        </span>
      ))}
      {active?.dirty ? (
        <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-fg-muted)]" />
      ) : null}
    </div>
  );
}
