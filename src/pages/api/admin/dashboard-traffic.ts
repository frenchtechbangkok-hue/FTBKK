import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { sparkPoints, weekChange, weekWindow } from '../../../lib/dashboard';
import { trafficConfig } from '../../../lib/reports';
import { getSettings } from '../../../lib/settings';
import { loadTraffic } from '../../../lib/traffic';

// Admin only (guarded in middleware). Website visits for the dashboard's "Last 7 days", loaded
// after the page opens so a slow Cloudflare answer never holds the dashboard up.
export const GET: APIRoute = async () => {
  const token = env.CF_ANALYTICS_TOKEN ?? '';
  const headers = { 'Cache-Control': 'private, max-age=300' };
  if (!token) return Response.json({ connected: false }, { headers });
  const now = new Date();
  const w = weekWindow(now);
  try {
    const settings = await getSettings();
    const r = await loadTraffic(
      trafficConfig(token, settings.analyticsToken),
      {
        from: w.from,
        to: w.to,
        previous: w.previous,
        buckets: w.days.map((d) => ({ key: d.from.toISOString(), label: '', ...d })),
      },
      now,
    );
    const p = r.pageloads.data;
    if (!p) return Response.json({ connected: true, error: r.pageloads.error }, { headers });
    return Response.json(
      {
        connected: true,
        visits: p.visits,
        change: weekChange(p.visits, r.previous?.visits ?? null),
        points: sparkPoints(p.visitsSeries),
      },
      { headers },
    );
  } catch (e) {
    return Response.json({ connected: true, error: (e as Error).message }, { headers });
  }
};
