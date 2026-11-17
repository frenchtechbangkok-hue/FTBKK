// The newsletter builder (Emails and social media > Newsletters > one newsletter): blocks as
// small forms you can add anywhere, move, duplicate and remove, with a live preview rendered by
// the server (/api/admin/newsletter-preview). The blocks travel to the server as JSON in the
// hidden "blocks" field of the form; the server checks them again (lib/newsletter-blocks.ts).
import {
  BLOCK_DEFS,
  BLOCK_TYPES,
  type BlockType,
  type FieldDef,
} from '../lib/newsletter-block-defs';

type Row = Record<string, unknown>;
interface Choices {
  events: { slug: string; title: string; meta: string; upcoming: boolean; photos: number }[];
  posts: { slug: string; title: string; meta: string }[];
}

let uid = 0;
const nextId = (p: string) => `nb-${p}-${++uid}`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  put(e, ...children);
  return e;
}

/** Appends nodes and text (appendChild: the Workers types shadow the DOM's append). */
function put(parent: Node, ...children: (Node | string | null | undefined)[]) {
  for (const c of children)
    if (c != null) parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
}

const INPUT = 'w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm focus:border-accent';
const SMALL_BTN =
  'rounded-button border border-line bg-paper px-2.5 py-1 text-xs font-semibold text-navy hover:bg-surface disabled:opacity-40';

/** A short line describing a block, shown next to its name when folded. */
function summary(b: Row) {
  const pick = ['title', 'heading', 'label', 'kicker', 'md', 'caption', 'slug', 'url'];
  for (const k of pick) {
    const v = b[k];
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/\s+/g, ' ').slice(0, 70);
  }
  for (const k of ['items', 'images']) {
    const v = b[k];
    if (Array.isArray(v) && v.length) return `${v.length} ${k === 'images' ? 'photos' : 'items'}`;
  }
  return '';
}

