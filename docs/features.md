# Feature reference

Everything the site and the admin do, in detail, with the files and tables behind each feature.
The [README](../README.md) has the short version; [admin.md](admin.md) explains the admin
screen by screen for the team.

## Public site

- **Home**, after the board's mockup: a full-width photo hero (the Bangkok skyline until another
  is uploaded; words between \*stars\* in the heading show in red); "About us" with the first
  paragraph of About, the values, an arched photo and four items with icons (Connect talent,
  Support entrepreneurs, Accelerate collaborations, Shine internationally); a band of up to four key
  numbers typed in Site texts (the mockup's 300+, 120+, 50+ and 3 until then); the next four
  events (or the latest recaps when none is scheduled); the ecosystem directory as a navy carousel
  with category chips, showing 20 organisations picked at random for All and for each category,
  so it isn't always the same names, drifting slowly sideways in a loop (it stops under the
  pointer or keyboard focus, after a swipe or an arrow, off screen and with its pause button, and
  stays still for visitors who ask for reduced motion); the latest three posts; a community block with three
  photos and a link per "You can join us" card (An individual, A startup, A business partner, and
  An enterprise, added by migration 0038 and pointing to the company listing on `/join#directory`); "They support La French Tech Bangkok" (the partners ticked "Show on Home" in Ecosystem
  > Partners, with a link to all partners; migration 0031 turned the earlier list of Business
  > France, the Franco-Thai Chamber of Commerce, the Embassy of France, La French Tech and
  > Bpifrance into partner listings); and a red closing band with Contact us and Join. Each photo has its own
  > slot in Website > Page texts > Home, with built-in defaults (`lib/home.ts`).
- **Event covers**: French Tech Connect, French Tech Talk and French Tech Select events without a
  cover show a default image, set in Settings > Event covers (built-in images for Connect and Talk until then,
  none for Select; `lib/event-covers.ts`).
- **Private and unlisted events**: a private event takes registrations only from people who open
  its invitation link (`/events/<slug>?invite=<token>`, made in the admin; "New link" revokes the
  old one); everyone else sees "Registration is by invitation only". Members-only registration
  still applies on top. Any event can also be unlisted: its page works by direct link but it stays
  off the events page, home page, sitemap and welcome email, and gets `noindex` (migration 0038).
- **About**: the community, the board (each card shows the member's French Tech responsibility,
  such as President or Commission lead, instead of their company), "Speakers we've hosted" (everyone who spoke
  at a past event, most recent first), institutional partners, "You can join us" cards and the
  contact form. About opens with a navy hero and an "On this page" index of its sections, in the
  same style as `/join`. Texts are edited in the admin (Site texts).
- **Resources** menu in the header (a drop-down; flat in the mobile menu): Tech Pulse, the
  Founder's Guide and Expanding to Thailand.
- **Thailand Tech Pulse** at `/tech-pulse` (Resources menu): our quarterly report. The latest
  edition leads with a Download button, then every edition with its quarter, a link to the summary
  post and the PDF. Editions are the published blog posts with "Tech Pulse" in their title; the
  PDF is the post's first PDF attachment (or the first PDF linked in its text). The introduction
  is edited in Site texts. While membership is open (Settings > Membership), the PDFs are for
  members, with the same steps as event registration: the Download buttons ask for an email; a
  member downloads at once (and the browser is remembered for a year, so next time the buttons
  download straight away); someone new fills the free membership form, and the confirmation email
  opens their member page with the download. Links to the report file itself (`/media/…` in the
  post, old bookmarks) go through the same check, so it can't be fetched directly. While
  membership is closed, the PDFs are free for everyone.
- **Founder's Guide** at `/founders-guide` (Resources menu, footer, sitemap, once online): for founders
  starting or growing a startup in Thailand. A "Where are you?" picker (testing an idea, remote
  work, setting up a company, hiring and raising) shows the visa, structure and next steps; then
  visas compared, company structures (BOI or a Thai partner), a first-year budget estimator, taxes
  at a glance, a setup checklist, hiring, money and culture tips, who can help and a FAQ.
