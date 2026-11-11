import { handle } from '@astrojs/cloudflare/handler';
import { runScheduled } from './lib/cron';
import { handleResendEvents } from './lib/resend-events';
import { handleSesEvents } from './lib/ses-events';
import { edgeSafe } from './lib/edge-cache';

export default {
  async fetch(request, env, ctx) {
    // Amazon SNS posts bounce and complaint notifications as text/plain without an Origin header,
    // which Astro's cross-site form check would refuse: handled here, before Astro.
    // Resend's webhook is handled the same way, before Astro: it checks its own signature.
    const path = new URL(request.url).pathname;
    if (path === '/api/ses-events') return handleSesEvents(request);
    if (path === '/api/resend-events') return handleResendEvents(request);
    // The edge cache in front of the Worker keys on the path only: see lib/edge-cache.ts.
    const publicHost = new URL(env.SITE_URL || 'https://www.french-tech-bangkok.com').host;
    return edgeSafe(request, await handle(request, env, ctx), publicHost);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
