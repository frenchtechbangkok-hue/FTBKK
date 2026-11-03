// Reports > Events and attendance, computed in memory from events, registrations, feedback and
// members: one row per event, totals for a period and an event type, and one event in detail.

import { DAY_MS } from './lifecycle';
import { eventKind, type EventKind } from './event-covers';
import { feedbackSummary, type FeedbackSummary } from './feedback';
import { inPeriod, periodBuckets } from './report-period';

export interface StatEvent {
  id: number;
  title: string;
  series: string;
  startsAt: Date;
  capacity: number | null;
  status: string;
}

export interface StatRegistration {
  eventId: number;
  /** For the most regular attendees. */
  name?: string;
  /** Null for walk-ins added at the door without an email. */
  email: string | null;
  status: 'registered' | 'waitlist' | 'cancelled' | 'attended';
  createdAt: Date;
  checkedInAt: Date | null;
  howHeard: string | null;
  /** Anonymous guests coming with them; each counts as one more person. */
  guests?: number;
  walkIn?: boolean;
  company?: string | null;
  feedbackSentAt?: Date | null;
}

export interface StatFeedback {
  eventId: number;
  rating: number;
  comment?: string | null;
  createdAt: Date;
}

export interface StatMember {
  email: string;
  status: string;
  /** First joined; confirmedAt moves to the renewal day when a member renews. */
  memberSince?: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
}

export const KIND_LABELS: Record<EventKind, string> = {
  connect: 'Connect',
  talk: 'Talk',
  select: 'Select',
  other: 'Other',
};

/** People a registration stands for: the person plus their guests. */
const people = (r: StatRegistration) => 1 + (r.guests ?? 0);
const sum = (rs: StatRegistration[]) => rs.reduce((n, r) => n + people(r), 0);
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const emailOf = (e: string | null | undefined) => e?.trim().toLowerCase() || null;

export interface EventFeedback extends FeedbackSummary {
  /** Registrations the day-after email went to. */
  emailed: number;
  responseRate: number | null;
}

export interface EventRow {
  event: StatEvent;
  kind: EventKind;
  past: boolean;
  /** Seats taken: registered + checked in, with guests. */
  registered: number;
  attended: number;
  waitlist: number;
  cancelled: number;
  /** attended / registered, for past events where check-in was used; else null. */
  showUp: number | null;
  noShows: number | null;
  /** registered / capacity, when the event had a capacity. */
  fill: number | null;
  walkIns: number;
  guests: number;
  /** Named people who came: checked in, or registered when check-in wasn't used. */
  came: number;
  counted: 'checked in' | 'registered';
  /** Of them, people seen at none of our earlier events. */
  firstTimers: number;
  /** Of them, people who had come to an earlier event. */
  returning: number;
  /** Of them, members on the day of the event. */
  members: number;
  feedback: EventFeedback;
  /** Lowercased emails of the people who came (for unique counts). */
  emails: string[];
}

/** Every event but drafts, newest first, with its numbers. */
export function eventRows(
  events: StatEvent[],
  regs: StatRegistration[],
  feedback: StatFeedback[],
  members: StatMember[],
  now: Date,
): EventRow[] {
  const byEvent = group(regs, (r) => r.eventId);
  const fbByEvent = group(feedback, (f) => f.eventId);
  const memberSince = new Map(
    members
      .filter((m) => m.status !== 'pending')
      .map((m) => [m.email.toLowerCase(), m.memberSince ?? m.confirmedAt ?? m.createdAt]),
  );
  const seen = new Set<string>();
  const rows = events
    .filter((e) => e.status !== 'draft')
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((event): EventRow => {
      const rs = byEvent.get(event.id) ?? [];
      const by = (s: StatRegistration['status']) => rs.filter((r) => r.status === s);
      const checkedIn = by('attended');
      const attended = sum(checkedIn);
      const registered = sum(by('registered')) + attended;
      const past = event.startsAt < now;
      const showUp = past && attended > 0 && registered > 0 ? attended / registered : null;
      const came = checkedIn.length ? checkedIn : past ? by('registered') : [];
      const emails = [...new Set(came.map((r) => emailOf(r.email)).filter((e) => e !== null))];
      const firstTimers = emails.filter((e) => !seen.has(e)).length;
      if (past) for (const e of emails) seen.add(e);
      const fb = feedbackSummary(fbByEvent.get(event.id) ?? []);
      const emailed = rs.filter((r) => r.feedbackSentAt).length;
      return {
        event,
        kind: eventKind(event.series),
        past,
        registered,
        attended,
        waitlist: sum(by('waitlist')),
        cancelled: sum(by('cancelled')),
        showUp,
        noShows: showUp === null ? null : registered - attended,
        fill: event.capacity ? registered / event.capacity : null,
        walkIns: sum(rs.filter((r) => r.walkIn && r.status !== 'cancelled')),
        guests: rs
          .filter((r) => r.status === 'registered' || r.status === 'attended')
          .reduce((n, r) => n + (r.guests ?? 0), 0),
        came: came.length,
        counted: checkedIn.length ? 'checked in' : 'registered',
        firstTimers,
        returning: emails.length - firstTimers,
        members: emails.filter((e) => {
          const since = memberSince.get(e);
          return !!since && since <= event.startsAt;
        }).length,
        feedback: {
          ...fb,
          emailed,
          responseRate: emailed ? Math.min(1, fb.responses / emailed) : null,
        },
        emails,
      };
    });
  return rows.reverse();
}

