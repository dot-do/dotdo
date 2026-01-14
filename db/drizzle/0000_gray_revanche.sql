CREATE TABLE `nouns` (
	`noun` text PRIMARY KEY NOT NULL,
	`plural` text,
	`description` text,
	`schema` text,
	`do_class` text
);
--> statement-breakpoint
CREATE TABLE `verbs` (
	`verb` text PRIMARY KEY NOT NULL,
	`action` text,
	`activity` text,
	`event` text,
	`reverse` text,
	`inverse` text,
	`description` text
);
--> statement-breakpoint
CREATE TABLE `things` (
	`id` text NOT NULL,
	`type` integer NOT NULL,
	`branch` text,
	`name` text,
	`data` text,
	`deleted` integer DEFAULT false,
	`visibility` text DEFAULT 'user'
);
--> statement-breakpoint
CREATE INDEX `things_id_idx` ON `things` (`id`);--> statement-breakpoint
CREATE INDEX `things_type_idx` ON `things` (`type`);--> statement-breakpoint
CREATE INDEX `things_branch_idx` ON `things` (`branch`);--> statement-breakpoint
CREATE INDEX `things_id_branch_idx` ON `things` (`id`,`branch`);--> statement-breakpoint
CREATE INDEX `things_visibility_idx` ON `things` (`visibility`);--> statement-breakpoint
CREATE INDEX `things_visibility_type_idx` ON `things` (`visibility`,`type`);--> statement-breakpoint
CREATE INDEX `things_type_visibility_idx` ON `things` (`type`,`visibility`);--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`verb` text NOT NULL,
	`from` text NOT NULL,
	`to` text NOT NULL,
	`data` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rel_verb_idx` ON `relationships` (`verb`);--> statement-breakpoint
CREATE INDEX `rel_from_idx` ON `relationships` (`from`);--> statement-breakpoint
CREATE INDEX `rel_to_idx` ON `relationships` (`to`);--> statement-breakpoint
CREATE INDEX `rel_from_verb_idx` ON `relationships` (`from`,`verb`);--> statement-breakpoint
CREATE INDEX `rel_to_verb_idx` ON `relationships` (`to`,`verb`);--> statement-breakpoint
CREATE UNIQUE INDEX `rel_unique_idx` ON `relationships` (`verb`,`from`,`to`);--> statement-breakpoint
CREATE TABLE `objects` (
	`ns` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`class` text NOT NULL,
	`relation` text,
	`shard_key` text,
	`shard_index` integer,
	`region` text,
	`primary` integer,
	`cached` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `obj_id_idx` ON `objects` (`id`);--> statement-breakpoint
CREATE INDEX `obj_relation_idx` ON `objects` (`relation`);--> statement-breakpoint
CREATE INDEX `obj_shard_idx` ON `objects` (`shard_key`,`shard_index`);--> statement-breakpoint
CREATE INDEX `obj_region_idx` ON `objects` (`region`);--> statement-breakpoint
CREATE TABLE `actions` (
	`id` text NOT NULL,
	`verb` text NOT NULL,
	`actor` text,
	`target` text NOT NULL,
	`input` integer,
	`output` integer,
	`options` text,
	`durability` text DEFAULT 'try' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`request_id` text,
	`session_id` text,
	`workflow_id` text,
	`started_at` integer,
	`completed_at` integer,
	`duration` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actions_id_unique` ON `actions` (`id`);--> statement-breakpoint
