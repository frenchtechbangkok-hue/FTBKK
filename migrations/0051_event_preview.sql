-- Preview link of a draft event: a secret token so the page can be shared with people who are
-- not admins before it is published. Only adds a column.
ALTER TABLE `events` ADD `preview_token` text;
