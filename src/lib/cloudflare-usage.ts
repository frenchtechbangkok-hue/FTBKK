import { z } from 'zod';
import { CloudflareError, splitRange, type Range, type TrafficConfig } from './traffic';

// Reports > Cloudflare usage: what the site uses of its Cloudflare plan (Worker requests and CPU
// time, D1 database reads, writes and storage, R2 file storage and operations), against the
// limits of the plan chosen on the page (Settings key cloudflarePlan). Read from Cloudflare's
// GraphQL Analytics API with the same token as Website traffic (CF_ANALYTICS_TOKEN, Account
// Analytics: Read). Each product loads on its own: if one fails, the others still show.
// Cloudflare counts days and months in UTC, so do these figures. Limits are account-wide (every
// Worker and database on the account counts), so the queries are not filtered on this Worker.

export type CfPlan = 'free' | 'paid';
export const PLAN_NAMES: Record<CfPlan, string> = {
  free: 'Workers Free',
  paid: 'Workers Paid ($5 a month)',
};
/** Workers Paid's monthly base price, in US dollars. */
export const PAID_BASE_USD = 5;

export type MetricKey =
  'requests' | 'cpu' | 'd1Read' | 'd1Written' | 'd1Storage' | 'r2Storage' | 'r2ClassA' | 'r2ClassB';

export interface PlanLimit {
  /** 'day' and 'month' reset at 00:00 UTC; 'stored' is a size at any time. */
  window: 'day' | 'month' | 'stored';
  included: number;
  /** Price beyond what is included (Paid and R2); none = the service stops at the limit. */
  overage?: { per: number; usd: number };
}

const GB = 1e9;
const M = 1e6;

// Cloudflare's published limits and prices (developers.cloudflare.com, "Pricing" of Workers, D1
// and R2), checked November 2026. R2's free allowance and prices are the same on both plans.
const R2: Record<'r2Storage' | 'r2ClassA' | 'r2ClassB', PlanLimit> = {
  r2Storage: { window: 'stored', included: 10 * GB, overage: { per: GB, usd: 0.015 } },
  r2ClassA: { window: 'month', included: 1 * M, overage: { per: M, usd: 4.5 } },
  r2ClassB: { window: 'month', included: 10 * M, overage: { per: M, usd: 0.36 } },
};
export const PLAN_LIMITS: Record<CfPlan, Record<MetricKey, PlanLimit>> = {
  free: {
    requests: { window: 'day', included: 100_000 },
    // Free has no CPU allowance in total, only 10 ms per request (checked on the slowest requests).
    cpu: { window: 'month', included: 0 },
    d1Read: { window: 'day', included: 5 * M },
    d1Written: { window: 'day', included: 100_000 },
    d1Storage: { window: 'stored', included: 5 * GB },
    ...R2,
  },
  paid: {
    requests: { window: 'month', included: 10 * M, overage: { per: M, usd: 0.3 } },
    cpu: { window: 'month', included: 30 * M, overage: { per: M, usd: 0.02 } },
    d1Read: { window: 'month', included: 25_000 * M, overage: { per: M, usd: 0.001 } },
    d1Written: { window: 'month', included: 50 * M, overage: { per: M, usd: 1 } },
    d1Storage: { window: 'stored', included: 5 * GB, overage: { per: GB, usd: 0.75 } },
    ...R2,
  },
};
/** CPU time one request may use: 10 ms on Free (then it fails), 30 s by default on Paid. */
export const CPU_PER_REQUEST_MS: Record<CfPlan, number> = { free: 10, paid: 30_000 };
/** Largest single D1 database. */
export const D1_DATABASE_MAX: Record<CfPlan, number> = { free: 500 * M, paid: 10 * GB };

