import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { trafficConfig } from '../../../lib/reports';
import { getSettings } from '../../../lib/settings';
import { pageViewsByPath } from '../../../lib/traffic';

// Admin only (guarded in middleware). Page views of each blog post over the last 30 days, for
// the Blog posts list, loaded after the page opens so Cloudflare never holds the list up.
export const GET: APIRoute = async () => {
  const token = env.CF_ANALYTICS_TOKEN ?? '';
  const headers = { 'Cache-Control': 'private, max-age=600' };
  if (!token) return Response.json({ connected: false }, { headers });
  try {
    const settings = await getSettings();
    const views = await pageViewsByPath(
      trafficConfig(token, settings.analyticsToken),
      '/blog/',
      30,
    );
    return Response.json({ connected: true, views }, { headers });
  } catch (e) {
    return Response.json({ connected: true, error: (e as Error).message }, { headers });
  }
};
