-- Reports > Emails: one row per email the provider (Resend or Amazon SES) reported on through its
-- webhook, with the first time each step happened. No recipient address is kept.
CREATE TABLE `email_messages` (
	`provider` text NOT NULL,
	`message_id` text NOT NULL,
	`subject` text,
	`recipients` integer DEFAULT 1 NOT NULL,
	`sent_at` integer NOT NULL,
	`delivered_at` integer,
	`delayed_at` integer,
	`bounced_at` integer,
	`bounce_type` text,
	`complained_at` integer,
	`opened_at` integer,
	`clicked_at` integer,
	`failed_at` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`provider`, `message_id`)
);
--> statement-breakpoint
CREATE INDEX `email_messages_sent_at_idx` ON `email_messages` (`sent_at`);
