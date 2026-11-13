import { describe, expect, it } from 'vitest';
import {
  campaignLabel,
  campaignSlug,
  looksLikeBot,
  readEmailVisit,
  siteHosts,
  tagHtmlLinks,
  tagTextLinks,
  tagUrl,
} from '../src/lib/email-links';
import { renderEmail } from '../src/lib/email';
import { eventBroadcast } from '../src/lib/event-emails';
import { withEmailVisits } from '../src/lib/traffic';
import { applyTemplate, EMAIL_TEMPLATES } from '../src/lib/email-templates';

const hosts = siteHosts('french-tech-bangkok.com');
const TAGS = 'utm_source=ftbkk&utm_medium=email&utm_campaign=';

describe('email link tags', () => {
  it('tags links to the site, keeps their own query', () => {
    expect(
      tagUrl('https://french-tech-bangkok.com/events/x?token=a', 'member.welcome', hosts),
    ).toBe(`https://french-tech-bangkok.com/events/x?token=a&${TAGS}member.welcome`);
    expect(tagUrl('https://www.french-tech-bangkok.com/', 'Hello World!', hosts)).toBe(
      `https://www.french-tech-bangkok.com/?${TAGS}hello-world`,
    );
  });

  it('leaves other sites, files, the admin, the API and hand-tagged links alone', () => {
    for (const u of [
      'https://maps.google.com/?q=1',
      'https://french-tech-bangkok.com/media/a.pdf',
      'https://french-tech-bangkok.com/admin/members',
      'https://french-tech-bangkok.com/api/x',
      'https://french-tech-bangkok.com/?utm_source=linkedin',
      'mailto:a@b.c',
      'cid:qr',
      'not a url',
    ])
      expect(tagUrl(u, 'x', hosts)).toBe(u);
  });

  it('tags HTML hrefs with escaped ampersands, not images', () => {
    const html =
      '<a href="https://french-tech-bangkok.com/my-data?token=a&amp;b=1">x</a><img src="https://french-tech-bangkok.com/">';
    expect(tagHtmlLinks(html, 'c', hosts)).toBe(
      `<a href="https://french-tech-bangkok.com/my-data?token=a&amp;b=1&amp;${TAGS.replace(/&/g, '&amp;')}c">x</a><img src="https://french-tech-bangkok.com/">`,
    );
  });

  it('tags addresses in plain text, keeping the full stop after them', () => {
    expect(tagTextLinks('See https://french-tech-bangkok.com/events.', 'c', hosts)).toBe(
      `See https://french-tech-bangkok.com/events?${TAGS}c.`,
    );
  });

  it('makes safe campaign names', () => {
    expect(campaignSlug('Événement {name}: Café & Tech')).toBe('evenement-cafe-tech');
    expect(campaignSlug('!!!')).toBe('other');
  });

  it('reads a visit from an email and gives the clean address', () => {
    const v = readEmailVisit(
      new URL(`https://french-tech-bangkok.com/events/x/?token=a&${TAGS}event-x&utm_content=b`),
    );
    expect(v).toEqual({
      campaign: 'event-x',
      path: '/events/x',
      clean: 'https://french-tech-bangkok.com/events/x/?token=a',
    });
    expect(
      readEmailVisit(
        new URL('https://french-tech-bangkok.com/?utm_source=mailchimp&utm_medium=email'),
      ),
    ).toBeNull();
    expect(readEmailVisit(new URL('https://french-tech-bangkok.com/'))).toBeNull();
  });

  it('spots mail scanners and link previews', () => {
    expect(looksLikeBot(null)).toBe(true);
    expect(looksLikeBot('Mozilla/5.0 (compatible; Bingbot/2.0)')).toBe(true);
    expect(looksLikeBot('python-requests/2.31')).toBe(true);
    expect(
      looksLikeBot(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      ),
    ).toBe(false);
  });

  it('labels campaigns', () => {
    const t = { 'member.welcome': { label: 'Welcome' } };
    expect(campaignLabel('member.welcome', t)).toBe('Welcome');
    expect(campaignLabel('event-connect-53', t)).toBe('Event email: connect 53');
    expect(campaignLabel('community-november-news', t)).toBe('Community email: november news');
    expect(campaignLabel('other', t)).toBe('Other emails');
  });

  it('renderEmail tags the button, links and text with the campaign', () => {
    const m = eventBroadcast(
      {
        title: 'Connect',
        slug: 'connect-53',
        startsAt: new Date('2026-11-20T11:00:00Z'),
        endsAt: null,
        venue: null,
        address: null,
      },
      { name: 'Ana', email: 'a@b.c' },
      { subject: 'Hi', body: 'Hello there', actionLabel: '', actionUrl: '' },
    );
    const { html, text } = renderEmail(m);
    expect(html).toContain(
      '/events/connect-53?utm_source=ftbkk&amp;utm_medium=email&amp;utm_campaign=event-connect-53',
    );
    expect(text).toContain(`/events/connect-53?${TAGS}event-connect-53`);
  });
});

describe('template campaigns', () => {
  it('a template email carries its key as campaign', () => {
    expect(applyTemplate(EMAIL_TEMPLATES['member.welcome'], null, { name: 'Ana' }).campaign).toBe(
      'member.welcome',
    );
  });
});

describe('where visitors come from, with emails', () => {
  it('moves email visits out of direct', () => {
    expect(
      withEmailVisits(
        [
          ['Direct or unknown', 50],
          ['google.com', 30],
        ],
        20,
      ),
    ).toEqual([
      ['Direct or unknown', 30],
      ['google.com', 30],
      ['Emails from this site', 20],
    ]);
    expect(withEmailVisits([['google.com', 3]], 0)).toEqual([['google.com', 3]]);
    expect(withEmailVisits([['Direct or unknown', 5]], 9)).toEqual([['Emails from this site', 9]]);
  });
});
