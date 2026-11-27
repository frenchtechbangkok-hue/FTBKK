import { describe, expect, it } from 'vitest';
import { EventSchema } from '../src/lib/admin';
import { eventIcs } from '../src/lib/ics';
import { onlineLink } from '../src/lib/event-online';
import { reminderEmail } from '../src/lib/registrations';
import type { Event } from '../src/db/schema';

const form = {
  title: 'Founders talk',
  startsAt: '2026-12-10T18:30',
  status: 'draft',
  registration: 'open',
  venue: 'Hub',
  address: '1 Sukhumvit',
  mapUrl: 'https://maps.example',
};

describe('event location', () => {
  it('keeps the venue and an optional streaming link', () => {
    const d = EventSchema.parse({ ...form, location: 'venue', streamUrl: 'youtube.com/live/x' });
    expect(d).toMatchObject({
      online: false,
      venue: 'Hub',
      address: '1 Sukhumvit',
      onlineUrl: 'https://youtube.com/live/x',
    });
    expect(EventSchema.parse(form)).toMatchObject({ online: false, onlineUrl: null });
  });

  it('online: needs the link, and "Online" stands for the venue', () => {
    const missing = EventSchema.safeParse({ ...form, location: 'online' });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.path).toEqual(['webinarUrl']);
    const d = EventSchema.parse({
      ...form,
      location: 'online',
      webinarUrl: 'https://zoom.us/j/1',
      streamUrl: 'https://ignored.example',
    });
    expect(d).toMatchObject({
      online: true,
      venue: 'Online',
      address: null,
      mapUrl: null,
      onlineUrl: 'https://zoom.us/j/1',
    });
  });
});

const base = {
  id: 1,
  title: 'Founders talk',
  slug: 'talk',
  summary: null,
  startsAt: new Date('2026-12-10T11:30:00Z'),
  endsAt: null,
  venue: 'Hub',
  address: '1 Sukhumvit',
  mapUrl: 'https://maps.example',
  online: false,
  onlineUrl: null,
} as unknown as Event;
const r = { name: 'Ann', email: 'ann@x.com', token: 'tok' };

describe('online link in emails and calendar', () => {
  it('online event: "Join online" button and the link as the calendar location', () => {
    const e = {
      ...base,
      online: true,
      venue: 'Online',
      address: null,
      mapUrl: null,
      onlineUrl: 'https://zoom.us/j/1',
    };
    expect(onlineLink(e)).toEqual({ label: 'Join online', url: 'https://zoom.us/j/1' });
    expect(reminderEmail(e, r).action).toEqual({
      label: 'Join online',
      url: 'https://zoom.us/j/1',
    });
    expect(eventIcs({ ...e, url: 'https://x/events/talk' })).toContain(
      'LOCATION:https://zoom.us/j/1',
    );
  });

  it('venue with a stream: map button stays, the stream is a link', () => {
    const e = { ...base, onlineUrl: 'https://youtube.com/live/x' };
    const m = reminderEmail(e, r);
    expect(m.action?.url).toBe('https://maps.example');
    expect(m.links?.[0]).toEqual({
      label: 'Watch the live stream',
      url: 'https://youtube.com/live/x',
    });
    const ics = eventIcs({ ...e, url: 'https://x/events/talk' });
    expect(ics).toContain('LOCATION:Hub\\, 1 Sukhumvit');
    expect(ics.replace(/\r\n /g, '')).toContain(
      'Watch the live stream: https://youtube.com/live/x',
    );
  });

  it('no link: nothing changes', () => {
    expect(onlineLink(base)).toBeNull();
    expect(reminderEmail(base, r).links?.[0]?.label).toBe('Show my ticket');
  });
});
