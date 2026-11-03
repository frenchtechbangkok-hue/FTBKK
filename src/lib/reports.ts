import { env } from 'cloudflare:workers';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { getDb } from '../db';
import { auditLog, eventFeedback, events, members, registrations } from '../db/schema';
import { COVER_KINDS, type EventKind } from './event-covers';
import {
  eventDetail,
  eventReport,
  eventRows,
  KIND_LABELS,
  type StatRegistration,
} from './event-stats';
import { memberReports } from './member-reports';
import { emailProvider } from './email';
import {
  emailRecordSpan,
  emailsByProvider,
  emailsBySubject,
  emailTimeline,
  emailTotals,
  planUsage,
} from './email-metrics';
import { parsePeriod, periodBuckets } from './report-period';
import { getSettings } from './settings';
import { siteOrigin } from './site';
import { loadTraffic, oldestTraffic, type TrafficReport } from './traffic';

// Loads what the Reports tabs (and their CSV exports) need, with the filters in the URL.

const KINDS = [...COVER_KINDS, 'other'] as const;
export const kindOptions = KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }));

const earliestOf = (dates: (Date | null | undefined)[], now: Date) =>
  dates.reduce<Date>((min, d) => (d && d < min ? d : min), now);

export async function loadEventReport(url: URL, now = new Date()) {
  const db = getDb();
  const [eventList, regs, feedback, memberList] = await Promise.all([
    db
      .select({
        id: events.id,
        title: events.title,
        series: events.series,
        startsAt: events.startsAt,
        capacity: events.capacity,
        status: events.status,
      })
      .from(events),
    db
      .select({
        eventId: registrations.eventId,
        name: registrations.name,
        email: registrations.email,
        status: registrations.status,
        createdAt: registrations.createdAt,
        checkedInAt: registrations.checkedInAt,
        howHeard: registrations.howHeard,
        guests: registrations.guests,
        walkIn: registrations.walkIn,
        company: registrations.company,
        feedbackSentAt: registrations.feedbackSentAt,
      })
      .from(registrations) as Promise<StatRegistration[]>,
    db
      .select({
        eventId: eventFeedback.eventId,
        rating: eventFeedback.rating,
        comment: eventFeedback.comment,
        createdAt: eventFeedback.createdAt,
      })
      .from(eventFeedback),
    db
      .select({
        email: members.email,
        status: members.status,
        memberSince: members.memberSince,
        confirmedAt: members.confirmedAt,
        createdAt: members.createdAt,
      })
      .from(members),
  ]);
  const period = parsePeriod(
    url.searchParams,
    now,
    earliestOf(
      eventList.filter((e) => e.status !== 'draft').map((e) => e.startsAt),
      now,
    ),
  );
  const type = url.searchParams.get('type');
  const kind = (KINDS as readonly string[]).includes(type ?? '') ? (type as EventKind) : null;
  const rows = eventRows(eventList, regs, feedback, memberList, now);
  const report = eventReport(
    rows,
    regs,
    feedback,
    { period, previous: period.previous, kind },
    now,
  );
  const eventId = Number(url.searchParams.get('event')) || null;
  const row = eventId ? rows.find((r) => r.event.id === eventId) : undefined;
  return {
    now,
    period,
    kind,
    rows,
    report,
    detail: row ? eventDetail(row, rows, regs, feedback, now) : null,
    /** Lowercased emails of active members, to mark the regulars who are members. */
    activeMembers: new Set(
      memberList.filter((m) => m.status === 'active').map((m) => m.email.toLowerCase()),
    ),
  };
}

