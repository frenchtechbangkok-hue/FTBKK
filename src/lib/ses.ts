import { AwsClient } from 'aws4fetch';

/**
 * Amazon SES (API v2) for the site's emails: builds the MIME message ourselves (HTML + text,
 * inline QR images by content id, attachments) and posts it as a raw email, signed with
 * aws4fetch. Also reads the bounce and complaint notifications SES publishes through SNS.
 * Chosen by EMAIL_PROVIDER = "ses" (src/lib/email.ts); setup in docs/deploy.md, "Amazon SES".
 */

export interface MimeAttachment {
  filename: string;
  /** Base64. */
  content: string;
  contentType?: string;
  /** Set for an inline image (<img src="cid:…">). */
  contentId?: string;
}

export interface MimeMessage {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MimeAttachment[];
}

const CRLF = '\r\n';
/** Header values never carry line breaks (no header injection from names or subjects). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);

function base64Utf8(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Base64 cut into 76-character lines, as MIME requires. */
const wrap = (b64: string) => b64.replace(/\s+/g, '').replace(/(.{76})(?=.)/g, `$1${CRLF}`);

/** RFC 2047 encoded word for non-ASCII header text (subjects, names, file names). */
export function encodeWord(s: string) {
  const v = oneLine(s);
  if (ascii(v)) return v;
  // Encoded words stay under 75 characters: 12 characters (up to 48 bytes) each, folded.
  const chars = Array.from(v);
  const words: string[] = [];
  for (let i = 0; i < chars.length; i += 12) {
    words.push(`=?UTF-8?B?${base64Utf8(chars.slice(i, i + 12).join(''))}?=`);
  }
  return words.join(`${CRLF} `);
}

/** "Name <a@b.c>" with the name encoded when it isn't plain ASCII. */
export function encodeAddress(s: string) {
  const v = oneLine(s);
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(v);
  if (!m) return v;
  const name = m[1]!.replace(/^"|"$/g, '');
  if (!name) return `<${m[2]}>`;
  return ascii(name)
    ? `"${name.replace(/["\\]/g, '')}" <${m[2]}>`
    : `${encodeWord(name)} <${m[2]}>`;
}

const boundary = () => `=_ftbkk_${crypto.randomUUID().replace(/-/g, '')}`;

function part(headers: string[], body: string) {
  return [...headers, '', body].join(CRLF);
}

function multipart(type: string, parts: string[]) {
  const b = boundary();
  return {
    header: `Content-Type: multipart/${type}; boundary="${b}"`,
    body: [...parts.map((p) => `--${b}${CRLF}${p}`), `--${b}--`, ''].join(CRLF),
  };
}

function attachmentPart(a: MimeAttachment) {
  const name = encodeWord(a.filename).replace(/"/g, '');
  const headers = [
    `Content-Type: ${oneLine(a.contentType ?? 'application/octet-stream')}; name="${name}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: ${a.contentId ? 'inline' : 'attachment'}; filename="${name}"`,
  ];
  if (a.contentId) headers.push(`Content-ID: <${oneLine(a.contentId)}>`);
  return part(headers, wrap(a.content));
}

/**
 * The whole email as MIME text: multipart/alternative (text, HTML), wrapped in
 * multipart/related when there are inline images, and multipart/mixed when there are files.
 */
export function buildMime(m: MimeMessage) {
  const textPart = part(
    ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'],
    wrap(base64Utf8(m.text)),
  );
  const htmlPart = part(
    ['Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64'],
    wrap(base64Utf8(m.html)),
  );
  let top = multipart('alternative', [textPart, htmlPart]);
  const inline = (m.attachments ?? []).filter((a) => a.contentId);
  const files = (m.attachments ?? []).filter((a) => !a.contentId);
  if (inline.length) {
    top = multipart('related', [part([top.header], top.body), ...inline.map(attachmentPart)]);
  }
  if (files.length) {
    top = multipart('mixed', [part([top.header], top.body), ...files.map(attachmentPart)]);
  }
  const headers = [
    `From: ${encodeAddress(m.from)}`,
    `To: ${m.to.map(encodeAddress).join(', ')}`,
    ...(m.replyTo ? [`Reply-To: ${encodeAddress(m.replyTo)}`] : []),
    `Subject: ${encodeWord(m.subject)}`,
    'MIME-Version: 1.0',
    top.header,
  ];
  return [...headers, '', top.body].join(CRLF);
}

export interface SesConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /**
   * SES configuration set (SES_CONFIGURATION_SET) whose event publishing sends sends, deliveries,
   * opens and clicks to SNS for Reports > Emails. Empty = only bounces and complaints come back.
   */
  configurationSet?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends one email through SES (SendEmail, raw content). Retries a few times when SES says the
 * sending rate is exceeded (429) or has a passing error (5xx).
 */
export async function sesSend(
  cfg: SesConfig,
  m: MimeMessage,
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 'ses',
    region: cfg.region,
    retries: 0,
  });
  const body = JSON.stringify({
    Destination: { ToAddresses: m.to },
    Content: { Raw: { Data: base64Utf8(buildMime(m)) } },
    ...(cfg.configurationSet ? { ConfigurationSetName: cfg.configurationSet } : {}),
  });
  const url = `https://email.${cfg.region}.amazonaws.com/v2/email/outbound-emails`;
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(500 * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await client.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (e) {
      // Network failure, or the Worker's subrequest limit (50 per run on Workers Free).
      return { ok: false, error: String(e) };
    }
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { MessageId?: string };
      return { ok: true, messageId: data.MessageId };
    }
    last = `${res.status} ${await res.text()}`;
    if (res.status !== 429 && res.status < 500) break;
  }
  return { ok: false, error: last };
}

