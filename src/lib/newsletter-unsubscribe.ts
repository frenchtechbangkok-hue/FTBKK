import { unsubscribeByToken } from './newsletters';

/**
 * The one-click unsubscribe of mail apps (Gmail, Apple Mail…): the List-Unsubscribe header of a
 * newsletter points here and the app POSTs "List-Unsubscribe=One-Click" (RFC 8058), with no
 * Origin header, so it is answered by src/worker.ts before Astro's form check. A GET (a person
 * or a link scanner opening the address) only goes to the page with a button.
 */
export async function handleOneClickUnsubscribe(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get('t') ?? '').slice(0, 100);
  if (request.method !== 'POST') {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/newsletters/unsubscribe?t=${encodeURIComponent(token)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  }
  const done = await unsubscribeByToken(token);
  return new Response(done ? 'Unsubscribed.' : 'Unknown link.', {
    status: done ? 200 : 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}
