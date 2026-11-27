-- Online events: an event is at a venue (as before) or online only, with the link to join the
-- webinar. An event at a venue can also have a link for online streaming. Only adds columns.
ALTER TABLE `events` ADD `online` integer DEFAULT false NOT NULL;
ALTER TABLE `events` ADD `online_url` text;