/**
 * Sends many emails at most `rate` per second (SES's "maximum send rate"), in order. Stops at the
 * first email that fails; `sent` is then how many emails before it went out, so callers can list
 * the people not reached. Emails sent alongside the failed one in the same second also went out.
 */
export async function sesSendMany(
  cfg: SesConfig,
  messages: MimeMessage[],
  rate: number,
): Promise<{ ok: boolean; sent: number; error?: string }> {
  const perSecond = Math.max(1, Math.floor(rate));
  let sent = 0;
  for (let i = 0; i < messages.length; i += perSecond) {
    const started = Date.now();
    const group = messages.slice(i, i + perSecond);
    const results = await Promise.all(group.map((m) => sesSend(cfg, m)));
    const failed = results.findIndex((r) => !r.ok);
    if (failed >= 0) return { ok: false, sent: sent + failed, error: results[failed]!.error };
    sent += group.length;
    const wait = 1000 - (Date.now() - started);
    if (i + perSecond < messages.length && wait > 0) await sleep(wait);
  }
  return { ok: true, sent };
}

/** What a bounce or complaint notification asks the site to do. */
export interface SesFeedback {
  kind: 'bounce' | 'complaint';
  emails: string[];
  detail: string;
}

/**
 * Reads an SES notification (identity feedback notifications, or event publishing) and returns
 * the addresses to stop emailing: permanent bounces and complaints. Soft bounces, deliveries and
 * anything else give null.
 */
export function readSesFeedback(message: unknown): SesFeedback | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  const type = String(m.notificationType ?? m.eventType ?? '');
  const emails = (list: unknown) =>
    Array.isArray(list)
      ? list
          .map((r) => String((r as { emailAddress?: unknown })?.emailAddress ?? ''))
          .map((e) => (/<([^<>]+)>/.exec(e)?.[1] ?? e).trim().toLowerCase())
          .filter((e) => e.includes('@'))
      : [];
  if (type === 'Bounce') {
    const b = (m.bounce ?? {}) as Record<string, unknown>;
    if (b.bounceType !== 'Permanent') return null;
    const recipients = Array.isArray(b.bouncedRecipients) ? b.bouncedRecipients : [];
    const diag = String(
      (recipients[0] as { diagnosticCode?: unknown } | undefined)?.diagnosticCode ?? '',
    );
    return {
      kind: 'bounce',
      emails: emails(recipients),
      detail: oneLine([b.bounceSubType, diag].filter(Boolean).join(': ')).slice(0, 300),
    };
  }
  if (type === 'Complaint') {
    const c = (m.complaint ?? {}) as Record<string, unknown>;
    return {
      kind: 'complaint',
      emails: emails(c.complainedRecipients),
      detail: oneLine(String(c.complaintFeedbackType ?? 'Marked as spam')).slice(0, 300),
    };
  }
  return null;
}

/** SNS only confirms subscriptions through its own hosts. */
export function isSnsUrl(u: string) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}
