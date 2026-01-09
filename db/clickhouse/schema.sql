-- ============================================================================
-- CLICKHOUSE SCHEMA FOR DOTDO
-- ============================================================================
--
-- This schema supports two query modes:
-- 1. Federated queries via IcebergS3/DataLakeCatalog (R2 Data Catalog)
-- 2. Native MergeTree tables via S3Queue streaming from R2
--
-- Tables: Things, Relationships, Actions, Events, Search, Artifacts
--
-- Common patterns:
-- - Core identity: url, ns, type, id, ts (epoch millis)
-- - Visibility: Nullable(String) for soft delete via CoalescingMergeTree
-- - Sqids tuple: ref, actor, trace, context for attribution
-- - Monthly partitioning by ts
-- - JSON fields for flexible data
-- - LowCardinality for enums
--
-- ============================================================================

-- ============================================================================
-- TAG ENUM REFERENCE (matches lib/sqids.ts)
-- ============================================================================
--
-- Core (1-10):
--   NS=1, TYPE=2, THING=3, BRANCH=4, VERSION=5
--
-- 5W+H (11-20):
--   ACTOR=11, VERB=12, TIMESTAMP=13, LOCATION=14
--
-- HOW (21-30):
--   METHOD=21, MODEL=22, CHANNEL=23, TOOL=24
--
-- Experiment (31-40):
--   EXPERIMENT=31, VARIANT=32, METRIC=33
--
-- ============================================================================


-- ============================================================================
-- THINGS
-- ============================================================================
-- Versioned entities with CoalescingMergeTree for partial updates.
-- ORDER BY optimized for: "get Thing by ns/type/id on branch"
-- ============================================================================

CREATE TABLE Things (
    -- Identity
    url         String,
    ns          LowCardinality(String),
    type        LowCardinality(String),
    id          String,
    ts          UInt64,

    -- Content
    name        Nullable(String),
    data        JSON,
    meta        JSON,
    relationships JSON,                      -- outbound: { verb: [url, ...] }

    -- Lifecycle
    branch      Nullable(LowCardinality(String)) DEFAULT 'main',
    visibility  Nullable(String),            -- 'public', 'unlisted', 'org:X', 'user:Y', 'deleted'

    -- Sqids
    sqids Tuple(
        ref     String,                      -- [NS, TYPE, THING, BRANCH, VERSION]
        actor   Nullable(String),            -- [ACTOR, METHOD, TOOL, MODEL]
        trace   Nullable(String),            -- [TIMESTAMP, REQUEST, SESSION, WORKFLOW]
        context Nullable(String)             -- [EXPERIMENT, VARIANT, CHANNEL, LOCATION]
    ),

    INDEX url_idx url TYPE bloom_filter GRANULARITY 4
)
ENGINE = CoalescingMergeTree()
PARTITION BY toYYYYMM(fromUnixTimestamp64Milli(ts))
ORDER BY (ns, type, id, branch)
SETTINGS allow_nullable_key = 1;


-- ============================================================================
-- RELATIONSHIPS
-- ============================================================================
-- Inbound edges with CoalescingMergeTree for soft delete via visibility.
-- ORDER BY optimized for: "get all references TO this URL, grouped by reverse verb"
-- Outbound edges stored in Things.relationships JSON.
-- ============================================================================

