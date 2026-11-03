-- Addresses the site no longer emails: hard bounces and spam complaints reported by Amazon SES.
CREATE TABLE `email_suppressions` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
