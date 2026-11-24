-- The "Tech Pulse" blog category: the /tech-pulse page lists the posts in it (lib/tech-pulse.ts).
-- Ticks it on every existing post with "Tech Pulse" in its title, the rule used until now. Only
-- adds rows.
INSERT OR IGNORE INTO `categories` (`slug`, `name`, `sort_order`)
  SELECT 'tech-pulse', 'Tech Pulse', coalesce(max(`sort_order`), -1) + 1 FROM `categories`;
INSERT OR IGNORE INTO `post_categories` (`post_id`, `category_id`)
  SELECT p.`id`, c.`id` FROM `posts` p, `categories` c
  WHERE c.`slug` = 'tech-pulse' AND lower(p.`title`) LIKE '%tech%pulse%';
