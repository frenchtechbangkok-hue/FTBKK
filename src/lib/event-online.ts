import type { Event } from '../db/schema';

/**
 * The online link of an event: the webinar to join (an online event) or the live stream (an
 * event at a venue that is also streamed). Registrants get it in their emails, ticket and
 * calendar invite; the public page shows it only when nobody registers (walk-in events), so a
 * webinar link isn't posted for anyone to pick up.
 */
export function onlineLink(
  e: Pick<Event, 'online' | 'onlineUrl'>,
): { label: string; url: string } | null {
  if (!e.onlineUrl) return null;
  return { label: e.online ? 'Join online' : 'Watch the live stream', url: e.onlineUrl };
}

/** True when the page itself shows the link: nobody registers, so nobody would get it. */
export const onlineLinkIsPublic = (e: Pick<Event, 'noRegistration'>) => e.noRegistration;
