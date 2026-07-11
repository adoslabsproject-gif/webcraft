import { listDir, readFile } from '../../lib/ipc/fs';
import { useDbStore } from './db-store';

/// Scan the project root for common DB configuration patterns and
/// auto-register connections — `.env DATABASE_URL`, `prisma/schema.prisma`,
/// `docker-compose.yml postgres/mysql/mongo services`, `*.db / *.sqlite`
/// files.

interface Discovered {
  kind: 'postgres' | 'mysql' | 'sqlite' | 'mongo' | 'redis';
  source: string; // human-readable origin
  url?: string;
  file?: string;
}

export async function discoverProjectDatabases(root: string): Promise<Discovered[]> {
  const out: Discovered[] = [];
  await scanFile(`${root}/.env`, /^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m, (url) => {
    const k = inferKindFromUrl(url);
    if (k) out.push({ kind: k, source: '.env DATABASE_URL', url });
  });
  await scanFile(`${root}/prisma/schema.prisma`, /provider\s*=\s*"(\w+)"/, (provider) => {
    const k = provider as Discovered['kind'];
    if (['postgres', 'postgresql', 'mysql', 'sqlite', 'mongo', 'mongodb'].includes(provider)) {
      out.push({
        kind: provider.startsWith('postgres') ? 'postgres' : (provider.startsWith('mongo') ? 'mongo' : k),
        source: 'prisma/schema.prisma',
      });
    }
  });
  await scanFile(`${root}/drizzle.config.ts`, /dialect\s*:\s*['"](\w+)['"]/, (dialect) => {
    out.push({
      kind: dialect === 'postgresql' ? 'postgres' : (dialect as Discovered['kind']),
      source: 'drizzle.config.ts',
    });
  });
  await scanFile(`${root}/docker-compose.yml`, /image:\s*(postgres|mysql|mongo|redis|mariadb)/g, (img) => {
    const k = img === 'mariadb' ? 'mysql' : (img as Discovered['kind']);
    out.push({ kind: k, source: `docker-compose service: ${img}` });
  });

  // Walk root looking for *.db / *.sqlite (top level only — keep cheap)
  try {
    const entries = await listDir(root);
    for (const e of entries) {
      if (!e.isDirectory && (/\.(db|sqlite|sqlite3)$/i.test(e.name))) {
        out.push({ kind: 'sqlite', source: e.name, file: e.path });
      }
    }
  } catch {
    /* root unreadable */
  }
  return out;
}

function inferKindFromUrl(url: string): Discovered['kind'] | null {
  if (/^postgres(ql)?:\/\//i.test(url)) return 'postgres';
  if (/^mysql:\/\//i.test(url)) return 'mysql';
  if (/^mongodb(\+srv)?:\/\//i.test(url)) return 'mongo';
  if (/^redis:\/\//i.test(url)) return 'redis';
  if (/^sqlite:\/\//i.test(url) || /\.(db|sqlite|sqlite3)$/i.test(url)) return 'sqlite';
  return null;
}

async function scanFile(
  path: string,
  pattern: RegExp,
  visit: (match: string) => void,
): Promise<void> {
  try {
    const text = await readFile(path);
    if (pattern.global) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        if (m[1]) visit(m[1]);
      }
    } else {
      const m = pattern.exec(text);
      if (m?.[1]) visit(m[1]);
    }
  } catch {
    /* file missing — silent */
  }
}

/// Side-effect helper: discover and add each finding as a DB connection.
export async function autoConnectProjectDatabases(root: string): Promise<number> {
  const found = await discoverProjectDatabases(root);
  let added = 0;
  for (const d of found) {
    useDbStore.getState().addConnection({
      name: `${d.source} (${d.kind})`,
      kind: d.kind,
      available: d.kind === 'sqlite', // SQLite via sidecar later — only flagged as available where renderer-side driver exists
    });
    added++;
  }
  return added;
}
