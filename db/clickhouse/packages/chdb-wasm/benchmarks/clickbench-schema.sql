-- ClickBench Schema: hits table
--
-- Official ClickBench schema for the hits dataset.
-- Source: https://github.com/ClickHouse/ClickBench
--
-- Dataset Information:
--   - Rows: 99,997,497 (approximately 100 million)
--   - Size: ~14.7 GB (Parquet), ~75 GB (CSV)
--   - Source: https://datasets.clickhouse.com/hits_compatible/hits.parquet
--   - Content: Web analytics events (Yandex.Metrica sample data)
--
-- Column Categories:
--   - Identifiers: WatchID, UserID, CounterID
--   - Temporal: EventTime, EventDate, ClientEventTime
--   - Device: OS, UserAgent, IsMobile, Resolution*
--   - Content: URL, Referer, Title, SearchPhrase
--   - Attribution: TraficSourceID, SearchEngineID, UTM*
--   - Metrics: various flags and timings

-- =============================================================================
-- DuckDB/chdb Compatible Schema
-- =============================================================================

CREATE TABLE hits (
    -- Core identifiers
    WatchID BIGINT NOT NULL,
    JavaEnable SMALLINT NOT NULL,
    Title TEXT,
    GoodEvent SMALLINT NOT NULL,
    EventTime TIMESTAMP NOT NULL,
    EventDate DATE NOT NULL,
    CounterID INTEGER NOT NULL,
    ClientIP INTEGER NOT NULL,
    RegionID INTEGER NOT NULL,
    UserID BIGINT NOT NULL,

    -- Counter classification
    CounterClass SMALLINT NOT NULL,

    -- Device and browser info
    OS SMALLINT NOT NULL,
    UserAgent SMALLINT NOT NULL,
    URL TEXT,
    Referer TEXT,
    IsRefresh SMALLINT NOT NULL,
    RefererCategoryID SMALLINT NOT NULL,
    RefererRegionID INTEGER NOT NULL,
    URLCategoryID SMALLINT NOT NULL,
    URLRegionID INTEGER NOT NULL,

    -- Resolution
    ResolutionWidth SMALLINT NOT NULL,
    ResolutionHeight SMALLINT NOT NULL,
    ResolutionDepth SMALLINT NOT NULL,

    -- Flash
    FlashMajor SMALLINT NOT NULL,
    FlashMinor SMALLINT NOT NULL,
    FlashMinor2 TEXT,

    -- .NET
    NetMajor SMALLINT NOT NULL,
    NetMinor SMALLINT NOT NULL,

    -- User Agent details
    UserAgentMajor SMALLINT NOT NULL,
    UserAgentMinor VARCHAR(255) NOT NULL,

    -- Browser capabilities
    CookieEnable SMALLINT NOT NULL,
    JavascriptEnable SMALLINT NOT NULL,

    -- Mobile
    IsMobile SMALLINT NOT NULL,
    MobilePhone SMALLINT NOT NULL,
    MobilePhoneModel TEXT,

    -- Parameters
    Params TEXT,

    -- Network
    IPNetworkID INTEGER NOT NULL,

    -- Traffic source
    TraficSourceID SMALLINT NOT NULL,
    SearchEngineID SMALLINT NOT NULL,
    SearchPhrase TEXT,
    AdvEngineID SMALLINT NOT NULL,
    IsArtifical SMALLINT NOT NULL,

    -- Window dimensions
    WindowClientWidth SMALLINT NOT NULL,
    WindowClientHeight SMALLINT NOT NULL,

    -- Timezone
    ClientTimeZone SMALLINT NOT NULL,
    ClientEventTime TIMESTAMP NOT NULL,

    -- Silverlight
    SilverlightVersion1 SMALLINT NOT NULL,
    SilverlightVersion2 SMALLINT NOT NULL,
    SilverlightVersion3 INTEGER NOT NULL,
    SilverlightVersion4 SMALLINT NOT NULL,

    -- Charset
    PageCharset TEXT,

    -- Code version
    CodeVersion INTEGER NOT NULL,

    -- Event flags
    IsLink SMALLINT NOT NULL,
    IsDownload SMALLINT NOT NULL,
    IsNotBounce SMALLINT NOT NULL,

    -- Additional identifiers
    FUniqID BIGINT NOT NULL,
    OriginalURL TEXT,
    HID INTEGER NOT NULL,

    -- Counter flags
    IsOldCounter SMALLINT NOT NULL,
    IsEvent SMALLINT NOT NULL,
    IsParameter SMALLINT NOT NULL,
    DontCountHits SMALLINT NOT NULL,
    WithHash SMALLINT NOT NULL,

    -- Hit color
    HitColor CHAR NOT NULL,

    -- Local time
    LocalEventTime TIMESTAMP NOT NULL,

    -- Demographics
    Age SMALLINT NOT NULL,
    Sex SMALLINT NOT NULL,
    Income SMALLINT NOT NULL,
    Interests SMALLINT NOT NULL,

    -- Bot detection
    Robotness SMALLINT NOT NULL,

    -- Remote IP
    RemoteIP INTEGER NOT NULL,

    -- Window info
    WindowName INTEGER NOT NULL,
    OpenerName INTEGER NOT NULL,
    HistoryLength SMALLINT NOT NULL,

    -- Browser locale
    BrowserLanguage TEXT,
    BrowserCountry TEXT,

    -- Social
    SocialNetwork TEXT,
    SocialAction TEXT,

    -- HTTP
    HTTPError SMALLINT NOT NULL,

    -- Performance timings
    SendTiming INTEGER NOT NULL,
    DNSTiming INTEGER NOT NULL,
    ConnectTiming INTEGER NOT NULL,
    ResponseStartTiming INTEGER NOT NULL,
    ResponseEndTiming INTEGER NOT NULL,
    FetchTiming INTEGER NOT NULL,

    -- Social source
    SocialSourceNetworkID SMALLINT NOT NULL,
    SocialSourcePage TEXT,

    -- E-commerce
    ParamPrice BIGINT NOT NULL,
    ParamOrderID TEXT,
    ParamCurrency TEXT,
    ParamCurrencyID SMALLINT NOT NULL,

    -- Openstat
    OpenstatServiceName TEXT,
    OpenstatCampaignID TEXT,
    OpenstatAdID TEXT,
    OpenstatSourceID TEXT,

    -- UTM parameters
    UTMSource TEXT,
    UTMMedium TEXT,
    UTMCampaign TEXT,
    UTMContent TEXT,
    UTMTerm TEXT,

    -- Tags
    FromTag TEXT,

    -- Google Click ID
    HasGCLID SMALLINT NOT NULL,

    -- Hashes
    RefererHash BIGINT NOT NULL,
    URLHash BIGINT NOT NULL,
    CLID INTEGER NOT NULL
);

