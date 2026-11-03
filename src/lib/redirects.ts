import { slugify } from './format';

/** The kinds of content an old Wix URL can point at, and where each one lives on the new site. */
export type LegacyKind = 'event' | 'post' | 'organisation' | 'category';

export const LEGACY_HOME: Record<LegacyKind, { table: string; prefix: string; list: string }> = {
  event: { table: 'events', prefix: '/events/', list: '/events' },
  post: { table: 'posts', prefix: '/blog/', list: '/blog' },
  organisation: { table: 'organisations', prefix: '/ecosystem/', list: '/ecosystem' },
  category: { table: 'categories', prefix: '/blog/category/', list: '/blog' },
};

/**
 * Old Wix slugs whose page got a different slug on the new site, where pickSlug can't guess it
 * (checked against the live D1 slugs, Nov 2026). Old slug -> new slug.
 */
export const LEGACY_SLUGS: Record<LegacyKind, Record<string, string>> = {
  event: {},
  post: {},
  organisation: { safecomms: 'safecoms' },
  category: {},
};

type Rule = [RegExp, (m: RegExpMatchArray) => string, LegacyKind?];

/**
 * Old Wix URLs (and moved admin screens) -> new URLs (301). Order matters: first match wins.
 * Rules with a kind point at one event, post, organisation or category: the middleware checks the
 * slug against D1 (see resolveLegacySlug) so a slug that changed on import still lands on the
 * right page, and an unknown one lands on the listing instead of a 404.
 */
const RULES: Rule[] = [
  [/^\/post\/([^/]+)\/?$/, (m) => `/blog/${m[1]}`, 'post'],
  [/^\/blog\/categories\/([^/]+)\/?$/, (m) => `/blog/category/${m[1]}`, 'category'],
  [/^\/blog\/(?:page\/\d+|hashtags\/.*|tags\/.*|archive\/.*)\/?$/, () => '/blog'],
  [/^\/event-details-registration\/([^/]+)(?:\/.*)?$/, (m) => `/events/${m[1]}`, 'event'],
  [/^\/event-details\/([^/]+)(?:\/.*)?$/, (m) => `/events/${m[1]}`, 'event'],
  [/^\/event-info\/([^/]+)(?:\/.*)?$/, (m) => `/events/${m[1]}`, 'event'],
  [/^\/events\/page\/\d+\/?$/, () => '/events'],
  [/^\/sponsors\/([^/]+)\/?$/, (m) => `/ecosystem/${m[1]}`, 'organisation'],
  [/^\/(sponsors|services-9|members|members-area)(\/.*)?$/, () => '/ecosystem'],
  [/^\/profile\/.*$/, () => '/ecosystem'],
  // Wix "team" pages were board profiles: the board is on About now.
  [/^\/team(\/.*)?$/, () => '/about'],
  [/^\/fund\/?$/, () => '/about'],
  [/^\/(home|index\.html?)\/?$/, () => '/'],
  [/^\/(contact|contact-us|contact-\d+)\/?$/, () => '/about#contact'],
  // Admin screens moved when the menu was regrouped (Reports group, Oct 2026).
  [/^\/admin\/events\/stats\/?$/, () => '/admin/reports/events'],
  [/^\/admin\/reports\/?$/, () => '/admin/reports/members'],
  // Settings > Change history became Actions log when the site version history took its name.
  [/^\/admin\/history\/?$/, () => '/admin/actions-log'],
];

export interface LegacyMatch {
  to: string;
  kind?: LegacyKind;
  /** The slug from the old URL, decoded, when the rule has a kind. */
  slug?: string;
}

function decode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function legacyMatch(pathname: string): LegacyMatch | null {
  for (const [re, to, kind] of RULES) {
    const m = pathname.match(re);
    if (m) return kind ? { to: to(m), kind, slug: decode(m[1]) } : { to: to(m) };
  }
  return null;
}

/** Static answer, without the D1 check (used to rewrite old links inside imported posts). */
export function redirectFor(pathname: string): string | null {
  return legacyMatch(pathname)?.to ?? null;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Pick the new slug for an old Wix slug among the slugs that exist now, or null.
 * Tries, in order: the same slug, the slug as the import would write it (Wix keeps brackets and
 * trailing dashes, e.g. "asian-institute-of-technology-(ait)", "wyzauto-"), the same letters and
 * digits, then a slug that one of them starts with at a word boundary ("french-tech-connect-54-1"
 * -> "french-tech-connect-54", "french-tech-connect-52" -> "french-tech-connect-52-calm-bangkok").
 */
export function pickSlug(old: string, existing: string[]): string | null {
  const set = new Set(existing);
  const lower = old.toLowerCase();
  if (set.has(old)) return old;
  if (set.has(lower)) return lower;
  const clean = slugify(old);
  if (clean && set.has(clean)) return clean;
  const sq = squash(old);
  if (!sq) return null;
  const same = existing.find((s) => squash(s) === sq);
  if (same) return same;
  if (clean.length < 8) return null;
  const prefixed = existing
    .filter((s) => s.startsWith(`${clean}-`) || clean.startsWith(`${s}-`))
    .sort((a, b) => Math.abs(a.length - clean.length) - Math.abs(b.length - clean.length));
  return prefixed[0] ?? null;
}

/** Where an old URL of this kind should go, given the slugs in D1 now. */
export function legacyTarget(kind: LegacyKind, old: string, existing: string[]) {
  const home = LEGACY_HOME[kind];
  const alias = LEGACY_SLUGS[kind][old.toLowerCase()];
  const slug = alias && existing.includes(alias) ? alias : pickSlug(old, existing);
  return slug ? `${home.prefix}${slug}` : home.list;
}

/** Look the old slug up in D1. On a database error, keep the plain mapping. */
export async function resolveLegacy(match: LegacyMatch, db: D1Database): Promise<string> {
  if (!match.kind || match.slug === undefined) return match.to;
  try {
    const { results } = await db
      .prepare(`SELECT slug FROM ${LEGACY_HOME[match.kind].table}`)
      .all<{ slug: string }>();
    return legacyTarget(
      match.kind,
      match.slug,
      results.map((r) => r.slug),
    );
  } catch (e) {
    console.warn('[redirects] slug lookup failed:', (e as Error).message);
    return match.to;
  }
}
