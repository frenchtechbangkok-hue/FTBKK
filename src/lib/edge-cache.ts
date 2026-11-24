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

/**
 * Public pages: browsers always ask again; the edge keeps a copy an hour and refreshes it in the
 * background. Anything saved (admin, or a form on the site) clears the whole edge cache at once
 * (purgeAfterChange), so the hour only matters for changes that come with time alone, such as an
 * event moving to "past". Each copy the edge serves is a page the Worker doesn't build: CPU time.
 */
export const PUBLIC_PAGE = {
  browser: 'public, max-age=0, must-revalidate',
  edge: 'max-age=3600, stale-while-revalidate=3600, stale-if-error=86400',
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

/**
 * Marks a page as personal or one-off: never kept by browsers or the edge. Call it in the page's
 * own frontmatter (not in a layout or component: by then Astro has already sent the headers).
 */
export function privatePage(astro: { response: { headers: Headers } }) {
  astro.response.headers.set('Cache-Control', NEVER);
}

/**
 * Headers for a public HTML page answered by the Worker (set by the middleware): a GET or HEAD that ended
 * in 200 with no Cache-Control of its own (privatePage sets one) and no admin login cookie.
 */
export function publicPageHeaders(request: Request, res: Response) {
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (!read || res.status !== 200 || res.headers.has('Cache-Control')) return;
  if (!(res.headers.get('Content-Type') ?? '').startsWith('text/html')) return;
  // An admin (Cloudflare Access cookie) may see previews of hidden guides: never keep those.
  if (/(?:^|;\s*)CF_Authorization=/.test(request.headers.get('Cookie') ?? '')) {
    res.headers.set('Cache-Control', NEVER);
    return;
  }
  res.headers.set('Cache-Control', PUBLIC_PAGE.browser);
  res.headers.set(EDGE_HEADER, PUBLIC_PAGE.edge);
}

/**
 * Requests that change what public pages show: anything but a read that didn't fail, except the
 * admin calls that only preview, count or check people in (frequent, and nothing public changes).
 * The webhooks and one-click unsubscribe are answered before this check (src/worker.ts).
 */
export function changesContent(request: Request, res: Response) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || res.status >= 400) return false;
  const path = new URL(request.url).pathname;
  return !/^\/api\/admin\/(?:[\w-]*preview|dashboard-traffic|post-views|checkin|walk-in)\b/.test(
    path,
  );
}

/**
 * Clears the edge cache (ctx.cache.purge, Workers Caching) so the next visit of any page is built
 * again with the new content. In the background; a failure (e.g. Cloudflare's purge rate limit)
 * is logged and the pages refresh within the hour anyway.
 */
export function purgeEdgeCache(ctx: ExecutionContext, why: string) {
  if (!ctx.cache) return;
  ctx.waitUntil(
    ctx.cache.purge({ purgeEverything: true }).then(
      (r) => {
        if (!r.success) console.warn('[edge-cache] purge failed', why, JSON.stringify(r.errors));
      },
      (e) => console.warn('[edge-cache] purge failed', why, e),
    ),
  );
}

/**
 * Bots probing for other software (WordPress, PHP, .env, .git…): a tiny 404 before Astro, so they
 * don't cost a full "page not found" page each. The site has none of these paths.
 */
export function isProbe(pathname: string) {
  return /\.(?:php\d?|aspx?|jsp|cgi|env|ini|sql|bak|ya?ml)$|^\/(?:wp-|wordpress\b|\.git\b|\.env|\.aws\b|xmlrpc|cgi-bin\b|phpmyadmin\b)/i.test(
    pathname,
  );
}

export const probeNotFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': NEVER },
  });
