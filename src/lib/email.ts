import { env } from 'cloudflare:workers';
import { suppressedAmong, suppressedEmails } from './email-suppressions';
import { sesSend, sesSendMany, type MimeMessage, type SesConfig } from './ses';

export interface EmailAttachment {
  filename: string;
  content: string; // base64
  contentType?: string;
  /** Set to show the attachment inline: <img src="cid:…">. */
  contentId?: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  /** Short paragraphs (plain text, no HTML; a line break shows as one). */
  paragraphs: string[];
  /**
   * Ready-made HTML for the body, used instead of the paragraphs in the HTML version (Markdown
   * messages, already sanitised and inline-styled by emailMarkdown); the paragraphs still make
   * the plain-text version.
   */
  bodyHtml?: string;
  /** A row of one-click choices, such as a 1 to 5 rating, shown before the button. */
  choices?: {
    question: string;
    options: { label: string; url: string; title?: string }[];
    hint?: string;
  };
  /** Optional call-to-action button. */
  action?: { label: string; url: string };
  /** Extra rows rendered as "Label: value" (event date, venue…). */
  details?: [string, string][];
  /** A row of logos (hosts, sponsors) under the details: absolute image URLs, alt = name. */
  logos?: { src: string; alt: string; url?: string }[];
  /** Optional secondary links under the button. */
  links?: { label: string; url: string }[];
  footer?: string;
  /** The person's "Manage or delete my data" page (/my-data?token=…), linked in the footer. */
  dataUrl?: string;
  /** Event ticket: QR code (an inline attachment with this content id) and its code. */
  ticket?: { code: string; qrCid: string; url: string };
  replyTo?: string;
  attachments?: EmailAttachment[];
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Label of the footer link to the person's /my-data page. */
export const DATA_LINK_LABEL = 'Manage or delete my data';

/** One branded template for every email on the site (HTML + plain text). */
export function renderEmail(m: EmailMessage) {
  // Inline copies of the theme tokens (src/styles/global.css): email clients ignore stylesheets.
  const navy = '#160b47';
  const brand = '#d6223d';
  const details = m.details?.length
    ? `<table role="presentation" style="margin:16px 0;border-collapse:collapse">${m.details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 12px 4px 0;color:#5c5a73;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;color:#1a1530">${esc(v)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const logos = m.logos?.length
    ? `<p style="margin:0 0 16px">${m.logos
        .map((l) => {
          const img = `<img src="${esc(l.src)}" alt="${esc(l.alt)}" height="40" style="height:40px;width:auto;max-width:140px;vertical-align:middle;border:0;margin:0 16px 8px 0">`;
          return l.url ? `<a href="${esc(l.url)}">${img}</a>` : img;
        })
        .join('')}</p>`
    : '';
  const choices = m.choices
    ? `<p style="margin:20px 0 8px;font-weight:600;color:${navy}">${esc(m.choices.question)}</p>
<table role="presentation" style="border-collapse:separate;border-spacing:0 0"><tr>${m.choices.options
        .map(
          (o) =>
            `<td style="padding:0 8px 0 0"><a href="${esc(o.url)}"${o.title ? ` title="${esc(o.title)}"` : ''} style="display:inline-block;width:44px;height:44px;line-height:44px;text-align:center;border:2px solid ${navy};border-radius:10px;color:${navy};font-weight:700;font-size:18px;text-decoration:none">${esc(o.label)}</a></td>`,
        )
        .join('')}</tr></table>${
        m.choices.hint
          ? `<p style="margin:8px 0 0;font-size:13px;color:#5c5a73">${esc(m.choices.hint)}</p>`
          : ''
      }`
    : '';
  const button = m.action
    ? `<p style="margin:24px 0"><a href="${esc(m.action.url)}" style="background:${brand};color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;display:inline-block">${esc(m.action.label)}</a></p>`
    : '';
  const links = m.links?.length
    ? `<p style="margin:8px 0;font-size:14px">${m.links
        .map((l) => `<a href="${esc(l.url)}" style="color:#0062ff">${esc(l.label)}</a>`)
        .join(' &nbsp;·&nbsp; ')}</p>`
    : '';
  const ticket = m.ticket
    ? `<table role="presentation" style="margin:20px 0;border:1px solid #e0dfe8;border-radius:12px;width:100%"><tr><td align="center" style="padding:20px">
<p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;color:#5c5a73;text-transform:uppercase">Your ticket</p>
<img src="cid:${esc(m.ticket.qrCid)}" width="200" height="200" alt="QR code for ticket ${esc(m.ticket.code)}" style="display:block;width:200px;height:200px">
<p style="margin:8px 0 0;font-family:'Courier New',monospace;font-size:22px;font-weight:700;letter-spacing:.12em;color:${navy}">${esc(m.ticket.code)}</p>
<p style="margin:8px 0 0;font-size:13px;color:#5c5a73">Show it at the entrance. <a href="${esc(m.ticket.url)}" style="color:#0062ff">Open it on your phone</a></p>
</td></tr></table>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" style="background:#f5f5f5;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" style="max-width:560px;width:100%;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:${navy};padding:20px 28px;color:#fff;font-weight:700;font-size:18px">La French Tech Bangkok</td></tr>
<tr><td style="padding:28px;color:#1a1530;font-size:16px;line-height:1.6">
${m.bodyHtml ?? m.paragraphs.map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
${details}${logos}${ticket}${choices}${button}${links}
</td></tr>
<tr><td style="padding:16px 28px;background:#f5f5f5;color:#5c5a73;font-size:12px">${esc(m.footer ?? 'La French Tech Bangkok · a volunteer-run community · french-tech-bangkok.com')}${
    m.dataUrl
      ? `<br><a href="${esc(m.dataUrl)}" style="color:#5c5a73;text-decoration:underline">${DATA_LINK_LABEL}</a>`
      : ''
  }</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    ...m.paragraphs,
    ...(m.details ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(m.ticket
      ? [`Your ticket: ${m.ticket.code} (show it at the entrance): ${m.ticket.url}`]
      : []),
    ...(m.choices
      ? [
          [
            `${m.choices.question}${m.choices.hint ? ` (${m.choices.hint})` : ''}:`,
            ...m.choices.options.map((o) => `${o.title ?? o.label}: ${o.url}`),
          ].join('\n'),
        ]
      : []),
    ...(m.action ? [`${m.action.label}: ${m.action.url}`] : []),
    ...(m.links ?? []).map((l) => `${l.label}: ${l.url}`),
    '',
    '--',
    m.footer ?? 'La French Tech Bangkok',
    ...(m.dataUrl ? [`${DATA_LINK_LABEL}: ${m.dataUrl}`] : []),
  ].join('\n\n');
  return { html, text };
}

// ---------- sending: Resend or Amazon SES (Admin > Email delivery, else EMAIL_PROVIDER) ----------

export type EmailProvider = 'resend' | 'ses';
export const PROVIDER_NAMES: Record<EmailProvider, string> = {
  resend: 'Resend',
  ses: 'Amazon SES',
};

/** EMAIL_PROVIDER in wrangler.jsonc ("resend" by default): used until a service is chosen in the admin. */
export const defaultEmailProvider = (): EmailProvider =>
  env.EMAIL_PROVIDER === 'ses' ? 'ses' : 'resend';

/**
 * The provider every email goes through: the one chosen in Admin > Email delivery (settings key
 * `emailProvider`), else EMAIL_PROVIDER. A chosen service whose key was removed falls back too.
 */
export async function emailProvider(): Promise<EmailProvider> {
  let chosen: unknown = null;
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'emailProvider'",
    ).first<{
      value: string;
    }>();
    chosen = row ? JSON.parse(row.value) : null;
  } catch {
    // No database (tests) or table not migrated yet.
  }
  if ((chosen === 'resend' || chosen === 'ses') && providerReady(chosen)) return chosen;
  return defaultEmailProvider();
}

