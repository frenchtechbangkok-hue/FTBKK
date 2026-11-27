-- Speakers picked from Contacts: a People card made from a contact tagged Speaker remembers that
-- contact, so the speaker picker never offers the same person twice. Only adds a column.
ALTER TABLE `people` ADD `contact_id` integer REFERENCES `contacts`(`id`) ON DELETE set null;
