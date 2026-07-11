import {
  AlertTriangle,
  Cog,
  Database,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  Sparkles,
  ShoppingCart,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { type DbKind, useDbStore } from '../db-store';

/// Multi-step DB creation wizard — engine pick → name → starter template
/// (blank / blog / ecommerce / users / AI-described).

type Step = 'engine' | 'name' | 'template' | 'review';

interface Template {
  id: 'blank' | 'blog' | 'ecommerce' | 'users' | 'ai';
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  ddl?: string;
}

const TEMPLATES: Template[] = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'Start empty, you’ll create tables yourself.',
    icon: FileText,
  },
  {
    id: 'blog',
    label: 'Blog',
    description: 'users · posts · comments · tags',
    icon: Globe,
    ddl: `CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE posts (id SERIAL PRIMARY KEY, author_id INT REFERENCES users(id), title TEXT NOT NULL, body TEXT, published_at TIMESTAMPTZ, slug TEXT UNIQUE);
CREATE TABLE comments (id SERIAL PRIMARY KEY, post_id INT REFERENCES posts(id), author_id INT REFERENCES users(id), body TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE tags (id SERIAL PRIMARY KEY, name TEXT UNIQUE);
CREATE TABLE post_tags (post_id INT REFERENCES posts(id), tag_id INT REFERENCES tags(id), PRIMARY KEY (post_id, tag_id));
CREATE INDEX idx_posts_author ON posts(author_id);
CREATE INDEX idx_posts_published ON posts(published_at DESC);
CREATE INDEX idx_comments_post ON comments(post_id);`,
  },
  {
    id: 'ecommerce',
    label: 'E-commerce',
    description: 'products · orders · customers · order_items · inventory',
    icon: ShoppingCart,
    ddl: `CREATE TABLE customers (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, address TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE products (id SERIAL PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL, price_cents INT NOT NULL, description TEXT);
CREATE TABLE inventory (product_id INT PRIMARY KEY REFERENCES products(id), quantity INT NOT NULL DEFAULT 0, last_restock TIMESTAMPTZ);
CREATE TABLE orders (id SERIAL PRIMARY KEY, customer_id INT REFERENCES customers(id), status TEXT DEFAULT 'pending', total_cents INT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE order_items (order_id INT REFERENCES orders(id), product_id INT REFERENCES products(id), quantity INT NOT NULL, unit_price_cents INT NOT NULL, PRIMARY KEY (order_id, product_id));
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_products_sku ON products(sku);`,
  },
  {
    id: 'users',
    label: 'Users & Auth',
    description: 'users · sessions · roles · permissions',
    icon: Users,
    ddl: `CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT, created_at TIMESTAMPTZ DEFAULT now(), last_login TIMESTAMPTZ);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INT REFERENCES users(id), expires_at TIMESTAMPTZ NOT NULL, ip_address TEXT, user_agent TEXT);
CREATE TABLE roles (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT);
CREATE TABLE permissions (id SERIAL PRIMARY KEY, resource TEXT NOT NULL, action TEXT NOT NULL, UNIQUE(resource, action));
CREATE TABLE user_roles (user_id INT REFERENCES users(id), role_id INT REFERENCES roles(id), PRIMARY KEY (user_id, role_id));
CREATE TABLE role_permissions (role_id INT REFERENCES roles(id), permission_id INT REFERENCES permissions(id), PRIMARY KEY (role_id, permission_id));
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);`,
  },
  {
    id: 'ai',
    label: 'AI: describe in natural language',
    description: 'Tell the AI what your app needs — it generates the schema.',
    icon: Sparkles,
  },
];