/**
 * The plan's caps: EMAIL_DAILY_LIMIT and EMAIL_MONTHLY_LIMIT are Resend's free plan (100 a day,
 * 3,000 a month), so they only count while Resend sends. 0 = no cap.
 */
export const providerLimits = (p: EmailProvider) =>
  p === 'resend'
    ? {
        daily: Number(env.EMAIL_DAILY_LIMIT ?? 0) || 0,
        monthly: Number(env.EMAIL_MONTHLY_LIMIT ?? 0) || 0,
      }
    : { daily: 0, monthly: 0 };

const sesConfig = (): SesConfig | null =>
  env.AWS_SES_ACCESS_KEY_ID && env.AWS_SES_SECRET_ACCESS_KEY
    ? {
        accessKeyId: env.AWS_SES_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SES_SECRET_ACCESS_KEY,
        region: env.AWS_REGION || 'ap-southeast-2',
        configurationSet: env.SES_CONFIGURATION_SET || undefined,
      }
    : null;

/** Whether a provider has its key(s), so an admin can send a test through it. */
export const providerReady = (p: EmailProvider) =>
  p === 'ses' ? !!sesConfig() : !!env.RESEND_API_KEY;

/** SES's maximum send rate (emails per second) for bulk sends; SES_SEND_RATE, default 10. */
const sesRate = () => Number(env.SES_SEND_RATE) || 10;

/**
 * True while the sender is Resend's test address (onboarding@resend.dev): Resend then only
 * delivers to the Resend account's own email, so members and attendees get nothing until the
 * domain is verified in Resend and EMAIL_FROM uses it.
 */
export const usingTestSender = async () =>
  (await emailProvider()) === 'resend' &&
  !!env.RESEND_API_KEY &&
  /@resend\.dev>?\s*$/i.test(env.EMAIL_FROM ?? '');

const recipients = (m: EmailMessage) => (Array.isArray(m.to) ? m.to : [m.to]).filter(Boolean);

function toMime(m: EmailMessage, to: string[]): MimeMessage {
  const { html, text } = renderEmail(m);
  return {
    from: env.EMAIL_FROM,
    to,
    replyTo: m.replyTo,
    subject: m.subject,
    html,
    text,
    attachments: m.attachments,
  };
}

