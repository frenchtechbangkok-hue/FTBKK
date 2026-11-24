import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { getDb } from '../db';
import {
  auditLog,
  events,
  members,
  newsletters,
  organisations,
  posts,
  registrations,
  socialPosts,
  submissions,
} from '../db/schema';
import { moderationQueue } from './cron-directory';
import {
  EMAIL_TEMPLATES,
  applyTemplate,
  loadTemplateText,
  type EmailText,
} from './email-templates';
import { DAY_MS, MODERATION_TARGET_DAYS, ageDays, daysUntil } from './lifecycle';
import { newMemberLine, newMembersSince } from './members';
import { adminNotifyEmails, siteUrl } from './orgs';
import { sendEmail } from './email';
import { getSettings } from './settings';
import { TZ, formatDate, formatEventDate } from './format';

/**
 * The weekly summary to the team (Settings > General > Admin notifications), every Monday at
 * 9:00 Bangkok, also on a quiet week: what happened in the last 7 days, what is coming up in the
 * next 7, and what waits for the team. Settings > Weekly summary switches each part on or off;
 * Emails > Weekly summary edits the words around it.
 */

export const SUMMARY_KEY = 'admin.directory-digest';

export const SUMMARY_GROUPS = {
  week: 'This week',
  next: 'Coming up',
  todo: 'To do',
} as const;
type Group = keyof typeof SUMMARY_GROUPS;

/** The parts of the summary, in the order they show. Every part is on until switched off. */
export const SUMMARY_PARTS = [
  {
    key: 'new-members',
    group: 'week',
    label: 'New members',
    hint: 'Who joined, with their job, what describes them and how they heard of us.',
  },
  {
    key: 'registrations',
    group: 'week',
    label: 'Event registrations',
    hint: 'New registrations of the week, per upcoming event.',
  },
  {
    key: 'events-held',
    group: 'week',
    label: 'Events held',
    hint: 'Events of the past 7 days, with how many came.',
  },
  {
    key: 'posts-published',
    group: 'week',
    label: 'Blog posts published',
    hint: 'Posts that went online this week.',
  },
  {
    key: 'newsletters-sent',
    group: 'week',
    label: 'Newsletters sent',
    hint: 'Newsletters sent this week, with how many people got them.',
  },
  {
    key: 'messages',
    group: 'week',
    label: 'Messages received',
    hint: 'Contact form messages of the week (not spam).',
  },
  {
    key: 'listings',
    group: 'week',
    label: 'Ecosystem listings',
    hint: 'Listings added or published this week.',
  },
  {
    key: 'upcoming-events',
    group: 'next',
    label: 'Events in the next 7 days',
    hint: 'Date, registered and waiting list.',
  },
  {
    key: 'scheduled',
    group: 'next',
    label: 'Scheduled newsletters and social media posts',
    hint: 'What goes out in the next 7 days.',
  },
  {
    key: 'members-to-review',
    group: 'todo',
    label: 'Members to review',
    hint: 'How many are still in Members > To review.',
  },
  {
    key: 'unread-messages',
    group: 'todo',
    label: 'Messages to answer',
    hint: 'Messages still in New.',
  },
  {
    key: 'drafts',
    group: 'todo',
    label: 'Blog posts in draft',
    hint: 'Most recently edited first.',
  },
  {
    key: 'directory',
    group: 'todo',
    label: 'Directory to review',
    hint: "Listings, owner changes, claims and applications waiting, with the oldest one's age.",
  },
  {
    key: 'renewals',
    group: 'todo',
    label: 'Listing renewals due this month',
    hint: 'Including the unclaimed ones.',
  },
] as const satisfies readonly { key: string; group: Group; label: string; hint: string }[];
export type SummaryPart = (typeof SUMMARY_PARTS)[number]['key'];
export const SUMMARY_PART_KEYS = SUMMARY_PARTS.map((p) => p.key) as [SummaryPart, ...SummaryPart[]];

/** The parts switched on: everything unless Settings > Weekly summary turned some off. */
export const partsOn = (off: readonly string[]) =>
  new Set(SUMMARY_PART_KEYS.filter((k) => !off.includes(k)));

/** "no new member", "1 new member", "3 new members". */
export function count(n: number, one: string, many = `${one}s`) {
  return n ? `${n} ${n === 1 ? one : many}` : `no ${one}`;
}

export const newMembersCount = (n: number) => count(n, 'new member');

/** A text saved before {summary} existed gets it at the end, so the parts always show. */
export function withSummary<T extends Pick<EmailText, 'body'>>(text: T | null): T | null {
  return text && !text.body.includes('{summary}')
    ? { ...text, body: `${text.body}\n\n{summary}` }
    : text;
}

