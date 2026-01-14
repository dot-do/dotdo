-- ============================================================================
-- EVENTS PIPELINE - Domain events for analytics
-- ============================================================================
--
-- Transforms local DO events into globally-queryable R2 SQL rows.
-- Prepends namespace (ns) to create fully qualified URLs.
--
-- Input (from DO):
--   ns: 'https://startups.studio'
--   verb: 'created'
--   source: 'Startup/acme'
--   sourceType: 'Startup'
--   data: { ... }
--   actionId: 'uuid'
--   timestamp: '2024-01-08T12:00:00Z'
--
-- Output (to R2 Iceberg):
--   verb: 'created'
--   source: 'https://startups.studio/Startup/acme'
--   source_type: 'https://startups.studio/Startup'
--   data: { ... }
--   action_id: 'uuid'
--   timestamp: '2024-01-08T12:00:00Z'
--   ns: 'https://startups.studio'
--
-- ============================================================================

INSERT INTO do_events
SELECT
  verb,
  CONCAT(ns, '/', source) AS source,
  CONCAT(ns, '/', sourceType) AS source_type,
  data,
  actionId AS action_id,
  timestamp,
  ns
FROM events_stream
