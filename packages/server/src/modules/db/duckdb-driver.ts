import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import type { ConnectionDescriptor, DbDriver, DbQueryResult } from './types';

const DB_DIR = path.join(homedir(), '.webcraft', 'databases', 'duckdb');

/// DuckDB driver — embedded analytics DB. Opens the user's existing
/// .duckdb file via descriptor, or a managed per-connection file.
export class DuckdbDriver implements DbDriver {
  kind = 'duckdb' as const;
  private instances = new Map<string, Awaited<ReturnType<typeof DuckDBInstance.create>>>();

  async open(connectionId: string, desc?: ConnectionDescriptor): Promise<void> {
    if (this.instances.has(connectionId)) return;
    let dbPath = desc?.file;
    if (!dbPath) {
      mkdirSync(DB_DIR, { recursive: true });
      dbPath = path.join(DB_DIR, `${connectionId}.duckdb`);
    }
    const inst = await DuckDBInstance.create(dbPath);
    this.instances.set(connectionId, inst);
  }

  async query(
    connectionId: string,
    sql: string,
    desc?: ConnectionDescriptor,
  ): Promise<DbQueryResult> {
    await this.open(connectionId, desc);
    const inst = this.instances.get(connectionId);
    if (!inst) return errorResult('no instance');
    const start = performance.now();
    try {
      const conn = await inst.connect();
      const result = await conn.runAndReadAll(sql);
      const columns = result.columnNames();
      const rows = result.getRows();
      await conn.disconnectSync();
      return {
        columns,
        rows: rows.map((r) => Array.from(r)),
        rowsAffected: rows.length,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e), performance.now() - start);
    }
  }

  async listTables(connectionId: string, desc?: ConnectionDescriptor): Promise<string[]> {
    const r = await this.query(
      connectionId,
      "SELECT table_name FROM information_schema.tables WHERE table_schema='main'",
      desc,
    );
    return r.rows.map((row) => String(row[0]));
  }

  async close(connectionId: string): Promise<void> {
    this.instances.delete(connectionId);
  }
}

function errorResult(message: string, durationMs = 0): DbQueryResult {
  return {
    columns: [],
    rows: [],
    rowsAffected: 0,
    durationMs: Math.round(durationMs),
    error: message,
  };
}
