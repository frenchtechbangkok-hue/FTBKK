// A newsletter's blocks (Emails and social media > Newsletters): the checks on what the builder
// sends, and the email HTML of each block. Pure functions, unit tested: the data a block needs
// from the database (event and post cards, event recaps) is loaded by newsletters.ts and passed
// in. Email clients ignore stylesheets and many CSS features, so everything is tables with inline
// styles, 504 px wide (the site's 560 px email minus its margins).
import { z } from 'zod';
import { renderMarkdown } from './markdown';
import { cardHtml, markdownText, styleHtml, type EmailCard } from './email-markdown';
import {
  BLOCK_DEFS,
  BLOCK_TYPES,
  MAX_RECAP_PHOTOS_SHOWN,
  MAX_ROWS,
  type BlockType,
} from './newsletter-block-defs';

// Inline copies of the theme tokens (src/styles/global.css), as in email.ts.
const NAVY = '#160b47';
const INK = '#1a1530';
const MUTED = '#5c5a73';
const LINK = '#0062ff';
const LINE = '#e0dfe8';
const BRAND = '#d6223d';
const SURFACE = '#f4f3f8';
/** Width of the email's content. */
export const CONTENT_WIDTH = 504;

// ---------- checks ----------

const str = (max: number) => z.string().trim().max(max).catch('').default('');
const bool = (d: boolean) => z.boolean().catch(d).default(d);
const rows = <T extends z.ZodType>(row: T, max = MAX_ROWS) =>
  z
    .array(row)
    .catch([])
    .default([])
    .transform((a) => a.slice(0, max));

const Header = z.object({
  type: z.literal('header'),
  image: str(500),
  kicker: str(120),
  title: str(200),
  intro: str(5000),
});
const Text = z.object({ type: z.literal('text'), md: str(20000) });
const Image = z.object({
  type: z.literal('image'),
  src: str(500),
  alt: str(200),
  caption: str(300),
  link: str(500),
});
const Gallery = z.object({
  type: z.literal('gallery'),
  title: str(150),
  columns: z.enum(['2', '3']).catch('2').default('2'),
  images: rows(z.object({ src: str(500), alt: str(200) })),
});
const Stats = z.object({
  type: z.literal('stats'),
  title: str(150),
  items: rows(z.object({ value: str(20), label: str(60) }), 4),
});
const Bars = z.object({
  type: z.literal('bars'),
  title: str(150),
  items: rows(
    z.object({
      label: str(80),
      percent: z.union([z.literal(''), z.coerce.number().min(0).max(100)]).catch(''),
    }),
    12,
  ),
  note: str(300),
});
const People = z.object({
  type: z.literal('people'),
  title: str(150),
  items: rows(z.object({ photo: str(500), name: str(120), role: str(200), link: str(500) })),
});
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,120}$/)
  .catch('')
  .default('');
const EventCard = z.object({ type: z.literal('event'), slug });
const PostCard = z.object({ type: z.literal('post'), slug });
const Recap = z.object({
  type: z.literal('recap'),
  slug,
  heading: str(200),
  intro: str(5000),
  stats: bool(true),
  photos: z.coerce.number().int().min(0).max(MAX_RECAP_PHOTOS_SHOWN).catch(6).default(6),
  speakers: bool(true),
  materials: bool(true),
  partners: bool(true),
});
const TextImage = z.object({
  type: z.literal('textImage'),
  src: str(500),
  alt: str(200),
  side: z.enum(['left', 'right']).catch('left').default('left'),
  md: str(5000),
  link: str(500),
});
const Video = z.object({
  type: z.literal('video'),
  url: str(500),
  title: str(200),
  image: str(500),
});
const Button = z.object({ type: z.literal('button'), label: str(60), url: str(500) });
const Logos = z.object({
  type: z.literal('logos'),
  title: str(150),
  items: rows(z.object({ src: str(500), alt: str(120), url: str(500) })),
});
const Divider = z.object({ type: z.literal('divider') });

export const BlockSchema = z.discriminatedUnion('type', [
  Header,
  Text,
  Image,
  Gallery,
  Stats,
  Bars,
  People,
  EventCard,
  PostCard,
  Recap,
  TextImage,
  Video,
  Button,
  Logos,
  Divider,
]);
export type NewsletterBlock = z.infer<typeof BlockSchema>;
export const MAX_BLOCKS = 60;

