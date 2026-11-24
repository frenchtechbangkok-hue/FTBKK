-- The day-before email to the team (src/lib/event-eve.ts): when it went out for each event, so it
-- is sent only once. Only adds a column.
ALTER TABLE `events` ADD `team_reminder_sent_at` integer;
