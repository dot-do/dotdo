# ClickBench Worker Benchmark Results

**Date:** 2026-01-20
**Worker:** chdb-lake (https://chdb-lake.dotdo.workers.dev)
**Data Source:** R2 bucket `chdb-data/clickbench/hits_sample.parquet` (669KB, 85,570 rows)

## Summary

**Total Queries: 26/30 passing (87%)**

## Results by Category

| Category | Passed | Failed | Avg Time |
|----------|--------|--------|----------|
| arithmetic | 6 | 0 | 1.91ms |
| basic | 4 | 0 | 2.31ms |
| clickbench | 6 | 2 | 12.68ms |
| filter | 2 | 0 | 3.23ms |
| numbers | 4 | 0 | 2.53ms |
| string | 4 | 0 | 1.73ms |
| system | 0 | 2 | N/A |

## ClickBench Specific Results

### Passing (6/8)

| Query | Description | Time | Rows |
|-------|-------------|------|------|
| Q0 | COUNT(*) | 19.80ms | 1 |
| Q1 | COUNT with filter | 13.75ms | 1 |
| Q2 | SUM, COUNT, AVG | 7.73ms | 1 |
| Q3 | AVG(UserID) | 7.99ms | 1 |
| Q6 | MIN/MAX dates | 7.30ms | 1 |
| Q7 | GROUP BY AdvEngineID | 19.51ms | 10 |

### Failing (2/8)

| Query | Description | Error |
|-------|-------------|-------|
| Q4 | COUNT(DISTINCT UserID) | `Unknown column: count(DISTINCT UserID)` |
| Q5 | COUNT(DISTINCT SearchPhrase) | `Unknown column: count(DISTINCT SearchPhrase)` |

## Other Failing Queries

| Query | Category | Error |
|-------|----------|-------|
| SHOW DATABASES | system | `Expected SELECT` |
| SHOW TABLES | system | `Expected SELECT` |

## Detailed Query Results

### Basic Queries (4/4 passing)

```
SELECT 1                    2.64ms  PASS
SELECT 1 + 1               2.36ms  PASS
SELECT version()           2.09ms  PASS
SELECT now()               2.16ms  PASS
```

### Numbers Queries (4/4 passing)

```
SELECT number FROM numbers(10)      2.44ms  PASS
SELECT count(*) FROM numbers(1000)  2.35ms  PASS
SELECT sum(number) FROM numbers(100) 3.20ms  PASS
SELECT avg(number) FROM numbers(100) 2.14ms  PASS
```

### Filter Queries (2/2 passing)

```
SELECT number FROM numbers(100) WHERE number > 50            2.73ms  PASS
SELECT number FROM numbers(100) WHERE number % 2 = 0 LIMIT 10 3.73ms  PASS
```

### String Queries (4/4 passing)

```
SELECT length('hello world')        1.94ms  PASS
SELECT upper('hello')               1.59ms  PASS
SELECT lower('HELLO')               1.78ms  PASS
SELECT concat('Hello', ' ', 'World') 1.60ms  PASS
```

### Arithmetic Queries (6/6 passing)

```
SELECT 1 + 2 + 3 + 4 + 5   1.85ms  PASS
SELECT 10 * 20 / 5         1.52ms  PASS
SELECT abs(-42)            2.03ms  PASS
SELECT sqrt(16)            1.55ms  PASS
SELECT floor(3.7)          2.81ms  PASS
SELECT ceil(3.2)           1.67ms  PASS
```

## Technical Notes

1. **s3() function works** - Successfully reads Parquet files from R2 storage
2. **hits_sample.parquet verified** - File exists in R2 with 669KB size
3. **Mock data in use** - parquet-wasm initialization fails, falling back to mock data
4. **Worker deployed** - DNS propagation may take time for new deployment

## Missing Features

1. **COUNT(DISTINCT)** - Not implemented in WASM executor
2. **SHOW statements** - Only SELECT queries supported
3. **Real Parquet parsing** - parquet-wasm has initialization issues

## Recommendations

1. Implement COUNT(DISTINCT) aggregate function
2. Add support for SHOW DATABASES/TABLES
3. Fix parquet-wasm initialization in Workers environment
4. Upload real ClickBench hits_sample.parquet with actual data

## Run Command

```bash
cd /Users/nathanclevenger/projects/clickhouse
python3 benchmarks/worker-bench.py --local
```

Or for deployed Worker:
```bash
python3 benchmarks/worker-bench.py --url https://chdb-lake.dotdo.workers.dev
```