export type Totals = ReturnType<typeof totals>;

/** Totals over a set of event rows. */
export function totals(rows: EventRow[]) {
  const past = rows.filter((r) => r.past);
  const checked = past.filter((r) => r.showUp !== null);
  const withRegs = past.filter((r) => r.registered > 0);
  const withCapacity = past.filter((r) => r.fill !== null);
  const s = (pick: (r: EventRow) => number, rs = rows) => rs.reduce((n, r) => n + pick(r), 0);
  const attendedChecked = s((r) => r.attended, checked);
  const registeredChecked = s((r) => r.registered, checked);
  const showUp = ratio(attendedChecked, registeredChecked);
  const came = s((r) => r.came, past);
  const known = s((r) => r.firstTimers + r.returning, past);
  const visits = new Map<string, number>();
  for (const r of past) for (const e of r.emails) visits.set(e, (visits.get(e) ?? 0) + 1);
  const responses = s((r) => r.feedback.responses);
  const ratingSum = s((r) => r.feedback.distribution.reduce((n, c, i) => n + c * (i + 1), 0));
  const emailedRows = rows.filter((r) => r.feedback.emailed > 0);
  const distribution = [0, 1, 2, 3, 4].map((i) =>
    s((r) => r.feedback.distribution[i] ?? 0),
  ) as FeedbackSummary['distribution'];
  return {
    events: rows.length,
    pastEvents: past.length,
    registered: s((r) => r.registered),
    attended: s((r) => r.attended),
    showUp,
    noShowRate: showUp === null ? null : 1 - showUp,
    noShows: registeredChecked - attendedChecked,
    avgRegistered: withRegs.length ? s((r) => r.registered, withRegs) / withRegs.length : null,
    avgAttended: checked.length ? attendedChecked / checked.length : null,
    fill: ratio(
      s((r) => r.registered, withCapacity),
      withCapacity.reduce((n, r) => n + (r.event.capacity ?? 0), 0),
    ),
    walkIns: s((r) => r.walkIns),
    guests: s((r) => r.guests),
    cancelled: s((r) => r.cancelled),
    cancelRate: ratio(
      s((r) => r.cancelled),
      s((r) => r.registered + r.cancelled),
    ),
    waitlist: s((r) => r.waitlist),
    came,
    firstTimers: s((r) => r.firstTimers, past),
    returning: s((r) => r.returning, past),
    newShare: ratio(
      s((r) => r.firstTimers, past),
      known,
    ),
    memberShare: ratio(
      s((r) => r.members, past),
      known,
    ),
    uniqueAttendees: visits.size,
    cameTwice: [...visits.values()].filter((n) => n > 1).length,
    feedback: {
      responses,
      average: responses ? ratingSum / responses : null,
      distribution,
      comments: s((r) => r.feedback.comments),
      emailed: s((r) => r.feedback.emailed),
      responseRate: ratio(
        s((r) => r.feedback.responses, emailedRows),
        s((r) => r.feedback.emailed, emailedRows),
      ),
    },
  };
}

export interface ReportFilter {
  period: { from: Date; to: Date };
  previous: { from: Date; to: Date } | null;
  kind: EventKind | null;
}

