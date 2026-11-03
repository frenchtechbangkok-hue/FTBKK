/**
 * Production builds upload a new version and apply the D1 migrations right away, while the live
 * site still runs the previous version until someone promotes the new one in Cloudflare
 * (docs/deploy.md, "Validate, then promote"). So every new migration must leave the live version
 * working: add tables and columns, never drop or rename something it may still read.
 *
 * A migration that drops or renames is allowed only with a line
 * `-- safe-for-live-version: <why>` saying why the live version no longer uses it (for example,
 * the code that used the column was removed by an earlier, already promoted version).
 */

/** Migrations up to this number were applied before this rule existed. */
export const GUARD_FROM = 42;

export const MARKER = /^--\s*safe-for-live-version:\s*\S/m;

const DESTRUCTIVE = /\bDROP\s+(TABLE|COLUMN)\b|\bRENAME\b/i;

export interface MigrationFile {
  name: string;
  sql: string;
}

/** The migrations that would break the live version, with the statement that does it. */
export function unsafeMigrations(files: MigrationFile[]): { name: string; statement: string }[] {
  const out: { name: string; statement: string }[] = [];
  for (const f of files) {
    const n = Number.parseInt(f.name, 10);
    if (!Number.isFinite(n) || n < GUARD_FROM || MARKER.test(f.sql)) continue;
    const code = f.sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    const statement = code
      .split(/;|--> statement-breakpoint/)
      .map((s) => s.trim())
      .find((s) => DESTRUCTIVE.test(s));
    if (statement) out.push({ name: f.name, statement });
  }
  return out;
}
