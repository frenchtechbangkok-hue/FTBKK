/**
 * Production build command (Workers Builds, branch main): checks that the pending D1 migrations
 * are safe for the live version, applies them, then uploads the build as a new Worker version
 * without making it live. The version gets the preview address https://dev-<worker>.<subdomain>.workers.dev
 * (alias "dev", moved to the newest upload each time) and is promoted by hand in Cloudflare >
 * ft-bkk-site > Deployments. docs/deploy.md, "Validate, then promote".
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { unsafeMigrations } from './lib/migration-guard';

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'inherit' });
const git = (args: string[]) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

const files = readdirSync('migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(`migrations/${name}`, 'utf8') }));
const unsafe = unsafeMigrations(files);
if (unsafe.length) {
  console.error('\nThese migrations would break the version that is live right now:\n');
  for (const u of unsafe) console.error(`  ${u.name}: ${u.statement.split('\n')[0]}`);
  console.error(
    '\nMigrations run before the new version is promoted, so they must only add tables and' +
      ' columns. Remove the drop or rename, or add a line "-- safe-for-live-version: <why>" once' +
      ' the live version no longer uses it (docs/deploy.md, "Validate, then promote").\n',
  );
  process.exit(1);
}

run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'ftbkk', '--remote']);

const sha = (process.env.WORKERS_CI_COMMIT_SHA || git(['rev-parse', 'HEAD'])).slice(0, 7);
const message = git(['log', '-1', '--format=%s']).slice(0, 100);
run('npx', [
  'wrangler',
  'versions',
  'upload',
  '--preview-alias',
  'dev',
  ...(sha ? ['--tag', sha] : []),
  ...(message ? ['--message', message] : []),
]);
