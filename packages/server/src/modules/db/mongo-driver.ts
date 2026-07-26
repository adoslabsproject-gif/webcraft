import { MongoClient } from 'mongodb';
import type { ConnectionDescriptor, DbDriver, DbQueryResult } from './types';

/// MongoDB driver — REAL MongoClient against the descriptor URL
/// (mongodb://host:port) or local default. 1.5s server selection timeout
/// so an unreachable server errors fast instead of hanging.
///
/// Query language: pass JSON like
///   { collection: "users", op: "find", filter: { age: { $gte: 18 } } }
/// in the SQL editor. The shape is intentionally minimal — full mongo
/// shell parity comes later.
export class MongoDriver implements DbDriver {
  kind = 'mongo' as const;
  private servers = new Map<string, { client: MongoClient }>();

  async open(connectionId: string, desc?: ConnectionDescriptor): Promise<void> {
    if (this.servers.has(connectionId)) return;
    const url = desc?.url ?? 'mongodb://127.0.0.1:27017';
    const client = new MongoClient(url, {
      serverSelectionTimeoutMS: 1500,
      connectTimeoutMS: 1500,
    });
    await client.connect();
    this.servers.set(connectionId, { client });
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
        `cannot reach mongodb (${desc?.url ?? 'mongodb://127.0.0.1:27017'}): ${e instanceof Error ? e.message : String(e)}`,
        performance.now() - start,
      );
    }
    const entry = this.servers.get(connectionId);
    if (!entry) return err('no client');
    try {
      const spec = JSON.parse(sql) as {
        db?: string;
        collection: string;
        op: 'find' | 'insertOne' | 'updateOne' | 'deleteOne' | 'aggregate';
        filter?: unknown;
        document?: unknown;
        update?: unknown;
        pipeline?: unknown[];
      };
      const db = entry.client.db(spec.db ?? 'test');
      const coll = db.collection(spec.collection);
      let result: unknown;
      if (spec.op === 'find') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await coll.find((spec.filter ?? {}) as any).toArray();
      } else if (spec.op === 'insertOne') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await coll.insertOne(spec.document as any);
      } else if (spec.op === 'updateOne') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await coll.updateOne((spec.filter ?? {}) as any, spec.update as any);
      } else if (spec.op === 'deleteOne') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await coll.deleteOne((spec.filter ?? {}) as any);
      } else if (spec.op === 'aggregate') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await coll.aggregate((spec.pipeline ?? []) as any).toArray();
      } else {
        return err(`unsupported op: ${String(spec.op)}`, performance.now() - start);
      }
      const arr = Array.isArray(result) ? result : [result];
      const columns =
        arr[0] && typeof arr[0] === 'object'
          ? Object.keys(arr[0] as Record<string, unknown>)
          : ['value'];
      return {
        columns,
        rows: arr.map((r) =>
          typeof r === 'object' && r !== null
            ? columns.map((c) => (r as Record<string, unknown>)[c])
            : [r],
        ),
        rowsAffected: arr.length,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e), performance.now() - start);
    }
  }

  async listTables(connectionId: string, desc?: ConnectionDescriptor): Promise<string[]> {
    try {
      await this.open(connectionId, desc);
    } catch {
      return [];
    }
    const entry = this.servers.get(connectionId);
    if (!entry) return [];
    const db = entry.client.db('test');
    const cols = await db.listCollections().toArray();
    return cols.map((c) => c.name);
  }

  async close(connectionId: string): Promise<void> {
    const entry = this.servers.get(connectionId);
    if (entry) {
      await entry.client.close();
      this.servers.delete(connectionId);
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
