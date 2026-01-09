-- ============================================================================
-- CLICKHOUSE HELPER FUNCTIONS FOR DOTDO
-- ============================================================================
--
-- Sqid utilities and common query patterns.
--
-- ============================================================================


-- ============================================================================
-- SQID TAG CONSTANTS
-- ============================================================================
-- Use these in queries for readability:
--   WHERE sqidDecode(sqids.context)[1] = TAG_EXPERIMENT
-- ============================================================================

-- Core (1-10)
SET param_TAG_NS = 1;
SET param_TAG_TYPE = 2;
SET param_TAG_THING = 3;
SET param_TAG_BRANCH = 4;
SET param_TAG_VERSION = 5;

-- 5W+H (11-20)
SET param_TAG_ACTOR = 11;
SET param_TAG_VERB = 12;
SET param_TAG_TIMESTAMP = 13;
SET param_TAG_LOCATION = 14;

-- HOW (21-30)
SET param_TAG_METHOD = 21;
SET param_TAG_MODEL = 22;
SET param_TAG_CHANNEL = 23;
SET param_TAG_TOOL = 24;

-- Experiment (31-40)
SET param_TAG_EXPERIMENT = 31;
SET param_TAG_VARIANT = 32;
SET param_TAG_METRIC = 33;


-- ============================================================================
-- SQID HELPER FUNCTIONS
-- ============================================================================

-- Get value for a specific tag from a sqid
-- Sqids encode [tag1, value1, tag2, value2, ...]
-- Returns NULL if tag not found
CREATE FUNCTION sqidGetTagValue AS (sqid, targetTag) ->
    arrayFirst(
        (x, i) -> sqidDecode(sqid)[i - 1] = targetTag,
        arrayEnumerate(sqidDecode(sqid))
    );

-- Check if sqid contains a specific tag
CREATE FUNCTION sqidHasTag AS (sqid, tag) ->
    has(sqidDecode(sqid), tag);

-- Get actor ID from actor sqid [ACTOR=11, actorId, ...]
CREATE FUNCTION getActorId AS (actorSqid) ->
    if(length(sqidDecode(actorSqid)) >= 2 AND sqidDecode(actorSqid)[1] = 11,
       sqidDecode(actorSqid)[2],
       NULL);

-- Get method ID from actor sqid [ACTOR, actorId, METHOD=21, methodId, ...]
CREATE FUNCTION getMethodId AS (actorSqid) ->
    with sqidDecode(actorSqid) as decoded,
    arrayFirstIndex(x -> x = 21, decoded) as idx
    select if(idx > 0 AND idx < length(decoded), decoded[idx + 1], NULL);

-- Get experiment ID from context sqid [EXPERIMENT=31, expId, ...]
CREATE FUNCTION getExperimentId AS (contextSqid) ->
    if(length(sqidDecode(contextSqid)) >= 2 AND sqidDecode(contextSqid)[1] = 31,
       sqidDecode(contextSqid)[2],
       NULL);

-- Get variant ID from context sqid [..., VARIANT=32, variantId, ...]
CREATE FUNCTION getVariantId AS (contextSqid) ->
    with sqidDecode(contextSqid) as decoded,
    arrayFirstIndex(x -> x = 32, decoded) as idx
    select if(idx > 0 AND idx < length(decoded), decoded[idx + 1], NULL);

-- Get channel ID from context sqid [..., CHANNEL=23, channelId, ...]
CREATE FUNCTION getChannelId AS (contextSqid) ->
    with sqidDecode(contextSqid) as decoded,
    arrayFirstIndex(x -> x = 23, decoded) as idx
    select if(idx > 0 AND idx < length(decoded), decoded[idx + 1], NULL);


-- ============================================================================
-- VISIBILITY HELPERS
-- ============================================================================

-- Check if visibility allows access for given user/org
-- Usage: WHERE isVisible(visibility, 'user:nathan', 'org:acme')
CREATE FUNCTION isVisible AS (visibility, userId, orgId) ->
    visibility IS NULL
    OR visibility = 'public'
    OR visibility = 'unlisted'
    OR visibility = userId
    OR visibility = orgId;

-- Check if record is soft-deleted
CREATE FUNCTION isDeleted AS (visibility) ->
    visibility = 'deleted';


-- ============================================================================
-- RELATIONSHIP QUERY HELPERS
-- ============================================================================

-- Get references TO a URL, grouped by reverse verb
-- Returns: { 'managedBy': ['url1', 'url2'], 'ownedBy': ['url3'] }
-- Note: For single values, use arrayElement to unwrap
CREATE VIEW ReferencesGrouped AS
SELECT
    to,
    reverse,
    if(length(groupArray(from)) = 1,
       [groupArray(from)[1]],  -- Keep as array for consistency, or use groupArray(from)[1] for single
       groupArray(from)) as sources
FROM Relationships
WHERE visibility IS NULL OR visibility != 'deleted'
GROUP BY to, reverse;


-- ============================================================================
-- TIME HELPERS
-- ============================================================================

-- Convert ts (epoch millis) to DateTime64
CREATE FUNCTION tsToDateTime AS (ts) ->
    fromUnixTimestamp64Milli(ts);

-- Get partition key from ts
CREATE FUNCTION tsToPartition AS (ts) ->
    toYYYYMM(fromUnixTimestamp64Milli(ts));


-- ============================================================================
-- SEARCH HELPERS
-- ============================================================================

-- Vector similarity search with cosine distance
-- Usage: SELECT * FROM Search ORDER BY cosineDistance(embedding, [query_vector]) LIMIT 10
-- Note: Use with approximate index for performance

-- Full-text search helper
-- Usage: WHERE hasToken(content, 'keyword')
