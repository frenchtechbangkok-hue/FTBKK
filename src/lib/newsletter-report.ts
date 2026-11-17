// Dashboards and insights > Newsletters: every newsletter sent in the period with its figures
// (from the providers' events tagged newsletter-<id>, the site visits from its links and the
// unsubscribes from its link), the totals against the previous period, and how the list grows.
import { env } from 'cloudflare:workers';
import { and, asc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { contacts, newsletters, newsletterSends } from '../db/schema';
import { formatDate } from './format';
import { campaignsFigures, type EmailTotals } from './email-metrics';
import { audienceCounts, campaignOf, newsletterKpis } from './newsletters';
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
  const picked = Number(url.searchParams.get('newsletter'));
  const db = getDb();
  let first: Date | null = null;
  try {
    const [row] = await db
      .select({ first: sql<number | null>`min(${newsletters.sentAt})` })
      .from(newsletters);
    first = row?.first ? new Date(Number(row.first) * 1000) : null;
  } catch (e) {
    // Before migration 0045 runs (a preview sharing the production database).
    return {
      period: parsePeriod(url.searchParams, now, now),
      error: String(e),
      report: null,
      picker: [],
      one: null,
    };
  }
  const period = parsePeriod(url.searchParams, now, first ?? now);
  const [picker, one] = await Promise.all([
    sentNewsletters(),
    Number.isInteger(picked) && picked > 0 ? loadOneNewsletter(picked) : null,
  ]);
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
    picker,
    one,
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

/** Every sent newsletter, newest first, for the dashboard's picker. */
export async function sentNewsletters() {
  const rows = await getDb()
    .select({ id: newsletters.id, subject: newsletters.subject, sentAt: newsletters.sentAt })
    .from(newsletters)
    .where(and(eq(newsletters.status, 'sent'), isNotNull(newsletters.sentAt)))
    .orderBy(sql`${newsletters.sentAt} DESC`)
    .limit(200);
  return rows.map((r) => ({ id: r.id, label: `${formatDate(r.sentAt!)} · ${r.subject}` }));
}

/** Days after sending shown on the "first days" chart. */
export const FIRST_DAYS = 14;

/**
 * Opens and clicks by day after sending (day 1 = the first 24 hours): each email counts on the
 * day it was first opened or clicked.
 */
async function firstDays(campaign: string, sentAt: Date) {
  const opened = new Array<number>(FIRST_DAYS).fill(0);
  const clicked = new Array<number>(FIRST_DAYS).fill(0);
  const start = Math.floor(sentAt.getTime() / 1000);
  try {
    const { results } = await env.DB.prepare(
      `SELECT 'o' AS k, CAST((opened_at - ?2) / 86400 AS INTEGER) AS d, COUNT(*) AS n FROM email_messages
         WHERE campaign = ?1 AND opened_at IS NOT NULL GROUP BY d
       UNION ALL
       SELECT 'c' AS k, CAST((clicked_at - ?2) / 86400 AS INTEGER) AS d, COUNT(*) AS n FROM email_messages
         WHERE campaign = ?1 AND clicked_at IS NOT NULL GROUP BY d`,
    )
      .bind(campaign, start)
      .all<{ k: string; d: number; n: number }>();
    for (const r of results) {
      const d = Math.min(FIRST_DAYS - 1, Math.max(0, Math.floor(Number(r.d))));
      (r.k === 'o' ? opened : clicked)[d]! += Number(r.n);
    }
  } catch (e) {
    console.error('[newsletter-report] first days', e);
  }
  return { opened, clicked };
}

/**
 * One newsletter in detail: its figures, the same figures for the 5 newsletters sent before it
 * (to compare with "the usual"), opens and clicks over its first days, and the pages opened.
 */
export async function loadOneNewsletter(id: number) {
  const [n] = await getDb().select().from(newsletters).where(eq(newsletters.id, id));
  if (!n || n.status !== 'sent' || !n.sentAt) return null;
  const sentAt = n.sentAt;
  const [kpis, earlier, days] = await Promise.all([
    newsletterKpis(id),
    sentBetween(new Date(0), sentAt),
    firstDays(campaignOf(id), sentAt),
  ]);
  const row: NewsletterRow = {
    id,
    subject: n.subject,
    slug: n.webPage ? n.slug : null,
    sentAt,
    recipients: n.sentCount,
    email: kpis.email,
    visits: kpis.visits,
    unsubscribed: kpis.unsubscribed,
  };
  const before = earlier.filter((x) => x.id !== id).slice(-5);
  const usual = before.length ? newsletterTotals(before) : null;
  return {
    newsletter: n,
    row,
    totals: newsletterTotals([row]),
    usual,
    usualCount: before.length,
    days,
    pages: kpis.pages,
  };
}