/** The overview: events of the period (and type), totals, trends and feedback. */
export function eventReport(
  rows: EventRow[],
  regs: StatRegistration[],
  feedback: StatFeedback[],
  f: ReportFilter,
  now: Date,
) {
  const ofKind = rows.filter((r) => !f.kind || r.kind === f.kind);
  const selected = ofKind.filter((r) => inPeriod(r.event.startsAt, f.period));
  const ids = new Set(ofKind.map((r) => r.event.id));
  const selectedIds = new Set(selected.map((r) => r.event.id));
  const kindRegs = regs.filter((r) => ids.has(r.eventId));

  // New registrations and check-ins over time, in the period.
  const { unit, buckets } = periodBuckets(f.period);
  const per = (pick: (r: StatRegistration) => Date | null) =>
    buckets.map((b) =>
      sum(
        kindRegs.filter((r) => {
          const d = pick(r);
          return inPeriod(d, b) && inPeriod(d, f.period);
        }),
      ),
    );
  const overTime = {
    unit,
    labels: buckets.map((b) => b.label),
    registrations: per((r) => (r.status === 'cancelled' ? null : r.createdAt)),
    checkIns: per((r) => r.checkedInAt),
  };

  // Past events with registrations, oldest first (the last 24 of the period).
  const trend = selected
    .filter((r) => r.past && r.registered > 0)
    .slice(0, 24)
    .reverse();

  // How people heard about the events.
  const heard = new Map<string, number>();
  for (const r of regs) {
    if (!selectedIds.has(r.eventId) || r.status === 'cancelled') continue;
    const k = r.howHeard?.trim() || 'Not answered';
    heard.set(k, (heard.get(k) ?? 0) + 1);
  }

  // Each type side by side, for the period (whatever type is picked).
  const inP = rows.filter((r) => inPeriod(r.event.startsAt, f.period));
  const byKind = (Object.keys(KIND_LABELS) as EventKind[])
    .map((kind) => ({
      kind,
      label: KIND_LABELS[kind],
      t: totals(inP.filter((r) => r.kind === kind)),
    }))
    .filter((k) => k.t.events > 0);

  // Latest comments of the period's events (no names: this page is shown to the board).
  const titles = new Map(selected.map((r) => [r.event.id, r.event]));
  const comments = feedback
    .filter((x) => selectedIds.has(x.eventId) && x.comment?.trim())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 8)
    .map((x) => ({ ...x, event: titles.get(x.eventId)! }));

  const upcoming = rows
    .filter((r) => !r.past && r.event.status === 'published')
    .sort((a, b) => a.event.startsAt.getTime() - b.event.startsAt.getTime());

  const selectedPast = selected.filter((r) => r.past);
  const pastIds = new Set(selectedPast.map((r) => r.event.id));
  const pastRegs = regs.filter((r) => pastIds.has(r.eventId));
  const startOf = new Map(selectedPast.map((r) => [r.event.id, r.event.startsAt]));

  return {
    rows: selected,
    totals: totals(selected),
    previous: f.previous
      ? totals(ofKind.filter((r) => inPeriod(r.event.startsAt, f.previous!)))
      : null,
    overTime,
    trend,
    howHeard: [...heard.entries()].sort((a, b) => b[1] - a[1]),
    byKind,
    comments,
    next: upcoming[0] ?? null,
    upcomingCount: upcoming.length,
    pace: upcoming[0] ? pace(upcoming[0], rows, regs, now) : null,
    upcoming: upcoming.slice(0, 5).map((r) => comingUp(r, rows, regs, now)),
    leadTime: leadTime(pastRegs, startOf),
    companies: companies(pastRegs, selectedPast),
    regulars: regulars(pastRegs, selectedPast),
  };
}

/**
 * How early people register for the period's past events: registrations made on this site (not
 * walk-ins), by days before the event, and the median.
 */
export const LEAD_BANDS = [
  { label: 'On the day', upTo: 1 },
  { label: '1 to 3 days before', upTo: 4 },
  { label: '4 to 7 days before', upTo: 8 },
  { label: '1 to 2 weeks before', upTo: 15 },
  { label: '2 to 4 weeks before', upTo: 29 },
  { label: 'Earlier', upTo: Infinity },
] as const;

export function leadTime(regs: StatRegistration[], startOf: Map<number, Date>) {
  const days: number[] = [];
  for (const r of regs) {
    const start = startOf.get(r.eventId);
    if (!start || r.walkIn || r.status === 'waitlist') continue;
    const d = (start.getTime() - r.createdAt.getTime()) / DAY_MS;
    if (d >= 0) days.push(d);
  }
  days.sort((a, b) => a - b);
  const counts = LEAD_BANDS.map(() => 0);
  for (const d of days) counts[LEAD_BANDS.findIndex((b) => d < b.upTo)]! += 1;
  const mid = days.length ? days[Math.floor((days.length - 1) / 2)]! : null;
  return {
    registrations: days.length,
    bands: LEAD_BANDS.map((b, i) => [b.label, counts[i]!] as [string, number]),
    /** Whole days before the event by which half the registrations were in. */
    median: mid === null ? null : Math.floor(mid),
    lastWeek: ratio(days.filter((d) => d < 8).length, days.length),
  };
}

