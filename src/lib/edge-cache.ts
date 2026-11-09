// Cloudflare's Workers cache ("cache": { "enabled": true } in wrangler.jsonc) sits in front of the
// Worker: a page it has stored is served without running the Worker at all. Its cache key is the
// path and query string only, not the host and not the cookies, and a response without a
// Cache-Control header is kept by guesswork (a 200 for 2 hours, a redirect for longer). So every
// response goes through edgeSafe() on its way out, and only these may be shared at the edge:
// a 200 for the public address (SITE_URL) that asked for it (public / s-maxage, or a
// Cloudflare-CDN-Cache-Control header), and nothing marked private or no-store; plus the 301s of
// old Wix links (oldLinkRedirect). Everything else (other redirects, errors, the www and workers.dev addresses, admin, member and API answers without
// a header) leaves marked private, no-store.

/** Header that sets the edge cache only (browsers ignore it); takes precedence over Cache-Control. */
export const EDGE_HEADER = 'Cloudflare-CDN-Cache-Control';

/** Public pages: browsers always ask again, the edge keeps a copy 60 s and refreshes it in the background. */
export const PUBLIC_PAGE = {
  browser: 'public, max-age=0, must-revalidate',
  edge: 'max-age=60, stale-while-revalidate=600, stale-if-error=86400',
};

const NEVER = 'private, no-store';

export function shareable(res: Response) {
  const cc = (res.headers.get('Cache-Control') ?? '').toLowerCase();
  if (/\b(private|no-store)\b/.test(cc)) return false;
  return /\b(public|s-maxage)\b/.test(cc) || res.headers.has(EDGE_HEADER);
}

/**
 * The response, made safe for the shared edge cache: unchanged when it may be shared, otherwise
 * marked private, no-store (a copy is made when the headers can't be changed in place).
 */
export function edgeSafe(request: Request, res: Response, publicHost: string): Response {
  const host = new URL(request.url).host;
  const kept =
    res.status === 200 || (res.status === 301 && res.headers.get(EDGE_HEADER) === OLD_LINK_EDGE);
  if (kept && host === publicHost && shareable(res)) return res;
  const cc = (res.headers.get('Cache-Control') ?? '').toLowerCase();
  if (/\bno-store\b/.test(cc) && /\bprivate\b/.test(cc) && !res.headers.has(EDGE_HEADER))
    return res;
  // WebSocket upgrades and other special responses: leave them alone.
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', NEVER);
  out.headers.delete(EDGE_HEADER);
  out.headers.delete('CDN-Cache-Control');
  return out;
}

/** How long the edge keeps the 301 of an old Wix link (the target rarely changes). */
export const OLD_LINK_EDGE = 'max-age=86400';

/**
 * The 301 for an old Wix link. On the public address (not an admin path) the edge keeps it a day,
 * so repeat visits and crawlers get the redirect from Cloudflare without running the Worker or
 * the slug lookup in D1. The www twin's redirects are never kept (the cache key has no host).
 */
export function oldLinkRedirect(location: string, keepAtEdge: boolean) {
  const headers = new Headers({ Location: location });
  if (keepAtEdge) {
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set(EDGE_HEADER, OLD_LINK_EDGE);
  } else headers.set('Cache-Control', NEVER);
  return new Response(null, { status: 301, headers });
}
