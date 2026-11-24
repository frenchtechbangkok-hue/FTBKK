import { env } from 'cloudflare:workers';
import { and, asc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { events, members, registrations, type Event } from '../db/schema';
import { bangkokDay } from './cron-events';
import {
  EMAIL_TEMPLATES,
  applyTemplate,
  loadTemplateText,
  type EmailText,
} from './email-templates';
import { sendEmail } from './email';
import { formatEventDate } from './format';
import { DAY_MS } from './lifecycle';
import { adminNotifyEmails } from './orgs';
import { attendeeNotes } from './registrations';
import { earlierAttendance, earlierFor } from './regulars';
import { getSettings } from './settings';
import { siteUrl } from './site';

/**
 * The day-before email to the team (Settings > General > Admin notifications): at 9:00 Bangkok the
 * day before each published event with registration, a reminder with the key figures, what
 * attendees told us when registering and the link to the check-in page. Once per event
 * (events.team_reminder_sent_at). Settings > General switches it off; Emails > Event tomorrow
 * (team) edits its words.
 */

export const EVE_KEY = 'admin.event-tomorrow';

/** "New members" = registrants who became members in the last this many days. */
export const NEW_MEMBER_DAYS = 30;

type EveEvent = Pick<Event, 'status' | 'noRegistration' | 'startsAt' | 'teamReminderSentAt'>;

/**
 * Whether the team email is due for an event in this morning's run: published, with registration,
 * not sent yet, not started, and on tomorrow's Bangkok date. An event of today that never got it
 * (published after yesterday's run) gets it this morning instead.
 */
export function eveDue(e: EveEvent, now: Date): boolean {
  if (e.status !== 'published' || e.noRegistration || e.teamReminderSentAt) return false;
  if (e.startsAt <= now) return false;
  const day = bangkokDay(e.startsAt);
  return day === bangkokDay(now) || day === bangkokDay(new Date(now.getTime() + DAY_MS));
}

export interface EveRow {
  name: string;
  email: string | null;
  company: string | null;
  note: string | null;
  status: string;
  guests: number;
  createdAt: Date | null;
  id: number;
}

export interface EveFigures {
  people: number;
  guests: number;
  capacity: number | null;
  waitlist: number;
  firstTime: number;
  newMembers: number;
  notes: number;
}

/** "no one registered", "1 registered", "64 registered" (guests not counted). */
export const registeredCount = (n: number) => (n ? `${n} registered` : 'no one registered yet');

/** The key figures, one paragraph each. */
export function figureLines(f: EveFigures): string[] {
  const seats = f.people + f.guests;
  const extra = [
    f.guests ? `plus ${f.guests} guest${f.guests === 1 ? '' : 's'}` : '',
    f.capacity ? `${seats} seats of ${f.capacity}` : '',
  ].filter(Boolean);
  return [
    'KEY FIGURES',
    `Registered: ${f.people} ${f.people === 1 ? 'person' : 'people'}${extra.length ? `, ${extra.join(', ')}` : ''}.`,
    `Waiting list: ${f.waitlist || 'none'}.`,
    `First time at one of our events: ${f.firstTime || 'none'}.`,
    `New members (joined in the last ${NEW_MEMBER_DAYS} days): ${f.newMembers || 'none'}.`,
    `Left a message: ${f.notes || 'none'}.`,
  ];
}

/** What attendees told us, with their names; registered first, then the waiting list. */
export function noteLines(rows: EveRow[]): string[] {
  const notes = attendeeNotes(rows);
  if (!notes.length) return ['WHAT ATTENDEES TOLD US', 'Nobody left a message.'];
  return [
    'WHAT ATTENDEES TOLD US',
    ...notes.map((r) => {
      const about = [r.company?.trim(), r.status === 'waitlist' ? 'waiting list' : '']
        .filter(Boolean)
        .join(', ');
      const note = (r.note ?? '').replace(/\s+/g, ' ').trim();
      return `${r.name}${about ? ` (${about})` : ''}: ${note}`;
    }),
  ];
}

const coming = (status: string) => status === 'registered' || status === 'attended';

/** Figures and notes of one event, from its registrations. */
export async function eveData(e: Event, now: Date) {
  const db = getDb();
  const rows: EveRow[] = await db
    .select({
      id: registrations.id,
      name: registrations.name,
      email: registrations.email,
      company: registrations.company,
      note: registrations.note,
      status: registrations.status,
      guests: registrations.guests,
      createdAt: registrations.createdAt,
    })
    .from(registrations)
    .where(eq(registrations.eventId, e.id));
  const here = rows.filter((r) => coming(r.status));
  const emails = [
    ...new Set(here.map((r) => r.email?.trim().toLowerCase()).filter((x): x is string => !!x)),
  ];
  const [earlier, fresh] = await Promise.all([
    earlierAttendance(e),
    emails.length
      ? db
          .select({ email: members.email })
          .from(members)
          .where(
            and(
              eq(members.status, 'active'),
              gte(members.memberSince, new Date(now.getTime() - NEW_MEMBER_DAYS * DAY_MS)),
              inArray(sql<string>`lower(${members.email})`, emails),
            ),
          )
      : Promise.resolve([]),
  ]);
  const figures: EveFigures = {
    people: here.length,
    guests: here.reduce((t, r) => t + (r.guests ?? 0), 0),
    capacity: e.capacity,
    waitlist: rows.filter((r) => r.status === 'waitlist').length,
    firstTime: here.filter((r) => earlierFor(earlier, r.email) === 0).length,
    newMembers: fresh.length,
    notes: attendeeNotes(rows).length,
  };
  return { figures, rows };
}

/** The email for one event. `text` replaces the saved words (the admin's "Send me" button). */
export async function eveEmail(e: Event, now: Date, text?: EmailText | null) {
  const [{ figures, rows }, settings, saved] = await Promise.all([
    eveData(e, now),
    getSettings(),
    text === undefined ? loadTemplateText(EVE_KEY) : Promise.resolve(text),
  ]);
  const checkin = siteUrl(`/admin/events/${e.id}/checkin`);
  const w = applyTemplate(EMAIL_TEMPLATES[EVE_KEY], saved, {
    event: e.title,
    day: bangkokDay(e.startsAt) === bangkokDay(now) ? 'today' : 'tomorrow',
    date: [formatEventDate(e.startsAt, e.endsAt), e.venue].filter(Boolean).join(', '),
    registered: registeredCount(figures.people),
    figures: figureLines(figures),
    notes: noteLines(rows),
    checkin,
  });
  return {
    to: await adminNotifyEmails(settings),
    subject: w.subject,
    campaign: w.campaign,
    paragraphs: w.paragraphs,
    bodyHtml: w.bodyHtml,
    action: { label: w.buttonLabel, url: checkin },
  };
}

/** The next published event with registration that hasn't started, for the admin's test. */
export async function nextEventWithRegistration(now: Date) {
  const [e] = await getDb()
    .select()
    .from(events)
    .where(
      and(
        eq(events.status, 'published'),
        eq(events.noRegistration, false),
        gt(events.startsAt, now),
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(1);
  return e ?? null;
}

/** Daily job: the email for every event of tomorrow (Bangkok), once per event. */
export async function sendEventEveEmails(now: Date) {
  if (!(await getSettings()).teamEventReminder) return 'off';
  const soon = await getDb()
    .select()
    .from(events)
    .where(
      and(
        eq(events.status, 'published'),
        gt(events.startsAt, now),
        lt(events.startsAt, new Date(now.getTime() + 2 * DAY_MS)),
      ),
    );
  let sent = 0;
  for (const e of soon.filter((e) => eveDue(e, now))) {
    // Mark first so two runs never both send; unmark when sending failed, for the next run.
    const { results } = await env.DB.prepare(
      `UPDATE events SET team_reminder_sent_at = unixepoch()
       WHERE id = ? AND team_reminder_sent_at IS NULL RETURNING id`,
    )
      .bind(e.id)
      .all();
    if (!results.length) continue;
    const res = await sendEmail(await eveEmail(e, now)).catch((err: unknown) => ({
      ok: false,
      error: String(err),
    }));
    if (res.ok) {
      sent++;
    } else {
      console.error(`[cron] team email for event ${e.id} not sent: ${res.error}`);
      await env.DB.prepare('UPDATE events SET team_reminder_sent_at = NULL WHERE id = ?')
        .bind(e.id)
        .run();
    }
  }
  return { teamEmails: sent };
}
