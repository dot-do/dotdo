-- ClickBench Mini: 10 Representative Queries
--
-- A subset of the official 43 ClickBench queries for quick testing.
-- Selected to cover various query patterns and complexity levels.
--
-- Categories covered:
--   - Simple: COUNT(*), basic aggregations
--   - Filter: WHERE clauses, LIKE patterns
--   - Group: GROUP BY with various cardinalities
--   - Complex: Multiple aggregations, date ranges, CASE expressions
--
-- Usage:
--   Run against the hits table (ClickBench schema)
--   Expected data: ~100M rows for full benchmark, can use 1M sample for testing
--
-- Reference: https://github.com/ClickHouse/ClickBench

-- =============================================================================
-- Q0: Simple COUNT (Baseline)
-- Category: Simple | Expected: <1s on 1M rows, ~2s on full data
-- Tests: Full table scan, counting
-- =============================================================================
SELECT COUNT(*) FROM hits;

-- =============================================================================
-- Q2: Multiple Aggregations
-- Category: Aggregation | Expected: <1s on 1M rows, ~2s on full data
-- Tests: SUM, COUNT, AVG on different columns simultaneously
-- =============================================================================
SELECT SUM(AdvEngineID), COUNT(*), AVG(ResolutionWidth) FROM hits;

-- =============================================================================
-- Q4: COUNT DISTINCT on High Cardinality Column
-- Category: Aggregation | Expected: ~2s on 1M rows, ~10s on full data
-- Tests: Hash aggregation for distinct counting (UserID has ~17M distinct values)
-- =============================================================================
SELECT COUNT(DISTINCT UserID) FROM hits;

-- =============================================================================
-- Q8: GROUP BY with COUNT DISTINCT and LIMIT
-- Category: Group | Expected: ~2s on 1M rows, ~8s on full data
-- Tests: Hash GROUP BY with distinct aggregation and top-K selection
-- =============================================================================
SELECT RegionID, COUNT(DISTINCT UserID) AS u
FROM hits
GROUP BY RegionID
ORDER BY u DESC
LIMIT 10;

-- =============================================================================
-- Q12: String Column GROUP BY
-- Category: Group | Expected: ~1s on 1M rows, ~5s on full data
-- Tests: Variable-length string grouping (SearchPhrase has many unique values)
-- =============================================================================
SELECT SearchPhrase, COUNT(*) AS c
FROM hits
WHERE SearchPhrase <> ''
GROUP BY SearchPhrase
ORDER BY c DESC
LIMIT 10;

-- =============================================================================
-- Q20: LIKE Pattern Matching
-- Category: Filter | Expected: ~1s on 1M rows, ~5s on full data
-- Tests: String pattern matching with full table scan
-- =============================================================================
SELECT COUNT(*) FROM hits WHERE URL LIKE '%google%';

-- =============================================================================
-- Q27: HAVING Clause with String Function
-- Category: Complex | Expected: ~2s on 1M rows, ~10s on full data
-- Tests: String length aggregation, HAVING filter on aggregate
-- =============================================================================
SELECT CounterID, AVG(STRLEN(URL)) AS l, COUNT(*) AS c
FROM hits
WHERE URL <> ''
GROUP BY CounterID
HAVING COUNT(*) > 100000
ORDER BY l DESC
LIMIT 25;

-- =============================================================================
-- Q33: High Cardinality GROUP BY (URL)
-- Category: Group | Expected: ~3s on 1M rows, ~15s on full data
-- Tests: GROUP BY on very high cardinality column (many unique URLs)
-- =============================================================================
SELECT URL, COUNT(*) AS c
FROM hits
GROUP BY URL
ORDER BY c DESC
LIMIT 10;

-- =============================================================================
-- Q36: Date Range Filter with Multiple Conditions
-- Category: Complex | Expected: <1s on 1M rows, ~3s on full data
-- Tests: Multiple predicates, date range, index usage potential
-- =============================================================================
SELECT URL, COUNT(*) AS PageViews
FROM hits
WHERE CounterID = 62
  AND EventDate >= '2013-07-01'
  AND EventDate <= '2013-07-31'
  AND DontCountHits = 0
  AND IsRefresh = 0
  AND URL <> ''
GROUP BY URL
ORDER BY PageViews DESC
LIMIT 10;

-- =============================================================================
-- Q42: Time Series Aggregation with DATE_TRUNC
-- Category: Complex | Expected: <1s on 1M rows, ~2s on full data
-- Tests: Timestamp functions, minute-level aggregation, OFFSET
-- =============================================================================
SELECT DATE_TRUNC('minute', EventTime) AS M, COUNT(*) AS PageViews
FROM hits
WHERE CounterID = 62
  AND EventDate >= '2013-07-14'
  AND EventDate <= '2013-07-15'
  AND IsRefresh = 0
  AND DontCountHits = 0
GROUP BY DATE_TRUNC('minute', EventTime)
ORDER BY DATE_TRUNC('minute', EventTime)
LIMIT 10 OFFSET 1000;

-- =============================================================================
-- END OF CLICKBENCH MINI
-- =============================================================================
--
-- Summary of Query IDs: Q0, Q2, Q4, Q8, Q12, Q20, Q27, Q33, Q36, Q42
--
-- To run with run-clickbench.ts:
--   npx tsx benchmarks/run-clickbench.ts --queries 0,2,4,8,12,20,27,33,36,42
--
-- Expected total time:
--   - 1M rows sample: ~15-30 seconds
--   - Full 100M rows: ~60-120 seconds (DuckDB native)
--   - WASM environment: 2-5x slower than native
-- =============================================================================