/**
 * The blocks from the builder (JSON): unknown kinds and broken blocks are dropped, fields are
 * trimmed and cut to size. Never throws: a draft can always be saved, problems are listed by
 * blockProblems().
 */
export function parseBlocks(raw: unknown): NewsletterBlock[] {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const out: NewsletterBlock[] = [];
  for (const b of v.slice(0, MAX_BLOCKS)) {
    const p = BlockSchema.safeParse(b);
    if (p.success) out.push(p.data);
  }
  return out;
}

/** A picture or link the email can use: a full https address, or a file of the site (/media/…). */
export const isImageUrl = (s: string) => /^(https:\/\/[^\s"<>]+|\/media\/[^\s"<>]+)$/.test(s);
export const isLinkUrl = (s: string) => /^(https?:\/\/[^\s"<>]+|\/[^\s"<>]*|mailto:\S+)$/.test(s);

/** What the database gives the blocks: cards by "event:slug" / "post:slug", recaps by slug. */
export interface BlockData {
  origin: string;
  cards: Map<string, EmailCard>;
  recaps: Map<string, RecapContent>;
}

export interface RecapContent {
  title: string;
  /** Absolute link to the event page. */
  url: string;
  /** Date line. */
  meta: string;
  stats: { value: string; label: string }[];
  photos: { src: string; alt: string }[];
  speakers: { name: string; role: string; photo: string | null; link: string | null }[];
  slides: { label: string; url: string }[];
  video: string | null;
  writeUp: EmailCard | null;
  partners: { src: string; alt: string; url?: string }[];
}

/**
 * What still stops the newsletter from being sent, in plain words ("Block 3, Picture: choose a
 * picture."). Empty when it is ready.
 */
