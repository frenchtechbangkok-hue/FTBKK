// Emails and social media > Newsletters: newsletters built from blocks (newsletter-blocks.ts),
// sent at a set time (or "now") by the cron, which runs every 5 minutes. When sending starts the
// list of people is frozen in newsletter_sends: each cron run sends the next ones until everyone
// got it, so a big list or a passing provider error never sends twice. Every email carries the
// tag "newsletter-<id>": the provider's events (opens, clicks…) and the site visits from its
// links are counted per newsletter.
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { contacts, events, newsletterSends, newsletters, people, posts } from '../db/schema';
import { communityRecipients, FOOTERS, loadCards, type Recipient } from './community-emails';
import type { EmailCard } from './email-markdown';
import { sendEmailBatch, type EmailMessage } from './email';
import { campaignFigures, campaignsFigures, type EmailTotals } from './email-metrics';
import { personalise } from './event-emails';
import { formatDate, formatEventDate, mediaUrl, slugify } from './format';
import {
  blockProblems,
  blockRefs,
  parseBlocks,
  renderBlocks,
  type BlockData,
  type NewsletterBlock,
  type RecapContent,
} from './newsletter-blocks';
import { audit } from './orgs';
import { publishedPostById, speakersForEvent, sponsorsForEvent } from './queries';
import { loadRecapFigures } from './recap-stats';
import { getSettings } from './settings';
import { siteOrigin, siteUrl } from './site';
import { personLine } from './speakers';
import { emailLogos, showSponsor } from './sponsors';
import { randomToken } from './tokens';
import { loadContact, unsubscribeNewsletter } from './contacts';

export type Newsletter = typeof newsletters.$inferSelect;

export const NEWSLETTER_AUDIENCES = {
  newsletter: {
    label: 'Newsletter subscribers',
    hint: 'Everyone who said yes to the newsletter (recommended).',
  },
  members: { label: 'Members', hint: 'Every active member.' },
  all: {
    label: 'All contacts',
    hint: 'Everyone we know. Only for news they would expect from us (PDPA).',
  },
  segment: { label: 'Groups and tags', hint: 'The people in some groups or with some tags.' },
} as const;
export type NewsletterAudience = keyof typeof NEWSLETTER_AUDIENCES;
export const NEWSLETTER_AUDIENCE_KEYS = Object.keys(NEWSLETTER_AUDIENCES) as [
  NewsletterAudience,
  ...NewsletterAudience[],
];

export const STATUS_LABELS: Record<Newsletter['status'], string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Stopped',
};

/** The tag of a newsletter's emails and links (utm_campaign, email_messages.campaign). */
export const campaignOf = (id: number) => `newsletter-${id}`;

const list = (max: number) =>
  z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((v) => (Array.isArray(v) ? v : v ? [v] : []).slice(0, max));

/** The editor's form (repeated fields as arrays: formToObject(form, NEWSLETTER_ARRAYS)). */
export const NewsletterFormSchema = z.object({
  subject: z.string().trim().min(1, 'Enter a subject.').max(150),
  preheader: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
  blocks: z.string().max(500_000).default('[]').transform(parseBlocks),
  audience: z.enum(NEWSLETTER_AUDIENCE_KEYS).catch('newsletter'),
  segGroups: list(100).transform((a) => a.map(Number).filter((n) => Number.isInteger(n) && n > 0)),
  segTags: list(100).transform((a) => a.filter((t) => /^[\w-]{1,80}$/.test(t))),
  /** A ticked checkbox: formToObject turns "on" into true. */
  webPage: z.unknown().transform((v) => v === true || v === 'on' || v === '1' || v === 'true'),
});
export type NewsletterForm = z.infer<typeof NewsletterFormSchema>;
export const NEWSLETTER_ARRAYS = ['segGroups', 'segTags'];

// ---------- the data blocks need ----------

const absolute = (u: string | null) => (u ? siteUrl(u) : null);

