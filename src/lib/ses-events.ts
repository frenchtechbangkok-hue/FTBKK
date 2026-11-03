import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { readSesEvent } from './email-events';
import { recordEmailEvent } from './email-metrics';
import { recordFeedback } from './email-suppressions';
import { isSnsUrl, readSesFeedback } from './ses';

/**
 * POST /api/ses-events?key=SES_EVENTS_KEY: Amazon SNS delivers SES bounce and complaint
 * notifications here (docs/deploy.md, "Amazon SES"). Served by src/worker.ts before Astro, since
 * SNS posts text/plain without an Origin header, which Astro's form origin check refuses.
 *
 * The secret key in the URL proves the call comes from our SNS subscription; when
 * SES_EVENTS_TOPIC_ARN is set, the topic must match too.
 */
const SnsEnvelope = z.object({
  Type: z.enum(['SubscriptionConfirmation', 'Notification', 'UnsubscribeConfirmation']),
  TopicArn: z.string().max(300),
  Message: z.string().max(200_000).optional(),
  SubscribeURL: z.string().max(2000).optional(),
});

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/** Constant-time comparison, so the key can't be guessed one character at a time. */
function sameKey(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleSesEvents(request: Request) {
  if (request.method !== 'POST') return text(405, 'POST only');
  const key = env.SES_EVENTS_KEY ?? '';
  const given = new URL(request.url).searchParams.get('key') ?? '';
  if (!key || !sameKey(given, key)) return text(403, 'Forbidden');

  let raw: unknown;
  try {
    raw = JSON.parse(await request.text());
  } catch {
    return text(400, 'Not JSON');
  }
  const parsed = SnsEnvelope.safeParse(raw);
  if (!parsed.success) return text(400, 'Not an SNS message');
  const msg = parsed.data;
  if (env.SES_EVENTS_TOPIC_ARN && msg.TopicArn !== env.SES_EVENTS_TOPIC_ARN) {
    return text(403, 'Unknown topic');
  }

  if (msg.Type === 'SubscriptionConfirmation') {
    if (!msg.SubscribeURL || !isSnsUrl(msg.SubscribeURL)) return text(400, 'Bad SubscribeURL');
    const res = await fetch(msg.SubscribeURL);
    console.log('[ses-events] subscription to', msg.TopicArn, res.ok ? 'confirmed' : res.status);
    return text(res.ok ? 200 : 502, res.ok ? 'Subscribed' : 'Could not confirm');
  }
  if (msg.Type !== 'Notification' || !msg.Message) return text(200, 'Ignored');

  let event: unknown;
  try {
    event = JSON.parse(msg.Message);
  } catch {
    return text(200, 'Ignored');
  }
  const feedback = readSesFeedback(event);
  if (feedback?.emails.length) {
    await recordFeedback(feedback);
    console.log(`[ses-events] ${feedback.kind}: ${feedback.emails.length} address(es) suppressed`);
  }
  // Reports > Emails. Never fails the notification: a missing table (before migrations) is logged.
  const metric = readSesEvent(event);
  if (metric) {
    try {
      await recordEmailEvent(metric);
    } catch (e) {
      console.error('[ses-events] could not record for Reports', e);
    }
  }
  return text(200, 'OK');
}
