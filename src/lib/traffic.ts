import { z } from 'zod';
import { DAY_MS } from './lifecycle';
import { periodBuckets, type Bucket } from './report-period';

// Reports > Website traffic. Cloudflare's dashboards can't be embedded, so the server reads the same
// figures from Cloudflare's GraphQL Analytics API with an API token (Worker secret
// CF_ANALYTICS_TOKEN, docs/deploy.md section 9):
//   - visits and page views from Web Analytics (the beacon loaded when Settings has its token),
//   - Core Web Vitals from the same beacon (what Observatory shows as real-user speed),
//   - requests and errors served by this Worker.
// Each part loads on its own: if one fails, the page shows the others and the error.

const API = 'https://api.cloudflare.com/client/v4';
type Fetcher = typeof fetch;

export interface TrafficConfig {
  token: string;
  /** Empty = the only account the token can read. */
  accountId: string;
  /** Empty = the Web Analytics site whose beacon token is in Settings, or whose host is the site's. */
  siteTag: string;
  /** Settings > Cloudflare Web Analytics token (the beacon). */
  beaconToken: string;
  /** The site's host, to find the Web Analytics site when no tag or beacon token matches. */
  host: string;
  /** The Worker's name, for its request counts. */
  script: string;
}

export interface Range {
  from: Date;
  /** Exclusive. */
  to: Date;
}

/** How far back Cloudflare keeps a dataset and how long one query may span (in seconds). */
interface Limits {
  maxDuration: number;
  notOlderThan: number;
}
// Used when the API doesn't say: Web Analytics keeps 6 months, Workers metrics 3 months.
const DEFAULT_LIMITS: Record<Dataset, Limits> = {
  rumPageloadEventsAdaptiveGroups: { maxDuration: 31 * 86400, notOlderThan: 183 * 86400 },
  rumWebVitalsEventsAdaptiveGroups: { maxDuration: 31 * 86400, notOlderThan: 183 * 86400 },
  workersInvocationsAdaptive: { maxDuration: 31 * 86400, notOlderThan: 92 * 86400 },
};
type Dataset =
  | 'rumPageloadEventsAdaptiveGroups'
  | 'rumWebVitalsEventsAdaptiveGroups'
  | 'workersInvocationsAdaptive';

// --- Pure helpers (unit tested) ---

/** The part of a range Cloudflare still keeps; null when none of it is. */
export function clampRange(r: Range, limits: Limits, now: Date): Range | null {
  // An hour of margin: a query starting exactly at the limit is refused.
  const oldest = new Date(now.getTime() - limits.notOlderThan * 1000 + 3600 * 1000);
  const from = r.from < oldest ? oldest : r.from;
  const to = r.to > now ? now : r.to;
  return from < to ? { from, to } : null;
}

/** Splits a range into pieces no longer than one query may span. */
export function splitRange(r: Range, maxSeconds: number): Range[] {
  const step = Math.max(3600, maxSeconds - 3600) * 1000;
  const out: Range[] = [];
  for (let t = r.from.getTime(); t < r.to.getTime(); t += step)
    out.push({ from: new Date(t), to: new Date(Math.min(t + step, r.to.getTime())) });
  return out;
}

