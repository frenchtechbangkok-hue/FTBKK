-- Events with no registration: information only, people just come along (walk-in welcome). The
-- page shows a friendly note instead of the form or "Registration is closed".
ALTER TABLE `events` ADD `no_registration` integer DEFAULT false NOT NULL;
