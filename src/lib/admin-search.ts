/**
 * The search box at the top of the admin menu (/admin/search): finds people (contacts and
 * members), events, blog posts and ecosystem listings by name. Matching ignores case and accents.
 */
import { desc } from 'drizzle-orm';
import { getDb } from '../db';
import { events, organisations, posts } from '../db/schema';
import { loadContacts, type Contact } from './contacts';
import { CATEGORIES, type Category } from './directory';
import { formatDate } from './format';

export const fold = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Every word of the query appears in one of the fields. */
export function matches(q: string, ...fields: (string | null | undefined)[]) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const hay = fields.map(fold).join(' ');
  return words.every((w) => hay.includes(w));
}

export interface SearchHit {
  href: string;
  title: string;
  detail: string;
}

export interface SearchResults {
  people: SearchHit[];
  events: SearchHit[];
  posts: SearchHit[];
  listings: SearchHit[];
}

export const SEARCH_LIMIT = 20;

export function personHit(c: Contact): SearchHit {
  const bits = [
    c.member?.status === 'active' ? 'Member' : null,
    c.company,
    c.email,
    c.attended ? `came ${c.attended} ${c.attended === 1 ? 'time' : 'times'}` : null,
  ].filter(Boolean);
  return {
    href: `/admin/contacts/view?c=${encodeURIComponent(c.key)}`,
    title: c.name || c.email || 'No name',
    detail: bits.join(' · '),
  };
}

export async function searchAdmin(q: string, now = new Date()): Promise<SearchResults> {
  const db = getDb();
  const [contacts, eventRows, postRows, orgRows] = await Promise.all([
    loadContacts(now),
    db
      .select({
        id: events.id,
        title: events.title,
        series: events.series,
        startsAt: events.startsAt,
      })
      .from(events)
      .orderBy(desc(events.startsAt)),
    db
      .select({ id: posts.id, title: posts.title, status: posts.status })
      .from(posts)
      .orderBy(desc(posts.updatedAt)),
    db
      .select({
        id: organisations.id,
        name: organisations.name,
        category: organisations.category,
        status: organisations.status,
      })
      .from(organisations)
      .orderBy(organisations.name),
  ]);
  return {
    people: contacts
      .filter((c) => matches(q, c.name, c.email, ...c.otherEmails, c.company, c.phone))
      .slice(0, SEARCH_LIMIT)
      .map(personHit),
    events: eventRows
      .filter((e) => matches(q, e.title, e.series))
      .slice(0, SEARCH_LIMIT)
      .map((e) => ({
        href: `/admin/events/${e.id}`,
        title: e.title,
        detail: formatDate(e.startsAt),
      })),
    posts: postRows
      .filter((p) => matches(q, p.title))
      .slice(0, SEARCH_LIMIT)
      .map((p) => ({ href: `/admin/posts/${p.id}`, title: p.title, detail: p.status })),
    listings: orgRows
      .filter((o) => matches(q, o.name))
      .slice(0, SEARCH_LIMIT)
      .map((o) => ({
        href: `/admin/ecosystem/${o.id}`,
        title: o.name,
        detail: [CATEGORIES[o.category as Category]?.short, o.status].filter(Boolean).join(' · '),
      })),
  };
}