/** Who came: checked in, or registered at events where check-in wasn't used. */
function cameRegs(regs: StatRegistration[], rows: EventRow[]) {
  const counted = new Map(rows.map((r) => [r.event.id, r.counted]));
  return regs.filter((r) =>
    counted.get(r.eventId) === 'checked in' ? r.status === 'attended' : r.status === 'registered',
  );
}

/** The companies people came from most often: people and events, top 10. */
export function companies(regs: StatRegistration[], rows: EventRow[]) {
  const by = new Map<string, { name: string; people: number; events: Set<number> }>();
  for (const r of cameRegs(regs, rows)) {
    const name = r.company?.trim();
    if (!name || /^(n\/?a|none|-|self[- ]?employed|freelance)$/i.test(name)) continue;
    const key = name.toLowerCase();
    const c = by.get(key) ?? { name, people: 0, events: new Set<number>() };
    c.people += 1;
    c.events.add(r.eventId);
    by.set(key, c);
  }
  return [...by.values()]
    .map((c) => ({ name: c.name, people: c.people, events: c.events.size }))
    .sort((a, b) => b.people - a.people || b.events - a.events || a.name.localeCompare(b.name))
    .slice(0, 10);
}

/** The people who came to the most events of the period (named people, two events or more). */
export function regulars(regs: StatRegistration[], rows: EventRow[]) {
  const startOf = new Map(rows.map((r) => [r.event.id, r.event.startsAt]));
  const by = new Map<string, { email: string; name: string; events: number; last: Date }>();
  for (const r of cameRegs(regs, rows)) {
    const email = emailOf(r.email);
    if (!email) continue;
    const at = startOf.get(r.eventId)!;
    const p = by.get(email) ?? { email, name: r.name?.trim() || email, events: 0, last: at };
    p.events += 1;
    if (at >= p.last) {
      p.last = at;
      if (r.name?.trim()) p.name = r.name.trim();
    }
    by.set(email, p);
  }
  return [...by.values()]
    .filter((p) => p.events > 1)
    .sort((a, b) => b.events - a.events || b.last.getTime() - a.last.getTime())
    .slice(0, 10);
}

/**
 * An upcoming event with its seats taken, and the usual at the same number of days before: the
 * average of its type's events in the 12 months before.
 */
export function comingUp(row: EventRow, rows: EventRow[], regs: StatRegistration[], now: Date) {
  const before = row.event.startsAt.getTime() - now.getTime();
  const daysToGo = Math.max(0, Math.ceil(before / DAY_MS));
  const yearBefore = row.event.startsAt.getTime() - 365 * DAY_MS;
  const peers = rows.filter(
    (r) =>
      r.past && r.kind === row.kind && r.registered > 0 && r.event.startsAt.getTime() >= yearBefore,
  );
  const seatsAt = (r: EventRow) => {
    const at = r.event.startsAt.getTime() - before;
    return sum(
      regs.filter(
        (x) =>
          x.eventId === r.event.id &&
          (x.status === 'registered' || x.status === 'attended') &&
          x.createdAt.getTime() <= at,
      ),
    );
  };
  const usual = peers.length ? peers.reduce((n, r) => n + seatsAt(r), 0) / peers.length : null;
  return { row, daysToGo, usual, usualCount: peers.length };
}

/** Seats taken day by day over the 30 days before an event, next to the previous one of its type. */
export function pace(row: EventRow, rows: EventRow[], regs: StatRegistration[], now: Date) {
  const DAYS = 30;
  const curve = (r: EventRow, until: Date) => {
    const rs = regs.filter(
      (x) => x.eventId === r.event.id && (x.status === 'registered' || x.status === 'attended'),
    );
    return Array.from({ length: DAYS + 1 }, (_, i) => {
      const at = new Date(r.event.startsAt.getTime() - (DAYS - i) * DAY_MS);
      return at > until ? null : sum(rs.filter((x) => x.createdAt <= at));
    });
  };
  const previous = rows.find(
    (r) =>
      r.past &&
      r.kind === row.kind &&
      r.registered > 0 &&
      r.event.startsAt < row.event.startsAt &&
      r.event.id !== row.event.id,
  );
  return {
    labels: Array.from({ length: DAYS + 1 }, (_, i) =>
      DAYS - i === 0 ? 'Event day' : `${DAYS - i}d`,
    ),
    current: curve(row, row.past ? row.event.startsAt : now),
    previous: previous ? curve(previous, previous.event.startsAt) : null,
    previousTitle: previous?.event.title ?? null,
  };
}

