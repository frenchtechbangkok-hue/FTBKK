/**
 * Checks that every old Wix URL still lands on a working page of the new site.
 *
 *   npm run check:redirects -- https://ft-bkk-site.<account>.workers.dev
 *
 * Reads scripts/data/wix-sitemap-urls.txt (every URL of the Wix sitemap, Nov 2026), plus a few
 * known legacy paths, follows redirects on the given base URL and lists every URL that doesn't end
 * on a 200. VERBOSE=1 also prints where each working URL lands.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:4321').replace(/\/$/, '');
const KNOWN = ['/', '/blog', '/sponsors', '/services-9', '/team', '/members', '/fund', '/contact'];

let paths = [...KNOWN];
const sitemap = path.join(import.meta.dirname, 'data', 'wix-sitemap-urls.txt');
for (const line of readFileSync(sitemap, 'utf8').split('\n')) {
  if (line.startsWith('http')) paths.push(new URL(line).pathname);
}
paths = [...new Set(paths)];

let failures = 0;
const queue = [...paths];
async function worker() {
  for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
    try {
      const res = await fetch(base + p, { redirect: 'follow' });
      const final = new URL(res.url).pathname;
      if (res.status !== 200) {
        failures++;
        console.log(`✗ ${res.status}  ${p}${final !== p ? ` -> ${final}` : ''}`);
      } else if (process.env.VERBOSE) {
        console.log(`✓ ${p}${final !== p ? ` -> ${final}` : ''}`);
      }
    } catch (e) {
      failures++;
      console.log(`✗ ERR  ${p}  ${(e as Error).message}`);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`\n${paths.length - failures}/${paths.length} URLs OK on ${base}`);
process.exit(failures ? 1 : 0);
