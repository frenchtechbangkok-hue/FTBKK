import { describe, expect, it } from 'vitest';
import {
  actorLabel,
  areaOf,
  describeAction,
  detailsOf,
  emptyNames,
  fieldLabel,
  type Part,
} from '../src/lib/actions-log';

const text = (parts: Part[]) => parts.map((p) => (typeof p === 'string' ? p : p.text)).join('');

describe('Actions log sentences', () => {
  const names = emptyNames();
  names.events.set(7, 'Connect #52');
  names.organisations.set(3, 'Accor');
  names.members.set(9, 'Anna Lee');
  names.registrations.set(11, { name: 'Tom Martin', eventId: 7 });
  names.templates = { 'event.confirmed': 'Registration confirmed' };

  const row = (
    action: string,
    entity: string,
    entityId: number | null,
    before?: unknown,
    after?: unknown,
  ) => ({
    actor: 'eric@example.com',
    action,
    entity,
    entityId,
    before: before ?? null,
    after: after ?? null,
  });

  it('names the thing and links to it', () => {
    const d = describeAction(
      row('update', 'event', 7, { status: 'draft' }, { status: 'published' }),
      names,
    );
    expect(text(d.parts)).toBe('Edited the event Connect #52');
    expect(d.parts).toContainEqual({ text: 'Connect #52', href: '/admin/events/7' });
    expect(d.area).toBe('events');
    expect(d.details).toEqual([{ field: 'Status', before: 'draft', after: 'published' }]);
  });

  it('reads check-ins with the person and the event', () => {
    const d = describeAction(
      row('registration_attended', 'registration', 11, { status: 'registered' }),
      names,
    );
    expect(text(d.parts)).toBe('Checked in Tom Martin at Connect #52');
  });

  it('covers listings, members, emails and settings', () => {
    expect(text(describeAction(row('approve', 'organisation', 3), names).parts)).toBe(
      'Approved and published the listing Accor',
    );
    expect(text(describeAction(row('member_review', 'member', 9), names).parts)).toBe(
      'Marked the new member Anna Lee as reviewed',
    );
    expect(
      text(
        describeAction(
          row('email_template_update', 'email_template', null, null, { key: 'event.confirmed' }),
          names,
        ).parts,
      ),
    ).toBe('Edited the automatic email “Registration confirmed”');
    expect(
      text(
        describeAction(
          row('email_community', 'community_email', 1, null, { subject: 'Hi', recipients: 120 }),
        ).parts,
      ),
    ).toBe('Emailed the community (120 people): “Hi”');
    const s = describeAction(row('update', 'settings', null, null, ['siteName', 'contactEmail']));
    expect(text(s.parts)).toBe('Changed site settings');
    expect(s.details).toEqual([{ field: 'Saved', before: '', after: 'Site name, Contact email' }]);
  });

  it('keeps a deleted item by its old name, without details', () => {
    const d = describeAction(row('delete', 'event', 99, { title: 'Old talk' }));
    expect(text(d.parts)).toBe('Deleted the event “Old talk”');
    expect(d.details).toEqual([]);
  });

  it('falls back to words for an unknown action', () => {
    expect(text(describeAction(row('frobnicate_things', 'widget', 4)).parts)).toBe(
      'Frobnicate things (widget #4)',
    );
  });
});

describe('Actions log helpers', () => {
  it('labels who did it', () => {
    expect(actorLabel('cron').name).toBe('Automatic');
    expect(actorLabel('self-service:a@b.co').name).toBe('a@b.co');
    expect(actorLabel('eric@example.com')).toEqual({ name: 'eric@example.com' });
  });

  it('turns keys and values into words', () => {
    expect(fieldLabel('partnerHome')).toBe('Partner home');
    expect(fieldLabel('owner_emails')).toBe('Owner emails');
    expect(detailsOf({ listed: true }, { listed: false })).toEqual([
      { field: 'Listed', before: 'yes', after: 'no' },
    ]);
    expect(detailsOf(null, { startsAt: '2026-11-20T18:30:00.000Z' })).toEqual([
      { field: 'Starts at', before: '', after: '21 November 2026, 01:30' },
    ]);
  });

  it('files every entity under an area', () => {
    expect(areaOf('registration')).toBe('events');
    expect(areaOf('contact_tag')).toBe('community');
    expect(areaOf('social_post')).toBe('emails');
  });
});