const slot = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Bangkok',
});

/** One event in detail: its numbers next to the usual for its type, and what people said. */
export function eventDetail(
  row: EventRow,
  rows: EventRow[],
  regs: StatRegistration[],
  feedback: StatFeedback[],
  now: Date,
) {
  const rs = regs.filter((r) => r.eventId === row.event.id);
  // The usual: past events of the same type in the 12 months before this one.
  const yearBefore = new Date(row.event.startsAt.getTime() - 365 * DAY_MS);
  const peers = rows.filter(
    (r) =>
      r.past &&
      r.kind === row.kind &&
      r.event.id !== row.event.id &&
      r.event.startsAt < row.event.startsAt &&
      r.event.startsAt >= yearBefore,
  );

  // Arrivals at the door, by quarter of an hour.
  const quarter = 15 * 60_000;
  const arrivals = new Map<number, number>();
  for (const r of rs) {
    if (!r.checkedInAt) continue;
    const k = Math.floor(r.checkedInAt.getTime() / quarter) * quarter;
    arrivals.set(k, (arrivals.get(k) ?? 0) + people(r));
  }
  const keys = [...arrivals.keys()].sort((a, b) => a - b);
  const door: [string, number][] = [];
  for (let k = keys[0] ?? 0; keys.length && k <= keys[keys.length - 1]!; k += quarter) {
    door.push([slot.format(new Date(k)), arrivals.get(k) ?? 0]);
  }

  const tally = (pick: (r: StatRegistration) => string | null | undefined, limit = 10) => {
    const n = new Map<string, number>();
    for (const r of rs) {
      if (r.status === 'cancelled' || r.status === 'waitlist') continue;
      const k = pick(r)?.trim();
      if (k) n.set(k, (n.get(k) ?? 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  };

  return {
    row,
    usual: peers.length ? totals(peers) : null,
    usualCount: peers.length,
    pace: pace(row, rows, regs, now),
    door: door.length > 64 ? [] : door,
    howHeard: tally((r) => r.howHeard || 'Not answered', 12),
    companies: tally((r) => r.company),
    comments: feedback
      .filter((f) => f.eventId === row.event.id && f.comment?.trim())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  };
}

function group<T, K>(items: T[], key: (t: T) => K) {
  const m = new Map<K, T[]>();
  for (const t of items) {
    const k = key(t);
    const list = m.get(k);
    if (list) list.push(t);
    else m.set(k, [t]);
  }
  return m;
}

/**
 * Who is coming to an event, for the host (Registrations): among the named people registered,
 * those never seen at an earlier event, those who came before, active members, and the companies
 * with the most people.
 */
export function whoIsComing(
  eventId: number,
  rows: EventRow[],
  regs: StatRegistration[],
  activeMembers: Set<string>,
) {
  const row = rows.find((r) => r.event.id === eventId);
  const startsAt = row?.event.startsAt;
  const seenBefore = new Set(
    rows.filter((r) => r.past && startsAt && r.event.startsAt < startsAt).flatMap((r) => r.emails),
  );
  const coming = regs.filter(
    (r) => r.eventId === eventId && (r.status === 'registered' || r.status === 'attended'),
  );
  const emails = [...new Set(coming.map((r) => emailOf(r.email)).filter((e) => e !== null))];
  const firstTimers = emails.filter((e) => !seenBefore.has(e)).length;
  const byCompany = new Map<string, { name: string; people: number }>();
  for (const r of coming) {
    const name = r.company?.trim();
    if (!name || /^(n\/?a|none|-|self[- ]?employed|freelance)$/i.test(name)) continue;
    const c = byCompany.get(name.toLowerCase()) ?? { name, people: 0 };
    c.people += 1;
    byCompany.set(name.toLowerCase(), c);
  }
  return {
    people: emails.length,
    firstTimers,
    returning: emails.length - firstTimers,
    members: emails.filter((e) => activeMembers.has(e)).length,
    companies: [...byCompany.values()]
      .filter((c) => c.people > 1)
      .sort((a, b) => b.people - a.people || a.name.localeCompare(b.name))
      .slice(0, 5),
  };
}
