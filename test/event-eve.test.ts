import { describe, expect, it } from 'vitest';
import { eveDue, figureLines, noteLines, registeredCount, type EveRow } from '../src/lib/event-eve';

// 09:00 Bangkok on Tuesday 24 November 2026.
const now = new Date('2026-11-24T02:00:00Z');
const at = (iso: string) => new Date(iso);
const base = {
  status: 'published' as const,
  noRegistration: false,
  teamReminderSentAt: null,
};

describe('eveDue', () => {
  it('is due for a published event tomorrow (Bangkok date)', () => {
    expect(eveDue({ ...base, startsAt: at('2026-11-25T11:30:00Z') }, now)).toBe(true);
    // 25 Nov 23:30 Bangkok is still tomorrow; 26 Nov 00:30 Bangkok is not.
    expect(eveDue({ ...base, startsAt: at('2026-11-25T16:30:00Z') }, now)).toBe(true);
    expect(eveDue({ ...base, startsAt: at('2026-11-25T17:30:00Z') }, now)).toBe(false);
  });

  it('catches up on an event of today that has not started', () => {
    expect(eveDue({ ...base, startsAt: at('2026-11-24T11:30:00Z') }, now)).toBe(true);
    expect(eveDue({ ...base, startsAt: at('2026-11-24T01:00:00Z') }, now)).toBe(false);
  });

  it('is sent once, and never for drafts, cancelled or no-registration events', () => {
    const startsAt = at('2026-11-25T11:30:00Z');
    expect(eveDue({ ...base, startsAt, teamReminderSentAt: now }, now)).toBe(false);
    expect(eveDue({ ...base, startsAt, status: 'draft' as const }, now)).toBe(false);
    expect(eveDue({ ...base, startsAt, status: 'cancelled' as const }, now)).toBe(false);
    expect(eveDue({ ...base, startsAt, noRegistration: true }, now)).toBe(false);
  });
});

describe('figureLines', () => {
  it('lists the key figures', () => {
    expect(
      figureLines({
        people: 64,
        guests: 3,
        capacity: 80,
        waitlist: 5,
        firstTime: 21,
        newMembers: 6,
        notes: 4,
      }),
    ).toEqual([
      'KEY FIGURES',
      'Registered: 64 people, plus 3 guests, 67 seats of 80.',
      'Waiting list: 5.',
      'First time at one of our events: 21.',
      'New members (joined in the last 30 days): 6.',
      'Left a message: 4.',
    ]);
  });

  it('says none on a quiet event', () => {
    const lines = figureLines({
      people: 1,
      guests: 0,
      capacity: null,
      waitlist: 0,
      firstTime: 0,
      newMembers: 0,
      notes: 0,
    });
    expect(lines[1]).toBe('Registered: 1 person.');
    expect(lines.slice(2).every((l) => l.endsWith(': none.'))).toBe(true);
    expect(registeredCount(0)).toBe('no one registered yet');
    expect(registeredCount(64)).toBe('64 registered');
  });
});

describe('noteLines', () => {
  const row = (r: Partial<EveRow> & { id: number }): EveRow => ({
    name: `Person ${r.id}`,
    email: null,
    company: null,
    note: null,
    status: 'registered',
    guests: 0,
    createdAt: new Date(r.id * 1000),
    ...r,
  });

  it('gives name, company and the note on one line, waiting list last, no cancelled', () => {
    expect(
      noteLines([
        row({ id: 1, status: 'waitlist', note: 'Vegetarian', company: 'Lotus Labs' }),
        row({ id: 2, note: 'Looking for\na CTO', company: 'Siam Robotics' }),
        row({ id: 3, note: 'Cancelled anyway', status: 'cancelled' }),
        row({ id: 4, note: '  ' }),
        row({ id: 5, note: 'Hello', status: 'attended' }),
      ]),
    ).toEqual([
      'WHAT ATTENDEES TOLD US',
      'Person 2 (Siam Robotics): Looking for a CTO',
      'Person 5: Hello',
      'Person 1 (Lotus Labs, waiting list): Vegetarian',
    ]);
  });

  it('says so when nobody left a message', () => {
    expect(noteLines([row({ id: 1 })])).toEqual([
      'WHAT ATTENDEES TOLD US',
      'Nobody left a message.',
    ]);
  });
});