/** Without the provider's key (local dev) the email is logged instead of sent. */
function logOnly(m: EmailMessage, to: string[]) {
  console.log(`[email:dev] to=${to.join(',')} subject="${m.subject}"\n${renderEmail(m).text}`);
}

async function resendSend(m: EmailMessage, to: string[]) {
  const { html, text } = renderEmail(m);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      subject: m.subject,
      html,
      text,
      reply_to: m.replyTo,
      attachments: m.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        content_type: a.contentType,
        content_id: a.contentId,
      })),
    }),
  });
  if (!res.ok) {
    const error = `${res.status} ${await res.text()}`;
    console.error('[email] Resend error', error);
    return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Sends one email (to one or a few people) through emailProvider(), or through `provider` for an
 * admin's test. Addresses on the suppression list (bounced, marked as spam) are left out; when
 * nobody is left, nothing is sent and the result says so.
 */
export async function sendEmail(
  m: EmailMessage,
  opts: { provider?: EmailProvider } = {},
): Promise<{ ok: boolean; error?: string; suppressed?: string[] }> {
  const provider = opts.provider ?? (await emailProvider());
  const all = recipients(m);
  if (!all.length) return { ok: true };
  const blocked = await suppressedAmong(all);
  const to = all.filter((e) => !blocked.has(e.trim().toLowerCase()));
  const suppressed = all.filter((e) => blocked.has(e.trim().toLowerCase()));
  if (!to.length) return { ok: true, suppressed };
  if (provider === 'ses') {
    const cfg = sesConfig();
    if (!cfg) {
      return { ok: false, error: 'Amazon SES has no access key (AWS_SES_ACCESS_KEY_ID).' };
    }
    const res = await sesSend(cfg, toMime(m, to));
    if (!res.ok) console.error('[email] SES error', res.error);
    return { ok: res.ok, error: res.error, suppressed };
  }
  if (!env.RESEND_API_KEY) {
    logOnly(m, to);
    return { ok: true, suppressed };
  }
  return { ...(await resendSend(m, to)), suppressed };
}

/**
 * Sends many emails (one per person) in order. Resend: its batch API, 100 per call, which keeps
 * a reminder for a full event under the Worker's subrequest limit; attachments are dropped.
 * Amazon SES: one call per email at SES_SEND_RATE per second (needs Workers Paid for big sends).
 *
 * `sent` counts the emails handled in order, including the `suppressed` ones skipped because the
 * address bounced or complained, so `messages.slice(sent)` are the people not reached when
 * `ok` is false.
 */
export async function sendEmailBatch(
  messages: EmailMessage[],
): Promise<{ ok: boolean; sent: number; suppressed: number; error?: string }> {
  if (!messages.length) return { ok: true, sent: 0, suppressed: 0 };
  const blocked = await suppressedEmails();
  const isBlocked = (m: EmailMessage) => {
    const to = recipients(m);
    return to.length > 0 && to.every((e) => blocked.has(e.trim().toLowerCase()));
  };
  // Positions of the emails that really go out, to map the provider's count back to `sent`.
  const keep = messages.map((m, i) => (isBlocked(m) ? -1 : i)).filter((i) => i >= 0);
  const suppressedBefore = (n: number) => (n >= keep.length ? messages.length : keep[n]!);
  const skipped = messages.length - keep.length;
  const outgoing = keep.map((i) => messages[i]!);
  const done = (ok: boolean, n: number, error?: string) => {
    const sent = suppressedBefore(n);
    const suppressed = messages.slice(0, sent).filter(isBlocked).length;
    return { ok, sent, suppressed, ...(error ? { error } : {}) };
  };
  if (!outgoing.length) return { ok: true, sent: messages.length, suppressed: skipped };

  if ((await emailProvider()) === 'ses') {
    const cfg = sesConfig();
    if (!cfg) return done(false, 0, 'Amazon SES has no access key (AWS_SES_ACCESS_KEY_ID).');
    const res = await sesSendMany(
      cfg,
      outgoing.map((m) => toMime(m, recipients(m))),
      sesRate(),
    );
    if (!res.ok) console.error('[email] SES batch error', res.error);
    return done(res.ok, res.sent, res.error);
  }

  if (!env.RESEND_API_KEY) {
    for (const m of outgoing) logOnly({ ...m, attachments: undefined }, recipients(m));
    return done(true, outgoing.length);
  }
  let n = 0;
  for (let i = 0; i < outgoing.length; i += 100) {
    const chunk = outgoing.slice(i, i + 100).map((m) => {
      const { html, text } = renderEmail(m);
      return {
        from: env.EMAIL_FROM,
        to: recipients(m),
        subject: m.subject,
        html,
        text,
        reply_to: m.replyTo,
      };
    });
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const error = `${res.status} ${await res.text()}`;
      console.error('[email] Resend batch error', error);
      return done(false, n, error);
    }
    n += chunk.length;
  }
  return done(true, n);
}
