CREATE TABLE `action_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`action_type_id` text NOT NULL,
	`object_id` text DEFAULT '' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'done' NOT NULL,
	`result` text,
	`actor` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `action_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_type_id` text NOT NULL,
	`params` text DEFAULT '[]' NOT NULL,
	`effect` text DEFAULT '{"kind":"update","setValues":{}}' NOT NULL,
	`needs_approval` integer DEFAULT 0 NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_type_id`) REFERENCES `object_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '新对话' NOT NULL,
	`scene` text DEFAULT 'assist' NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`cites` text,
	`tool_calls` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT '动作执行' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`requester` text NOT NULL,
	`risk` text DEFAULT '中' NOT NULL,
	`status` text DEFAULT '待审批' NOT NULL,
	`decided_by` text DEFAULT '' NOT NULL,
	`decided_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`detail` text,
	`result` text DEFAULT '成功' NOT NULL,
	`ip` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `automation_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL,
	`condition` text DEFAULT '' NOT NULL,
	`actions` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`last_triggered_at` integer,
	`owner` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `doc_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`idx` integer NOT NULL,
	`text` text NOT NULL,
	`embedding` text DEFAULT '' NOT NULL,
	`dim` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `doc_links` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`object_id` text NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`object_id`) REFERENCES `objects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text DEFAULT 'SOP' NOT NULL,
	`format` text DEFAULT 'PDF' NOT NULL,
	`size` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '解析中' NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `extract_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT '待审核' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `user_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `link_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_type_id` text NOT NULL,
	`target_type_id` text NOT NULL,
	`cardinality` text DEFAULT '1:N' NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_type_id`) REFERENCES `object_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_type_id`) REFERENCES `object_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`tag` text DEFAULT '系统' NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `object_links` (
	`id` text PRIMARY KEY NOT NULL,
	`link_type_id` text NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`link_type_id`) REFERENCES `link_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `objects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `objects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `object_types` (
	`id` text PRIMARY KEY NOT NULL,
	`api_name` text NOT NULL,
	`name` text NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#3b82f6' NOT NULL,
	`icon` text DEFAULT 'Box' NOT NULL,
	`primary_key` text DEFAULT 'id' NOT NULL,
	`properties` text DEFAULT '[]' NOT NULL,
	`view_template` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `objects` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`values` text DEFAULT '{}' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `object_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ontology_functions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`lang` text DEFAULT 'TypeScript' NOT NULL,
	`linked_type_ids` text DEFAULT '[]' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`apps` text DEFAULT '[]' NOT NULL,
	`object_perms` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ts_points` (
	`id` text PRIMARY KEY NOT NULL,
	`metric` text NOT NULL,
	`object_id` text DEFAULT '' NOT NULL,
	`t` integer NOT NULL,
	`value` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ts_points_metric_obj_t` ON `ts_points` (`metric`,`object_id`,`t`);--> statement-breakpoint
CREATE TABLE `user_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`default_app` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`account` text NOT NULL,
	`password_hash` text NOT NULL,
	`dept` text DEFAULT '' NOT NULL,
	`role_id` text NOT NULL,
	`markings` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT '在职' NOT NULL,
	`last_login_at` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_account_unique` ON `users` (`account`);--> statement-breakpoint
CREATE TABLE `workshop_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`widgets` text DEFAULT '[]' NOT NULL,
	`variables` text DEFAULT '[]' NOT NULL,
	`owner_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
