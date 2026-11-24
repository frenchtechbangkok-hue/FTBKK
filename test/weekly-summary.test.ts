import { describe, expect, it } from 'vitest';
import {
  count,
  draftLine,
  heldLine,
  isMonday,
  listingLine,
  newMembersCount,
  partsOn,
  summaryCounts,
  summaryLines,
  upcomingLine,
  withSummary,
  type SummaryData,
} from '../src/lib/weekly-summary';
import { newMemberLine } from '../src/lib/members';
import type { Member } from '../src/db/schema';

const member = (over: Partial<Member>): Member =>
  ({
    name: 'Camille Martin',
    email: 'camille@example.com',
    profileType: 'founder',
    company: 'Siam Robotics',
    jobTitle: 'CEO',
    howHeard: 'LinkedIn',
    memberSince: new Date('2026-11-18T05:00:00Z'),
    ...over,
  }) as Member;

describe('weekly summary: new members', () => {
  it('describes each new member on one line', () => {
    expect(newMemberLine(member({}))).toBe(
      'New member: Camille Martin (camille@example.com), CEO, Siam Robotics. Founder or co-founder, heard of us via LinkedIn, joined 18 November 2026.',
    );
    expect(
      newMemberLine(
        member({ company: null, jobTitle: null, howHeard: null, profileType: 'student' }),
      ),
    ).toBe('New member: Camille Martin (camille@example.com). Student, joined 18 November 2026.');
  });

  it('counts them in words', () => {
    expect(newMembersCount(0)).toBe('no new member');
    expect(newMembersCount(1)).toBe('1 new member');
    expect(newMembersCount(3)).toBe('3 new members');
  });

  it('adds the summary to a text saved before it existed', () => {
    const old = { subject: 'S', body: 'Hi', buttonLabel: 'Go' };
    expect(withSummary(old)!.body).toBe('Hi\n\n{summary}');
    const recent = { ...old, body: 'Hi {summary}' };
    expect(withSummary(recent)).toBe(recent);
    expect(withSummary(null)).toBeNull();
  });
});

const now = new Date('2026-11-24T02:00:00Z');
const ev = {
  title: 'Connect',
  startsAt: new Date('2026-11-27T11:30:00Z'),
  endsAt: null,
  newThisWeek: 12,
  registered: 64,
  waitlist: 3,
  attended: 0,
  past: false,
};
const data = {
  since: new Date('2026-11-17T02:00:00Z'),
  until: new Date('2026-12-01T02:00:00Z'),
  joined: [member({})],
  toReview: 5,
  queue: { pendingOrgs: [], changes: [], pendingClaims: [], applications: [] },
  ages: [],
  held: [],
  upcoming: [ev],
  drafts: [{ title: 'Data centres', updatedAt: new Date('2026-11-21T05:00:00Z') }],
  published: [],
  listings: [],
  messages: 3,
  unread: 1,
  sent: [],
  scheduledNewsletters: [],
  scheduledSocial: [],
  renewing: [],
  socialFailed: 0,
  expiring: [],
} as unknown as SummaryData;

describe('weekly summary: the parts', () => {
  it('counts in words', () => {
    expect(count(0, 'post')).toBe('no post');
    expect(count(4, 'post')).toBe('4 posts');
    expect(summaryCounts(data)).toEqual({
      members: '1 new member',
      registrations: '12 new registrations',
      todo: '7 things to do',
    });
  });

  it('describes events, drafts and listings', () => {
    expect(upcomingLine(ev)).toMatch(/^Connect, .+: 64 registered, 3 on the waiting list\.$/);
    expect(heldLine({ ...ev, registered: 2, attended: 40 })).toMatch(
      /: 40 came of 42 registered\.$/,
    );
    expect(draftLine(data.drafts[0]!)).toBe('Data centres (last edited 21 November 2026).');
    const since = new Date('2026-11-17T02:00:00Z');
    const created = new Date('2026-11-20T02:00:00Z');
    const old = new Date('2026-10-01T02:00:00Z');
    expect(listingLine({ name: 'Acme', status: 'published', createdAt: created }, since)).toBe(
      'Acme: added and published.',
    );
    expect(listingLine({ name: 'Acme', status: 'published', createdAt: old }, since)).toBe(
      'Acme: published.',
    );
    expect(listingLine({ name: 'Acme', status: 'pending', createdAt: created }, since)).toBe(
      'Acme: added, waiting for review.',
    );
  });

  it('shows the three groups with every part on', () => {
    const lines = summaryLines(data, partsOn([]), now);
    expect(lines.filter((l) => l === l.toUpperCase() && /[A-Z]/.test(l))).toEqual([
      'THIS WEEK (TUE 17 NOV TO TUE 24 NOV)',
      'COMING UP (TO TUE 1 DEC)',
      'TO DO',
    ]);
    expect(lines).toContain('New members: 1.');
    expect(lines).toContain('Event registrations: 12 new registrations.');
    expect(lines).toContain('Messages received: 3.');
    expect(lines).toContain('Members to review: 5.');
    expect(lines).toContain('Directory to review: nothing waiting.');
  });

  it('leaves out the parts switched off, and a group with none left', () => {
    const on = partsOn(['upcoming-events', 'scheduled', 'member-renewals', 'messages']);
    const lines = summaryLines(data, on, now);
    expect(lines.some((l) => l.startsWith('COMING UP'))).toBe(false);
    expect(lines).not.toContain('Messages received: 3.');
    expect(lines).toContain('New members: 1.');
  });

  it('runs on Mondays, Bangkok time', () => {
    expect(isMonday(new Date('2026-11-23T02:00:00Z'))).toBe(true);
    expect(isMonday(new Date('2026-11-23T18:00:00Z'))).toBe(false);
  });
});
