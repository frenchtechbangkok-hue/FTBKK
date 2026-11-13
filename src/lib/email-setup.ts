import { env } from 'cloudflare:workers';

/**
 * Admin > Email delivery > Setup: every key, secret and setting Resend and Amazon SES need, typed
 * in the admin and kept in the email_setup table (migration 0043), so the whole email setup can
 * be done without a terminal. A value saved there wins; an empty one falls back to the Worker's
 * variable or secret of the same name (wrangler.jsonc, `wrangler secret put`), so nothing changes
 * for a site set up the old way. Secrets are never shown back, only "set, ends …1234".
 *
 * The table is separate from `settings` on purpose: getSettings() reads every settings row and
 * feeds public pages, and secrets must never travel that way.
 */

export type SetupGroup = 'general' | 'resend' | 'ses';

export interface SetupField {
  key: EmailSetupKey;
  group: SetupGroup;
  label: string;
  /** Never shown back; the form only replaces or removes it. */
  secret?: boolean;
  /** Whole number (a cap, a rate); 0 means "no cap". */
  number?: boolean;
  placeholder?: string;
  hint: string;
}

export const SETUP_KEYS = [
  'EMAIL_FROM',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'EMAIL_DAILY_LIMIT',
  'EMAIL_MONTHLY_LIMIT',
  'AWS_SES_ACCESS_KEY_ID',
  'AWS_SES_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'SES_SEND_RATE',
  'SES_CONFIGURATION_SET',
  'SES_EVENTS_KEY',
  'SES_EVENTS_TOPIC_ARN',
] as const;
export type EmailSetupKey = (typeof SETUP_KEYS)[number];

export const SETUP_FIELDS: SetupField[] = [
  {
    key: 'EMAIL_FROM',
    group: 'general',
    label: 'Sender',
    placeholder: 'La French Tech Bangkok <noreply@mail.french-tech-bangkok.com>',
    hint: 'Name and address every email comes from. The domain must be verified in the service that sends (Resend > Domains, SES > Identities).',
  },
  {
    key: 'RESEND_API_KEY',
    group: 'resend',
    label: 'API key',
    secret: true,
    placeholder: 're_…',
    hint: 'Resend > API Keys > Create API key, permission "Sending access".',
  },
  {
    key: 'RESEND_WEBHOOK_SECRET',
    group: 'resend',
    label: 'Webhook signing secret',
    secret: true,
    placeholder: 'whsec_…',
    hint: 'Resend > Webhooks > the webhook with the address above > Signing secret. Without the right one, Resend shows "401 Bad signature" and Reports > Emails gets nothing.',
  },
  {
    key: 'EMAIL_DAILY_LIMIT',
    group: 'resend',
    label: 'Daily cap',
    number: true,
    placeholder: '100',
    hint: "Resend's plan cap per day (Free: 100). 0 = no cap. Only counts while Resend sends.",
  },
  {
    key: 'EMAIL_MONTHLY_LIMIT',
    group: 'resend',
    label: 'Monthly cap',
    number: true,
    placeholder: '3000',
    hint: "Resend's plan cap per month (Free: 3,000), shown in Reports > Emails. 0 = none.",
  },
  {
    key: 'AWS_SES_ACCESS_KEY_ID',
    group: 'ses',
    label: 'Access key ID',
    secret: true,
    placeholder: 'AKIA…',
    hint: 'AWS > IAM > Users > the SES user > Security credentials > Create access key.',
  },
  {
    key: 'AWS_SES_SECRET_ACCESS_KEY',
    group: 'ses',
    label: 'Secret access key',
    secret: true,
    hint: 'Shown once by AWS next to the access key ID.',
  },
  {
    key: 'AWS_REGION',
    group: 'ses',
    label: 'Region',
    placeholder: 'ap-southeast-2',
    hint: 'Where the domain is verified and production access was granted (Sydney: ap-southeast-2).',
  },
  {
    key: 'SES_SEND_RATE',
    group: 'ses',
    label: 'Emails per second',
    number: true,
    placeholder: '12',
    hint: 'A little under "Maximum send rate" in SES > Account dashboard.',
  },
  {
    key: 'SES_CONFIGURATION_SET',
    group: 'ses',
    label: 'Configuration set',
    placeholder: 'ft-bkk-site',
    hint: 'SES > Configuration sets: the set whose event destination publishes sends, deliveries, opens and clicks to the SNS topic. Without it, Reports > Emails only gets bounces and spam complaints from SES.',
  },
  {
    key: 'SES_EVENTS_KEY',
    group: 'ses',
    label: 'Notifications key',
    secret: true,
    hint: 'A random password in the SNS subscription address above, so only Amazon can post to it. Use "Generate" and then put the new address in SNS.',
  },
  {
    key: 'SES_EVENTS_TOPIC_ARN',
    group: 'ses',
    label: 'SNS topic ARN',
    placeholder: 'arn:aws:sns:ap-southeast-2:…:ft-bkk-ses-events',
    hint: 'Optional: only accept notifications from this topic.',
  },
];

