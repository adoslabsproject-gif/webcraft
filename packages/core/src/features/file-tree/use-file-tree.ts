import { useCallback, useEffect, useState } from 'react';
import { listDir } from '../../lib/ipc/fs';
import { useAppStore } from '../../store/app-store';
import { filterTreeEntries } from './excludes';

/// Lazy-loading tree hook.
export interface TreeNode {
  id: string;
  name: string;
  isDirectory: boolean;
  children?: TreeNode[] | null;
}

export function useFileTree(rootPath: string | null) {
  const [data, setData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// Hide build artifacts (bin/obj/node_modules/target/dist/.next/...) by
  /// default — matches VSCode/JetBrains/Visual Studio behaviour. The
  /// Explorer header has an eye toggle that flips this.
  const [showHidden, setShowHidden] = useState(false);

  const loadRoot = useCallback(
    async (root: string, showHiddenNow: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const entries = filterTreeEntries(await listDir(root), showHiddenNow);
        const nodes: TreeNode[] = entries.map((e) =>
          e.isDirectory
            ? { id: e.path, name: e.name, isDirectory: true, children: null }
            : { id: e.path, name: e.name, isDirectory: false },
        );
        setData(nodes);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setData([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadChildren = useCallback(
    async (node: TreeNode) => {
      if (!node.isDirectory) return;
      try {
        const entries = filterTreeEntries(await listDir(node.id), showHidden);
        const children: TreeNode[] = entries.map((e) =>
          e.isDirectory
            ? { id: e.path, name: e.name, isDirectory: true, children: null }
            : { id: e.path, name: e.name, isDirectory: false },
        );
        setData((prev) => patchNode(prev, node.id, (n) => ({ ...n, children })));
      } catch (e) {
        console.error('Failed to load children for', node.id, e);
      }
    },
    [showHidden],
  );

  // Refresh trigger from tools that mutated the fs (write_file / edit_file /
  // delete / rename). Tied to a store counter so any tool dispatch ripples
  // into a tree re-list — user sees new files appear immediately.
  const fsChangeCounter = useAppStore((s) => s.fsChangeCounter);

  useEffect(() => {
    if (rootPath) void loadRoot(rootPath, showHidden);
    else setData([]);
  }, [rootPath, loadRoot, showHidden, fsChangeCounter]);

  const refresh = useCallback(async () => {
    if (rootPath) await loadRoot(rootPath, showHidden);
  }, [rootPath, loadRoot, showHidden]);

  const toggleShowHidden = useCallback(() => setShowHidden((v) => !v), []);

  return { data, loading, error, loadChildren, refresh, showHidden, toggleShowHidden };
}

function patchNode(
  nodes: TreeNode[],
  id: string,
  patcher: (n: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((n) => {
    if (n.id === id) return patcher(n);
    if (n.children?.length) {
      return { ...n, children: patchNode(n.children, id, patcher) };
    }
    return n;
  });
}
