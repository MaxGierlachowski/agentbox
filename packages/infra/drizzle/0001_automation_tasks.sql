CREATE TABLE `automation_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`project_id` text NOT NULL,
	`project_identifier` text NOT NULL,
	`repo` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer NOT NULL,
	`session_id` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `automation_tasks_started_idx` ON `automation_tasks` (`started_at`);