import { env } from 'cloudflare:workers';
import { looksLikeBot, readEmailVisit } from './email-links';

/**
 * Counts a visit that came through a link in one of the site's emails, then redirects to the same
 * page without the utm_ tags (a clean address, and one copy in the edge cache). Served by
 * src/worker.ts before Astro. The redirect is never cached, so every click reaches the Worker.
 * Returns null for any other request.
 */
export function emailVisitRedirect(
  request: Request,
  ctx: { waitUntil(p: Promise<unknown>): void },
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const visit = readEmailVisit(new URL(request.url));
  if (!visit) return null;
  if (request.method === 'GET' && !looksLikeBot(request.headers.get('user-agent')))
    ctx.waitUntil(
      recordEmailVisit(visit.campaign, visit.path).catch((e: unknown) =>
        console.error('[email-visits]', e),
      ),
    );
  return new Response(null, {
    status: 302,
    headers: { Location: visit.clean, 'Cache-Control': 'private, no-store' },
  });
}

export async function recordEmailVisit(campaign: string, path: string, at = new Date()) {
  await env.DB.prepare(
    `INSERT INTO email_visits (day, campaign, path, visits) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT (day, campaign, path) DO UPDATE SET visits = visits + 1`,
  )
    .bind(at.toISOString().slice(0, 10), campaign, path)
    .run();
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Visits from the site's emails in a period (UTC days from `from` up to, not including, the day
 * of `to` unless `to` is past midnight): the total, per day, per email and per page.
 */
export async function emailVisitStats(range: { from: Date; to: Date }) {
  const from = day(range.from);
  // `to` is exclusive: a period ending at midnight doesn't include that day.
  const to = day(new Date(range.to.getTime() - 1));
  const q = (sql: string) => env.DB.prepare(sql).bind(from, to);
  const [days, campaigns, pages] = await env.DB.batch<{ k: string; n: number }>([
    q(
      'SELECT day AS k, SUM(visits) AS n FROM email_visits WHERE day >= ?1 AND day <= ?2 GROUP BY day',
    ),
    q(
      'SELECT campaign AS k, SUM(visits) AS n FROM email_visits WHERE day >= ?1 AND day <= ?2 GROUP BY campaign ORDER BY n DESC LIMIT 15',
    ),
    q(
      'SELECT path AS k, SUM(visits) AS n FROM email_visits WHERE day >= ?1 AND day <= ?2 GROUP BY path ORDER BY n DESC LIMIT 15',
    ),
  ]);
  const rows = (r: typeof days | undefined) =>
    (r?.results ?? []).map((x): [string, number] => [String(x.k), Number(x.n) || 0]);
  const byDay = new Map(rows(days));
  return {
    total: [...byDay.values()].reduce((a, b) => a + b, 0),
    byDay,
    campaigns: rows(campaigns),
    pages: rows(pages),
  };
}
export type EmailVisitStats = Awaited<ReturnType<typeof emailVisitStats>>;
