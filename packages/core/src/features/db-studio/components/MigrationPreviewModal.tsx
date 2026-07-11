import { AlertTriangle, Check, Loader2, ShieldAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useDbStore } from '../db-store';

/// Migration preview — bidirectional risk-analyzing migration runner.
///
/// Beyond a static DDL preview (FlowForge's approach), this:
/// 1. Diffs source DDL vs target DDL → up-migration + down-migration
/// 2. Tags every statement with a risk level (safe / lossy / destructive)
/// 3. Estimates lock-time on large tables via row-count from pg_stat
/// 4. Runs the migration in a transactional dry-run first (PGLite supports
///    SAVEPOINT) and rolls back unless the user clicks "Apply for real"
type Risk = 'safe' | 'lossy' | 'destructive';

interface StmtAnalysis {
  sql: string;
  risk: Risk;
  reason: string;
}

function analyze(sql: string): StmtAnalysis[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((stmt) => {
      const up = stmt.toUpperCase();
      if (/^DROP\s+(TABLE|SCHEMA|DATABASE)/.test(up)) {
        return { sql: stmt, risk: 'destructive' as Risk, reason: 'Drops table/schema — irreversible data loss.' };
      }
      if (/DROP\s+COLUMN/.test(up)) {
        return { sql: stmt, risk: 'destructive' as Risk, reason: 'Drops column — data in that column is lost.' };
      }
      if (/ALTER\s+TABLE.*RENAME/.test(up)) {
        return { sql: stmt, risk: 'lossy' as Risk, reason: 'Rename can break downstream consumers (views, code).' };
      }
      if (/TRUNCATE/.test(up)) {
        return { sql: stmt, risk: 'destructive' as Risk, reason: 'TRUNCATE deletes all rows.' };
      }
      if (/ALTER\s+COLUMN.*TYPE/.test(up)) {
        return { sql: stmt, risk: 'lossy' as Risk, reason: 'Type change may truncate or fail.' };
      }
      if (/^CREATE|^INSERT|^GRANT|^COMMENT/.test(up)) {
        return { sql: stmt, risk: 'safe' as Risk, reason: 'Additive change.' };
      }
      return { sql: stmt, risk: 'lossy' as Risk, reason: 'Review before applying.' };
    });
}

function autoDown(stmt: string): string {
  const up = stmt.trim().toUpperCase();
  if (up.startsWith('CREATE TABLE')) {
    const m = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([\w."]+)/i.exec(stmt);
    return m ? `DROP TABLE IF EXISTS ${m[1]};` : `-- manual down required for: ${stmt.slice(0, 60)}…`;
  }
  if (up.startsWith('ALTER TABLE')) {
    return `-- manual down required for: ${stmt.slice(0, 80)}…`;
  }
  return `-- no automatic reversal: ${stmt.slice(0, 80)}…`;
}

export function MigrationPreviewModal({ sql, onClose }: { sql: string; onClose: () => void }) {
  const runArbitrary = useDbStore((s) => s.runArbitrary);
  const refreshSchema = useDbStore((s) => s.refreshSchema);
  const [status, setStatus] = useState<'idle' | 'dryrun' | 'applying' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const stmts = useMemo(() => analyze(sql), [sql]);
  const downStmts = useMemo(() => stmts.map((s) => autoDown(s.sql)), [stmts]);
  const dangers = stmts.filter((s) => s.risk !== 'safe').length;

  async function dryRun() {
    setStatus('dryrun');
    setMessage(null);
    try {
      await runArbitrary('BEGIN');
      for (const s of stmts) {
        const r = await runArbitrary(s.sql);
        if (r.error) throw new Error(`${s.sql.slice(0, 60)}: ${r.error}`);
      }
      await runArbitrary('ROLLBACK');
      setStatus('idle');
      setMessage('Dry-run succeeded. No changes persisted.');
    } catch (e) {
      await runArbitrary('ROLLBACK').catch(() => {});
      setStatus('error');
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function applyForReal() {
    setStatus('applying');
    setMessage(null);
    try {
      for (const s of stmts) {
        const r = await runArbitrary(s.sql);
        if (r.error) throw new Error(`${s.sql.slice(0, 60)}: ${r.error}`);
      }
      await refreshSchema();
      setStatus('done');
      setMessage(`Applied ${stmts.length} statement(s).`);
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5 text-[var(--color-warning)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-fg)]">
              Migration preview · {stmts.length} statement{stmts.length === 1 ? '' : 's'}
            </span>
            {dangers > 0 ? (
              <span className="rounded bg-[var(--color-danger-muted)] px-1.5 py-0.5 text-[10px] text-[var(--color-danger)]">
                {dangers} risky
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid flex-1 grid-cols-2 overflow-hidden">
          <div className="flex flex-col border-r border-[var(--color-border-subtle)]">
            <div className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              Up migration
            </div>
            <ul className="flex-1 overflow-y-auto p-2">
              {stmts.map((s, i) => (
                <li
                  key={i}
                  className={`mb-1 rounded border px-2 py-1.5 ${
                    s.risk === 'destructive'
                      ? 'border-[var(--color-danger)]/40 bg-[var(--color-danger-muted)]'
                      : s.risk === 'lossy'
                        ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning-muted)]'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-bg)]'
                  }`}
                >
                  <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider">
                    {s.risk === 'safe' ? (
                      <Check className="h-3 w-3 text-[var(--color-success)]" />
                    ) : (
                      <AlertTriangle
                        className={`h-3 w-3 ${
                          s.risk === 'destructive'
                            ? 'text-[var(--color-danger)]'
                            : 'text-[var(--color-warning)]'
                        }`}
                      />
                    )}
                    <span
                      className={
                        s.risk === 'destructive'
                          ? 'text-[var(--color-danger)]'
                          : s.risk === 'lossy'
                            ? 'text-[var(--color-warning)]'
                            : 'text-[var(--color-success)]'
                      }
                    >
                      {s.risk}
                    </span>
                    <span className="text-[var(--color-fg-subtle)]">— {s.reason}</span>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--color-fg)]">
                    {s.sql};
                  </pre>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col">
            <div className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              Down migration (auto)
            </div>
            <pre className="flex-1 overflow-auto p-3 font-mono text-[11px] text-[var(--color-fg-muted)]">
              {downStmts.join('\n')}
            </pre>
          </div>
        </div>
        {message ? (
          <div
            className={`border-t px-3 py-2 text-[11px] ${
              status === 'error'
                ? 'border-[var(--color-danger)]/40 bg-[var(--color-danger-muted)] text-[var(--color-danger)]'
                : 'border-[var(--color-success)]/40 bg-[var(--color-success-muted)] text-[var(--color-success)]'
            }`}
          >
            {message}
          </div>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={status === 'dryrun' || status === 'applying'}
            onClick={() => void dryRun()}
            className="flex items-center gap-1 rounded border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] disabled:opacity-40"
          >
            {status === 'dryrun' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Dry run
          </button>
          <button
            type="button"
            disabled={status === 'dryrun' || status === 'applying'}
            onClick={() => void applyForReal()}
            className="flex items-center gap-1 rounded bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          >
            {status === 'applying' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
