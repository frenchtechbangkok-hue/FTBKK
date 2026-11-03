import { z } from 'zod';
import type { SesFeedback } from './ses';

/**
 * What the email providers tell us after an email leaves the site, turned into one shape for
 * Reports > Emails: Resend's webhook (/api/resend-events) and Amazon SES's events through SNS
 * (/api/ses-events). Pure functions, so they are unit tested without a database.
 */

export type EmailEventKind =
  'sent' | 'delivered' | 'delayed' | 'bounced' | 'complained' | 'opened' | 'clicked' | 'failed';

export interface EmailEvent {
  provider: 'resend' | 'ses';
  messageId: string;
  kind: EmailEventKind;
  /** When the email was sent (the period it counts in). */
  sentAt: Date;
  /** When this step happened. */
  at: Date;
  subject: string | null;
  recipients: number;
  /** For bounces. */
  bounceType?: 'permanent' | 'temporary';
}

const date = (v: unknown, fallback: Date) => {
  const d = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
};
const cleanSubject = (v: unknown) =>
  typeof v === 'string' && v.trim()
    ? v
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, 300)
    : null;
const address = (e: string) => (/<([^<>]+)>/.exec(e)?.[1] ?? e).trim().toLowerCase();

// ---------- Resend ----------

const RESEND_KINDS: Record<string, EmailEventKind> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.failed': 'failed',
  // Resend didn't send it: the address is on Resend's own suppression list.
  'email.suppressed': 'failed',
};

const ResendPayload = z.object({
  type: z.string().max(100),
  created_at: z.string().max(100).optional(),
  data: z
    .object({
      email_id: z.string().min(1).max(200),
      created_at: z.string().max(100).optional(),
      subject: z.string().max(2000).optional(),
      to: z.union([z.array(z.string().max(500)), z.string().max(500)]).optional(),
      bounce: z
        .object({ type: z.string().max(100).optional() })
        .loose()
        .optional(),
    })
    .loose(),
});

/**
 * Reads one Resend webhook payload: the report event, and for a permanent bounce or a spam
 * complaint the addresses to stop emailing. Other events (domains, contacts…) give null.
 */
export function readResendEvent(
  payload: unknown,
  now = new Date(),
): { event: EmailEvent; feedback: SesFeedback | null } | null {
  const p = ResendPayload.safeParse(payload);
  if (!p.success) return null;
  const kind = RESEND_KINDS[p.data.type];
  if (!kind) return null;
  const d = p.data.data;
  const to = (Array.isArray(d.to) ? d.to : d.to ? [d.to] : []).map(address).filter(Boolean);
  const at = date(p.data.created_at, now);
  const bounceType =
    kind === 'bounced'
      ? /permanent/i.test(d.bounce?.type ?? '')
        ? ('permanent' as const)
        : ('temporary' as const)
      : undefined;
  const event: EmailEvent = {
    provider: 'resend',
    messageId: d.email_id,
    kind,
    sentAt: date(d.created_at, at),
    at,
    subject: cleanSubject(d.subject),
    recipients: Math.max(1, to.length),
    ...(bounceType ? { bounceType } : {}),
  };
  const feedback: SesFeedback | null =
    (bounceType === 'permanent' || kind === 'complained') && to.length
      ? {
          kind: kind === 'complained' ? 'complaint' : 'bounce',
          emails: to,
          detail:
            kind === 'complained'
              ? 'Marked as spam (Resend)'
              : `Bounced (Resend)${d.bounce?.type ? `: ${String(d.bounce.type)}` : ''}`.slice(
                  0,
                  300,
                ),
        }
      : null;
  return { event, feedback };
}

/** Base64 of a byte array. */
function toBase64(bytes: Uint8Array) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Checks a Resend webhook's signature (Resend signs with Svix): HMAC-SHA256 of
 * "<svix-id>.<svix-timestamp>.<body>" with the endpoint's signing secret ("whsec_…"), and a
 * timestamp at most 5 minutes off, so an old request can't be replayed.
 */
export async function verifyResendSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = new Date(),
): Promise<boolean> {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > 300) return false;
  let key: Uint8Array<ArrayBuffer>;
  try {
    key = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(`${headers.id}.${headers.timestamp}.${body}`),
  );
  const expected = toBase64(new Uint8Array(mac));
  // "v1,<sig> v1,<sig2>": several while the secret is being rotated.
  return headers.signature
    .split(' ')
    .map((s) => s.split(',')[1] ?? '')
    .some((sig) => sameText(sig, expected));
}

/** Constant-time comparison. */
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- Amazon SES ----------

const SES_KINDS: Record<string, { kind: EmailEventKind; field?: string }> = {
  Send: { kind: 'sent' },
  Delivery: { kind: 'delivered', field: 'delivery' },
  DeliveryDelay: { kind: 'delayed', field: 'deliveryDelay' },
  Bounce: { kind: 'bounced', field: 'bounce' },
  Complaint: { kind: 'complained', field: 'complaint' },
  Open: { kind: 'opened', field: 'open' },
  Click: { kind: 'clicked', field: 'click' },
  Reject: { kind: 'failed', field: 'reject' },
  'Rendering Failure': { kind: 'failed', field: 'failure' },
};

/**
 * Reads an SES notification: event publishing through a configuration set ("eventType": Send,
 * Delivery, Open, Click…) or the identity's feedback notifications ("notificationType": Bounce,
 * Complaint, Delivery). Null when it isn't about an email.
 */
export function readSesEvent(message: unknown, now = new Date()): EmailEvent | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  const type = String(m.eventType ?? m.notificationType ?? '');
  const spec = SES_KINDS[type];
  const mail = (m.mail ?? {}) as Record<string, unknown>;
  const messageId = typeof mail.messageId === 'string' ? mail.messageId.slice(0, 200) : '';
  if (!spec || !messageId) return null;
  const sentAt = date(mail.timestamp, now);
  const detail = (spec.field ? (m[spec.field] ?? {}) : {}) as Record<string, unknown>;
  const headers = (mail.commonHeaders ?? {}) as Record<string, unknown>;
  const destination = Array.isArray(mail.destination) ? mail.destination : [];
  return {
    provider: 'ses',
    messageId,
    kind: spec.kind,
    sentAt,
    at: date(detail.timestamp, sentAt),
    subject: cleanSubject(headers.subject),
    recipients: Math.max(1, destination.length),
    ...(spec.kind === 'bounced'
      ? { bounceType: detail.bounceType === 'Permanent' ? 'permanent' : 'temporary' }
      : {}),
  } as EmailEvent;
}
