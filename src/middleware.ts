import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { legacyMatch, resolveLegacy } from './lib/redirects';
import { checkAdmin } from './lib/auth';
import { siteOrigin } from './lib/site';
import { oldLinkRedirect } from './lib/edge-cache';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;

  // The www / bare twin of the public address (french-tech-bangkok.com vs www.…) goes to the
  // public address in one 301, so old Wix links on either host keep their search ranking.
  const canonical = siteOrigin();
  const host = context.url.host;
  const twin = host === `www.${canonical.host}` || `www.${host}` === canonical.host;

  // Old Wix URLs: permanent redirects, checked against the slugs in D1 (see lib/redirects.ts).
  const legacy = legacyMatch(pathname);
  if (legacy || twin) {
    const to = legacy ? await resolveLegacy(legacy, env.DB) : pathname;
    const target = to.includes('#') ? to : `${to}${search}`;
    if (twin) return oldLinkRedirect(new URL(target, canonical).href, false);
    // Old Wix links on the public address: Cloudflare's edge keeps the answer a day.
    return oldLinkRedirect(target, !pathname.startsWith('/admin'));
  }

  // Trailing slash: /events/ -> /events
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return context.redirect(pathname.slice(0, -1) + search, 301);
  }

  // Short address to bookmark on the door volunteers' phones; Access guards the target.
  if (pathname === '/checkin') return context.redirect('/admin/checkin', 302);

  if (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/api/admin/')
  ) {
    const check = await checkAdmin(context.request);
    if (!('email' in check)) {
      // Plain text so nothing from the token can render as HTML; the reason helps fix Access setup.
      console.warn('[auth] admin refused:', check.reason);
      return new Response(`Forbidden\n\n${check.reason}\n`, {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    context.locals.adminEmail = check.email;
    const res = await next();
    try {
      res.headers.set('Cache-Control', 'private, no-store');
    } catch {
      // Immutable headers (e.g. Response.redirect): nothing to cache anyway.
    }
    return res;
  }

  const res = await next();
  // Only the public address (SITE_URL) should be indexed: preview and version URLs of the Worker,
  // and the workers.dev address once the domain is live, tell search engines to stay away.
  if (context.url.host !== siteOrigin().host && !LOCAL_HOSTS.has(context.url.hostname)) {
    try {
      res.headers.set('X-Robots-Tag', 'noindex');
    } catch {
      // Immutable headers (e.g. Response.redirect): nothing to index anyway.
    }
  }
  return res;
});
