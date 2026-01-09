-- ============================================================================
-- THINGS PIPELINE - Thing versions for cross-DO queries
-- ============================================================================
--
-- Streams thing versions from DOs to R2 SQL for global queryability.
-- Each row represents a version of a thing.
--
-- ============================================================================
-- PARTITION STRATEGY: (ns, type, visibility)
-- ============================================================================
--
-- Partition Order Rationale:
--   1. ns (namespace)   - Primary: Tenant isolation at storage level
--   2. type             - Secondary: Resource type filtering
--   3. visibility       - Tertiary: Access control pruning
--
-- This order optimizes for:
--   - Multi-tenant data isolation (ns first)
--   - Type-based queries within namespace (type second)
--   - Visibility-based manifest pruning (visibility third)
--
-- Manifest Pruning:
--   Each manifest contains partition summaries with min/max bounds.
--   The Iceberg reader checks visibility bounds to skip manifests:
--   - Public queries skip manifests with only user/org data
--   - Private queries skip manifests with only public data
--   - Unlisted data is excluded from general listings
--
-- See: streams/partitions.md for full partition strategy documentation
--
-- ============================================================================
-- VISIBILITY VALUES
-- ============================================================================
--
--   'public'   - Visible to everyone (including anonymous)
--   'unlisted' - Not discoverable, accessible with direct link
--   'org'      - Visible to organization members only
--   'user'     - Visible only to the owner (default)
--
-- ============================================================================
-- SCHEMA MAPPING
-- ============================================================================
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
--   visibility: 'user' | 'org' | 'unlisted' | 'public'
--
-- Output (to R2 Iceberg):
--   id: 'https://startups.studio/acme'           (qualified)
--   type: 'https://startups.studio/Startup'      (qualified)
--   version: 123
--   branch: 'main'
--   name: 'Acme Corp'
--   data: { ... }
--   deleted: false
--   action_id: 'uuid'
--   timestamp: '2024-01-08T12:00:00Z'
--   ns: 'https://startups.studio'                (partition key 1)
--   visibility: 'user'                           (partition key 3)
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
