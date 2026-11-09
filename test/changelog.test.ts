import { describe, expect, it } from 'vitest';
import { RELEASES } from '../src/lib/changelog';

describe('Change history', () => {
  // Newest first: YY.MM.XX versions (from November 2026), then the old 1.N ones.
  const dated = RELEASES.filter((r) => !r.version.startsWith('1.'));
  const legacy = RELEASES.slice(dated.length);

  it('puts the YY.MM.XX versions on top, each matching its date, counting up within a month', () => {
    expect(RELEASES.slice(0, dated.length)).toEqual(dated);
    const seen = new Map<string, number>();
    [...dated].reverse().forEach((r) => {
      expect(r.version).toMatch(/^\d{2}\.\d{2}\.\d{2}$/);
      const month = `${r.date.slice(2, 4)}.${r.date.slice(5, 7)}`;
      const n = (seen.get(month) ?? 0) + 1;
      seen.set(month, n);
      expect(r.version).toBe(`${month}.${String(n).padStart(2, '0')}`);
    });
  });

  it('keeps the old 1.N versions one step apart', () => {
    legacy.forEach((r, i) => {
      expect(r.version).toBe(`1.${legacy.length - 1 - i}`);
    });
  });

  it('has dates that never go forward in time down the list', () => {
    for (let i = 1; i < RELEASES.length; i++) {
      expect(RELEASES[i]!.date <= RELEASES[i - 1]!.date).toBe(true);
    }
    for (const r of RELEASES) expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('has one entry per pull request, with words', () => {
    const prs = RELEASES.flatMap((r) => (r.pr ? [r.pr] : []));
    expect(new Set(prs).size).toBe(prs.length);
    for (const r of RELEASES) {
      expect(r.title.trim()).not.toBe('');
      expect(r.summary.trim()).not.toBe('');
    }
  });
});