CREATE TABLE Relationships (
    -- Target (what's being referenced)
    to          String,
    toNs        LowCardinality(String),
    toType      LowCardinality(String),
    toId        String,

    -- Source (what's doing the referencing)
    from        String,
    fromNs      LowCardinality(String),
    fromType    LowCardinality(String),
    fromId      String,

    -- Verbs
    verb        LowCardinality(String),      -- 'manages', 'owns'
    reverse     LowCardinality(String),      -- 'managedBy', 'ownedBy'

    -- Lifecycle
    visibility  Nullable(String),            -- 'public', 'unlisted', 'org:X', 'user:Y', 'deleted'

    -- Metadata
    data        JSON,
    ts          UInt64,

    -- Sqids
    sqids Tuple(
        ref     String,                      -- [NS, TYPE, THING, VERB] (from side)
        edge    String,                      -- [NS, THING, VERB, NS, THING] (full edge)
        actor   Nullable(String),            -- [ACTOR, METHOD, TOOL]
        trace   Nullable(String),            -- [TIMESTAMP, REQUEST, SESSION]
        context Nullable(String)             -- [EXPERIMENT, VARIANT]
    ),

    INDEX from_idx from TYPE bloom_filter GRANULARITY 4
)
ENGINE = CoalescingMergeTree()
PARTITION BY toYYYYMM(fromUnixTimestamp64Milli(ts))
ORDER BY (to, reverse, from, verb);


-- ============================================================================
-- ACTIONS
-- ============================================================================
-- Append-only audit log of all mutations.
-- ORDER BY optimized for: "get action history for target"
-- ============================================================================

CREATE TABLE Actions (
    -- Identity
    url         String,
    ns          LowCardinality(String),
    type        LowCardinality(String) DEFAULT 'Action',
    id          String,                      -- UUID
    ts          UInt64,

    -- Action details
    verb        LowCardinality(String),      -- 'create', 'update', 'delete'
    actor       Nullable(String),            -- 'Human/nathan', 'Agent/support'
    target      String,                      -- 'Startup/acme'

    -- Version references
    input       Nullable(UInt64),            -- thing version before
    output      Nullable(UInt64),            -- thing version after

    -- Status
    status      LowCardinality(String),      -- 'pending', 'running', 'completed', 'failed', 'undone', 'retrying'
    durability  LowCardinality(String),      -- 'send', 'try', 'do'

    -- Payloads
    options     JSON,
    error       JSON,

    -- Correlation
    requestId   Nullable(String),
    sessionId   Nullable(String),
    workflowId  Nullable(String),

    -- Timing
    startedAt   Nullable(UInt64),
    completedAt Nullable(UInt64),
    duration    Nullable(UInt32),            -- ms

    -- Sqids
    sqids Tuple(
        ref     String,                      -- [NS, TYPE, THING, VERSION] (target ref)
        actor   Nullable(String),            -- [ACTOR, METHOD, TOOL, MODEL]
        trace   Nullable(String),            -- [TIMESTAMP, REQUEST, SESSION, WORKFLOW]
        context Nullable(String)             -- [EXPERIMENT, VARIANT]
    ),

    INDEX actor_idx actor TYPE bloom_filter GRANULARITY 4,
    INDEX target_idx target TYPE bloom_filter GRANULARITY 4,
    INDEX request_idx requestId TYPE bloom_filter GRANULARITY 4,
    INDEX status_idx status TYPE set(10) GRANULARITY 4
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(fromUnixTimestamp64Milli(ts))
ORDER BY (ns, target, ts);


-- ============================================================================
-- EVENTS
-- ============================================================================
-- Domain event stream, append-only.
-- ORDER BY optimized for: "get events in time order within namespace"
-- ============================================================================

CREATE TABLE Events (
    -- Identity
    url         String,
    ns          LowCardinality(String),
    type        LowCardinality(String),      -- 'CustomerCreated', 'PaymentFailed'
    id          String,
    ts          UInt64,

    -- Event details
    verb        LowCardinality(String),      -- 'created', 'updated', 'deleted'
    source      String,                      -- source thing URL
    object      Nullable(String),            -- object ID/URL
    result      Nullable(String),            -- result ID/URL

    -- Payload
    data        JSON,

    -- Correlation
    actionId    Nullable(String),            -- related action
    sequence    UInt64,                      -- ordering within DO

    -- Sqids
    sqids Tuple(
        ref     String,                      -- [NS, TIMESTAMP, SEQUENCE]
        source  String,                      -- [NS, TYPE, THING] (source thing)
        actor   Nullable(String),            -- [ACTOR, METHOD, TOOL]
        trace   Nullable(String),            -- [TIMESTAMP, REQUEST, SESSION, ACTION]
        context Nullable(String)             -- [EXPERIMENT, VARIANT, CHANNEL]
    ),

    INDEX source_idx source TYPE bloom_filter GRANULARITY 4,
    INDEX action_idx actionId TYPE bloom_filter GRANULARITY 4,
    INDEX type_idx type TYPE set(100) GRANULARITY 4
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(fromUnixTimestamp64Milli(ts))
ORDER BY (ns, ts, type);


-- ============================================================================
-- SEARCH
-- ============================================================================
-- Chunked content with embeddings for vector search and FTS.
-- ORDER BY optimized for: "get all chunks for a Thing"
-- Supports multiple embedding models via separate rows per model/strategy.
-- ============================================================================

CREATE TABLE Search (
    -- Source identity
    url         String,                      -- source thing URL
    ns          LowCardinality(String),
    type        LowCardinality(String),
    id          String,
    ts          UInt64,

    -- Chunk identity
    chunkId     String,                      -- unique chunk identifier
    chunkIndex  UInt16,                      -- position in source

    -- Content
    content     String,                      -- chunk text
    embedding   Array(Float32),              -- vector

    -- Strategy
    model       LowCardinality(String),      -- 'text-embedding-3-small', 'voyage-3'
    strategy    LowCardinality(String),      -- 'sentence', 'paragraph', 'sliding-window'
    dimensions  UInt16,                      -- embedding dimensions

    -- Metadata
    meta        JSON,

    -- Sqids
    sqids Tuple(
        ref     String,                      -- [NS, TYPE, THING, VERSION]
        chunk   String,                      -- [THING, VERSION, CHUNK, MODEL, STRATEGY]
        actor   Nullable(String),            -- [ACTOR, TOOL, MODEL] (embedder)
        trace   Nullable(String)             -- [TIMESTAMP, REQUEST]
    ),

    INDEX vec_idx embedding TYPE vector_similarity('hnsw', 'cosineDistance') GRANULARITY 100000000,
    INDEX fts_idx content TYPE full_text GRANULARITY 1
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(fromUnixTimestamp64Milli(ts))
ORDER BY (ns, type, id, chunkIndex)
SETTINGS
    allow_experimental_vector_similarity_index = 1,
    allow_experimental_full_text_index = 1;


-- ============================================================================
-- ARTIFACTS
-- ============================================================================
-- Binary content with ZSTD compression.
-- ORDER BY optimized for: "get artifacts for a Thing"
-- ============================================================================

CREATE TABLE Artifacts (
    -- Identity
    url         String,                      -- artifact URL
    ns          LowCardinality(String),
    type        LowCardinality(String),      -- 'image', 'document', 'video'
    id          String,
    ts          UInt64,

    -- Parent reference
    thingUrl    String,                      -- parent thing URL

    -- Content
    content     String CODEC(ZSTD(3)),       -- blob (base64 or raw)
    contentType LowCardinality(String),      -- 'image/png', 'application/pdf'
    size        UInt64,                      -- bytes
    hash        String,                      -- content hash for dedup

    -- Metadata
    meta        JSON,

    -- Sqids
    sqids Tuple(
        ref     String,                      -- [NS, TYPE, THING, ARTIFACT]
        parent  String,                      -- [NS, TYPE, THING, VERSION] (parent thing)
        actor   Nullable(String),            -- [ACTOR, METHOD, TOOL]
        trace   Nullable(String)             -- [TIMESTAMP, REQUEST]
    ),

    INDEX thing_idx thingUrl TYPE bloom_filter GRANULARITY 4,
    INDEX hash_idx hash TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(fromUnixTimestamp64Milli(ts))
ORDER BY (ns, thingUrl, ts);
