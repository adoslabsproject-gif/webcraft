import type { DbDriver, DbQueryResult } from './types';

/// Driver registry — `DbManager.query("sqlite-default", sql)` picks the
/// right driver based on the connection kind prefix.
///
/// CURRENT STATE: drivers are NOT bundled into the sidecar — their native
/// deps (better-sqlite3, @duckdb/node-api, mongodb, ioredis, @libsql/client)
/// have compile-from-source paths that need a sidecar install step we
/// haven't shipped yet. Driver code lives in `*-driver.ts` next to this
/// file and gets pulled in dynamically once the install lands. For now
/// every call returns a clean "not yet wired" error so the API surface is
/// stable.

const SUPPORTED_KINDS = new Set(['sqlite', 'duckdb', 'libsql', 'redis', 'mongo']);

export class DbManager {
  private resolveKind(connectionId: string): string | null {
    const kind = connectionId.split('-')[0] ?? '';
    return SUPPORTED_KINDS.has(kind) ? kind : null;
  }

  async query(connectionId: string, _sql: string): Promise<DbQueryResult> {
    const kind = this.resolveKind(connectionId);
    return {
      columns: [],
      rows: [],
      rowsAffected: 0,
      durationMs: 0,
      error: kind
        ? `Driver "${kind}" not yet wired into the sidecar bundle. Use PGLite from the renderer for now.`
        : `Unknown connection kind: "${connectionId}"`,
    };
  }

  async listTables(_connectionId: string): Promise<string[]> {
    return [];
  }

  async close(_connectionId: string): Promise<void> {
    /* no-op until drivers wired */
  }
}

// Type-only re-export so the index.ts dynamic import still type-checks.
export type { DbDriver };
