# Deploy and Cloudflare setup

The site is one Cloudflare Worker, `ft-bkk-site`, deployed by **Workers Builds** from GitHub.
Everything below is done once, in the Cloudflare dashboard, by the account owner.

Since 7 November 2026 everything lives in La French Tech Bangkok's own Cloudflare account
(`account_id` in `wrangler.jsonc`, workers.dev subdomain `frenchtechbangkok`) and the code in the
GitHub organization `frenchtechbangkok-hue`. Before that it was Eric's personal account; the move
(D1 export/import, R2 copy, new Access and Turnstile, secrets typed again) is written up in the
project files, `cloudflare-account-move.md`.

## 1. Image storage (R2 bucket)

Before the first deploy, create the bucket by hand (wrangler does not create it if R2 has never
been used on the account):

1. Dashboard > **R2 Object Storage**. If asked, activate R2 (a card is required; the free tier
   covers this site).
2. **Create bucket**, name `ftbkk-media`, default location.

## 2. Workers Builds (Worker > Settings > Build)

Set the build command on **both** tabs, Production and Previews Base.

| Setting                              | Value                          |
| ------------------------------------ | ------------------------------ |
| Build command                        | `npm run build`                |
| Deploy command                       | `npm run upload:ci`            |
| Builds for non-production branches   | on                             |
| Non-production branch deploy command | `npx wrangler versions upload` |
| Root directory                       | `/`                            |

Do not use `npx wrangler preview`: it needs a separate `previews` config and skips the build.

A merge to `main` no longer goes live by itself. It applies the D1 migrations, then uploads the
build as a new **version** with a test address; you check it there and make it live in Cloudflare
when you are happy (next section). The first build creates the `ftbkk` D1 database automatically
(the R2 bucket comes from step 1). Other branches upload a version too, with their own test address
shown on the PR check, but never run migrations: a branch that adds a migration fails on its own
address (`no such column`) until it is merged, so test such changes on the `dev-…` address.

`npm run deploy:ci` (deploy straight to production, then migrate) is the old command, kept in case
you want to go back: put it back as the Deploy command and every merge is live again.

## 2b. Validate, then promote

**Where to test.** After each merge to `main` (about two minutes, the build shows on the commit in
GitHub and in Worker > Deployments), the new version answers at

    https://dev-ft-bkk-site.frenchtechbangkok.workers.dev

That address always follows the latest upload of `main`. Each version also has its own address,
`https://<8 characters>-ft-bkk-site.frenchtechbangkok.workers.dev`, shown in Deployments next to it. The
live site, `https://ft-bkk-site.frenchtechbangkok.workers.dev` (and the domain later), does not change.

**Make it live (promote).**

1. Cloudflare dashboard > Workers & Pages > **ft-bkk-site** > **Deployments**.
2. Under **Version History**, find the version: its tag is the commit's first 7 characters and its
   message is the commit title (for a merged pull request, "Merge pull request #… from …").
