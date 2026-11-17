// The figures of a past event shown with its recap (the event page's Recap section and the
// newsletter's Event recap block): people who came, companies, the feedback rating, speakers.
// Counts only, never names. recapFigures is pure (unit tested); loadRecapFigures reads D1.
import { and, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { eventFeedback, eventSpeakers, registrations } from '../db/schema';

export interface RecapFigure {
  value: string;
  label: string;
}

/** Fewer ratings than this and the average says little: it isn't shown. */
export const MIN_RATINGS_SHOWN = 3;

/** Company names that don't name a company. */
const NOT_A_COMPANY =
  /^(-+|n\/?a|none|no|nil|self|self[- ]employed|freelance(r)?|student|independent|\.)$/i;

export function recapFigures(input: {
  registrations: { status: string; guests: number; company: string | null }[];
  ratings: number[];
  speakers: number;
}): RecapFigure[] {
  const out: RecapFigure[] = [];
  const attended = input.registrations.filter((r) => r.status === 'attended');
  // Check-in used: the people who came. Otherwise the people registered.
  const counted = attended.length
    ? attended
    : input.registrations.filter((r) => r.status === 'registered');
  const people = counted.reduce((n, r) => n + 1 + Math.max(0, r.guests || 0), 0);
  if (people > 0)
    out.push({ value: String(people), label: attended.length ? 'attendees' : 'registered' });
  const companies = new Set(
    counted
      .map((r) => (r.company ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
      .filter((c) => c && !NOT_A_COMPANY.test(c)),
  );
  if (companies.size >= 2) out.push({ value: String(companies.size), label: 'companies' });
  const ratings = input.ratings.filter((r) => r >= 1 && r <= 5);
  if (ratings.length >= MIN_RATINGS_SHOWN) {
    const avg = ratings.reduce((s, r) => s + r, 0) / ratings.length;
    out.push({
      value: `${avg.toFixed(1).replace(/\.0$/, '')}/5`,
      label: `feedback (${ratings.length} ratings)`,
    });
  }
  if (input.speakers > 0)
    out.push({
      value: String(input.speakers),
      label: input.speakers === 1 ? 'speaker' : 'speakers',
    });
  return out;
}

/** The figures of each event, by event id. */
export async function loadRecapFigures(eventIds: number[]): Promise<Map<number, RecapFigure[]>> {
  const out = new Map<number, RecapFigure[]>();
  if (!eventIds.length) return out;
  const db = getDb();
  const [regs, ratings, speakers] = await Promise.all([
    db
      .select({
        eventId: registrations.eventId,
        status: registrations.status,
        guests: registrations.guests,
        company: registrations.company,
      })
      .from(registrations)
      .where(
        and(
          inArray(registrations.eventId, eventIds),
          inArray(registrations.status, ['registered', 'attended']),
        ),
      ),
    db
      .select({ eventId: eventFeedback.eventId, rating: eventFeedback.rating })
      .from(eventFeedback)
      .where(inArray(eventFeedback.eventId, eventIds)),
    db
      .select({ eventId: eventSpeakers.eventId, n: sql<number>`count(*)` })
      .from(eventSpeakers)
      .where(inArray(eventSpeakers.eventId, eventIds))
      .groupBy(eventSpeakers.eventId),
  ]);
  for (const id of eventIds)
    out.set(
      id,
      recapFigures({
        registrations: regs.filter((r) => r.eventId === id),
        ratings: ratings.filter((r) => r.eventId === id).map((r) => r.rating),
        speakers: Number(speakers.find((s) => s.eventId === id)?.n ?? 0),
      }),
    );
  return out;
}

/** One event's figures. */
export async function recapFiguresFor(eventId: number) {
  return (await loadRecapFigures([eventId])).get(eventId) ?? [];
}
