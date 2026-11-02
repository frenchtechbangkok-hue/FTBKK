#!/usr/bin/env bash
# Creates the French Tech Talk "Game Over for the Old Way: How AI Reshapes Development"
# (Gamescom Asia, Oct 27 2026, run on the old Wix site) with its cover, speakers and partners,
# then imports its Wix guest list (61 people, 13 extra tickets as +1/+2 guests). No email is sent.
#
#   scripts/one-off/2026-10-27-game-over/run.sh <guest-export.csv>            # local D1 + R2
#   scripts/one-off/2026-10-27-game-over/run.sh <guest-export.csv> --remote   # the live site
#
# Safe to re-run: the event is updated in place and people already registered are skipped.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DIR=scripts/one-off/2026-10-27-game-over
CSV=${1:?Usage: run.sh <guest-export.csv> [--remote]}
TARGET=${2:---local}
for f in events/game-over-for-the-old-way.jpg people/julien-villedieu.jpg people/katleen-evers.jpg people/jeremy-zeler-maury.jpg; do
  npx wrangler r2 object put "ftbkk-media/$f" --file "$DIR/media/$f" "$TARGET"
done
npx wrangler d1 execute ftbkk "$TARGET" --file "$DIR/event.sql" --yes
npx tsx scripts/import-guests.ts "$CSV" --event game-over-for-the-old-way-how-ai-reshapes-development \
  --extra-tickets-as-guests $([ "$TARGET" = --remote ] && echo --remote)