- **Expanding to Thailand** at `/expand-to-thailand` (Resources menu, footer, sitemap, once online): for
  established tech companies, often French, opening an office or a business in Thailand. Market
  figures, a five-question chooser that suggests an entry model and highlights its card, seven
  entry models compared (sell from home, distributor, representative office, branch, BOI
  subsidiary, Thai partner, regional hub) with invoicing, ownership, capital and setup time, an
  18-month roadmap, visas for the people you send, selling tips, local and cross-border taxes, a
  launch checklist, who can help and a FAQ.
- Each guide has an **online** switch (Admin > Website > Guide pages), off by default so the board
  can check the content first. Offline, the page answers 404 to visitors and is left out of the
  Resources menu, footer, sitemap and the other guide; a logged-in admin sees it with a "Preview,
  not online" bar (`src/lib/guides.ts`).
- Both guides link to each other (once both are online), cite sources on every card and show a "last checked" date. Each
  checklist keeps its ticks in the browser (localStorage, one key per guide). Content is edited in
  code, not in the admin: shared visas, taxes, tips, helpers, sources and the date in
  `src/lib/thailand-guides.ts`; page content in `src/lib/founders-guide.ts` and
  `src/lib/expansion-guide.ts`; shared blocks in `src/components/guide/`.
- **Thai page** at `/th` (ภาษาไทย in the header menu, `lang="th"`): La French Tech Bangkok, La
  French Tech and the Mission French Tech, our role, objectives and activities, in Thai, with
  Contact us buttons to the About contact form. Each `## ` heading of its text becomes a numbered
  section listed in the hero. The text is edited in Site texts (a default Thai text is built in).
  Thai glyphs use Noto Sans Thai, downloaded only for Thai characters.
- **Join the community** at `/join`, opened by the header's button and linked from Home and the
  footer: a navy hero with a "Ways to join" index, the free membership (perks, three steps and the
  form side by side), the WhatsApp community, listing a company in the directory,
  ways to get involved (volunteer, host an event, become a partner, speak), the newsletter and the
  contact form. The WhatsApp group is for members, so its invite link is never shown publicly
  (not in the header, footer or Home): members get it in their welcome email and on their member
  page; until sign-up opens, people ask for it with the contact form's "Join the WhatsApp group"
  topic. Links like `/join?topic=host#contact` open the form with that topic picked. The page's
  texts are edited in Site texts.
