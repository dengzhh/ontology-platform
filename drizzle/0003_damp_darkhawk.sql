CREATE TABLE `space_members` (
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	PRIMARY KEY(`space_id`, `user_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'org' NOT NULL,
	`owner_id` text NOT NULL,
	`template_pack` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `action_types` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_rules` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `doc_chunks` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `doc_links` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `extract_candidates` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `link_types` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `object_links` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `object_types` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `objects` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `ontology_functions` ADD `space_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workshop_apps` ADD `space_id` text DEFAULT '' NOT NULL;