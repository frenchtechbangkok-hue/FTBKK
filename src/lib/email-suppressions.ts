import { env } from 'cloudflare:workers';
import { desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { emailSuppressions } from '../db/schema';
import type { SesFeedback } from './ses';

/**
 * The site's own "do not email" list: addresses that bounced for good or reported an email as
 * spam (from Amazon SES notifications, /api/ses-events). Every send skips them, whichever
 * provider is in use, so a dead address never hurts the sender's reputation twice.
 */

/** No database in unit tests and some scripts: nothing is suppressed there. */
const hasDb = () => !!env.DB;

/**
 * A failed lookup never blocks an email: previews share the production database before its
 * migrations run, and a deploy runs a moment before them too.
 */
async function lookup(query: () => Promise<{ email: string }[]>) {
  try {
    return new Set((await query()).map((r) => r.email));
  } catch (e) {
    console.error('[email] suppression list unavailable', e);
    return new Set<string>();
  }
}

/** All suppressed addresses (a small table), for checking a bulk send in one query. */
export async function suppressedEmails(): Promise<Set<string>> {
  if (!hasDb()) return new Set();
  return lookup(() => getDb().select({ email: emailSuppressions.email }).from(emailSuppressions));
}

/** Which of these few addresses are suppressed. */
export async function suppressedAmong(emails: string[]): Promise<Set<string>> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter(Boolean);
  if (!hasDb() || !list.length) return new Set();
  return lookup(() =>
    getDb()
      .select({ email: emailSuppressions.email })
      .from(emailSuppressions)
      .where(inArray(emailSuppressions.email, list)),
  );
}

/** Records a bounce or complaint; a complaint replaces an earlier bounce for the same address. */
export async function recordFeedback(f: SesFeedback) {
  const db = getDb();
  for (const email of new Set(f.emails)) {
    const insert = db
      .insert(emailSuppressions)
      .values({ email, reason: f.kind, detail: f.detail || null });
    await (f.kind === 'complaint'
      ? insert.onConflictDoUpdate({
          target: emailSuppressions.email,
          set: { reason: 'complaint', detail: f.detail || null },
        })
      : insert.onConflictDoNothing());
  }
}

export function listSuppressions() {
  return getDb().select().from(emailSuppressions).orderBy(desc(emailSuppressions.createdAt));
}

export async function unsuppress(email: string) {
  await getDb().delete(emailSuppressions).where(eq(emailSuppressions.email, email.toLowerCase()));
}
