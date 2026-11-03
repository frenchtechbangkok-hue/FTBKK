/**
 * Admin dashboard (/admin): the greeting, "Waiting for you", "Last 7 days" and "Latest activity".
 * The pure helpers are tested in test/dashboard.test.ts; the loaders read D1. Website visits come
 * from Cloudflare through /api/admin/dashboard-traffic, loaded after the page opens.
 */
import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { getDb } from '../db';
import {
  events,
  members,
  organisations,
  registrations,
  socialPosts,
  submissions,
} from '../db/schema';
import { DAY_MS } from './lifecycle';
import { guestsLabel } from './registrations';
import { TZ } from './format';

const OFFSET = 7 * 3600_000; // Asia/Bangkok, no daylight saving.
const bkkMidnight = (d: Date) => {
  const b = new Date(d.getTime() + OFFSET);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - OFFSET);
};

export interface Day {
  from: Date;
  to: Date;
}

/** The last 7 days (today included, Bangkok days), the 7 before, and one bucket per day. */
export function weekWindow(now: Date) {
  const today = bkkMidnight(now);
  const from = new Date(today.getTime() - 6 * DAY_MS);
  const days: Day[] = Array.from({ length: 7 }, (_, i) => ({
    from: new Date(from.getTime() + i * DAY_MS),
    to: new Date(from.getTime() + (i + 1) * DAY_MS),
  }));
  return {
    from,
    to: now,
    previous: { from: new Date(from.getTime() - 7 * DAY_MS), to: from },
    days,
  };
}

/** "Good morning" before noon, "Good afternoon" until 6 pm, then "Good evening" (Bangkok time). */
export function greeting(now: Date) {
  const h = new Date(now.getTime() + OFFSET).getUTCHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** First name from a full name ("Eric Delattre" -> "Eric"), or null. */
export const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

/** "today", "tomorrow", "in 9 days" (Bangkok days); "now" once it has started. */
export function daysUntil(startsAt: Date, now: Date) {
  if (startsAt <= now) return 'now';
  const n = Math.round((bkkMidnight(startsAt).getTime() - bkkMidnight(now).getTime()) / DAY_MS);
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
}

/** The change from the previous 7 days, in words; null when there is nothing to compare. */
export function weekChange(
  current: number,
  previous: number | null,
): { text: string; tone: 'up' | 'down' | 'same' } | null {
  if (previous === null) return null;
  if (current === previous) return { text: 'Same as the week before', tone: 'same' };
  const up = current > previous;
  const diff = Math.abs(current - previous);
  // A percentage only means something on a reasonable base.
  const amount = previous >= 20 ? `${Math.round((diff / previous) * 100)}%` : String(diff);
  return { text: `${up ? '+' : '−'}${amount} vs the week before`, tone: up ? 'up' : 'down' };
}

/** Counts per day bucket. */
export function dailySeries(dates: (Date | null)[], days: Day[]) {
  return days.map((d) => dates.filter((t) => t && t >= d.from && t < d.to).length);
}

/** SVG polyline points for a small sparkline, 0 at the bottom. */
export function sparkPoints(series: number[], width = 120, height = 28) {
  if (series.length < 2) return '';
  const max = Math.max(1, ...series);
  const step = width / (series.length - 1);
  return series
    .map((v, i) => `${Math.round(i * step)},${Math.round(height - 2 - (v / max) * (height - 4))}`)
    .join(' ');
}

export interface WaitingCounts {
  directory: number;
  /** Age in days of the oldest item in the directory queue. */
  directoryOldest: number;
  directoryLate: boolean;
  messages: number;
  members: number;
  socialFailed: number;
  renewals: number;
  drafts: number;
}

export interface WaitingItem {
  count: number;
  label: string;
  note?: string;
  noteAlert?: boolean;
  href: string;
  action: string;
  /** "now" needs a decision; "soon" can wait a little. */
  tone: 'now' | 'soon';
}

const s = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Only what is waiting, most urgent first. Empty = all clear. */
export function waitingItems(c: WaitingCounts): WaitingItem[] {
  const items: (WaitingItem | false)[] = [
    c.directory > 0 && {
      count: c.directory,
      label: `${s(c.directory, 'Listing')} to review in the directory`,
      note: `oldest ${c.directoryOldest} ${s(c.directoryOldest, 'day')}`,
      noteAlert: c.directoryLate,
      href: '/admin/ecosystem',
      action: 'Review',
      tone: 'now',
    },
    c.messages > 0 && {
      count: c.messages,
      label: `Unread ${s(c.messages, 'message')}`,
      href: '/admin/submissions',
      action: 'Read',
      tone: 'now',
    },
    c.members > 0 && {
      count: c.members,
      label: `New ${s(c.members, 'member')} to review`,
      href: '/admin/members',
      action: 'See members',
      tone: 'now',
    },
    c.socialFailed > 0 && {
      count: c.socialFailed,
      label: `Social media ${s(c.socialFailed, 'post')} failed to publish`,
      note: 'last 14 days',
      href: '/admin/social',
      action: 'See posts',
      tone: 'soon',
    },
    c.renewals > 0 && {
      count: c.renewals,
      label: `${s(c.renewals, 'Listing')} to renew in the next 30 days`,
      href: '/admin/ecosystem?tab=renewals',
      action: 'See renewals',
      tone: 'soon',
    },
    c.drafts > 0 && {
      count: c.drafts,
      label: `Draft ${s(c.drafts, 'post')} not published yet`,
      href: '/admin/posts',
      action: 'See posts',
      tone: 'soon',
    },
  ];
  return items.filter((i): i is WaitingItem => !!i);
}

/** Registrations and new members over the last 7 days, the 7 before, and per day. */
export async function loadWeek(now: Date) {
  const db = getDb();
  const w = weekWindow(now);
  const [regs, joined] = await Promise.all([
    db
      .select({ at: registrations.createdAt })
      .from(registrations)
      .where(
        and(
          gte(registrations.createdAt, w.previous.from),
          inArray(registrations.status, ['registered', 'waitlist', 'attended']),
        ),
      ),
    db
      .select({ at: members.confirmedAt })
      .from(members)
      .where(
        and(
          gte(members.confirmedAt, w.previous.from),
          inArray(members.status, ['active', 'lapsed', 'suspended']),
        ),
      ),
  ]);
  const figure = (dates: (Date | null)[]) => ({
    total: dates.filter((d) => d && d >= w.from).length,
    previous: dates.filter((d) => d && d < w.from).length,
    series: dailySeries(dates, w.days),
  });
  return { registrations: figure(regs.map((r) => r.at)), members: figure(joined.map((m) => m.at)) };
}

/** Failed social media posts in the last 14 days. */
export async function failedSocialPosts(now: Date) {
  const rows = await getDb()
    .select({ id: socialPosts.id })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.status, 'failed'),
        gte(socialPosts.scheduledAt, new Date(now.getTime() - 14 * DAY_MS)),
      ),
    );
  return rows.length;
}

