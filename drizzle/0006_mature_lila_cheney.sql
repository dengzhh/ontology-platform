CREATE TABLE `scan_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`type_id` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`scene` text DEFAULT 'general' NOT NULL,
	`extra_prompt` text DEFAULT '' NOT NULL,
	`field_mapping` text DEFAULT '{}' NOT NULL,
	`match_keywords` text DEFAULT '[]' NOT NULL,
	`owner_id` text DEFAULT '' NOT NULL,
	`space_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
