import { PGlite } from '@electric-sql/pglite';
import { create } from 'zustand';

/// DB Studio store — connections, active DB introspection, query state,
/// command history. Each "connection" can run against PGLite (in-process
/// Postgres WASM) or — once the Node sidecar is online — against
/// SQLite/Mongo/MySQL/Redis/DuckDB/SurrealDB/LibSQL/MariaDB engines.

export type DbKind =
  | 'pglite'
  | 'sqlite'
  | 'mysql'
  | 'postgres'
  | 'mongo'
  | 'redis'
  | 'duckdb'
  | 'surrealdb'
  | 'libsql'
  | 'mariadb';

export interface DbConnection {
  id: string;
  name: string;
  kind: DbKind;
  available: boolean;
}

export interface TableInfo {
  name: string;
  schema: string;
  rowCount: number | null;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string | null;
}

export interface ForeignKey {
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number;
  durationMs: number;
  error?: string;
}

export interface QueryHistoryEntry {
  id: string;
  connectionId: string;
  sql: string;
  ts: number;
  durationMs: number;
  rowCount: number;
  error?: string;
}

const DEFAULT_CONN_ID = 'pglite-default';

const STATIC_CONNS: DbConnection[] = [
  { id: DEFAULT_CONN_ID, name: 'Local PostgreSQL (PGLite)', kind: 'pglite', available: true },
  { id: 'sqlite-default', name: 'Local SQLite (better-sqlite3)', kind: 'sqlite', available: false },
  { id: 'duckdb-default', name: 'Local DuckDB (analytics)', kind: 'duckdb', available: false },
  { id: 'mongo-default', name: 'Local MongoDB (memory)', kind: 'mongo', available: false },
  { id: 'mysql-default', name: 'Local MySQL (portable)', kind: 'mysql', available: false },
  { id: 'mariadb-default', name: 'Local MariaDB (portable)', kind: 'mariadb', available: false },
  { id: 'redis-default', name: 'Local Redis (portable)', kind: 'redis', available: false },
  { id: 'surrealdb-default', name: 'Local SurrealDB (multi-model)', kind: 'surrealdb', available: false },
  { id: 'libsql-default', name: 'Local LibSQL (Turso fork)', kind: 'libsql', available: false },
];

interface DbState {
  connections: DbConnection[];
  activeConnectionId: string;
  tables: TableInfo[];
  activeTable: string | null;
  activeTableColumns: ColumnInfo[];
  activeTableForeignKeys: ForeignKey[];
  query: string;
  result: QueryResult | null;
  running: boolean;
  history: QueryHistoryEntry[];
  setActiveConnection: (id: string) => void;
  addConnection: (conn: Omit<DbConnection, 'id'>) => string;
  setActiveTable: (name: string | null) => void;
  setQuery: (q: string) => void;
  refreshSchema: () => Promise<void>;
  runQuery: () => Promise<void>;
  runArbitrary: (sql: string) => Promise<QueryResult>;
}

const pgInstances = new Map<string, Promise<PGlite>>();
async function getPgliteInstance(id: string): Promise<PGlite> {
  let p = pgInstances.get(id);
  if (!p) {
    p = (async () => {
      const db = new PGlite();
      await db.waitReady;
      return db;
    })();
    pgInstances.set(id, p);
  }
  return p;
}

