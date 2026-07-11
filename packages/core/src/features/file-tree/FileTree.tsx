import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type NodeRendererProps, Tree } from 'react-arborist';
import { pickFolder } from '../../lib/ipc/fs';
import { useAppStore } from '../../store/app-store';
import { fileIconFor } from './file-icons';
import { FileTreeContextMenu } from './FileTreeContextMenu';
import { handleFileAction } from './file-actions';
import { type TreeNode, useFileTree } from './use-file-tree';

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode;
}

/// File tree (Explorer panel) — single-click opens, right-click shows
/// the full VSCode-style context menu. All actions are dispatched via the
/// centralized handleFileAction().
export function FileTree() {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const setProjectRoot = useAppStore((s) => s.setProjectRoot);
  const openEditorTab = useAppStore((s) => s.openEditorTab);
  const { data, loading, error, loadChildren, refresh, showHidden, toggleShowHidden } =
    useFileTree(projectRoot);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 280, height: 600 });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function handleOpenFolder() {
    const folder = await pickFolder();
    if (folder) setProjectRoot(folder);
  }

  async function dispatchAction(id: string, node: TreeNode) {
    try {
      await handleFileAction(
        id,
        { id: node.id, name: node.name, isDirectory: node.isDirectory, projectRoot },
        refresh,
      );
    } catch (e) {
      const { alert } = await import('../dialog/dialog-store');
      await alert('Action failed', e instanceof Error ? e.message : String(e));
    }
  }

  if (!projectRoot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <FolderOpen className="h-8 w-8 text-[var(--color-fg-dim)]" />
        <p className="text-xs text-[var(--color-fg-muted)]">No folder opened</p>
        <button
          type="button"
          onClick={handleOpenFolder}
          className="flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          Open Folder…
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Explorer
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={toggleShowHidden}
            title={
              showHidden
                ? 'Hide build artifacts (bin/obj/node_modules/target/dist/.next…)'
                : 'Show build artifacts'
            }
            className={`rounded p-1 transition-colors hover:bg-[var(--color-bg-hover)] ${
              showHidden
                ? 'text-amber-400 hover:text-amber-300'
                : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]'
            }`}
          >
            {showHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            title="Refresh"
            className="rounded p-1 text-[var(--color-fg-subtle)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleOpenFolder}
            className="ml-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
          >
            Open
          </button>
        </div>
      </div>
      <div className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-1 font-mono text-[10px] text-[var(--color-fg-subtle)]">
        {projectRoot.split('/').filter(Boolean).slice(-2).join('/')}
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden">
        {error ? (
          <div className="p-3 text-xs text-[var(--color-danger)]">{error}</div>
        ) : loading && data.length === 0 ? (
          <div className="p-3 text-xs text-[var(--color-fg-muted)]">Loading…</div>
        ) : (
          <Tree<TreeNode>
            data={data}
            openByDefault={false}
            width={size.width}
            height={size.height}
            indent={14}
            rowHeight={22}
            disableDrag
            disableDrop
            onToggle={(id) => {
              const node = findNode(data, id);
              if (node?.isDirectory && node.children === null) loadChildren(node);
            }}
          >
            {(props) => (
              <TreeRow
                {...props}
                onOpenFile={(n) =>
                  openEditorTab({ id: n.id, path: n.id, label: n.name, dirty: false })
                }
                onContext={(x, y, node) => setContextMenu({ x, y, node })}
              />
            )}
          </Tree>
        )}
      </div>
      {contextMenu ? (
        <FileTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isDirectory={contextMenu.node.isDirectory}
          onClose={() => setContextMenu(null)}
          onAction={(id) => dispatchAction(id, contextMenu.node)}
        />
      ) : null}
    </div>
  );
}

function TreeRow({
  node,
  style,
  onOpenFile,
  onContext,
}: NodeRendererProps<TreeNode> & {
  onOpenFile: (n: TreeNode) => void;
  onContext: (x: number, y: number, n: TreeNode) => void;
}) {
  const isDir = node.data.isDirectory;
  const fileSpec = isDir ? null : fileIconFor(node.data.name);
  const Icon = isDir ? (node.isOpen ? FolderOpen : Folder) : (fileSpec?.icon ?? Folder);
  const Caret = isDir ? (node.isOpen ? ChevronDown : ChevronRight) : null;

  // NB: we deliberately do NOT spread `dragHandle` as ref. Even with
  // disableDrag on Tree, attaching dragHandle to the row makes WKWebView
  // start an HTML5 drag operation on any 2-3px pointer drift during click
  // → stuck 🚫 cursor on the entire window. Click-only behavior is fine
  // for an Explorer; drag-to-move is a separate feature (drop targets +
  // permission checks) that we'll add later.
  return (
    <div
      style={style}
      onClick={() => {
        if (isDir) {
          node.toggle();
        } else {
          onOpenFile(node.data);
          node.select();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(e.clientX, e.clientY, node.data);
      }}
      className={`flex h-full cursor-pointer items-center gap-1 px-2 text-xs transition-colors ${
        node.isSelected
          ? 'bg-[var(--color-accent-muted)] text-[var(--color-fg)]'
          : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)]'
      }`}
    >
      <span className="w-3 shrink-0 text-[var(--color-fg-dim)]">
        {Caret ? <Caret className="h-3 w-3" /> : null}
      </span>
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${
          isDir ? 'text-amber-400/80' : (fileSpec?.color ?? 'text-[var(--color-fg-subtle)]')
        }`}
      />
      <span className="truncate">{node.data.name}</span>
    </div>
  );
}

function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const f = findNode(n.children, id);
      if (f) return f;
    }
  }
  return null;
}
