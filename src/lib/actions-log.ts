/**
 * History > Actions log: turns raw audit_log rows into plain sentences ("Checked in Anna Lee at
 * Connect #52") with a link to the thing changed, an area for the filter chips, and readable
 * before/after details. Pure functions: the page loads the names (event titles, member names...)
 * and passes them in, so tests need no database.
 */
import { formatDate, formatTime } from './format';

export type Area = 'events' | 'community' | 'ecosystem' | 'blog' | 'emails' | 'settings';

export const AREAS: { key: Area; label: string; entities: string[] }[] = [
  { key: 'events', label: 'Events', entities: ['event', 'registration'] },
  {
    key: 'community',
    label: 'Community',
    entities: ['member', 'contact', 'contact_tag', 'contact_group', 'person'],
  },
  { key: 'ecosystem', label: 'Ecosystem', entities: ['organisation'] },
  { key: 'blog', label: 'Blog and files', entities: ['post', 'media'] },
  {
    key: 'emails',
    label: 'Emails and social media',
    entities: ['email_template', 'community_email', 'social_post', 'email'],
  },
  { key: 'settings', label: 'Settings', entities: ['settings'] },
];

export function areaOf(entity: string): Area {
  return AREAS.find((a) => a.entities.includes(entity))?.key ?? 'settings';
}

export interface LogRow {
  actor: string;
  action: string;
  entity: string;
  entityId: number | null;
  before: unknown;
  after: unknown;
}

/** Names of the things rows point at, loaded by the page. Keys are entity ids. */
export interface LogNames {
  events: Map<number, string>;
  posts: Map<number, string>;
  organisations: Map<number, string>;
  members: Map<number, string>;
  people: Map<number, string>;
  groups: Map<number, string>;
  /** Registration id -> who registered and for which event. */
  registrations: Map<number, { name: string; eventId: number }>;
  /** Email template key -> its name in Automatic emails. */
  templates: Record<string, string>;
}

export const emptyNames = (): LogNames => ({
  events: new Map(),
  posts: new Map(),
  organisations: new Map(),
  members: new Map(),
  people: new Map(),
  groups: new Map(),
  registrations: new Map(),
  templates: {},
});

/** A sentence is text with some links in it. */
export type Part = string | { text: string; href?: string };

export interface Described {
  area: Area;
  parts: Part[];
  /** Field, value before, value after (empty when there was none). */
  details: { field: string; before: string; after: string }[];
}

/** Who did it, in words: an admin's email, or what acted on its own. */
export function actorLabel(actor: string): { name: string; note?: string } {
  if (actor === 'cron') return { name: 'Automatic', note: 'a scheduled task of the site' };
  if (actor === 'website') return { name: 'Website visitor', note: 'from a public page' };
  if (actor === 'self-service') return { name: 'The person themselves', note: 'from their link' };
  if (actor.startsWith('self-service:'))
    return { name: actor.slice('self-service:'.length), note: 'from their link' };
  if (actor === 'admin') return { name: 'An admin' };
  return { name: actor };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown) => (typeof v === 'number' ? v : Array.isArray(v) ? v.length : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quoted = (s: string) => (s ? `“${s}”` : '');

/** "partnerHome" -> "Partner home", "owner_emails" -> "Owner emails". */
export function fieldLabel(key: string) {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A value as people read it: yes/no, lists with commas, dates without the T. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    // Dates and times saved in UTC read in Bangkok time.
    const s = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? `${formatDate(v)}, ${formatTime(v)}` : v;
    return s.length > 200 ? `${s.slice(0, 199)}…` : s;
  }
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) return v.map(valueText).join(', ');
    return plural(v.length, 'item');
  }
  const o = v as Obj;
  const label = str(o.name) || str(o.title) || str(o.label);
  if (label) return label;
  const s = Object.entries(o)
    .filter(([, x]) => x !== null && x !== undefined && x !== '')
    .map(([k, x]) => `${fieldLabel(k).toLowerCase()}: ${valueText(x)}`)
    .join('; ');
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
}

