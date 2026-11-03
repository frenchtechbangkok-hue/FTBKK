import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unsafeMigrations } from '../scripts/lib/migration-guard';

describe('migration guard', () => {
  it('lets additive migrations through', () => {
    expect(
      unsafeMigrations([
        {
          name: '0050_add.sql',
          sql: 'ALTER TABLE `events` ADD `x` text;--> statement-breakpoint\nCREATE TABLE `y` (`id` integer);',
        },
      ]),
    ).toEqual([]);
  });

  it('stops drops and renames without the marker', () => {
    const out = unsafeMigrations([
      { name: '0050_drop.sql', sql: '-- removes x\nALTER TABLE `events` DROP COLUMN `x`;' },
      { name: '0051_rename.sql', sql: 'ALTER TABLE `__new_y` RENAME TO `y`;' },
      { name: '0052_table.sql', sql: 'DROP TABLE `z`;' },
    ]);
    expect(out.map((o) => o.name)).toEqual(['0050_drop.sql', '0051_rename.sql', '0052_table.sql']);
    expect(out[0]!.statement).toContain('DROP COLUMN');
  });

  it('allows them with the marker, and ignores comments and old migrations', () => {
    expect(
      unsafeMigrations([
        {
          name: '0050_drop.sql',
          sql: '-- safe-for-live-version: version 1.110 stopped reading x\nALTER TABLE `events` DROP COLUMN `x`;',
        },
        { name: '0051_note.sql', sql: '-- we no longer DROP anything here\nSELECT 1;' },
        { name: '0033_old.sql', sql: 'ALTER TABLE `members` DROP COLUMN `nationality`;' },
      ]),
    ).toEqual([]);
  });

  it('passes on the migrations in the repo', () => {
    const files = readdirSync('migrations')
      .filter((f) => f.endsWith('.sql'))
      .map((name) => ({ name, sql: readFileSync(`migrations/${name}`, 'utf8') }));
    expect(unsafeMigrations(files)).toEqual([]);
  });
});
