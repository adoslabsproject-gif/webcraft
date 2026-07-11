import {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Key, Loader2, Plus, Sparkles, Table2, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { AnthropicProvider } from '../../../lib/ai/anthropic-client';
import { NhaProvider } from '../../../lib/ai/nha-client';
import { useSettingsStore } from '../../../store/settings-store';
import { MigrationPreviewModal } from './MigrationPreviewModal';

/// Visual schema designer — drag-and-drop tables with relationships,
/// AI-powered column suggestion (just type the table name, AI proposes
/// columns), and generates ready-to-run DDL with risk analysis via
/// MigrationPreviewModal.

interface TableData extends Record<string, unknown> {
  name: string;
  columns: Array<{ name: string; type: string; pk: boolean; nullable: boolean }>;
  onAddColumn: (id: string) => void;
  onRemoveColumn: (id: string, index: number) => void;
  onRename: (id: string, name: string) => void;
  onColumnEdit: (id: string, index: number, patch: Partial<TableData['columns'][number]>) => void;
  onAiSuggest: (id: string) => Promise<void>;
}

type TableNode = Node<TableData, 'table'>;

function TableNodeView({ id, data, selected }: NodeProps<TableNode>) {
  const [busy, setBusy] = useState(false);

  return (
    <div
      className={`min-w-[220px] rounded border bg-[var(--color-bg-elevated)] text-[var(--color-fg)] shadow-[var(--shadow-md)] ${
        selected ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
      }`}
    >
      <div className="flex items-center justify-between gap-1 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-2 py-1">
        <Table2 className="h-3 w-3 text-sky-400" />
        <input
          type="text"
          value={data.name}
          onChange={(e) => data.onRename(id, e.target.value)}
          className="flex-1 bg-transparent text-xs font-semibold focus:outline-none"
        />
        <button
          type="button"
          title="AI suggest columns"
          onClick={async () => {
            setBusy(true);
            await data.onAiSuggest(id);
            setBusy(false);
          }}
          className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        </button>
        <button
          type="button"
          title="Add column"
          onClick={() => data.onAddColumn(id)}
          className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      <ul className="text-[11px]">
        {data.columns.map((c, i) => (
          <li key={i} className="group flex items-center gap-1 border-b border-[var(--color-border-subtle)] px-2 py-0.5 last:border-b-0">
            {c.pk ? <Key className="h-2.5 w-2.5 text-amber-400" /> : <span className="w-2.5" />}
            <input
              type="text"
              value={c.name}
              onChange={(e) => data.onColumnEdit(id, i, { name: e.target.value })}
              className="flex-1 bg-transparent font-mono focus:outline-none"
            />
            <input
              type="text"
              value={c.type}
              onChange={(e) => data.onColumnEdit(id, i, { type: e.target.value })}
              className="w-20 bg-transparent text-right font-mono text-[var(--color-fg-subtle)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => data.onRemoveColumn(id, i)}
              className="opacity-0 group-hover:opacity-100"
            >
              <X className="h-2.5 w-2.5 text-[var(--color-danger)]" />
            </button>
          </li>
        ))}
      </ul>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-[var(--color-accent)]" />
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-[var(--color-accent)]" />
    </div>
  );
}

const nodeTypes = { table: TableNodeView };

function generateDdl(nodes: TableNode[], edges: Edge[]): string {
  const lines: string[] = [];
  for (const n of nodes) {
    const cols = n.data.columns
      .map((c) => `  ${c.name} ${c.type}${c.pk ? ' PRIMARY KEY' : ''}${c.nullable ? '' : ' NOT NULL'}`)
      .join(',\n');
    lines.push(`CREATE TABLE ${n.data.name} (\n${cols}\n);`);
  }
  for (const e of edges) {
    const source = nodes.find((n) => n.id === e.source);
    const target = nodes.find((n) => n.id === e.target);
    if (!source || !target) continue;
    const targetPk = target.data.columns.find((c) => c.pk)?.name ?? 'id';
    const fkCol = `${target.data.name.toLowerCase()}_id`;
    lines.push(
      `ALTER TABLE ${source.data.name} ADD COLUMN ${fkCol} INT REFERENCES ${target.data.name}(${targetPk});`,
    );
  }
  return lines.join('\n\n');
}

const AI_SYSTEM = `You design database schemas. Given a table name, return ONLY a JSON array of columns in this exact shape, no prose:
[{"name":"id","type":"SERIAL","pk":true,"nullable":false},{"name":"...","type":"TEXT","pk":false,"nullable":true}]
Include sensible columns for the domain implied by the table name. 5–10 columns. SQL types only (SERIAL/TEXT/INT/BOOLEAN/TIMESTAMPTZ/JSONB/UUID).`;

export function SchemaDesigner({ onClose }: { onClose: () => void }) {
  return (
    <ReactFlowProvider>
      <SchemaDesignerInner onClose={onClose} />
    </ReactFlowProvider>
  );
}

function SchemaDesignerInner({ onClose }: { onClose: () => void }) {
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const model = useSettingsStore((s) => s.model);

  const [nodes, setNodes, onNodesChange] = useNodesState<TableNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [previewSql, setPreviewSql] = useState<string | null>(null);

  const onConnect = useCallback(
    (params: Parameters<typeof addEdge>[0]) =>
      setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges],
  );

  const tableHandlers = {
    onAddColumn: (id: string) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  columns: [...n.data.columns, { name: `col_${n.data.columns.length}`, type: 'TEXT', pk: false, nullable: true }],
                },
              }
            : n,
        ),
      ),
    onRemoveColumn: (id: string, index: number) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, columns: n.data.columns.filter((_, i) => i !== index) } }
            : n,
        ),
      ),
    onRename: (id: string, name: string) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, name } } : n))),
    onColumnEdit: (id: string, index: number, patch: Partial<TableData['columns'][number]>) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  columns: n.data.columns.map((c, i) => (i === index ? { ...c, ...patch } : c)),
                },
              }
            : n,
        ),
      ),
    onAiSuggest: async (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      const provider =
        activeProvider === 'nha'
          ? new NhaProvider()
          : apiKeys.anthropic
            ? new AnthropicProvider(apiKeys.anthropic)
            : null;
      if (!provider) return;
      let buf = '';
      await provider.stream({
        model,
        system: AI_SYSTEM,
        messages: [
          { id: 'u', role: 'user', content: [{ type: 'text', text: node.data.name }], createdAt: Date.now() },
        ],
        callbacks: {
          onText: (d) => {
            buf += d;
          },
          onToolUse: () => {},
          onStop: () => {},
          onError: () => {},
        },
      });
      const match = /\[[\s\S]*\]/.exec(buf);
      if (!match) return;
      try {
        const cols = JSON.parse(match[0]) as TableData['columns'];
        setNodes((ns) =>
          ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, columns: cols } } : n)),
        );
      } catch {
        /* ignore */
      }
    },
  };

  function addTable() {
    const id = `t_${Date.now().toString(36)}`;
    const newNode: TableNode = {
      id,
      type: 'table',
      position: { x: 120 + nodes.length * 60, y: 120 + nodes.length * 40 },
      data: {
        name: `new_table_${nodes.length + 1}`,
        columns: [{ name: 'id', type: 'SERIAL', pk: true, nullable: false }],
        ...tableHandlers,
      },
    };
    setNodes((ns) => [...ns, newNode]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-fg)]">
            <Sparkles className="h-3 w-3 text-[var(--color-accent)]" />
            Schema Designer · AI-powered
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addTable}
              className="flex items-center gap-1 rounded bg-[var(--color-accent)] px-2 py-1 text-[11px] font-medium text-white hover:bg-[var(--color-accent-hover)]"
            >
              <Plus className="h-3 w-3" />
              Table
            </button>
            <button
              type="button"
              disabled={nodes.length === 0}
              onClick={() => setPreviewSql(generateDdl(nodes, edges))}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] disabled:opacity-40"
            >
              Preview DDL
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-[var(--color-bg)]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
            <Controls className="!bg-[var(--color-bg-subtle)] !border-[var(--color-border-subtle)]" />
            <MiniMap pannable zoomable className="!bg-[var(--color-bg-subtle)]" />
          </ReactFlow>
        </div>
      </div>
      {previewSql ? (
        <MigrationPreviewModal sql={previewSql} onClose={() => setPreviewSql(null)} />
      ) : null}
    </div>
  );
}