/** Recap content of past events, by slug: figures, photos, speakers, slides, video, partners. */
async function loadRecaps(slugs: string[]): Promise<Map<string, RecapContent>> {
  const out = new Map<string, RecapContent>();
  if (!slugs.length) return out;
  const rows = await getDb()
    .select()
    .from(events)
    .where(and(inArray(events.slug, slugs), eq(events.status, 'published')));
  const figures = await loadRecapFigures(rows.map((e) => e.id));
  await Promise.all(
    rows.map(async (e) => {
      const [speakers, sponsors, post] = await Promise.all([
        speakersForEvent(e.id),
        sponsorsForEvent(e.id),
        e.recap?.postId ? publishedPostById(e.recap.postId) : null,
      ]);
      const writeUp: EmailCard | null = post
        ? {
            kind: 'post',
            title: post.title,
            url: siteUrl(`/blog/${post.slug}`),
            image: absolute(mediaUrl(post.coverKey)),
            meta: post.publishedAt ? formatDate(post.publishedAt) : '',
            summary: post.excerpt,
          }
        : null;
      out.set(e.slug, {
        title: e.title,
        url: siteUrl(`/events/${e.slug}`),
        meta: formatEventDate(e.startsAt, e.endsAt),
        stats: figures.get(e.id) ?? [],
        photos: (e.recap?.photos ?? []).map((p) => ({
          src: siteUrl(mediaUrl(p.key)!),
          alt: p.alt ?? '',
        })),
        speakers: speakers.map((s) => ({
          name: s.name,
          role: personLine(s),
          photo: absolute(mediaUrl(s.photoKey)),
          link: s.linkedin || null,
        })),
        slides: (e.recap?.slides ?? []).map((s) => ({
          label: s.label,
          url: s.key ? siteUrl(mediaUrl(s.key)!) : (s.url ?? ''),
        })),
        video: e.recap?.videoUrl ?? null,
        writeUp,
        partners: emailLogos(sponsors.map(showSponsor), siteUrl),
      });
    }),
  );
  return out;
}

/** Everything the blocks show from the database. */
export async function loadBlockData(blocks: NewsletterBlock[]): Promise<BlockData> {
  const refs = blockRefs(blocks);
  const tokens = [
    ...refs.events.map((s) => `{{event: ${s}}}`),
    ...refs.posts.map((s) => `{{post: ${s}}}`),
  ].join('\n');
  const [cards, recaps] = await Promise.all([loadCards(tokens), loadRecaps(refs.recaps)]);
  return { origin: siteOrigin().origin, cards, recaps };
}

// ---------- the email ----------

const escHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

type Shown = Pick<Newsletter, 'id' | 'subject' | 'preheader' | 'audience' | 'slug' | 'webPage'>;

/**
 * The newsletter, rendered once, and the email each person gets from it: {name} filled in, their
 * own unsubscribe link (also as one-click List-Unsubscribe headers), "View in your browser" when
 * it has a web page. `test` emails carry the tag "test", so they never count in the figures.
 */