export interface Activity {
  at: Date;
  kind: 'registration' | 'member' | 'listing' | 'message';
  text: string;
  href: string;
}

/** The latest registrations, new members, submitted listings and messages, newest first. */
export async function loadActivity(limit = 6): Promise<Activity[]> {
  const db = getDb();
  const [regs, joined, listings, messages] = await Promise.all([
    db
      .select({
        at: registrations.createdAt,
        name: registrations.name,
        status: registrations.status,
        guests: registrations.guests,
        eventId: events.id,
        event: events.title,
      })
      .from(registrations)
      .innerJoin(events, eq(registrations.eventId, events.id))
      .where(inArray(registrations.status, ['registered', 'waitlist', 'attended']))
      .orderBy(desc(registrations.createdAt))
      .limit(limit),
    db
      .select({ at: members.confirmedAt, name: members.name })
      .from(members)
      .where(and(isNotNull(members.confirmedAt), eq(members.status, 'active')))
      .orderBy(desc(members.confirmedAt))
      .limit(limit),
    db
      .select({ at: organisations.submittedAt, name: organisations.name, id: organisations.id })
      .from(organisations)
      .where(isNotNull(organisations.submittedAt))
      .orderBy(desc(organisations.submittedAt))
      .limit(limit),
    db
      .select({ at: submissions.createdAt, payload: submissions.payload })
      .from(submissions)
      .where(inArray(submissions.status, ['new', 'answered', 'handled']))
      .orderBy(desc(submissions.createdAt))
      .limit(limit),
  ]);
  const all: Activity[] = [
    ...regs.map((r) => ({
      at: r.at,
      kind: 'registration' as const,
      text: `${r.name} ${r.status === 'waitlist' ? 'joined the waitlist for' : 'registered for'} ${r.event}${r.guests ? ` (${guestsLabel(r.guests)})` : ''}`,
      href: `/admin/registrations?event=${r.eventId}`,
    })),
    ...joined.map((m) => ({
      at: m.at!,
      kind: 'member' as const,
      text: `${m.name} joined as a member`,
      href: '/admin/members?tab=all',
    })),
    ...listings.map((o) => ({
      at: o.at!,
      kind: 'listing' as const,
      text: `Listing submitted: ${o.name}`,
      href: `/admin/ecosystem/${o.id}`,
    })),
    ...messages.map((m) => {
      const name = typeof m.payload.name === 'string' ? m.payload.name.trim() : '';
      return {
        at: m.at,
        kind: 'message' as const,
        text: name ? `Message from ${name}` : 'Message from the contact form',
        href: '/admin/submissions',
      };
    }),
  ];
  return all.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

const timeOfDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
});
const shortDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
});

/** "5 min ago", "2 h ago", "yesterday 14:05", "28 Oct". */
export function ago(at: Date, now: Date) {
  const min = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const days = Math.round((bkkMidnight(now).getTime() - bkkMidnight(at).getTime()) / DAY_MS);
  if (days === 0) return `${Math.floor(min / 60)} h ago`;
  if (days === 1) return `yesterday ${timeOfDay.format(at)}`;
  return shortDate.format(at);
}

/** Members whose email is the admin's: used for the first name in the greeting. */
export async function adminFirstName(email: string | undefined) {
  if (!email) return null;
  const [m] = await getDb()
    .select({ name: members.name })
    .from(members)
    .where(eq(members.email, email.toLowerCase()))
    .limit(1);
  return firstName(m?.name);
}
