import { describe, expect, it } from 'vitest';
import { MENU, groupCount } from '../src/lib/admin-menu';
import { matches, personHit } from '../src/lib/admin-search';

describe('Admin menu', () => {
  it('lists every screen once', () => {
    const hrefs = MENU.flatMap((g) => g.links.map((l) => l.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const labels = MENU.map((g) => g.label).filter(Boolean);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps Settings for switches and puts the logs under History', () => {
    const group = (label: string) => MENU.find((g) => g.label === label)!.links.map((l) => l.href);
    expect(group('Settings')).toContain('/admin/email-delivery');
    expect(group('Settings')).not.toContain('/admin/changes');
    expect(group('History')).toEqual(['/admin/actions-log', '/admin/changes']);
    expect(group('Website')).toContain('/admin/settings?section=guides');
  });

  it('adds up the waiting counts of a folded group', () => {
    const community = MENU.find((g) => g.label === 'Community')!;
    expect(groupCount(community, { members: 3, messages: 2, directory: 9 })).toBe(5);
    expect(groupCount(community, {})).toBe(0);
  });
});

describe('Admin search', () => {
  it('matches every word, ignoring case and accents', () => {
    expect(matches('chloe mich', 'Chloé Michel', 'chloe@example.com')).toBe(true);
    expect(matches('chloe dupont', 'Chloé Michel')).toBe(false);
    expect(matches('  ', 'Anything')).toBe(false);
    expect(matches('connect 54', 'French Tech Connect #54')).toBe(true);
  });

  it('describes a person in one line', () => {
    const hit = personHit({
      key: 'anna@example.com',
      name: 'Anna Lee',
      email: 'anna@example.com',
      company: 'Lotus',
      attended: 2,
      member: { status: 'active' },
    } as never);
    expect(hit.href).toBe('/admin/contacts/view?c=anna%40example.com');
    expect(hit.detail).toBe('Member · Lotus · anna@example.com · came 2 times');
  });
});
