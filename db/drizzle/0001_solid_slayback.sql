ALTER TABLE `nouns` ADD `sharded` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `nouns` ADD `shard_count` integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE `nouns` ADD `shard_key` text;--> statement-breakpoint
ALTER TABLE `nouns` ADD `storage` text DEFAULT 'hot';--> statement-breakpoint
ALTER TABLE `nouns` ADD `ttl_days` integer;--> statement-breakpoint
ALTER TABLE `nouns` ADD `indexed_fields` text;--> statement-breakpoint
ALTER TABLE `nouns` ADD `ns_strategy` text DEFAULT 'tenant';