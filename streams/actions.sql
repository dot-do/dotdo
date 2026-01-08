-- ============================================================================
-- ACTIONS PIPELINE - Audit log for SOC2 compliance
-- ============================================================================
--
-- Streams all actions for complete audit trail.
-- Must be complete and immutable - no gaps allowed.
--
-- Input (from DO):
--   ns: 'https://startups.studio'
--   id: 'uuid'
--   verb: 'create'
--   actor: 'Human/nathan'
--   target: 'Startup/acme'
--   inputVersion: 122
--   outputVersion: 123
--   durability: 'do'
--   status: 'completed'
--   error: null
--   requestId: 'req-123'
--   sessionId: 'sess-456'
--   workflowId: 'wf-789'
--   startedAt: '2024-01-08T11:59:59Z'
--   completedAt: '2024-01-08T12:00:00Z'
--   duration: 1000
--   timestamp: '2024-01-08T12:00:00Z'
--
-- Output (to R2 Iceberg):
--   id: 'uuid'
--   verb: 'create'
--   actor: 'https://startups.studio/Human/nathan'
--   target: 'https://startups.studio/Startup/acme'
--   input_version: 122
--   output_version: 123
--   durability: 'do'
--   status: 'completed'
--   error: null
--   request_id: 'req-123'
--   session_id: 'sess-456'
--   workflow_id: 'wf-789'
--   started_at: '2024-01-08T11:59:59Z'
--   completed_at: '2024-01-08T12:00:00Z'
--   duration_ms: 1000
--   timestamp: '2024-01-08T12:00:00Z'
--   ns: 'https://startups.studio'
--
-- ============================================================================

INSERT INTO do_actions
SELECT
  id,
  verb,
  CASE
    WHEN actor LIKE 'http%' THEN actor
    ELSE CONCAT(ns, '/', actor)
  END AS actor,
  CONCAT(ns, '/', target) AS target,
  inputVersion AS input_version,
  outputVersion AS output_version,
  durability,
  status,
  error,
  requestId AS request_id,
  sessionId AS session_id,
  workflowId AS workflow_id,
  startedAt AS started_at,
  completedAt AS completed_at,
  duration AS duration_ms,
  timestamp,
  ns
FROM actions_stream
WHERE status IN ('completed', 'failed')  -- Only log terminal states
