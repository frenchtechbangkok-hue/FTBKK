-- Reports > Website traffic, "From the site's emails": visits that came through a link in one of
-- the site's emails (utm_source=ftbkk, utm_medium=email), counted by the Worker per UTC day, email
-- (utm_campaign) and page (src/lib/email-visits.ts). Counts only, nothing about the visitor.
CREATE TABLE `email_visits` (
	`day` text NOT NULL,
	`campaign` text NOT NULL,
	`path` text NOT NULL,
	`visits` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `campaign`, `path`)
);
