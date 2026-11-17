// Dashboards and insights > Newsletters: every newsletter sent in the period with its figures
// (from the providers' events tagged newsletter-<id>, the site visits from its links and the
// unsubscribes from its link), the totals against the previous period, and how the list grows.
import { env } from 'cloudflare:workers';
import { and, asc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { contacts, newsletters, newsletterSends } from '../db/schema';
import { campaignsFigures, type EmailTotals } from './email-metrics';
import { audienceCounts, campaignOf } from './newsletters';
import { parsePeriod } from './report-period';

export interface NewsletterRow {
  id: number;
  subject: string;
  slug: string | null;
  sentAt: Date;
  recipients: number;
  email: EmailTotals | null;
  visits: number;
  unsubscribed: number;
}

const rate = (a: number, b: number) => (b ? a / b : null);

/** Sums of a set of newsletters, for the key figures. */
export function newsletterTotals(rows: NewsletterRow[]) {
  const t = {
    newsletters: rows.length,
    recipients: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    visits: 0,
    unsubscribed: 0,
    tracked: 0,
  };
  for (const r of rows) {
    t.recipients += r.recipients;
    t.visits += r.visits;
    t.unsubscribed += r.unsubscribed;
    if (r.email) {
      t.tracked++;
      t.sent += r.email.sent;
      t.delivered += r.email.delivered;
      t.opened += r.email.opened;
      t.clicked += r.email.clicked;
    }
  }
  return {
    ...t,
    openRate: rate(t.opened, t.delivered),
    clickRate: rate(t.clicked, t.delivered),
    unsubscribeRate: rate(t.unsubscribed, t.recipients),
  };
}

async function sentBetween(from: Date, to: Date): Promise<NewsletterRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: newsletters.id,
      subject: newsletters.subject,
      slug: newsletters.slug,
      sentAt: newsletters.sentAt,
      recipients: newsletters.sentCount,
    })
    .from(newsletters)
    .where(
      and(
        eq(newsletters.status, 'sent'),
        isNotNull(newsletters.sentAt),
        gte(newsletters.sentAt, from),
        lt(newsletters.sentAt, to),
      ),
    )
    .orderBy(asc(newsletters.sentAt));
  if (!rows.length) return [];
  const campaigns = rows.map((r) => campaignOf(r.id));
  const [email, visits, unsub] = await Promise.all([
    campaignsFigures(campaigns),
    env.DB.prepare(
      `SELECT campaign, SUM(visits) AS n FROM email_visits WHERE campaign IN (${campaigns.map((_, i) => `?${i + 1}`).join(',')}) GROUP BY campaign`,
    )
      .bind(...campaigns)
      .all<{ campaign: string; n: number }>()
      .then((r) => r.results)
      .catch(() => []),
    db
      .select({ id: newsletterSends.newsletterId, n: sql<number>`count(*)` })
      .from(newsletterSends)
      .where(isNotNull(newsletterSends.unsubscribedAt))
      .groupBy(newsletterSends.newsletterId),
  ]);
  return rows.map((r) => ({
    ...r,
    sentAt: r.sentAt!,
    email: email.get(campaignOf(r.id)) ?? null,
    visits: Number(visits.find((v) => v.campaign === campaignOf(r.id))?.n ?? 0),
    unsubscribed: Number(unsub.find((u) => u.id === r.id)?.n ?? 0),
  }));
}

/** Pages people opened from any newsletter sent in the period. */
async function topPages(rows: NewsletterRow[]) {
  if (!rows.length) return [];
  const campaigns = rows.map((r) => campaignOf(r.id));
  return env.DB.prepare(
    `SELECT path, SUM(visits) AS visits FROM email_visits WHERE campaign IN (${campaigns.map((_, i) => `?${i + 1}`).join(',')}) GROUP BY path ORDER BY visits DESC LIMIT 15`,
  )
    .bind(...campaigns)
    .all<{ path: string; visits: number }>()
    .then((r) => r.results.map((p) => ({ path: p.path, visits: Number(p.visits) })))
    .catch(() => []);
}

/** "Yes" and "no" to the newsletter recorded on contact cards in the period. */
async function listChanges(from: Date, to: Date) {
  const rows = await getDb()
    .select({ choice: contacts.newsletter, n: sql<number>`count(*)` })
    .from(contacts)
    .where(
      and(
        isNotNull(contacts.newsletter),
        gte(contacts.newsletterAt, from),
        lt(contacts.newsletterAt, to),
      ),
    )
    .groupBy(contacts.newsletter);
  const n = (c: 'yes' | 'no') => Number(rows.find((r) => r.choice === c)?.n ?? 0);
  return { joined: n('yes'), left: n('no') };
}

export async function loadNewsletterReport(url: URL, now = new Date()) {
  const db = getDb();
  let first: Date | null = null;
  try {
    const [row] = await db
      .select({ first: sql<number | null>`min(${newsletters.sentAt})` })
      .from(newsletters);
    first = row?.first ? new Date(Number(row.first) * 1000) : null;
  } catch (e) {
    // Before migration 0045 runs (a preview sharing the production database).
    return { period: parsePeriod(url.searchParams, now, now), error: String(e), report: null };
  }
  const period = parsePeriod(url.searchParams, now, first ?? now);
  const rows = await sentBetween(period.from, period.to);
  const [before, pages, changes, previousChanges, audience] = await Promise.all([
    period.previous ? sentBetween(period.previous.from, period.previous.to) : null,
    topPages(rows),
    listChanges(period.from, period.to),
    period.previous ? listChanges(period.previous.from, period.previous.to) : null,
    audienceCounts({ groups: [], tags: [] })
      .then((a) => a.counts.newsletter)
      .catch(() => null),
  ]);
  return {
    period,
    error: null,
    report: {
      rows,
      totals: newsletterTotals(rows),
      previous: before ? newsletterTotals(before) : null,
      pages,
      changes,
      previousChanges,
      subscribers: audience,
    },
  };
}
