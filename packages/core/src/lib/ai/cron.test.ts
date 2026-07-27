import { describe, expect, it } from 'vitest';
import { cronMatches, nextCronRun, validateCron } from './cron';

describe('cronMatches', () => {
  const at = (min: number, hour: number, dom = 15, month = 6, dowDate?: Date) =>
    dowDate ?? new Date(2026, month - 1, dom, hour, min);

  it('matches every-minute wildcard', () => {
    expect(cronMatches('* * * * *', at(0, 0))).toBe(true);
    expect(cronMatches('* * * * *', at(59, 23))).toBe(true);
  });

  it('matches exact minute/hour', () => {
    expect(cronMatches('30 14 * * *', at(30, 14))).toBe(true);
    expect(cronMatches('30 14 * * *', at(31, 14))).toBe(false);
    expect(cronMatches('30 14 * * *', at(30, 15))).toBe(false);
  });

  it('matches steps', () => {
    expect(cronMatches('*/15 * * * *', at(0, 3))).toBe(true);
    expect(cronMatches('*/15 * * * *', at(45, 3))).toBe(true);
    expect(cronMatches('*/15 * * * *', at(20, 3))).toBe(false);
  });

  it('matches ranges and lists', () => {
    expect(cronMatches('0 9-17 * * *', at(0, 12))).toBe(true);
    expect(cronMatches('0 9-17 * * *', at(0, 18))).toBe(false);
    expect(cronMatches('0 8,12,18 * * *', at(0, 12))).toBe(true);
    expect(cronMatches('0 8,12,18 * * *', at(0, 13))).toBe(false);
  });

  it('matches day-of-week (0=Sunday)', () => {
    const sunday = new Date(2026, 6, 26, 10, 0); // 26 Jul 2026 is a Sunday
    const monday = new Date(2026, 6, 27, 10, 0);
    expect(cronMatches('0 10 * * 0', sunday)).toBe(true);
    expect(cronMatches('0 10 * * 0', monday)).toBe(false);
    expect(cronMatches('0 10 * * 1', monday)).toBe(true);
  });

  it('rejects malformed expressions', () => {
    expect(cronMatches('* * * *', at(0, 0))).toBe(false); // 4 fields
    expect(cronMatches('', at(0, 0))).toBe(false);
  });
});

describe('nextCronRun', () => {
  it('finds the next minute boundary', () => {
    const from = new Date(2026, 5, 15, 10, 20, 30);
    const next = nextCronRun('* * * * *', from);
    expect(next).not.toBeNull();
    const d = new Date(next!);
    expect(d.getMinutes()).toBe(21);
    expect(d.getSeconds()).toBe(0);
  });

  it('rolls over to the next day', () => {
    const from = new Date(2026, 5, 15, 23, 50);
    const next = nextCronRun('0 9 * * *', from);
    const d = new Date(next!);
    expect(d.getDate()).toBe(16);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });

  it('returns null when nothing can match', () => {
    // day-of-month 31 in February never matches within the scan when
    // combined with month=2.
    expect(nextCronRun('0 0 31 2 *', new Date(2026, 0, 1))).toBeNull();
  });
});

describe('validateCron', () => {
  it('accepts valid expressions', () => {
    expect(validateCron('*/5 * * * *')).toBeNull();
    expect(validateCron('0 9-17 1,15 * 1-5')).toBeNull();
  });

  it('rejects wrong field counts and garbage', () => {
    expect(validateCron('* * *')).toMatch(/5-field/);
    expect(validateCron('a * * * *')).toMatch(/Invalid cron field/);
    expect(validateCron('0 0 31 2 *')).toMatch(/never matches/);
  });
});
