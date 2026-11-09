import type { APIRoute } from 'astro';
import { z } from 'zod';
import { EMAIL_TEMPLATES, isTemplateKey, sampleEmail } from '../../../lib/email-templates';
import { renderEmail } from '../../../lib/email';

const Input = z.object({
  key: z.string().max(80),
  subject: z.string().max(200).catch(''),
  body: z.string().max(5000).catch(''),
  buttonLabel: z.string().max(60).nullable().catch(null),
});

// Admin only (guarded in middleware). The live preview of Admin > Automatic emails: the email
// as it would go out with the sample values, while the message is being typed. Nothing is saved.
export const POST: APIRoute = async ({ request }) => {
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isTemplateKey(parsed.data.key))
    return Response.json({ error: 'Invalid input.' }, { status: 400 });
  const d = parsed.data;
  const def = EMAIL_TEMPLATES[d.key as keyof typeof EMAIL_TEMPLATES];
  const email = sampleEmail(def, {
    subject: d.subject,
    body: d.body,
    buttonLabel: def.buttonLabel === undefined ? null : d.buttonLabel,
  });
  return Response.json({ subject: email.subject, html: renderEmail(email).html });
};
