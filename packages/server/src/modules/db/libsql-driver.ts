import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { type Client, createClient } from '@libsql/client';
import type { ConnectionDescriptor, DbDriver, DbQueryResult } from './types';

const DB_DIR = path.join(homedir(), '.webcraft', 'databases', 'libsql');

/// LibSQL driver — SQLite-compatible distributed DB (Turso fork).
/// Descriptor url (libsql://… remote Turso) or file take precedence over
/// the managed local file.
export class LibsqlDriver implements DbDriver {
  kind = 'libsql' as const;
  private clients = new Map<string, Client>();

  async open(connectionId: string, desc?: ConnectionDescriptor): Promise<void> {
    if (this.clients.has(connectionId)) return;
    let url = desc?.url ?? (desc?.file ? `file:${desc.file}` : null);
    if (!url) {
      mkdirSync(DB_DIR, { recursive: true });
      url = `file:${path.join(DB_DIR, `${connectionId}.db`)}`;
    }
    this.clients.set(connectionId, createClient({ url }));
  }

  async query(
    connectionId: string,
    sql: string,
    desc?: ConnectionDescriptor,
  ): Promise<DbQueryResult> {
    await this.open(connectionId, desc);
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

  async listTables(connectionId: string, desc?: ConnectionDescriptor): Promise<string[]> {
    const r = await this.query(
      connectionId,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      desc,
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
  return {
    columns: [],
    rows: [],
    rowsAffected: 0,
    durationMs: Math.round(durationMs),
    error: message,
  };
}
