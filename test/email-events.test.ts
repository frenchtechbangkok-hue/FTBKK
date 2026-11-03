import { describe, expect, it } from 'vitest';
import { readResendEvent, readSesEvent, verifyResendSignature } from '../src/lib/email-events';

const now = new Date('2026-11-03T06:00:00Z');

async function sign(secret: string, id: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)),
  );
  return btoa(String.fromCharCode(...mac));
}

describe('verifyResendSignature', () => {
  const secret = `whsec_${btoa('a-test-signing-secret-32-bytes!!')}`;
  const body = '{"type":"email.sent"}';
  const ts = String(Math.floor(now.getTime() / 1000));

  it('accepts a good signature, also among several', async () => {
    const sig = await sign(secret, 'msg_1', ts, body);
    const h = { id: 'msg_1', timestamp: ts, signature: `v1,${sig}` };
    expect(await verifyResendSignature(secret, h, body, now)).toBe(true);
    const several = { ...h, signature: `v1,bm9wZQ== v1,${sig}` };
    expect(await verifyResendSignature(secret, several, body, now)).toBe(true);
  });

  it('refuses a changed body, a wrong secret, an old timestamp or missing headers', async () => {
    const sig = await sign(secret, 'msg_1', ts, body);
    const h = { id: 'msg_1', timestamp: ts, signature: `v1,${sig}` };
    expect(await verifyResendSignature(secret, h, body + ' ', now)).toBe(false);
    expect(await verifyResendSignature(`whsec_${btoa('other')}`, h, body, now)).toBe(false);
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(await verifyResendSignature(secret, h, body, later)).toBe(false);
    expect(await verifyResendSignature(secret, { ...h, signature: null }, body, now)).toBe(false);
    expect(await verifyResendSignature('', h, body, now)).toBe(false);
  });
});

describe('readResendEvent', () => {
  const base = {
    created_at: '2026-11-03T05:10:00.000Z',
    data: {
      email_id: 're_123',
      created_at: '2026-11-03T05:00:00.000Z',
      subject: "You're registered: Connect #53",
      to: ['Camille <Camille@Example.com>'],
      from: 'La French Tech Bangkok <noreply@mail.delattre.me>',
    },
  };

  it('maps delivered and opened to the email sent time', () => {
    const r = readResendEvent({ ...base, type: 'email.delivered' }, now)!;
    expect(r.event).toMatchObject({
      provider: 'resend',
      messageId: 're_123',
      kind: 'delivered',
      subject: "You're registered: Connect #53",
      recipients: 1,
    });
    expect(r.event.sentAt.toISOString()).toBe('2026-11-03T05:00:00.000Z');
    expect(r.event.at.toISOString()).toBe('2026-11-03T05:10:00.000Z');
    expect(r.feedback).toBeNull();
    expect(readResendEvent({ ...base, type: 'email.opened' }, now)!.event.kind).toBe('opened');
  });

  it('puts permanent bounces and complaints on the do-not-email list', () => {
    const hard = readResendEvent(
      { ...base, type: 'email.bounced', data: { ...base.data, bounce: { type: 'Permanent' } } },
      now,
    )!;
    expect(hard.event.bounceType).toBe('permanent');
    expect(hard.feedback).toMatchObject({ kind: 'bounce', emails: ['camille@example.com'] });
    const soft = readResendEvent(
      { ...base, type: 'email.bounced', data: { ...base.data, bounce: { type: 'Transient' } } },
      now,
    )!;
    expect(soft.event.bounceType).toBe('temporary');
    expect(soft.feedback).toBeNull();
    const spam = readResendEvent({ ...base, type: 'email.complained' }, now)!;
    expect(spam.feedback?.kind).toBe('complaint');
  });

  it('ignores other events and bad payloads', () => {
    expect(readResendEvent({ ...base, type: 'contact.created' }, now)).toBeNull();
    expect(readResendEvent({ type: 'email.sent', data: {} }, now)).toBeNull();
    expect(readResendEvent('nope', now)).toBeNull();
  });
});

describe('readSesEvent', () => {
  const mail = {
    timestamp: '2026-11-03T05:00:00.000Z',
    messageId: 'ses-1',
    destination: ['a@example.com', 'b@example.com'],
    commonHeaders: { subject: 'Tomorrow: Connect #53' },
  };

  it('reads event publishing', () => {
    const e = readSesEvent(
      { eventType: 'Open', mail, open: { timestamp: '2026-11-03T07:00:00.000Z' } },
      now,
    )!;
    expect(e).toMatchObject({ provider: 'ses', kind: 'opened', recipients: 2 });
    expect(e.subject).toBe('Tomorrow: Connect #53');
    expect(e.at.toISOString()).toBe('2026-11-03T07:00:00.000Z');
    expect(readSesEvent({ eventType: 'Send', mail, send: {} }, now)!.kind).toBe('sent');
  });

  it('reads feedback notifications', () => {
    const e = readSesEvent(
      { notificationType: 'Bounce', mail, bounce: { bounceType: 'Permanent' } },
      now,
    )!;
    expect(e).toMatchObject({ kind: 'bounced', bounceType: 'permanent' });
  });

  it('ignores unknown types and messages without an id', () => {
    expect(readSesEvent({ eventType: 'Subscription', mail }, now)).toBeNull();
    expect(readSesEvent({ eventType: 'Send', mail: {} }, now)).toBeNull();
  });
});
