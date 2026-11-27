-- A photo on contact cards (Contacts > a contact > Photo), shared with the People card made from
-- the contact when they speak at an event. Only adds a column.
ALTER TABLE `contacts` ADD `photo_key` text;
