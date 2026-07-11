import mermaid from 'mermaid';
import { Network } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDbStore } from '../db-store';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    background: '#0a0a0a',
    primaryColor: '#1e1e22',
    primaryBorderColor: '#52525b',
    primaryTextColor: '#e4e4e7',
    lineColor: '#71717a',
  },
});

/// Entity-relationship diagram for the active database, built from the
/// information_schema introspection in the db-store and rendered by Mermaid.
export function RelationDiagram() {
  const tables = useDbStore((s) => s.tables);
  const runArbitrary = useDbStore((s) => s.runArbitrary);
  const ref = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (tables.length === 0) return;
      const diagramParts: string[] = ['erDiagram'];
      for (const t of tables) {
        const full = `${t.schema}_${t.name}`;
        const cols = await runArbitrary(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='${t.schema}' AND table_name='${t.name}' ORDER BY ordinal_position`,
        );
        diagramParts.push(`  ${full} {`);
        for (const row of cols.rows) {
          diagramParts.push(`    ${String(row[1]).replace(/\W/g, '_')} ${String(row[0])}`);
        }
        diagramParts.push('  }');
        const fks = await runArbitrary(`
          SELECT kcu.column_name, ccu.table_name, ccu.column_name
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu USING (constraint_name)
          JOIN information_schema.constraint_column_usage AS ccu USING (constraint_name)
          WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='${t.schema}' AND tc.table_name='${t.name}'`);
        for (const row of fks.rows) {
          diagramParts.push(`  ${full} ||--o{ public_${String(row[1])} : "${String(row[0])}→${String(row[2])}"`);
        }
      }
      if (cancelled) return;
      try {
        const { svg } = await mermaid.render(
          `mer_${Date.now().toString(36)}`,
          diagramParts.join('\n'),
        );
        if (ref.current && !cancelled) {
          ref.current.innerHTML = svg;
          setRenderError(null);
        }
      } catch (e) {
        setRenderError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tables, runArbitrary]);

  if (tables.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-600">
        <Network className="h-8 w-8" />
        <p className="text-xs">No tables to diagram.</p>
      </div>
    );
  }
  if (renderError) {
    return (
      <div className="p-3 text-[11px] text-red-300">
        Diagram render failed: {renderError}
      </div>
    );
  }
  return <div ref={ref} className="h-full w-full overflow-auto bg-neutral-950 p-3" />;
}
