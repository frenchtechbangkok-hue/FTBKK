import type { APIRoute } from 'astro';
import { eventContent } from '../../../lib/newsletters';

// Admin only (guarded in middleware). What the newsletter builder can copy from an event: its
// recap photos, speakers and logos of host, sponsors and partners.
export const GET: APIRoute = async ({ url }) => {
  const slug = (url.searchParams.get('slug') ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(slug))
    return Response.json({ error: 'Unknown event.' }, { status: 400 });
  const content = await eventContent(slug);
  if (!content) return Response.json({ error: 'Unknown event.' }, { status: 404 });
  return Response.json(content);
};
