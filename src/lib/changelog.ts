/**
 * History > Change history: one entry per merged pull request, newest first. Each merge is a new
 * version of the site. Since November 2026 versions read YY.MM.XX: year, month, then the release
 * number within that month (26.11.01 is the first of November 2026). Older ones keep their
 * "1.N" (1.0 was the first full site). Every change adds its own entry at the top, in plain words for the team: what changes for
 * visitors or admins, not how it is built. test/changelog.test.ts checks the order.
 */
export interface Release {
  /** "YY.MM.XX" (XX counts the releases of that month, from 01); "1.N" before November 2026. */
  version: string;
  /** Merge day, Bangkok time (YYYY-MM-DD). */
  date: string;
  /** Pull request number on GitHub, when the change went through one. */
  pr?: number;
  title: string;
  summary: string;
}

export const REPO_URL = 'https://github.com/frenchtechbangkok-hue/FTBKK';

export const RELEASES: Release[] = [
  {
    version: '26.11.03',
    date: '2026-11-09',
    title: 'Write automatic emails in Markdown',
    summary:
      'In Automatic emails the message can now use Markdown: **bold**, headings, lists and links (with an Insert link button), and the preview updates as you type. The test email and every real email show the formatting; messages written in plain text look exactly as before.',
  },
  {
    version: '26.11.02',
    date: '2026-11-09',
    title: 'Set up Resend and Amazon SES from the admin',
    summary:
      'Settings > Email delivery has a new Setup section where the sender, the Resend and Amazon SES keys, the webhook secret, the configuration set and the other email settings are typed in directly, with the webhook addresses to copy and a button to make the SES notifications key; secrets are never shown again once saved, and no terminal is needed any more.',
  },
  {
    version: '26.11.01',
    date: '2026-11-09',
    title: 'See what registrants told us before an event',
    summary:
      'Registrations now has a "What attendees told us" box listing only the people who answered "Anything we should know, or something you\'re looking for?", with a CSV download and a filter to show just them in the list; each note also stands out under the person\'s name. From now on site versions read year.month.number (26.11.01).',
  },
  {
    version: '1.112',
    date: '2026-11-09',
    pr: 127,
    title: 'Email report shows Resend and Amazon SES',
    summary:
      "Reports > Emails now counts and lists both sending services side by side (emails sent, delivered, opened, clicked and the last update each one sent), so Resend's figures stay visible after the switch to Amazon SES, and the page explains what to set up when SES or Resend stops reporting.",
  },
  {
    version: '1.111',
    date: '2026-11-07',
    pr: 126,
    title: "Moved to La French Tech Bangkok's own accounts",
    summary:
      "The website now runs in La French Tech Bangkok's own Cloudflare account and GitHub organization instead of Eric's personal ones, with a new admin login and real anti-spam keys on the forms; the test address is now ft-bkk-site.frenchtechbangkok.workers.dev.",
  },
  {
    version: '1.110',
    date: '2026-11-05',
    pr: 125,
    title: 'Cloudflare usage report',
    summary:
      'Reports has a new Cloudflare usage tab showing how much of the Cloudflare plan the website uses (page requests, computing time, database and file storage), with bars that turn orange near a limit and red over it; pick Workers Free or Workers Paid on the page and the limits follow.',
  },
  {
    version: '1.109',
    date: '2026-11-05',
    pr: 124,
    title: 'Events with no registration',
    summary:
      'An event can now be set to "No registration needed": its page says to just come along (walk-ins welcome) instead of showing a form or "Registration is closed".',
  },
  {
    version: '1.108',
    date: '2026-11-03',
    pr: 123,
    title: 'General image when sharing the site',
    summary:
      'Sharing the home page or any page without its own picture on WhatsApp, LinkedIn or Facebook now shows the La French Tech Bangkok logo over the Bangkok skyline instead of the French Tech Connect visual; events and posts keep their own image.',
  },
  {
    version: '1.107',
    date: '2026-11-03',
    pr: 122,
    title: 'Test addresses need the admin login',
    summary:
      'The deploy guide now explains that test versions of the site (such as dev-ft-bkk-site) ask for the same email code as the admin, so only admins can see a version before it goes live.',
  },
  {
    version: '1.106',
    date: '2026-11-03',
    pr: 121,
    title: 'Test a new version before it goes live',
    summary:
      'Changes merged on GitHub no longer go live by themselves: each one first opens on a test address (dev-ft-bkk-site.edelattre.workers.dev), and goes live when it is promoted in Cloudflare > ft-bkk-site > Deployments, where an earlier version can also be put back in one click.',
  },
  {
    version: '1.105',
    date: '2026-11-03',
    pr: 120,
    title: 'How to connect LinkedIn and Facebook',
    summary:
      'Social media posts > Connected pages now says for each network whether it is connected and what is still missing, with a "How to connect" step-by-step guide for getting the page ID and token and adding them in Cloudflare.',
  },
  {
    version: '1.104',
    date: '2026-11-03',
    pr: 119,
    title: 'Preview a draft blog post',
    summary:
      'While a post is a draft or scheduled for later, the post editor has a "Preview the page" link that opens the post exactly as visitors will see it; only admins can open it and search engines never see it.',
  },
  {
    version: '1.103',
    date: '2026-11-03',
    pr: 118,
    title: 'Pick a board member as blog author',
    summary:
      'In the post editor, each author row has a "Pick a board member" list that fills in their name, French Tech role and LinkedIn (with their photo), and you can still type any other author by hand.',
  },
  {
    version: '1.102',
    date: '2026-11-03',
    pr: 117,
    title: 'Clearer Come work in France page',
    summary:
      'On Come work in France, the French Tech Visa section now presents it plainly as France\'s dedicated visa route for tech talent, with who it is for, and the official websites and Business France have their own section, "Official websites and support", after the steps to apply.',
  },
  {
    version: '1.101',
    date: '2026-11-03',
    pr: 116,
    title: 'Come work in France guide',
    summary:
      'The French Tech Visa guide becomes Come work in France: why France, the French Tech Visa, where to find a startup job and get help, with links to the English La French Tech website (the old address opens the visa section). Still offline until switched on in Settings > Guide pages.',
  },
  {
    version: '1.100',
    date: '2026-11-03',
    pr: 115,
    title: 'French Tech Visa guide',
    summary:
      'A new guide page, French Tech Visa, explains in English how to work, found a startup or invest in France with the Talent permit, and how to apply from Thailand; it stays offline until it is switched on in Settings > Guide pages.',
  },
  {
    version: '1.99',
    date: '2026-11-03',
    pr: 114,
    title: 'Choose the email service in the admin',
    summary:
      'Settings > Email delivery now has a Resend or Amazon SES choice with a "Use this service" button, so switching who sends the emails no longer needs a code change, and Resend\'s daily cap stops applying while Amazon SES sends.',
  },
  {
    version: '1.98',
    date: '2026-11-03',
    pr: 113,
    title: 'Simpler README',
    summary:
      'The project page on GitHub is short and clear again: what the site and the admin do, how to run and deploy it, with the full detail moved to a separate features page.',
  },
  {
    version: '1.97',
    date: '2026-11-03',
    pr: 112,
    title: 'Clearer admin',
    summary:
      'The admin menu is regrouped (Website, Settings for switches, History for the logs) with red numbers for what is waiting and a search box. Every page has the same header, buttons and empty lists, an event has the same tabs on all its screens, and everyday pages show a useful figure: event pace and show-up, who is coming, a summary per contact, quiet members, opens and clicks per community email, post views and listings to complete.',
  },
  {
    version: '1.96',
    date: '2026-11-03',
    pr: 111,
    title: 'Clearer reports',
    summary:
      'The four Reports tabs look alike: four main figures with trend lines on top, the rest in one panel, events as columns and a CSV on every tab. Events shows the coming events against the usual, when people register, the regulars and the companies that come most; Membership shows the net change, the renewal rate and the regulars who are not members yet.',
  },
  {
    version: '1.95',
    date: '2026-11-03',
    pr: 110,
    title: 'Clearer dashboard',
    summary:
      'The admin dashboard greets you, lists only what is waiting for the team, shows the last 7 days (visits, registrations, new members, emails), how full the next events are, the latest activity and the newest change to the site.',
  },
  {
    version: '1.94',
    date: '2026-11-03',
    pr: 109,
    title: 'Email plan usage',
    summary:
      'Reports > Emails shows how many emails went out today and this month against the Resend plan limits, with what is left.',
  },
  {
    version: '1.93',
    date: '2026-11-03',
    pr: 107,
    title: 'Easier Actions log',
    summary:
      'Each line of the Actions log is now a plain sentence with links, grouped by day, with who did it, an area label, the changed fields in words, and filters by area and by person.',
  },
  {
    version: '1.92',
    date: '2026-11-03',
    pr: 105,
    title: 'Email report',
    summary:
      'A new Emails tab in Reports shows how many emails were sent, delivered, opened and clicked, and how many bounced or were marked as spam.',
  },
  {
    version: '1.91',
    date: '2026-11-03',
    pr: 104,
    title: 'Change history',
    summary:
      'Settings > Change history now lists every version of the site with what it changed; the old list of admin edits is renamed Actions log.',
  },
  {
    version: '1.90',
    date: '2026-11-03',
    pr: 103,
    title: 'SES in Sydney',
    summary:
      "Emails go through Amazon SES in Sydney, and never fail when the blocked list can't be read.",
  },
  {
    version: '1.89',
    date: '2026-11-03',
    pr: 102,
    title: 'Amazon SES and bounce list',
    summary: 'Emails can go through Amazon SES or Resend, and addresses that bounced are skipped.',
  },
  {
    version: '1.88',
    date: '2026-11-03',
    pr: 101,
    title: 'Traffic report fix',
    summary: 'The traffic report works without needing to list the Web Analytics sites.',
  },
  {
    version: '1.87',
    date: '2026-11-03',
    pr: 100,
    title: 'Website traffic report',
    summary: 'A Website traffic tab in Reports, with visits from Cloudflare analytics.',
  },
  {
    version: '1.86',
    date: '2026-11-02',
    pr: 99,
    title: 'Old Wix links redirect',
    summary: 'Every address from the old Wix site now leads to its new page.',
  },
  {
    version: '1.85',
    date: '2026-11-02',
    pr: 98,
    title: 'Extra tickets in guest import',
    summary: 'The guest import counts extra tickets per order, also for people imported earlier.',
  },
  {
    version: '1.84',
    date: '2026-11-02',
    pr: 97,
    title: 'Gamescom AI talk imported',
    summary: 'The Gamescom AI talk of October 27, run on Wix, and its guests were imported.',
  },
  {
    version: '1.83',
    date: '2026-11-02',
    pr: 96,
    title: 'Guide pages switch',
    summary:
      'Each guide page has an online switch in Settings, and admins can preview a guide while it is offline.',
  },
  {
    version: '1.82',
    date: '2026-10-13',
    pr: 95,
    title: 'Admin dashboard',
    summary: 'The admin dashboard starts with quick actions, with icons.',
  },
  {
    version: '1.81',
    date: '2026-10-13',
    pr: 94,
    title: 'Tags and groups',
    summary:
      'Contacts and members get tags and groups, and a group can be the audience of a community email.',
  },
  {
    version: '1.80',
    date: '2026-10-13',
    pr: 93,
    title: 'Email the community',
    summary:
      'Email all contacts or a CSV list, write in Markdown with a live preview, and insert post or event cards.',
  },
  {
    version: '1.79',
    date: '2026-10-10',
    pr: 92,
    title: 'Better reports',
    summary:
      'Reports with a period picker, a view for one event, feedback results and membership insights.',
  },
  {
    version: '1.78',
    date: '2026-10-10',
    pr: 91,
    title: 'Add people to an event',
    summary: 'Add registrations by picking members, typing people in or importing a CSV.',
  },
  {
    version: '1.77',
    date: '2026-10-10',
    pr: 90,
    title: 'Check-in camera help',
    summary:
      'Help when the phone camera is blocked at check-in, a photo fallback, and no sideways scrolling on phones.',
  },
  {
    version: '1.76',
    date: '2026-10-10',
    pr: 89,
    title: 'Admin menu tidy-up',
    summary:
      'One Reports group, Settings split into sections, and an Emails and social media group.',
  },
  {
    version: '1.75',
    date: '2026-10-10',
    pr: 88,
    title: 'Join as an enterprise',
    summary: '"An enterprise" is added to the ways to join on Home and About.',
  },
  {
    version: '1.74',
    date: '2026-10-10',
    pr: 87,
    title: 'Private and unlisted events',
    summary:
      'A Select event type, private events reached by an invitation link, and unlisted events.',
  },
  {
    version: '1.73',
    date: '2026-10-10',
    pr: 86,
    title: 'Tighter home page',
    summary: 'Less space between the sections of the home page.',
  },
  {
    version: '1.72',
    date: '2026-10-10',
    pr: 83,
    title: 'Bring guests',
    summary:
      'People can bring up to 5 guests when they register, and guests are checked in with their host.',
  },
  {
    version: '1.71',
    date: '2026-10-10',
    pr: 85,
    title: 'SEO fields on posts',
    summary: 'Each blog post can have its own search title, description, keywords and share image.',
  },
  {
    version: '1.70',
    date: '2026-10-10',
    pr: 84,
    title: 'Tech Pulse for members',
    summary: 'Tech Pulse PDFs can be downloaded by members only, while membership is switched on.',
  },
  {
    version: '1.69',
    date: '2026-10-10',
    pr: 81,
    title: 'Board roles on About',
    summary: "Board cards on About show each person's French Tech responsibility.",
  },
  {
    version: '1.68',
    date: '2026-10-10',
    pr: 82,
    title: 'Directory first on Ecosystem',
    summary:
      'The Ecosystem page shows the directory first and partners below; the home carousel shows 20 organisations and scrolls slowly on its own.',
  },
  {
    version: '1.67',
    date: '2026-10-10',
    pr: 80,
    title: 'Nationality removed',
    summary: 'Nationality is no longer asked, stored or shown anywhere.',
  },
  {
    version: '1.66',
    date: '2026-10-10',
    pr: 79,
    title: 'Admin notifications',
    summary:
      'One list of people who get the team emails, an email when someone becomes a member, and a Send a test button.',
  },
  {
    version: '1.65',
    date: '2026-10-07',
    pr: 78,
    title: 'Expanding to Thailand guide',
    summary:
      "The Founder's Guide is now for startups, and a new Expanding to Thailand guide is for established companies.",
  },
  {
    version: '1.64',
    date: '2026-10-07',
    pr: 77,
    title: 'Event speakers',
    summary:
      '"Who\'s taking the stage" speaker cards on event pages, with each speaker\'s role and a short bio.',
  },
  {
    version: '1.63',
    date: '2026-10-07',
    pr: 76,
    title: 'Resources menu',
    summary: "The Founder's Guide is published in a new Resources menu, next to Tech Pulse.",
  },
  {
    version: '1.62',
    date: '2026-10-07',
    pr: 75,
    title: 'Editable partner groups',
    summary: 'Partner groups can be edited, and a Hospitality group was added.',
  },
  {
    version: '1.61',
    date: '2026-10-07',
    pr: 74,
    title: 'Share images and social posts',
    summary:
      'Ready-made share images for events and posts, and social media posts that can be scheduled.',
  },
  {
    version: '1.60',
    date: '2026-10-07',
    pr: 72,
    title: "Founder's Guide (hidden)",
    summary: "A first Founder's Guide page, not yet linked from the menu.",
  },
  {
    version: '1.59',
    date: '2026-10-07',
    pr: 73,
    title: 'Partners',
    summary:
      'Partner groups, a Partners section on the Ecosystem page and a Partners screen in the admin.',
  },
  {
    version: '1.58',
    date: '2026-10-07',
    pr: 71,
    title: 'LinkedIn icons aligned',
    summary: 'The LinkedIn icons on person cards line up.',
  },
  {
    version: '1.57',
    date: '2026-10-07',
    pr: 70,
    title: 'Home photos, partners and event covers',
    summary:
      'Choose each photo on the home page, edit the About us items, show partners on the home page, and default covers for Talk and Connect events.',
  },
  {
    version: '1.56',
    date: '2026-10-07',
    pr: 69,
    title: 'SEO fixes',
    summary:
      'Links, descriptions and structured data cleaned up for search engines, and preview addresses are kept out of Google.',
  },
  {
    version: '1.55',
    date: '2026-10-07',
    pr: 68,
    title: 'Find duplicate contacts',
    summary:
      'A Possible duplicates page lists contacts that look like the same person, to review and merge.',
  },
  {
    version: '1.54',
    date: '2026-10-07',
    pr: 67,
    title: 'Folding admin menu',
    summary: 'The admin menu groups fold and unfold, and remember how you left them.',
  },
  {
    version: '1.53',
    date: '2026-10-07',
    pr: 66,
    title: 'Clearer admin menu',
    summary:
      'A clearer admin menu, and the same header and filter chips on the Ecosystem, Events and Blog pages.',
  },
  {
    version: '1.52',
    date: '2026-10-07',
    pr: 65,
    title: 'Home header and numbers',
    summary:
      'The Bangkok skyline is back as the home header, and the key numbers show the mockup figures until they are set.',
  },
  {
    version: '1.51',
    date: '2026-10-07',
    pr: 64,
    title: 'New home page',
    summary:
      'The home page redesigned after the board mockup: big header, About us, key numbers, events, the directory carousel, news, community and partners.',
  },
  {
    version: '1.50',
    date: '2026-10-07',
    pr: 63,
    title: 'Tech Pulse and Thai pages',
    summary:
      'A Thailand Tech Pulse page with every edition and a page in Thai, both in the header menu.',
  },
  {
    version: '1.49',
    date: '2026-10-07',
    pr: 62,
    title: 'Emails from our own address',
    summary: 'Emails now come from noreply@mail.delattre.me instead of the test address.',
  },
  {
    version: '1.48',
    date: '2026-10-07',
    pr: 61,
    title: 'Past attendees recognised',
    summary:
      'Known past attendees get a "Welcome back" link to claim their membership, contacts can have several emails, and merging is done field by field.',
  },
  {
    version: '1.47',
    date: '2026-10-07',
    pr: 60,
    title: 'Team notes on listings',
    summary: 'The team can add private notes to ecosystem listings.',
  },
  {
    version: '1.46',
    date: '2026-10-07',
    pr: 59,
    title: 'Member filters and board reports',
    summary:
      'Filter and export members, see board reports, and members can cancel from their own page.',
  },
  {
    version: '1.45',
    date: '2026-10-06',
    pr: 58,
    title: 'New About page',
    summary: 'The /about page redesigned in the same style as /join.',
  },
  {
    version: '1.44',
    date: '2026-10-06',
    pr: 57,
    title: 'New Join page',
    summary: 'A redesigned /join page.',
  },
  {
    version: '1.43',
    date: '2026-10-06',
    pr: 56,
    title: 'Members-only events and renewals',
    summary:
      'Events can be for members only, past attendees are invited to claim a membership, memberships renew yearly, and the team can email the community.',
  },
  {
    version: '1.42',
    date: '2026-10-06',
    pr: 55,
    title: 'New members to review',
    summary:
      'New members get a simple "to review" marker so the board can follow newcomers, without blocking them.',
  },
  {
    version: '1.41',
    date: '2026-10-06',
    pr: 54,
    title: 'Simpler admin',
    summary:
      'Removed teams, roles, event checklists and review steps: anyone with admin access can do everything.',
  },
  {
    version: '1.40',
    date: '2026-10-06',
    pr: 52,
    title: 'Edit email wording',
    summary:
      'A screen to change the subject, text and button of every email the site sends, with a preview and a test send.',
  },
  {
    version: '1.39',
    date: '2026-10-06',
    pr: 53,
    title: 'Mark a contact as member',
    summary: 'A contact can be flagged as a member straight from Contacts.',
  },
  {
    version: '1.38',
    date: '2026-10-06',
    pr: 51,
    title: 'Merge duplicate contacts',
    summary: 'Two contacts that are the same person can be merged into one.',
  },
  {
    version: '1.37',
    date: '2026-10-06',
    pr: 50,
    title: 'Consistent membership wording',
    summary: 'Membership is named and shown the same way across the site and the admin.',
  },
  {
    version: '1.36',
    date: '2026-10-06',
    pr: 49,
    title: 'Free membership',
    summary:
      'Free individual membership: sign up on /join, confirm by email, a personal member page, and Members in the admin.',
  },
  {
    version: '1.35',
    date: '2026-10-06',
    pr: 48,
    title: 'Admin menu in groups and Join page',
    summary:
      'The admin menu is grouped by topic, and a new Join the community page explains how to take part.',
  },
  {
    version: '1.34',
    date: '2026-10-05',
    pr: 47,
    title: '"Delete my data"',
    summary: 'Anyone can ask for their data to be deleted, from the footer or the privacy page.',
  },
  {
    version: '1.33',
    date: '2026-10-05',
    pr: 46,
    title: 'Tags, newsletter consent and privacy',
    summary:
      'Contact tags, newsletter consent, check-in badges, a membership filter, a custom question on the registration form, and a PDPA privacy page.',
  },
  {
    version: '1.32',
    date: '2026-10-05',
    pr: 45,
    title: 'Six event features',
    summary:
      'Email all registrants, a code of conduct, event recaps, a feedback email after the event, speakers and sponsors on event pages.',
  },
  {
    version: '1.31',
    date: '2026-10-05',
    pr: 44,
    title: 'Bulk actions on contacts',
    summary: 'Select several contacts to copy their emails, export them or delete them.',
  },
  {
    version: '1.30',
    date: '2026-10-05',
    pr: 43,
    title: 'Better guest import',
    summary:
      'The guest import handles +1 check-ins, emoji in profiles, mistyped LinkedIn links and bilingual notes.',
  },
  {
    version: '1.29',
    date: '2026-10-05',
    pr: 42,
    title: 'Wix guest lists imported',
    summary: 'Guest lists of past Wix events can be imported into the event registrations.',
  },
  {
    version: '1.28',
    date: '2026-10-05',
    pr: 41,
    title: 'Manage contacts',
    summary:
      'Contacts can be created, edited, deleted and emailed, and the dashboard shows the total.',
  },
  {
    version: '1.27',
    date: '2026-10-05',
    pr: 40,
    title: 'Contacts',
    summary:
      'A Contacts page in the admin with everyone who ever registered, their history and a CSV export.',
  },
  {
    version: '1.26',
    date: '2026-10-05',
    pr: 39,
    title: 'README: check-in',
    summary: 'The project description covers the check-in shortcut and walk-ins.',
  },
  {
    version: '1.25',
    date: '2026-10-05',
    pr: 38,
    title: 'Check-in shortcut and walk-ins',
    summary: 'A /checkin shortcut for the door, and walk-in guests can be added on the spot.',
  },
  {
    version: '1.24',
    date: '2026-10-05',
    pr: 37,
    title: 'README update',
    summary: 'The project description now matches the site as it is.',
  },
  {
    version: '1.23',
    date: '2026-10-05',
    pr: 36,
    title: 'Home and About like the original',
    summary:
      'Home and About pages closer to the original site, with the charter colours and the official logo, plus admin fixes.',
  },
  {
    version: '1.22',
    date: '2026-10-04',
    pr: 35,
    title: 'Notes on messages',
    summary: 'The team can add notes to a message and see its history.',
  },
  {
    version: '1.21',
    date: '2026-10-04',
    pr: 34,
    title: 'Messages folders',
    summary: 'The contact form inbox has folders, replies, spam and blocked senders.',
  },
  {
    version: '1.20',
    date: '2026-10-04',
    pr: 33,
    title: 'Event dashboard and QR tickets',
    summary:
      'A dashboard per event, QR code tickets in the confirmation email and a faster check-in at the door.',
  },
  {
    version: '1.19',
    date: '2026-10-04',
    pr: 31,
    title: 'Ecosystem review',
    summary:
      'Ecosystem listing requests open on their own page, where the team can see the details, edit them and approve or reject.',
  },
  {
    version: '1.18',
    date: '2026-10-04',
    pr: 29,
    title: 'Wix buttons in posts',
    summary: 'Buttons from the old Wix posts now show as proper links instead of raw text.',
  },
  {
    version: '1.17',
    date: '2026-10-04',
    pr: 28,
    title: 'Fresh Wix copy',
    summary:
      'A fresh copy of the Wix content with full event text, real categories, PDFs and sponsor logos.',
  },
  {
    version: '1.16',
    date: '2026-10-04',
    pr: 26,
    title: 'Test emails before the domain move',
    summary:
      'Emails can be tested on the temporary workers.dev address before the site moves to its own domain.',
  },
  {
    version: '1.15',
    date: '2026-10-04',
    pr: 27,
    title: 'Registration counts',
    summary: 'The admin event lists show how many people registered again.',
  },
  {
    version: '1.14',
    date: '2026-10-04',
    pr: 25,
    title: 'Blog and admin fixes',
    summary:
      'Post authors, PDF attachments, a Files page in the admin, and old blog links that keep working.',
  },
  {
    version: '1.13',
    date: '2026-10-04',
    pr: 24,
    title: 'PDF downloads in posts',
    summary:
      'No more duplicated author line on posts, and PDF download buttons can be placed anywhere in a post with a tag.',
  },
  {
    version: '1.12',
    date: '2026-10-04',
    pr: 23,
    title: 'Sort admin lists',
    summary: 'Posts and events in the admin can be sorted by clicking a column header.',
  },
  {
    version: '1.11',
    date: '2026-10-04',
    pr: 22,
    title: 'Real blog categories, full event text',
    summary:
      'Blog posts use the real categories from Wix and event pages show their full text without a "Show more" button.',
  },
  {
    version: '1.10',
    date: '2026-10-04',
    pr: 21,
    title: 'Fuller Wix copy',
    summary:
      'The Wix copy now keeps the full event text, the real post categories and the PDF attachments.',
  },
  {
    version: '1.9',
    date: '2026-10-04',
    pr: 20,
    title: 'Design polish 2',
    summary: 'Categories on blog cards, a new About header and cleaner organisation pages.',
  },
  {
    version: '1.8',
    date: '2026-10-04',
    pr: 19,
    title: 'Design polish',
    summary:
      'Date blocks on events, the next event featured at the top, and lists that are easier to scan.',
  },
  {
    version: '1.7',
    date: '2026-10-04',
    pr: 18,
    title: 'Admin login fix',
    summary: 'The admin login works again after the Cloudflare Access team was renamed.',
  },
  {
    version: '1.6',
    date: '2026-10-04',
    pr: 17,
    title: 'Admin login fix and post categories',
    summary: 'Fixed the admin login and added categories to blog posts.',
  },
  {
    version: '1.5',
    date: '2026-10-04',
    pr: 16,
    title: 'Nicer blog articles',
    summary:
      'Redesigned blog articles, cleaned up the text imported from Wix, and a clearer message when someone without access opens the admin.',
  },
  {
    version: '1.4',
    date: '2026-10-04',
    pr: 15,
    title: 'Logo, favicon and photos',
    summary:
      'The official logo, browser icon, home photo and social share image from the Wix site.',
  },
  {
    version: '1.3',
    date: '2026-10-04',
    pr: 14,
    title: 'Old Wix content saved',
    summary:
      'Copied the content of the old Wix site (events, posts, organisations, people) so it could be imported.',
  },
  {
    version: '1.2',
    date: '2026-10-03',
    pr: 13,
    title: 'Admin login',
    summary: 'The admin is now behind a Cloudflare Access login, so only the team can open it.',
  },
  {
    version: '1.1',
    date: '2026-10-03',
    pr: 12,
    title: 'Setup guide: media storage',
    summary:
      'The setup guide now says to create the photo and file storage before the first deploy.',
  },
  {
    version: '1.0',
    date: '2026-10-03',
    pr: 11,
    title: 'The new website',
    summary:
      'First version of the new site on Cloudflare: Home, Ecosystem, Events, Blog and About pages, event registration, the ecosystem directory with its listing form, and the admin for posts, events, registrations and listings.',
  },
];
