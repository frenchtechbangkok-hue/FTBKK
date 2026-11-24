/**
 * The Monday digest for the team (09:00 Bangkok, src/lib/cron.ts): what happened last week, what
 * is coming this week, and what waits for someone. The wording and the sections are the
 * "Weekly digest" email in Emails > Automatic emails: each section is a list placeholder, so
 * removing {lastWeek}, {comingWeek} or {pending} from the message leaves that section out.
 * The pure part (digestVars) is tested in test/weekly-digest.test.ts; the loader reads D1.
 */
import { and, count, eq, gte, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { getDb } from '../db';
import {
  communityEmails,
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
import { type WaitingCounts, bkkMidnight, failedSocialPosts, waitingItems } from './dashboard';
import { type EmailMessage, sendEmail } from './email';
import {
  EMAIL_TEMPLATES,
  type EmailText,
  applyTemplate,
  loadTemplateText,
} from './email-templates';
import { TZ, formatDate, formatEventDate } from './format';
import { DAY_MS, MODERATION_TARGET_DAYS, ageDays } from './lifecycle';
import { adminNotifyEmails, siteUrl } from './orgs';
import { registrationCount } from './registrations';

export interface DigestEvent {
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  status: 'draft' | 'published' | 'cancelled';
  capacity: number | null;
  noRegistration: boolean;
  /** Seats taken (registered or attended, guests included). */
  registered: number;
  attended: number;
  waitlist: number;
}

export interface DigestData {
  /** Last week: Monday 00:00 to Monday 00:00, Bangkok time. */
  from: Date;
  to: Date;
  /** The coming week ends here (to + 7 days). */
  until: Date;
  // Last week
  heldEvents: DigestEvent[];
  registrations: number;
  newMembers: number;
  listingsSubmitted: number;
  postsPublished: string[];
  messages: number;
  newslettersSent: { subject: string; recipients: number }[];
  communityEmails: { subject: string; recipients: number }[];
  socialSent: number;
  // Coming week
  upcomingEvents: DigestEvent[];
  newslettersScheduled: { subject: string; scheduledAt: Date }[];
  socialScheduled: number;
  listingRenewals: { name: string; renewalDueAt: Date; claimed: boolean }[];
  memberRenewals: number;
  // To do
  waiting: WaitingCounts;
}

const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const people = (n: number) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? 'recipient' : 'recipients'}`;
const day = (d: Date) => formatDate(d, { year: undefined });

/** "16–22 November", "28 November – 4 December" (the last day is the day before `to`). */
export function weekLabel(from: Date, to: Date) {
  const last = new Date(to.getTime() - DAY_MS);
  const a = formatDate(from, { year: undefined, month: undefined });
  const sameMonth =
    formatDate(from, { day: undefined, year: undefined }) ===
    formatDate(last, { day: undefined, year: undefined });
  return sameMonth ? `${a}–${day(last)}` : `${day(from)} – ${day(last)}`;
}

/** The digest goes out on Mondays (Bangkok time). */
export const isDigestDay = (now: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now) === 'Mon';

/** The week windows of the digest sent at `now`: the last full week and the coming one. */
export function digestWindow(now: Date) {
  const to = bkkMidnight(now);
  return {
    from: new Date(to.getTime() - 7 * DAY_MS),
    to,
    until: new Date(to.getTime() + 7 * DAY_MS),
  };
}

function seats(e: DigestEvent) {
  if (e.noRegistration) return 'no registration';
  const taken = e.capacity
    ? `${e.registered}/${e.capacity} seats taken`
    : s(e.registered, 'registration');
  return e.waitlist ? `${taken}, ${e.waitlist} on the waitlist` : taken;
}

/** The placeholder values of the digest email. */
export function digestVars(d: DigestData) {
  const lastWeek: string[] = [
    ...d.heldEvents.map((e) =>
      e.status === 'cancelled'
        ? `Event cancelled: ${e.title}`
        : `Event: ${e.title}, ${e.noRegistration ? 'no registration' : `${e.attended} checked in of ${s(e.registered, 'registration')}`}`,
    ),
    d.registrations > 0 && `${s(d.registrations, 'new event registration')}`,
    d.newMembers > 0 && `${s(d.newMembers, 'new member')}`,
    ...d.postsPublished.map((t) => `Blog post published: ${t}`),
    ...d.newslettersSent.map((n) => `Newsletter sent: ${n.subject} (${people(n.recipients)})`),
    ...d.communityEmails.map(
      (n) => `Email to the community: ${n.subject} (${people(n.recipients)})`,
    ),
    d.socialSent > 0 && `${s(d.socialSent, 'social media post')} published`,
    d.listingsSubmitted > 0 && `${s(d.listingsSubmitted, 'directory listing')} submitted`,
    d.messages > 0 && `${s(d.messages, 'message')} from the contact form`,
  ].filter((x): x is string => !!x);

  const comingWeek: string[] = [
    ...d.upcomingEvents.map((e) =>
      e.status === 'draft'
        ? `Event not published yet: ${e.title}, ${formatEventDate(e.startsAt, e.endsAt)}`
        : `Event: ${e.title}, ${formatEventDate(e.startsAt, e.endsAt)} (${seats(e)})`,
    ),
    ...d.newslettersScheduled.map(
      (n) => `Newsletter scheduled: ${n.subject}, ${day(n.scheduledAt)}`,
    ),
    d.socialScheduled > 0 && `${s(d.socialScheduled, 'social media post')} scheduled`,
    ...d.listingRenewals.map(
      (o) =>
        `Listing renewal due: ${o.name}, ${day(o.renewalDueAt)}${o.claimed ? '' : ' (unclaimed, invite someone to claim it)'}`,
    ),
    d.memberRenewals > 0 && `${s(d.memberRenewals, 'membership')} to renew`,
  ].filter((x): x is string => !!x);

  const todo = waitingItems(d.waiting);
  const pending = todo.map(
    (i) => `${i.count} ${i.label.toLowerCase()}${i.note ? ` (${i.note})` : ''}`,
  );
  const tasks = todo.reduce((n, i) => n + i.count, 0);

  return {
    week: weekLabel(d.from, d.to),
    next: weekLabel(d.to, d.until),
    todo: tasks ? s(tasks, 'thing') + ' to do' : 'nothing to do',
    lastWeek: lastWeek.length ? lastWeek : ['A quiet week: nothing new.'],
    comingWeek: comingWeek.length ? comingWeek : ['Nothing planned yet.'],
    pending: pending.length ? pending : ['Nothing waiting, all clear.'],
  };
}

// ---------- database ----------

const eventFields = {
  title: events.title,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  status: events.status,
  capacity: events.capacity,
  noRegistration: events.noRegistration,
  registered: registrationCount(['registered', 'attended']),
  attended: registrationCount(['attended']),
  waitlist: registrationCount(['waitlist']),
};

/** What the dashboard's "Waiting for you" shows, counted now. */
export async function loadWaitingCounts(now: Date): Promise<WaitingCounts> {
  const db = getDb();
  const [queue, [drafts], [unread], [renewSoon], [unreviewed], socialFailed] = await Promise.all([
    moderationQueue(),
    db.select({ n: count() }).from(posts).where(eq(posts.status, 'draft')),
    db.select({ n: count() }).from(submissions).where(eq(submissions.status, 'new')),
    db
      .select({ n: count() })
      .from(organisations)
      .where(
        and(
          eq(organisations.status, 'published'),
          lt(organisations.renewalDueAt, new Date(now.getTime() + 30 * DAY_MS)),
        ),
      ),
    db
      .select({ n: count() })
      .from(members)
      .where(and(eq(members.status, 'active'), isNull(members.reviewedAt))),
    failedSocialPosts(now),
  ]);
  const ages = [
    ...queue.pendingOrgs.map((o) => o.submittedAt ?? o.updatedAt),
    ...queue.changes.map((c) => c.change.createdAt),
    ...queue.pendingClaims.map((c) => c.claim.createdAt),
    ...queue.applications.map((a) => a.app.createdAt),
  ].map((d) => ageDays(d, now));
  const oldest = ages.length ? Math.max(...ages) : 0;
  return {
    directory: ages.length,
    directoryOldest: oldest,
    directoryLate: oldest > MODERATION_TARGET_DAYS,
    messages: unread!.n,
    members: unreviewed!.n,
    socialFailed,
    renewals: renewSoon!.n,
    drafts: drafts!.n,
  };
}

const inWeek = (col: Parameters<typeof gte>[0], from: Date, to: Date) =>
  and(gte(col, from), lt(col, to));

export async function loadDigestData(now: Date): Promise<DigestData> {
  const db = getDb();
  const { from, to, until } = digestWindow(now);
  const [
    heldEvents,
    [regs],
    [joined],
    [listings],
    published,
    [messages],
    sentNewsletters,
    sentEmails,
    [social],
    upcomingEvents,
    scheduledNewsletters,
    [socialNext],
    renewals,
    [memberRenewals],
    waiting,
  ] = await Promise.all([
    db
      .select(eventFields)
      .from(events)
      .where(
        and(inWeek(events.startsAt, from, to), inArray(events.status, ['published', 'cancelled'])),
      )
      .orderBy(events.startsAt),
    db
      .select({ n: sql<number>`count(*) + coalesce(sum(${registrations.guests}), 0)` })
      .from(registrations)
      .where(
        and(
          inWeek(registrations.createdAt, from, to),
          inArray(registrations.status, ['registered', 'waitlist', 'attended']),
        ),
      ),
    db
      .select({ n: count() })
      .from(members)
      .where(
        and(
          inWeek(members.confirmedAt, from, to),
          inArray(members.status, ['active', 'lapsed', 'suspended']),
        ),
      ),
    db
      .select({ n: count() })
      .from(organisations)
      .where(inWeek(organisations.submittedAt, from, to)),
    db
      .select({ title: posts.title })
      .from(posts)
      .where(and(eq(posts.status, 'published'), inWeek(posts.publishedAt, from, to)))
      .orderBy(posts.publishedAt),
    db
      .select({ n: count() })
      .from(submissions)
      .where(
        and(
          inWeek(submissions.createdAt, from, to),
          notInArray(submissions.status, ['spam', 'deleted']),
        ),
      ),
    db
      .select({ subject: newsletters.subject, recipients: newsletters.recipients })
      .from(newsletters)
      .where(and(eq(newsletters.status, 'sent'), inWeek(newsletters.sentAt, from, to)))
      .orderBy(newsletters.sentAt),
    db
      .select({ subject: communityEmails.subject, recipients: communityEmails.recipients })
      .from(communityEmails)
      .where(inWeek(communityEmails.createdAt, from, to))
      .orderBy(communityEmails.createdAt),
    db
      .select({ n: count() })
      .from(socialPosts)
      .where(and(eq(socialPosts.status, 'sent'), inWeek(socialPosts.scheduledAt, from, to))),
    db
      .select(eventFields)
      .from(events)
      .where(
        and(inWeek(events.startsAt, to, until), inArray(events.status, ['published', 'draft'])),
      )
      .orderBy(events.startsAt),
    db
      .select({ subject: newsletters.subject, scheduledAt: newsletters.scheduledAt })
      .from(newsletters)
      .where(and(eq(newsletters.status, 'scheduled'), inWeek(newsletters.scheduledAt, now, until)))
      .orderBy(newsletters.scheduledAt),
    db
      .select({ n: count() })
      .from(socialPosts)
      .where(and(eq(socialPosts.status, 'scheduled'), inWeek(socialPosts.scheduledAt, now, until))),
    db
      .select({
        name: organisations.name,
        renewalDueAt: organisations.renewalDueAt,
        owners: organisations.ownerEmails,
      })
      .from(organisations)
      .where(
        and(eq(organisations.status, 'published'), inWeek(organisations.renewalDueAt, to, until)),
      )
      .orderBy(organisations.renewalDueAt),
    db
      .select({ n: count() })
      .from(members)
      .where(and(eq(members.status, 'active'), inWeek(members.renewalDueAt, to, until))),
    loadWaitingCounts(now),
  ]);
  return {
    from,
    to,
    until,
    heldEvents,
    registrations: Number(regs?.n ?? 0),
    newMembers: joined!.n,
    listingsSubmitted: listings!.n,
    postsPublished: published.map((p) => p.title),
    messages: messages!.n,
    newslettersSent: sentNewsletters,
    communityEmails: sentEmails,
    socialSent: social!.n,
    upcomingEvents,
    newslettersScheduled: scheduledNewsletters.map((n) => ({
      subject: n.subject,
      scheduledAt: n.scheduledAt!,
    })),
    socialScheduled: socialNext!.n,
    listingRenewals: renewals.map((o) => ({
      name: o.name,
      renewalDueAt: o.renewalDueAt!,
      claimed: o.owners.length > 0,
    })),
    memberRenewals: memberRenewals!.n,
    waiting,
  };
}

/**
 * The digest built from the data at `now`. `text` is the wording to use (the edit being previewed
 * in the admin); by default the saved one, or the built-in text.
 */
export async function weeklyDigestEmail(now: Date, text?: EmailText) {
  const vars = digestVars(await loadDigestData(now));
  const def = EMAIL_TEMPLATES['admin.weekly-digest'];
  const w = applyTemplate(def, text ?? (await loadTemplateText('admin.weekly-digest')), vars);
  const message: Omit<EmailMessage, 'to'> = {
    subject: w.subject,
    paragraphs: w.paragraphs,
    bodyHtml: w.bodyHtml,
    campaign: w.campaign,
    action: { label: w.buttonLabel, url: siteUrl('/admin') },
  };
  return { message, vars };
}

/** Sends the digest to the admin notification addresses. Returns a summary for the logs. */
export async function sendWeeklyDigest(now: Date) {
  const { message, vars } = await weeklyDigestEmail(now);
  await sendEmail({ ...message, to: await adminNotifyEmails() });
  return { lastWeek: vars.lastWeek.length, comingWeek: vars.comingWeek.length, todo: vars.todo };
}