3. Click **Deploy version** (top right, or the version's **…** menu), select that version, leave
   it at **100%**, add a message if you want (for example "1.106 OK") and **Deploy**.

The live site serves it within a few seconds. Promoting a version also brings everything merged
before it: you don't have to promote each one.

To try a version on part of the visitors first, pick two versions in **Deploy version** and split
the percentage (for example 90% old, 10% new); later deploy the new one at 100%.

**Go back (roll back).** Deployments > **Active deployment**: open the menu on an earlier deployment
and choose **Rollback**, or **Deploy version** with an older version at 100%. From a computer:
`npx wrangler rollback` (previous version) or `npx wrangler versions deploy <version id>@100%`.
Rolling back changes the code only: the database keeps its data and its migrations, which is why
migrations must stay compatible (below).

**What a test address shares with the live site.** Everything except the code: the same database,
the same images, the same secrets and email service. A registration, an admin edit or an email sent
from `dev-…` is real and reaches real people. Test with your own email address and delete test
rows afterwards. Scheduled jobs (reminders, social media posts, the weekly backup) only run on the
live version, never on a test address. Test addresses answer `noindex`, so search engines ignore
them.

**Test addresses are private.** The Access application "FT Bangkok admin" has a Workers
destination (Configure > Destinations > Workers: scope `ft-bkk-site`, type **A Worker's preview
URLs**). It puts the same email-code login in front of every test address, whole pages included, so
only admins see versions that are not live yet, and `/admin` works there with the same login (same
application, same AUD tag). Without that destination, public pages on a test address are open and
`/admin` answers 403 there (it fails closed).

**Migrations.** They run when a version is uploaded, before you promote it, so that the test address
works with the new tables and columns. The live, older version runs on the same database meanwhile,
so a migration must only **add** tables and columns (with a default when a column is required).
`npm run upload:ci` refuses to run a new migration that drops or renames a table or column, unless
it carries a line `-- safe-for-live-version: <why>`. To remove a column: first merge and promote the
code that stops using it, then merge the migration that drops it with that line (`npm test` checks
the same rule).

**Secrets while a version waits.** Adding or changing a secret (Variables and Secrets) creates a new
version from the latest one. If Cloudflare refuses because the latest version is not live, promote
or roll back first, or from a computer run `npx wrangler versions secret put <NAME>` (creates a new
version with the secret, then promote it). A var in `wrangler.jsonc` goes live with the version
that carries it.

**Cron schedule.** The hourly trigger belongs to the Worker, not to a version: a change to
`triggers.crons` in `wrangler.jsonc` needs `npx wrangler triggers deploy` once, after promoting.

## 3. Load the content

On your computer, once: `npx wrangler login`. Then:

```sh
npm run capture                # optional: crawl the Wix site into migration/data
npm run import -- --remote     # events, posts, organisations, people, settings and images
```

The import can be run again safely (it updates rows by slug and never overwrites settings
edited in the admin unless you pass `--force-settings`).

## 4. Admin login (Cloudflare Access)

Until this is done, `/admin` answers **403** in production (it fails closed).

1. Zero Trust > Access > Applications > **Add an application** > Self-hosted.
2. Name it "FT Bangkok admin". Add two destinations on the Worker's host (the `workers.dev`
   address for now, `www.french-tech-bangkok.com` later): path `admin` and path `api/admin`.
3. Policy: Allow, rule **Emails**, list the board members who manage the site.
4. Login methods: **One-time PIN** (code by email, no password).
5. Copy two values into `wrangler.jsonc` > `vars` (they are not secret):
   - `ACCESS_TEAM_DOMAIN`: your team domain, e.g. `ftbkk.cloudflareaccess.com` (Zero Trust >
     Settings > Team name).
   - `ACCESS_AUD`: the application's **Application Audience (AUD) Tag** (application > Overview).

To add an admin later, add their email to the policy. Nothing changes in the code.

The application must cover **only** those two paths, never the whole host: crawlers, link previews,
the email provider's review and visitors must reach the public site without a login. If an
application covers the whole host (destination with an empty path), narrow it: open the
application > **Configure** (or Edit) > Destinations (Overview > Application domain on older
dashboards), replace the host-wide entry with two entries on the same host, path `admin` and path
`api/admin`, and Save. Editing keeps the AUD tag, so `ACCESS_AUD` stays as it is (a new
application has a new AUD: update `wrangler.jsonc` then). Check in a private window: `/` opens
without a login, `/admin` asks for the email code.

The admin stays closed even if Access is misconfigured: `src/middleware.ts` checks every `/admin`
and `/api/admin` request against the Access login (signature, audience, issuer, expiry) and answers
403 without one.

## 5. Forms anti-spam (Turnstile)

Until this is done, forms use Cloudflare's test keys, which let every submission through.

1. Dashboard > Turnstile > **Add widget**, mode Managed, hostnames: the `workers.dev` host and
   `french-tech-bangkok.com`.
2. Put the **Site key** in `wrangler.jsonc` > `vars` > `TURNSTILE_SITE_KEY`.
3. Add the **Secret key** as a secret named `TURNSTILE_SECRET`: Worker > Settings > Variables and
   Secrets > Add > type Secret (or `npx wrangler secret put TURNSTILE_SECRET`).

## 6. Email (Resend)

Until this is done, no email is sent (confirmations, reminders and listing links are only logged).

