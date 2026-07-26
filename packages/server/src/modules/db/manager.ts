import type { ConnectionDescriptor, DbDriver, DbQueryResult } from './types';

/// Driver registry — REAL. Each kind lazy-imports its driver on first use
/// (a missing native dep fails that kind loudly, not the whole sidecar).
/// Connections can carry a descriptor (existing file / server URL) via
/// `register`, so the DB Studio talks to the user's actual databases.

const DRIVER_LOADERS: Record<string, () => Promise<DbDriver>> = {
  sqlite: async () => new (await import('./sqlite-driver')).SqliteDriver(),
  duckdb: async () => new (await import('./duckdb-driver')).DuckdbDriver(),
  libsql: async () => new (await import('./libsql-driver')).LibsqlDriver(),
  redis: async () => new (await import('./redis-driver')).RedisDriver(),
  mongo: async () => new (await import('./mongo-driver')).MongoDriver(),
};

export class DbManager {
  private drivers = new Map<string, DbDriver>();
  private descriptors = new Map<string, ConnectionDescriptor>();

  register(connectionId: string, desc: ConnectionDescriptor): void {
    this.descriptors.set(connectionId, desc);
  }

  private kindOf(connectionId: string): string {
    return this.descriptors.get(connectionId)?.kind ?? connectionId.split('-')[0] ?? '';
  }

  private async driverFor(kind: string): Promise<DbDriver> {
    const cached = this.drivers.get(kind);
    if (cached) return cached;
    const loader = DRIVER_LOADERS[kind];
    if (!loader) throw new Error(`Unknown DB kind "${kind}"`);
    const driver = await loader();
    this.drivers.set(kind, driver);
    return driver;
  }

  /// Availability probe per kind: true, or the import error message (e.g.
  /// a native module missing from this build).
  async driversAvailable(): Promise<Record<string, true | string>> {
    const out: Record<string, true | string> = {};
    for (const kind of Object.keys(DRIVER_LOADERS)) {
      try {
        await this.driverFor(kind);
        out[kind] = true;
      } catch (e) {
        out[kind] = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      }
    }
    return out;
  }

  async query(connectionId: string, sql: string): Promise<DbQueryResult> {
    const kind = this.kindOf(connectionId);
    try {
      const driver = await this.driverFor(kind);
      return await driver.query(connectionId, sql, this.descriptors.get(connectionId));
    } catch (e) {
      return {
        columns: [],
        rows: [],
        rowsAffected: 0,
        durationMs: 0,
        error: `${kind}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  async listTables(connectionId: string): Promise<string[]> {
    const kind = this.kindOf(connectionId);
    try {
      const driver = await this.driverFor(kind);
      return await driver.listTables(connectionId, this.descriptors.get(connectionId));
    } catch {
      return [];
    }
  }

  async close(connectionId: string): Promise<void> {
    const kind = this.kindOf(connectionId);
    const driver = this.drivers.get(kind);
    if (driver) await driver.close(connectionId);
  }
}

export type { DbDriver };