export function blockProblems(
  blocks: NewsletterBlock[],
  data: Pick<BlockData, 'cards' | 'recaps'>,
) {
  const out: string[] = [];
  if (!blocks.length) out.push('Add at least one block.');
  blocks.forEach((b, i) => {
    const say = (msg: string) => out.push(`Block ${i + 1}, ${BLOCK_DEFS[b.type].label}: ${msg}`);
    const badLink = (u: string) => u && !isLinkUrl(u);
    const badImage = (u: string) => u && !isImageUrl(u);
    switch (b.type) {
      case 'header':
        if (!b.title) say('add a title.');
        if (badImage(b.image)) say('the banner picture must be an uploaded file or https link.');
        break;
      case 'text':
        if (!b.md) say('write the text, or remove the block.');
        break;
      case 'image':
        if (!b.src) say('choose a picture.');
        else if (badImage(b.src)) say('the picture must be an uploaded file or https link.');
        if (badLink(b.link)) say('the link must start with https://.');
        break;
      case 'gallery':
        if (!b.images.some((x) => x.src)) say('add photos.');
        if (b.images.some((x) => badImage(x.src)))
          say('a photo is not an uploaded file or https link.');
        break;
      case 'stats':
        if (!b.items.some((x) => x.value)) say('fill in at least one figure.');
        break;
      case 'bars':
        if (!b.items.some((x) => x.label && x.percent !== '')) say('fill in at least one bar.');
        break;
      case 'people':
        if (!b.items.some((x) => x.name)) say('add at least one person.');
        if (b.items.some((x) => badImage(x.photo)))
          say('a photo is not an uploaded file or https link.');
        if (b.items.some((x) => badLink(x.link))) say('a link must start with https://.');
        break;
      case 'event':
      case 'post':
        if (!b.slug) say(`choose ${b.type === 'event' ? 'an event' : 'a post'}.`);
        else if (!data.cards.has(`${b.type}:${b.slug}`))
          say(`"${b.slug}" is not a published ${b.type === 'event' ? 'event' : 'post'} any more.`);
        break;
      case 'recap':
        if (!b.slug) say('choose a past event.');
        else if (!data.recaps.has(b.slug)) say(`"${b.slug}" is not a published event any more.`);
        break;
      case 'textImage':
        if (!b.src) say('choose a picture.');
        else if (badImage(b.src)) say('the picture must be an uploaded file or https link.');
        if (!b.md) say('write the text.');
        if (badLink(b.link)) say('the link must start with https://.');
        break;
      case 'video':
        if (!b.url) say('paste the video link.');
        else if (!/^https:\/\//.test(b.url)) say('the video link must start with https://.');
        if (badImage(b.image)) say('the picture must be an uploaded file or https link.');
        break;
      case 'button':
        if (!b.label || !b.url) say('fill in the label and the link.');
        else if (badLink(b.url)) say('the link must start with https://.');
        break;
      case 'logos':
        if (!b.items.some((x) => x.src)) say('add logos.');
        if (b.items.some((x) => badImage(x.src)))
          say('a logo is not an uploaded file or https link.');
        if (b.items.some((x) => /\.svg(\?|$)/i.test(x.src)))
          say('SVG logos do not show in most mail apps: use PNG or JPG.');
        break;
    }
  });
  return out;
}

/** The event and post slugs the blocks name, to load from the database. */
export function blockRefs(blocks: NewsletterBlock[]) {
  const events = new Set<string>();
  const posts = new Set<string>();
  const recaps = new Set<string>();
  for (const b of blocks) {
    if (!('slug' in b) || !b.slug) continue;
    if (b.type === 'event') events.add(b.slug);
    if (b.type === 'post') posts.add(b.slug);
    if (b.type === 'recap') recaps.add(b.slug);
  }
  return { events: [...events], posts: [...posts], recaps: [...recaps] };
}

// ---------- email HTML ----------

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** An absolute address for the email (uploaded files are /media/…), or '' when unusable. */
function abs(u: string | null | undefined, origin: string, check = isLinkUrl) {
  if (!u || !check(u)) return '';
  return u.startsWith('/') ? `${origin}${u}` : u;
}

const md = (text: string, origin: string) =>
  text ? styleHtml(renderMarkdown(text, { breaks: true }), origin) : '';

const table = (inner: string, style = '') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;${style}">${inner}</table>`;

const sectionTitle = (t: string) =>
  t
    ? `<h2 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:${NAVY}">${esc(t)}</h2>`
    : '';

const kicker = (t: string) =>
  `<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${BRAND};font-weight:700">${esc(t)}</p>`;

function img(src: string, alt: string, width: number, style = '') {
  return `<img src="${esc(src)}" alt="${esc(alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;border-radius:8px;${style}">`;
}

const linked = (html: string, url: string) => (url ? `<a href="${esc(url)}">${html}</a>` : html);

/** Rows of `cols` cells (tables, since mail apps ignore CSS grids). */
function grid(cells: string[], cols: number, gap = 12) {
  if (!cells.length) return '';
  const width = Math.floor((CONTENT_WIDTH - gap * (cols - 1)) / cols);
  const out: string[] = [];
  for (let i = 0; i < cells.length; i += cols) {
    const row = cells.slice(i, i + cols);
    while (row.length < cols) row.push('');
    out.push(
      `<tr>${row
        .map(
          (c, j) =>
            `<td width="${width}" valign="top" style="width:${width}px;vertical-align:top;padding:0 ${j < cols - 1 ? gap : 0}px ${gap}px 0">${c}</td>`,
        )
        .join('')}</tr>`,
    );
  }
  return table(out.join(''));
}

function statsHtml(items: { value: string; label: string }[]) {
  const shown = items.filter((x) => x.value);
  if (!shown.length) return '';
  const w = Math.floor(100 / shown.length);
  return table(
    `<tr>${shown
      .map(
        (x) =>
          `<td width="${w}%" align="center" style="padding:16px 8px;text-align:center"><p style="margin:0;font-size:30px;line-height:1.1;font-weight:700;color:${NAVY}">${esc(x.value)}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.3;color:${MUTED}">${esc(x.label)}</p></td>`,
      )
      .join('')}</tr>`,
    `background:${SURFACE};border-radius:12px;border-collapse:separate`,
  );
}

function peopleHtml(items: RecapContent['speakers'], origin: string) {
  const cells = items
    .filter((p) => p.name)
    .map((p) => {
      const photo = abs(p.photo, origin, isImageUrl);
      const link = abs(p.link, origin);
      const pic = photo
        ? `<td width="64" valign="top" style="width:64px;padding:0 12px 0 0"><img src="${esc(photo)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:50%;border:0;object-fit:cover"></td>`
        : '';
      const name = `<span style="font-weight:700;color:${NAVY}">${esc(p.name)}</span>`;
      return table(
        `<tr>${pic}<td valign="top" style="vertical-align:top;font-size:14px;line-height:1.4"><p style="margin:0">${link ? `<a href="${esc(link)}" style="text-decoration:none">${name}</a>` : name}</p>${p.role ? `<p style="margin:2px 0 0;color:${MUTED}">${esc(p.role)}</p>` : ''}</td></tr>`,
      );
    });
  return grid(cells, 2, 16);
}

function logosHtml(items: { src: string; alt: string; url?: string }[], origin: string) {
  const shown = items
    .map((l) => ({ ...l, src: abs(l.src, origin, isImageUrl), url: abs(l.url, origin) }))
    .filter((l) => l.src);
  if (!shown.length) return '';
  return `<p style="margin:0 0 8px;text-align:center">${shown
    .map((l) =>
      linked(
        `<img src="${esc(l.src)}" alt="${esc(l.alt)}" height="44" style="height:44px;width:auto;max-width:130px;vertical-align:middle;border:0;margin:0 10px 10px">`,
        l.url,
      ),
    )
    .join('')}</p>`;
}

/** A YouTube video's own picture, or null. */
export function videoThumbnail(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, '');
    const id =
      host === 'youtu.be'
        ? u.pathname.split('/')[1]
        : host.endsWith('youtube.com')
          ? u.pathname === '/watch'
            ? u.searchParams.get('v')
            : u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]
          : null;
    return id && /^[\w-]{11}$/.test(id) ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
  } catch {
    return null;
  }
}

function videoHtml(url: string, title: string, image: string, origin: string) {
  const link = abs(url, origin);
  if (!link) return '';
  const pic = abs(image, origin, isImageUrl) || videoThumbnail(link);
  const label = `&#9654;&nbsp; ${esc(title || 'Watch the video')}`;
  return `${pic ? linked(img(pic, title || 'Video', CONTENT_WIDTH, 'margin:0 0 8px'), link) : ''}<p style="margin:0 0 16px;font-weight:600"><a href="${esc(link)}" style="color:${LINK}">${label}</a></p>`;
}

