import { ChevronRight, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { ToolUseBlock } from '../../lib/ai/types';

/// Inline render of a tool_use block — collapsible, shows tool name + input.
export function ToolCallView({ call }: { call: ToolUseBlock }) {
  const [open, setOpen] = useState(false);
  const preview = previewArgs(call.input);

  return (
    <div className="my-1 rounded border border-neutral-800 bg-neutral-925">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-neutral-900"
      >
        <ChevronRight
          className={`h-3 w-3 text-neutral-500 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Wrench className="h-3 w-3 text-indigo-400" />
        <span className="font-mono text-indigo-300">{call.name}</span>
        {!open && preview ? (
          <span className="truncate text-neutral-500">{preview}</span>
        ) : null}
      </button>
      {open ? (
        <pre className="overflow-x-auto border-t border-neutral-800 bg-neutral-950 p-2 font-mono text-[10px] text-neutral-300">
          {JSON.stringify(call.input, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function previewArgs(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  const first = entries[0];
  if (!first) return '';
  const [k, v] = first;
  const str = typeof v === 'string' ? v : JSON.stringify(v);
  return `${k}=${str.slice(0, 60)}${str.length > 60 ? '…' : ''}`;
}
