CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`state` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`date` text,
	`time` text,
	`duration` integer DEFAULT 60 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_period` ON `events` (`tenant`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_source` ON `events` (`tenant`,`source_id`);--> statement-breakpoint
CREATE TABLE `exchanges` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`conversation` text NOT NULL,
	`input` text NOT NULL,
	`revision` integer NOT NULL,
	`response` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exchanges_conversation` ON `exchanges` (`tenant`,`conversation`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_revision` ON `exchanges` (`tenant`,`conversation`,`revision`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`seeded` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
