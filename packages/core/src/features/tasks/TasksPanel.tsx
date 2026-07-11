import { CheckCircle2, Circle, CircleDashed, Loader2, Trash2, XCircle } from 'lucide-react';
import { type Task, type TaskStatus, useTaskStore } from './task-store';

/// Tasks panel — VS Code-style task list, but also driven by the AI's
/// task_create / task_update tools. Status chips and priority badges.
export function TasksPanel() {
  const tasks = useTaskStore((s) => s.tasks);
  const update = useTaskStore((s) => s.update);
  const remove = useTaskStore((s) => s.remove);

  if (tasks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-fg-dim)]">
        <CircleDashed className="h-8 w-8" />
        <p className="text-xs">No tasks yet.</p>
        <p className="text-[10px] text-[var(--color-fg-subtle)]">
          The AI can create tasks with the <code>task_create</code> tool, or click ➕ to add one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-1.5 text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Tasks · {tasks.length}
        </span>
      </div>
      <ul className="flex-1 divide-y divide-[var(--color-border-subtle)] overflow-y-auto">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} onUpdate={update} onRemove={remove} />
        ))}
      </ul>
    </div>
  );
}

function TaskRow({
  task,
  onUpdate,
  onRemove,
}: {
  task: Task;
  onUpdate: (id: string, patch: { status: TaskStatus }) => void;
  onRemove: (id: string) => void;
}) {
  const Icon = STATUS_ICON[task.status];
  const next: TaskStatus =
    task.status === 'pending'
      ? 'in_progress'
      : task.status === 'in_progress'
        ? 'completed'
        : 'pending';

  return (
    <li className="group flex items-start gap-2 px-3 py-1.5 text-[11px] hover:bg-[var(--color-bg-hover)]">
      <button
        type="button"
        onClick={() => onUpdate(task.id, { status: next })}
        aria-label="Cycle status"
        className="mt-0.5 shrink-0"
      >
        <Icon className={`h-3.5 w-3.5 ${STATUS_COLOR[task.status]}`} />
      </button>
      <div className="min-w-0 flex-1 select-text">
        <div
          className={`truncate text-[var(--color-fg)] ${
            task.status === 'completed' ? 'line-through opacity-60' : ''
          }`}
        >
          {task.title}
        </div>
        {task.description ? (
          <div className="truncate text-[10px] text-[var(--color-fg-subtle)]">
            {task.description}
          </div>
        ) : null}
        {task.notes.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-[10px] text-[var(--color-fg-dim)]">
            {task.notes.slice(-3).map((n, i) => (
              <li key={i} className="truncate">
                · {n.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onRemove(task.id)}
        aria-label="Remove"
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Trash2 className="h-3 w-3 text-[var(--color-danger)]" />
      </button>
    </li>
  );
}

const STATUS_ICON: Record<TaskStatus, React.ComponentType<{ className?: string }>> = {
  pending: Circle,
  in_progress: Loader2,
  completed: CheckCircle2,
  blocked: XCircle,
  cancelled: XCircle,
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: 'text-[var(--color-fg-dim)]',
  in_progress: 'text-[var(--color-accent)] animate-spin',
  completed: 'text-[var(--color-success)]',
  blocked: 'text-[var(--color-warning)]',
  cancelled: 'text-[var(--color-fg-subtle)]',
};
