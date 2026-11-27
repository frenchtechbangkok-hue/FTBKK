import { z } from 'zod';
import { optionalText, optionalUrl } from './forms';

// Speakers of an event: people (any group) linked to the event with an optional talk title, role
// on stage (speaker, moderator...) and a short bio written for this event.
// Pure helpers (no bindings) so they can be unit tested; queries are in queries.ts.

export const MAX_SPEAKERS = 30;
export const MAX_SPEAKER_BIO = 400;

/** Role on stage, shown as a label on the speaker card. Empty means "Speaker". */
export const SPEAKER_ROLES = ['speaker', 'keynote', 'moderator', 'panelist', 'host'] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];
export const SPEAKER_ROLE_LABELS: Record<SpeakerRole, string> = {
  speaker: 'Speaker',
  keynote: 'Keynote speaker',
  moderator: 'Moderator',
  panelist: 'Panelist',
  host: 'Host',
};
export function speakerRoleLabel(role: string | null | undefined) {
  return SPEAKER_ROLE_LABELS[role as SpeakerRole] ?? SPEAKER_ROLE_LABELS.speaker;
}
const role = z
  .union([z.literal(''), z.enum(SPEAKER_ROLES)])
  .optional()
  .transform((v) => (v && v !== 'speaker' ? v : null));
/** How many people "Speakers we've hosted" on About lists. */
export const HOSTED_SPEAKERS_LIMIT = 24;

const list = (len: number) => z.array(z.string().max(len)).max(MAX_SPEAKERS).default([]);
/**
 * The "Add a speaker" picker: "12" is someone in People, "contact:34" a contact tagged Speaker
 * who is not in People yet (a People card is made for them when the form is saved).
 */
const pickedSpeaker = z
  .union([
    z.literal(''),
    z.string().regex(/^(contact:)?[1-9]\d{0,11}$/, 'Pick someone from the list.'),
  ])
  .optional()
  .transform((v) => {
    if (!v) return { personId: null, contactId: null };
    return v.startsWith('contact:')
      ? { personId: null, contactId: Number(v.slice(8)) }
      : { personId: Number(v), contactId: null };
  });

/** The speakers form of the event editor (use formToObject(form, SPEAKER_ARRAYS)). */
export const SpeakersFormSchema = z
  .object({
    speakerId: list(12),
    speakerTalk: list(200),
    speakerRole: z
      .array(z.union([z.literal(''), z.enum(SPEAKER_ROLES)]))
      .max(MAX_SPEAKERS)
      .default([]),
    speakerBio: list(MAX_SPEAKER_BIO),
    speakerRemove: list(12),
    /** Link someone already in People or a contact tagged Speaker... */
    addPersonId: pickedSpeaker,
    /** ...or create a new person in the Speakers group. */
    newName: z
      .string()
      .max(120)
      .optional()
      .transform((s) => (s ? s : null))
      .refine((s) => s === null || s.length >= 2, 'Enter a name.'),
    newTitle: optionalText(120),
    newCompany: optionalText(120),
    newLinkedin: optionalUrl(),
    addTalkTitle: optionalText(200),
    addRole: role,
    addBio: optionalText(MAX_SPEAKER_BIO),
  })
  .refine((d) => !((d.addPersonId.personId || d.addPersonId.contactId) && d.newName), {
    message: 'Pick someone from the list or add a new speaker, not both.',
    path: ['addPersonId'],
  })
  .transform(({ addPersonId: picked, ...d }) => ({
    ...d,
    addPersonId: picked.personId,
    addContactId: picked.contactId,
  }));
export type SpeakersForm = z.infer<typeof SpeakersFormSchema>;
export const SPEAKER_ARRAYS = [
  'speakerId',
  'speakerTalk',
  'speakerRole',
  'speakerBio',
  'speakerRemove',
];

/** What the event stores about one of its speakers. */
export interface SpeakerDetails {
  personId: number;
  talkTitle: string | null;
  role: SpeakerRole | null;
  bio: string | null;
}
export interface SpeakerLink extends SpeakerDetails {
  sortOrder: number;
}

/**
 * The event's new speaker list from the form: the current speakers in the order the form lists
 * them (with their edited talk titles, roles and bios, minus the removed ones), then the one being added. Only
 * people who exist are linked, each once. Speakers missing from the form (added by another admin
 * meanwhile) are kept at the end.
 */