export interface EventLine {
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  newThisWeek: number;
  registered: number;
  waitlist: number;
  attended: number;
}

const when = (e: Pick<EventLine, 'startsAt' | 'endsAt'>) => formatEventDate(e.startsAt, e.endsAt);

export function registrationLine(e: EventLine) {
  return `${e.title} (${formatDate(e.startsAt, { year: undefined })}): ${e.newThisWeek} new, ${e.registered} registered in all.`;
}

export function upcomingLine(e: EventLine) {
  const parts = [`${e.registered} registered`];
  if (e.waitlist) parts.push(`${e.waitlist} on the waiting list`);
  return `${e.title}, ${when(e)}: ${parts.join(', ')}.`;
}

export function heldLine(e: EventLine) {
  return `${e.title}, ${when(e)}: ${e.attended} came of ${e.registered + e.attended} registered.`;
}

export function draftLine(p: { title: string; updatedAt: Date }) {
  return `${p.title} (last edited ${formatDate(p.updatedAt)}).`;
}

export function listingLine(o: { name: string; status: string; createdAt: Date }, since: Date) {
  const isNew = o.createdAt >= since;
  if (o.status === 'published') return `${o.name}: ${isNew ? 'added and published' : 'published'}.`;
  return `${o.name}: ${isNew ? 'added, ' : ''}${o.status === 'pending' ? 'waiting for review' : o.status}.`;
}

export const isMonday = (now: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now) === 'Mon';

const secs = (d: Date) => Math.floor(d.getTime() / 1000);

/** Every figure the summary can show, for the 7 days before `now` and the 7 days after. */
export async function weeklySummaryData(now: Date) {
  const db = getDb();
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const until = new Date(now.getTime() + 7 * DAY_MS);
  const [joined, toReview, q, evs, drafts, published, touched, messages, unread, sent, nl, social] =
    await Promise.all([
      newMembersSince(since, now),
      db
        .select({ n: sql<number>`count(*)` })
        .from(members)
        .where(and(eq(members.status, 'active'), isNull(members.reviewedAt))),
      moderationQueue(),
      db
        .select()
        .from(events)
        .where(and(eq(events.status, 'published'), gte(events.startsAt, since)))
        .orderBy(events.startsAt),
      db
        .select({ title: posts.title, updatedAt: posts.updatedAt })
        .from(posts)
        .where(eq(posts.status, 'draft'))
        .orderBy(desc(posts.updatedAt)),
      db
        .select({ title: posts.title, publishedAt: posts.publishedAt })
        .from(posts)
        .where(
          and(
            eq(posts.status, 'published'),
            gte(posts.publishedAt, since),
            lt(posts.publishedAt, now),
          ),
        )
        .orderBy(posts.publishedAt),
      db
        .select({ id: auditLog.entityId })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entity, 'organisation'),
            inArray(auditLog.action, ['approve', 'create']),
            gte(auditLog.at, since),
          ),
        ),
      db
        .select({ n: sql<number>`count(*)` })
        .from(submissions)
        .where(
          and(
            gte(submissions.createdAt, since),
            ne(submissions.status, 'spam'),
            ne(submissions.status, 'deleted'),
          ),
        ),
      db
        .select({ n: sql<number>`count(*)` })
        .from(submissions)
        .where(eq(submissions.status, 'new')),
      db
        .select({
          subject: newsletters.subject,
          sentAt: newsletters.sentAt,
          n: newsletters.sentCount,
        })
        .from(newsletters)
        .where(and(eq(newsletters.status, 'sent'), gte(newsletters.sentAt, since)))
        .orderBy(newsletters.sentAt),
      db
        .select({ subject: newsletters.subject, at: newsletters.scheduledAt })
        .from(newsletters)
        .where(
          and(
            eq(newsletters.status, 'scheduled'),
            gte(newsletters.scheduledAt, now),
            lt(newsletters.scheduledAt, until),
          ),
        )
        .orderBy(newsletters.scheduledAt),
      db
        .select({
          text: socialPosts.text,
          at: socialPosts.scheduledAt,
          networks: socialPosts.networks,
        })
        .from(socialPosts)
        .where(
          and(
            eq(socialPosts.status, 'scheduled'),
            gte(socialPosts.scheduledAt, now),
            lt(socialPosts.scheduledAt, until),
          ),
        )
        .orderBy(socialPosts.scheduledAt),
    ]);

  const regs = evs.length
    ? await db
        .select({
          eventId: registrations.eventId,
          status: registrations.status,
          fresh: sql<number>`sum(case when ${registrations.createdAt} >= ${secs(since)} then 1 else 0 end)`,
          n: sql<number>`count(*)`,
        })
        .from(registrations)
        .where(
          inArray(
            registrations.eventId,
            evs.map((e) => e.id),
          ),
        )
        .groupBy(registrations.eventId, registrations.status)
    : [];
  const lines: (EventLine & { past: boolean })[] = evs.map((e) => {
    const mine = regs.filter((r) => r.eventId === e.id && r.status !== 'cancelled');
    const of = (s: string) => mine.filter((r) => r.status === s).reduce((t, r) => t + r.n, 0);
    return {
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      past: e.startsAt < now,
      newThisWeek: mine.reduce((t, r) => t + (r.fresh ?? 0), 0),
      registered: of('registered'),
      waitlist: of('waitlist'),
      attended: of('attended'),
    };
  });

  const ids = [...new Set(touched.map((t) => t.id).filter((id): id is number => id != null))];
  const listings = await db
    .select({
      name: organisations.name,
      status: organisations.status,
      createdAt: organisations.createdAt,
    })
    .from(organisations)
    .where(
      and(
        inArray(organisations.status, ['pending', 'published']),
        ids.length
          ? sql`(${organisations.createdAt} >= ${secs(since)} OR ${inArray(organisations.id, ids)})`
          : gte(organisations.createdAt, since),
      ),
    )
    .orderBy(organisations.name);

  const ages = [
    ...q.pendingOrgs.map((o) => o.submittedAt ?? o.updatedAt),
    ...q.changes.map((c) => c.change.createdAt),
    ...q.pendingClaims.map((c) => c.claim.createdAt),
    ...q.applications.map((a) => a.app.createdAt),
  ].map((d) => ageDays(d, now));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const expiring = await db
    .select({
      name: organisations.name,
      renewalDueAt: organisations.renewalDueAt,
      owners: organisations.ownerEmails,
    })
    .from(organisations)
    .where(
      and(
        eq(organisations.status, 'published'),
        sql`${organisations.renewalDueAt} IS NOT NULL`,
        lt(organisations.renewalDueAt, monthEnd),
      ),
    );

  return {
    since,
    until,
    joined,
    toReview: Number(toReview[0]?.n ?? 0),
    queue: q,
    ages,
    held: lines.filter((e) => e.past),
    upcoming: lines.filter((e) => !e.past),
    drafts,
    published,
    listings,
    messages: Number(messages[0]?.n ?? 0),
    unread: Number(unread[0]?.n ?? 0),
    sent,
    scheduledNewsletters: nl,
    scheduledSocial: social,
    expiring,
  };
}
export type SummaryData = Awaited<ReturnType<typeof weeklySummaryData>>;

