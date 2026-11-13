import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { legacyMatch, legacyTarget, pickSlug, redirectFor } from '../src/lib/redirects';

describe('Wix redirects', () => {
  it.each([
    ['/post/how-to-start', '/blog/how-to-start'],
    ['/event-details-registration/ftc-52', '/events/ftc-52'],
    ['/event-details-registration/ftc-52/form', '/events/ftc-52'],
    ['/event-details/ftc-52', '/events/ftc-52'],
    ['/event-info/ftc-52', '/events/ftc-52'],
    ['/sponsors/accor', '/ecosystem/accor'],
    ['/sponsors', '/ecosystem'],
    ['/services-9', '/ecosystem'],
    ['/team', '/about'],
    ['/team/antoo', '/about'],
    ['/members', '/ecosystem'],
    ['/fund', '/about'],
    ['/home', '/'],
    ['/blog/page/2', '/blog'],
    ['/blog/hashtags/ai', '/blog'],
    ['/blog/categories/founder-guides', '/blog/category/founder-guides'],
    ['/admin/events/stats', '/admin/reports/events'],
    ['/admin/reports', '/admin/reports/members'],
    ['/admin/history', '/admin/actions-log'],
  ])('%s -> %s', (from, to) => expect(redirectFor(from)).toBe(to));

  it('leaves new URLs alone', () => {
    for (const p of [
      '/',
      '/blog',
      '/blog/x',
      '/blog/category/x',
      '/events',
      '/events/x',
      '/ecosystem/accor',
      '/about',
      '/admin/reports/events',
      '/admin/events/12',
    ]) {
      expect(redirectFor(p)).toBeNull();
    }
  });

  it('tells which content an old URL points at', () => {
    expect(legacyMatch('/sponsors/asian-institute-of-technology-%28ait%29')).toEqual({
      to: '/ecosystem/asian-institute-of-technology-%28ait%29',
      kind: 'organisation',
      slug: 'asian-institute-of-technology-(ait)',
    });
    expect(legacyMatch('/fund')).toEqual({ to: '/about' });
  });
});

describe('pickSlug', () => {
  const slugs = [
    'french-tech-connect-52',
    'french-tech-connect-54',
    'french-tech-connect-55-rooftop',
    'asian-institute-of-technology-ait',
    'wyzauto',
    'bangkok-accueil',
    'accor',
  ];
  it.each([
    ['french-tech-connect-52', 'french-tech-connect-52'],
    ['French-Tech-Connect-52', 'french-tech-connect-52'],
    ['asian-institute-of-technology-(ait)', 'asian-institute-of-technology-ait'],
    ['wyzauto-', 'wyzauto'],
    ['bangkok-accueil-', 'bangkok-accueil'],
    ['french-tech-connect-54-1', 'french-tech-connect-54'],
    ['french-tech-connect-55', 'french-tech-connect-55-rooftop'],
    ['french-tech-connect-5', null],
    ['french-tech-connect-53', null],
    ['michelin', null],
  ])('%s -> %s', (old, want) => expect(pickSlug(old, slugs)).toBe(want));

  it('falls back to the listing page', () => {
    expect(legacyTarget('event', 'gone', slugs)).toBe('/events');
    expect(legacyTarget('post', 'gone', [])).toBe('/blog');
    expect(legacyTarget('organisation', 'wyzauto-', slugs)).toBe('/ecosystem/wyzauto');
  });
});

/**
 * Every URL in the Wix sitemap (scripts/data/wix-sitemap-urls.txt, Nov 2026) must land on its own
 * page, given the slugs the Wix import wrote to D1 (test/fixtures/wix-imported-slugs.json).
 */
describe('Wix sitemap URLs', () => {
  const imported = JSON.parse(
    readFileSync(path.join(import.meta.dirname, 'fixtures', 'wix-imported-slugs.json'), 'utf8'),
  ) as Record<'event' | 'post' | 'organisation' | 'category', string[]>;
  const LIST = { event: '/events', post: '/blog', organisation: '/ecosystem', category: '/blog' };

  const paths = readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'data', 'wix-sitemap-urls.txt'),
    'utf8',
  )
    .split('\n')
    .filter((l) => l.startsWith('http'))
    .map((u) => new URL(u).pathname);

  it('has the whole sitemap', () => expect(paths.length).toBe(101));

  it.each(paths)('%s', (p) => {
    const m = legacyMatch(p);
    // Same path on the new site: no redirect needed.
    if (!m) return expect(['/', '/blog', '/events', '/about']).toContain(p);
    if (!m.kind) return expect(m.to).toMatch(/^\//);
    if (m.slug === 'test-title') return; // Wix test event, not imported
    expect(legacyTarget(m.kind, m.slug!, imported[m.kind])).not.toBe(LIST[m.kind]);
  });
});
