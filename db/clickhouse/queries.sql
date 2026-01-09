-- ============================================================================
-- COMMON QUERY PATTERNS FOR DOTDO CLICKHOUSE SCHEMA
-- ============================================================================
--
-- Reference queries for the 80% use cases.
--
-- ============================================================================


-- ============================================================================
-- THE 80% QUERY: Thing + Relationships + References
-- ============================================================================

-- Get a Thing with its outbound relationships (embedded) and inbound references
WITH
    'https://startups.studio/headless.ly' AS target_url,

    -- Get the Thing
    thing AS (
        SELECT *
        FROM Things FINAL
        WHERE url = target_url
          AND (visibility IS NULL OR visibility != 'deleted')
        LIMIT 1
    ),

    -- Get inbound references grouped by reverse verb
    refs AS (
        SELECT
            reverse,
            groupArray(from) AS sources
        FROM Relationships FINAL
        WHERE to = target_url
          AND (visibility IS NULL OR visibility != 'deleted')
        GROUP BY reverse
    )

SELECT
    t.*,
    -- Transform refs to map: { 'managedBy': [...], 'ownedBy': [...] }
    toJSONString(map(
        arrayMap(r -> r.1, groupArray((refs.reverse, refs.sources))),
        arrayMap(r -> r.2, groupArray((refs.reverse, refs.sources)))
    )) AS references
FROM thing t
LEFT JOIN refs ON 1=1;


-- ============================================================================
-- THING QUERIES
-- ============================================================================

-- Get latest version of a Thing by URL
SELECT *
FROM Things FINAL
WHERE url = 'https://startups.studio/headless.ly'
  AND (visibility IS NULL OR visibility != 'deleted')
LIMIT 1;

-- Get Thing by ns/type/id
SELECT *
FROM Things FINAL
WHERE ns = 'https://startups.studio'
  AND type = 'Startup'
  AND id = 'headless.ly'
  AND branch = 'main'
  AND (visibility IS NULL OR visibility != 'deleted')
LIMIT 1;

-- Get Thing history (all versions)
SELECT *
FROM Things
WHERE url = 'https://startups.studio/headless.ly'
ORDER BY ts DESC;

-- Get Things by type within namespace
SELECT *
FROM Things FINAL
WHERE ns = 'https://startups.studio'
  AND type = 'Startup'
  AND (visibility IS NULL OR visibility != 'deleted')
ORDER BY name;

-- Get Things modified by specific actor
SELECT *
FROM Things FINAL
WHERE sqidDecode(sqids.actor)[1] = 11  -- TAG_ACTOR
  AND sqidDecode(sqids.actor)[2] = 42  -- actor ID
ORDER BY ts DESC;

-- Get Things in specific experiment
SELECT *
FROM Things FINAL
WHERE sqids.context IS NOT NULL
  AND sqidDecode(sqids.context)[1] = 31  -- TAG_EXPERIMENT
  AND sqidDecode(sqids.context)[2] = 123  -- experiment ID
ORDER BY ts DESC;


-- ============================================================================
-- RELATIONSHIP QUERIES
-- ============================================================================

-- Get all references TO a URL (inbound edges)
SELECT
    reverse,
    from,
    fromType,
    verb,
    data
FROM Relationships FINAL
WHERE to = 'https://startups.studio/headless.ly'
  AND (visibility IS NULL OR visibility != 'deleted')
ORDER BY reverse, ts DESC;

-- Get references grouped by reverse verb (for API response)
SELECT
    reverse,
    if(length(groupArray(from)) = 1,
       groupArray(from)[1],
       groupArray(from)) AS sources
FROM Relationships FINAL
WHERE to = 'https://startups.studio/headless.ly'
  AND (visibility IS NULL OR visibility != 'deleted')
GROUP BY reverse;

-- Get all relationships FROM a URL (if not using embedded)
SELECT *
FROM Relationships FINAL
WHERE from = 'https://startups.studio/headless.ly'
  AND (visibility IS NULL OR visibility != 'deleted');


-- ============================================================================
-- ACTION QUERIES
-- ============================================================================

-- Get action history for a target
SELECT *
FROM Actions
WHERE target = 'Startup/acme'
  AND ns = 'https://startups.studio'
ORDER BY ts DESC
LIMIT 100;

-- Get failed actions for debugging
SELECT *
FROM Actions
WHERE status = 'failed'
  AND ns = 'https://startups.studio'
ORDER BY ts DESC
LIMIT 100;

-- Get actions by actor
SELECT *
FROM Actions
WHERE actor = 'Human/nathan'
ORDER BY ts DESC
LIMIT 100;

