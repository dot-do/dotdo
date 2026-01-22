# chdb-lake SQL Requirements Specification

> SQL execution requirements for a Cloudflare Worker running **real ClickHouse compiled to WebAssembly**, querying Parquet files from R2.

**Architecture**: Real ClickHouse C++ from `vendor/chdb` compiled to WASM via Emscripten.

**Scope**: Analytics queries over Parquet data. NOT a full database.

---

## REQUIRED (P0) - Must work for MVP

### Data Sources

| Feature | Status | Notes |
|---------|--------|-------|
| Read Parquet from R2 | 🔶 Partial | Works via real ClickHouse Parquet reader |
| Read Parquet from HTTPS URLs | 🔶 Partial | External URL support exists but depends on parquet reader |
| s3() table function syntax | ✅ Working | `s3('r2://data/file.parquet', 'Parquet')` |
| Glob patterns for R2 | ✅ Working | `s3('r2://data/events/*.parquet')` - expands via R2 list API |

### Basic Query Structure

| Feature | Status | Notes |
|---------|--------|-------|
| SELECT columns | ✅ Working | Column projection from Parquet files |
| SELECT * | ✅ Working | All columns |
| SELECT with aliases (AS) | ✅ Working | `SELECT col AS alias` |
| FROM clause | ✅ Working | Single table/s3() function |
| LIMIT | ✅ Working | Row count limit |
| OFFSET | ✅ Working | Skip rows |

### Filtering (WHERE)

| Feature | Status | Notes |
|---------|--------|-------|
| Comparison: =, !=, <> | ✅ Working | Equality and inequality |
| Comparison: <, >, <=, >= | ✅ Working | Numeric comparisons |
| AND | ✅ Working | Logical conjunction |
| OR | ✅ Working | Logical disjunction |
| Parentheses grouping | ✅ Working | `(a AND b) OR c` |
| IN clause | ✅ Working | `col IN ('a', 'b', 'c')` |
| String literal comparison | ✅ Working | `WHERE name = 'value'` |
| Numeric literal comparison | ✅ Working | `WHERE count > 100` |

### Aggregate Functions

| Feature | Status | Notes |
|---------|--------|-------|
| COUNT(*) | ✅ Working | Row count; uses Parquet metadata when available |
| COUNT(column) | ✅ Working | Non-null count |
| COUNT(DISTINCT column) | ✅ Working | Distinct value count |
| SUM(column) | ✅ Working | Numeric sum |
| AVG(column) | ✅ Working | Numeric average |
| MIN(column) | ✅ Working | Minimum value (numeric) |
| MAX(column) | ✅ Working | Maximum value (numeric) |
| uniq() | ✅ Working | Alias for COUNT(DISTINCT) |
| uniqExact() | ✅ Working | Alias for COUNT(DISTINCT) |

### GROUP BY

| Feature | Status | Notes |
|---------|--------|-------|
| GROUP BY column | ✅ Working | Single column grouping |
| GROUP BY multiple columns | 🔶 Partial | Basic support; may have edge cases |
| GROUP BY with column number (GROUP BY 1) | ✅ Working | Position-based grouping |
| GROUP BY with alias | ✅ Working | Reference SELECT alias in GROUP BY |

### HAVING

| Feature | Status | Notes |
|---------|--------|-------|
| HAVING with aggregate condition | ✅ Working | `HAVING COUNT(*) > 10` |
| HAVING with alias | ✅ Working | `HAVING total > 100` |

### ORDER BY

| Feature | Status | Notes |
|---------|--------|-------|
| ORDER BY column ASC | ✅ Working | Ascending sort |
| ORDER BY column DESC | ✅ Working | Descending sort |
| ORDER BY multiple columns | ✅ Working | Multi-column sort |
| ORDER BY with NULL handling | 🔶 Partial | NULLs sort first/last; basic handling |

### DISTINCT

| Feature | Status | Notes |
|---------|--------|-------|
| SELECT DISTINCT | ✅ Working | Removes duplicate rows |

### Output Formats

