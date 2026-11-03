import { env } from 'cloudflare:workers';
import { readResendEvent, verifyResendSignature } from './email-events';
import { recordEmailEvent } from './email-metrics';
import { recordFeedback } from './email-suppressions';

/**
 * POST /api/resend-events: Resend's webhook (sent, delivered, bounced, complained, opened,
 * clicked…) for Reports > Emails. Signed by Resend with the endpoint's signing secret, kept in
 * the Worker secret RESEND_WEBHOOK_SECRET. Permanent bounces and spam complaints also go on the
 * site's "do not email" list, as SES ones do. Served by src/worker.ts before Astro.
 */
const text = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export async function handleResendEvents(request: Request) {
  if (request.method !== 'POST') return text(405, 'POST only');
  const secret = env.RESEND_WEBHOOK_SECRET ?? '';
  if (!secret) return text(503, 'Webhook not set up (RESEND_WEBHOOK_SECRET)');
  const body = await request.text();
  if (body.length > 500_000) return text(413, 'Too large');
  const ok = await verifyResendSignature(
    secret,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    body,
  );
  if (!ok) return text(401, 'Bad signature');

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return text(400, 'Not JSON');
  }
  const read = readResendEvent(payload);
  if (!read) return text(200, 'Ignored');
  // Resend retries on errors: a failure here is answered 500 so the event comes back later.
  try {
    await recordEmailEvent(read.event);
    if (read.feedback) await recordFeedback(read.feedback);
  } catch (e) {
    console.error('[resend-events]', e);
    return text(500, 'Could not record');
  }
  return text(200, 'OK');
}
