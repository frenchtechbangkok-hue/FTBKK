/**
 * The admin sidebar: its groups and links, and the small red numbers next to the links whose
 * screen has something waiting (the same counts as the dashboard's "Waiting for you").
 */
import { and, count, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { members, submissions } from '../db/schema';
import { moderationQueue } from './cron-directory';
import { failedSocialPosts } from './dashboard';

export type MenuCountKey = 'directory' | 'messages' | 'members' | 'social';

export interface NavLink {
  href: string;
  label: string;
  /** Shows that count as a badge when it is above 0. */
  count?: MenuCountKey;
}

export interface NavGroup {
  label: string;
  links: NavLink[];
}

// Day-to-day work first, then what visitors read and what we send, figures, switches, records.
// Website = what visitors read; Emails and social media = what we send or post; Settings =
// switches and site-wide values; History = records to look things up in.
export const MENU: NavGroup[] = [
  { label: '', links: [{ href: '/admin', label: 'Dashboard' }] },
  {
    label: 'Events',
    links: [
      { href: '/admin/events', label: 'All events' },
      { href: '/admin/registrations', label: 'Registrations' },
      { href: '/admin/checkin', label: 'Check-in' },
    ],
  },
  {
    label: 'Community',
    links: [
      { href: '/admin/members', label: 'Members', count: 'members' },
      { href: '/admin/contacts', label: 'Contacts' },
      { href: '/admin/contacts/labels', label: 'Tags and groups' },
      { href: '/admin/submissions', label: 'Messages', count: 'messages' },
    ],
  },
  {
    label: 'Ecosystem',
    links: [
      { href: '/admin/ecosystem', label: 'To review', count: 'directory' },
      { href: '/admin/ecosystem?tab=all', label: 'All listings' },
      { href: '/admin/ecosystem?tab=partners', label: 'Partners' },
      { href: '/admin/ecosystem?tab=renewals', label: 'Renewals' },
    ],
  },
  {
    label: 'Website',
    links: [
      { href: '/admin/posts', label: 'Blog posts' },
      { href: '/admin/files', label: 'PDFs and files' },
      { href: '/admin/site-texts', label: 'Page texts' },
      { href: '/admin/people', label: 'Board and speakers' },
      { href: '/admin/settings?section=guides', label: 'Guide pages' },
    ],
  },
  {
    label: 'Emails and social media',
    links: [
      { href: '/admin/community-email', label: 'Email the community' },
      { href: '/admin/social', label: 'Social media posts', count: 'social' },
      { href: '/admin/emails', label: 'Automatic emails' },
    ],
  },
  {
    label: 'Reports',
    links: [
      { href: '/admin/reports/events', label: 'Events and attendance' },
      { href: '/admin/reports/members', label: 'Membership' },
      { href: '/admin/reports/traffic', label: 'Website traffic' },
      { href: '/admin/reports/emails', label: 'Emails' },
      { href: '/admin/reports/cloudflare', label: 'Cloudflare usage' },
    ],
  },
  {
    label: 'Settings',
    links: [
      { href: '/admin/settings', label: 'General' },
      { href: '/admin/settings?section=membership', label: 'Membership' },
      { href: '/admin/settings?section=event-covers', label: 'Event covers' },
      { href: '/admin/settings?section=social-links', label: 'Social links' },
      { href: '/admin/email-delivery', label: 'Email delivery' },
    ],
  },
  {
    label: 'History',
    links: [
      { href: '/admin/actions-log', label: 'Actions log' },
      { href: '/admin/changes', label: 'Change history' },
    ],
  },
];

export type MenuCounts = Record<MenuCountKey, number>;

/** What a folded group shows: the sum of its links' badges. */
export const groupCount = (g: NavGroup, counts: Partial<MenuCounts>) =>
  g.links.reduce((n, l) => n + (l.count ? (counts[l.count] ?? 0) : 0), 0);

/** The badge numbers. Never breaks a page: any failure just shows no badges. */
export async function menuCounts(now = new Date()): Promise<Partial<MenuCounts>> {
  try {
    const db = getDb();
    const [queue, [unread], [unreviewed], social] = await Promise.all([
      moderationQueue(),
      db.select({ n: count() }).from(submissions).where(eq(submissions.status, 'new')),
      db
        .select({ n: count() })
        .from(members)
        .where(and(eq(members.status, 'active'), isNull(members.reviewedAt))),
      failedSocialPosts(now),
    ]);
    return {
      directory:
        queue.pendingOrgs.length +
        queue.changes.length +
        queue.pendingClaims.length +
        queue.applications.length,
      messages: unread?.n ?? 0,
      members: unreviewed?.n ?? 0,
      social,
    };
  } catch {
    return {};
  }
}
