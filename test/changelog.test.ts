import { describe, expect, it } from 'vitest';
import { RELEASES } from '../src/lib/changelog';

describe('Change history', () => {
  it('lists versions newest first, one step apart', () => {
    RELEASES.forEach((r, i) => {
      expect(r.version).toBe(`1.${RELEASES.length - 1 - i}`);
    });
  });

  it('has dates that never go forward in time down the list', () => {
    for (let i = 1; i < RELEASES.length; i++) {
      expect(RELEASES[i]!.date <= RELEASES[i - 1]!.date).toBe(true);
    }
    for (const r of RELEASES) expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('has one entry per pull request, with words', () => {
    expect(new Set(RELEASES.map((r) => r.pr)).size).toBe(RELEASES.length);
    for (const r of RELEASES) {
      expect(r.title.trim()).not.toBe('');
      expect(r.summary.trim()).not.toBe('');
    }
  });
});
