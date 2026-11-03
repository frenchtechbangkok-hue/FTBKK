# Migration from Wix

`npm run capture` (script: `migration/capture.ts`) crawls the live Wix site with Playwright and
writes the extracted content to `migration/data/`. Only `migration/data/`, this README and the
script are committed; raw HTML, screenshots and images stay local (gitignored) and are uploaded to
R2 by `scripts/import.ts`.

## Running the capture

The cloud environment that built this repo can't reach french-tech-bangkok.com, so run it once
from a machine that can:

```sh
npm install
npx playwright install chromium
npm run capture               # ~75 pages, a few minutes
git add migration/data docs/design-tokens.captured.md && git commit -m "data: capture Wix site"
```

Options: `--only=events|posts|sponsors|pages|team`, `--no-screens`. `CHROMIUM_PATH` points at an
existing Chromium; `CAPTURE_SITE` overrides the base URL (used for testing against a fixture).

What the capture now gets right (fixed 2026-10-04 after the first run):

- Event descriptions: "Show More" buttons are clicked first, so the full text is captured.
- Blog categories: read from each category page, not from the post page (which lists the whole
  menu).
- Post attachments: Wix file widgets have no link, so each "Download" is clicked and the file is
  saved to `migration/files/` under the name shown on Wix.
- Sponsors: every link on the page is kept in `links`, to check by hand when `website` and
  `linkedin` come back empty.

To refresh only these: `npm run capture -- --only=events --no-screens`, then `--only=posts`, then
`npm run import -- --remote`.

## Seed data (until the capture runs)

`migration/data/seed/` holds what could be read from the home page text on 2026-10-03: board
members and institutional representatives (names and companies, no titles or photos yet), the next
two French Tech Connect events, the home and footer copy, and the 3 institutions plus the board
members' companies. The About copy and the organisations' directory categories are drafts to
review. `scripts/import.ts` uses a captured file when it exists and falls back to the seed.

## Expected counts after the capture

33 events (one "test-title" marked junk), 11 posts, 31 sponsors, 10 board members, 3 institutional
representatives.

## Importing Wix guest lists

To bring an event's registrations over from Wix, export its guest list in Wix (Events > the event >
Guests > Export; ticketed and RSVP events both work) and run `npm run import:guests -- <Guest_list_….csv>` (add `--remote` for the
live database). It adds one registration per email with the Wix order date and Wix check-ins
(attended), takes the role from the job title or "Which best describes you?" question, puts
LinkedIn URLs (mistyped ones are repaired) and free-text answers on the contact cards, sends no
email, and can be re-run. For a folder of exports:
`for f in ~/Downloads/Guest_list_*.csv; do npm run -s import:guests -- "$f" --remote; done`.
Add `--extra-tickets-as-guests` when people booked several tickets under one email: the extra
tickets of one order become anonymous guests (+1, +2…, up to 5) on their registration, also for
people imported earlier (a second order under the same email is not a guest). Leave it off for the
older exports that listed every ticket twice (numbers ending in 1P and 1Q). One-off jobs that
create an event Wix still holds and import its guests live in `scripts/one-off/` (for example
`scripts/one-off/2026-10-27-game-over/run.sh <export.csv> --remote`).
