-- ============================================================================
-- THINGS PIPELINE - Thing versions for cross-DO queries
-- ============================================================================
--
-- Streams thing versions from DOs to R2 SQL for global queryability.
-- Each row represents a version of a thing.
--
-- Visibility is used for partition pruning in Iceberg queries.
-- This enables efficient multi-tenant data isolation.
--
-- Input (from DO):
--   ns: 'https://startups.studio'
--   id: 'acme'
--   type: 'Startup'
--   version: 123
--   branch: 'main'
--   name: 'Acme Corp'
--   data: { ... }
--   deleted: false
--   actionId: 'uuid'
--   timestamp: '2024-01-08T12:00:00Z'
--   visibility: 'user' | 'team' | 'public' (defaults to 'user' if not provided)
--
-- Output (to R2 Iceberg):
--   id: 'https://startups.studio/acme'
--   type: 'https://startups.studio/Startup'
--   version: 123
--   branch: 'main'
--   name: 'Acme Corp'
--   data: { ... }
--   deleted: false
--   action_id: 'uuid'
--   timestamp: '2024-01-08T12:00:00Z'
--   ns: 'https://startups.studio'
--   visibility: 'user' (partition column for multi-tenant isolation)
--
-- ============================================================================

INSERT INTO do_things
SELECT
  CONCAT(ns, '/', id) AS id,
  CONCAT(ns, '/', type) AS type,
  version,
  COALESCE(branch, 'main') AS branch,
  name,
  data,
  deleted,
  actionId AS action_id,
  timestamp,
  ns,
  COALESCE(visibility, 'user') AS visibility
FROM things_stream