export type EmailEnv = Record<EmailSetupKey, string>;

/** Saved admin values, by key ('' or missing = not set here). */
async function savedValues(): Promise<Partial<EmailEnv>> {
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM email_setup').all<{
      key: string;
      value: string;
    }>();
    return Object.fromEntries(
      results
        .filter((r) => (SETUP_KEYS as readonly string[]).includes(r.key) && r.value !== '')
        .map((r) => [r.key, r.value]),
    );
  } catch {
    // No database (tests) or migration 0043 not applied yet: the Worker's values only.
    return {};
  }
}

const fromWorker = (k: EmailSetupKey) => {
  const v = (env as unknown as Record<string, unknown>)[k];
  return typeof v === 'string' ? v : v == null ? '' : String(v);
};

/**
 * The values the email code uses: the admin's where saved, else the Worker's. Read once per
 * request by whoever needs it (a handful of rows).
 */
export async function emailEnv(): Promise<EmailEnv> {
  const saved = await savedValues();
  return Object.fromEntries(SETUP_KEYS.map((k) => [k, saved[k] ?? fromWorker(k)])) as EmailEnv;
}

export interface FieldStatus extends SetupField {
  /** Where the value in use comes from. */
  source: 'admin' | 'worker' | 'none';
  /** The value for plain fields; for secrets only a hint such as "…a1b2". */
  shown: string;
}

const tail = (v: string) => (v.length > 8 ? `…${v.slice(-4)}` : 'set');

/** For the Setup form: every field with where its value comes from, secrets masked. */
export async function emailSetupStatus(): Promise<FieldStatus[]> {
  const saved = await savedValues();
  return SETUP_FIELDS.map((f) => {
    const value = saved[f.key] ?? fromWorker(f.key);
    const source = saved[f.key] ? 'admin' : value ? 'worker' : 'none';
    return { ...f, source, shown: f.secret ? (value ? tail(value) : '') : value };
  });
}

/**
 * Cleans a form value: trimmed, numbers kept as whole numbers. Returns an error message for a
 * value that can't be right, so a typo doesn't stop every email.
 */
export function cleanSetupValue(f: SetupField, raw: string): { value: string } | { error: string } {
  const value = raw.trim();
  if (!value) return { value };
  if (f.number && !/^\d+$/.test(value)) return { error: `${f.label}: enter a whole number.` };
  if (f.key === 'EMAIL_FROM' && !/@[^\s@>]+\.[^\s@>]+>?$/.test(value)) {
    return { error: 'Sender: enter an address, such as Name <noreply@mail.example.com>.' };
  }
  if (f.key === 'AWS_REGION' && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(value)) {
    return { error: 'Region: use the AWS code, such as ap-southeast-2.' };
  }
  if (/\s/.test(value) && f.key !== 'EMAIL_FROM') {
    return { error: `${f.label}: no spaces (check the copy and paste).` };
  }
  return { value };
}

/**
 * Saves values typed in the admin; '' removes the admin value (the Worker's applies again).
 * Returns the keys that really changed, for the Actions log (names only, never values).
 */
export async function saveEmailSetup(patch: Partial<EmailEnv>, actor: string) {
  const saved = await savedValues();
  const entries = Object.entries(patch).filter(
    ([k, v]) =>
      (SETUP_KEYS as readonly string[]).includes(k) && (saved[k as EmailSetupKey] ?? '') !== v,
  );
  if (!entries.length) return [];
  const put = env.DB.prepare(
    `INSERT INTO email_setup (key, value, updated_by) VALUES (?1, ?2, ?3)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by,
       updated_at = unixepoch()`,
  );
  const del = env.DB.prepare('DELETE FROM email_setup WHERE key = ?1');
  await env.DB.batch(entries.map(([k, v]) => (v ? put.bind(k, v, actor) : del.bind(k))));
  return entries.map(([k]) => k as EmailSetupKey);
}

/** A random key for the SNS subscription address (32 hex characters). */
export const newEventsKey = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