**Simplest: Admin > Email delivery > Setup.** Every value below (API key, sender, caps, webhook
secret, and the SES ones in 6b) can be typed there instead of in `wrangler.jsonc` or as a Worker
secret, and the page shows the webhook and SNS addresses to copy. A value saved in the admin wins
over the Worker's; the steps below still work for a site set up from the terminal.

1. Create an account at resend.com and add the domain `french-tech-bangkok.com`.
2. Add the DNS records Resend lists (an SPF TXT and an MX on the `send` subdomain, a DKIM TXT on
   `resend._domainkey`, and optionally a DMARC TXT) where the domain's DNS is hosted, then click
   Verify.
3. Create an API key (sending access) and add it as a secret named `RESEND_API_KEY`, as for
   Turnstile above.
4. The sender is `EMAIL_FROM` in `wrangler.jsonc`. Until the domain is verified it is Resend's
   test sender `onboarding@resend.dev`, which only delivers to the email address of the Resend
   account: register and submit forms with that address to test. Once verified, set it to
   `La French Tech Bangkok <hello@french-tech-bangkok.com>`. Verifying the domain only adds DNS
   records: the Wix site and the domain's existing mailboxes keep working.
5. Until we control the DNS of french-tech-bangkok.com, the site sends from
   `noreply@mail.delattre.me` (Eric's domain, verified in Resend with its records in Cloudflare).
   Any verified domain works: change `EMAIL_FROM` in `wrangler.jsonc` and deploy. A value set only
   in the Cloudflare dashboard is overwritten by the next deploy.
6. `EMAIL_DAILY_LIMIT` in `wrangler.jsonc` is the provider's daily cap (100 on Resend Free).
   Email the community warns when an audience is bigger than what is left today. Set it to the
   new plan's cap after an upgrade, or to `""` when there is none (Amazon SES in production).
   `EMAIL_MONTHLY_LIMIT` (3000 on Resend Free) is the monthly cap shown in Reports > Emails; same
   rule.

7. **Email report** (Admin > Reports > Emails). Resend has no statistics API, so it tells the
   site about each email through a webhook. In Resend > Webhooks > Add webhook: Endpoint URL
   `<SITE_URL>/api/resend-events` (the report shows the full address), events: all the `email.*`
   ones. Open the webhook, copy its **Signing secret** (`whsec_…`) and add it as the Worker secret
   `RESEND_WEBHOOK_SECRET`. For opens and clicks, Resend > Domains > the sending domain > turn on
   **Open tracking** and **Click tracking** (Resend then rewrites links and adds a tiny image).
   Figures start from that day. When the domain moves, edit the webhook's URL (Resend allows one
   webhook on the free plan). Tracking is set per domain: a domain added again (as
   `mail.french-tech-bangkok.com` was on 9 Nov 2026) starts with both off, and Reports > Emails
   then shows no opens for Resend (the By provider table says so once 20 emails are delivered).
   Resend > Domains > `mail.french-tech-bangkok.com` > Configuration: Open tracking and Click
   tracking on; Webhooks > the site's webhook: `email.opened` and `email.clicked` ticked.

## 6b. Email with Amazon SES (replaces Resend)

Resend Free stops at 100 emails a day; one community email is about 1,200. Amazon SES costs
$0.10 per 1,000 emails with no daily cap once production access is granted. The site sends
through either, chosen in **Admin > Email delivery > Sending service** (saved in the database,
effective at once). Until a choice is saved there, `EMAIL_PROVIDER` in `wrangler.jsonc` decides
(`"resend"`, the default, or `"ses"`). A service only shows once its key is set. Full plan, with the reasons: `ses-migration-plan.md` in the
project files.

**Workers plan.** Through SES each email is its own request. Workers Free allows 50 requests per
run, so an email to more than about 40 people needs **Workers Paid** ($5/month, 10,000 per run).

In the AWS console, region **Asia Pacific (Sydney) ap-southeast-2** (`AWS_REGION`). The account
was opened from Thailand with the new AWS plans, which only allow Sydney plus us-east-1 and
us-west-2: SES in another region (Singapore included) answers 403 "not authorized to perform
ses:SendRawEmail" whatever the IAM policy says. Everything below (identities, production access,
suppression list, SNS topic) is per region, so all of it lives in Sydney.

