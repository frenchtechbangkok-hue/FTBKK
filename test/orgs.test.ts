import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrgFields } from '../src/lib/orgs';

const base = { name: 'Acme', category: 'french_startup', pitch: 'We make useful things.' };

describe('OrgFields foundedYear', () => {
  afterEach(() => vi.useRealTimers());

  it('accepts recent years', () => {
    const r = OrgFields.safeParse({ ...base, foundedYear: '2025' });
    expect(r.success && r.data.foundedYear).toBe(2025);
  });

  it('uses the clock at parse time, not at module load', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-06-01T00:00:00Z'));
    expect(OrgFields.safeParse({ ...base, foundedYear: '2030' }).success).toBe(true);
    expect(OrgFields.safeParse({ ...base, foundedYear: '2031' }).success).toBe(false);
  });

  it('rejects very old years and keeps empty as null', () => {
    expect(OrgFields.safeParse({ ...base, foundedYear: '1700' }).success).toBe(false);
    const r = OrgFields.safeParse({ ...base, foundedYear: '' });
    expect(r.success && r.data.foundedYear).toBe(null);
  });
});
