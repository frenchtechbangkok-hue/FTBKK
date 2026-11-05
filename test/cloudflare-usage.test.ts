import { describe, expect, it } from 'vitest';
import {
  estimateMonthlyCost,
  formatBytes,
  formatCount,
  loadCloudflareUsage,
  monthlyProjection,
  overageCost,
  PLAN_LIMITS,
  r2Class,
  summarizeDaily,
  usageLevel,
  usageWindow,
} from '../src/lib/cloudflare-usage';

const d = (s: string) => new Date(s);

describe('Cloudflare usage helpers', () => {
  it('reads the last 30 days or the whole month, whichever starts first', () => {
    expect(usageWindow(d('2026-11-05T10:00:00Z')).from.toISOString()).toBe(
      '2026-10-07T00:00:00.000Z',
    );
    expect(usageWindow(d('2026-12-31T10:00:00Z')).from.toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });

  it('sums today, the month and the busiest day, and projects the month', () => {
    const now = d('2026-11-11T00:00:00Z'); // 10 days into a 30-day month
    const days = new Map([
      ['2026-10-20', 900],
      ['2026-11-01', 100],
      ['2026-11-10', 200],
      ['2026-11-11', 50],
    ]);
    const s = summarizeDaily(days, now);
    expect(s.today).toBe(50);
    expect(s.month).toBe(350);
    expect(s.peak).toEqual({ date: '2026-10-20', value: 900 });
    expect(s.projected).toBeCloseTo(1050);
    expect(s.days).toHaveLength(30);
    expect(s.days.at(-1)).toEqual({ date: '2026-11-11', value: 50 });
  });

  it('does not blow up the projection in the first hours of a month', () => {
    const s = summarizeDaily(new Map([['2026-11-01', 1000]]), d('2026-11-01T01:00:00Z'));
    expect(s.projected).toBe(30_000);
  });

  it('sorts R2 operations into classes', () => {
    expect(r2Class('PutObject')).toBe('A');
    expect(r2Class('ListObjects')).toBe('A');
    expect(r2Class('GetObject')).toBe('B');
    expect(r2Class('HeadObject')).toBe('B');
    expect(r2Class('DeleteObject')).toBe('free');
  });

  it('turns usage into levels and costs', () => {
    expect(usageLevel(10, 100)).toBe('ok');
    expect(usageLevel(80, 100)).toBe('warning');
    expect(usageLevel(100, 100)).toBe('danger');
    expect(overageCost(PLAN_LIMITS.paid.requests, 5e6)).toBe(0);
    expect(overageCost(PLAN_LIMITS.paid.requests, 12e6)).toBeCloseTo(0.6);
    expect(overageCost(PLAN_LIMITS.free.requests, 1e9)).toBe(0);
    expect(estimateMonthlyCost('paid', { requests: 1e6 }).total).toBe(5);
    expect(estimateMonthlyCost('free', { r2Storage: 20e9 }).total).toBeCloseTo(0.15);
  });

  it('formats sizes and counts', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(12_345_678)).toBe('12.3 MB');
    expect(formatBytes(5e9)).toBe('5.0 GB');
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(2_400_000)).toBe('2.4M');
    expect(formatCount(25e9)).toBe('25B');
  });
});

describe('loadCloudflareUsage', () => {
  const cfg = {
    token: 't',
    accountId: '',
    siteTag: '',
    beaconToken: '',
    host: 'example.org',
    script: 'ft-bkk-site',
  };
  const now = d('2026-11-05T10:00:00Z');
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const account = (a: Record<string, unknown>) => json({ data: { viewer: { accounts: [a] } } });

  it('reads every product and keeps going when one fails', async () => {
    const fetcher = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/accounts?per_page=50'))
        return json({ success: true, result: [{ id: 'acc' }] });
      const q = JSON.parse(String(init?.body)).query as string;
      if (q.includes('WorkerUsage'))
        return account({
          days: [
            {
              sum: { requests: 1000, errors: 2 },
              dimensions: { date: '2026-11-05', scriptName: 'ft-bkk-site', status: 'success' },
            },
            {
              sum: { requests: 3, errors: 3 },
              dimensions: { date: '2026-11-04', scriptName: 'ft-bkk-site', status: 'exceededCpu' },
            },
          ],
        });
      if (q.includes('WorkerCpu'))
        return account({
          days: [
            {
              sum: { cpuTimeUs: 5_000_000 },
              quantiles: { cpuTimeP50: 1500, cpuTimeP99: 8000 },
              dimensions: { date: '2026-11-05' },
            },
          ],
        });
      if (q.includes('D1Usage'))
        return account({
          days: [
            {
              sum: { rowsRead: 4e6, rowsWritten: 500, readQueries: 10, writeQueries: 2 },
              dimensions: { date: '2026-11-05' },
            },
          ],
          storage: [
            {
              max: { databaseSizeBytes: 1e6 },
              dimensions: { date: '2026-11-03', databaseId: 'db' },
            },
            {
              max: { databaseSizeBytes: 2e6 },
              dimensions: { date: '2026-11-04', databaseId: 'db' },
            },
          ],
        });
      return json({ data: null, errors: [{ message: 'not authorized for R2' }] });
    }) as typeof fetch;

    const u = await loadCloudflareUsage(cfg, now, fetcher);
    expect(u.accountId).toBe('acc');
    expect(u.workers.data!.requests.today).toBe(1000);
    expect(u.workers.data!.requests.month).toBe(1003);
    expect(u.workers.data!.exceeded).toBe(3);
    expect(u.cpu.data!.ms.today).toBe(5000);
    expect(u.cpu.data!.p99Max).toBe(8);
    expect(u.d1.data!.read.today).toBe(4e6);
    expect(u.d1.data!.storage).toBe(2e6);
    expect(u.d1.data!.queries).toBe(12);
    expect(u.r2.error).toBe('not authorized for R2');
    expect(usageLevel(u.d1.data!.read.today, PLAN_LIMITS.free.d1Read.included)).toBe('warning');
    expect(monthlyProjection(u, now).r2Storage).toBeUndefined();
  });
});