| Feature | Status | Notes |
|---------|--------|-------|
| JSON | ✅ Working | ClickHouse JSON format with meta, data, rows, statistics |
| JSONCompact | ✅ Working | Compact array format |
| JSONEachRow | ✅ Working | NDJSON format |
| CSV | ✅ Working | Comma-separated values |
| CSVWithNames | ✅ Working | CSV with header row |
| TSV / TabSeparated | ✅ Working | Tab-separated values |

---

## IMPORTANT (P1) - Should work

### String Functions

| Feature | Status | Notes |
|---------|--------|-------|
| length() | ✅ Working | String length |
| upper() | ✅ Working | Uppercase conversion |
| lower() | ✅ Working | Lowercase conversion |
| trim() | ✅ Working | Whitespace trimming |
| concat() | ✅ Working | String concatenation |
| substring() | ✅ Working | Extract substring (1-indexed) |
| replace() | ✅ Working | String replacement |
| reverse() | ✅ Working | Reverse string |
| leftPad() | ✅ Working | Left padding |
| rightPad() | ✅ Working | Right padding |
| repeat() | ✅ Working | String repetition |
| LIKE pattern | ❌ Broken | Pattern matching not implemented in WHERE |
| NOT LIKE | ❌ Broken | Negated pattern matching |
| STRLEN() | ✅ Working | ClickHouse alias for length() - used in ClickBench Q27 |

### Math Functions

| Feature | Status | Notes |
|---------|--------|-------|
| abs() | ✅ Working | Absolute value |
| sqrt() | ✅ Working | Square root |
| round() | ✅ Working | Rounding |
| floor() | ✅ Working | Floor |
| ceil() / ceiling() | ✅ Working | Ceiling |
| pow() / power() | ✅ Working | Exponentiation |
| log() / ln() | ✅ Working | Natural logarithm |
| log10() / log2() | ✅ Working | Base-10/2 logarithm |
| exp() | ✅ Working | Exponential |
| sin() / cos() / tan() | ✅ Working | Trigonometric |
| sign() | ✅ Working | Sign function |
| mod() / modulo() | ✅ Working | Modulo operation |
| greatest() / least() | ✅ Working | Min/max of arguments |

### Type Conversion

| Feature | Status | Notes |
|---------|--------|-------|
| toInt64() | ✅ Working | Integer conversion |
| toFloat64() | ✅ Working | Float conversion |
| toString() | ✅ Working | String conversion |

### Conditional Functions

| Feature | Status | Notes |
|---------|--------|-------|
| if(cond, then, else) | ✅ Working | Ternary conditional |
| coalesce() | ✅ Working | First non-null value |
| CASE WHEN | ❌ Broken | Not implemented |

### System Functions

| Feature | Status | Notes |
|---------|--------|-------|
| version() | ✅ Working | Returns version string |
| currentDatabase() | ✅ Working | Returns 'default' |
| now() | ✅ Working | Current timestamp |
| today() | ✅ Working | Current date |

### Date/Time Functions

| Feature | Status | Notes |
|---------|--------|-------|
| DATE_TRUNC() | ❌ Broken | Required for ClickBench Q42 |
| toDate() | ❌ Broken | Date conversion |
| toDateTime() | ❌ Broken | DateTime conversion |
| toYYYYMM() | ❌ Broken | Year-month extraction |

### Table Functions

| Feature | Status | Notes |
|---------|--------|-------|
| numbers(N) | ✅ Working | Generate sequence 0..N-1 |
| range(N) | ❌ Broken | Alias for numbers() |

### Write Operations

| Feature | Status | Notes |
|---------|--------|-------|
| INSERT INTO s3() SELECT | 🔶 Partial | Writes to R2; Parquet write falls back to JSON |

---

## NICE TO HAVE (P2) - Can defer

### Advanced Query Features

| Feature | Status | Notes |
|---------|--------|-------|
| Subqueries in FROM | ❌ Not started | `SELECT * FROM (SELECT ...)` |
| Subqueries in WHERE | ❌ Not started | `WHERE col IN (SELECT ...)` |
| CTEs (WITH clause) | ❌ Not started | Common table expressions |
| UNION / UNION ALL | ❌ Not started | Query combination |
| JOIN operations | ❌ Not started | Any type of join |
| Window functions | ❌ Not started | OVER(), ROW_NUMBER(), etc. |