export async function loadMemberReport(url: URL, now = new Date()) {
  const db = getDb();
  const [memberRows, eventRowsList, regRows, feedbackRows, renewalRows] = await Promise.all([
    db
      .select({
        id: members.id,
        email: members.email,
        name: members.name,
        status: members.status,
        profileType: members.profileType,
        interests: members.interests,
        howHeard: members.howHeard,
        memberSince: members.memberSince,
        confirmedAt: members.confirmedAt,
        createdAt: members.createdAt,
        renewalDueAt: members.renewalDueAt,
      })
      .from(members),
    db
      .select({
        id: events.id,
        title: events.title,
        startsAt: events.startsAt,
        status: events.status,
      })
      .from(events),
    db
      .select({
        eventId: registrations.eventId,
        name: registrations.name,
        email: registrations.email,
        status: registrations.status,
      })
      .from(registrations),
    db
      .select({
        eventId: eventFeedback.eventId,
        email: registrations.email,
        rating: eventFeedback.rating,
      })
      .from(eventFeedback)
      .innerJoin(registrations, eq(registrations.id, eventFeedback.registrationId))
      .where(isNotNull(eventFeedback.rating)),
    // Years that ended (lapsed) or were renewed, from the actions log.
    db
      .select({ memberId: auditLog.entityId, action: auditLog.action, at: auditLog.at })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'member'),
          inArray(auditLog.action, ['member_lapsed', 'member_renew']),
        ),
      ),
  ]);
  const period = parsePeriod(
    url.searchParams,
    now,
    earliestOf(
      [
        ...memberRows.map((m) => m.confirmedAt ?? m.createdAt),
        ...eventRowsList.filter((e) => e.status !== 'draft').map((e) => e.startsAt),
      ],
      now,
    ),
  );
  return {
    now,
    period,
    report: memberReports(
      memberRows,
      eventRowsList,
      regRows,
      feedbackRows,
      period,
      period.previous,
      now,
      renewalRows
        .filter((x) => x.memberId !== null)
        .map((x) => ({
          memberId: x.memberId!,
          action: x.action as 'member_lapsed' | 'member_renew',
          at: x.at,
        })),
    ),
  };
}

/**
 * Reports > Website traffic, from Cloudflare. Without the API token, says so and the page shows how
 * to connect it; `beacon` is false while Settings has no Web Analytics token (nothing collected).
 */
/** Cloudflare access for the traffic figures (Reports > Website traffic and the dashboard). */
export function trafficConfig(token: string, beaconToken: string) {
  return {
    token,
    accountId: env.CF_ACCOUNT_ID ?? '',
    siteTag: env.CF_WEB_ANALYTICS_SITE_TAG ?? '',
    beaconToken,
    host: siteOrigin().host,
    script: 'ft-bkk-site',
  };
}

export async function loadTrafficReport(url: URL, now = new Date()) {
  const period = parsePeriod(url.searchParams, now, oldestTraffic(now));
  const settings = await getSettings();
  const beacon = !!settings.analyticsToken;
  const token = env.CF_ANALYTICS_TOKEN ?? '';
  let report: TrafficReport | null = null;
  let error: string | null = null;
  if (token) {
    try {
      report = await loadTraffic(trafficConfig(token, settings.analyticsToken), period, now);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return { period, beacon, connected: !!token, report, error };
}

/**
 * Reports > Emails, from the email_messages table filled by the providers' webhooks (Resend:
 * /api/resend-events; Amazon SES: /api/ses-events). Figures count the emails sent in the period.
 */
export async function loadEmailReport(url: URL, now = new Date()) {
  const provider = emailProvider();
  const setup = {
    provider,
    resendWebhook: !!env.RESEND_WEBHOOK_SECRET,
    sesEvents: !!env.SES_EVENTS_KEY && !!env.SES_CONFIGURATION_SET,
  };
  let span: { first: Date | null; last: Date | null } = { first: null, last: null };
  try {
    span = await emailRecordSpan();
  } catch (e) {
    // Before migration 0041 runs (a preview sharing the production database).
    return {
      period: parsePeriod(url.searchParams, now, now),
      setup,
      span,
      report: null,
      error: String(e),
    };
  }
  const period = parsePeriod(url.searchParams, now, span.first ?? now);
  const { unit, buckets } = periodBuckets(period);
  const [totals, previous, timeline, subjects, providers, usage] = await Promise.all([
    emailTotals(period),
    period.previous ? emailTotals(period.previous) : Promise.resolve(null),
    emailTimeline(period),
    emailsBySubject(period),
    emailsByProvider(period),
    planUsage(provider, now),
  ]);
  const series = (pick: (t: (typeof timeline)[number]) => boolean) =>
    buckets.map(
      (b) => timeline.filter((t) => pick(t) && t.sentAt >= b.from && t.sentAt < b.to).length,
    );
  return {
    period,
    setup,
    span,
    error: null,
    report: {
      totals,
      previous,
      unit,
      buckets,
      sentSeries: series((t) => t.sent),
      deliveredSeries: series((t) => t.delivered),
      openedSeries: series((t) => t.opened),
      clickedSeries: series((t) => t.clicked),
      subjects,
      providers,
      usage,
    },
  };
}