/** Fields that changed, or the fields recorded when only one side exists. */
export function detailsOf(before: unknown, after: unknown): Described['details'] {
  const b = obj(before);
  const a = obj(after);
  const out: Described['details'] = [];
  if (Array.isArray(after) && before == null) {
    // Settings saves log the list of keys saved.
    if (after.every((x) => typeof x === 'string'))
      return [{ field: 'Saved', before: '', after: after.map(fieldLabel).join(', ') }];
    return [{ field: 'Now', before: '', after: valueText(after) }];
  }
  if (
    (before !== null && typeof before !== 'object') ||
    (after !== null && typeof after !== 'object')
  )
    return [{ field: 'Value', before: valueText(before), after: valueText(after) }];
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  for (const k of keys) {
    // Ids and the contact key are already in the sentence.
    if (['key', 'id', 'emailId', 'claimId', 'ids'].includes(k)) continue;
    const bv = valueText(b[k]);
    const av = valueText(a[k]);
    if (k in b && k in a && bv === av) continue;
    if (!bv && !av) continue;
    out.push({ field: fieldLabel(k), before: bv, after: av });
  }
  return out;
}

/** The sentence for one row. Names come from the page; links go to the admin screens. */
export function describeAction(row: LogRow, names: LogNames = emptyNames()): Described {
  const { action, entity, entityId: id } = row;
  const b = obj(row.before);
  const a = obj(row.after);
  const area = areaOf(entity);
  const P = (...parts: Part[]): Part[] => parts.filter((p) => p !== '');

  const link = (text: string, href?: string): Part => ({ text, href });
  const event = (eid: number | null | undefined, fallback = '') => {
    const t = (eid != null && names.events.get(eid)) || fallback;
    return eid != null && t
      ? link(t, `/admin/events/${eid}`)
      : t || (eid != null ? `event #${eid}` : 'an event');
  };
  const org = () => {
    const n = (id != null && names.organisations.get(id)) || str(b.name) || str(a.name);
    return id != null && names.organisations.has(id)
      ? link(n, `/admin/ecosystem/${id}`)
      : n || (id != null ? `listing #${id}` : 'a listing');
  };
  const post = () => {
    const t = (id != null && names.posts.get(id)) || str(a.title) || str(b.title);
    return id != null && names.posts.has(id)
      ? link(t, `/admin/posts/${id}`)
      : t
        ? quoted(t)
        : 'a post';
  };
  const member = () => (id != null && names.members.get(id)) || 'a member';
  const person = () =>
    (id != null && names.people.get(id)) || str(a.name) || str(b.name) || 'a person';
  const contactKey = str(a.key) || str(b.key);
  const contact = (key = contactKey): Part =>
    key.includes('@')
      ? link(key, `/admin/contacts/view?c=${encodeURIComponent(key)}`)
      : key.startsWith('name:')
        ? key.slice(5)
        : 'a contact';
  const template = () => {
    const key = str(a.key) || str(b.key);
    return quoted(names.templates[key] ?? (key || 'an email'));
  };

  const sentence = (): Part[] => {
    switch (entity) {
      case 'event': {
        const e = event(id, str(a.title) || str(b.title));
        switch (action) {
          case 'create':
            return P('Created the event ', e);
          case 'update':
            return P('Edited the event ', e);
          case 'delete':
            return P('Deleted the event ', str(b.title) ? quoted(str(b.title)) : e);
          case 'cancel':
            return P('Cancelled the event ', e);
          case 'new-invite-link':
            return P('Made a new invitation link for ', e);
          case 'sponsors':
            return P('Updated the sponsors of ', e);
          case 'speakers':
            return P('Updated the speakers of ', e);
          case 'recap':
            return P('Updated the recap of ', e);
          case 'email_registrants':
            return P(
              `Emailed ${plural(num(a.recipients), 'person', 'people')} registered for `,
              e,
              str(a.subject) ? `: ${quoted(str(a.subject))}` : '',
            );
          case 'registrations_added':
            return P(`Added ${plural(num(a.added), 'person', 'people')} to `, e);
        }
        break;
      }
      case 'registration': {
        const r = id != null ? names.registrations.get(id) : undefined;
        const who = r?.name ?? 'someone';
        const e = event(r?.eventId);
        switch (action) {
          case 'registration_attended':
            return P(`Checked in ${who} at `, e);
          case 'registration_walk_in':
            return P(`Added ${who} as a walk-in at `, e);
          case 'registration_registered':
            return P(`Undid the check-in of ${who} at `, e);
          case 'registration_promote':
          case 'registration_promote-next':
            return P(`Moved ${who} from the waitlist to the guest list of `, e);
          case 'registration_cancel':
            return P(`Cancelled the registration of ${who} for `, e);
          case 'registration_newsletter':
            return P(`Subscribed ${who} to the newsletter at the check-in of `, e);
        }
        break;
      }
      case 'member': {
        const m = member();
        switch (action) {
          case 'member_add':
            return P(`Added ${m} as a member`);
          case 'member_confirm':
            return P(`${m} confirmed their email and became a member`);
          case 'member_enrol_door':
            return P(`Signed up ${m} as a member at the door`);
          case 'member_update':
            return P(`${m} updated their member details`);
          case 'member_delete':
            return P(`Deleted ${m === 'a member' ? 'a member (details removed)' : m}`);
          case 'member_review':
            return P(`Marked the new member ${m} as reviewed`);
          case 'member_suspend':
            return P(`Suspended the membership of ${m}`);
          case 'member_reactivate':
            return P(`Reactivated the membership of ${m}`);
          case 'member_claim':
            return P(`${m} claimed their membership`);
          case 'member_lapsed':
            return P(`The membership of ${m} ended (not renewed)`);
          case 'member_renew':
            return P(`${m} renewed their membership`);
        }
        break;
      }
      case 'contact': {
        switch (action) {
          case 'member_invite':
            return P(`Invited ${plural(num(a.count), 'past attendee')} to become members`);
          case 'contact_newsletter':
            return str(a.newsletter) === 'yes'
              ? P(
                  'Subscribed ',
                  contact(),
                  ' to the newsletter',
                  str(a.source) ? ` (${str(a.source)})` : '',
                )
              : P('Unsubscribed ', contact(), ' from the newsletter');
          case 'contact_create': {
            const label = str(a.email) || str(a.name);
            return P(
              'Created the contact ',
              str(a.email) ? contact(str(a.email)) : label || 'a contact',
            );
          }
          case 'contact_update':
            return P('Edited the contact ', contact());
          case 'contact_delete':
            return P(
              'Deleted a contact',
              num(b.registrations) ? ` and ${plural(num(b.registrations), 'registration')}` : '',
            );
          case 'contact_merge':
            return P(`Merged ${plural(num(b.keys), 'contact')} into `, contact(str(a.key)));
          case 'contact_tag_add':
            return P('Tagged ', contact());
          case 'contact_tag_remove':
            return P('Removed a tag from ', contact());
          case 'contact_group_add':
            return P('Added ', contact(), ' to a group');
          case 'contact_group_remove':
            return P('Removed ', contact(), ' from a group');
        }
        break;
      }
      case 'contact_tag': {
        const n = quoted(str(a.name) || str(b.name));
        if (action === 'contact_tag_create') return P('Created the tag ', n);
        if (action === 'contact_tag_rename')
          return P(`Renamed the tag ${quoted(str(b.name))} to `, n);
        if (action === 'contact_tag_delete') return P('Deleted the tag ', n);
        break;
      }
      case 'contact_group': {
        const n = quoted((id != null && names.groups.get(id)) || str(a.name) || str(b.name));
        if (action === 'contact_group_create') return P('Created the group ', n);
        if (action === 'contact_group_update') return P('Edited the group ', n);
        if (action === 'contact_group_delete') return P('Deleted the group ', n);
        break;
      }
      case 'person': {
        const p = link(person(), '/admin/people');
        if (action === 'create') return P('Added ', p, ' to Board and speakers');
        if (action === 'update') return P('Edited ', p, ' in Board and speakers');
        if (action === 'delete') return P(`Removed ${person()} from Board and speakers`);
        break;
      }
      case 'organisation': {
        const o = org();
        switch (action) {
          case 'create':
            return P('Added the listing ', o);
          case 'admin_update':
            return P('Edited the listing ', o);
          case 'delete':
            return row.actor === 'cron'
              ? P('Removed the expired listing ', o)
              : P('Deleted the listing ', o);
          case 'approve':
            return P('Approved and published the listing ', o);
          case 'reject':
            return P('Rejected the listing ', o);
          case 'submit':
            return P('Submitted a new listing: ', o);
          case 'verify':
            return P('Confirmed their email for the new listing ', o);
          case 'change_approve':
            return P("Approved the owner's changes to ", o);
          case 'change_reject':
            return P("Rejected the owner's changes to ", o);
          case 'claim_verified':
            return P('Asked to manage the listing ', o);
          case 'claim_approve':
            return P('Approved a request to manage ', o);
          case 'claim_reject':
            return P('Rejected a request to manage ', o);
          case 'invite_claim':
            return P(`Invited ${str(a.to) || 'someone'} to manage `, o);
          case 'member_approve':
            return P('Gave the Member badge to ', o);
          case 'member_reject':
            return P('Refused the Member badge to ', o);
          case 'membership_apply':
            return P('Applied for the Member badge for ', o);
          case 'owner_update':
            return P('Updated their listing ', o);
          case 'owner_change_requested':
            return P('Sent changes to review for ', o);
          case 'partner':
            return P('Changed the partner settings of ', o);
          case 'confirm':
            return P('Confirmed the listing ', o, ' is up to date');
          case 'reactivate':
            return P('Put the listing ', o, ' back online');
          case 'expire':
            return P('Took the listing ', o, ' offline (not confirmed in time)');
        }
        break;
      }
      case 'post': {
        if (action === 'move-bylines')
          return P(`Moved the author line of ${plural(num(a.ids), 'post')}`);
        const p = post();
        if (action === 'create') return P('Created the post ', p);
        if (action === 'update') return P('Edited the post ', p);
        if (action === 'delete') return P('Deleted the post ', p);
        break;
      }
      case 'media': {
        const file = (str(a.key) || str(b.key)).split('/').pop() ?? '';
        if (action === 'upload') return P(`Uploaded the file ${file}`);
        if (action === 'delete') return P(`Deleted the file ${file}`);
        break;
      }
      case 'email_template':
        if (action === 'email_template_update') return P('Edited the automatic email ', template());
        if (action === 'email_template_reset')
          return P('Put the automatic email ', template(), ' back to its default text');
        break;
      case 'community_email':
        return P(
          `Emailed the community (${plural(num(a.recipients), 'person', 'people')})`,
          str(a.subject) ? `: ${quoted(str(a.subject))}` : '',
        );
      case 'social_post': {
        const target =
          str(a.entity) === 'event'
            ? event(id)
            : str(a.entity) === 'post' && id != null
              ? link(names.posts.get(id) ?? 'a post', `/admin/posts/${id}`)
              : '';
        if (action === 'schedule')
          return P(
            `Scheduled ${plural(num(a.posts), 'social media post')} for `,
            target || 'an item',
          );
        if (action === 'cancel') return P('Cancelled a scheduled social media post');
        if (action === 'send-now') return P('Sent a social media post now');
        if (action === 'delete') return P('Deleted a social media post');
        break;
      }
      case 'email':
        if (action === 'unsuppress')
          return P(`Removed ${str(b.email) || 'an address'} from the blocked email list`);
        break;
      case 'settings':
        if (action === 'update') return P('Changed site settings');
        if (action === 'partner_groups') return P('Edited the partner groups');
        if (action === 'test-email')
          return P(`Sent a test email to ${str(a.to)}`, a.ok === false ? ' (it failed)' : '');
        if (action === 'test-notify')
          return P(
            `Sent a test team notification to ${valueText(a.to)}`,
            a.ok === false ? ' (it failed)' : '',
          );
        break;
    }
    // Anything not listed above still reads as words.
    return P(
      `${fieldLabel(action)} (${fieldLabel(entity).toLowerCase()}${id != null ? ` #${id}` : ''})`,
    );
  };

  let details = detailsOf(row.before, row.after);
  // Big lists (speakers, sponsors, partner groups, recap text) are summed up, not dumped.
  if (['speakers', 'sponsors', 'partner_groups', 'recap'].includes(action)) details = [];
  // A deletion's old name is already in the sentence.
  if (row.after == null && /delete|remove/.test(action)) details = [];
  return { area, parts: sentence(), details };
}
