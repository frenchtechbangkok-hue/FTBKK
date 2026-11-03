import { describe, expect, it } from 'vitest';
import { listingGaps } from '../src/lib/directory';
import { contactSummary } from '../src/lib/contacts';
import { isQuiet } from '../src/lib/member-list';
import { eventRows, whoIsComing, type StatRegistration } from '../src/lib/event-stats';

const now = new Date('2026-11-03T03:00:00Z');
const day = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe('Listings to complete', () => {
  const base = {
    logoKey: 'logo.png',
    descriptionMd: 'We build things.',
    pitch: null,
    website: 'https://example.com',
    updatedAt: day(-10),
  };
  it('is empty for a complete, recent listing', () => {
    expect(listingGaps(base, now)).toEqual([]);
  });
  it('names what is missing', () => {
    expect(
      listingGaps({ ...base, logoKey: null, website: ' ', updatedAt: day(-400) }, now),
    ).toEqual(['no logo', 'no website', 'not updated in 12 months']);
    expect(listingGaps({ ...base, descriptionMd: '', pitch: 'A pitch' }, now)).toEqual([]);
  });
});

describe('Quiet members', () => {
  const m = (lastCame: Date | null, createdAt = day(-400), status = 'active') => ({
    status: status as 'active',
    createdAt,
    stats: { attended: 0, noShows: 0, noShowRate: null, newsletter: false, lastCame },
  });
  it('flags active members with no event in about 6 months', () => {
    expect(isQuiet(m(day(-200)), now)).toBe(true);
    expect(isQuiet(m(day(-30)), now)).toBe(false);
    expect(isQuiet(m(null, day(-20)), now)).toBe(false);
    expect(isQuiet(m(null), now)).toBe(true);
    expect(isQuiet(m(day(-200), day(-400), 'suspended'), now)).toBe(false);
  });
});

describe("Who's coming", () => {
  const ev = (id: number, d: number) => ({
    id,
    title: `E${id}`,
    series: 'French Tech Connect',
    startsAt: day(d),
    capacity: 80,
    status: 'published',
  });
  const reg = (
    eventId: number,
    email: string,
    status: StatRegistration['status'],
    company?: string,
  ) =>
    ({
      eventId,
      email,
      status,
      createdAt: day(-60),
      checkedInAt: null,
      howHeard: null,
      company,
    }) as StatRegistration;
  const events = [ev(1, -30), ev(2, 7)];
  const regs = [
    reg(1, 'a@x.com', 'attended'),
    reg(2, 'a@x.com', 'registered', 'Lotus'),
    reg(2, 'b@x.com', 'registered', 'Lotus'),
    reg(2, 'c@x.com', 'registered', 'Mango'),
    reg(2, 'd@x.com', 'cancelled', 'Mango'),
  ];
  it('splits first-timers, returning people and members, and lists companies', () => {
    const rows = eventRows(events, regs, [], [], now);
    expect(whoIsComing(2, rows, regs, new Set(['b@x.com']))).toEqual({
      people: 3,
      firstTimers: 2,
      returning: 1,
      members: 1,
      companies: [{ name: 'Lotus', people: 2 }],
    });
  });
});

describe('Contact summary', () => {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const r = (id: number, d: number, status: 'attended' | 'registered' | 'cancelled') => ({
    status,
    event: { id, title: '', slug: '', startsAt: day(d), endsAt: null },
  });
  it('says how often and when they last came', () => {
    const c = {
      history: [r(1, -10, 'attended'), r(2, -40, 'registered'), r(3, -70, 'cancelled')],
      member: { status: 'active', memberSince: day(-100) },
      firstSeen: day(-300),
    } as never;
    expect(contactSummary(c, [1, 2, 3, 4], now, fmt)).toBe(
      `Came to 2 of the last 4 events · last came ${fmt(day(-10))} · member since ${fmt(day(-100))} · first seen ${fmt(day(-300))}`,
    );
  });
});
