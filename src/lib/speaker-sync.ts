// A People card made from a contact (event > Speakers > picked from Contacts) follows that
// contact: when the team edits the contact card or the person edits their membership profile,
// the name, job title, company and LinkedIn on their speaker card are updated too.
import { eq, inArray, isNull, or } from 'drizzle-orm';
import { getDb } from '../db';
import { contacts, members, people } from '../db/schema';
import { audit } from './orgs';
import { cardFor, mainEmailFor } from './contacts';
import type { ContactRow } from '../db/schema';
import { nameKey, speakerCardChanges, speakerDetails } from './speakers';

/** After a member edits their profile: the contact with this email (main or other one). */
export async function syncSpeakerCardForEmail(address: string, actor: string) {
  const email = address.trim().toLowerCase();
  const main = (await mainEmailFor(email)) ?? email;
  const [card] = await getDb().select().from(contacts).where(eq(contacts.email, main)).limit(1);
  return card ? syncSpeakerCard(card, actor) : 0;
}

/** After the team saves a contact: the contact with this key (lib/contacts.ts). */
export async function syncSpeakerCardForKey(key: string, actor: string) {
  const card = await cardFor(key);
  return card ? syncSpeakerCard(card, actor) : 0;
}

/** Updates the People card(s) made from this contact; returns how many changed. */
export async function syncSpeakerCard(card: ContactRow, actor: string) {
  const db = getDb();
  const emails = [card.email, ...card.otherEmails].filter((e): e is string => !!e);
  const profiles = !emails.length
    ? []
    : await db
        .select({
          email: members.email,
          jobTitle: members.jobTitle,
          company: members.company,
          linkedin: members.linkedin,
        })
        .from(members)
        .where(inArray(members.email, emails.slice(0, 90)));
  const details = speakerDetails(card, profiles);
  if (!details.name) return 0;
  // Cards made from this contact, and older Speakers cards under the same name linked to nobody
  // (board and institutional cards are written by hand and left alone).
  const key = nameKey(card.name);
  const linked = (
    await db
      .select({
        id: people.id,
        name: people.name,
        title: people.title,
        organisationName: people.organisationName,
        linkedin: people.linkedin,
        contactId: people.contactId,
        group: people.group,
      })
      .from(people)
      .where(or(eq(people.contactId, card.id), isNull(people.contactId)))
  ).filter((p) => p.contactId === card.id || (p.group === 'speaker' && nameKey(p.name) === key));
  let updated = 0;
  for (const p of linked) {
    const changes = speakerCardChanges(p, details);
    if (!changes) continue;
    await db.update(people).set(changes).where(eq(people.id, p.id));
    await audit(actor, 'update', 'person', p.id, { name: p.name }, changes);
    updated++;
  }
  return updated;
}