export const METRIC_LABELS: Record<MetricKey, string> = {
  requests: 'Worker requests',
  cpu: 'Worker CPU time',
  d1Read: 'Database rows read',
  d1Written: 'Database rows written',
  d1Storage: 'Database storage',
  r2Storage: 'File storage (R2)',
  r2ClassA: 'File uploads and listings (R2 class A)',
  r2ClassB: 'File reads (R2 class B)',
};
export const METRIC_HINTS: Record<MetricKey, string> = {
  requests:
    'Every page, form and admin screen the Worker answers, bots included. Images and styles served as static files are free and not counted.',
  cpu: 'Time the Worker spends computing (waiting for the database does not count).',
  d1Read:
    'Rows the database scans to answer queries. A list or report reads many rows at once, so this is usually the first limit to watch.',
  d1Written: 'Rows added or changed: registrations, contacts, settings, email statuses.',
  d1Storage: 'Size of all databases on the account.',
  r2Storage: 'Photos, logos, PDFs and other uploads.',
  r2ClassA: 'Uploading or listing files (admin uploads, the Files screen).',
  r2ClassB: 'Reading a file: every photo or PDF shown that is not already in cache.',
};

// --- Pure helpers (unit tested) ---

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const startOfUtcMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()));
const nextUtcMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1));

/** The days the page reads: the last 30 days and the whole current month, whichever starts first. */
export function usageWindow(now: Date): Range {
  const thirty = new Date(startOfUtcDay(now).getTime() - 29 * 86400_000);
  const month = startOfUtcMonth(now);
  return { from: month < thirty ? month : thirty, to: now };
}

export interface DailySummary {
  today: number;
  month: number;
  /** Busiest day of the last 30 days (UTC date). */
  peak: { date: string; value: number } | null;
  /** The month's total at this pace. */
  projected: number;
  /** Per day over the last 30 days, oldest first, with their UTC dates. */
  days: { date: string; value: number }[];
}

/** What to multiply the month so far by to get the whole month at the same pace. */
export function monthPace(now: Date): number {
  const monthStart = startOfUtcMonth(now);
  const elapsed = (now.getTime() - monthStart.getTime()) / 86400_000;
  const length = (nextUtcMonth(now).getTime() - monthStart.getTime()) / 86400_000;
  // The first hours of a month say little about it: project from a full day at least.
  return length / Math.max(1, elapsed);
}

/** Today, this month, the busiest day and the month's projection from daily figures. */
export function summarizeDaily(byDay: Map<string, number>, now: Date): DailySummary {
  const today = iso(now);
  const monthPrefix = today.slice(0, 7);
  let month = 0;
  for (const [d, v] of byDay) if (d.startsWith(monthPrefix)) month += v;
  const days: { date: string; value: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = iso(new Date(startOfUtcDay(now).getTime() - i * 86400_000));
    days.push({ date, value: byDay.get(date) ?? 0 });
  }
  const peak = days.reduce<DailySummary['peak']>(
    (best, d) => (d.value > 0 && (!best || d.value > best.value) ? d : best),
    null,
  );
  const projected = month * monthPace(now);
  return { today: byDay.get(today) ?? 0, month, peak, projected, days };
}

/** R2 class of an operation: A (writes and listings), B (reads) or free (deletes). */
export function r2Class(action: string): 'A' | 'B' | 'free' {
  if (/^(Delete|Abort)/.test(action)) return 'free';
  if (/^(List|Put|Copy|Create|Complete|Upload)/.test(action)) return 'A';
  return 'B';
}

export type Level = 'ok' | 'warning' | 'danger';
/** Green below 80% of a limit, amber from 80%, red at or over it. */
export const usageLevel = (used: number, limit: number): Level =>
  limit <= 0 ? 'ok' : used >= limit ? 'danger' : used >= limit * 0.8 ? 'warning' : 'ok';

/** What one metric would cost beyond the plan's allowance (US dollars), 0 when within it. */
export function overageCost(limit: PlanLimit, used: number): number {
  if (!limit.overage || used <= limit.included) return 0;
  return ((used - limit.included) / limit.overage.per) * limit.overage.usd;
}

// --- Cloudflare API ---

const API = 'https://api.cloudflare.com/client/v4';
type Fetcher = typeof fetch;

