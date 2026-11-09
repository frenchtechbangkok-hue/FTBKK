import { afterEach, describe, expect, it } from 'vitest';
import { env as workerEnv } from 'cloudflare:workers';
import {
  cleanSetupValue,
  emailEnv,
  emailSetupStatus,
  newEventsKey,
  SETUP_FIELDS,
} from '../src/lib/email-setup';

// The stub env is a plain object in tests.
const env = workerEnv as unknown as Record<string, unknown>;
const field = (k: string) => SETUP_FIELDS.find((f) => f.key === k)!;

// A tiny stand-in for D1: `SELECT key, value FROM email_setup` returns these rows.
const withRows = (rows: { key: string; value: string }[]) => {
  env.DB = { prepare: () => ({ all: async () => ({ results: rows }) }) };
};

afterEach(() => {
  for (const k of Object.keys(env)) delete env[k];
});

describe('email setup', () => {
  it('uses the admin value first, then the Worker value', async () => {
    env.RESEND_API_KEY = 're_worker';
    env.EMAIL_FROM = 'A <a@x.com>';
    withRows([
      { key: 'RESEND_API_KEY', value: 're_admin_key_1234' },
      { key: 'EMAIL_FROM', value: '' },
      { key: 'NOT_A_SETUP_KEY', value: 'x' },
    ]);
    const e = await emailEnv();
    expect(e.RESEND_API_KEY).toBe('re_admin_key_1234');
    expect(e.EMAIL_FROM).toBe('A <a@x.com>');
    expect(e.SES_CONFIGURATION_SET).toBe('');
    expect(e).not.toHaveProperty('NOT_A_SETUP_KEY');
  });

  it('falls back to the Worker values without the table', async () => {
    env.SES_SEND_RATE = '12';
    expect((await emailEnv()).SES_SEND_RATE).toBe('12');
  });

  it('never shows a secret back', async () => {
    env.RESEND_WEBHOOK_SECRET = 'whsec_abcdefghijklmnop';
    withRows([{ key: 'AWS_REGION', value: 'ap-southeast-2' }]);
    const s = await emailSetupStatus();
    const secret = s.find((f) => f.key === 'RESEND_WEBHOOK_SECRET')!;
    expect(secret).toMatchObject({ source: 'worker', shown: '…mnop' });
    expect(s.find((f) => f.key === 'AWS_REGION')).toMatchObject({
      source: 'admin',
      shown: 'ap-southeast-2',
    });
    expect(s.find((f) => f.key === 'RESEND_API_KEY')).toMatchObject({ source: 'none', shown: '' });
  });

  it('checks typed values', () => {
    expect(cleanSetupValue(field('SES_SEND_RATE'), ' 12 ')).toEqual({ value: '12' });
    expect(cleanSetupValue(field('SES_SEND_RATE'), '1.5')).toHaveProperty('error');
    expect(cleanSetupValue(field('AWS_REGION'), 'Sydney')).toHaveProperty('error');
    expect(cleanSetupValue(field('EMAIL_FROM'), 'FT <noreply@mail.example.com>')).toEqual({
      value: 'FT <noreply@mail.example.com>',
    });
    expect(cleanSetupValue(field('EMAIL_FROM'), 'noreply')).toHaveProperty('error');
    expect(cleanSetupValue(field('RESEND_API_KEY'), 're_a b')).toHaveProperty('error');
    expect(cleanSetupValue(field('RESEND_API_KEY'), '')).toEqual({ value: '' });
  });

  it('makes random notification keys', () => {
    const k = newEventsKey();
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(newEventsKey()).not.toBe(k);
  });
});
