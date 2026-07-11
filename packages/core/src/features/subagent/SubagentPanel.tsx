import { Bot, ChevronDown, ChevronRight, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSubagentStore, type SubagentTranscript } from '../../lib/ai/subagent-store';

/// Subagent panel — lists every subagent transcript spawned via the
/// `subagent` tool in this session. Click a row to expand its
/// message-by-message trace. Foundation for the Claude Code Task panel.
export function SubagentPanel() {
  const transcripts = useSubagentStore((s) => s.transcripts);
  const clear = useSubagentStore((s) => s.clear);

  if (transcripts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-600">
        <Bot className="h-8 w-8" />
        <p className="text-xs">No subagents have run yet.</p>
        <p className="text-[10px] text-neutral-700">
          The main AI can spawn a research subagent via the <code>subagent</code> tool.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs">
        <span className="font-semibold uppercase tracking-wider text-neutral-400">
          Subagents · {transcripts.length} ·{' '}
          <span className="text-amber-400">{transcripts.filter((t) => t.status === 'running').length}</span> running
        </span>
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1 text-neutral-500 hover:text-neutral-200"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto bg-neutral-950 p-2">
        {transcripts.map((t) => (
          <TranscriptCard key={t.id} t={t} />
        ))}
      </div>
    </div>
  );
}

function TranscriptCard({ t }: { t: SubagentTranscript }) {
  const [expanded, setExpanded] = useState(false);
  const elapsed = t.finishedAt
    ? `${((t.finishedAt - t.startedAt) / 1000).toFixed(1)}s`
    : `${((Date.now() - t.startedAt) / 1000).toFixed(0)}s`;
  const toolCalls = t.messages.reduce(
    (acc, m) => acc + m.content.filter((b) => b.type === 'tool_use').length,
    0,
  );
  const statusColor =
    t.status === 'running'
      ? 'border-amber-500/40'
      : t.status === 'completed'
        ? 'border-emerald-500/30'
        : 'border-rose-500/40';

  return (
    <div className={`mb-2 overflow-hidden rounded border ${statusColor} bg-neutral-925`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-2 py-1.5 text-left text-xs hover:bg-neutral-850"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {t.status === 'running' ? (
          <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
        ) : (
          <Bot
            className={`h-3 w-3 ${t.status === 'completed' ? 'text-emerald-400' : 'text-rose-400'}`}
          />
        )}
        <span className="truncate font-medium text-neutral-200">{t.title}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-neutral-500">
          <span>{toolCalls} tools</span>
          <span>{elapsed}</span>
          <span className="rounded bg-neutral-800 px-1.5 py-px uppercase tracking-wider">
            {t.status}
          </span>
        </span>
      </button>
      {expanded ? (
        <div className="p-2 text-[11px]">
          <div className="mb-1.5 rounded border border-neutral-800 bg-neutral-950 p-1.5">
            <div className="font-semibold uppercase tracking-wider text-neutral-500">Task</div>
            <div className="whitespace-pre-wrap text-neutral-300">{t.task}</div>
          </div>
          {t.messages.map((m, i) => (
            <MessageBlock key={i} message={m} />
          ))}
          {t.finalText ? (
            <div className="mt-1.5 rounded border border-emerald-500/30 bg-emerald-500/5 p-1.5">
              <div className="font-semibold uppercase tracking-wider text-emerald-300">Final</div>
              <div className="whitespace-pre-wrap text-emerald-100">{t.finalText}</div>
            </div>
          ) : null}
          {t.error ? (
            <div className="mt-1.5 rounded border border-rose-500/30 bg-rose-500/5 p-1.5 text-rose-200">
              <div className="font-semibold uppercase tracking-wider text-rose-300">Error</div>
              <div className="font-mono">{t.error}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MessageBlock({ message }: { message: SubagentTranscript['messages'][number] }) {
  return (
    <div
      className={`mb-1 rounded border border-neutral-800 p-1.5 ${
        message.role === 'user' ? 'bg-neutral-900' : 'bg-neutral-950'
      }`}
    >
      <div className="font-semibold uppercase tracking-wider text-neutral-500">{message.role}</div>
      {message.content.map((b, i) => {
        if (b.type === 'text') {
          return (
            <div key={i} className="whitespace-pre-wrap text-neutral-300">
              {b.text}
            </div>
          );
        }
        if (b.type === 'tool_use') {
          return (
            <div
              key={i}
              className="mt-0.5 rounded bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300"
            >
              → {b.name}({Object.keys(b.input).join(', ')})
            </div>
          );
        }
        if (b.type === 'tool_result') {
          return (
            <pre
              key={i}
              className={`mt-0.5 max-h-32 overflow-y-auto rounded p-1 font-mono text-[10px] ${
                b.is_error ? 'bg-rose-500/5 text-rose-200' : 'bg-emerald-500/5 text-emerald-200'
              }`}
            >
              {b.content.slice(0, 600)}
              {b.content.length > 600 ? ` … +${b.content.length - 600}` : ''}
            </pre>
          );
        }
        return null;
      })}
    </div>
  );
}