-- =============================================================================
-- Column Statistics (Full Dataset)
-- =============================================================================
--
-- Total rows: 99,997,497
-- Columns: 105
--
-- High Cardinality Columns (for GROUP BY performance):
--   - WatchID: ~99.9M unique (nearly all unique)
--   - UserID: ~17.6M unique
--   - URL: ~20.4M unique
--   - Referer: ~9.4M unique
--   - SearchPhrase: ~6.0M unique (when not empty)
--   - Title: ~3.4M unique
--
-- Low Cardinality Columns (efficient for filtering):
--   - CounterID: ~200 unique
--   - RegionID: ~9K unique
--   - OS: ~100 unique
--   - UserAgent: ~100 unique
--   - SearchEngineID: ~50 unique
--   - TraficSourceID: ~10 unique
--
-- Date Range:
--   - EventDate: 2013-07-01 to 2013-07-31 (1 month)
--
-- Null/Empty Statistics:
--   - SearchPhrase: ~90% empty
--   - URL: <1% empty
--   - Referer: ~30% empty
--   - Title: ~5% empty
--
-- =============================================================================

-- =============================================================================
-- Sample Data Loading (DuckDB/chdb)
-- =============================================================================

-- Load from Parquet file
-- CREATE VIEW hits AS SELECT * FROM read_parquet('hits.parquet');

-- Or create physical table
-- CREATE TABLE hits AS SELECT * FROM read_parquet('hits.parquet');

-- Load sample (first 1M rows)
-- CREATE TABLE hits AS SELECT * FROM read_parquet('hits.parquet') LIMIT 1000000;

-- Load with sampling (random 1%)
-- CREATE TABLE hits AS SELECT * FROM read_parquet('hits.parquet') USING SAMPLE 1 PERCENT;

-- =============================================================================
-- Useful Indexes (if supported)
-- =============================================================================

-- For date-filtered queries (Q36-Q42)
-- CREATE INDEX idx_hits_counter_date ON hits(CounterID, EventDate);

-- For search phrase queries
-- CREATE INDEX idx_hits_searchphrase ON hits(SearchPhrase) WHERE SearchPhrase <> '';

-- For user analysis
-- CREATE INDEX idx_hits_userid ON hits(UserID);

-- =============================================================================
-- ClickHouse-Specific Schema (for reference)
-- =============================================================================
/*
CREATE TABLE hits
(
    WatchID UInt64,
    JavaEnable UInt8,
    Title String,
    GoodEvent Int16,
    EventTime DateTime,
    EventDate Date,
    CounterID UInt32,
    ClientIP UInt32,
    RegionID UInt32,
    UserID UInt64,
    -- ... (same columns with ClickHouse types)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(EventDate)
ORDER BY (CounterID, EventDate, intHash32(UserID))
SETTINGS index_granularity = 8192;
*/
