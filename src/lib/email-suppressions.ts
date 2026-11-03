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

/** All suppressed addresses (a small table), for checking a bulk send in one query. */
export async function suppressedEmails(): Promise<Set<string>> {
  if (!hasDb()) return new Set();
  const rows = await getDb().select({ email: emailSuppressions.email }).from(emailSuppressions);
  return new Set(rows.map((r) => r.email));
}

/** Which of these few addresses are suppressed. */
export async function suppressedAmong(emails: string[]): Promise<Set<string>> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter(Boolean);
  if (!hasDb() || !list.length) return new Set();
  const rows = await getDb()
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(inArray(emailSuppressions.email, list));
  return new Set(rows.map((r) => r.email));
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
