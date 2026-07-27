/// Pure 5-field cron matcher — extracted from the scheduler so it is unit
/// testable without any Tauri runtime.
/// Supports: "*", "*/n", "a", "a-b", comma lists — for minute, hour,
/// day-of-month, month, day-of-week (0=Sunday).

function fieldMatches(field: string, value: number): boolean {
  for (const part of field.split(',')) {
    if (part === '*') return true;
    const step = /^\*\/(\d+)$/.exec(part);
    if (step) {
      if (value % Number(step[1]) === 0) return true;
      continue;
    }
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      if (value >= Number(range[1]) && value <= Number(range[2])) return true;
      continue;
    }
    if (/^\d+$/.test(part) && Number(part) === value) return true;
  }
  return false;
}

export function cronMatches(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [min, hour, dom, month, dow] = fields as [string, string, string, string, string];
  return (
    fieldMatches(min, date.getMinutes()) &&
    fieldMatches(hour, date.getHours()) &&
    fieldMatches(dom, date.getDate()) &&
    fieldMatches(month, date.getMonth() + 1) &&
    fieldMatches(dow, date.getDay())
  );
}

/// Next matching minute after `from` (scan up to 366 days; a valid 5-field
/// expression always matches within a year).
export function nextCronRun(expression: string, from: Date): number | null {
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() < limit) {
    if (cronMatches(expression, cursor)) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

export function validateCron(expression: string): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return 'Expected a 5-field cron expression (min hour dom month dow).';
  for (const f of fields) {
    if (!/^(\*|\*\/\d+|\d+(-\d+)?)(,(\*|\*\/\d+|\d+(-\d+)?))*$/.test(f)) {
      return `Invalid cron field "${f}". Supported: * , */n , a , a-b and comma lists.`;
    }
  }
  return nextCronRun(expression, new Date()) === null
    ? 'Expression never matches within a year.'
    : null;
}