const ENGINES: { id: DbKind; label: string; description: string; available: boolean }[] = [
  { id: 'pglite', label: 'PostgreSQL (PGLite)', description: 'In-process Postgres WASM. Recommended.', available: true },
  { id: 'sqlite', label: 'SQLite', description: 'File-based, zero setup. Sidecar pending.', available: false },
  { id: 'duckdb', label: 'DuckDB', description: 'Analytics OLAP. Sidecar pending.', available: false },
  { id: 'mysql', label: 'MySQL', description: 'Portable binary. Sidecar pending.', available: false },
  { id: 'mariadb', label: 'MariaDB', description: 'MySQL fork. Sidecar pending.', available: false },
  { id: 'mongo', label: 'MongoDB', description: 'Document. Sidecar pending.', available: false },
  { id: 'redis', label: 'Redis', description: 'Key-value. Sidecar pending.', available: false },
  { id: 'libsql', label: 'LibSQL (Turso)', description: 'Distributed SQLite. Sidecar pending.', available: false },
  { id: 'surrealdb', label: 'SurrealDB', description: 'Multi-model. Sidecar pending.', available: false },
];

export function DbCreationWizard({ onClose }: { onClose: () => void }) {
  const addConnection = useDbStore((s) => s.addConnection);
  const setActive = useDbStore((s) => s.setActiveConnection);
  const runArbitrary = useDbStore((s) => s.runArbitrary);
  const refreshSchema = useDbStore((s) => s.refreshSchema);

  const [step, setStep] = useState<Step>('engine');
  const [engine, setEngine] = useState<DbKind>('pglite');
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<Template>(() => TEMPLATES[0] as Template);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const id = addConnection({
        name: name.trim() || `${engine}-${Date.now().toString(36)}`,
        kind: engine,
        available: engine === 'pglite',
      });
      setActive(id);
      // Only apply seed DDL when the engine actually runs (pglite). For
      // sidecar-pending engines the connection is created so it shows in
      // the sidebar — DDL will replay once the sidecar is wired.
      if (template.ddl && engine === 'pglite') {
        const statements = template.ddl.split(/;\s*\n/).filter((s) => s.trim());
        for (const stmt of statements) {
          const r = await runArbitrary(stmt);
          if (r.error) throw new Error(`${stmt.slice(0, 60)}…: ${r.error}`);
        }
      }
      await refreshSchema();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const steps: Step[] = ['engine', 'name', 'template', 'review'];
  const stepIdx = steps.indexOf(step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-fg)]">
            <Database className="h-3.5 w-3.5 text-emerald-400" />
            Create database — step {stepIdx + 1} of 4
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <ol className="flex border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] text-[10px] uppercase tracking-wider">
          {steps.map((s, i) => (
            <li
              key={s}
              className={`flex flex-1 items-center justify-center gap-1 px-2 py-1.5 ${
                i === stepIdx
                  ? 'border-b-2 border-emerald-400 text-[var(--color-fg)]'
                  : i < stepIdx
                    ? 'text-[var(--color-fg-muted)]'
                    : 'text-[var(--color-fg-dim)]'
              }`}
            >
              {i < stepIdx ? <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" /> : <span className="font-mono">{i + 1}</span>}
              {s === 'engine' ? 'Engine' : s === 'name' ? 'Name' : s === 'template' ? 'Template' : 'Review'}
            </li>
          ))}
        </ol>

        <div className="flex-1 overflow-y-auto p-4">
          {step === 'engine' ? (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-[var(--color-fg)]">Choose engine</h3>
              <p className="mb-3 text-[11px] text-[var(--color-fg-subtle)]">
                PGLite is fully in-process today. Other engines are selectable for planning but
                queries will return a "sidecar pending" message until the Node sidecar is wired.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {ENGINES.map((e) => {
                  const selected = engine === e.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setEngine(e.id)}
                      className={`flex flex-col items-start gap-1 rounded-md border p-2.5 text-left text-xs transition-all ${
                        selected
                          ? e.available
                            ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/40'
                            : 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40'
                          : 'border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)]'
                      }`}
                    >
                      <div className="flex w-full items-center gap-1.5">
                        <Database className={`h-3 w-3 ${e.available ? 'text-emerald-400' : 'text-amber-400/70'}`} />
                        <span className="font-medium text-[var(--color-fg)]">{e.label}</span>
                        {e.available ? (
                          <span className="ml-auto rounded bg-emerald-500/20 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-emerald-300">
                            live
                          </span>
                        ) : (
                          <span className="ml-auto rounded bg-amber-500/15 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-amber-300">
                            pending
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-[var(--color-fg-subtle)]">{e.description}</span>
                    </button>
                  );
                })}
              </div>
              {!ENGINES.find((e) => e.id === engine)?.available ? (
                <div className="mt-3 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>Heads up:</strong> the connection will be saved and visible in the
                    sidebar, but <em>queries against {engine} won't actually run</em> until the
                    Node sidecar is bundled. Driver code is already in{' '}
                    <code className="rounded bg-black/30 px-1 font-mono text-[10px]">
                      packages/server/src/modules/db/{engine}-driver.ts
                    </code>
                    .
                  </span>
                </div>
              ) : null}
            </div>
          ) : step === 'name' ? (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-[var(--color-fg)]">Name the database</h3>
              <p className="mb-3 text-[11px] text-[var(--color-fg-subtle)]">
                Used as the connection label in the sidebar.
              </p>
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my_app"
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-fg)] focus:border-emerald-500 focus:outline-none"
              />
            </div>
          ) : step === 'template' ? (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-[var(--color-fg)]">Pick a starter template</h3>
              <p className="mb-3 text-[11px] text-[var(--color-fg-subtle)]">
                Skeleton schemas with tables + foreign keys + indexes. Customize freely after.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTemplate(t)}
                      className={`flex items-start gap-2 rounded-md border p-2 text-left text-xs transition-colors ${
                        template.id === t.id
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-border-strong)]'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-emerald-400" />
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--color-fg)]">{t.label}</div>
                        <div className="text-[10px] text-[var(--color-fg-subtle)]">{t.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {template.id === 'ai' ? (
                <div className="mt-3">
                  <label className="block text-[11px] text-[var(--color-fg-muted)]">
                    Describe your app domain:
                  </label>
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    rows={3}
                    placeholder="A SaaS for tracking gym workouts: users, workouts, exercises with sets/reps, calendar entries…"
                    className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-fg)] focus:border-emerald-500 focus:outline-none"
                  />
                  <p className="mt-1 text-[10px] text-[var(--color-fg-dim)]">
                    After creation, open the "AI Schema" modal in DB Studio to let Liara/Anthropic write the DDL.
                  </p>
                </div>
              ) : template.ddl ? (
                <pre className="mt-3 max-h-40 overflow-auto rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2 font-mono text-[10px] text-[var(--color-fg-muted)]">
                  {template.ddl}
                </pre>
              ) : null}
            </div>
          ) : (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">Review &amp; create</h3>
              <dl className="space-y-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <Cog className="h-3 w-3 text-[var(--color-fg-subtle)]" />
                  <dt className="w-24 text-[var(--color-fg-subtle)]">Engine</dt>
                  <dd className="font-mono text-[var(--color-fg)]">{engine}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <Box className="h-3 w-3 text-[var(--color-fg-subtle)]" />
                  <dt className="w-24 text-[var(--color-fg-subtle)]">Name</dt>
                  <dd className="font-mono text-[var(--color-fg)]">{name || `(${engine}-auto)`}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <FileText className="h-3 w-3 text-[var(--color-fg-subtle)]" />
                  <dt className="w-24 text-[var(--color-fg-subtle)]">Template</dt>
                  <dd className="text-[var(--color-fg)]">{template.label}</dd>
                </div>
              </dl>
              {error ? (
                <div className="mt-3 rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger-muted)] p-2 text-[11px] text-[var(--color-danger)]">
                  {error}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2">
          <button
            type="button"
            disabled={stepIdx === 0}
            onClick={() => setStep(steps[stepIdx - 1] ?? 'engine')}
            className="flex items-center gap-1 rounded px-3 py-1 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] disabled:opacity-30"
          >
            <ChevronLeft className="h-3 w-3" /> Back
          </button>
          {step === 'review' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void finish()}
              className="flex items-center gap-1 rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              <CheckCircle2 className="h-3 w-3" />
              {busy ? 'Creating…' : 'Create database'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep(steps[stepIdx + 1] ?? 'review')}
              className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
            >
              Next <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
