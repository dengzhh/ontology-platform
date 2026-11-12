CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`link` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '待发送' NOT NULL,
	`created_at` integer NOT NULL,
	`activated_at` integer,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
