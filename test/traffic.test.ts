import { describe, expect, it } from 'vitest';
import { periodBuckets } from '../src/lib/report-period';
import {
  bucketDaily,
  clampRange,
  formatVital,
  loadTraffic,
  mergeTop,
  splitRange,
  vitalRating,
} from '../src/lib/traffic';

const DAY = 86400;
const d = (s: string) => new Date(s);

describe('traffic helpers', () => {
  it('clamps a period to what Cloudflare keeps', () => {
    const now = d('2026-11-03T00:00:00Z');
    const r = clampRange(
      { from: d('2026-01-01T00:00:00Z'), to: d('2026-12-01T00:00:00Z') },
      { maxDuration: 31 * DAY, notOlderThan: 30 * DAY },
      now,
    );
    expect(r!.from.toISOString()).toBe('2026-10-04T01:00:00.000Z');
    expect(r!.to).toEqual(now);
    expect(
      clampRange(
        { from: d('2025-01-01'), to: d('2025-02-01') },
        { maxDuration: DAY, notOlderThan: DAY },
        now,
      ),
    ).toBeNull();
  });

  it('splits a long range into query-sized pieces that cover it', () => {
    const parts = splitRange({ from: d('2026-01-01'), to: d('2026-03-01') }, 31 * DAY);
    expect(parts.length).toBe(2);
    expect(parts[0]!.from).toEqual(d('2026-01-01'));
    expect(parts.at(-1)!.to).toEqual(d('2026-03-01'));
    expect(parts[1]!.from).toEqual(parts[0]!.to);
  });

  it('adds up top lists', () => {
    expect(
      mergeTop(
        [
          [
            ['/', 5],
            ['/events', 2],
          ],
          [
            ['/events', 4],
            ['/blog', 1],
          ],
        ],
        2,
      ),
    ).toEqual([
      ['/events', 6],
      ['/', 5],
    ]);
  });

  it('puts days into chart buckets', () => {
    const { buckets } = periodBuckets({
      from: d('2026-08-31T17:00:00Z'),
      to: d('2026-10-31T17:00:00Z'),
    });
    const months = bucketDaily(
      new Map([
        ['2026-09-01', 3],
        ['2026-09-30', 2],
        ['2026-10-15', 7],
      ]),
      buckets,
    );
    expect(months.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it('rates and formats Core Web Vitals', () => {
    expect(vitalRating('lcp', 1800)).toBe('good');
    expect(vitalRating('inp', 300)).toBe('fair');
    expect(vitalRating('cls', 0.4)).toBe('poor');
    expect(vitalRating('lcp', null)).toBeNull();
    expect(formatVital('lcp', 2450)).toBe('2.5 s');
    expect(formatVital('inp', 120)).toBe('120 ms');
    expect(formatVital('cls', 0.051)).toBe('0.05');
  });
});

describe('loadTraffic', () => {
  const now = d('2026-11-03T00:00:00Z');
  const period = {
    from: d('2026-10-03T17:00:00Z'),
    to: d('2026-11-02T17:00:00Z'),
    previous: { from: d('2026-09-03T17:00:00Z'), to: d('2026-10-03T17:00:00Z') },
  };
  const cfg = {
    token: 't',
    accountId: '',
    siteTag: '',
    beaconToken: 'beacon',
    host: 'example.com',
    script: 'ft-bkk-site',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const account = (data: Record<string, unknown>) =>
    json({ data: { viewer: { accounts: [data] } } });

  function fakeCloudflare(opts: { vitalsError?: boolean } = {}) {
    const calls: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).endsWith('/accounts?per_page=50'))
        return json({ success: true, result: [{ id: 'acc', name: 'FT' }] });
      if (String(url).includes('/rum/site_info/list'))
        return json({
          success: true,
          result: [
            { site_tag: 'other', site_token: 'x', host: 'other.com' },
            { site_tag: 'tag', site_token: 'beacon', host: 'example.com' },
          ],
        });
      const { query, variables } = JSON.parse(String(init!.body)) as {
        query: string;
        variables: Record<string, string>;
      };
      if (query.includes('query Limits')) return json({ errors: [{ message: 'no settings' }] });
      if (query.includes('query Pageloads')) {
        expect(variables).toMatchObject({ account: 'acc', site: 'tag' });
        return account({
          total: [{ count: 300, sum: { visits: 120 } }],
          days: [
            { count: 100, sum: { visits: 40 }, dimensions: { date: '2026-10-10' } },
            { count: 200, sum: { visits: 80 }, dimensions: { date: '2026-10-20' } },
          ],
          pages: [
            { count: 200, sum: { visits: 0 }, dimensions: { key: '/' } },
            { count: 100, sum: { visits: 0 }, dimensions: { key: '/events' } },
          ],
          referrers: [
            { count: 0, sum: { visits: 70 }, dimensions: { key: 'www.google.com' } },
            { count: 0, sum: { visits: 50 }, dimensions: { key: '' } },
          ],
          countries: [{ count: 0, sum: { visits: 120 }, dimensions: { key: 'Thailand' } }],
          devices: [{ count: 0, sum: { visits: 120 }, dimensions: { key: 'mobile' } }],
          browsers: [],
        });
      }
      if (query.includes('query PageloadTotals'))
        return account({ total: [{ count: 150, sum: { visits: 100 } }] });
      if (query.includes('query WebVitals')) {
        if (opts.vitalsError) return json({ errors: [{ message: 'unknown field' }] });
        return account({
          vitals: [
            {
              count: 50,
              sum: {
                lcpTotal: 50,
                lcpGood: 40,
                inpTotal: 20,
                inpGood: 20,
                clsTotal: 50,
                clsGood: 50,
              },
              quantiles: {
                largestContentfulPaintP75: 2_100_000,
                interactionToNextPaintP75: 80_000,
                cumulativeLayoutShiftP75: 0.02,
              },
            },
          ],
        });
      }
      if (query.includes('query Worker')) {
        expect(variables.script).toBe('ft-bkk-site');
        return account({
          days: [{ sum: { requests: 5000, errors: 5 }, dimensions: { date: '2026-10-10' } }],
        });
      }
      throw new Error(`unexpected ${query}`);
    }) as typeof fetch;
    return { fetcher, calls };
  }

  it('finds the account and site, then adds up the figures', async () => {
    const { fetcher } = fakeCloudflare();
    const r = await loadTraffic(cfg, period, now, fetcher);
    expect(r.accountId).toBe('acc');
    expect(r.siteTag).toBe('tag');
    const p = r.pageloads.data!;
    expect(p.visits).toBe(120);
    expect(p.pageViews).toBe(300);
    expect(p.viewsSeries.reduce((a, b) => a + b, 0)).toBe(300);
    expect(p.tops.referrers).toEqual([
      ['www.google.com', 70],
      ['Direct or unknown', 50],
    ]);
    expect(p.tops.devices).toEqual([['Mobile', 120]]);
    expect(r.previous).toEqual({ visits: 100, pageViews: 150 });
    expect(r.vitals.data!.lcp).toEqual({ total: 50, good: 0.8, p75: 2100 });
    expect(r.vitals.data!.cls.p75).toBe(0.02);
    expect(r.worker.data).toMatchObject({ requests: 5000, errors: 5 });
  });

  it('keeps the other parts when one fails', async () => {
    const { fetcher } = fakeCloudflare({ vitalsError: true });
    const r = await loadTraffic(cfg, period, now, fetcher);
    expect(r.vitals.error).toBe('unknown field');
    expect(r.pageloads.data!.visits).toBe(120);
  });

  it('skips lookups when the account and site are set', async () => {
    const { fetcher, calls } = fakeCloudflare();
    await loadTraffic({ ...cfg, accountId: 'acc', siteTag: 'tag' }, period, now, fetcher);
    expect(calls.some((c) => c.includes('/accounts?'))).toBe(false);
    expect(calls.some((c) => c.includes('site_info'))).toBe(false);
  });
});
