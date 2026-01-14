ALTER TABLE `nouns` ADD `replica_regions` text;--> statement-breakpoint
ALTER TABLE `nouns` ADD `consistency_mode` text DEFAULT 'eventual';--> statement-breakpoint
ALTER TABLE `nouns` ADD `replica_binding` text;