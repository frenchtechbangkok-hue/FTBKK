import { env } from 'cloudflare:workers';
import type { EmailEvent, EmailEventKind } from './email-events';
import { providerLimits } from './email';

/**
 * The email_messages table behind Reports > Emails: each provider event fills in the first time
 * a step happened for that email, so a retried or repeated event (a second open) changes nothing.
 */

const COLUMN: Partial<Record<EmailEventKind, string>> = {
  delivered: 'delivered_at',
  delayed: 'delayed_at',
  bounced: 'bounced_at',
  complained: 'complained_at',
  opened: 'opened_at',
  clicked: 'clicked_at',
  failed: 'failed_at',
};

const secs = (d: Date) => Math.floor(d.getTime() / 1000);

export async function recordEmailEvent(e: EmailEvent) {
  const col = COLUMN[e.kind];
  // A permanent bounce wins over an earlier temporary one for the same email.
  const bounce = e.bounceType ?? null;
  await env.DB.prepare(
    `INSERT INTO email_messages (provider, message_id, subject, recipients, sent_at, bounce_type${col ? `, ${col}` : ''})
     VALUES (?1, ?2, ?3, ?4, ?5, ?6${col ? ', ?7' : ''})
     ON CONFLICT (provider, message_id) DO UPDATE SET
       subject = COALESCE(email_messages.subject, excluded.subject),
       recipients = MAX(email_messages.recipients, excluded.recipients),
       sent_at = MIN(email_messages.sent_at, excluded.sent_at),
       bounce_type = CASE WHEN excluded.bounce_type = 'permanent' THEN 'permanent'
         ELSE COALESCE(email_messages.bounce_type, excluded.bounce_type) END,
       ${col ? `${col} = COALESCE(email_messages.${col}, excluded.${col}),` : ''}
       updated_at = unixepoch()`,
  )
    .bind(
      e.provider,
      e.messageId,
      e.subject,
      e.recipients,
      secs(e.sentAt),
      bounce,
      ...(col ? [secs(e.at)] : []),
    )
    .run();
}

export interface EmailTotals {
  /** Emails that went out (not counting the ones the provider refused). */
  sent: number;
  delivered: number;
  bounced: number;
  permanentBounces: number;
  delayed: number;
  complained: number;
  opened: number;
  clicked: number;
  failed: number;
}

const TOTALS = `
  COUNT(*) - COUNT(failed_at) AS sent,
  COUNT(delivered_at) AS delivered,
  COUNT(bounced_at) AS bounced,
  SUM(CASE WHEN bounce_type = 'permanent' THEN 1 ELSE 0 END) AS permanentBounces,
  COUNT(delayed_at) AS delayed,
  COUNT(complained_at) AS complained,
  COUNT(opened_at) AS opened,
  COUNT(clicked_at) AS clicked,
  COUNT(failed_at) AS failed`;

const asTotals = (r: Record<string, unknown> | null): EmailTotals => {
  const n = (k: string) => Number(r?.[k] ?? 0) || 0;
  return {
    sent: n('sent'),
    delivered: n('delivered'),
    bounced: n('bounced'),
    permanentBounces: n('permanentBounces'),
    delayed: n('delayed'),
    complained: n('complained'),
    opened: n('opened'),
    clicked: n('clicked'),
    failed: n('failed'),
  };
};

export async function emailTotals(range: { from: Date; to: Date }) {
  const row = await env.DB.prepare(
    `SELECT ${TOTALS} FROM email_messages WHERE sent_at >= ?1 AND sent_at < ?2`,
  )
    .bind(secs(range.from), secs(range.to))
    .first();
  return asTotals(row);
}

/** One row per email sent in the range: its send time and which steps happened, for charts. */
export async function emailTimeline(range: { from: Date; to: Date }) {
  const { results } = await env.DB.prepare(
    `SELECT sent_at AS sentAt, failed_at IS NULL AS sent, delivered_at IS NOT NULL AS delivered,
       opened_at IS NOT NULL AS opened, clicked_at IS NOT NULL AS clicked
     FROM email_messages WHERE sent_at >= ?1 AND sent_at < ?2`,
  )
    .bind(secs(range.from), secs(range.to))
    .all<{ sentAt: number; sent: number; delivered: number; opened: number; clicked: number }>();
  return results.map((r) => ({
    sentAt: new Date(r.sentAt * 1000),
    sent: !!r.sent,
    delivered: !!r.delivered,
    opened: !!r.opened,
    clicked: !!r.clicked,
  }));
}

