import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import type { DbDriver, DbQueryResult } from './types';

/// SQLite driver — one persistent file per connection under
/// ~/.webcraft/databases/sqlite/<connectionId>.db

const DB_DIR = path.join(homedir(), '.webcraft', 'databases', 'sqlite');

export class SqliteDriver implements DbDriver {
  kind = 'sqlite' as const;
  private handles = new Map<string, Database.Database>();

  async open(connectionId: string): Promise<void> {
    if (this.handles.has(connectionId)) return;
    mkdirSync(DB_DIR, { recursive: true });
    const dbPath = path.join(DB_DIR, `${connectionId}.db`);
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    this.handles.set(connectionId, db);
  }

  async query(connectionId: string, sql: string): Promise<DbQueryResult> {
    await this.open(connectionId);
    const db = this.handles.get(connectionId);
    if (!db) {
      return { columns: [], rows: [], rowsAffected: 0, durationMs: 0, error: 'no connection' };
    }
    const start = performance.now();
    try {
      const trimmed = sql.trim().toLowerCase();
      if (trimmed.startsWith('select') || trimmed.startsWith('with') || trimmed.startsWith('pragma')) {
        const stmt = db.prepare(sql);
        const rows = stmt.all() as Record<string, unknown>[];
        const columns = rows[0] ? Object.keys(rows[0]) : [];
        return {
          columns,
          rows: rows.map((r) => columns.map((c) => r[c])),
          rowsAffected: rows.length,
          durationMs: Math.round(performance.now() - start),
        };
      }
      const info = db.exec(sql);
      return {
        columns: [],
        rows: [],
        rowsAffected: (info as unknown as { changes?: number }).changes ?? 0,
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

  async listTables(connectionId: string): Promise<string[]> {
    const r = await this.query(connectionId, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    return r.rows.map((row) => String(row[0]));
  }

  async close(connectionId: string): Promise<void> {
    const db = this.handles.get(connectionId);
    if (db) {
      db.close();
      this.handles.delete(connectionId);
    }
  }
}
