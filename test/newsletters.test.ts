import { describe, expect, it } from 'vitest';
import {
  blockProblems,
  parseBlocks,
  renderBlocks,
  videoThumbnail,
  type BlockData,
} from '../src/lib/newsletter-blocks';
import { BLOCK_DEFS, BLOCK_TYPES, STARTERS } from '../src/lib/newsletter-block-defs';
import { recapFigures } from '../src/lib/recap-stats';
import { readResendEvent, readSesEvent } from '../src/lib/email-events';
import { campaignTag } from '../src/lib/email';
import { campaignLabel, tagUrl } from '../src/lib/email-links';
import { isDailyRun } from '../src/lib/cron';

const data = (over: Partial<BlockData> = {}): BlockData => ({
  origin: 'https://example.org',
  cards: new Map(),
  recaps: new Map(),
  ...over,
});

describe('parseBlocks', () => {
  it('keeps known blocks, drops the rest and never throws', () => {
    const blocks = parseBlocks(
      JSON.stringify([
        { type: 'text', md: '  Hello {name}  ' },
        { type: 'nope' },
        'junk',
        { type: 'stats', items: [1, 2, 3, 4, 5, 6] },
        { type: 'recap', slug: 'Connect-52', photos: 99 },
      ]),
    );
    expect(blocks.map((b) => b.type)).toEqual(['text', 'stats', 'recap']);
    expect(blocks[0]).toMatchObject({ md: 'Hello {name}' });
    const recap = blocks[2] as Extract<(typeof blocks)[number], { type: 'recap' }>;
    expect(recap.slug).toBe('connect-52');
    expect(recap.photos).toBe(6); // out of range: the default
    expect(parseBlocks('not json')).toEqual([]);
  });

  it('accepts every block the builder creates and every starter', () => {
    for (const t of BLOCK_TYPES) expect(parseBlocks([BLOCK_DEFS[t].create()])).toHaveLength(1);
    for (const s of Object.values(STARTERS))
      expect(parseBlocks(s.blocks())).toHaveLength(s.blocks().length);
  });
});

describe('blockProblems', () => {
  it('lists what stops sending, in plain words', () => {
    const blocks = parseBlocks([
      { type: 'header', title: '' },
      { type: 'image', src: 'javascript:alert(1)' },
      { type: 'event', slug: 'gone' },
      { type: 'button', label: 'Go', url: 'https://example.org/x' },
      { type: 'logos', items: [{ src: '/media/logo.svg', alt: 'A' }] },
    ]);
    const p = blockProblems(blocks, data());
    expect(p).toContain('Block 1, Header: add a title.');
    expect(p.some((x) => x.startsWith('Block 2, Picture: the picture must'))).toBe(true);
    expect(p.some((x) => x.startsWith('Block 3, Event card: "gone"'))).toBe(true);
    expect(p.some((x) => x.startsWith('Block 4'))).toBe(false);
    expect(p.some((x) => x.includes('SVG'))).toBe(true);
    expect(blockProblems([], data())).toEqual(['Add at least one block.']);
  });
});