CREATE INDEX `actions_verb_idx` ON `actions` (`verb`);--> statement-breakpoint
CREATE INDEX `actions_target_idx` ON `actions` (`target`);--> statement-breakpoint
CREATE INDEX `actions_actor_idx` ON `actions` (`actor`);--> statement-breakpoint
CREATE INDEX `actions_status_idx` ON `actions` (`status`);--> statement-breakpoint
CREATE INDEX `actions_request_idx` ON `actions` (`request_id`);--> statement-breakpoint
CREATE INDEX `actions_created_idx` ON `actions` (`created_at`);--> statement-breakpoint
CREATE INDEX `actions_output_idx` ON `actions` (`output`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`verb` text NOT NULL,
	`source` text NOT NULL,
	`data` text NOT NULL,
	`action_id` text,
	`sequence` integer NOT NULL,
	`streamed` integer DEFAULT false,
	`streamed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`action_id`) REFERENCES `actions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_verb_idx` ON `events` (`verb`);--> statement-breakpoint
CREATE INDEX `events_source_idx` ON `events` (`source`);--> statement-breakpoint
CREATE INDEX `events_source_verb_idx` ON `events` (`source`,`verb`);--> statement-breakpoint
CREATE INDEX `events_sequence_idx` ON `events` (`sequence`);--> statement-breakpoint
CREATE INDEX `events_streamed_idx` ON `events` (`streamed`);--> statement-breakpoint
CREATE TABLE `search` (
	`$id` text PRIMARY KEY NOT NULL,
	`$type` text NOT NULL,
	`content` text NOT NULL,
	`embedding` blob,
	`embedding_dim` integer,
	`cluster` integer,
	`lsh1` text,
	`lsh2` text,
	`lsh3` text,
	`semantic_l1` text,
	`semantic_l2` text,
	`semantic_l3` text,
	`indexed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `search_type_idx` ON `search` (`$type`);--> statement-breakpoint
CREATE INDEX `search_cluster_idx` ON `search` (`cluster`);--> statement-breakpoint
CREATE INDEX `search_semantic_idx` ON `search` (`semantic_l1`,`semantic_l2`);--> statement-breakpoint
CREATE TABLE `branches` (
	`name` text NOT NULL,
	`thing_id` text NOT NULL,
	`head` integer NOT NULL,
	`base` integer,
	`forked_from` text,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_thing_name_idx` ON `branches` (`thing_id`,`name`);--> statement-breakpoint
CREATE INDEX `branches_name_idx` ON `branches` (`name`);--> statement-breakpoint
CREATE INDEX `branches_thing_idx` ON `branches` (`thing_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`path` text NOT NULL,
	`parent` integer,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`hash` text,
	`size` integer,
	`mode` integer,
	`link_target` text,
	`tier` text,
	`ns` text,
	`branch` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_path_ns_branch_idx` ON `files` (`path`,`ns`,`branch`);--> statement-breakpoint
CREATE INDEX `files_parent_idx` ON `files` (`parent`);--> statement-breakpoint
CREATE INDEX `files_name_idx` ON `files` (`name`);--> statement-breakpoint
CREATE INDEX `files_hash_idx` ON `files` (`hash`);--> statement-breakpoint
CREATE INDEX `files_type_idx` ON `files` (`type`);--> statement-breakpoint
CREATE INDEX `files_ns_idx` ON `files` (`ns`);--> statement-breakpoint
CREATE INDEX `files_ns_branch_idx` ON `files` (`ns`,`branch`);--> statement-breakpoint
CREATE TABLE `git` (
	`ns` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`commit` text,
	`branch_patterns` text,
	`sync_mode` text DEFAULT 'pull',
	`content_patterns` text DEFAULT '*',
	`last_sync_at` integer,
	`sync_status` text DEFAULT 'pending',
	`sync_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `git_repo_idx` ON `git` (`repo`);--> statement-breakpoint
CREATE INDEX `git_repo_path_idx` ON `git` (`repo`,`path`);--> statement-breakpoint
CREATE INDEX `git_commit_idx` ON `git` (`commit`);--> statement-breakpoint
CREATE INDEX `git_sync_status_idx` ON `git` (`sync_status`);--> statement-breakpoint
CREATE TABLE `git_branches` (
	`id` text PRIMARY KEY NOT NULL,
	`binding_ns` text NOT NULL,
	`branch` text NOT NULL,
	`branch_ns` text,
	`commit` text,
	`is_default` integer DEFAULT false,
	`status` text DEFAULT 'active',
	`created_at` integer NOT NULL,
	`merged_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `git_branch_unique_idx` ON `git_branches` (`binding_ns`,`branch`);--> statement-breakpoint
CREATE INDEX `git_branch_ns_idx` ON `git_branches` (`branch_ns`);--> statement-breakpoint
CREATE INDEX `git_branch_status_idx` ON `git_branches` (`status`);--> statement-breakpoint
CREATE TABLE `git_content` (
	`binding_ns` text NOT NULL,
	`file` integer NOT NULL,
	`thing` integer NOT NULL,
	`blob_sha` text,
	`commit` text,
	`sync_direction` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `git_content_file_idx` ON `git_content` (`binding_ns`,`file`);--> statement-breakpoint
CREATE INDEX `git_content_thing_idx` ON `git_content` (`thing`);--> statement-breakpoint
CREATE INDEX `git_content_blob_idx` ON `git_content` (`blob_sha`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `accounts_provider_idx` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`key` text NOT NULL,
	`user_id` text NOT NULL,
	`prefix` text,
	`start` text,
	`rate_limit_enabled` integer,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer DEFAULT 0,
	`last_request` integer,
	`remaining` integer,
	`last_refill_at` integer,
	`refill_interval` integer,
	`refill_amount` integer,
	`expires_at` integer,
	`enabled` integer DEFAULT true,
	`permissions` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `api_keys_prefix_idx` ON `api_keys` (`prefix`);--> statement-breakpoint
CREATE TABLE `custom_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`organization_id` text NOT NULL,
	`tenant_ns` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`verification_token` text,
	`verification_method` text DEFAULT 'dns_txt',
	`ssl_status` text DEFAULT 'pending',
	`created_at` integer NOT NULL,
	`verified_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_domains_domain_unique` ON `custom_domains` (`domain`);--> statement-breakpoint
CREATE INDEX `custom_domains_domain_idx` ON `custom_domains` (`domain`);--> statement-breakpoint
CREATE INDEX `custom_domains_org_idx` ON `custom_domains` (`organization_id`);--> statement-breakpoint
CREATE INDEX `custom_domains_tenant_idx` ON `custom_domains` (`tenant_ns`);--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text DEFAULT 'human' NOT NULL,
	`handle` text NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`bio` text,
	`status` text DEFAULT 'active' NOT NULL,
	`agent_type` text,
	`owner_id` text,
	`capabilities` text,
	`model_id` text,
	`service_type` text,
	`endpoint` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identities_handle_unique` ON `identities` (`handle`);--> statement-breakpoint
CREATE INDEX `identities_user_idx` ON `identities` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `identities_handle_idx` ON `identities` (`handle`);--> statement-breakpoint
CREATE INDEX `identities_type_idx` ON `identities` (`type`);--> statement-breakpoint
CREATE INDEX `identities_owner_idx` ON `identities` (`owner_id`);--> statement-breakpoint
CREATE INDEX `identities_status_idx` ON `identities` (`status`);--> statement-breakpoint
CREATE INDEX `identities_type_owner_idx` ON `identities` (`type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`inviter_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`team_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`inviter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitations_email_idx` ON `invitations` (`email`);--> statement-breakpoint
CREATE INDEX `invitations_org_idx` ON `invitations` (`organization_id`);--> statement-breakpoint
CREATE TABLE `linked_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`vault_ref` text,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `linked_accounts_identity_idx` ON `linked_accounts` (`identity_id`);--> statement-breakpoint
CREATE INDEX `linked_accounts_type_idx` ON `linked_accounts` (`type`);--> statement-breakpoint
CREATE INDEX `linked_accounts_status_idx` ON `linked_accounts` (`status`);--> statement-breakpoint
CREATE INDEX `linked_accounts_identity_provider_idx` ON `linked_accounts` (`identity_id`,`provider`);--> statement-breakpoint
CREATE INDEX `linked_accounts_provider_idx` ON `linked_accounts` (`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `linked_accounts_unique_idx` ON `linked_accounts` (`identity_id`,`provider`,`provider_account_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `members_user_idx` ON `members` (`user_id`);--> statement-breakpoint
CREATE INDEX `members_org_idx` ON `members` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_user_org_idx` ON `members` (`user_id`,`organization_id`);--> statement-breakpoint
CREATE TABLE `oauth_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`session_id` text,
	`refresh_id` text,
	`organization_id` text,
	`scopes` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_client_idx` ON `oauth_access_tokens` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_user_idx` ON `oauth_access_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_authorization_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`scopes` text,
	`code_challenge` text,
	`code_challenge_method` text,
	`state` text,
	`nonce` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_authorization_codes_code_unique` ON `oauth_authorization_codes` (`code`);--> statement-breakpoint
CREATE INDEX `oauth_auth_codes_client_idx` ON `oauth_authorization_codes` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_auth_codes_code_idx` ON `oauth_authorization_codes` (`code`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text,
	`name` text,
	`uri` text,
	`icon` text,
	`redirect_uris` text,
	`scopes` text,
	`grant_types` text,
	`response_types` text,
	`token_endpoint_auth_method` text,
	`type` text,
	`public` integer DEFAULT false,
	`disabled` integer DEFAULT false,
	`skip_consent` integer DEFAULT false,
	`user_id` text,
	`organization_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_clients_client_id_unique` ON `oauth_clients` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_clients_client_id_idx` ON `oauth_clients` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_clients_user_idx` ON `oauth_clients` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`organization_id` text,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `oauth_consents_user_idx` ON `oauth_consents` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_consents_client_idx` ON `oauth_consents` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_consents_user_client_idx` ON `oauth_consents` (`user_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `oauth_refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`organization_id` text,
	`scopes` text,
	`revoked` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_client_idx` ON `oauth_refresh_tokens` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_user_idx` ON `oauth_refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`metadata` text,
	`tenant_ns` text,
	`region` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE INDEX `organizations_slug_idx` ON `organizations` (`slug`);--> statement-breakpoint
CREATE INDEX `organizations_tenant_idx` ON `organizations` (`tenant_ns`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`active_organization_id` text,
	`active_team_id` text,
	`impersonated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_token_idx` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_org_idx` ON `sessions` (`active_organization_id`);--> statement-breakpoint
CREATE TABLE `sso_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`issuer` text NOT NULL,
	`domain` text NOT NULL,
	`organization_id` text,
	`oidc_config` text,
	`saml_config` text,
	`mapping` text,
	`domain_verified` integer DEFAULT false,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sso_providers_provider_id_unique` ON `sso_providers` (`provider_id`);--> statement-breakpoint
CREATE INDEX `sso_providers_domain_idx` ON `sso_providers` (`domain`);--> statement-breakpoint
CREATE INDEX `sso_providers_org_idx` ON `sso_providers` (`organization_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`reference_id` text NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`status` text DEFAULT 'incomplete' NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`cancel_at_period_end` integer DEFAULT false,
	`cancel_at` integer,
	`canceled_at` integer,
	`ended_at` integer,
	`seats` integer,
	`trial_start` integer,
	`trial_end` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `subscriptions_reference_idx` ON `subscriptions` (`reference_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_stripe_customer_idx` ON `subscriptions` (`stripe_customer_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_stripe_sub_idx` ON `subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_members_team_idx` ON `team_members` (`team_id`);--> statement-breakpoint
CREATE INDEX `team_members_user_idx` ON `team_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_team_user_idx` ON `team_members` (`team_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organization_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `teams_org_idx` ON `teams` (`organization_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'user',
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer,
	`stripe_customer_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_stripe_customer_idx` ON `users` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `exec` (
	`id` text PRIMARY KEY NOT NULL,
	`command` text NOT NULL,
	`args` text,
	`cwd` text,
	`env` text,
	`exit_code` integer,
	`stdout` text,
	`stderr` text,
	`started_at` integer,
	`completed_at` integer,
	`duration_ms` integer,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exec_status_idx` ON `exec` (`status`);--> statement-breakpoint
CREATE INDEX `exec_command_idx` ON `exec` (`command`);--> statement-breakpoint
CREATE INDEX `exec_started_at_idx` ON `exec` (`started_at`);--> statement-breakpoint
CREATE TABLE `dlq` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`verb` text NOT NULL,
	`source` text NOT NULL,
	`data` text NOT NULL,
	`error` text NOT NULL,
	`error_stack` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`last_attempt_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dlq_verb_idx` ON `dlq` (`verb`);--> statement-breakpoint
CREATE INDEX `dlq_source_idx` ON `dlq` (`source`);--> statement-breakpoint
CREATE INDEX `dlq_retry_count_idx` ON `dlq` (`retry_count`);--> statement-breakpoint
CREATE INDEX `dlq_event_id_idx` ON `dlq` (`event_id`);--> statement-breakpoint
CREATE TABLE `flags` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`traffic` real NOT NULL,
	`stickiness` text NOT NULL,
	`status` text NOT NULL,
	`branches` text NOT NULL,
	`filters` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `flags_key_idx` ON `flags` (`key`);--> statement-breakpoint
CREATE INDEX `flags_status_idx` ON `flags` (`status`);--> statement-breakpoint
CREATE TABLE `vault_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`metadata` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vault_credentials_user_idx` ON `vault_credentials` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vault_credentials_user_key_idx` ON `vault_credentials` (`user_id`,`key`);--> statement-breakpoint
CREATE INDEX `vault_credentials_expires_idx` ON `vault_credentials` (`expires_at`);--> statement-breakpoint
CREATE TABLE `vault_oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`code_verifier` text,
	`config` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vault_oauth_states_expires_idx` ON `vault_oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `vault_oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`token_type` text DEFAULT 'Bearer' NOT NULL,
	`scope` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vault_oauth_tokens_user_idx` ON `vault_oauth_tokens` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vault_oauth_tokens_user_provider_idx` ON `vault_oauth_tokens` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `vault_oauth_tokens_expires_idx` ON `vault_oauth_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `account_types` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`description` text,
	`providers` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`display_order` integer DEFAULT 0,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_types_slug_unique` ON `account_types` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_types_slug_idx` ON `account_types` (`slug`);--> statement-breakpoint
CREATE INDEX `account_types_enabled_idx` ON `account_types` (`enabled`);--> statement-breakpoint
CREATE INDEX `account_types_order_idx` ON `account_types` (`display_order`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`category` text,
	`icon` text,
	`description` text,
	`base_url` text,
	`api_version` text,
	`oauth_config` text,
	`webhook_config` text,
	`actions` text,
	`rate_limit` text,
	`docs_url` text,
	`enabled` integer DEFAULT true NOT NULL,
	`official` integer DEFAULT false,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providers_slug_unique` ON `providers` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `providers_slug_idx` ON `providers` (`slug`);--> statement-breakpoint
CREATE INDEX `providers_type_idx` ON `providers` (`type`);--> statement-breakpoint
CREATE INDEX `providers_category_idx` ON `providers` (`category`);--> statement-breakpoint
CREATE INDEX `providers_enabled_idx` ON `providers` (`enabled`);