async function execOn(conn: DbConnection, sql: string): Promise<QueryResult> {
  if (conn.kind !== 'pglite') {
    return {
      columns: [],
      rows: [],
      rowsAffected: 0,
      durationMs: 0,
      error:
        `⚠ Engine "${conn.kind}" requires the Node sidecar which isn't yet wired in this build. ` +
        `Driver code lives in packages/server/src/modules/db/${conn.kind}-driver.ts — ` +
        `the Tauri main process must spawn the sidecar at boot for queries to reach it. ` +
        `Meanwhile use PGLite (Postgres in-process WASM) which has ~95% feature parity.`,
    };
  }
  const start = performance.now();
  try {
    const db = await getPgliteInstance(conn.id);
    const result = await db.query(sql);
    const columns = result.fields.map((f) => f.name);
    const rows = result.rows.map((r) => columns.map((c) => (r as Record<string, unknown>)[c]));
    return {
      columns,
      rows,
      rowsAffected: result.affectedRows ?? rows.length,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (e) {
    return {
      columns: [],
      rows: [],
      rowsAffected: 0,
      durationMs: Math.round(performance.now() - start),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const PG_TABLE_LIST_SQL = `
SELECT table_schema AS schema, table_name AS name,
       (SELECT n_live_tup FROM pg_stat_user_tables s WHERE s.relname = table_name) AS rows
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog','information_schema')
ORDER BY table_schema, table_name`;

const PG_COL_SQL = (schema: string, table: string) => `
SELECT c.column_name AS name,
       c.data_type AS data_type,
       c.is_nullable = 'YES' AS is_nullable,
       c.column_default AS default_value,
       EXISTS (
         SELECT 1 FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu USING (constraint_name)
         WHERE tc.constraint_type='PRIMARY KEY'
           AND tc.table_name=c.table_name
           AND kcu.column_name=c.column_name
       ) AS is_pk
FROM information_schema.columns c
WHERE c.table_schema='${schema}' AND c.table_name='${table}'
ORDER BY c.ordinal_position`;

const PG_FK_SQL = (schema: string, table: string) => `
SELECT kcu.column_name AS column,
       ccu.table_name AS ref_table,
       ccu.column_name AS ref_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = '${schema}'
  AND tc.table_name = '${table}'`;

export const useDbStore = create<DbState>((set, get) => ({
  connections: STATIC_CONNS,
  activeConnectionId: DEFAULT_CONN_ID,
  tables: [],
  activeTable: null,
  activeTableColumns: [],
  activeTableForeignKeys: [],
  query: 'SELECT version();',
  result: null,
  running: false,
  history: [],

  setActiveConnection: (id) => {
    set({ activeConnectionId: id, tables: [], activeTable: null });
    void get().refreshSchema();
  },

  addConnection: (conn) => {
    const id = `${conn.kind}-${Date.now().toString(36)}`;
    set((s) => ({ connections: [...s.connections, { ...conn, id }] }));
    return id;
  },

  setActiveTable: async (name) => {
    set({ activeTable: name, activeTableColumns: [], activeTableForeignKeys: [] });
    if (!name) return;
    const conn = get().connections.find((c) => c.id === get().activeConnectionId);
    if (!conn) return;
    const parts = name.includes('.') ? name.split('.') : ['public', name];
    const schema = parts[0] ?? 'public';
    const table = parts[1] ?? name;
    const cols = await execOn(conn, PG_COL_SQL(schema, table));
    const fks = await execOn(conn, PG_FK_SQL(schema, table));
    set({
      activeTableColumns: cols.rows.map((r) => ({
        name: String(r[0]),
        dataType: String(r[1]),
        isNullable: Boolean(r[2]),
        defaultValue: r[3] === null ? null : String(r[3]),
        isPrimaryKey: Boolean(r[4]),
      })),
      activeTableForeignKeys: fks.rows.map((r) => ({
        table,
        column: String(r[0]),
        refTable: String(r[1]),
        refColumn: String(r[2]),
      })),
    });
  },

  setQuery: (q) => set({ query: q }),

  async refreshSchema() {
    const conn = get().connections.find((c) => c.id === get().activeConnectionId);
    if (!conn || conn.kind !== 'pglite') {
      set({ tables: [] });
      return;
    }
    const r = await execOn(conn, PG_TABLE_LIST_SQL);
    if (r.error) {
      set({ tables: [] });
      return;
    }
    set({
      tables: r.rows.map((row) => ({
        schema: String(row[0]),
        name: String(row[1]),
        rowCount: row[2] === null ? null : Number(row[2]),
      })),
    });
  },

  async runQuery() {
    const { activeConnectionId, query, history } = get();
    const conn = get().connections.find((c) => c.id === activeConnectionId);
    if (!conn) return;
    set({ running: true });
    const result = await execOn(conn, query);
    set({
      result,
      running: false,
      history: [
        {
          id: `q_${Date.now().toString(36)}`,
          connectionId: activeConnectionId,
          sql: query,
          ts: Date.now(),
          durationMs: result.durationMs,
          rowCount: result.rows.length,
          ...(result.error ? { error: result.error } : {}),
        },
        ...history,
      ].slice(0, 100),
    });
    if (/^\s*(create|alter|drop|insert|update|delete)/i.test(query)) {
      void get().refreshSchema();
    }
  },

  async runArbitrary(sql) {
    const conn = get().connections.find((c) => c.id === get().activeConnectionId);
    if (!conn) {
      return {
        columns: [],
        rows: [],
        rowsAffected: 0,
        durationMs: 0,
        error: 'No active connection',
      };
    }
    return execOn(conn, sql);
  },
}));
