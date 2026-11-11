-- Admin > Email delivery > Setup: Resend and Amazon SES keys, secrets and settings typed in the
-- admin (src/lib/email-setup.ts). A row here wins over the Worker variable or secret of the same
-- name; no row = the Worker's value. Kept apart from `settings`, which public pages read.
CREATE TABLE `email_setup` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