describe('renderBlocks', () => {
  it('makes uploaded files absolute, escapes text and keeps {name}', () => {
    const { html, paragraphs } = renderBlocks(
      parseBlocks([
        { type: 'header', image: '/media/a.jpg', kicker: 'Edition 1', title: 'Hi <b>{name}</b>' },
        { type: 'stats', items: [{ value: '~100', label: 'attendees' }] },
        { type: 'bars', items: [{ label: 'Startups', percent: '31' }] },
        { type: 'button', label: 'Join', url: '/join' },
      ]),
      data(),
    );
    expect(html).toContain('src="https://example.org/media/a.jpg"');
    expect(html).toContain('Hi &lt;b&gt;{name}&lt;/b&gt;');
    expect(html).toContain('~100');
    expect(html).toContain('31%');
    expect(html).toContain('href="https://example.org/join"');
    expect(paragraphs.join('\n')).toContain('~100 attendees');
  });

  it('renders an event recap with the parts ticked', () => {
    const recaps = new Map([
      [
        'talk-1',
        {
          title: 'Talk 1',
          url: 'https://example.org/events/talk-1',
          meta: '5 Nov 2026',
          stats: [{ value: '80', label: 'attendees' }],
          photos: [1, 2, 3, 4].map((i) => ({ src: `https://example.org/media/${i}.jpg`, alt: '' })),
          speakers: [{ name: 'Ana', role: 'CEO, Acme', photo: null, link: null }],
          slides: [{ label: 'Deck', url: 'https://example.org/media/deck.pdf' }],
          video: 'https://youtu.be/dQw4w9WgXcQ',
          writeUp: null,
          partners: [],
        },
      ],
    ]);
    const all = renderBlocks(
      parseBlocks([{ type: 'recap', slug: 'talk-1', photos: 2 }]),
      data({ recaps }),
    );
    expect(all.html).toContain('80');
    expect(all.html).toContain('Ana');
    expect(all.html).toContain('Deck');
    expect(all.html).toContain('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(all.html.match(/media\/\d\.jpg/g)).toHaveLength(2);
    const none = renderBlocks(
      parseBlocks([
        {
          type: 'recap',
          slug: 'talk-1',
          stats: false,
          photos: 0,
          speakers: false,
          materials: false,
        },
      ]),
      data({ recaps }),
    );
    expect(none.html).not.toContain('Ana');
    expect(none.html).not.toContain('Deck');
    expect(none.html).toContain('See the full recap');
  });
});

describe('videoThumbnail', () => {
  it('finds YouTube pictures only', () => {
    expect(videoThumbnail('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toContain('dQw4w9WgXcQ');
    expect(videoThumbnail('https://vimeo.com/123')).toBeNull();
  });
});

describe('recapFigures', () => {
  it('counts the people who came (with guests), companies and the rating', () => {
    const f = recapFigures({
      registrations: [
        { status: 'attended', guests: 1, company: 'Acme' },
        { status: 'attended', guests: 0, company: 'acme ' },
        { status: 'attended', guests: 0, company: 'Kite' },
        { status: 'attended', guests: 0, company: 'freelance' },
        { status: 'registered', guests: 0, company: 'NoShow' },
      ],
      ratings: [5, 4, 4],
      speakers: 1,
    });
    expect(f).toEqual([
      { value: '5', label: 'attendees' },
      { value: '2', label: 'companies' },
      { value: '4.3/5', label: 'feedback (3 ratings)' },
      { value: '1', label: 'speaker' },
    ]);
  });

  it('falls back to registrations without check-in and hides thin ratings', () => {
    const f = recapFigures({
      registrations: [{ status: 'registered', guests: 0, company: null }],
      ratings: [5, 5],
      speakers: 0,
    });
    expect(f).toEqual([{ value: '1', label: 'registered' }]);
  });
});

describe('campaign tags', () => {
  it('turns a campaign into a provider tag', () => {
    expect(campaignTag('newsletter-3')).toBe('newsletter-3');
    expect(campaignTag('member.welcome')).toBe('member_welcome');
    expect(campaignTag(undefined)).toBe('other');
  });

  it('reads the tag back from SES and Resend events', () => {
    const ses = readSesEvent({
      eventType: 'Open',
      mail: {
        messageId: 'm1',
        timestamp: '2026-11-17T05:00:00Z',
        tags: { campaign: ['newsletter-3'] },
      },
      open: { timestamp: '2026-11-17T06:00:00Z' },
    });
    expect(ses?.campaign).toBe('newsletter-3');
    const resend = readResendEvent({
      type: 'email.clicked',
      data: { email_id: 'e1', tags: [{ name: 'campaign', value: 'newsletter-4' }] },
    });
    expect(resend?.event.campaign).toBe('newsletter-4');
    const resendObj = readResendEvent({
      type: 'email.opened',
      data: { email_id: 'e2', tags: { campaign: 'newsletter-5' } },
    });
    expect(resendObj?.event.campaign).toBe('newsletter-5');
  });

  it('labels newsletters and never tags the unsubscribe page', () => {
    expect(campaignLabel('newsletter-7', {})).toBe('Newsletter #7');
    const hosts = ['example.org', 'www.example.org'];
    expect(tagUrl('https://example.org/newsletters/unsubscribe?t=x', 'n', hosts)).toBe(
      'https://example.org/newsletters/unsubscribe?t=x',
    );
    expect(tagUrl('https://example.org/newsletters/x', 'n', hosts)).toContain('utm_campaign=n');
  });
});

describe('isDailyRun', () => {
  it('is the first 5-minute run of 02:00 UTC only', () => {
    expect(isDailyRun(new Date('2026-11-17T02:00:00Z'))).toBe(true);
    expect(isDailyRun(new Date('2026-11-17T02:05:00Z'))).toBe(false);
    expect(isDailyRun(new Date('2026-11-17T03:00:00Z'))).toBe(false);
  });
});