const short = (d: Date) =>
  formatDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: undefined });

/** One part as paragraphs: a first line with its figure, then one line per item. */
export function partLines(key: SummaryPart, d: SummaryData, now: Date): string[] {
  switch (key) {
    case 'new-members':
      return [
        `New members: ${d.joined.length || 'none'}.`,
        ...d.joined.slice(0, 50).map(newMemberLine),
      ];
    case 'registrations': {
      const fresh = d.upcoming.filter((e) => e.newThisWeek);
      const n = fresh.reduce((t, e) => t + e.newThisWeek, 0);
      return [
        `Event registrations: ${count(n, 'new registration')}.`,
        ...fresh.map(registrationLine),
      ];
    }
    case 'events-held':
      return d.held.length ? ['Events held:', ...d.held.map(heldLine)] : ['Events held: none.'];
    case 'posts-published':
      return d.published.length
        ? [
            'Blog posts published:',
            ...d.published.map((p) => `${p.title} (${p.publishedAt ? short(p.publishedAt) : ''}).`),
          ]
        : ['Blog posts published: none.'];
    case 'newsletters-sent':
      return d.sent.length
        ? [
            'Newsletters sent:',
            ...d.sent.map(
              (n) => `${n.subject}, ${n.sentAt ? short(n.sentAt) : ''}, to ${n.n} people.`,
            ),
          ]
        : ['Newsletters sent: none.'];
    case 'messages':
      return [`Messages received: ${d.messages || 'none'}.`];
    case 'listings':
      return d.listings.length
        ? [
            'Ecosystem listings added or published:',
            ...d.listings.slice(0, 30).map((o) => listingLine(o, d.since)),
          ]
        : ['Ecosystem listings added or published: none.'];
    case 'upcoming-events': {
      const soon = d.upcoming.filter((e) => e.startsAt < d.until);
      return soon.length
        ? ['Events in the next 7 days:', ...soon.map(upcomingLine)]
        : ['Events in the next 7 days: none.'];
    }
    case 'scheduled': {
      const items = [
        ...d.scheduledNewsletters.map((n) => ({
          at: n.at!,
          line: `Newsletter "${n.subject}", ${short(n.at!)}.`,
        })),
        ...d.scheduledSocial.map((p) => ({
          at: p.at,
          line: `Social media post on ${p.networks.join(', ') || 'social media'}, ${short(p.at)}: ${p.text.length > 80 ? `${p.text.slice(0, 77)}...` : p.text}`,
        })),
      ].sort((a, b) => a.at.getTime() - b.at.getTime());
      return items.length
        ? ['Scheduled to go out:', ...items.map((i) => i.line)]
        : ['Scheduled newsletters and social media posts: none.'];
    }
    case 'members-to-review':
      return [`Members to review: ${d.toReview || 'none'}.`];
    case 'unread-messages':
      return [`Messages to answer: ${d.unread || 'none'}.`];
    case 'drafts':
      return d.drafts.length
        ? [`Blog posts in draft: ${d.drafts.length}.`, ...d.drafts.slice(0, 20).map(draftLine)]
        : ['Blog posts in draft: none.'];
    case 'directory': {
      const total = d.ages.length;
      if (!total) return ['Directory to review: nothing waiting.'];
      const oldest = Math.max(...d.ages);
      const q = d.queue;
      const kinds = [
        [q.pendingOrgs.length, 'new listing'],
        [q.changes.length, 'owner change'],
        [q.pendingClaims.length, 'claim'],
        [q.applications.length, 'membership application'],
      ] as const;
      return [
        `Directory to review: ${kinds
          .filter(([n]) => n)
          .map(([n, w]) => count(n, w))
          .join(
            ', ',
          )}; oldest ${oldest} days${oldest > MODERATION_TARGET_DAYS ? `, over the ${MODERATION_TARGET_DAYS}-day target` : ''}.`,
      ];
    }
    case 'renewals':
      return d.expiring.length
        ? [
            `Listing renewals due this month: ${d.expiring.length}.`,
            ...d.expiring
              .slice(0, 20)
              .map(
                (o) =>
                  `${o.name}, ${o.renewalDueAt ? formatDate(o.renewalDueAt) : ''}${o.owners.length ? '' : ' (unclaimed, invite someone to claim it)'}${o.renewalDueAt && daysUntil(o.renewalDueAt, now) < 0 ? ' (overdue)' : ''}`,
              ),
          ]
        : ['Listing renewals due this month: none.'];
  }
}