const button = (label: string, url: string) =>
  `<p style="margin:8px 0 20px;text-align:center"><a href="${esc(url)}" style="background:${BRAND};color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:600;display:inline-block">${esc(label)}</a></p>`;

const gap = '<div style="height:12px;line-height:12px;font-size:12px">&nbsp;</div>';

function recapHtml(b: z.infer<typeof Recap>, r: RecapContent, data: BlockData) {
  const o = data.origin;
  const parts: string[] = [
    kicker(`Recap · ${r.meta}`),
    `<h2 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${NAVY}"><a href="${esc(r.url)}" style="color:${NAVY};text-decoration:none">${esc(b.heading || r.title)}</a></h2>`,
    md(b.intro, o),
  ];
  if (b.stats && r.stats.length) parts.push(statsHtml(r.stats), gap);
  const photos = r.photos.slice(0, b.photos);
  if (photos.length)
    parts.push(
      grid(
        photos.map((p) => linked(img(p.src, p.alt, 160), `${r.url}#recap`)),
        photos.length === 1 ? 1 : photos.length % 2 === 0 && photos.length < 6 ? 2 : 3,
        8,
      ),
    );
  if (b.speakers && r.speakers.length)
    parts.push(
      `<h3 style="margin:8px 0 10px;font-size:16px;color:${NAVY}">Speakers</h3>`,
      peopleHtml(r.speakers, o),
    );
  if (b.materials) {
    if (r.video) parts.push(videoHtml(r.video, 'Watch the video of the event', '', o));
    if (r.slides.length)
      parts.push(
        `<p style="margin:0 0 6px;font-weight:700;color:${NAVY}">Slides</p><ul style="margin:0 0 16px;padding-left:20px">${r.slides
          .map(
            (s) =>
              `<li style="margin:0 0 4px"><a href="${esc(s.url)}" style="color:${LINK}">${esc(s.label)}</a></li>`,
          )
          .join('')}</ul>`,
      );
    if (r.writeUp) parts.push(cardHtml(r.writeUp));
  }
  if (b.partners && r.partners.length)
    parts.push(
      `<p style="margin:8px 0 10px;text-align:center;font-size:13px;color:${MUTED}">Thanks to our host, sponsors and partners</p>`,
      logosHtml(r.partners, o),
    );
  parts.push(
    `<p style="margin:0 0 20px;font-weight:600"><a href="${esc(r.url)}#recap" style="color:${LINK}">See the full recap &rarr;</a></p>`,
  );
  return parts.filter(Boolean).join('\n');
}