async function graphql(
  token: string,
  accountId: string,
  query: string,
  variables: Record<string, unknown>,
  fetcher: Fetcher,
): Promise<Record<string, unknown>> {
  const res = await fetcher(`${API}/graphql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { account: accountId, ...variables } }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { viewer?: { accounts?: Record<string, unknown>[] } } | null;
    errors?: { message: string }[] | null;
  };
  if (body.errors?.length) throw new CloudflareError(body.errors[0]!.message);
  if (!res.ok) throw new CloudflareError(`Cloudflare answered ${res.status}`);
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new CloudflareError('The API token cannot read analytics for this account.');
  return account;
}

async function findAccount(cfg: TrafficConfig, fetcher: Fetcher): Promise<string> {
  if (cfg.accountId) return cfg.accountId;
  const res = await fetcher(`${API}/accounts?per_page=50`, {
    headers: { authorization: `Bearer ${cfg.token}` },
  });
  const body = (await res.json().catch(() => ({}))) as {
    result?: { id: string }[];
    errors?: { message: string }[];
  };
  if (!res.ok)
    throw new CloudflareError(body.errors?.[0]?.message ?? `Cloudflare answered ${res.status}`);
  const accounts = body.result ?? [];
  if (accounts.length !== 1)
    throw new CloudflareError(
      accounts.length
        ? 'The API token reads several Cloudflare accounts: set CF_ACCOUNT_ID.'
        : 'The API token cannot read any Cloudflare account.',
    );
  return accounts[0]!.id;
}

const num = z.coerce.number().catch(0);
const Group = z.object({
  sum: z.record(z.string(), num).optional(),
  max: z.record(z.string(), num).optional(),
  quantiles: z.record(z.string(), num).optional(),
  dimensions: z.record(z.string(), z.string().nullable()).optional(),
});
type G = z.infer<typeof Group>;
const groups = (account: Record<string, unknown>, key: string) =>
  z.array(Group).catch([]).parse(account[key]);
const dim = (g: G, k: string) => g.dimensions?.[k] ?? '';

const WORKERS = `query WorkerUsage($account: string!, $from: Time!, $to: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    days: workersInvocationsAdaptive(limit: 5000, filter: { datetime_geq: $from, datetime_lt: $to }) {
      sum { requests errors } dimensions { date scriptName status } }
  } } }`;

const CPU = `query WorkerCpu($account: string!, $from: Time!, $to: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    days: workersInvocationsAdaptive(limit: 5000, filter: { datetime_geq: $from, datetime_lt: $to }) {
      sum { cpuTimeUs } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { date } }
  } } }`;

const D1 = `query D1Usage($account: string!, $fromDate: Date!, $toDate: Date!, $recent: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    days: d1AnalyticsAdaptiveGroups(limit: 5000, filter: { date_geq: $fromDate, date_leq: $toDate }) {
      sum { rowsRead rowsWritten readQueries writeQueries } dimensions { date } }
    storage: d1StorageAdaptiveGroups(limit: 5000, filter: { date_geq: $recent, date_leq: $toDate }) {
      max { databaseSizeBytes } dimensions { date databaseId } }
  } } }`;

const R2_QUERY = `query R2Usage($account: string!, $monthStart: Time!, $recent: Time!, $to: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    ops: r2OperationsAdaptiveGroups(limit: 1000, filter: { datetime_geq: $monthStart, datetime_lt: $to }) {
      sum { requests } dimensions { actionType } }
    storage: r2StorageAdaptiveGroups(limit: 1000, filter: { datetime_geq: $recent, datetime_lt: $to }) {
      max { payloadSize metadataSize objectCount } dimensions { bucketName } }
  } } }`;

export interface WorkerUsage {
  requests: DailySummary;
  errors: number;
  /** Requests Cloudflare stopped for using too much CPU or memory, in the last 30 days. */
  exceeded: number;
  /** Requests per Worker this month, biggest first. */
  scripts: [string, number][];
}
export interface CpuUsage {
  /** CPU milliseconds. */
  ms: DailySummary;
  /** The slowest 1% of requests use more than this on the worst day (ms). */
  p99Max: number | null;
  /** Median request (ms), weighted across days. */
  p50: number | null;
}
export interface D1Usage {
  read: DailySummary;
  written: DailySummary;
  queries: number;
  /** Latest size of each database (bytes). */
  databases: { id: string; bytes: number }[];
  storage: number;
}
export interface R2Usage {
  classA: number;
  classB: number;
  /** Bytes stored now, all buckets. */
  storage: number;
  objects: number;
  buckets: { name: string; bytes: number; objects: number }[];
}

export interface Section<T> {
  data: T | null;
  error: string | null;
}
export interface CloudflareUsage {
  accountId: string;
  workers: Section<WorkerUsage>;
  cpu: Section<CpuUsage>;
  d1: Section<D1Usage>;
  r2: Section<R2Usage>;
}

async function section<T>(run: () => Promise<T>): Promise<Section<T>> {
  try {
    return { data: await run(), error: null };
  } catch (e) {
    return { data: null, error: (e as Error).message };
  }
}

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

/** Reads the account's usage for the current month and the last 30 days. */

export async function loadCloudflareUsage(
  cfg: TrafficConfig,
  now = new Date(),
  fetcher: Fetcher = fetch,
): Promise<CloudflareUsage> {
  const accountId = await findAccount(cfg, fetcher);
  const q = (query: string, vars: Record<string, unknown>) =>
    graphql(cfg.token, accountId, query, vars, fetcher);
  const window = usageWindow(now);
  // One query may span 31 days at most; the window is 31 days or less, split to be safe.
  const pieces = splitRange(window, 31 * 86400);
  const span = (r: Range) => ({ from: r.from.toISOString(), to: r.to.toISOString() });
  const monthStart = startOfUtcMonth(now);

  const workers = section(async () => {
    const parts = await Promise.all(pieces.map((p) => q(WORKERS, span(p))));
    const byDay = new Map<string, number>();
    const scripts = new Map<string, number>();
    let errors = 0;
    let exceeded = 0;
    const thirty = iso(new Date(startOfUtcDay(now).getTime() - 29 * 86400_000));
    for (const g of parts.flatMap((a) => groups(a, 'days'))) {
      const n = g.sum?.requests ?? 0;
      const date = dim(g, 'date');
      add(byDay, date, n);
      if (date >= iso(monthStart)) add(scripts, dim(g, 'scriptName') || 'Unknown', n);
      if (date >= thirty) {
        errors += g.sum?.errors ?? 0;
        if (/exceeded/i.test(dim(g, 'status'))) exceeded += n;
      }
    }
    return {
      requests: summarizeDaily(byDay, now),
      errors,
      exceeded,
      scripts: [...scripts.entries()].sort((a, b) => b[1] - a[1]),
    };
  });

  const cpu = section(async () => {
    const parts = await Promise.all(pieces.map((p) => q(CPU, span(p))));
    const byDay = new Map<string, number>();
    let p99Max: number | null = null;
    let p50Sum = 0;
    let p50Weight = 0;
    for (const g of parts.flatMap((a) => groups(a, 'days'))) {
      const us = g.sum?.cpuTimeUs ?? 0;
      add(byDay, dim(g, 'date'), us / 1000);
      const p99 = g.quantiles?.cpuTimeP99;
      if (p99 !== undefined && p99 >= 0) p99Max = Math.max(p99Max ?? 0, p99 / 1000);
      const p50 = g.quantiles?.cpuTimeP50;
      if (p50 !== undefined && p50 >= 0 && us > 0) {
        p50Sum += (p50 / 1000) * us;
        p50Weight += us;
      }
    }
    return {
      ms: summarizeDaily(byDay, now),
      p99Max,
      p50: p50Weight ? p50Sum / p50Weight : null,
    };
  });

  const d1 = section(async () => {
    const a = await q(D1, {
      fromDate: iso(window.from),
      toDate: iso(now),
      recent: iso(new Date(now.getTime() - 3 * 86400_000)),
    });
    const read = new Map<string, number>();
    const written = new Map<string, number>();
    let queries = 0;
    for (const g of groups(a, 'days')) {
      add(read, dim(g, 'date'), g.sum?.rowsRead ?? 0);
      add(written, dim(g, 'date'), g.sum?.rowsWritten ?? 0);
      if (dim(g, 'date') >= iso(monthStart))
        queries += (g.sum?.readQueries ?? 0) + (g.sum?.writeQueries ?? 0);
    }
    // The latest day each database reported its size.
    const latest = new Map<string, { date: string; bytes: number }>();
    for (const g of groups(a, 'storage')) {
      const id = dim(g, 'databaseId');
      const date = dim(g, 'date');
      const bytes = g.max?.databaseSizeBytes ?? 0;
      const seen = latest.get(id);
      if (!seen || date > seen.date || (date === seen.date && bytes > seen.bytes))
        latest.set(id, { date, bytes });
    }
    const databases = [...latest.entries()]
      .map(([id, v]) => ({ id, bytes: v.bytes }))
      .sort((x, y) => y.bytes - x.bytes);
    return {
      read: summarizeDaily(read, now),
      written: summarizeDaily(written, now),
      queries,
      databases,
      storage: databases.reduce((s, d) => s + d.bytes, 0),
    };
  });

  const r2 = section(async () => {
    const a = await q(R2_QUERY, {
      monthStart: monthStart.toISOString(),
      recent: new Date(now.getTime() - 2 * 86400_000).toISOString(),
      to: now.toISOString(),
    });
    let classA = 0;
    let classB = 0;
    for (const g of groups(a, 'ops')) {
      const c = r2Class(dim(g, 'actionType'));
      if (c === 'A') classA += g.sum?.requests ?? 0;
      else if (c === 'B') classB += g.sum?.requests ?? 0;
    }
    const buckets = groups(a, 'storage')
      .map((g) => ({
        name: dim(g, 'bucketName'),
        bytes: (g.max?.payloadSize ?? 0) + (g.max?.metadataSize ?? 0),
        objects: g.max?.objectCount ?? 0,
      }))
      .sort((x, y) => y.bytes - x.bytes);
    return {
      classA,
      classB,
      buckets,
      storage: buckets.reduce((s, b) => s + b.bytes, 0),
      objects: buckets.reduce((s, b) => s + b.objects, 0),
    };
  });

  return {
    accountId,
    workers: await workers,
    cpu: await cpu,
    d1: await d1,
    r2: await r2,
  };
}

/** The month's figure of each metric, projected to month end, for the cost estimate. */
export function monthlyProjection(
  u: CloudflareUsage,
  now: Date,
): Partial<Record<MetricKey, number>> {
  const out: Partial<Record<MetricKey, number>> = {};
  const w = u.workers.data;
  if (w) out.requests = w.requests.projected;
  if (u.cpu.data) out.cpu = u.cpu.data.ms.projected;
  if (u.d1.data) {
    out.d1Read = u.d1.data.read.projected;
    out.d1Written = u.d1.data.written.projected;
    out.d1Storage = u.d1.data.storage;
  }
  const r = u.r2.data;
  if (r) {
    out.r2Storage = r.storage;
    out.r2ClassA = r.classA * monthPace(now);
    out.r2ClassB = r.classB * monthPace(now);
  }
  return out;
}

/** Estimated bill for the month on a plan (US dollars), from the projected figures. */
export function estimateMonthlyCost(
  plan: CfPlan,
  projected: Partial<Record<MetricKey, number>>,
): { total: number; lines: { key: MetricKey; usd: number }[] } {
  const lines = (Object.keys(projected) as MetricKey[])
    .map((key) => ({ key, usd: overageCost(PLAN_LIMITS[plan][key], projected[key] ?? 0) }))
    .filter((l) => l.usd > 0);
  const base = plan === 'paid' ? PAID_BASE_USD : 0;
  return { total: base + lines.reduce((s, l) => s + l.usd, 0), lines };
}

/** Bytes as "12.3 MB" (decimal units, as Cloudflare bills). */
export function formatBytes(b: number): string {
  if (b < 1000) return `${Math.round(b)} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let v = b / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Big counts as "2.4M" or "25B", small ones in full. */
export function formatCount(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  return new Intl.NumberFormat('en-GB').format(Math.round(n));
}
