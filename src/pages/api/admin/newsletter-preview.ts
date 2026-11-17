import type { APIRoute } from 'astro';
import { z } from 'zod';
import { renderEmail } from '../../../lib/email';
import { blockProblems, parseBlocks } from '../../../lib/newsletter-blocks';
import {
  NEWSLETTER_AUDIENCE_KEYS,
  loadBlockData,
  newsletterMessage,
} from '../../../lib/newsletters';

const Input = z.object({
  id: z.coerce.number().int().positive().catch(0),
  subject: z.string().max(150).catch(''),
  preheader: z.string().max(200).catch(''),
  audience: z.enum(NEWSLETTER_AUDIENCE_KEYS).catch('newsletter'),
  webPage: z.boolean().catch(true),
  blocks: z.unknown(),
});

// Admin only (guarded in middleware). The live preview of a newsletter: the whole email as a
// subscriber called Camille would get it, and what still stops it from being sent.
export const POST: APIRoute = async ({ request }) => {
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid input.' }, { status: 400 });
  const d = parsed.data;
  const blocks = parseBlocks(d.blocks);
  const data = await loadBlockData(blocks);
  const msg = newsletterMessage(
    {
      id: d.id,
      subject: d.subject,
      preheader: d.preheader || null,
      audience: d.audience,
      slug: d.webPage ? 'preview' : null,
      webPage: d.webPage,
    },
    blocks,
    data,
    { test: true },
  );
  const email = msg.to({ name: 'Camille Martin', email: 'camille@example.com' });
  return Response.json({
    subject: email.subject,
    html: renderEmail(email).html,
    problems: blockProblems(blocks, data),
  });
};