export function newsletterMessage(
  n: Shown,
  blocks: NewsletterBlock[],
  data: BlockData,
  opts: { replyTo?: string; test?: boolean } = {},
) {
  const body = renderBlocks(blocks, data);
  const web = n.webPage && n.slug ? siteUrl(`/newsletters/${n.slug}`) : null;
  return {
    body,
    to(r: { name: string; email: string; token?: string }): EmailMessage {
      const first = personalise('{name}', r.name);
      const name = (s: string) => s.replace(/\{name\}/gi, first);
      const unsubscribe = siteUrl(
        `/newsletters/unsubscribe${r.token ? `?t=${encodeURIComponent(r.token)}` : ''}`,
      );
      const oneClick = r.token
        ? siteUrl(`/api/newsletter-unsubscribe?t=${encodeURIComponent(r.token)}`)
        : null;
      return {
        to: r.email,
        subject: name(n.subject),
        preheader: n.preheader ? name(n.preheader) : undefined,
        paragraphs: body.paragraphs.map(name),
        bodyHtml: body.html.replace(/\{name\}/gi, escHtml(first)),
        topLink: web ? { label: 'View in your browser', url: web } : undefined,
        footer: FOOTERS[n.audience],
        footerLinks: [{ label: 'Unsubscribe from the newsletter', url: unsubscribe }],
        dataUrl: siteUrl('/my-data'),
        headers: oneClick
          ? {
              'List-Unsubscribe': `<${oneClick}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            }
          : undefined,
        replyTo: opts.replyTo,
        campaign: opts.test ? 'test' : campaignOf(n.id),
        kind: 'newsletter',
      };
    },
  };
}

/** The body as the web version shows it: {name} becomes "there". */
export function webBody(blocks: NewsletterBlock[], data: BlockData) {
  return renderBlocks(blocks, data).html.replace(/\{name\}/gi, 'there');
}

// ---------- who gets it ----------

/**
 * Everyone in the audience who accepts emails: people who said no to emails are left out of every
 * newsletter, members included (a newsletter isn't a membership email).
 */
export async function newsletterRecipients(
  audience: NewsletterAudience,
  segment: { groups: number[]; tags: string[] } | null,
): Promise<Recipient[]> {
  const r = await communityRecipients([], [], segment ?? { groups: [], tags: [] });
  return r.lists[audience].filter((p) => !r.optedOut.has(p.email));
}

/** How many people each audience reaches, for the editor (segment: as picked). */
export async function audienceCounts(segment: { groups: number[]; tags: string[] }) {
  const r = await communityRecipients([], [], segment);
  const count = (a: NewsletterAudience) =>
    r.lists[a].filter((p) => !r.optedOut.has(p.email)).length;
  return {
    counts: Object.fromEntries(NEWSLETTER_AUDIENCE_KEYS.map((a) => [a, count(a)])) as Record<
      NewsletterAudience,
      number
    >,
    segmentable: r.segmentable.filter((p) => !r.optedOut.has(p.email)),
  };
}

// ---------- sending (cron) ----------

/** Emails per provider call; a run stops starting new batches after RUN_BUDGET_MS. */
const BATCH = 50;
const RUN_BUDGET_MS = 4 * 60_000;
/** How long a run holds a newsletter (two runs never send the same one). */
const LEASE_S = 10 * 60;
/** Failed runs in a row before the newsletter stops; each failure waits longer (30 min × n). */
export const MAX_FAILURES = 5;
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

/** A free web address for the newsletter: its subject, else "newsletter", with -2, -3… if taken. */
async function freeSlug(n: Newsletter) {
  const base = slugify(n.subject.replace(/\{name\}/gi, '')).slice(0, 70) || 'newsletter';
  const taken = new Set(
    (
      await getDb()
        .select({ slug: newsletters.slug })
        .from(newsletters)
        .where(sql`${newsletters.slug} = ${base} OR ${newsletters.slug} LIKE ${`${base}-%`}`)
    ).map((r) => r.slug),
  );
  taken.add('unsubscribe'); // /newsletters/unsubscribe is a page of its own
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Freezes the list, picks the web address and moves the newsletter to "sending". */
async function startSending(n: Newsletter, now: Date): Promise<string | null> {
  const db = getDb();
  const blocks = parseBlocks(n.blocks);
  const problems = blockProblems(blocks, await loadBlockData(blocks));
  if (problems.length) return `Not sent: ${problems.join(' ')}`;
  const people = await newsletterRecipients(n.audience, n.segment);
  if (!people.length) return 'Not sent: nobody in this audience accepts emails.';
  const stmt = env.DB.prepare(
    'INSERT OR IGNORE INTO newsletter_sends (newsletter_id, email, name, token) VALUES (?1, ?2, ?3, ?4)',
  );
  for (let i = 0; i < people.length; i += 200)
    await env.DB.batch(
      people
        .slice(i, i + 200)
        .map((p) => stmt.bind(n.id, p.email.trim().toLowerCase(), p.name ?? '', randomToken(24))),
    );
  const slug = n.slug ?? (await freeSlug(n));
  await db
    .update(newsletters)
    .set({ status: 'sending', slug, startedAt: now, recipients: people.length, error: null })
    .where(eq(newsletters.id, n.id));
  return null;
}

/** Sends the next people of one newsletter until done or out of time. */
async function sendSome(id: number, started: number, now: Date) {
  const db = getDb();
  const [n] = await db.select().from(newsletters).where(eq(newsletters.id, id));
  if (!n || n.status !== 'sending') return 'skipped';
  const blocks = parseBlocks(n.blocks);
  const settings = await getSettings();
  const msg = newsletterMessage(n, blocks, await loadBlockData(blocks), {
    replyTo: settings.contactEmail,
  });
  let handled = 0;
  while (Date.now() - started < RUN_BUDGET_MS) {
    const batch = await db
      .select()
      .from(newsletterSends)
      .where(and(eq(newsletterSends.newsletterId, id), isNull(newsletterSends.sentAt)))
      .limit(BATCH);
    if (!batch.length) {
      await db
        .update(newsletters)
        .set({ status: 'sent', sentAt: new Date(), lockedUntil: null, failures: 0, error: null })
        .where(eq(newsletters.id, id));
      await audit('cron', 'newsletter_sent', 'newsletter', id, null, {
        subject: n.subject,
        recipients: n.sentCount + handled - n.suppressed,
      });
      return `sent (${handled} this run)`;
    }
    const res = await sendEmailBatch(batch.map((r) => msg.to(r)));
    const done = batch.slice(0, res.sent).map((r) => r.email);
    if (done.length)
      await db
        .update(newsletterSends)
        .set({ sentAt: new Date() })
        .where(and(eq(newsletterSends.newsletterId, id), inArray(newsletterSends.email, done)));
    handled += done.length;
    await db
      .update(newsletters)
      .set({
        sentCount: sql`${newsletters.sentCount} + ${done.length}`,
        suppressed: sql`${newsletters.suppressed} + ${res.suppressed}`,
        ...(res.ok ? { failures: 0, error: null } : {}),
      })
      .where(eq(newsletters.id, id));
    if (!res.ok) {
      const failures = n.failures + 1;
      const stop = failures >= MAX_FAILURES;
      await db
        .update(newsletters)
        .set({
          failures,
          error: `The email service refused it: ${res.error ?? 'unknown error'}`.slice(0, 500),
          status: stop ? 'failed' : 'sending',
          // Wait before trying again (a daily limit, a passing outage): 30 min, 1 h, 1 h 30…
          lockedUntil: stop ? null : new Date(now.getTime() + failures * 30 * 60_000),
        })
        .where(eq(newsletters.id, id));
      if (stop)
        await audit('cron', 'newsletter_failed', 'newsletter', id, null, {
          subject: n.subject,
          error: res.error ?? null,
        });
      return `error after ${handled}`;
    }
  }
  return `paused after ${handled} (next run continues)`;
}

/**
 * The cron job: starts the newsletters whose time has come and goes on with the ones being sent.
 * Each run holds a newsletter for LEASE_S, so two runs never send to the same people.
 */
export async function runNewsletters(now: Date) {
  const started = Date.now();
  const db = getDb();
  const t = secs(now);
  const due = await db
    .select({ id: newsletters.id })
    .from(newsletters)
    .where(
      sql`(${newsletters.status} = 'scheduled' AND ${newsletters.scheduledAt} <= ${t})
        OR ${newsletters.status} = 'sending'`,
    )
    .orderBy(newsletters.scheduledAt);
  const results: Record<number, string> = {};
  for (const { id } of due) {
    if (Date.now() - started > RUN_BUDGET_MS) break;
    const lock = await env.DB.prepare(
      `UPDATE newsletters SET locked_until = ?1
       WHERE id = ?2 AND status IN ('scheduled', 'sending')
         AND (locked_until IS NULL OR locked_until < ?3)`,
    )
      .bind(t + LEASE_S, id, t)
      .run();
    if (!lock.meta.changes) continue;
    const [n] = await db.select().from(newsletters).where(eq(newsletters.id, id));
    if (!n) continue;
    try {
      if (n.status === 'scheduled') {
        const problem = await startSending(n, now);
        if (problem) {
          await db
            .update(newsletters)
            .set({ status: 'failed', error: problem, lockedUntil: null })
            .where(eq(newsletters.id, id));
          await audit('cron', 'newsletter_failed', 'newsletter', id, null, {
            subject: n.subject,
            error: problem,
          });
          results[id] = 'not started';
          continue;
        }
      }
      results[id] = await sendSome(id, started, now);
    } finally {
      // Free it for the next run, unless a failure set a later retry time.
      await env.DB.prepare(
        'UPDATE newsletters SET locked_until = NULL WHERE id = ?1 AND locked_until = ?2',
      )
        .bind(id, t + LEASE_S)
        .run();
    }
  }
  return results;
}

// ---------- figures ----------

export interface NewsletterKpis {
  /** From the provider's events (null until it reports). */
  email: EmailTotals | null;
  visits: number;
  pages: { path: string; visits: number }[];
  unsubscribed: number;
}

export async function newsletterKpis(id: number): Promise<NewsletterKpis> {
  const campaign = campaignOf(id);
  const [email, pages, unsub] = await Promise.all([
    campaignFigures(campaign),
    env.DB.prepare(
      'SELECT path, SUM(visits) AS visits FROM email_visits WHERE campaign = ?1 GROUP BY path ORDER BY visits DESC',
    )
      .bind(campaign)
      .all<{ path: string; visits: number }>()
      .then((r) => r.results)
      .catch(() => []),
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(newsletterSends)
      .where(and(eq(newsletterSends.newsletterId, id), isNotNull(newsletterSends.unsubscribedAt))),
  ]);
  return {
    email,
    visits: pages.reduce((s, p) => s + Number(p.visits), 0),
    pages: pages.slice(0, 15).map((p) => ({ path: p.path, visits: Number(p.visits) })),
    unsubscribed: Number(unsub[0]?.n ?? 0),
  };
}

/** The list page's figures for several newsletters at once. */
export async function listKpis(ids: number[]) {
  const campaigns = ids.map(campaignOf);
  const out = new Map<number, Omit<NewsletterKpis, 'pages'>>();
  if (!ids.length) return out;
  const [email, visits, unsub] = await Promise.all([
    campaignsFigures(campaigns),
    env.DB.prepare(
      `SELECT campaign, SUM(visits) AS n FROM email_visits WHERE campaign IN (${campaigns.map((_, i) => `?${i + 1}`).join(',')}) GROUP BY campaign`,
    )
      .bind(...campaigns)
      .all<{ campaign: string; n: number }>()
      .then((r) => r.results)
      .catch(() => []),
    getDb()
      .select({ id: newsletterSends.newsletterId, n: sql<number>`count(*)` })
      .from(newsletterSends)
      .where(
        and(inArray(newsletterSends.newsletterId, ids), isNotNull(newsletterSends.unsubscribedAt)),
      )
      .groupBy(newsletterSends.newsletterId),
  ]);
  for (const id of ids)
    out.set(id, {
      email: email.get(campaignOf(id)) ?? null,
      visits: Number(visits.find((v) => v.campaign === campaignOf(id))?.n ?? 0),
      unsubscribed: Number(unsub.find((u) => u.id === id)?.n ?? 0),
    });
  return out;
}

// ---------- unsubscribing ----------

/**
 * The one-click unsubscribe link of a newsletter: records "no" to the newsletter on the person's
 * contact card and which newsletter they left from. Null when the link is unknown.
 */
export async function unsubscribeByToken(token: string, now = new Date()) {
  if (!/^[\w-]{10,100}$/.test(token)) return null;
  const db = getDb();
  const [row] = await db.select().from(newsletterSends).where(eq(newsletterSends.token, token));
  if (!row) return null;
  if (!row.unsubscribedAt) {
    const contact = await loadContact(row.email, now);
    const actor = `self-service:${row.email}`;
    if (!contact || !(await unsubscribeNewsletter(contact, actor, now))) {
      // Known only as a member, say: a contact card records the "no".
      const set = { newsletter: 'no' as const, newsletterAt: now, updatedAt: now };
      await db
        .insert(contacts)
        .values({ email: row.email, name: row.name || row.email.split('@')[0]!, ...set })
        .onConflictDoUpdate({ target: contacts.email, set });
    }
    await db
      .update(newsletterSends)
      .set({ unsubscribedAt: now })
      .where(
        and(
          eq(newsletterSends.newsletterId, row.newsletterId),
          eq(newsletterSends.email, row.email),
        ),
      );
  }
  return { email: row.email, already: !!row.unsubscribedAt };
}

// ---------- the builder's menus ----------

export interface EventChoice {
  slug: string;
  title: string;
  meta: string;
  upcoming: boolean;
  photos: number;
}

export interface PersonChoice {
  group: 'board' | 'institutional' | 'speaker';
  photo: string;
  name: string;
  role: string;
  link: string;
}

/**
 * Events (upcoming, then the last 3 years), the latest posts and everyone in Board and speakers
 * for the builder's menus.
 */
export async function builderChoices(now = new Date()) {
  const db = getDb();
  const since = new Date(now.getTime() - 3 * 365 * 86_400_000);
  const [eventRows, postRows, peopleRows] = await Promise.all([
    db
      .select({
        slug: events.slug,
        title: events.title,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        recap: events.recap,
      })
      .from(events)
      .where(and(eq(events.status, 'published'), gte(events.startsAt, since)))
      .orderBy(desc(events.startsAt))
      .limit(150),
    db
      .select({ slug: posts.slug, title: posts.title, publishedAt: posts.publishedAt })
      .from(posts)
      .where(and(eq(posts.status, 'published'), isNotNull(posts.publishedAt)))
      .orderBy(desc(posts.publishedAt))
      .limit(80),
    db.select().from(people).orderBy(people.name),
  ]);
  const evs: EventChoice[] = eventRows.map((e) => ({
    slug: e.slug,
    title: e.title,
    meta: formatEventDate(e.startsAt, e.endsAt),
    upcoming: (e.endsAt ?? e.startsAt) >= now,
    photos: e.recap?.photos.length ?? 0,
  }));
  return {
    events: [...evs.filter((e) => e.upcoming).reverse(), ...evs.filter((e) => !e.upcoming)],
    posts: postRows.map((p) => ({
      slug: p.slug,
      title: p.title,
      meta: p.publishedAt ? formatDate(p.publishedAt) : '',
    })),
    people: peopleRows.map((p): PersonChoice => ({
      group: p.group,
      photo: mediaUrl(p.photoKey) ?? '',
      name: p.name,
      role: personLine(p) || (p.ftRole ?? ''),
      link: p.linkedin ?? '',
    })),
  };
}

/**
 * What the builder can copy from an event into a block: its recap photos (Photo grid), speakers
 * (People) and host, sponsors and partners (Logos). Addresses stay relative (/media/…).
 */
export async function eventContent(slug: string) {
  const [e] = await getDb().select().from(events).where(eq(events.slug, slug));
  if (!e) return null;
  const [speakers, sponsors] = await Promise.all([speakersForEvent(e.id), sponsorsForEvent(e.id)]);
  return {
    title: e.title,
    photos: (e.recap?.photos ?? []).map((p) => ({ src: mediaUrl(p.key)!, alt: p.alt ?? '' })),
    speakers: speakers.map((s) => ({
      photo: mediaUrl(s.photoKey) ?? '',
      name: s.name,
      role: personLine(s),
      link: s.linkedin ?? '',
    })),
    partners: emailLogos(sponsors.map(showSponsor), (p) => p).map((l) => ({
      src: l.src,
      alt: l.alt,
      url: l.url ?? '',
    })),
  };
}
