// The blocks a newsletter is built from, as the builder in Emails and social media > Newsletters
// shows them: a name, a hint and the fields of each block. No imports, so the browser script of
// the builder can use it too. The checks (Zod) and the email HTML are in newsletter-blocks.ts.

export const BLOCK_TYPES = [
  'header',
  'text',
  'image',
  'gallery',
  'stats',
  'bars',
  'people',
  'event',
  'post',
  'recap',
  'textImage',
  'video',
  'button',
  'logos',
  'divider',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'image'
  | 'url'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'event'
  | 'post'
  | 'list';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  placeholder?: string;
  max?: number;
  options?: { value: string; label: string }[];
  /** list: the fields of each row, the button label and the most rows allowed. */
  fields?: FieldDef[];
  addLabel?: string;
  maxItems?: number;
  /** list: offers to fill the rows from an event (its recap photos, speakers or partners). */
  fill?: 'photos' | 'speakers' | 'partners';
  /** event: which events the menu offers. */
  events?: 'all' | 'past';
}

export interface BlockDef {
  label: string;
  hint: string;
  fields: FieldDef[];
  /** A new block of this kind, as added by the builder. */
  create: () => Record<string, unknown>;
}

const MD_HINT = 'Markdown: **bold**, *italic*, [link](https://…), - list. {name} = first name.';

/** Most rows in a list block, and photos in a recap. */
export const MAX_ROWS = 24;
export const MAX_RECAP_PHOTOS_SHOWN = 12;

