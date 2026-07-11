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

export interface DbDriver {
  kind: string;
  open(connectionId: string): Promise<void>;
  query(connectionId: string, sql: string): Promise<DbQueryResult>;
  listTables(connectionId: string): Promise<string[]>;
  close(connectionId: string): Promise<void>;
}
