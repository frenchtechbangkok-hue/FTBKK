-- Emails and social media > Newsletters (src/lib/newsletters.ts): newsletters built from blocks,
-- sent now or at a set time by the cron, each with its own figures. Only adds tables and a column.
CREATE TABLE `newsletters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text,
	`subject` text NOT NULL,
	`preheader` text,
	`blocks` text DEFAULT '[]' NOT NULL,
	`audience` text DEFAULT 'newsletter' NOT NULL,
	`segment` text,
	`web_page` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`scheduled_at` integer,
	`started_at` integer,
	`sent_at` integer,
	`recipients` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`suppressed` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`error` text,
	`locked_until` integer,
	`created_by` text NOT NULL,
	`updated_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
CREATE UNIQUE INDEX `newsletters_slug_unique` ON `newsletters` (`slug`);
CREATE INDEX `newsletters_status` ON `newsletters` (`status`,`scheduled_at`);
-- Who a newsletter goes to, frozen when sending starts: sending resumes where it stopped, and the
-- one-click unsubscribe link (token) says which newsletter made someone leave. Deleted with the
-- person's data.
CREATE TABLE `newsletter_sends` (
	`newsletter_id` integer NOT NULL REFERENCES `newsletters`(`id`) ON DELETE CASCADE,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`token` text NOT NULL,
	`sent_at` integer,
	`unsubscribed_at` integer,
	PRIMARY KEY(`newsletter_id`, `email`)
);
CREATE UNIQUE INDEX `newsletter_sends_token_unique` ON `newsletter_sends` (`token`);
CREATE INDEX `newsletter_sends_email` ON `newsletter_sends` (`email`);
-- Which email (utm_campaign, e.g. "newsletter-3") each provider event is about, from the tag the
-- site puts on every email: a newsletter's opens and clicks are counted exactly.
ALTER TABLE `email_messages` ADD `campaign` text;
CREATE INDEX `email_messages_campaign_idx` ON `email_messages` (`campaign`);