/** Adds up top lists from several queries and keeps the biggest. */
export function mergeTop(lists: [string, number][][], limit = 10): [string, number][] {
  const sums = new Map<string, number>();
  for (const list of lists) for (const [k, n] of list) sums.set(k, (sums.get(k) ?? 0) + n);
  return [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** Puts daily figures (UTC dates "2026-10-01") into the period's chart buckets. */
export function bucketDaily(days: Map<string, number>, buckets: Bucket[]): number[] {
  return buckets.map((b) => {
    let n = 0;
    for (const [d, v] of days) {
      const t = new Date(`${d}T00:00:00Z`);
      if (t >= b.from && t < b.to) n += v;
    }
    return n;
  });
}

export type VitalName = 'lcp' | 'inp' | 'cls';
// Google's thresholds for "good" and "poor" (LCP and INP in ms).
export const VITAL_THRESHOLDS: Record<VitalName, [number, number]> = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
};
export const VITAL_LABELS: Record<VitalName, string> = {
  lcp: 'Loading (LCP)',
  inp: 'Responsiveness (INP)',
  cls: 'Visual stability (CLS)',
};
export function vitalRating(name: VitalName, p75: number | null): 'good' | 'fair' | 'poor' | null {
  if (p75 === null) return null;
  const [good, poor] = VITAL_THRESHOLDS[name];
  return p75 <= good ? 'good' : p75 <= poor ? 'fair' : 'poor';
}
export const formatVital = (name: VitalName, v: number | null) =>
  v === null
    ? '–'
    : name === 'cls'
      ? v.toFixed(2)
      : v >= 1000
        ? `${(v / 1000).toFixed(1)} s`
        : `${Math.round(v)} ms`;

// --- Cloudflare API ---

class CloudflareError extends Error {}

async function rest<T>(
  cfg: TrafficConfig,
  path: string,
  schema: z.ZodType<T>,
  fetcher: Fetcher,
): Promise<T> {
  const res = await fetcher(`${API}${path}`, {
    headers: { authorization: `Bearer ${cfg.token}` },
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: { message: string }[];
    result?: unknown;
  };
  if (!res.ok || body.success === false)
    throw new CloudflareError(body.errors?.[0]?.message ?? `Cloudflare answered ${res.status}`);
  return schema.parse(body.result);
}

async function graphql(
  cfg: TrafficConfig & { accountId: string },
  query: string,
  variables: Record<string, unknown>,
  fetcher: Fetcher,
): Promise<Record<string, unknown>> {
  const res = await fetcher(`${API}/graphql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { account: cfg.accountId, ...variables } }),
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

const Accounts = z.array(z.object({ id: z.string(), name: z.string() }));
const Sites = z.array(
  z.object({
    site_tag: z.string(),
    site_token: z.string().optional(),
    host: z.string().nullish(),
  }),
);

/** Fills in the account and the Web Analytics site when they aren't set. */
async function resolve(cfg: TrafficConfig, fetcher: Fetcher) {
  let accountId = cfg.accountId;
  if (!accountId) {
    const accounts = await rest(cfg, '/accounts?per_page=50', Accounts, fetcher);
    if (accounts.length !== 1)
      throw new CloudflareError(
        accounts.length
          ? 'The API token reads several Cloudflare accounts: set CF_ACCOUNT_ID.'
          : 'The API token cannot read any Cloudflare account.',
      );
    accountId = accounts[0]!.id;
  }
  // The token may not be allowed to list Web Analytics sites (that needs another permission):
  // then the figures are filtered on the website's host, which needs nothing more.
  let siteTag = cfg.siteTag;
  if (!siteTag) {
    try {
      const sites = await rest(
        cfg,
        `/accounts/${accountId}/rum/site_info/list?per_page=100`,
        Sites,
        fetcher,
      );
      const site =
        sites.find((s) => cfg.beaconToken && s.site_token === cfg.beaconToken) ??
        sites.find((s) => s.host === cfg.host);
      if (site) siteTag = site.site_tag;
    } catch {
      // Filter on the host below.
    }
  }
  const site: SiteFilter = siteTag
    ? { field: 'siteTag', value: siteTag }
    : { field: 'requestHost', value: cfg.host };
  return { accountId, site };
}

/** Which Web Analytics figures to read: one site, or every page view on the website's host. */
interface SiteFilter {
  field: 'siteTag' | 'requestHost';
  value: string;
}

const LimitsSchema = z.object({ maxDuration: z.number(), notOlderThan: z.number() }).nullish();
async function datasetLimits(
  cfg: TrafficConfig & { accountId: string },
  fetcher: Fetcher,
): Promise<Record<Dataset, Limits>> {
  const names = Object.keys(DEFAULT_LIMITS) as Dataset[];
  try {
    const account = await graphql(
      cfg,
      `query Limits($account: string!) { viewer { accounts(filter: { accountTag: $account }) {
        settings { ${names.map((n) => `${n} { maxDuration notOlderThan }`).join(' ')} }
      } } }`,
      {},
      fetcher,
    );
    const settings = (account.settings ?? {}) as Record<string, unknown>;
    return Object.fromEntries(
      names.map((n) => [n, LimitsSchema.parse(settings[n]) ?? DEFAULT_LIMITS[n]]),
    ) as Record<Dataset, Limits>;
  } catch {
    return DEFAULT_LIMITS;
  }
}

// --- Queries ---

const span = (r: Range) => ({ from: r.from.toISOString(), to: r.to.toISOString() });
const num = z.coerce.number().catch(0);
const Group = z.object({
  count: num.optional(),
  sum: z.record(z.string(), num).optional(),
  avg: z.record(z.string(), num).optional(),
  quantiles: z.record(z.string(), z.coerce.number().nullable().catch(null)).optional(),
  dimensions: z.record(z.string(), z.string().nullable()).optional(),
});
const groups = (account: Record<string, unknown>, key: string) =>
  z.array(Group).catch([]).parse(account[key]);

const TOPS = {
  pages: 'requestPath',
  referrers: 'refererHost',
  countries: 'countryName',
  devices: 'deviceType',
  browsers: 'userAgentBrowser',
} as const;
type TopName = keyof typeof TOPS;

const PAGELOAD = (
  field: SiteFilter['field'],
) => `query Pageloads($account: string!, $site: string!, $from: Time!, $to: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    total: rumPageloadEventsAdaptiveGroups(limit: 1, filter: { AND: [
      { datetime_geq: $from, datetime_lt: $to }, { ${field}: $site } ] }) { count sum { visits } }
    days: rumPageloadEventsAdaptiveGroups(limit: 100, orderBy: [date_ASC], filter: { AND: [
      { datetime_geq: $from, datetime_lt: $to }, { ${field}: $site } ] }) {
      count sum { visits } dimensions { date } }
    ${Object.entries(TOPS)
      .map(
        ([alias, dim]) => `${alias}: rumPageloadEventsAdaptiveGroups(limit: 50,
      orderBy: [count_DESC], filter: { AND: [
      { datetime_geq: $from, datetime_lt: $to }, { ${field}: $site } ] }) {
      count sum { visits } dimensions { key: ${dim} } }`,
      )
      .join('\n')}
  } } }`;

const TOTALS = (
  field: SiteFilter['field'],
) => `query PageloadTotals($account: string!, $site: string!, $from: Time!, $to: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    total: rumPageloadEventsAdaptiveGroups(limit: 1, filter: { AND: [
      { datetime_geq: $from, datetime_lt: $to }, { ${field}: $site } ] }) { count sum { visits } }
  } } }`;

const VITALS = (
  field: SiteFilter['field'],
) => `query WebVitals($account: string!, $site: string!, $from: Time!, $to: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    vitals: rumWebVitalsEventsAdaptiveGroups(limit: 1, filter: { AND: [
      { datetime_geq: $from, datetime_lt: $to }, { ${field}: $site } ] }) {
      count
      sum { lcpTotal lcpGood lcpNeedsImprovement lcpPoor inpTotal inpGood inpNeedsImprovement
        inpPoor clsTotal clsGood clsNeedsImprovement clsPoor }
      quantiles { largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75 }
    }
  } } }`;

const WORKER = `query Worker($account: string!, $script: string!, $from: Time!, $to: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    days: workersInvocationsAdaptive(limit: 100, orderBy: [date_ASC], filter: {
      scriptName: $script, datetime_geq: $from, datetime_lt: $to }) {
      sum { requests errors } dimensions { date } }
  } } }`;

export interface Section<T> {
  data: T | null;
  error: string | null;
  /** The part of the period the figures cover (Cloudflare keeps a few months only). */
  range: Range | null;
}

export interface Pageloads {
  visits: number;
  pageViews: number;
  /** Per chart bucket. */
  visitsSeries: number[];
  viewsSeries: number[];
  tops: Record<TopName, [string, number][]>;
}
export interface Vital {
  p75: number | null;
  good: number | null;
  total: number;
}
export type Vitals = Record<VitalName, Vital>;
export interface WorkerStats {
  requests: number;
  errors: number;
  series: number[];
}

export interface TrafficReport {
  configured: true;
  accountId: string;
  /** Web Analytics site, or the host when the token can't list sites. */
  siteFilter: SiteFilter;
  buckets: Bucket[];
  unit: string;
  pageloads: Section<Pageloads>;
  previous: { visits: number; pageViews: number } | null;
  vitals: Section<Vitals>;
  worker: Section<WorkerStats>;
}

async function section<T>(
  range: Range | null,
  run: (r: Range) => Promise<T>,
  missing: string | null = null,
): Promise<Section<T>> {
  if (missing) return { data: null, error: missing, range };
  if (!range)
    return { data: null, error: 'Cloudflare no longer keeps data for this period.', range };
  try {
    return { data: await run(range), error: null, range };
  } catch (e) {
    return { data: null, error: (e as Error).message, range };
  }
}

const dimKey = (g: z.infer<typeof Group>, k: string) => g.dimensions?.[k] ?? '';

/** The traffic report for a period. `fetcher` is replaced in tests. */
export async function loadTraffic(
  cfg: TrafficConfig,
  period: Range & { previous: Range | null; buckets?: Bucket[] },
  now = new Date(),
  fetcher: Fetcher = fetch,
): Promise<TrafficReport> {
  const { accountId, site: siteFilter } = await resolve(cfg, fetcher);
  const full = { ...cfg, accountId };
  const limits = await datasetLimits(full, fetcher);
  // The dashboard passes its own day buckets; Reports uses the period's weeks or months.
  const { unit, buckets } = period.buckets
    ? { unit: 'day', buckets: period.buckets }
    : periodBuckets(period);
  const site = { site: siteFilter.value };
  const pieces = (r: Range, d: Dataset) => splitRange(r, limits[d].maxDuration);
  const rum = clampRange(period, limits.rumPageloadEventsAdaptiveGroups, now);

  const pageloads = section(rum, async (r) => {
    const parts = await Promise.all(
      pieces(r, 'rumPageloadEventsAdaptiveGroups').map((p) =>
        graphql(full, PAGELOAD(siteFilter.field), { ...site, ...span(p) }, fetcher),
      ),
    );
    const visitsByDay = new Map<string, number>();
    const viewsByDay = new Map<string, number>();
    let visits = 0;
    let pageViews = 0;
    for (const a of parts) {
      const t = groups(a, 'total')[0];
      visits += t?.sum?.visits ?? 0;
      pageViews += t?.count ?? 0;
      for (const g of groups(a, 'days')) {
        const d = dimKey(g, 'date');
        visitsByDay.set(d, (visitsByDay.get(d) ?? 0) + (g.sum?.visits ?? 0));
        viewsByDay.set(d, (viewsByDay.get(d) ?? 0) + (g.count ?? 0));
      }
    }
    const top = (name: TopName, label: (k: string) => string) =>
      mergeTop(
        parts.map((a) =>
          groups(a, name).map((g): [string, number] => [
            label(dimKey(g, 'key')),
            name === 'pages' ? (g.count ?? 0) : (g.sum?.visits ?? 0),
          ]),
        ),
      );
    return {
      visits,
      pageViews,
      visitsSeries: bucketDaily(visitsByDay, buckets),
      viewsSeries: bucketDaily(viewsByDay, buckets),
      tops: {
        pages: top('pages', (k) => k || '/'),
        referrers: top('referrers', (k) => k.replace(/^www\./, '') || 'Direct or unknown'),
        countries: top('countries', (k) => k || 'Unknown'),
        devices: top('devices', (k) => (k ? k[0]!.toUpperCase() + k.slice(1) : 'Unknown')),
        browsers: top('browsers', (k) => k || 'Unknown'),
      },
    };
  });

  // The previous period's totals, for the changes on the key figures, when Cloudflare still has it.
  const prevRange = period.previous
    ? clampRange(period.previous, limits.rumPageloadEventsAdaptiveGroups, now)
    : null;
  type Totals = { visits: number; pageViews: number };
  const previous: Promise<Totals | null> =
    !prevRange || prevRange.from.getTime() !== period.previous!.from.getTime()
      ? Promise.resolve(null)
      : Promise.all(
          pieces(prevRange, 'rumPageloadEventsAdaptiveGroups').map((p) =>
            graphql(full, TOTALS(siteFilter.field), { ...site, ...span(p) }, fetcher),
          ),
        )
          .then((parts) =>
            parts.reduce<Totals>(
              (acc, a) => {
                const t = groups(a, 'total')[0];
                return {
                  visits: acc.visits + (t?.sum?.visits ?? 0),
                  pageViews: acc.pageViews + (t?.count ?? 0),
                };
              },
              { visits: 0, pageViews: 0 },
            ),
          )
          .catch(() => null);

  const vitals = section(
    clampRange(period, limits.rumWebVitalsEventsAdaptiveGroups, now),
    async (r) => {
      const parts = await Promise.all(
        pieces(r, 'rumWebVitalsEventsAdaptiveGroups').map((p) =>
          graphql(full, VITALS(siteFilter.field), { ...site, ...span(p) }, fetcher),
        ),
      );
      const rows = parts.flatMap((a) => groups(a, 'vitals'));
      const quantile: Record<VitalName, string> = {
        lcp: 'largestContentfulPaintP75',
        inp: 'interactionToNextPaintP75',
        cls: 'cumulativeLayoutShiftP75',
      };
      const one = (name: VitalName): Vital => {
        let total = 0;
        let good = 0;
        let weighted = 0;
        let weight = 0;
        for (const g of rows) {
          const n = g.sum?.[`${name}Total`] ?? 0;
          total += n;
          good += g.sum?.[`${name}Good`] ?? 0;
          const q = g.quantiles?.[quantile[name]];
          // Negative = no data. Timings come in microseconds.
          if (q !== null && q !== undefined && q >= 0 && n > 0) {
            weighted += (name === 'cls' ? q : q / 1000) * n;
            weight += n;
          }
        }
        // Over several queries, the 75th percentile is the average of each piece's, by weight.
        return { total, good: total ? good / total : null, p75: weight ? weighted / weight : null };
      };
      return { lcp: one('lcp'), inp: one('inp'), cls: one('cls') };
    },
  );

  const worker = section(clampRange(period, limits.workersInvocationsAdaptive, now), async (r) => {
    const parts = await Promise.all(
      pieces(r, 'workersInvocationsAdaptive').map((p) =>
        graphql(full, WORKER, { script: cfg.script, ...span(p) }, fetcher),
      ),
    );
    const byDay = new Map<string, number>();
    let requests = 0;
    let errors = 0;
    for (const g of parts.flatMap((a) => groups(a, 'days'))) {
      const n = g.sum?.requests ?? 0;
      requests += n;
      errors += g.sum?.errors ?? 0;
      const d = dimKey(g, 'date');
      byDay.set(d, (byDay.get(d) ?? 0) + n);
    }
    return { requests, errors, series: bucketDaily(byDay, buckets) };
  });

  return {
    configured: true,
    accountId,
    siteFilter,
    unit,
    buckets,
    pageloads: await pageloads,
    previous: await previous,
    vitals: await vitals,
    worker: await worker,
  };
}

/** How far back the page can go: Web Analytics keeps about 6 months. */
export const oldestTraffic = (now: Date) => new Date(now.getTime() - 183 * DAY_MS);

export { CloudflareError };

const PATH_VIEWS = (
  field: SiteFilter['field'],
) => `query PathViews($account: string!, $site: string!, $from: Time!, $to: Time!, $like: string!) {
  viewer { accounts(filter: { accountTag: $account }) {
    paths: rumPageloadEventsAdaptiveGroups(limit: 1000, orderBy: [count_DESC], filter: { AND: [
      { datetime_geq: $from, datetime_lt: $to }, { ${field}: $site }, { requestPath_like: $like } ] }) {
      count dimensions { key: requestPath } }
  } } }`;

/** Page views per path under a prefix ("/blog/"), over the last `days` days (Blog posts list). */
export async function pageViewsByPath(
  cfg: TrafficConfig,
  prefix: string,
  days: number,
  now = new Date(),
  fetcher: Fetcher = fetch,
): Promise<Record<string, number>> {
  const { accountId, site } = await resolve(cfg, fetcher);
  const full = { ...cfg, accountId };
  const limits = await datasetLimits(full, fetcher);
  const r = clampRange(
    { from: new Date(now.getTime() - days * DAY_MS), to: now },
    limits.rumPageloadEventsAdaptiveGroups,
    now,
  );
  if (!r) return {};
  const parts = await Promise.all(
    splitRange(r, limits.rumPageloadEventsAdaptiveGroups.maxDuration).map((p) =>
      graphql(
        full,
        PATH_VIEWS(site.field),
        { site: site.value, like: `${prefix}%`, ...span(p) },
        fetcher,
      ),
    ),
  );
  const views: Record<string, number> = {};
  for (const a of parts)
    for (const g of groups(a, 'paths')) {
      // One post can be reached with and without a trailing slash.
      const path = dimKey(g, 'key').replace(/\/+$/, '');
      views[path] = (views[path] ?? 0) + (g.count ?? 0);
    }
  return views;
}
