CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `login_links` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `provider_state` (
	`workspace` text NOT NULL,
	`provider` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace`, `provider`, `key`)
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`run_id`, `seq`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`plan_hash` text,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `runs_started_at_idx` ON `runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
