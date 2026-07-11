import { createClient, type Client } from '@libsql/client';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import type { DbDriver, DbQueryResult } from './types';

const DB_DIR = path.join(homedir(), '.webcraft', 'databases', 'libsql');

/// LibSQL driver — SQLite-compatible distributed DB (Turso fork).
/// Local file mode by default; can connect to remote Turso with auth token.
export class LibsqlDriver implements DbDriver {
  kind = 'libsql' as const;
  private clients = new Map<string, Client>();

  async open(connectionId: string): Promise<void> {
    if (this.clients.has(connectionId)) return;
    mkdirSync(DB_DIR, { recursive: true });
    const url = `file:${path.join(DB_DIR, `${connectionId}.db`)}`;
    this.clients.set(connectionId, createClient({ url }));
  }

  async query(connectionId: string, sql: string): Promise<DbQueryResult> {
    await this.open(connectionId);
    const client = this.clients.get(connectionId);
    if (!client) return err('no client');
    const start = performance.now();
    try {
      const result = await client.execute(sql);
      return {
        columns: [...result.columns],
        rows: result.rows.map((r) => result.columns.map((c) => (r as Record<string, unknown>)[c])),
        rowsAffected: result.rowsAffected,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e), performance.now() - start);
    }
  }

  async listTables(connectionId: string): Promise<string[]> {
    const r = await this.query(
      connectionId,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    return r.rows.map((row) => String(row[0]));
  }

  async close(connectionId: string): Promise<void> {
    const c = this.clients.get(connectionId);
    if (c) {
      c.close();
      this.clients.delete(connectionId);
    }
  }
}

function err(message: string, durationMs = 0): DbQueryResult {
  return { columns: [], rows: [], rowsAffected: 0, durationMs: Math.round(durationMs), error: message };
}
