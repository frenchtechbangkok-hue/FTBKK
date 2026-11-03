import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  buildMime,
  encodeAddress,
  encodeWord,
  isSnsUrl,
  readSesFeedback,
  sesSendMany,
} from '../src/lib/ses';

vi.mock('../src/lib/email-suppressions', () => ({
  suppressedEmails: async () => new Set(['dead@example.com']),
  suppressedAmong: async (emails: string[]) =>
    new Set(emails.filter((e) => e === 'dead@example.com')),
}));

const fromB64 = (s: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));

const cfg = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', region: 'ap-southeast-1' };
const msg = (to: string) => ({
  from: 'A <a@x.com>',
  to: [to],
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
});

afterEach(() => {
  vi.unstubAllGlobals();
  const vars = env as unknown as Record<string, unknown>;
  for (const k of Object.keys(vars)) delete vars[k];
});

describe('MIME headers', () => {
  it('keeps ASCII as is and encodes the rest in short words', () => {
    expect(encodeWord('Hello')).toBe('Hello');
    const enc = encodeWord('Rencontre à Bangkok : inscription confirmée pour la soirée');
    for (const w of enc.split('\r\n ')) {
      expect(w.length).toBeLessThanOrEqual(75);
      expect(w).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
    const decoded = enc
      .split('\r\n ')
      .map((w) => fromB64(w.slice(10, -2)))
      .join('');
    expect(decoded).toBe('Rencontre à Bangkok : inscription confirmée pour la soirée');
  });
  it('quotes display names and strips line breaks', () => {
    expect(encodeAddress('La French Tech Bangkok <noreply@mail.example.com>')).toBe(
      '"La French Tech Bangkok" <noreply@mail.example.com>',
    );
    expect(encodeAddress('plain@example.com')).toBe('plain@example.com');
    expect(encodeWord('Hi\r\nBcc: evil@example.com')).toBe('Hi Bcc: evil@example.com');
  });
});

describe('buildMime', () => {
  it('nests text, HTML, an inline QR image and a file', () => {
    const mime = buildMime({
      from: 'FT <noreply@mail.example.com>',
      to: ['a@example.com'],
      replyTo: 'hello@example.com',
      subject: 'Your ticket',
      html: '<p>Café</p><img src="cid:qr">',
      text: 'Café',
      attachments: [
        { filename: 'qr.png', content: 'iVBORw0KGgo=', contentType: 'image/png', contentId: 'qr' },
        { filename: 'event.ics', content: 'QkVHSU4=', contentType: 'text/calendar' },
      ],
    });
    const [head] = mime.split('\r\n\r\n');
    expect(head).toContain('Reply-To: hello@example.com');
    expect(head).toMatch(/Content-Type: multipart\/mixed; boundary="/);
    expect(mime).toMatch(/multipart\/related/);
    expect(mime).toMatch(/multipart\/alternative/);
    expect(mime).toContain('Content-ID: <qr>');
    expect(mime).toContain('Content-Disposition: inline; filename="qr.png"');
    expect(mime).toContain('Content-Disposition: attachment; filename="event.ics"');
    // Every boundary opened is closed.
    const boundaries = [...mime.matchAll(/boundary="([^"]+)"/g)].map((m) => m[1]!);
    expect(boundaries).toHaveLength(3);
    for (const b of boundaries) expect(mime).toContain(`--${b}--`);
    // UTF-8 bodies survive the base64 round trip.
    const html =
      /text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([^-]+)/.exec(
        mime,
      )![1]!;
    expect(fromB64(html)).toBe('<p>Café</p><img src="cid:qr">');
  });
  it('is a plain alternative without attachments, lines under 78 characters', () => {
    const mime = buildMime({ ...msg('a@example.com'), html: 'x'.repeat(500) });
    expect(mime).not.toMatch(/multipart\/(mixed|related)/);
    for (const line of mime.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
    const body = mime.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]{20,}$/.test(l));
    for (const line of body) expect(line.length).toBeLessThanOrEqual(76);
  });
});

describe('readSesFeedback', () => {
  it('suppresses permanent bounces only', () => {
    expect(
      readSesFeedback({
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'General',
          bouncedRecipients: [
            { emailAddress: 'Gone@Example.com', diagnosticCode: 'smtp; 550 5.1.1 user unknown' },
          ],
        },
      }),
    ).toEqual({
      kind: 'bounce',
      emails: ['gone@example.com'],
      detail: 'General: smtp; 550 5.1.1 user unknown',
    });
    expect(
      readSesFeedback({
        notificationType: 'Bounce',
        bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'a@b.co' }] },
      }),
    ).toBeNull();
    expect(readSesFeedback({ notificationType: 'Delivery' })).toBeNull();
  });
  it('reads complaints, also in the event publishing format', () => {
    expect(
      readSesFeedback({
        eventType: 'Complaint',
        complaint: {
          complainedRecipients: [{ emailAddress: '"Jo" <jo@example.com>' }],
          complaintFeedbackType: 'abuse',
        },
      }),
    ).toEqual({ kind: 'complaint', emails: ['jo@example.com'], detail: 'abuse' });
  });
});

