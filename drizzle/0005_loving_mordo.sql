CREATE TABLE `scan_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`type_id` text DEFAULT '' NOT NULL,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`image` text DEFAULT '' NOT NULL,
	`values` text,
	`error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
