import RedisMock from 'ioredis-mock';
import type { DbDriver, DbQueryResult } from './types';

/// Redis driver — uses ioredis-mock for in-process key/value playground.
/// Real Redis would connect via ioredis to redis://localhost:6379.
///
/// SQL surface: we parse a tiny grammar (`SET k v`, `GET k`, `KEYS pat`,
/// `DEL k`, `HSET k f v`, `HGETALL k`, ...) so the SQL Editor can drive it
/// without users learning the redis-cli quirks.
export class RedisDriver implements DbDriver {
  kind = 'redis' as const;
  private clients = new Map<string, RedisMock>();

  async open(connectionId: string): Promise<void> {
    if (this.clients.has(connectionId)) return;
    this.clients.set(connectionId, new RedisMock());
  }

  async query(connectionId: string, sql: string): Promise<DbQueryResult> {
    await this.open(connectionId);
    const client = this.clients.get(connectionId);
    if (!client) return err('no client');
    const start = performance.now();
    try {
      const tokens = sql.trim().split(/\s+/);
      const cmd = (tokens[0] ?? '').toLowerCase();
      const args = tokens.slice(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (client as any).call(cmd, ...args);
      const rows = Array.isArray(result)
        ? result.map((r) => [r])
        : [[result]];
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

  async listTables(connectionId: string): Promise<string[]> {
    const r = await this.query(connectionId, 'KEYS *');
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
  return { columns: [], rows: [], rowsAffected: 0, durationMs: Math.round(durationMs), error: message };
}