describe('isSnsUrl', () => {
  it('only accepts https on SNS hosts', () => {
    expect(isSnsUrl('https://sns.ap-southeast-1.amazonaws.com/?Action=ConfirmSubscription')).toBe(
      true,
    );
    expect(isSnsUrl('http://sns.ap-southeast-1.amazonaws.com/')).toBe(false);
    expect(isSnsUrl('https://sns.ap-southeast-1.amazonaws.com.evil.com/')).toBe(false);
    expect(isSnsUrl('https://example.com/')).toBe(false);
  });
});

describe('sesSendMany', () => {
  it('posts signed raw emails and reports how many went out before a failure', async () => {
    const calls: Request[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        calls.push(req);
        const body = (await req.clone().json()) as { Destination: { ToAddresses: string[] } };
        const to = body.Destination.ToAddresses[0];
        return to === 'bad@example.com'
          ? new Response('{"message":"Email address is not verified."}', { status: 400 })
          : Response.json({ MessageId: `id-${to}` });
      }),
    );
    const res = await sesSendMany(
      cfg,
      ['a@example.com', 'b@example.com', 'bad@example.com', 'c@example.com'].map(msg),
      10,
    );
    expect(res.ok).toBe(false);
    expect(res.sent).toBe(2);
    expect(res.error).toContain('not verified');
    const first = calls[0]!;
    expect(first.url).toBe('https://email.ap-southeast-1.amazonaws.com/v2/email/outbound-emails');
    expect(first.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/ap-southeast-1\/ses\/aws4_request/,
    );
    const raw = ((await first.clone().json()) as { Content: { Raw: { Data: string } } }).Content.Raw
      .Data;
    expect(fromB64(raw)).toContain('To: a@example.com');
  });
  it('retries when SES says the rate is exceeded', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ++n === 1
          ? new Response('{"message":"Maximum sending rate exceeded."}', { status: 429 })
          : Response.json({ MessageId: 'x' }),
      ),
    );
    expect(await sesSendMany(cfg, [msg('a@example.com')], 10)).toEqual({ ok: true, sent: 1 });
    expect(n).toBe(2);
  });
});

describe('sendEmailBatch through SES', () => {
  it('skips suppressed addresses and keeps the in-order count', async () => {
    Object.assign(env, {
      EMAIL_PROVIDER: 'ses',
      AWS_SES_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      AWS_SES_SECRET_ACCESS_KEY: 'secret',
      EMAIL_FROM: 'FT <noreply@mail.example.com>',
    });
    const sentTo: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        const to = ((await req.json()) as { Destination: { ToAddresses: string[] } }).Destination
          .ToAddresses[0]!;
        if (to === 'down@example.com') return new Response('nope', { status: 400 });
        sentTo.push(to);
        return Response.json({ MessageId: 'x' });
      }),
    );
    const { sendEmailBatch } = await import('../src/lib/email');
    const m = (to: string) => ({ to, subject: 'S', paragraphs: ['P'] });
    const ok = await sendEmailBatch([
      m('a@example.com'),
      m('dead@example.com'),
      m('b@example.com'),
    ]);
    expect(ok).toEqual({ ok: true, sent: 3, suppressed: 1 });
    expect(sentTo).toEqual(['a@example.com', 'b@example.com']);

    const failed = await sendEmailBatch([
      m('dead@example.com'),
      m('c@example.com'),
      m('down@example.com'),
      m('d@example.com'),
    ]);
    // dead skipped, c sent, then down failed: the people not reached start at down.
    expect(failed).toMatchObject({ ok: false, sent: 2, suppressed: 1 });
  });
});