### Advanced Aggregates

| Feature | Status | Notes |
|---------|--------|-------|
| median() | ❌ Not started | Median value |
| quantile() | ❌ Not started | Percentile calculation |
| stddev() / variance() | ❌ Not started | Statistical functions |
| groupArray() | ❌ Not started | Collect values into array |
| argMin() / argMax() | ❌ Not started | Value at min/max |

### Advanced String Functions

| Feature | Status | Notes |
|---------|--------|-------|
| splitByChar() | ❌ Not started | Split string |
| arrayJoin() | ❌ Not started | Expand array to rows |
| extractAll() | ❌ Not started | Regex extraction |
| match() | ❌ Not started | Regex matching |
| multiIf() | ❌ Not started | Multiple conditions |

### Advanced Date Functions

| Feature | Status | Notes |
|---------|--------|-------|
| dateDiff() | ❌ Not started | Date difference |
| dateAdd() | ❌ Not started | Date arithmetic |
| formatDateTime() | ❌ Not started | Date formatting |
| parseDateTimeBestEffort() | ❌ Not started | Flexible date parsing |

### Parquet Optimizations

| Feature | Status | Notes |
|---------|--------|-------|
| Predicate pushdown | 🔶 Partial | Predicates extracted but not pushed to row groups |
| Row group filtering | ❌ Not started | Skip row groups based on statistics |
| Column pruning | ✅ Working | Only read requested columns |
| Dictionary encoding support | ✅ Working | Via hyparquet |
| ZSTD compression | ✅ Working | Via hyparquet |
| SNAPPY compression | ✅ Working | Via hyparquet |

### ClickBench Query Coverage

| Query | Status | Blocker |
|-------|--------|---------|
| Q0: COUNT(*) | ✅ Working | - |
| Q2: SUM, COUNT, AVG | ✅ Working | - |
| Q4: COUNT DISTINCT | ✅ Working | - |
| Q8: GROUP BY + COUNT DISTINCT + LIMIT | ✅ Working | - |
| Q12: String GROUP BY + WHERE <> | 🔶 Partial | Requires real Parquet data |
| Q20: LIKE pattern | ❌ Broken | LIKE not implemented |
| Q27: HAVING + STRLEN | ❌ Broken | STRLEN not implemented |
| Q33: High cardinality GROUP BY | 🔶 Partial | Performance concern |
| Q36: Date range + multiple WHERE | 🔶 Partial | Date handling |
| Q42: DATE_TRUNC | ❌ Broken | DATE_TRUNC not implemented |

---

## NOT REQUIRED - Explicitly out of scope

### Lake Format Support
- **Hudi support** - Not implementing
- **Delta Lake** - Not implementing
- **Iceberg** - Not implementing
- **ORC format** - Not implementing
- **Avro format** - Not implementing

### DDL (Data Definition)
- **CREATE TABLE** - No schema registry
- **CREATE DATABASE** - Single implicit database
- **CREATE VIEW** - No persistent views
- **ALTER TABLE** - No schema modification
- **DROP TABLE/DATABASE** - Nothing to drop
- **CREATE INDEX** - No indexing

### DML (Data Manipulation)
- **INSERT INTO table** - No persistent tables (only INSERT INTO s3())
- **UPDATE** - Parquet is immutable
- **DELETE** - Parquet is immutable
- **TRUNCATE** - No persistent tables
- **MERGE** - No upsert support

### Transactions
- **BEGIN/COMMIT/ROLLBACK** - No transaction support
- **ACID guarantees** - Eventual consistency only
- **Isolation levels** - Not applicable

### User Management
- **CREATE USER** - Use Cloudflare Access
- **GRANT/REVOKE** - No permission system
- **Role management** - Not applicable

### Database Features
- **Stored procedures** - Not supported
- **Triggers** - Not supported
- **Foreign keys** - Not supported
- **Constraints** - Not supported
- **Sequences** - Not supported

### Replication & Distribution
- **Replication** - Use R2's global distribution
- **Sharding** - Not applicable
- **Distributed queries** - Single worker execution