- **Free individual membership** (shown on `/join` once Settings > "Open free individual
  membership" is ticked): email, name, profile type, company, job title, LinkedIn, sectors of
  interest, optional phone, how they heard of us, the
  code of conduct and privacy consent, and an optional newsletter box (Turnstile and rate limits).
  We email a single-use `member_confirm` link (7 days); `/member/confirm` asks for one click and
  the member is **active** at once, then gets a welcome email with the WhatsApp invitation, the
  next three events and a button to their member page. Signing up again with a member's address
  just emails their page link, and the page says the same thing either way. The team sees new members
  in Members > To review (it never blocks them), can add notes and can suspend a member. Membership runs a year
  (`renewal_due_at`): a daily cron job emails a one-click reminder 30 and 7 days before
  (`member_renew` link, `/member/renew`), then marks the member **lapsed** with a last email;
  a lapsed member renews in one click from that email or their member page.
- **Admin dashboard** (`/admin`, helpers in `src/lib/dashboard.ts`): a greeting with the admin's
  first name (from their member record) and the days to the next event; six quick-action tiles
  (create an event, write a post, email the community, check in guests, add an organisation, edit
  the home page); **Waiting for you**, a list that only shows what needs the team (directory queue
  with its oldest item, unread messages, members to review, social media posts that failed in the
  last 14 days, renewals in the next 30 days, draft posts) or "All clear"; **Last 7 days**
  (website visits from Cloudflare, loaded after the page by `/api/admin/dashboard-traffic`;
  registrations and new members with the change from the week before and a daily sparkline;
  emails sent this month against the plan) with the totals of members, contacts and listings;
  the next five events with a date block, days to go and a fill bar; **Latest activity**
  (registrations, new members, submitted listings, messages); and the latest Change history entry.
- **Reports** (`/admin/reports/events`, `/admin/reports/members`, loaded by `src/lib/reports.ts`):
  a period picker (last 30/90 days, 12 months, this or last year, all time, custom dates;
  `src/lib/report-period.ts`) with changes against the previous period, an event type filter, a
  one-event view (`?event=`, compared with the usual for its type, registration pace, arrivals at
  the door, companies, feedback and comments), first-timers vs returning, member share, feedback
  ratings and comments, and CSV exports of what is shown (`/admin/reports/*.csv`). Figures are
  computed in memory (`src/lib/event-stats.ts`, `src/lib/member-reports.ts`); charts are
  server-rendered SVG, no chart library (`LineChart` draws per-event figures as columns with
  `bars`). All four tabs share one layout: four key-figure tiles styled like the dashboard
  (`Kpi`: change against the previous period and a sparkline), the other figures in one compact
  **More figures** panel (`MoreFigures`), then charts, breakdowns and tables, and CSV exports
  (`/admin/reports/{events,members,traffic,emails}.csv`). Events adds **Coming up** (the next
  five events with seats taken against the usual for their type at the same number of days
  before), **When people register** (days before the event, and the median), the most regular
  attendees and the companies that come most. Membership adds the net change (joined minus lapsed
  members who stayed out), the renewal rate (from the `member_lapsed` and `member_renew` entries
  of the actions log), joined and lapsed per week or month, the path from attendee to member and
  **Regulars who aren't members yet**. A member's joining date is `member_since` (renewing resets
  `confirmed_at`, which no longer counts as a new member).
- **Website traffic report** (`/admin/reports/traffic`, `src/lib/traffic.ts`): the third Reports
  tab reads Cloudflare's GraphQL Analytics API from the server (Cloudflare dashboards can't be
  embedded) with the Worker secret `CF_ANALYTICS_TOKEN` (Account Analytics: Read). Same period
  picker: visits, page views and pages per visit with changes against the previous period, a
  chart per week or month, most viewed pages, referrers, countries, devices and browsers (Web
  Analytics beacon, on while Settings has its token), Core Web Vitals for real visitors (LCP, INP,
  CLS at the 75th percentile with the share of good page views, as in Observatory), and the
  requests and errors the Worker served. The account is found from the token
  (or `CF_ACCOUNT_ID`) and the figures are those of the `SITE_URL` host (or of the Web Analytics
  site `CF_WEB_ANALYTICS_SITE_TAG`, or the one whose beacon token is in Settings when the token may
  list sites); long periods are split into the spans Cloudflare allows and clamped to what it keeps (about six
  months of visits, three of Worker requests). Each part loads on its own and shows its error.
