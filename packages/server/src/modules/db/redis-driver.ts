import Redis from 'ioredis';
import type { ConnectionDescriptor, DbDriver, DbQueryResult } from './types';

/// Redis driver — REAL ioredis client. Connects to the descriptor URL
/// (redis://host:port[/db]) or the local default. Fails fast (1.5s connect
/// timeout, no retry storm) so a down server is an error message, not a
/// hang.
///
/// Query surface: raw redis commands (`SET k v`, `GET k`, `KEYS pat`,
/// `HGETALL k`, …) — dispatched via ioredis `call`, so the entire command
/// set works.
export class RedisDriver implements DbDriver {
  kind = 'redis' as const;
  private clients = new Map<string, Redis>();

  async open(connectionId: string, desc?: ConnectionDescriptor): Promise<void> {
    if (this.clients.has(connectionId)) return;
    const url = desc?.url ?? 'redis://127.0.0.1:6379';
    const client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 1500,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // no background reconnect loops
    });
    await client.connect();
    this.clients.set(connectionId, client);
  }

  async query(
    connectionId: string,
    sql: string,
    desc?: ConnectionDescriptor,
  ): Promise<DbQueryResult> {
    const start = performance.now();
    try {
      await this.open(connectionId, desc);
    } catch (e) {
      return err(
        `cannot reach redis (${desc?.url ?? 'redis://127.0.0.1:6379'}): ${e instanceof Error ? e.message : String(e)}`,
        performance.now() - start,
      );
    }
    const client = this.clients.get(connectionId);
    if (!client) return err('no client');
    try {
      const tokens = sql.trim().split(/\s+/);
      const cmd = (tokens[0] ?? '').toLowerCase();
      const args = tokens.slice(1);
      const result = await client.call(cmd, ...args);
      const rows = Array.isArray(result) ? result.map((r) => [r]) : [[result]];
      return {
        columns: ['value'],
        rows,
        rowsAffected: Array.isArray(result) ? result.length : 1,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e), performance.now() - start);
    }
  }

  async listTables(connectionId: string, desc?: ConnectionDescriptor): Promise<string[]> {
    const r = await this.query(connectionId, 'KEYS *', desc);
    return r.rows.map((row) => String(row[0]));
  }

  async close(connectionId: string): Promise<void> {
    const c = this.clients.get(connectionId);
    if (c) {
      c.disconnect();
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
