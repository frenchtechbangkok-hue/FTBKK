import { handle } from '@astrojs/cloudflare/handler';
import { runScheduled } from './lib/cron';
import { handleResendEvents } from './lib/resend-events';
import { handleSesEvents } from './lib/ses-events';
import { changesContent, edgeSafe, isProbe, probeNotFound, purgeEdgeCache } from './lib/edge-cache';
import { isDailyRun } from './lib/cron';
import { emailVisitRedirect } from './lib/email-visits';
import { handleOneClickUnsubscribe } from './lib/newsletter-unsubscribe';

export default {
  async fetch(request, env, ctx) {
    // Amazon SNS posts bounce and complaint notifications as text/plain without an Origin header,
    // which Astro's cross-site form check would refuse: handled here, before Astro.
    // Resend's webhook is handled the same way, before Astro: it checks its own signature.
    const path = new URL(request.url).pathname;
    if (path === '/api/ses-events') return handleSesEvents(request);
    if (path === '/api/resend-events') return handleResendEvents(request);
    // Mail apps' "Unsubscribe" button (List-Unsubscribe-Post, RFC 8058): a POST without Origin.
    if (path === '/api/newsletter-unsubscribe') return handleOneClickUnsubscribe(request);
    // A link from one of the site's emails (utm_source=ftbkk): counted, then the same page without
    // the tags (lib/email-visits.ts). Cloudflare Web Analytics can't see where these come from.
    const fromEmail = emailVisitRedirect(request, ctx);
    if (fromEmail) return fromEmail;
    // Bots looking for WordPress, PHP, .env…: a tiny 404 instead of building the site's 404 page.
    if (isProbe(path)) return probeNotFound();
    // The edge cache in front of the Worker keys on the path only: see lib/edge-cache.ts.
    const publicHost = new URL(env.SITE_URL || 'https://www.french-tech-bangkok.com').host;
    const res = await handle(request, env, ctx);
    // Something was saved: public pages kept at the edge (up to an hour) are built again.
    if (changesContent(request, res)) purgeEdgeCache(ctx, path);
    return edgeSafe(request, res, publicHost);
  },
  async scheduled(controller, env, ctx) {
    const now = new Date(controller.scheduledTime);
    ctx.waitUntil(
      runScheduled(env, now).then((changed) => {
        // The daily jobs (directory, renewals…) and sent newsletters change public pages.
        if (changed || isDailyRun(now)) purgeEdgeCache(ctx, 'cron');
      }),
    );
  },
} satisfies ExportedHandler<Env>;