-- Get action latency percentiles
SELECT
    verb,
    count() AS count,
    quantile(0.5)(duration) AS p50_ms,
    quantile(0.95)(duration) AS p95_ms,
    quantile(0.99)(duration) AS p99_ms
FROM Actions
WHERE status = 'completed'
  AND ts > toUnixTimestamp64Milli(now() - INTERVAL 1 DAY)
GROUP BY verb
ORDER BY count DESC;


-- ============================================================================
-- EVENT QUERIES
-- ============================================================================

-- Get events in time order
SELECT *
FROM Events
WHERE ns = 'https://startups.studio'
  AND ts > toUnixTimestamp64Milli(now() - INTERVAL 1 HOUR)
ORDER BY ts, sequence
LIMIT 1000;

-- Get events by type
SELECT *
FROM Events
WHERE type = 'CustomerCreated'
  AND ns = 'https://startups.studio'
ORDER BY ts DESC
LIMIT 100;

-- Event counts by type over time (for dashboards)
SELECT
    toStartOfHour(fromUnixTimestamp64Milli(ts)) AS hour,
    type,
    count() AS count
FROM Events
WHERE ts > toUnixTimestamp64Milli(now() - INTERVAL 24 HOUR)
GROUP BY hour, type
ORDER BY hour, count DESC;


-- ============================================================================
-- SEARCH QUERIES
-- ============================================================================

-- Vector similarity search
SELECT
    url,
    type,
    id,
    content,
    cosineDistance(embedding, [/* query vector */]) AS distance
FROM Search
WHERE ns = 'https://startups.studio'
ORDER BY distance ASC
LIMIT 10;

-- Full-text search
SELECT
    url,
    type,
    id,
    content
FROM Search
WHERE ns = 'https://startups.studio'
  AND hasToken(content, 'keyword')
ORDER BY ts DESC
LIMIT 10;

-- Hybrid search (vector + FTS)
SELECT
    url,
    type,
    id,
    content,
    cosineDistance(embedding, [/* query vector */]) AS vector_score
FROM Search
WHERE ns = 'https://startups.studio'
  AND hasToken(content, 'keyword')  -- Pre-filter with FTS
ORDER BY vector_score ASC
LIMIT 10;

-- Get all chunks for a Thing
SELECT *
FROM Search
WHERE url = 'https://startups.studio/headless.ly'
ORDER BY chunkIndex;


-- ============================================================================
-- ANALYTICS QUERIES
-- ============================================================================

-- Active Things by namespace
SELECT
    ns,
    type,
    count() AS count
FROM Things FINAL
WHERE visibility IS NULL OR visibility = 'public'
GROUP BY ns, type
ORDER BY count DESC;

-- Relationship density
SELECT
    toType,
    reverse,
    count() AS count
FROM Relationships FINAL
WHERE visibility IS NULL OR visibility != 'deleted'
GROUP BY toType, reverse
ORDER BY count DESC
LIMIT 20;

-- Action success rate by verb
SELECT
    verb,
    countIf(status = 'completed') AS success,
    countIf(status = 'failed') AS failed,
    round(success / (success + failed) * 100, 2) AS success_rate
FROM Actions
WHERE ts > toUnixTimestamp64Milli(now() - INTERVAL 7 DAY)
GROUP BY verb
ORDER BY success + failed DESC;

-- Experiment variant distribution
SELECT
    sqidDecode(sqids.context)[2] AS experiment_id,
    sqidDecode(sqids.context)[4] AS variant_id,
    count() AS count
FROM Things FINAL
WHERE sqids.context IS NOT NULL
  AND sqidDecode(sqids.context)[1] = 31  -- TAG_EXPERIMENT
GROUP BY experiment_id, variant_id
ORDER BY experiment_id, variant_id;


-- ============================================================================
-- SQID DECODING EXAMPLES
-- ============================================================================

-- Decode sqids for debugging
SELECT
    url,
    sqids.ref AS ref_sqid,
    sqidDecode(sqids.ref) AS ref_decoded,
    sqids.actor AS actor_sqid,
    sqidDecode(sqids.actor) AS actor_decoded
FROM Things
WHERE url = 'https://startups.studio/headless.ly'
LIMIT 1;

-- Encode sqids (for inserting)
SELECT sqidEncode(1, 123, 2, 456, 3, 789, 4, 1, 5, 42) AS ref_sqid;
-- [NS=1, nsId=123, TYPE=2, typeId=456, THING=3, thingId=789, BRANCH=4, branchId=1, VERSION=5, version=42]
