# La French Tech Bangkok website

The new website of La French Tech Bangkok, replacing the Wix site at
https://www.french-tech-bangkok.com/. It runs as one Cloudflare Worker and is live at
https://ft-bkk-site.frenchtechbangkok.workers.dev until the domain moves over.

## What the site does

**Public site**

- **Home**: hero, about us, key numbers, next events, a carousel of the ecosystem directory, latest
  posts, ways to join, partners.
- **Events**: upcoming and past events with built-in registration (capacity, waitlist, guests,
  members-only and private invite-link events), or no registration at all for walk-in events; QR
  tickets, reminders, feedback emails, speakers, sponsors and recaps.
- **Ecosystem**: a directory of French companies, startups and partners in Thailand. Owners manage
  their listing through email links, no accounts.
- **Blog** with RSS, and **Resources**: Thailand Tech Pulse (PDFs for members while membership is
  open), the Founder's Guide, Expanding to Thailand and Come work in France
  (French Tech Visa).
- **About**, **Join** (free individual membership, WhatsApp, newsletter, contact form), a **Thai
  page** at `/th`, the code of conduct and the privacy notice.
- **Members** get a personal page from an email link (no passwords): their events, profile and
  yearly renewal.
- **Privacy** (Thailand's PDPA): anyone can see or delete their data at `/my-data`.
- Every old Wix URL redirects to its new page.
- **Link previews**: events and posts share their own image; every other page shares a general La
  French Tech Bangkok image (logo and Bangkok skyline).

**Admin** at `/admin`, behind Cloudflare Access. Anyone who can sign in can do everything; there
are no roles. The menu:

| Group                       | What is in it                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Dashboard**               | What is waiting for the team, the last 7 days, upcoming events, latest activity                                 |
| **Events**                  | Events, registrations, check-in at the door from a phone                                                        |
| **Community**               | Members, contacts (tags, groups, merge duplicates), messages                                                    |
| **Ecosystem**               | Listings to review, all listings, partners, renewals                                                            |
| **Website**                 | Blog posts, files, page texts, board and speakers, guide pages                                                  |
| **Emails and social media** | Email the community, scheduled social media posts (with how to connect LinkedIn and Facebook), automatic emails |
| **Reports**                 | Events and attendance, membership, website traffic (Cloudflare), emails sent, Cloudflare usage vs plan          |
| **Settings**                | General, membership switches, event covers, social links, email delivery                                        |
| **History**                 | Actions log (who did what in the admin), Change history (each version of the site)                              |

Emails go through Resend or Amazon SES, chosen in Settings > Email delivery, with a do-not-email list for
bounces and spam complaints.

Full detail: [docs/features.md](docs/features.md) (every feature, with the files behind it) and
[docs/admin.md](docs/admin.md) (how to use the admin).

## Stack

- [Astro 7](https://astro.build) with `@astrojs/cloudflare` (server output), TypeScript, Tailwind
  CSS v4.
- Cloudflare Worker `ft-bkk-site` (entry `src/worker.ts`) with an hourly cron: social media posts
  every hour, daily jobs (reminders, renewals, feedback, weekly backup) at 09:00 Bangkok time.
- D1 database `ftbkk` through Drizzle (`src/db/schema.ts`, migrations in `migrations/`).
- R2 bucket `ftbkk-media` for images and files, served at `/media/*`.
- Cloudflare Access on `/admin` and `/api/admin`, Turnstile on public forms, Resend or Amazon SES
  for email.

## Run it locally

```sh
cp .dev.vars.example .dev.vars   # first time only
npm install
npm run db:migrate:local         # create or upgrade the local D1 database
npm run dev                      # http://localhost:4321
```

Locally the admin needs no login (it uses `DEV_ADMIN_EMAIL` from `.dev.vars`) and emails are
printed to the console. To fill the local database with the content captured from Wix, run
`npm run import`; to import Wix guest lists, see [migration/README.md](migration/README.md).

```sh
npm run check                     # astro check + eslint + prettier
npm test                          # unit tests (Vitest)
npm run build && npx wrangler dev # production build served by wrangler
npm run db:generate               # new migration after editing src/db/schema.ts
npm run types                     # regenerate binding types after editing wrangler.jsonc
npm run check:redirects -- <url>  # every old Wix URL must end on a 200
```

## Deploy

The repo is connected to Cloudflare Workers Builds: every merge to `main` applies D1 migrations
and uploads a new Worker version, testable at `https://dev-ft-bkk-site.frenchtechbangkok.workers.dev`. It
goes live only when it is promoted in Cloudflare > ft-bkk-site > Deployments (rollback is there
too). Migrations must only add tables and columns. Other branches get a preview URL. Cloudflare setup (R2, build
settings, Access, Turnstile, email, social media, traffic report, backups, domain) is in
[docs/deploy.md](docs/deploy.md).

## Contributing

Every pull request:

- updates this README or [docs/features.md](docs/features.md) for a new feature (and
  [docs/admin.md](docs/admin.md) for admin features);
- adds its entry at the top of `src/lib/changelog.ts` (Change history);
- passes `npm run check`, `npm test` and `npm run build`.

Conventions for working on the code with Claude Code are in [CLAUDE.md](CLAUDE.md).

## Project layout

```text
src/pages/        public pages, /admin and /api/admin
src/components/   Astro components (admin/ for the admin UI)
src/lib/          server logic: auth, registrations, directory, email, reports, cron jobs
src/db/           Drizzle schema and client
migrations/       D1 migrations
migration/        Wix capture script and captured data
scripts/          content import, guest import and redirect checker
docs/             features, admin guide, deploy guide, plan, design tokens
test/             unit tests
```

## Docs

- [docs/features.md](docs/features.md): every feature in detail.
- [docs/admin.md](docs/admin.md): how to use the admin.
- [docs/deploy.md](docs/deploy.md): Cloudflare setup and deploys.
- [docs/plan.md](docs/plan.md): the rebuild plan and decisions.
- [docs/design-tokens.md](docs/design-tokens.md): colours, fonts and spacing.