function blockHtml(b: NewsletterBlock, data: BlockData): string {
  const o = data.origin;
  switch (b.type) {
    case 'header': {
      const image = abs(b.image, o, isImageUrl);
      return [
        image ? img(image, '', CONTENT_WIDTH, 'margin:0 0 20px') : '',
        b.kicker ? kicker(b.kicker) : '',
        b.title
          ? `<h1 style="margin:0 0 12px;font-size:28px;line-height:1.25;color:${NAVY}">${esc(b.title)}</h1>`
          : '',
        md(b.intro, o),
      ].join('');
    }
    case 'text':
      return md(b.md, o);
    case 'image': {
      const src = abs(b.src, o, isImageUrl);
      if (!src) return '';
      return `${linked(img(src, b.alt, CONTENT_WIDTH, `margin:0 0 ${b.caption ? 6 : 16}px`), abs(b.link, o))}${b.caption ? `<p style="margin:0 0 16px;font-size:13px;color:${MUTED};text-align:center">${esc(b.caption)}</p>` : ''}`;
    }
    case 'gallery': {
      const cols = Number(b.columns);
      const cells = b.images
        .map((x) => ({ ...x, src: abs(x.src, o, isImageUrl) }))
        .filter((x) => x.src)
        .map((x) => img(x.src, x.alt, Math.floor(CONTENT_WIDTH / cols)));
      return cells.length ? sectionTitle(b.title) + grid(cells, cols, 8) : '';
    }
    case 'stats': {
      const html = statsHtml(b.items);
      return html ? `${sectionTitle(b.title)}${html}${gap}` : '';
    }
    case 'bars': {
      const items = b.items.filter((x) => x.label && x.percent !== '');
      if (!items.length) return '';
      const bars = items
        .map((x) => {
          const p = Math.round(Number(x.percent));
          const fill =
            p > 0
              ? `<td width="${p}%" style="width:${p}%;background:${BRAND};height:8px;line-height:8px;font-size:0;border-radius:4px">&nbsp;</td>`
              : '';
          const rest =
            p < 100
              ? `<td style="background:${LINE};height:8px;line-height:8px;font-size:0;border-radius:4px">&nbsp;</td>`
              : '';
          return `<tr><td style="padding:0 0 10px">${table(`<tr><td style="font-size:14px;color:${INK};padding:0 0 4px">${esc(x.label)}</td><td align="right" style="font-size:14px;font-weight:700;color:${NAVY};padding:0 0 4px">${p}%</td></tr>`)}${table(`<tr>${fill}${rest}</tr>`, 'border-collapse:separate')}</td></tr>`;
        })
        .join('');
      return `${sectionTitle(b.title)}${table(bars)}${b.note ? `<p style="margin:0 0 16px;font-size:13px;color:${MUTED}">${esc(b.note)}</p>` : gap}`;
    }
    case 'people': {
      const html = peopleHtml(
        b.items.map((p) => ({ ...p, photo: p.photo || null, link: p.link || null })),
        o,
      );
      return html ? sectionTitle(b.title) + html : '';
    }
    case 'event':
    case 'post': {
      const card = data.cards.get(`${b.type}:${b.slug}`);
      return card ? cardHtml(card) : '';
    }
    case 'recap': {
      const r = data.recaps.get(b.slug);
      return r ? recapHtml(b, r, data) : '';
    }
    case 'textImage': {
      const src = abs(b.src, o, isImageUrl);
      if (!src) return md(b.md, o);
      const pic = `<td width="200" valign="top" style="width:200px;vertical-align:top;padding:0 ${b.side === 'left' ? '16px' : '0'} 0 ${b.side === 'right' ? '16px' : '0'}">${linked(img(src, b.alt, 200), abs(b.link, o))}</td>`;
      const text = `<td valign="top" style="vertical-align:top">${md(b.md, o)}</td>`;
      return table(`<tr>${b.side === 'left' ? pic + text : text + pic}</tr>`, 'margin:0 0 16px');
    }
    case 'video':
      return videoHtml(b.url, b.title, b.image, o);
    case 'button': {
      const url = abs(b.url, o);
      return b.label && url ? button(b.label, url) : '';
    }
    case 'logos': {
      const html = logosHtml(b.items, o);
      return html
        ? `${b.title ? `<p style="margin:8px 0 10px;text-align:center;font-size:13px;color:${MUTED}">${esc(b.title)}</p>` : ''}${html}`
        : '';
    }
    case 'divider':
      return `<hr style="border:0;border-top:1px solid ${LINE};margin:24px 0">`;
  }
}

