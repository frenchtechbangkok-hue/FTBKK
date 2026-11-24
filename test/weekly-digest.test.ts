import { describe, expect, it } from 'vitest';
import {
  type DigestData,
  type DigestEvent,
  digestVars,
  digestWindow,
  isDigestDay,
  weekLabel,
} from '../src/lib/weekly-digest';

// Monday 23 November 2026, 09:00 Bangkok.
const now = new Date('2026-11-23T02:00:00Z');
const w = digestWindow(now);

const event = (o: Partial<DigestEvent>): DigestEvent => ({
  title: 'French Tech Connect',
  startsAt: new Date('2026-11-19T11:30:00Z'),
  endsAt: new Date('2026-11-19T14:00:00Z'),
  status: 'published',
  capacity: null,
  noRegistration: false,
  registered: 0,
  attended: 0,
  waitlist: 0,
  ...o,
});

const empty: DigestData = {
  ...w,
  heldEvents: [],
  registrations: 0,
  newMembers: 0,
  listingsSubmitted: 0,
  postsPublished: [],
  messages: 0,
  newslettersSent: [],
  communityEmails: [],
  socialSent: 0,
  upcomingEvents: [],
  newslettersScheduled: [],
  socialScheduled: 0,
  listingRenewals: [],
  memberRenewals: 0,
  waiting: {
    directory: 0,
    directoryOldest: 0,
    directoryLate: false,
    messages: 0,
    members: 0,
    socialFailed: 0,
    renewals: 0,
    drafts: 0,
  },
};

describe('weekly digest', () => {
  it('goes out on Mondays, Bangkok time', () => {
    expect(isDigestDay(now)).toBe(true);
    // Sunday 23:30 UTC is already Monday in Bangkok.
    expect(isDigestDay(new Date('2026-11-22T23:30:00Z'))).toBe(true);
    expect(isDigestDay(new Date('2026-11-24T02:00:00Z'))).toBe(false);
  });

  it('covers last week Monday to Sunday and the coming week', () => {
    expect(w.from.toISOString()).toBe('2026-11-15T17:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-11-22T17:00:00.000Z');
    expect(w.until.toISOString()).toBe('2026-11-29T17:00:00.000Z');
    expect(weekLabel(w.from, w.to)).toBe('16–22 November');
    expect(weekLabel(new Date('2026-11-29T17:00:00Z'), new Date('2026-12-06T17:00:00Z'))).toBe(
      '30 November – 6 December',
    );
  });

  it('still says something when the week was quiet', () => {
    expect(digestVars(empty)).toEqual({
      week: '16–22 November',
      next: '23–29 November',
      todo: 'nothing to do',
      lastWeek: ['A quiet week: nothing new.'],
      comingWeek: ['Nothing planned yet.'],
      pending: ['Nothing waiting, all clear.'],
    });
  });

  it('lists last week, the coming week and what waits', () => {
    const v = digestVars({
      ...empty,
      heldEvents: [event({ registered: 80, attended: 64 })],
      registrations: 1,
      newMembers: 5,
      postsPublished: ['Hello Bangkok'],
      newslettersSent: [{ subject: 'November news', recipients: 1204 }],
      messages: 2,
      upcomingEvents: [
        event({
          title: 'Talk',
          startsAt: new Date('2026-11-26T11:30:00Z'),
          endsAt: null,
          capacity: 60,
          registered: 38,
          waitlist: 3,
        }),
        event({
          title: 'Select',
          startsAt: new Date('2026-11-27T11:30:00Z'),
          endsAt: null,
          status: 'draft',
        }),
      ],
      socialScheduled: 2,
      listingRenewals: [
        { name: 'Lotus Labs', renewalDueAt: new Date('2026-11-27T00:00:00Z'), claimed: false },
      ],
      waiting: { ...empty.waiting, directory: 2, directoryOldest: 6, messages: 1 },
    });
    expect(v.lastWeek).toEqual([
      'Event: French Tech Connect, 64 checked in of 80 registrations',
      '1 new event registration',
      '5 new members',
      'Blog post published: Hello Bangkok',
      'Newsletter sent: November news (1,204 recipients)',
      '2 messages from the contact form',
    ]);
    expect(v.comingWeek).toEqual([
      'Event: Talk, Thu, 26 November 2026, 18:30 (38/60 seats taken, 3 on the waitlist)',
      'Event not published yet: Select, Fri, 27 November 2026, 18:30',
      '2 social media posts scheduled',
      'Listing renewal due: Lotus Labs, 27 November (unclaimed, invite someone to claim it)',
    ]);
    expect(v.pending).toEqual([
      '2 listings to review in the directory (oldest 6 days)',
      '1 unread message',
    ]);
    expect(v.todo).toBe('3 things to do');
  });
});