1. **Domain**: SES > Configuration > Identities > Create identity > Domain (`mail.delattre.me`
   today, the French Tech mail subdomain later), Easy DKIM RSA 2048, custom MAIL FROM
   `bounce.<domain>`. Add the 3 DKIM CNAMEs (**DNS only**, grey cloud), the MX and SPF TXT on
   `bounce.<domain>`, and a DMARC TXT on `_dmarc.<domain>` where the domain's DNS is hosted. Keep
   Resend's records until Resend is no longer used.
2. **Production access**: Account dashboard > Request production access. Until then SES only
   sends 200 a day, 1 per second, to addresses verified in SES. The site must open without the
   Access login (Access only on `/admin` and `/api/admin`) when AWS looks at it.
3. **Suppression list**: Configuration > Suppression list: account-level suppression on for
   bounces and complaints.
4. **Key**: IAM > Users > Create user `ft-bkk-site-email` (no console access), with a policy
   allowing only `ses:SendEmail` and `ses:SendRawEmail`. Create an access key ("Application running
   outside AWS") and add the Worker secrets `AWS_SES_ACCESS_KEY_ID` and `AWS_SES_SECRET_ACCESS_KEY`.
5. **Bounces and complaints**: add a secret `SES_EVENTS_KEY` (any long random string, for example
   from `openssl rand -hex 24`). In SNS (same region), create a Standard topic
   `ft-bkk-ses-events`, then a subscription: protocol HTTPS, endpoint = the address shown in
   Admin > Email delivery ("Address for SES notifications", `/api/ses-events?key=…`). The site
   confirms it by itself. In SES > Identities > the domain > Notifications > Feedback
   notifications, send Bounce and Complaint to that topic. Optionally put the topic ARN in
   `SES_EVENTS_TOPIC_ARN` in `wrangler.jsonc`, so only that topic is accepted.
6. **Test** in Admin > Email delivery > Send a test, choosing **Amazon SES**, while Resend still
   sends everything else. Send to `bounce@simulator.amazonses.com`: the address appears under
   "Addresses no longer emailed" within a minute.
7. **Switch** once AWS has granted production access (in the sandbox SES only delivers to
   verified addresses, so members would get nothing): first set `SES_SEND_RATE` in
   `wrangler.jsonc` to the "Maximum send rate" SES shows (14 is common) and deploy. Then in
   Admin > Email delivery > Sending service, pick **Amazon SES** and press **Use this service**.
   Back to Resend the same way. `EMAIL_DAILY_LIMIT` and `EMAIL_MONTHLY_LIMIT` (Resend's plan) are
   ignored while SES sends, so they can stay as they are.

8. **Email report with SES** (Admin > Reports > Emails): Configuration > Configuration sets >
   Create set `ft-bkk-site`. In the set, Event destinations > Add destination: event types Sends,
   Deliveries, Hard bounces, Complaints, Delivery delays, Rejects, Opens and Clicks (Opens and
   Clicks add tracking to the emails), destination **Amazon SNS**, the topic of step 5. Put
   `"SES_CONFIGURATION_SET": "ft-bkk-site"` in `wrangler.jsonc` and deploy: every email is then sent
   with that set and reported. Bounces and complaints keep feeding the blocked list as before.
   Done on 13 Nov 2026: the set `ft-bkk-site` exists in Sydney and `wrangler.jsonc` names it.
   If Reports > Emails shows sends but no opens for SES, edit the set's SNS destination and check
   that **Opens** and **Clicks** are ticked.

Moving to the French Tech domain later: verify the new domain in SES (step 1), then change
`EMAIL_FROM`. Production access, keys and the SNS topic stay; add the new identity to the feedback
notifications (step 5).

## 7. Connect LinkedIn and Facebook (optional)

Until this is done, scheduled social media posts arrive by email to post by hand (Admin > Social
media says which pages are connected). WhatsApp has no posting API and always works by email.

**Facebook page**

1. At developers.facebook.com create an app (type Business) and add the Pages API.
2. In the Graph API Explorer, pick the app, ask for `pages_manage_posts` and
   `pages_read_engagement`, then get a **Page** access token for La French Tech Bangkok's page.
   Exchange it for a long-lived one (Access Token Debugger > Extend): a page token made from a
   long-lived user token does not expire.
3. Put the page's numeric ID in `FACEBOOK_PAGE_ID` in `wrangler.jsonc` and deploy, then add the
   token as a secret: Worker > Settings > Variables and Secrets > Add > Secret, name
   `FACEBOOK_PAGE_TOKEN` (or `npx wrangler secret put FACEBOOK_PAGE_TOKEN`).

**LinkedIn page**

1. At linkedin.com/developers create an app linked to the La French Tech Bangkok page (a page
   admin must verify it), then request the **Community Management API** product. LinkedIn
   reviews this request; it can take some days.
2. Once granted, generate a token with the `w_organization_social` scope for a page admin
   (Auth > OAuth 2.0 tools). It lasts 60 days: when it expires, the scheduled post falls back to the
   email and the error says to renew it.
3. Put the page's numeric ID (in the page admin URL, `/company/<id>/admin`) in
   `LINKEDIN_ORGANIZATION_ID` in `wrangler.jsonc` and deploy, then add the secret
   `LINKEDIN_ACCESS_TOKEN`.

Link previews (on Facebook, and when you paste a link in WhatsApp or LinkedIn) read the page's
share image, so the site must be reachable without the Access login: Access must only cover
`/admin` and `/api/admin`.

## 8. In the admin

- Settings > **Directory moderators**: who gets listing requests and the Monday digest.
- Settings > **Cloudflare Web Analytics token** (Dashboard > Analytics & Logs > Web Analytics >
  add the site), if you want visitor stats.

## 9. Website traffic report (optional)

Admin > Reports > Website traffic reads Cloudflare's analytics with an API token.

1. Turn on visitor counting if it isn't yet: Cloudflare dashboard > Analytics & Logs > Web
   Analytics > Add a site, enter the site's host (`ft-bkk-site.frenchtechbangkok.workers.dev` today), pick
   the JavaScript snippet option, copy the token from the snippet (`"token": "…"`) and paste it in
   Admin > Settings > General > **Cloudflare Web Analytics token**.
2. Create the API token: My Profile > API Tokens > Create Token > **Create Custom Token**. Name
   it "Website traffic report", permission **Account > Account Analytics > Read**, Account
   Resources: Include > the French Tech account. Continue, Create, copy the token (it is shown
   once).
3. Add it to the Worker: Workers & Pages > ft-bkk-site > Settings > Variables and Secrets > Add >
   type **Secret**, name `CF_ANALYTICS_TOKEN`, paste, Deploy (or
   `npx wrangler secret put CF_ANALYTICS_TOKEN`). Secrets survive deploys.
4. Open Admin > Reports > Website traffic. The page finds the account by itself, and reads the
   page views of the website's host (`SITE_URL`). Only if it says the token reads several
   accounts, put the account ID (dashboard address bar: `dash.cloudflare.com/<account id>/…`) in
   `CF_ACCOUNT_ID` in `wrangler.jsonc` and deploy. `CF_WEB_ANALYTICS_SITE_TAG` (Web Analytics >
   the site: the address ends with `siteTag~in=<tag>`) is optional: it limits the figures to one
   Web Analytics site.

When the domain moves, change `SITE_URL` as planned: the report follows the new host.

Admin > Reports > **Cloudflare usage** uses the same token: Worker, D1 and R2 usage all come from
the GraphQL Analytics API, which Account Analytics: Read covers. If a card says it could not be
loaded with an authorization error, edit the token (My Profile > API Tokens > Edit) and add
**Account > D1 > Read** and/or **Account > Workers R2 Storage > Read**; nothing else changes.
When the account moves to Workers Paid, pick it at the top of that page so the limits follow.

## 10. Speed: Cloudflare's edge cache

`"cache": { "enabled": true }` in `wrangler.jsonc` (needs Wrangler 4.69 or later) puts
Cloudflare's cache in front of the Worker: a public page it already has is sent from the nearest
Cloudflare data centre without running the Worker or reading the database.

- **Public pages** (any HTML page answering a GET with 200; the middleware sets it) send
  `Cloudflare-CDN-Cache-Control: max-age=60, stale-while-revalidate=600, stale-if-error=86400`:
  the edge keeps a copy one minute, then
  refreshes it in the background while still answering at once (and keeps answering for a day if
  the Worker fails). Browsers get `max-age=0, must-revalidate`, so they always ask again. An edit
  in the admin shows on the public site within about a minute; every deploy starts a fresh cache.
- **Never stored**: pages that call `privatePage(Astro)` in their own frontmatter (member page,
  tickets, forms with a token, my data…), admin and `/api/admin`, every POST (forms, webhooks), any answer that sets a cookie,
  redirects, errors and 404s, and anything without a Cache-Control header. `src/worker.ts` passes
  every answer through `edgeSafe()` (`src/lib/edge-cache.ts`), which marks all of these
  `private, no-store`. Admins (Cloudflare Access cookie) are never stored either, so guide
  previews stay private. A new personal page must call `privatePage(Astro)`: setting headers
  from a layout or component does nothing, Astro has already sent them.
- **Only the public address is stored.** The cache key is the path and query, not the host, so
  answers for www, workers.dev and preview URLs are never stored (otherwise the www redirect or the
  workers.dev `noindex` header could be served on the real site). A www request for a page the
  edge already has gets that page instead of the 301; its canonical tag still points to the bare
  domain. For a strict redirect, add a Redirect Rule in Cloudflare (Rules > Redirect Rules,
  hostname equals `www.french-tech-bangkok.com` → `https://french-tech-bangkok.com${path}`, 301).
- **Old Wix links** (`/post/…`, `/event-details/…`, `/sponsors/…`, see `src/lib/redirects.ts`) are
  answered by the Worker the first time (it looks the slug up in D1, so a slug that changed on
  import still lands on the right page), then the edge keeps that 301 for a day: repeat hits and
  crawlers get it from Cloudflare without running the Worker. This is why there are no Redirect
  Rules or Bulk Redirects in the dashboard: a fixed list would lose the slug matching and need
  updating with every new post or event. Moved admin screens and the www redirect are never kept.
- **Bots**: `/robots.txt` (generated by `src/pages/robots.txt.ts`, not a file in `public/`)
  already keeps search engines out of `/admin`, `/api/` and the private pages, and lists the
  sitemap. `/admin` is behind Cloudflare Access, which answers before the Worker runs, so bots
  there never reach the site. The 401s seen in Cloudflare's stats come from the Resend webhook
  refusing a wrong signing secret (`src/lib/resend-events.ts`), not from visitors.
- **Files**: `public/_headers` keeps `/_astro/*` (CSS and JS, renamed at each change) a year and
  `/brand/*` images a day; uploaded images and PDFs under `/media/` are kept a year.
- **Check**: `curl -sI https://french-tech-bangkok.com/events | grep -i cf-cache-status` twice: the
  second says `HIT`. `curl -sI https://french-tech-bangkok.com/member` says `BYPASS` or no status.
- **Cost**: with the cache on, every request (static files too) counts as a Workers request
  (10 million a month included in Workers Paid), but cached answers use no CPU time.

## Backups and restore

- D1 keeps 30 days of history: `npx wrangler d1 time-travel restore ftbkk --timestamp=<ISO date>`
  restores the database to that moment (`time-travel info` shows the current bookmark first).
- Every Sunday the cron also writes a JSON export of all tables to R2 under `backups/` (12 weeks
  kept, never served publicly).

## Later: the domain

When the site is ready to replace Wix: move `french-tech-bangkok.com` DNS to Cloudflare (or add a
CNAME), add both `www.french-tech-bangkok.com` and `french-tech-bangkok.com` as Custom Domains on
the Worker (the bare one redirects to `www`, and old Wix URLs redirect to their new pages on both),
add the hostname to
the Access application and the Turnstile widget, set `SITE_URL` in `wrangler.jsonc` back to
`https://www.french-tech-bangkok.com` (links in emails, canonical URLs, the sitemap and social
images use it; the workers.dev address then answers with `noindex`), then run
`npm run check:redirects -- https://www.french-tech-bangkok.com`. Finally add the domain in Google
Search Console and submit `https://www.french-tech-bangkok.com/sitemap.xml`.