/** The figures per subject (one community email, one event's reminders…), most sent first. */
export async function emailsBySubject(range: { from: Date; to: Date }, limit = 25) {
  const { results } = await env.DB.prepare(
    `SELECT COALESCE(subject, '(no subject)') AS subject, MIN(sent_at) AS firstSent, ${TOTALS}
     FROM email_messages WHERE sent_at >= ?1 AND sent_at < ?2
     GROUP BY COALESCE(subject, '(no subject)') ORDER BY sent DESC, firstSent DESC LIMIT ?3`,
  )
    .bind(secs(range.from), secs(range.to), limit)
    .all<Record<string, unknown>>();
  return results.map((r) => ({
    subject: String(r.subject),
    firstSent: new Date(Number(r.firstSent) * 1000),
    ...asTotals(r),
  }));
}

/** Emails per provider in the range (both show while switching from Resend to SES). */
export async function emailsByProvider(range: { from: Date; to: Date }) {
  const { results } = await env.DB.prepare(
    `SELECT provider, COUNT(*) - COUNT(failed_at) AS sent FROM email_messages
     WHERE sent_at >= ?1 AND sent_at < ?2 GROUP BY provider ORDER BY sent DESC`,
  )
    .bind(secs(range.from), secs(range.to))
    .all<{ provider: 'resend' | 'ses'; sent: number }>();
  return results;
}

/** The first email recorded (where All time starts) and the last event received, or null. */
export async function emailRecordSpan() {
  const row = await env.DB.prepare(
    'SELECT MIN(sent_at) AS first, MAX(updated_at) AS last FROM email_messages',
  ).first<{ first: number | null; last: number | null }>();
  return {
    first: row?.first ? new Date(row.first * 1000) : null,
    last: row?.last ? new Date(row.last * 1000) : null,
  };
}

/**
 * Plan usage for Reports > Emails: emails the current provider sent today and this month (UTC
 * days and months, as Resend counts), each recipient counting once, against EMAIL_DAILY_LIMIT and
 * EMAIL_MONTHLY_LIMIT. Only what the webhook reported is counted, so `since` says when counting
 * started when that is after the start of the month.
 */
export async function planUsage(provider: 'resend' | 'ses', now = new Date()) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const row = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN sent_at >= ?2 THEN recipients ELSE 0 END), 0) AS today,
       COALESCE(SUM(recipients), 0) AS month,
       MIN(sent_at) AS first
     FROM email_messages WHERE provider = ?1 AND failed_at IS NULL AND sent_at >= ?3`,
  )
    .bind(provider, secs(day), secs(month))
    .first<{ today: number; month: number; first: number | null }>();
  const span = await env.DB.prepare(
    'SELECT MIN(sent_at) AS first FROM email_messages WHERE provider = ?1',
  )
    .bind(provider)
    .first<{ first: number | null }>();
  const first = span?.first ? new Date(span.first * 1000) : null;
  return {
    today: Number(row?.today ?? 0),
    month: Number(row?.month ?? 0),
    dailyLimit: providerLimits(provider).daily,
    monthlyLimit: providerLimits(provider).monthly,
    /** Counting started after the start of this month: the month figure is too low. */
    since: first && first > month ? first : null,
    /** When today's and this month's counts start again. */
    dayResets: new Date(day.getTime() + 86_400_000),
    monthResets: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/**
 * Delivered, opened and clicked for each community email sent (Email the community > Sent): the
 * emails with the same subject sent within 3 hours of it. Null where nothing was recorded (sent
 * before the delivery reports started, or the provider never reported).
 */
export async function sendFigures(sends: { subject: string; at: Date }[]) {
  if (!sends.length) return [];
  try {
    const stmt = env.DB.prepare(
      `SELECT ${TOTALS} FROM email_messages
       WHERE subject = ?1 AND sent_at >= ?2 AND sent_at < ?3`,
    );
    const rows = await env.DB.batch(
      sends.map((s) => stmt.bind(s.subject, secs(s.at) - 600, secs(s.at) + 3 * 3600)),
    );
    return rows.map((r) => {
      const t = asTotals((r.results?.[0] as Record<string, unknown>) ?? null);
      return t.sent ? t : null;
    });
  } catch {
    // Before migration 0041 (a preview sharing the production database): no figures.
    return sends.map(() => null);
  }
}