### System Operations
- **SHOW PROCESSLIST** - Limited visibility
- **KILL QUERY** - Not implemented
- **System tables** - Minimal system.* support
- **EXPLAIN** - Not implemented
- **OPTIMIZE TABLE** - Not applicable

### ClickHouse-Specific
- **MergeTree engine** - Using Parquet on R2 instead
- **Materialized views** - Not supported
- **Projections** - Not supported
- **Mutations** - Parquet immutable
- **TTL** - Use R2 lifecycle rules
- **Dictionaries** - Not supported
- **Data skipping indexes** - Use Parquet row group stats

---

## Implementation Notes

### Architecture
- **Runtime**: Cloudflare Workers (V8 isolate)
- **Storage**: Cloudflare R2 (S3-compatible)
- **SQL Engine**: Real ClickHouse compiled to WebAssembly via Emscripten
- **Source**: `vendor/chdb` (ClickHouse C++ codebase)
- **Query Execution**: Actual ClickHouse engine running in WASM

### Known Limitations
1. **Memory**: Worker memory limits (~128MB) constrain result sizes
2. **CPU Time**: 30 second CPU time limit per request
3. **WASM Size**: Large binary (~15-20MB) affects cold start
4. **No Streaming**: Results buffered in memory before response
5. **Single-threaded**: WASM runs single-threaded in Workers

### Performance Considerations
- COUNT(*) uses Parquet footer metadata when available
- Column projection minimizes data read from Parquet
- R2 range requests for efficient partial reads
- Query result caching via KV (optional)

---

## ClickBench Mini Queries Reference

The following 10 queries from ClickBench are the target benchmark:

```sql
-- Q0: Simple COUNT (baseline)
SELECT COUNT(*) FROM hits;

-- Q2: Multiple aggregations
SELECT SUM(AdvEngineID), COUNT(*), AVG(ResolutionWidth) FROM hits;

-- Q4: COUNT DISTINCT
SELECT COUNT(DISTINCT UserID) FROM hits;

-- Q8: GROUP BY + COUNT DISTINCT + LIMIT
SELECT RegionID, COUNT(DISTINCT UserID) AS u
FROM hits GROUP BY RegionID ORDER BY u DESC LIMIT 10;

-- Q12: String GROUP BY with WHERE
SELECT SearchPhrase, COUNT(*) AS c
FROM hits WHERE SearchPhrase <> ''
GROUP BY SearchPhrase ORDER BY c DESC LIMIT 10;

-- Q20: LIKE pattern (BLOCKED - LIKE not implemented)
SELECT COUNT(*) FROM hits WHERE URL LIKE '%google%';

-- Q27: HAVING + STRLEN (BLOCKED - STRLEN not implemented)
SELECT CounterID, AVG(STRLEN(URL)) AS l, COUNT(*) AS c
FROM hits WHERE URL <> ''
GROUP BY CounterID HAVING COUNT(*) > 100000
ORDER BY l DESC LIMIT 25;

-- Q33: High cardinality GROUP BY
SELECT URL, COUNT(*) AS c FROM hits
GROUP BY URL ORDER BY c DESC LIMIT 10;

-- Q36: Date range + multiple conditions
SELECT URL, COUNT(*) AS PageViews FROM hits
WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31'
  AND DontCountHits = 0 AND IsRefresh = 0 AND URL <> ''
GROUP BY URL ORDER BY PageViews DESC LIMIT 10;

-- Q42: DATE_TRUNC (BLOCKED - not implemented)
SELECT DATE_TRUNC('minute', EventTime) AS M, COUNT(*) AS PageViews
FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-14'
  AND EventDate <= '2013-07-15' AND IsRefresh = 0 AND DontCountHits = 0
GROUP BY DATE_TRUNC('minute', EventTime)
ORDER BY DATE_TRUNC('minute', EventTime) LIMIT 10 OFFSET 1000;
```

**Current ClickBench Coverage: 6/10 queries (60%)**
- Passing: Q0, Q2, Q4, Q8, Q33, Q36 (partially)
- Blocked: Q12 (needs real data), Q20 (LIKE), Q27 (STRLEN), Q42 (DATE_TRUNC)
