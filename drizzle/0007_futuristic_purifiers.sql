CREATE TABLE `data_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`host` text DEFAULT '' NOT NULL,
	`port` text DEFAULT '' NOT NULL,
	`database` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '正常' NOT NULL,
	`last_sync_at` text DEFAULT '' NOT NULL,
	`table_count` integer DEFAULT 0 NOT NULL,
	`owner_id` text DEFAULT '' NOT NULL,
	`space_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dataset_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type_id` text DEFAULT '' NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`space_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repo_files` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`lang` text DEFAULT 'typescript' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`branch` text DEFAULT 'main' NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	`space_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
