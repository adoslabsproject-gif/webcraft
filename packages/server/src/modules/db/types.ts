/// Common shape for any sidecar DB driver — query() returns a uniform
/// result with columns + rows so the renderer doesn't need driver-specific
/// branching.

export interface DbQueryResult {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number;
  durationMs: number;
  error?: string;
}

/// Where a connection points: an existing file on disk (sqlite/duckdb), a
/// server URL (redis/mongo/libsql/turso), or nothing (driver-managed local
/// store under ~/.webcraft).
export interface ConnectionDescriptor {
  kind: string;
  file?: string;
  url?: string;
}

export interface DbDriver {
  kind: string;
  open(connectionId: string, desc?: ConnectionDescriptor): Promise<void>;
  query(connectionId: string, sql: string, desc?: ConnectionDescriptor): Promise<DbQueryResult>;
  listTables(connectionId: string, desc?: ConnectionDescriptor): Promise<string[]>;
  close(connectionId: string): Promise<void>;
}
