import { AlertTriangle } from 'lucide-react';
import { Component, type ReactNode } from 'react';

/// Catch-all error boundary so a crashing modal / panel doesn't disappear
/// silently — render the stack trace inline instead. The user can copy
/// it and we know what to fix.

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const e = this.state.error;
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
        <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]">
          <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-danger-muted)] px-3 py-2 text-xs text-[var(--color-danger)]">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-semibold uppercase tracking-wider">
              Component crashed{this.props.label ? `: ${this.props.label}` : ''}
            </span>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="ml-auto rounded border border-[var(--color-danger)]/40 px-2 py-0.5 hover:bg-[var(--color-danger)]/10"
            >
              Dismiss
            </button>
          </div>
          <pre className="select-text overflow-auto p-3 font-mono text-[11px] text-[var(--color-fg)]">
            {e.name}: {e.message}
            {'\n\n'}
            {e.stack ?? '(no stack)'}
          </pre>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(`${e.name}: ${e.message}\n\n${e.stack ?? ''}`);
            }}
            className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2 text-left text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-bg-hover)]"
          >
            Copy full error
          </button>
        </div>
      </div>
    );
  }
}