- **Email report** (`/admin/reports/emails`, `src/lib/email-metrics.ts`): the fourth Reports
  tab shows what happened to the emails the site sent, with the same period picker: emails sent,
  delivered, opened and clicked (rates against delivered), bounced and marked as spam, each with
  the change against the previous period, a chart per week or month, a split per provider while
  both are used, and a table per subject (one community email, one event's reminders…). Neither
  provider has a statistics API (Resend's email list only gives each email's latest status and
  keeps 30 days), so the figures come from their webhooks into the `email_messages` table
  (migration 0041; one row per email with the first time each step happened, no recipient
  address): Resend's webhook posts to `/api/resend-events`, checked against the Svix signature
  with the Worker secret `RESEND_WEBHOOK_SECRET`; Amazon SES events (with a configuration set,
  `SES_CONFIGURATION_SET`) arrive through the same SNS topic as its bounces, at `/api/ses-events`.
  Resend permanent bounces and spam complaints also go on the do-not-email list. A **plan usage** box
  compares the emails sent today and this month (UTC, recipients counted) with `EMAIL_DAILY_LIMIT`
  and `EMAIL_MONTHLY_LIMIT` (Resend Free: 100 and 3,000; empty with SES hides it). Figures start the
  day the webhook is set up; opens and clicks need tracking turned on for the sending domain.
- **Member admin and reports**: Members > All members filters on status, profile,
  sector, joined dates, events attended, no-show rate and newsletter, and exports the filtered
  list as CSV (`/admin/members.csv`, `src/lib/member-list.ts`). Reports > Membership
  (`/admin/reports/members`, `src/lib/member-reports.ts`) shows growth, profile type and sector,
  members at events, event-goers who became members and members' ratings.
  Members can cancel an upcoming registration or leave a waitlist from their member page
  (`cancelRegistration` in `src/lib/registrations.ts`, shared with the email cancel link).
- **Members-only events** (once membership is open): the registration box asks only for the
  email, the optional note and the photo notice. An active member is registered at once with the
  details of their membership. Any other email gets the free membership form in the same box;
  submitting it sends one email (`member.confirm-event`), and the click makes them a member and
  registers them (`members.pending_event_id`), then the member page says how it went. An email
  we already know (past registrations or a contact card) that isn't a member gets a "Welcome
  back" message instead and the `member.claim-event` email: a `member_claim` link whose
  `ref_id` is the event, to `/member/claim` prefilled from what we know, which makes them a
  member and registers them. While membership is closed, the full registration form works as
  before. While `EMAIL_FROM` is Resend's test sender, the Dashboard and Settings warn that emails
  only reach the Resend account owner.
- **Claim your membership**: in Contacts, tick people and **Invite to join** to email them a
  `member_claim` link (60 days) to `/member/claim`, a form prefilled from their contact card; the
  link proves the email, so the membership is active at once. Members and people invited in the
  last 30 days are skipped; the invitation date shows on the list.
- **Email the community** (`/admin/community-email`): one message to the active members, the
  newsletter subscribers, all contacts (minus those who said no to emails, with a PDPA note and
  the count without consent), the people in some **groups or tags** (same consent rule as all
  contacts; the count updates as boxes are ticked, and the history shows which ones), a list imported from a CSV file (email required, name optional,
  deduplicated and previewed before sending) or the contacts ticked in Contacts (**Email…**).
  The message is Markdown with a live preview of the real email, link and image buttons, and a
  picker that inserts published events and blog posts as cards (`{{event: slug}}`,
  `{{post: slug}}`, rendered with tables for email clients by `src/lib/email-markdown.ts`). Test
  send, duplicate guard, a warning when the audience exceeds the provider's daily cap
  (`EMAIL_DAILY_LIMIT`, 100 on Resend Free) and the list of what was sent (`community_emails`).
- **Email delivery** (`/admin/email-delivery`): emails go through Resend or Amazon SES
  (`EMAIL_PROVIDER`, `src/lib/email.ts`; SES raw MIME messages signed with `aws4fetch` in
  `src/lib/ses.ts`, sent at `SES_SEND_RATE` per second). Test send through either provider. SES
  bounces and complaints arrive from SNS at `/api/ses-events?key=…` (handled in `src/worker.ts`
  before Astro), fill `email_suppressions` (migration 0040), and every send skips those
  addresses; the page lists them with a Remove button. Setup: docs/deploy.md, section 6b.
- **Member page** at `/member?token=…` (a reusable `member` link, 30 days, sent in every member
  email; no passwords): membership dates, the WhatsApp button, their events (coming up and past),
  their profile to edit, and **Leave**, which deletes the member row (event history stays until
  they use My data). `/member` without a link offers **Send me my link**, and the footer links
  "My membership" while sign-up is open. Confirming a membership also creates the person's
  contact card (an existing one is left alone), so members show in Contacts (with a Member badge,
  a Membership line on their page and a Membership column in the CSV) and in My data, which lists
  the membership. Deleting a contact (in the admin or from My data) deletes their membership too.
  Active members count as members for member priority on events, like owners of member companies.
  The default privacy notice covers membership (migration 0023 updates the live text only if it
  was never edited).
- **Newsletter sign-up** on `/join` with double opt-in: name and email (Turnstile and rate limits)
  send a confirmation link (a single-use `newsletter` code in `magic_tokens`, valid 7 days); the
  `/newsletter` page asks for one click (so link scanners can't subscribe anyone) and records the
  consent, dated, on the person's contact card (created if needed).
- **Ecosystem**: a directory of French startups, companies, service providers, investors,
  incubators, schools and institutions in Thailand. Anyone can request a listing; owners manage
  it through one-time email links (no accounts) and confirm it once a year. Free membership with
  a Member badge, approved in the admin (the "company membership", separate from individual
  membership: Settings > "Accept company membership applications").
  The team can keep a private note on each listing (Ecosystem > All listings or the listing's
  page; `organisations.admin_notes`, never shown on the site), also shown in the review queue.
- **Partners**: any listing can be a partner of La French Tech Bangkok, in a partner group
  (institutional, corporate, investors and VCs, coworkings and venues, hospitality, experts, schools
  and universities, community and media by default; the admin can add, rename, reorder and remove
  groups, saved in `settings.partnerGroups`, defaults in `lib/directory.ts`), whatever its
  directory category. `/ecosystem` opens with a compact header and **All organisations** right
  under it, so listings show above the fold (on phones only the search shows, the other filters
  fold behind a "Filters" button). The **Partners** section (`#partners`, linked from the header's
  "Our partners" button) follows the directory: a logo wall per group, then a "Become a partner" call that opens the contact form on the Partnership topic. Partner
  listings carry a Partner badge and the directory has a Partner filter. Partners ticked "Show on
  Home" feed "They support La French Tech Bangkok" on Home, in their order: the directory is the
  only place partners are managed (Admin > Ecosystem > Partners, or the listing's page).
- **Events**: upcoming and past events with built-in registration: capacity, waitlist with
  automatic promotion, **guests** (a registrant can bring up to 5 anonymous guests, no names asked;
  each takes a seat and counts in every registration and attendance number, shows as "+2 guests"
  in Registrations, the CSV, check-in, the ticket and the member page, and in the confirmation
  email), an optional **"Anything we should know?"** question (dietary needs,
  accessibility, who they'd like to meet; shown to organisers in Registrations, the CSV, the
  check-in screen and the contact's event history), check-in flags people who aren't members and
  can enrol a walk-in as a member (they get the confirmation email), **admins can add registrants**
  themselves in Registrations (pick members, type someone in, or import a CSV with a downloadable
  template; `src/lib/add-registrants.ts`), confirmation email with a calendar invite, reminder the day before, QR
  ticket and cancel link, **speakers** (a "Who's taking the stage" section of cards with photo,
  role such as Keynote speaker, Moderator or Panelist, title, company, talk title, an optional short
  bio for the event and LinkedIn; picked from People and reused across events), **hosts, sponsors and partners** with their logo (linked to
  their ecosystem listing or website, shown on the event page, "Hosted by" next to the venue, and
  named in the confirmation and reminder emails), and a **feedback email** the day after (one-click 1 to 5 rating, then
  an optional comment; results in the admin's Reports). Past events can show a **recap**: a
  photo gallery (with a lightbox), slides to download, the video (YouTube and Vimeo play on the
  page, cookie-free) and a card linking to the blog write-up. Past events with a recap get a
  "Recap" badge in the events list.
- **Blog**: posts with categories, authors, images and PDF downloads. RSS at `/rss.xml`. Each
  post has editable SEO fields (title, meta description, keywords, social image, hide from search
  engines), pre-filled with automatic values from the post (`src/lib/seo.ts`); only overrides are
  stored.
- **Share images and social media** (Admin > Emails and social media > Social media posts): every event and blog post gets a
  1200x630 share image (official logo, red label, title, date and venue or byline, its photo),
  used as `og:image` so LinkedIn, Facebook and WhatsApp previews look right. The admin's browser
  draws it on a canvas whenever the event or post is opened in the admin and its title, date,
  venue or photo changed (`lib/share.ts`, `lib/share-image-client.ts`); public pages fall back
  to the cover while it is out of date. Each event or post has a Share page: download the image,
  copy the text, open it in WhatsApp, and schedule the announcement on a chosen date and time plus,
  for an event, a reminder the day before (09:00 by default). The hourly cron publishes what is
  due: on the LinkedIn and Facebook pages through their APIs once connected (`docs/deploy.md`),
  otherwise by an email to the admin who scheduled it with the text and a one-tap WhatsApp
  button. WhatsApp has no API for groups, so WhatsApp posts are always that email. A reminder
  whose event moved to another day, or a post about a cancelled or unpublished event or post, is
  cancelled instead of posted.
- **Code of conduct** at `/code-of-conduct`: how everyone is expected to behave at events, in our
  online groups (WhatsApp, LinkedIn) and on the website, and how to report a problem. Linked in
  the footer, on every event page and in the registration form. The text is edited in the admin.
- **Privacy** (Thailand's PDPA): a privacy notice at `/privacy` (what we collect, why, who sees
  it, how long we keep it, people's rights), linked in the footer and under the registration form,
  editable in the admin. Every email sent to registrants (confirmation, waitlist promotion,
  reminder, feedback request, event cancelled, "Email registrants") has a **Manage or delete my
  data** link to `/my-data?token=…` (the registration's own token, kept when someone registers
  again after cancelling, so older links keep working). That page shows what we hold about the
  person (details, events with their own answers and feedback, tags), lets them unsubscribe from
  the newsletter, and lets them delete all their data after a confirmation step (the same as
  "Delete this contact" in the admin: freed seats go to the waitlist). Deleting a contact also
  strips their details from the admin actions log (the deletion itself is logged under a short
  hash, not their email). Opening the link never deletes anything. People without an event email
  to hand use **Delete my data** in the footer (also offered on `/privacy`): `/my-data` asks for
  their email (with Turnstile and a rate limit) and, only if the site holds data for it, emails a
  link that works for 24 hours (`/my-data?code=…`, a single-use `data` code in `magic_tokens`). The
  page always answers the same way, so it doesn't reveal whether an address is known.
- Every URL of the old Wix sitemap (101 pages, events, posts, categories, sponsors, team and
  member profiles, listed in `migration/data/wix-sitemap-urls.txt`) answers with a permanent 301
  to the same content on the new site (`src/lib/redirects.ts`). Event, post, ecosystem and
  category URLs are checked against the slugs in D1: a slug that changed on import
  (`safecomms` -> `safecoms`, `wyzauto-` -> `wyzauto`, `french-tech-connect-54-1` ->
  `french-tech-connect-54`) still lands on its page, and one that no longer exists lands on the
  listing instead of a 404. Known renames go in `LEGACY_SLUGS`. The `www` / bare twin of
  `SITE_URL` redirects to `SITE_URL` in the same hop. `sitemap.xml`, `robots.txt` and `rss.xml`
  are generated. Every absolute link (canonical URL, social image, sitemap, structured data, emails)
  uses `SITE_URL` (`src/lib/site.ts`), so the domain switch is one line. Any other host serving the
  Worker (version previews, workers.dev after the switch) sends `X-Robots-Tag: noindex`. Pages
  without their own description use a default one (Admin > Settings > Site description overrides
  it); posts, events and listings carry schema.org data (BlogPosting, Event with speakers,
  Organization) and the home page adds the WebSite name Google shows in results.

## Admin

Private admin at `/admin` (behind Cloudflare Access). Its menu (`src/lib/admin-menu.ts`) is
grouped: **Events** (all events, registrations, check-in), **Community** (members, contacts, tags
and groups, messages), **Ecosystem** (to review, all listings, partners, renewals), **Website**
(blog posts, PDFs and files, page texts with one tab per public page, board and speakers, guide
pages), **Emails and social media** (email the community, social media posts, automatic emails),
**Reports** (`/admin/reports/*`), **Settings** (general, membership, event covers, social links:
one `/admin/settings?section=` screen each, plus email delivery) and **History** (**Actions log**
at `/admin/actions-log`, **Change history** at `/admin/changes`). Red badges show what is waiting
(members to review, unread messages, directory queue, failed social posts) and a search box at the
top of the menu opens `/admin/search` (contacts, members, events, posts, listings by name). Every admin page uses the same header (`AdminLayout`: title, one-line `intro`, `actions` and `help`
slots, `trail` above the title), tabs (`PageTabs`, `EventTabs` for an event's or a post's screens),
figure rows (`StatRow`), empty boxes (`EmptyState`) and red `danger` buttons for deletes. Everyday
pages carry a figure each: events pace against the usual and show-up rate, "Who's coming" on
registrations, a summary line on each contact, Members > Quiet, opens and clicks per community
email (`sendFigures`), post views (`/api/admin/post-views`, Cloudflare) and listings to complete
(`listingGaps`). Old admin addresses redirect
(`src/lib/redirects.ts`). The groups fold and unfold, the current one open. Anyone who can sign in
to the admin can do everything; there are no roles. See
[admin.md](admin.md).

**Change history** (`/admin/changes`) lists every version of the site, newest first: each merged
pull request is a new version (1.0 was the first full site, then 1.1, 1.2...), with its date, a
short plain-language summary and a link to the pull request. The entries live in
`src/lib/changelog.ts` and every PR adds its own at the top. **Actions log** (`/admin/actions-log`,
formerly `/admin/history`, which redirects) is the record of who changed what in the admin: each
`audit_log` row reads as a plain sentence with links ("Approved and published the listing Accor"),
grouped by day, with an area label, who did it, the changed fields in words, filters by area and
by person, and 100 per page. The wording lives in `src/lib/actions-log.ts`; a new kind of logged
action gets its sentence there (unknown ones still read as words).

**Automatic emails** (`/admin/emails`) lists the emails the site sends on its own, grouped (Events,
Ecosystem, Membership, Community, Privacy, Admin notifications), each with who receives it, when it goes out and whether its text is the
default or edited (when, by whom). Opening one edits its subject, message and button label, with
placeholders such as `{name}`, `{event}`, `{date}` and `{venue}`, a preview in the real email
layout with sample values, **Send me a test** and **Back to the default text**. Only the words
are editable: dates, venue, logos, the ticket, links and attachments stay in the code. Edits are
rows in the `email_templates` table; without a row (or if the table can't be read) the built-in
default from `src/lib/email-templates.ts` is used. Every automatic email is a template: the
event emails (registration confirmed, waitlist, seat freed, reminder, cancelled, feedback request),
the directory emails to listing owners (listing request, published, declined, manage link, yearly
check and last day, hidden, claim invitation, claim confirm/approved/declined, changes
published/declined, membership approved/declined), the individual membership emails (sign-up
confirmation, welcome, member page link, the link sent on a repeat sign-up, the confirmation for
a newcomer registering for an event, the claim invitation, the yearly reminder and the paused
email), the newsletter
confirmation, the "your data" link, and the notifications to the team (contact form message, new
member, new listing, claim, listing change and membership application to review, weekly directory
summary). Every team notification goes to the addresses in Settings > General > Admin notifications (the
contact email when empty); **Send a test** there sends one right away and shows Resend's answer.
A contact form message whose email fails gets a note saying so in Messages.
Lists built by the site (the renewals of the directory summary) are placeholders (`{renewals}`)
that must stay in the message (not only the subject or button), like a rejection `{reason}`, the contact form `{message}` or a claim's `{domain-check}`. Optional
parts of the welcome email are placeholders too: `{whatsapp}` (the WhatsApp sentence, empty
without a link) and `{next-events}` ("Coming up next:" and the next events, empty when none); a
placeholder left empty on its own line leaves no blank paragraph. "Email registrants" is written each time, so it is listed but not a
template.

Check-in at the door works from a phone: volunteers bookmark `/checkin`, which opens a list of
today's and upcoming events (after the Access login). Tapping one opens its check-in screen. On
that screen they can search by name, email or phone, scan the QR ticket, and add walk-in guests
who didn't register. People coming for the first time get a "First time" badge (with "Say hello
to the N newcomers" above the list) and people who came to 3 or more earlier events a "Regular"
badge, so volunteers know whom to welcome.

**Scan QR** asks the phone for the camera when tapped. If the camera was refused before (in the
browser or in the phone's settings), a website can't make the phone ask again, so the check-in
screen explains why the camera didn't start and shows the steps to turn it back on for the
volunteer's browser (Safari, Chrome, Brave or another browser on iPhone; Chrome or another
browser on Android), with **Try again** and **Reload page** buttons. **Take a photo** reads the
QR code from a photo taken with the phone's camera app, and typing the ticket code always works.

Organisers can **email an event's registrants** from the admin (venue change, slides after the
talk, last-minute reminder): pick the audience (registered, checked in, waitlist or everyone not
cancelled, with counts), write a subject and message with an optional button, send a test to
themselves, then send. Each message sent is kept in the event's email history (and in the weekly
backup); a second send of the same message within 10 minutes, even from another tab, is refused.

**Contacts** in the admin lists everyone who ever registered for an event or walked in, one line
per person (grouped by email), with no sign-up needed. For each person it shows how many events
they attended, registered for and missed, which events those were, their company, and the
ecosystem listings they manage or are the contact for. The list can be filtered (regulars, never
came, linked to the ecosystem, by event, by tag, by group, "Members" (active individual members) and
"Regulars not yet members": people who came to 3 or more events and haven't joined, to invite) and exported to CSV, and "Copy emails" copies
the filtered addresses for the Bcc field of an email. **Tags and groups** (`/admin/contacts/labels`,
`lib/contact-labels.ts`, migration 0039) turn Contacts into a small CRM: the team creates, renames
and deletes tags (short labels shown next to a name; Speaker, Sponsor, Volunteer, Board and Press to
start with, `contact_tags`) and groups (named lists with a description, `contact_groups`); a
contact card keeps its tag keys (`contacts.tags`) and group ids (`contacts.groups`), and a person
can have several of each. Both filter Contacts and Members, show on the contact page and in the
CSV exports and My data, and can be chosen as the audience of Email the community. Tick several
contacts (or members) to copy their emails, export them to CSV, add or remove a tag or group (or
put them in a new group in one go), or delete them at once. A **Member** box in a contact's Edit form (and on New contact) makes them an active
member, optionally with the welcome email; unticking ends the membership, and changing the email
moves it. **Merge…** (2 to 10 selected)
folds duplicates into one contact: you pick the main email, the other emails to keep and, field by
field, the name, phone, company, role and LinkedIn to keep; registrations, attendance and feedback
move over (same event twice: came > registered > waitlist > cancelled wins, and a freed seat goes
to the waitlist), tags and groups are combined, notes joined and the membership moves to the main email. **Possible
duplicates** (`/admin/contacts/duplicates`, `lib/contact-duplicates.ts`) lists contacts that look
like the same person (same name, phone, LinkedIn, email before the @, or first name + company),
suggests the main one and links each group to the merge page; "Not the same person" is kept in
the `notDuplicates` setting. A
contact can have **other emails** (`contacts.other_emails`, migration 0030): registrations,
sign-ups and members-only registrations made with any of them count as that person. Contacts can be added by hand,
edited (with tags, groups, team notes and LinkedIn), contacted by email, WhatsApp or phone, and deleted. The dashboard shows
the total number of contacts.

**Newsletter consent** (Thailand's PDPA: explicit, opt-in, dated). The registration form has an
unticked box "Send me the La French Tech Bangkok newsletter"; a tick is stored with its date
(`newsletter_consent`, `newsletter_consent_at`). An unticked box is not recorded, so it never
withdraws an earlier yes (people withdraw on `/my-data` or by telling the team). The walk-in dialog has the
same optional box (only a tick is recorded, and it needs an email). When someone tells the team
in person, an admin sets "Subscribed" or "Not subscribed" with the date on their contact card
(`contacts.newsletter`, `newsletter_at`). A person's consent is their most recent explicit choice;
people never asked (Wix imports) have none. Contacts can be filtered on "Agreed to the newsletter"
and the CSV has "Newsletter" and "Newsletter consent date" columns, to import into a newsletter
tool. The site doesn't send newsletters itself.

## Design

The design follows the French Tech usage charter: its palette, the official La French Tech
Bangkok logo and the full name "La French Tech Bangkok".
