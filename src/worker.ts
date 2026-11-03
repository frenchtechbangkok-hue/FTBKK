import { handle } from '@astrojs/cloudflare/handler';
import { runScheduled } from './lib/cron';
import { handleSesEvents } from './lib/ses-events';

export default {
  async fetch(request, env, ctx) {
    // Amazon SNS posts bounce and complaint notifications as text/plain without an Origin header,
    // which Astro's cross-site form check would refuse: handled here, before Astro.
    if (new URL(request.url).pathname === '/api/ses-events') return handleSesEvents(request);
    return handle(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