/** The whole {summary}: each group's heading, then its parts that are switched on. */
export function summaryLines(d: SummaryData, on: Set<SummaryPart>, now: Date): string[] {
  const out: string[] = [];
  for (const [group, heading] of Object.entries(SUMMARY_GROUPS) as [Group, string][]) {
    const parts = SUMMARY_PARTS.filter((p) => p.group === group && on.has(p.key));
    if (!parts.length) continue;
    const label =
      group === 'week'
        ? `${heading} (${short(d.since)} to ${short(new Date(now.getTime() - 1))})`
        : group === 'next'
          ? `${heading} (to ${short(new Date(d.until.getTime() - 1))})`
          : heading;
    out.push(label.toUpperCase());
    for (const p of parts) out.push(...partLines(p.key, d, now));
  }
  return out;
}

/** The figures in the subject, e.g. "2 new members, 14 new registrations, 6 things to do". */
export function summaryCounts(d: SummaryData) {
  const regs = d.upcoming.reduce((t, e) => t + e.newThisWeek, 0);
  const todo = d.toReview + d.unread + d.drafts.length + d.ages.length;
  return {
    members: newMembersCount(d.joined.length),
    registrations: count(regs, 'new registration'),
    todo: count(todo, 'thing to do', 'things to do'),
  };
}

/** Sends the summary to the Admin notifications addresses. Always sends. */
export async function sendWeeklySummary(now: Date) {
  const [d, settings, text] = await Promise.all([
    weeklySummaryData(now),
    getSettings(),
    loadTemplateText(SUMMARY_KEY),
  ]);
  const on = partsOn(settings.weeklySummaryOff ?? []);
  const w = applyTemplate(EMAIL_TEMPLATES[SUMMARY_KEY], withSummary(text), {
    ...summaryCounts(d),
    week: `${short(d.since)} to ${short(new Date(now.getTime() - 1))}`,
    summary: summaryLines(d, on, now),
  });
  await sendEmail({
    to: await adminNotifyEmails(settings),
    subject: w.subject,
    campaign: w.campaign,
    paragraphs: w.paragraphs,
    bodyHtml: w.bodyHtml,
    action: { label: w.buttonLabel, url: siteUrl('/admin') },
  });
  return 'sent';
}
