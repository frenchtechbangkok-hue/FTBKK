import { describe, expect, it } from 'vitest';
import {
  ago,
  dailySeries,
  daysUntil,
  firstName,
  greeting,
  sparkPoints,
  waitingItems,
  weekChange,
  weekWindow,
} from '../src/lib/dashboard';

const d = (s: string) => new Date(s);
// 10:00 in Bangkok on Tuesday 3 November 2026.
const now = d('2026-11-03T03:00:00Z');

const none = {
  directory: 0,
  directoryOldest: 0,
  directoryLate: false,
  messages: 0,
  members: 0,
  socialFailed: 0,
  renewals: 0,
  drafts: 0,
};

describe('dashboard helpers', () => {
  it('greets by Bangkok time', () => {
    expect(greeting(now)).toBe('Good morning');
    expect(greeting(d('2026-11-03T08:00:00Z'))).toBe('Good afternoon');
    expect(greeting(d('2026-11-03T12:00:00Z'))).toBe('Good evening');
    expect(firstName('  Eric Delattre ')).toBe('Eric');
    expect(firstName('')).toBeNull();
  });

  it('counts days to an event in Bangkok days', () => {
    expect(daysUntil(d('2026-11-03T11:30:00Z'), now)).toBe('today');
    expect(daysUntil(d('2026-11-03T18:00:00Z'), now)).toBe('tomorrow'); // 01:00 on the 4th
    expect(daysUntil(d('2026-11-12T11:30:00Z'), now)).toBe('in 9 days');
    expect(daysUntil(d('2026-11-03T02:00:00Z'), now)).toBe('now');
  });

  it('builds a 7-day window of Bangkok days', () => {
    const w = weekWindow(now);
    expect(w.days).toHaveLength(7);
    expect(w.from.toISOString()).toBe('2026-10-27T17:00:00.000Z');
    expect(w.previous.from.toISOString()).toBe('2026-10-20T17:00:00.000Z');
    expect(w.days[6]!.from.toISOString()).toBe('2026-11-02T17:00:00.000Z');
    const series = dailySeries(
      [d('2026-10-28T01:00:00Z'), d('2026-11-03T01:00:00Z'), d('2026-11-03T02:00:00Z'), null],
      w.days,
    );
    expect(series).toEqual([1, 0, 0, 0, 0, 0, 2]);
  });

  it('says how the week compares', () => {
    expect(weekChange(5, null)).toBeNull();
    expect(weekChange(5, 5)).toEqual({ text: 'Same as the week before', tone: 'same' });
    expect(weekChange(8, 5)).toEqual({ text: '+3 vs the week before', tone: 'up' });
    expect(weekChange(90, 100)).toEqual({ text: '−10% vs the week before', tone: 'down' });
  });

  it('draws a sparkline', () => {
    expect(sparkPoints([0, 2], 120, 28)).toBe('0,26 120,2');
    expect(sparkPoints([3])).toBe('');
  });

  it('only lists what is waiting', () => {
    expect(waitingItems(none)).toEqual([]);
    const items = waitingItems({
      ...none,
      directory: 1,
      directoryOldest: 6,
      directoryLate: true,
      renewals: 4,
      messages: 2,
    });
    expect(items.map((i) => i.label)).toEqual([
      'Listing to review in the directory',
      'Unread messages',
      'Listings to renew in the next 30 days',
    ]);
    expect(items[0]).toMatchObject({ note: 'oldest 6 days', noteAlert: true, tone: 'now' });
    expect(items[2]!.tone).toBe('soon');
  });

  it('says how long ago', () => {
    expect(ago(d('2026-11-03T02:48:00Z'), now)).toBe('12 min ago');
    expect(ago(d('2026-11-03T00:00:00Z'), now)).toBe('3 h ago');
    expect(ago(d('2026-11-02T07:05:00Z'), now)).toBe('yesterday 14:05');
    expect(ago(d('2026-10-28T07:05:00Z'), now)).toBe('28 Oct');
  });
});