function blockText(b: NewsletterBlock, data: BlockData): string {
  const o = data.origin;
  const t = (s: string) => (s ? markdownText(s, o).trim() : '');
  switch (b.type) {
    case 'header':
      return [b.kicker, b.title ? b.title.toUpperCase() : '', t(b.intro)]
        .filter(Boolean)
        .join('\n\n');
    case 'text':
      return t(b.md);
    case 'image':
      return [b.caption || b.alt, abs(b.link, o)].filter(Boolean).join(': ');
    case 'gallery':
      return b.title;
    case 'stats':
      return [b.title, ...b.items.filter((x) => x.value).map((x) => `${x.value} ${x.label}`)]
        .filter(Boolean)
        .join('\n');
    case 'bars':
      return [
        b.title,
        ...b.items
          .filter((x) => x.label && x.percent !== '')
          .map((x) => `${x.label}: ${x.percent}%`),
        b.note,
      ]
        .filter(Boolean)
        .join('\n');
    case 'people':
      return [
        b.title,
        ...b.items.filter((p) => p.name).map((p) => [p.name, p.role].filter(Boolean).join(', ')),
      ]
        .filter(Boolean)
        .join('\n');
    case 'event':
    case 'post': {
      const c = data.cards.get(`${b.type}:${b.slug}`);
      return c
        ? [c.title, [c.meta, c.place].filter(Boolean).join(' · '), c.url].filter(Boolean).join('\n')
        : '';
    }
    case 'recap': {
      const r = data.recaps.get(b.slug);
      if (!r) return '';
      return [
        `RECAP: ${b.heading || r.title} (${r.meta})`,
        t(b.intro),
        b.stats ? r.stats.map((s) => `${s.value} ${s.label}`).join(' · ') : '',
        b.materials && r.video ? `Video: ${r.video}` : '',
        ...(b.materials ? r.slides.map((s) => `${s.label}: ${s.url}`) : []),
        b.materials && r.writeUp ? `${r.writeUp.title}: ${r.writeUp.url}` : '',
        `See the full recap: ${r.url}#recap`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'textImage':
      return t(b.md);
    case 'video':
      return b.url ? `${b.title || 'Video'}: ${b.url}` : '';
    case 'button':
      return b.label && b.url ? `${b.label}: ${abs(b.url, o)}` : '';
    case 'logos':
      return [
        b.title,
        b.items
          .map((l) => l.alt)
          .filter(Boolean)
          .join(', '),
      ]
        .filter(Boolean)
        .join(': ');
    case 'divider':
      return '----';
  }
}

/** The newsletter's body: HTML for the email (and its web page) and plain-text paragraphs. */
export function renderBlocks(blocks: NewsletterBlock[], data: BlockData) {
  const html: string[] = [];
  const paragraphs: string[] = [];
  for (const b of blocks) {
    const h = blockHtml(b, data);
    if (h) html.push(`<div style="margin:0 0 8px">${h}</div>`);
    const t = blockText(b, data);
    if (t) paragraphs.push(t);
  }
  return { html: html.join('\n'), paragraphs };
}

/** Block kinds for the builder's "Add a block" menu, in a sensible order. */
export const BLOCK_MENU: { type: BlockType; label: string; hint: string }[] = BLOCK_TYPES.map(
  (type) => ({ type, label: BLOCK_DEFS[type].label, hint: BLOCK_DEFS[type].hint }),
);