export function startBuilder(form: HTMLFormElement) {
  const root = form.querySelector<HTMLElement>('[data-builder]')!;
  const hidden = form.querySelector<HTMLInputElement>('[data-blocks-input]')!;
  const choices = JSON.parse(root.dataset.choices ?? '{"events":[],"posts":[]}') as Choices;
  const blocks = (JSON.parse(hidden.value || '[]') as Row[]).filter(
    (b) => typeof b?.type === 'string' && (BLOCK_TYPES as readonly string[]).includes(b.type),
  );
  /** Folded blocks (by object), so a re-render keeps them as they were. */
  const folded = new WeakSet<Row>();

  const changed = (structural = false) => {
    hidden.value = JSON.stringify(blocks);
    // The admin layout's "unsaved changes" warning listens for input events on the form.
    form.dispatchEvent(new Event('input', { bubbles: true }));
    if (structural) render();
    schedulePreview();
  };

  // ---------- fields ----------

  function imageField(def: FieldDef, obj: Row) {
    const id = nextId('img');
    const input = el('input', {
      id,
      type: 'text',
      class: INPUT,
      placeholder: '/media/… or https://…',
      maxlength: '500',
    });
    input.value = String(obj[def.key] ?? '');
    const thumb = el('img', {
      alt: '',
      class: 'h-12 w-16 shrink-0 rounded object-cover bg-surface',
    });
    const showThumb = () => {
      const v = input.value.trim();
      thumb.hidden = !v;
      if (v) thumb.src = v;
    };
    showThumb();
    input.addEventListener('input', () => {
      obj[def.key] = input.value.trim();
      showThumb();
      changed();
    });
    const file = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp',
      class: 'sr-only',
      tabindex: '-1',
    });
    const status = el('span', { class: 'text-xs text-muted', 'aria-live': 'polite' });
    const upload = el('button', { type: 'button', class: SMALL_BTN }, 'Upload');
    upload.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      status.textContent = 'Uploading…';
      upload.disabled = true;
      try {
        const body = new FormData();
        body.append('file', f);
        body.append('kind', 'image');
        const res = await fetch('/api/admin/upload', { method: 'POST', body });
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed.');
        input.value = data.url;
        obj[def.key] = data.url;
        showThumb();
        status.textContent = '';
        changed();
      } catch (e) {
        status.textContent = e instanceof Error ? e.message : 'Upload failed.';
      } finally {
        upload.disabled = false;
        file.value = '';
      }
    });
    return el(
      'div',
      { class: 'grid gap-1' },
      el('label', { for: id, class: 'text-sm font-semibold text-ink' }, def.label),
      el('div', { class: 'flex items-center gap-2' }, thumb, input, upload, file),
      def.hint ? el('p', { class: 'text-xs text-muted' }, def.hint) : null,
      status,
    );
  }

  function selectFrom(
    def: FieldDef,
    obj: Row,
    groups: { label: string; options: { value: string; label: string }[] }[],
  ) {
    const id = nextId('sel');
    const select = el('select', { id, class: INPUT });
    put(select, el('option', { value: '' }, 'Choose…'));
    const current = String(obj[def.key] ?? '');
    let found = !current;
    for (const g of groups) {
      if (!g.options.length) continue;
      const og = el('optgroup', { label: g.label });
      for (const o of g.options) {
        const opt = el('option', { value: o.value }, o.label);
        if (o.value === current) {
          opt.selected = true;
          found = true;
        }
        put(og, opt);
      }
      put(select, og);
    }
    if (!found) {
      const opt = el('option', { value: current }, `${current} (not published any more)`);
      opt.selected = true;
      put(select, opt);
    }
    select.addEventListener('change', () => {
      obj[def.key] = select.value;
      changed();
    });
    return el(
      'div',
      { class: 'grid gap-1' },
      el('label', { for: id, class: 'text-sm font-semibold text-ink' }, def.label),
      select,
      def.hint ? el('p', { class: 'text-xs text-muted' }, def.hint) : null,
    );
  }

  const eventLabel = (e: Choices['events'][number]) =>
    `${e.title} · ${e.meta}${e.photos ? ` · ${e.photos} photos` : ''}`;

  function listField(def: FieldDef, obj: Row) {
    if (!Array.isArray(obj[def.key])) obj[def.key] = [];
    const rows = obj[def.key] as Row[];
    const wrap = el('fieldset', { class: 'grid gap-2' });
    put(wrap, el('legend', { class: 'mb-1 text-sm font-semibold text-ink' }, def.label));
    rows.forEach((row, i) => {
      const move = (d: number) => {
        const j = i + d;
        if (j < 0 || j >= rows.length) return;
        [rows[i], rows[j]] = [rows[j]!, rows[i]!];
        changed(true);
      };
      const up = el('button', { type: 'button', class: SMALL_BTN, 'aria-label': 'Move up' }, '↑');
      up.disabled = i === 0;
      up.addEventListener('click', () => move(-1));
      const down = el(
        'button',
        { type: 'button', class: SMALL_BTN, 'aria-label': 'Move down' },
        '↓',
      );
      down.disabled = i === rows.length - 1;
      down.addEventListener('click', () => move(1));
      const del = el('button', { type: 'button', class: `${SMALL_BTN} text-danger` }, 'Remove');
      del.addEventListener('click', () => {
        rows.splice(i, 1);
        changed(true);
      });
      put(
        wrap,
        el(
          'div',
          { class: 'grid gap-2 rounded-lg border border-line bg-surface p-3' },
          el(
            'div',
            { class: 'flex items-center justify-between gap-2' },
            el('span', { class: 'text-xs font-semibold text-muted' }, `${i + 1}`),
            el('div', { class: 'flex gap-1' }, up, down, del),
          ),
          el(
            'div',
            { class: `grid gap-2 ${(def.fields ?? []).length > 2 ? 'sm:grid-cols-2' : ''}` },
            ...(def.fields ?? []).map((f) => field(f, row)),
          ),
        ),
      );
    });
    const add = el('button', { type: 'button', class: SMALL_BTN }, `+ ${def.addLabel ?? 'Add'}`);
    add.disabled = rows.length >= (def.maxItems ?? 24);
    add.addEventListener('click', () => {
      rows.push(Object.fromEntries((def.fields ?? []).map((f) => [f.key, ''])));
      changed(true);
    });
    const tools = el('div', { class: 'flex flex-wrap items-center gap-2' }, add);
    if (def.fill) {
      const what = { photos: 'its recap photos', speakers: 'its speakers', partners: 'its logos' }[
        def.fill
      ];
      const sel = el('select', { class: `${INPUT} w-auto max-w-72`, 'aria-label': 'Event' });
      put(sel, el('option', { value: '' }, `Or add ${what} from an event…`));
      for (const e of choices.events)
        if (def.fill !== 'photos' || e.photos)
          put(sel, el('option', { value: e.slug }, eventLabel(e)));
      const note = el('span', { class: 'text-xs text-muted', 'aria-live': 'polite' });
      sel.addEventListener('change', async () => {
        if (!sel.value) return;
        note.textContent = 'Loading…';
        try {
          const res = await fetch(
            `/api/admin/newsletter-event?slug=${encodeURIComponent(sel.value)}`,
          );
          const data = (await res.json()) as Record<string, Row[]>;
          const found = (data[def.fill!] ?? []) as Row[];
          const room = (def.maxItems ?? 24) - rows.length;
          rows.push(...found.slice(0, room));
          note.textContent = found.length ? '' : 'Nothing to add from this event.';
          if (found.length) changed(true);
        } catch {
          note.textContent = 'Could not load the event.';
        }
        sel.value = '';
      });
      put(tools, sel, note);
    }
    put(wrap, tools);
    return wrap;
  }

  function field(def: FieldDef, obj: Row): HTMLElement {
    switch (def.kind) {
      case 'image':
        return imageField(def, obj);
      case 'list':
        return listField(def, obj);
      case 'event': {
        const evs =
          def.events === 'past' ? choices.events.filter((e) => !e.upcoming) : choices.events;
        return selectFrom(def, obj, [
          {
            label: 'Upcoming events',
            options: evs
              .filter((e) => e.upcoming)
              .map((e) => ({ value: e.slug, label: eventLabel(e) })),
          },
          {
            label: 'Past events',
            options: evs
              .filter((e) => !e.upcoming)
              .map((e) => ({ value: e.slug, label: eventLabel(e) })),
          },
        ]);
      }
      case 'post':
        return selectFrom(def, obj, [
          {
            label: 'Blog posts',
            options: choices.posts.map((p) => ({ value: p.slug, label: `${p.title} · ${p.meta}` })),
          },
        ]);
      case 'select':
        return selectFrom(def, obj, [{ label: def.label, options: def.options ?? [] }]);
      case 'checkbox': {
        const id = nextId('cb');
        const box = el('input', { id, type: 'checkbox', class: 'size-4 accent-brand' });
        box.checked = obj[def.key] !== false;
        box.addEventListener('change', () => {
          obj[def.key] = box.checked;
          changed();
        });
        return el(
          'label',
          { for: id, class: 'flex cursor-pointer items-center gap-2 text-sm' },
          box,
          def.label,
        );
      }
      default: {
        const id = nextId('f');
        const input =
          def.kind === 'textarea'
            ? el('textarea', { id, rows: '5', class: INPUT })
            : el('input', {
                id,
                type: def.kind === 'number' ? 'number' : def.kind === 'url' ? 'url' : 'text',
                class: INPUT,
                ...(def.kind === 'number' ? { min: '0', max: String(def.max ?? 100) } : {}),
              });
        if (def.max && def.kind !== 'number') input.setAttribute('maxlength', String(def.max));
        if (def.placeholder) input.setAttribute('placeholder', def.placeholder);
        if (def.kind === 'url') input.setAttribute('placeholder', def.placeholder ?? 'https://…');
        input.value = obj[def.key] == null ? '' : String(obj[def.key]);
        input.addEventListener('input', () => {
          obj[def.key] =
            def.kind === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value;
          changed();
        });
        return el(
          'div',
          { class: 'grid gap-1' },
          el('label', { for: id, class: 'text-sm font-semibold text-ink' }, def.label),
          input,
          def.hint ? el('p', { class: 'text-xs text-muted' }, def.hint) : null,
        );
      }
    }
  }

  // ---------- blocks ----------

  const menu = document.querySelector<HTMLDialogElement>('[data-block-menu]')!;
  const menuItems = menu.querySelector<HTMLElement>('[data-block-menu-items]')!;
  let insertAt = 0;
  for (const type of BLOCK_TYPES) {
    const def = BLOCK_DEFS[type];
    const b = el(
      'button',
      {
        type: 'button',
        class:
          'grid gap-0.5 rounded-lg border border-line p-3 text-left hover:border-accent hover:bg-accent/5 focus:border-accent',
      },
      el('span', { class: 'font-semibold text-navy' }, def.label),
      el('span', { class: 'text-xs text-muted' }, def.hint),
    );
    b.addEventListener('click', () => {
      blocks.splice(insertAt, 0, BLOCK_DEFS[type as BlockType].create());
      menu.close();
      changed(true);
      root.querySelectorAll<HTMLElement>('[data-block]')[insertAt]?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    });
    put(menuItems, b);
  }
  menu.querySelector('[data-block-menu-cancel]')?.addEventListener('click', () => menu.close());
  const openMenu = (at: number) => {
    insertAt = at;
    menu.showModal();
  };
  const addHere = (at: number, label = '+ Add a block here') => {
    const b = el(
      'button',
      {
        type: 'button',
        class:
          'w-full rounded-lg border border-dashed border-line py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent',
      },
      label,
    );
    b.addEventListener('click', () => openMenu(at));
    return b;
  };

  function render() {
    root.replaceChildren();
    blocks.forEach((b, i) => {
      const def = BLOCK_DEFS[b.type as BlockType];
      const btn = (text: string, label: string, fn: () => void, disabled = false) => {
        const x = el('button', { type: 'button', class: SMALL_BTN, 'aria-label': label }, text);
        x.disabled = disabled;
        x.addEventListener('click', (e) => {
          e.preventDefault();
          fn();
        });
        return x;
      };
      const move = (d: number) => {
        const j = i + d;
        [blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!];
        changed(true);
      };
      const body = el('div', { class: 'grid gap-3 border-t border-line p-4' });
      for (const f of def.fields) put(body, field(f, b));
      if (!def.fields.length) put(body, el('p', { class: 'text-sm text-muted' }, def.hint));
      const isFolded = folded.has(b);
      const toggle = el(
        'button',
        {
          type: 'button',
          class: 'flex min-w-0 flex-1 items-center gap-2 text-left',
          'aria-expanded': String(!isFolded),
        },
        el('span', { class: 'text-xs text-muted', 'aria-hidden': 'true' }, isFolded ? '▸' : '▾'),
        el('span', { class: 'font-semibold text-navy' }, `${i + 1}. ${def.label}`),
        el('span', { class: 'truncate text-sm text-muted' }, summary(b)),
      );
      body.hidden = isFolded;
      toggle.addEventListener('click', () => {
        if (folded.has(b)) folded.delete(b);
        else folded.add(b);
        render();
      });
      put(
        root,
        addHere(i),
        el(
          'section',
          { class: 'rounded-card border border-line bg-paper', 'data-block': '' },
          el(
            'div',
            { class: 'flex flex-wrap items-center gap-2 p-3' },
            toggle,
            el(
              'div',
              { class: 'flex gap-1' },
              btn('↑', 'Move up', () => move(-1), i === 0),
              btn('↓', 'Move down', () => move(1), i === blocks.length - 1),
              btn('Duplicate', 'Duplicate', () => {
                blocks.splice(i + 1, 0, structuredClone(b));
                changed(true);
              }),
              btn('Remove', 'Remove', () => {
                if (!confirm(`Remove the ${def.label} block?`)) return;
                blocks.splice(i, 1);
                changed(true);
              }),
            ),
          ),
          body,
        ),
      );
    });
    put(root, addHere(blocks.length, blocks.length ? '+ Add a block' : '+ Add the first block'));
  }

  // ---------- audience ----------

  const plural = (k: number) => `${k} ${k === 1 ? 'person' : 'people'}`;
  const segmentPanel = form.querySelector<HTMLElement>('[data-segment]');
  const segmentPeople = JSON.parse(segmentPanel?.dataset.segment ?? '[]') as string[][];
  const segmentRadio = form.querySelector<HTMLInputElement>('input[name=audience][value=segment]');
  const syncAudience = () => {
    if (segmentPanel && segmentRadio) {
      const ticked = new Set(
        [...segmentPanel.querySelectorAll<HTMLInputElement>('input[data-label]:checked')].map(
          (b) => b.dataset.label!,
        ),
      );
      const k = segmentPeople.filter((p) => p.some((l) => ticked.has(l))).length;
      segmentRadio.dataset.count = String(k);
      const text = segmentRadio.parentElement?.querySelector('[data-count-text]');
      if (text) text.textContent = `(${k})`;
    }
    const picked = form.querySelector<HTMLInputElement>('input[name=audience]:checked');
    form.querySelectorAll<HTMLElement>('[data-for]').forEach((p) => {
      p.hidden = p.dataset.for !== picked?.value;
    });
    const k = Number(picked?.dataset.count ?? 0);
    form.querySelectorAll<HTMLElement>('[data-confirm-template]').forEach((b) => {
      b.dataset.confirm = b.dataset.confirmTemplate!.replace('{n}', plural(k));
    });
  };
  form.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-builder]')) return;
    syncAudience();
    schedulePreview();
  });
  syncAudience();

  // ---------- preview ----------

  const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
  const status = document.querySelector<HTMLElement>('[data-preview-status]')!;
  const subjectOut = document.querySelector<HTMLElement>('[data-preview-subject]')!;
  const problemsOut = document.querySelector<HTMLElement>('[data-problems]')!;
  const idle = status.textContent;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  const val = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '';
  async function refresh() {
    const mine = ++seq;
    const picked = form.querySelector<HTMLInputElement>('input[name=audience]:checked');
    const web = form.elements.namedItem('webPage') as HTMLInputElement | null;
    try {
      const res = await fetch('/api/admin/newsletter-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: Number(location.pathname.split('/').pop()) || 0,
          subject: val('subject'),
          preheader: val('preheader'),
          audience: picked?.value ?? 'newsletter',
          webPage: !!web?.checked,
          blocks,
        }),
      });
      if (!res.headers.get('content-type')?.includes('json')) throw new Error('login');
      const data = (await res.json()) as { html: string; subject: string; problems: string[] };
      if (mine !== seq) return;
      const y = frame.contentWindow?.scrollY ?? 0;
      frame.srcdoc = data.html;
      frame.addEventListener('load', () => frame.contentWindow?.scrollTo(0, y), { once: true });
      subjectOut.textContent = data.subject || '…';
      problemsOut.replaceChildren(...data.problems.map((p) => el('li', {}, p)));
      problemsOut.classList.toggle('hidden', !data.problems.length);
      status.textContent = data.problems.length
        ? 'To fix before sending (you can save a draft as it is):'
        : idle;
    } catch {
      if (mine === seq)
        status.textContent =
          'Could not reach the server for the preview. Your admin login may have expired: open the admin in a new tab to sign in again, then Save.';
    }
  }
  // The preview grows with the newsletter (the panel around it scrolls).
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (doc?.body) frame.style.height = `${Math.max(320, doc.documentElement.scrollHeight + 8)}px`;
  });
  function schedulePreview() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 500);
  }
  form.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (t === form || t.closest('[data-builder]')) return;
    schedulePreview();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-width]').forEach((b) => {
    b.addEventListener('click', () => {
      frame.style.width = b.dataset.width!;
      document
        .querySelectorAll<HTMLButtonElement>('[data-width]')
        .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
  });

  // Sending: block a second click.
  form.addEventListener('submit', (e) => {
    const s = e.submitter as HTMLButtonElement | null;
    hidden.value = JSON.stringify(blocks);
    if (!s?.hasAttribute('data-send')) return;
    setTimeout(() => {
      if (!e.defaultPrevented) s.disabled = true;
    });
  });

  render();
  void refresh();
}