export function planSpeakers(
  prev: SpeakerDetails[],
  form: SpeakersForm,
  exists: (personId: number) => boolean,
  added: number | null = form.addPersonId,
): SpeakerLink[] {
  const prevIds = new Set(prev.map((s) => s.personId));
  const removed = new Set(form.speakerRemove.map(Number));
  const seen = new Set<number>();
  const out: SpeakerDetails[] = [];
  form.speakerId.forEach((raw, i) => {
    const personId = Number(raw);
    if (!prevIds.has(personId) || seen.has(personId)) return;
    seen.add(personId);
    if (removed.has(personId)) return;
    const r = form.speakerRole[i];
    out.push({
      personId,
      talkTitle: form.speakerTalk[i]?.trim() || null,
      role: r && r !== 'speaker' ? r : null,
      bio: form.speakerBio[i]?.trim() || null,
    });
  });
  for (const s of prev) {
    if (seen.has(s.personId) || removed.has(s.personId)) continue;
    seen.add(s.personId);
    out.push(s);
  }
  if (added && exists(added)) {
    const { addTalkTitle: talkTitle, addRole: role, addBio: bio } = form;
    const already = out.find((s) => s.personId === added);
    if (already) {
      already.talkTitle = talkTitle ?? already.talkTitle;
      already.role = role ?? already.role;
      already.bio = bio ?? already.bio;
    } else out.push({ personId: added, talkTitle, role, bio });
  }
  return out
    .filter((s) => exists(s.personId))
    .slice(0, MAX_SPEAKERS)
    .map((s, sortOrder) => ({ ...s, sortOrder }));
}

/** "Head of Growth, Acme" for the speaker picker and the event page. */
export function personLine(p: { title: string | null; organisationName: string | null }) {
  return [p.title, p.organisationName].filter(Boolean).join(', ');
}

// ---------- contacts tagged Speaker ----------

/** A contact card carrying the Speaker tag (Contacts > Tags and groups). */
export interface TaggedContact {
  id: number;
  email: string | null;
  otherEmails: string[];
  name: string;
  role: string | null;
  company: string | null;
  linkedin: string | null;
  /** The photo on their contact card, used for their People card. */
  photoKey?: string | null;
}
/** What the member's profile adds when the contact card leaves a field empty. */
export interface MemberProfile {
  email: string;
  jobTitle: string | null;
  company: string | null;
  linkedin: string | null;
}
/** Someone in People, as far as matching a contact goes. */
export interface PersonRef {
  id: number;
  name: string;
  contactId: number | null;
}
/** A contact tagged Speaker, offered in the speaker picker, with what their People card gets. */
export interface SpeakerCandidate {
  contactId: number;
  name: string;
  title: string | null;
  organisationName: string | null;
  linkedin: string | null;
}

/** Tags that mean "speaker": the built-in `speaker` tag, or one the team named Speaker(s). */
export function isSpeakerTag(t: { key: string; name: string }) {
  const name = t.name.trim().toLowerCase();
  return t.key === 'speaker' || name === 'speaker' || name === 'speakers';
}

/** "Élodie  Martin" and "elodie martin" are the same name. */
export function nameKey(name: string) {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The People card already standing for a contact: the one made from it, else someone with the
 * same name (People cards added by hand before this link existed).
 */
export function personForContact(c: { id: number; name: string }, everyone: PersonRef[]) {
  const key = nameKey(c.name);
  return (
    everyone.find((p) => p.contactId === c.id) ??
    everyone.find((p) => p.contactId === null && nameKey(p.name) === key) ??
    null
  );
}

/**
 * Contacts tagged Speaker who have no People card yet, by name, with their job title, company
 * and LinkedIn from the contact card or, where it is empty, from their membership profile.
 * Those who already have a card are listed with People, so nobody appears twice.
 */
export function speakerCandidates(
  tagged: TaggedContact[],
  memberProfiles: MemberProfile[],
  everyone: PersonRef[],
): SpeakerCandidate[] {
  return tagged
    .filter((c) => c.name.trim() && !personForContact(c, everyone))
    .map((c) => speakerDetails(c, memberProfiles))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/**
 * What a contact's People card shows: their contact card's name, job title, company and LinkedIn,
 * or their membership profile's where the card leaves one empty.
 */
export function speakerDetails(
  c: TaggedContact,
  memberProfiles: MemberProfile[],
): SpeakerCandidate {
  const byEmail = new Map(memberProfiles.map((m) => [m.email.toLowerCase(), m]));
  const m = [c.email, ...c.otherEmails]
    .filter((e): e is string => !!e)
    .map((e) => byEmail.get(e.toLowerCase()))
    .find(Boolean);
  return {
    contactId: c.id,
    name: c.name.trim(),
    title: c.role || m?.jobTitle || null,
    organisationName: c.company || m?.company || null,
    linkedin: c.linkedin || m?.linkedin || null,
  };
}

/** A People card as far as following its contact goes. */
export interface LinkedPerson {
  id: number;
  name: string;
  title: string | null;
  organisationName: string | null;
  linkedin: string | null;
  contactId: number | null;
}

/**
 * The changes that bring a People card in step with its contact after the contact card or the
 * membership profile was edited (null when nothing changes). A value the contact no longer has
 * is kept on the card, so clearing a field elsewhere never blanks a speaker card. A card matched
 * by name gets linked to the contact.
 */
export function speakerCardChanges(person: LinkedPerson, details: SpeakerCandidate) {
  const next = {
    name: details.name || person.name,
    title: details.title ?? person.title,
    organisationName: details.organisationName ?? person.organisationName,
    linkedin: details.linkedin ?? person.linkedin,
    contactId: details.contactId,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== person[k]);
  return changed.length ? Object.fromEntries(changed.map((k) => [k, next[k]])) : null;
}