export const BLOCK_DEFS: Record<BlockType, BlockDef> = {
  header: {
    label: 'Header',
    hint: 'Banner picture, a small line above the title, the title and an introduction.',
    fields: [
      { key: 'image', label: 'Banner picture (optional)', kind: 'image' },
      {
        key: 'kicker',
        label: 'Small line above the title',
        kind: 'text',
        max: 120,
        placeholder: 'Edition 1 · November 2026',
      },
      { key: 'title', label: 'Title', kind: 'text', max: 200 },
      { key: 'intro', label: 'Introduction (optional)', kind: 'textarea', hint: MD_HINT },
    ],
    create: () => ({ type: 'header', image: '', kicker: '', title: '', intro: '' }),
  },
  text: {
    label: 'Text',
    hint: 'Paragraphs, headings, lists and links.',
    fields: [{ key: 'md', label: 'Text', kind: 'textarea', hint: MD_HINT }],
    create: () => ({ type: 'text', md: '' }),
  },
  image: {
    label: 'Picture',
    hint: 'One picture, full width, with a caption and a link if you like.',
    fields: [
      { key: 'src', label: 'Picture', kind: 'image' },
      { key: 'alt', label: 'Describe the picture (for screen readers)', kind: 'text', max: 200 },
      { key: 'caption', label: 'Caption (optional)', kind: 'text', max: 300 },
      { key: 'link', label: 'Link when clicked (optional)', kind: 'url' },
    ],
    create: () => ({ type: 'image', src: '', alt: '', caption: '', link: '' }),
  },
  gallery: {
    label: 'Photo grid',
    hint: 'Several photos side by side, for example from an event recap.',
    fields: [
      { key: 'title', label: 'Title (optional)', kind: 'text', max: 150 },
      {
        key: 'columns',
        label: 'Photos per row',
        kind: 'select',
        options: [
          { value: '2', label: '2' },
          { value: '3', label: '3' },
        ],
      },
      {
        key: 'images',
        label: 'Photos',
        kind: 'list',
        addLabel: 'Add a photo',
        maxItems: MAX_ROWS,
        fill: 'photos',
        fields: [
          { key: 'src', label: 'Photo', kind: 'image' },
          { key: 'alt', label: 'Description', kind: 'text', max: 200 },
        ],
      },
    ],
    create: () => ({ type: 'gallery', title: '', columns: '2', images: [] }),
  },
  stats: {
    label: 'Key figures',
    hint: '2 to 4 big numbers with a word under each: "~100 attendees", "5 speakers".',
    fields: [
      { key: 'title', label: 'Title (optional)', kind: 'text', max: 150 },
      {
        key: 'items',
        label: 'Figures',
        kind: 'list',
        addLabel: 'Add a figure',
        maxItems: 4,
        fields: [
          { key: 'value', label: 'Number', kind: 'text', max: 20, placeholder: '~100' },
          { key: 'label', label: 'Label', kind: 'text', max: 60, placeholder: 'attendees' },
        ],
      },
    ],
    create: () => ({
      type: 'stats',
      title: '',
      items: [
        { value: '', label: '' },
        { value: '', label: '' },
        { value: '', label: '' },
      ],
    }),
  },
  bars: {
    label: 'Percentage bars',
    hint: 'Who was in the room, what people came for: one bar per answer.',
    fields: [
      { key: 'title', label: 'Title (optional)', kind: 'text', max: 150 },
      {
        key: 'items',
        label: 'Bars',
        kind: 'list',
        addLabel: 'Add a bar',
        maxItems: 12,
        fields: [
          { key: 'label', label: 'Label', kind: 'text', max: 80, placeholder: 'Startups' },
          { key: 'percent', label: '%', kind: 'number', max: 100 },
        ],
      },
      { key: 'note', label: 'Note under the bars (optional)', kind: 'text', max: 300 },
    ],
    create: () => ({ type: 'bars', title: '', items: [{ label: '', percent: '' }], note: '' }),
  },
  people: {
    label: 'People',
    hint: 'Speakers, new board members, partners: photo, name and role, two per row.',
    fields: [
      { key: 'title', label: 'Title (optional)', kind: 'text', max: 150 },
      {
        key: 'items',
        label: 'People',
        kind: 'list',
        addLabel: 'Add a person',
        maxItems: MAX_ROWS,
        fill: 'speakers',
        fields: [
          { key: 'photo', label: 'Photo (optional)', kind: 'image' },
          { key: 'name', label: 'Name', kind: 'text', max: 120 },
          { key: 'role', label: 'Role', kind: 'text', max: 200 },
          { key: 'link', label: 'Link (optional)', kind: 'url' },
        ],
      },
    ],
    create: () => ({ type: 'people', title: '', items: [] }),
  },
  event: {
    label: 'Event card',
    hint: 'An upcoming or past event, with its picture, date, place and link.',
    fields: [{ key: 'slug', label: 'Event', kind: 'event', events: 'all' }],
    create: () => ({ type: 'event', slug: '' }),
  },
  post: {
    label: 'Blog post card',
    hint: 'A published article, with its picture, summary and link.',
    fields: [{ key: 'slug', label: 'Blog post', kind: 'post' }],
    create: () => ({ type: 'post', slug: '' }),
  },
  recap: {
    label: 'Event recap',
    hint: "Everything from a past event's recap: figures (attendees, companies, feedback), photos, speakers, slides, video, write-up and partners. Tick what to show.",
    fields: [
      { key: 'slug', label: 'Past event', kind: 'event', events: 'past' },
      {
        key: 'heading',
        label: 'Title (optional)',
        kind: 'text',
        max: 200,
        hint: "Empty = the event's name.",
      },
      { key: 'intro', label: 'A few words (optional)', kind: 'textarea', hint: MD_HINT },
      { key: 'stats', label: 'Figures: attendees, companies, feedback', kind: 'checkbox' },
      {
        key: 'photos',
        label: 'Photos to show',
        kind: 'number',
        max: MAX_RECAP_PHOTOS_SHOWN,
        hint: `0 to ${MAX_RECAP_PHOTOS_SHOWN}, the first ones of the recap. For other photos, add a Photo grid.`,
      },
      { key: 'speakers', label: 'Speakers', kind: 'checkbox' },
      { key: 'materials', label: 'Slides, video and write-up', kind: 'checkbox' },
      { key: 'partners', label: 'Host, sponsors and partners (logos)', kind: 'checkbox' },
    ],
    create: () => ({
      type: 'recap',
      slug: '',
      heading: '',
      intro: '',
      stats: true,
      photos: 6,
      speakers: true,
      materials: true,
      partners: true,
    }),
  },
  textImage: {
    label: 'Picture and text',
    hint: 'A picture next to a short text.',
    fields: [
      { key: 'src', label: 'Picture', kind: 'image' },
      { key: 'alt', label: 'Describe the picture', kind: 'text', max: 200 },
      {
        key: 'side',
        label: 'Picture on the',
        kind: 'select',
        options: [
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ],
      },
      { key: 'md', label: 'Text', kind: 'textarea', hint: MD_HINT },
      { key: 'link', label: 'Link on the picture (optional)', kind: 'url' },
    ],
    create: () => ({ type: 'textImage', src: '', alt: '', side: 'left', md: '', link: '' }),
  },
  video: {
    label: 'Video',
    hint: 'A YouTube or Vimeo video: its picture links to it (emails cannot play videos).',
    fields: [
      { key: 'url', label: 'Video link', kind: 'url', placeholder: 'https://youtu.be/…' },
      { key: 'title', label: 'Title (optional)', kind: 'text', max: 200 },
      {
        key: 'image',
        label: 'Picture (optional)',
        kind: 'image',
        hint: 'YouTube videos get their own picture; add one for other sites.',
      },
    ],
    create: () => ({ type: 'video', url: '', title: '', image: '' }),
  },
  button: {
    label: 'Button',
    hint: 'One clear call to action.',
    fields: [
      { key: 'label', label: 'Label', kind: 'text', max: 60, placeholder: 'Register now' },
      { key: 'url', label: 'Link', kind: 'url' },
    ],
    create: () => ({ type: 'button', label: '', url: '' }),
  },
  logos: {
    label: 'Logos',
    hint: 'Partners, sponsors or hosts in a row.',
    fields: [
      { key: 'title', label: 'Title (optional)', kind: 'text', max: 150 },
      {
        key: 'items',
        label: 'Logos',
        kind: 'list',
        addLabel: 'Add a logo',
        maxItems: MAX_ROWS,
        fill: 'partners',
        fields: [
          { key: 'src', label: 'Logo (PNG or JPG)', kind: 'image' },
          { key: 'alt', label: 'Name', kind: 'text', max: 120 },
          { key: 'url', label: 'Link (optional)', kind: 'url' },
        ],
      },
    ],
    create: () => ({ type: 'logos', title: '', items: [] }),
  },
  divider: {
    label: 'Divider',
    hint: 'A thin line between sections.',
    fields: [],
    create: () => ({ type: 'divider' }),
  },
};

/** What a new newsletter starts with; every block can be changed, moved or removed after. */
export const STARTERS = {
  news: {
    label: 'News and upcoming events',
    blocks: () => [
      {
        ...BLOCK_DEFS.header.create(),
        kicker: 'Newsletter',
        title: 'What’s new at La French Tech Bangkok',
      },
      { ...BLOCK_DEFS.text.create(), md: 'Hello {name},\n\n' },
      BLOCK_DEFS.event.create(),
      BLOCK_DEFS.post.create(),
      BLOCK_DEFS.divider.create(),
      BLOCK_DEFS.button.create(),
    ],
  },
  recap: {
    label: 'Event recap',
    blocks: () => [
      { ...BLOCK_DEFS.header.create(), kicker: 'Recap' },
      { ...BLOCK_DEFS.text.create(), md: 'Hello {name},\n\n' },
      BLOCK_DEFS.recap.create(),
      BLOCK_DEFS.people.create(),
      BLOCK_DEFS.event.create(),
    ],
  },
  blank: {
    label: 'Blank',
    blocks: () => [BLOCK_DEFS.header.create(), BLOCK_DEFS.text.create()],
  },
} as const;
export type Starter = keyof typeof STARTERS;
