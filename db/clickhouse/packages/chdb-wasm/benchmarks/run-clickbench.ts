#!/usr/bin/env node
/**
 * ClickBench Benchmark Runner
 *
 * Runs the official 43 ClickBench queries against chdb-wasm/DuckDB-WASM.
 * Outputs results in ClickBench-compatible format for comparison.
 *
 * Usage:
 *   npx tsx benchmarks/run-clickbench.ts [options]
 *
 * Options:
 *   --cold-runs N       Number of cold runs (default: 1)
 *   --hot-runs N        Number of hot runs (default: 3)
 *   --timeout MS        Query timeout in milliseconds (default: 300000)
 *   --output FILE       Output file path (default: stdout)
 *   --format FORMAT     Output format: clickbench | json | markdown (default: clickbench)
 *   --queries Q1,Q2     Run specific queries only
 *   --skip Q1,Q2        Skip specific queries
 *   --backend BACKEND   Backend to use: duckdb | chdb (default: duckdb)
 *   --data-path PATH    Path to hits.parquet file
 *   --verbose           Enable verbose logging
 *   --help              Show help message
 *
 * ClickBench Output Format:
 *   Each query outputs 3 numbers (comma-separated):
 *   - Cold run time (seconds)
 *   - Hot run 1 time (seconds)
 *   - Hot run 2 time (seconds)
 *
 * Reference: https://github.com/ClickHouse/ClickBench
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// OFFICIAL CLICKBENCH QUERIES (DuckDB variant)
// ============================================================================

/**
 * Official 43 ClickBench queries adapted for DuckDB/chdb.
 * Source: https://github.com/ClickHouse/ClickBench/blob/main/duckdb/queries.sql
 */
export const CLICKBENCH_QUERIES: string[] = [
  // Q0: Simple count
  `SELECT COUNT(*) FROM hits;`,

  // Q1: Count with filter
  `SELECT COUNT(*) FROM hits WHERE AdvEngineID <> 0;`,

  // Q2: Multiple aggregations
  `SELECT SUM(AdvEngineID), COUNT(*), AVG(ResolutionWidth) FROM hits;`,

  // Q3: AVG on large integer
  `SELECT AVG(UserID) FROM hits;`,

  // Q4: Count distinct UserID
  `SELECT COUNT(DISTINCT UserID) FROM hits;`,

  // Q5: Count distinct SearchPhrase
  `SELECT COUNT(DISTINCT SearchPhrase) FROM hits;`,

  // Q6: Min/Max dates
  `SELECT MIN(EventDate), MAX(EventDate) FROM hits;`,

  // Q7: Group by with filter and order
  `SELECT AdvEngineID, COUNT(*) FROM hits WHERE AdvEngineID <> 0 GROUP BY AdvEngineID ORDER BY COUNT(*) DESC;`,

  // Q8: Group by with count distinct and limit
  `SELECT RegionID, COUNT(DISTINCT UserID) AS u FROM hits GROUP BY RegionID ORDER BY u DESC LIMIT 10;`,

  // Q9: Multiple aggregations with group by
  `SELECT RegionID, SUM(AdvEngineID), COUNT(*) AS c, AVG(ResolutionWidth), COUNT(DISTINCT UserID) FROM hits GROUP BY RegionID ORDER BY c DESC LIMIT 10;`,

  // Q10: Mobile phone model popularity
  `SELECT MobilePhoneModel, COUNT(DISTINCT UserID) AS u FROM hits WHERE MobilePhoneModel <> '' GROUP BY MobilePhoneModel ORDER BY u DESC LIMIT 10;`,

  // Q11: Two-column group by
  `SELECT MobilePhone, MobilePhoneModel, COUNT(DISTINCT UserID) AS u FROM hits WHERE MobilePhoneModel <> '' GROUP BY MobilePhone, MobilePhoneModel ORDER BY u DESC LIMIT 10;`,

  // Q12: SearchPhrase popularity
  `SELECT SearchPhrase, COUNT(*) AS c FROM hits WHERE SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY c DESC LIMIT 10;`,

  // Q13: SearchPhrase with distinct users
  `SELECT SearchPhrase, COUNT(DISTINCT UserID) AS u FROM hits WHERE SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY u DESC LIMIT 10;`,

  // Q14: Two-column group by with search
  `SELECT SearchEngineID, SearchPhrase, COUNT(*) AS c FROM hits WHERE SearchPhrase <> '' GROUP BY SearchEngineID, SearchPhrase ORDER BY c DESC LIMIT 10;`,

  // Q15: UserID grouping
  `SELECT UserID, COUNT(*) FROM hits GROUP BY UserID ORDER BY COUNT(*) DESC LIMIT 10;`,

  // Q16: User and SearchPhrase
  `SELECT UserID, SearchPhrase, COUNT(*) FROM hits GROUP BY UserID, SearchPhrase ORDER BY COUNT(*) DESC LIMIT 10;`,

  // Q17: User and SearchPhrase without order
  `SELECT UserID, SearchPhrase, COUNT(*) FROM hits GROUP BY UserID, SearchPhrase LIMIT 10;`,

  // Q18: Three-column group by with time extraction
  `SELECT UserID, extract(minute FROM EventTime) AS m, SearchPhrase, COUNT(*) FROM hits GROUP BY UserID, m, SearchPhrase ORDER BY COUNT(*) DESC LIMIT 10;`,

  // Q19: Point lookup
  `SELECT UserID FROM hits WHERE UserID = 435090932899640449;`,

  // Q20: LIKE filter
  `SELECT COUNT(*) FROM hits WHERE URL LIKE '%google%';`,

  // Q21: LIKE with group by
  `SELECT SearchPhrase, MIN(URL), COUNT(*) AS c FROM hits WHERE URL LIKE '%google%' AND SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY c DESC LIMIT 10;`,

  // Q22: Complex LIKE filter
  `SELECT SearchPhrase, MIN(URL), MIN(Title), COUNT(*) AS c, COUNT(DISTINCT UserID) FROM hits WHERE Title LIKE '%Google%' AND URL NOT LIKE '%.google.%' AND SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY c DESC LIMIT 10;`,

  // Q23: SELECT * with LIKE and order
  `SELECT * FROM hits WHERE URL LIKE '%google%' ORDER BY EventTime LIMIT 10;`,

  // Q24: Simple order by
  `SELECT SearchPhrase FROM hits WHERE SearchPhrase <> '' ORDER BY EventTime LIMIT 10;`,

  // Q25: Order by string column
  `SELECT SearchPhrase FROM hits WHERE SearchPhrase <> '' ORDER BY SearchPhrase LIMIT 10;`,

  // Q26: Multiple order by columns
  `SELECT SearchPhrase FROM hits WHERE SearchPhrase <> '' ORDER BY EventTime, SearchPhrase LIMIT 10;`,

  // Q27: HAVING clause with string function
  `SELECT CounterID, AVG(STRLEN(URL)) AS l, COUNT(*) AS c FROM hits WHERE URL <> '' GROUP BY CounterID HAVING COUNT(*) > 100000 ORDER BY l DESC LIMIT 25;`,

  // Q28: REGEXP with group by (DuckDB syntax)
  `SELECT REGEXP_REPLACE(Referer, '^https?://(?:www\\.)?([^/]+)/.*$', '\\1') AS k, AVG(STRLEN(Referer)) AS l, COUNT(*) AS c, MIN(Referer) FROM hits WHERE Referer <> '' GROUP BY k HAVING COUNT(*) > 100000 ORDER BY l DESC LIMIT 25;`,

  // Q29: Many column aggregation (simplified from original 90-column version)
  `SELECT SUM(ResolutionWidth), SUM(ResolutionWidth + 1), SUM(ResolutionWidth + 2), SUM(ResolutionWidth + 3), SUM(ResolutionWidth + 4), SUM(ResolutionWidth + 5), SUM(ResolutionWidth + 6), SUM(ResolutionWidth + 7), SUM(ResolutionWidth + 8), SUM(ResolutionWidth + 9), SUM(ResolutionWidth + 10), SUM(ResolutionWidth + 11), SUM(ResolutionWidth + 12), SUM(ResolutionWidth + 13), SUM(ResolutionWidth + 14), SUM(ResolutionWidth + 15), SUM(ResolutionWidth + 16), SUM(ResolutionWidth + 17), SUM(ResolutionWidth + 18), SUM(ResolutionWidth + 19), SUM(ResolutionWidth + 20), SUM(ResolutionWidth + 21), SUM(ResolutionWidth + 22), SUM(ResolutionWidth + 23), SUM(ResolutionWidth + 24), SUM(ResolutionWidth + 25), SUM(ResolutionWidth + 26), SUM(ResolutionWidth + 27), SUM(ResolutionWidth + 28), SUM(ResolutionWidth + 29), SUM(ResolutionWidth + 30), SUM(ResolutionWidth + 31), SUM(ResolutionWidth + 32), SUM(ResolutionWidth + 33), SUM(ResolutionWidth + 34), SUM(ResolutionWidth + 35), SUM(ResolutionWidth + 36), SUM(ResolutionWidth + 37), SUM(ResolutionWidth + 38), SUM(ResolutionWidth + 39), SUM(ResolutionWidth + 40), SUM(ResolutionWidth + 41), SUM(ResolutionWidth + 42), SUM(ResolutionWidth + 43), SUM(ResolutionWidth + 44), SUM(ResolutionWidth + 45), SUM(ResolutionWidth + 46), SUM(ResolutionWidth + 47), SUM(ResolutionWidth + 48), SUM(ResolutionWidth + 49), SUM(ResolutionWidth + 50), SUM(ResolutionWidth + 51), SUM(ResolutionWidth + 52), SUM(ResolutionWidth + 53), SUM(ResolutionWidth + 54), SUM(ResolutionWidth + 55), SUM(ResolutionWidth + 56), SUM(ResolutionWidth + 57), SUM(ResolutionWidth + 58), SUM(ResolutionWidth + 59), SUM(ResolutionWidth + 60), SUM(ResolutionWidth + 61), SUM(ResolutionWidth + 62), SUM(ResolutionWidth + 63), SUM(ResolutionWidth + 64), SUM(ResolutionWidth + 65), SUM(ResolutionWidth + 66), SUM(ResolutionWidth + 67), SUM(ResolutionWidth + 68), SUM(ResolutionWidth + 69), SUM(ResolutionWidth + 70), SUM(ResolutionWidth + 71), SUM(ResolutionWidth + 72), SUM(ResolutionWidth + 73), SUM(ResolutionWidth + 74), SUM(ResolutionWidth + 75), SUM(ResolutionWidth + 76), SUM(ResolutionWidth + 77), SUM(ResolutionWidth + 78), SUM(ResolutionWidth + 79), SUM(ResolutionWidth + 80), SUM(ResolutionWidth + 81), SUM(ResolutionWidth + 82), SUM(ResolutionWidth + 83), SUM(ResolutionWidth + 84), SUM(ResolutionWidth + 85), SUM(ResolutionWidth + 86), SUM(ResolutionWidth + 87), SUM(ResolutionWidth + 88), SUM(ResolutionWidth + 89) FROM hits;`,

  // Q30: Group by with multiple aggregations
  `SELECT SearchEngineID, ClientIP, COUNT(*) AS c, SUM(IsRefresh), AVG(ResolutionWidth) FROM hits WHERE SearchPhrase <> '' GROUP BY SearchEngineID, ClientIP ORDER BY c DESC LIMIT 10;`,

  // Q31: High cardinality group by
  `SELECT WatchID, ClientIP, COUNT(*) AS c, SUM(IsRefresh), AVG(ResolutionWidth) FROM hits WHERE SearchPhrase <> '' GROUP BY WatchID, ClientIP ORDER BY c DESC LIMIT 10;`,

  // Q32: Very high cardinality group by
  `SELECT WatchID, ClientIP, COUNT(*) AS c, SUM(IsRefresh), AVG(ResolutionWidth) FROM hits GROUP BY WatchID, ClientIP ORDER BY c DESC LIMIT 10;`,

  // Q33: URL grouping
  `SELECT URL, COUNT(*) AS c FROM hits GROUP BY URL ORDER BY c DESC LIMIT 10;`,

  // Q34: Constant and URL grouping
  `SELECT 1, URL, COUNT(*) AS c FROM hits GROUP BY 1, URL ORDER BY c DESC LIMIT 10;`,

  // Q35: ClientIP arithmetic
  `SELECT ClientIP, ClientIP - 1, ClientIP - 2, ClientIP - 3, COUNT(*) AS c FROM hits GROUP BY ClientIP, ClientIP - 1, ClientIP - 2, ClientIP - 3 ORDER BY c DESC LIMIT 10;`,

  // Q36: Date range filter - URL stats
  `SELECT URL, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND DontCountHits = 0 AND IsRefresh = 0 AND URL <> '' GROUP BY URL ORDER BY PageViews DESC LIMIT 10;`,

  // Q37: Date range filter - Title stats
  `SELECT Title, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND DontCountHits = 0 AND IsRefresh = 0 AND Title <> '' GROUP BY Title ORDER BY PageViews DESC LIMIT 10;`,

  // Q38: Date range with offset
  `SELECT URL, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND IsRefresh = 0 AND IsLink <> 0 AND IsDownload = 0 GROUP BY URL ORDER BY PageViews DESC LIMIT 10 OFFSET 1000;`,

  // Q39: Complex traffic source analysis
  `SELECT TraficSourceID, SearchEngineID, AdvEngineID, CASE WHEN (SearchEngineID = 0 AND AdvEngineID = 0) THEN Referer ELSE '' END AS Src, URL AS Dst, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND IsRefresh = 0 GROUP BY TraficSourceID, SearchEngineID, AdvEngineID, Src, Dst ORDER BY PageViews DESC LIMIT 10 OFFSET 1000;`,

  // Q40: URL hash analysis
  `SELECT URLHash, EventDate, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND IsRefresh = 0 AND TraficSourceID IN (-1, 6) AND RefererHash = 3594120000172545465 GROUP BY URLHash, EventDate ORDER BY PageViews DESC LIMIT 10 OFFSET 100;`,

  // Q41: Window dimensions
  `SELECT WindowClientWidth, WindowClientHeight, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND IsRefresh = 0 AND DontCountHits = 0 AND URLHash = 2868770270353813622 GROUP BY WindowClientWidth, WindowClientHeight ORDER BY PageViews DESC LIMIT 10 OFFSET 10000;`,

  // Q42: Time series aggregation
  `SELECT DATE_TRUNC('minute', EventTime) AS M, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-14' AND EventDate <= '2013-07-15' AND IsRefresh = 0 AND DontCountHits = 0 GROUP BY DATE_TRUNC('minute', EventTime) ORDER BY DATE_TRUNC('minute', EventTime) LIMIT 10 OFFSET 1000;`,
];

/**
 * Query metadata for categorization and documentation.
 */
export const QUERY_METADATA: Array<{
  id: number;
  name: string;
  category: string;
  description: string;
}> = [
  { id: 0, name: 'Q0', category: 'simple', description: 'COUNT(*)' },
  { id: 1, name: 'Q1', category: 'filter', description: 'COUNT(*) with filter' },
  { id: 2, name: 'Q2', category: 'aggregation', description: 'SUM, COUNT, AVG' },
  { id: 3, name: 'Q3', category: 'aggregation', description: 'AVG on BIGINT' },
  { id: 4, name: 'Q4', category: 'aggregation', description: 'COUNT DISTINCT UserID' },
  { id: 5, name: 'Q5', category: 'aggregation', description: 'COUNT DISTINCT SearchPhrase' },
  { id: 6, name: 'Q6', category: 'aggregation', description: 'MIN/MAX dates' },
  { id: 7, name: 'Q7', category: 'group', description: 'GROUP BY with filter' },
  { id: 8, name: 'Q8', category: 'group', description: 'GROUP BY with COUNT DISTINCT' },
  { id: 9, name: 'Q9', category: 'group', description: 'Multi-aggregation GROUP BY' },
  { id: 10, name: 'Q10', category: 'group', description: 'Mobile model popularity' },
  { id: 11, name: 'Q11', category: 'group', description: 'Two-column GROUP BY' },
  { id: 12, name: 'Q12', category: 'group', description: 'SearchPhrase popularity' },
  { id: 13, name: 'Q13', category: 'group', description: 'SearchPhrase distinct users' },
  { id: 14, name: 'Q14', category: 'group', description: 'Search engine phrases' },
  { id: 15, name: 'Q15', category: 'group', description: 'User activity' },
  { id: 16, name: 'Q16', category: 'group', description: 'User search phrases' },
  { id: 17, name: 'Q17', category: 'group', description: 'User search (no order)' },
  { id: 18, name: 'Q18', category: 'complex', description: 'Time extraction GROUP BY' },
  { id: 19, name: 'Q19', category: 'filter', description: 'Point lookup' },
  { id: 20, name: 'Q20', category: 'filter', description: 'LIKE filter' },
  { id: 21, name: 'Q21', category: 'complex', description: 'LIKE with GROUP BY' },
  { id: 22, name: 'Q22', category: 'complex', description: 'Complex LIKE filter' },
  { id: 23, name: 'Q23', category: 'filter', description: 'SELECT * with LIKE' },
  { id: 24, name: 'Q24', category: 'filter', description: 'ORDER BY time' },
  { id: 25, name: 'Q25', category: 'filter', description: 'ORDER BY string' },
  { id: 26, name: 'Q26', category: 'filter', description: 'Multi-column ORDER BY' },
  { id: 27, name: 'Q27', category: 'complex', description: 'HAVING with string func' },
  { id: 28, name: 'Q28', category: 'complex', description: 'REGEXP GROUP BY' },
  { id: 29, name: 'Q29', category: 'aggregation', description: '90-column aggregation' },
  { id: 30, name: 'Q30', category: 'group', description: 'Multi-agg GROUP BY' },
  { id: 31, name: 'Q31', category: 'group', description: 'High cardinality' },
  { id: 32, name: 'Q32', category: 'group', description: 'Very high cardinality' },
  { id: 33, name: 'Q33', category: 'group', description: 'URL grouping' },
  { id: 34, name: 'Q34', category: 'group', description: 'Constant grouping' },
  { id: 35, name: 'Q35', category: 'group', description: 'ClientIP arithmetic' },
  { id: 36, name: 'Q36', category: 'complex', description: 'Date range URL stats' },
  { id: 37, name: 'Q37', category: 'complex', description: 'Date range Title stats' },
  { id: 38, name: 'Q38', category: 'complex', description: 'Date range with OFFSET' },
  { id: 39, name: 'Q39', category: 'complex', description: 'Traffic source analysis' },
  { id: 40, name: 'Q40', category: 'complex', description: 'URL hash analysis' },
  { id: 41, name: 'Q41', category: 'complex', description: 'Window dimensions' },
  { id: 42, name: 'Q42', category: 'complex', description: 'Time series aggregation' },
];

// ============================================================================
// TYPES
// ============================================================================

interface QueryResult {
  queryId: number;
  coldRunMs: number | null;
  hotRunsMs: (number | null)[];
  error?: string;
  rowCount?: number;
}

interface BenchmarkConfig {
  coldRuns: number;
  hotRuns: number;
  timeoutMs: number;
  outputPath: string | null;
  format: 'clickbench' | 'json' | 'markdown';
  queries: number[] | null;
  skipQueries: number[];
  backend: 'duckdb' | 'chdb';
  dataPath: string;
  verbose: boolean;
}

interface BenchmarkResults {
  config: BenchmarkConfig;
  results: QueryResult[];
  metadata: {
    startTime: string;
    endTime: string;
    totalDurationMs: number;
    backend: string;
    dataPath: string;
    platform: string;
  };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: BenchmarkConfig = {
  coldRuns: 1,
  hotRuns: 3,
  timeoutMs: 300000, // 5 minutes
  outputPath: null,
  format: 'clickbench',
  queries: null,
  skipQueries: [],
  backend: 'duckdb',
  dataPath: './data/clickbench/hits.parquet',
  verbose: false,
};

function parseArgs(args: string[]): BenchmarkConfig {
  const config = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--cold-runs':
        config.coldRuns = parseInt(args[++i], 10);
        break;
      case '--hot-runs':
        config.hotRuns = parseInt(args[++i], 10);
        break;
      case '--timeout':
        config.timeoutMs = parseInt(args[++i], 10);
        break;
      case '--output':
      case '-o':
        config.outputPath = args[++i];
        break;
      case '--format':
      case '-f':
        config.format = args[++i] as BenchmarkConfig['format'];
        break;
      case '--queries':
      case '-q':
        config.queries = args[++i].split(',').map((s) => parseInt(s.trim(), 10));
        break;
      case '--skip':
        config.skipQueries = args[++i].split(',').map((s) => parseInt(s.trim(), 10));
        break;
      case '--backend':
      case '-b':
        config.backend = args[++i] as BenchmarkConfig['backend'];
        break;
      case '--data-path':
      case '-d':
        config.dataPath = args[++i];
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
ClickBench Benchmark Runner

Runs the official 43 ClickBench queries against chdb-wasm or DuckDB-WASM.

USAGE:
  npx tsx benchmarks/run-clickbench.ts [OPTIONS]

OPTIONS:
  --cold-runs N       Number of cold runs (default: 1)
  --hot-runs N        Number of hot runs (default: 3)
  --timeout MS        Query timeout in milliseconds (default: 300000)
  --output, -o FILE   Output file path (default: stdout)
  --format, -f FMT    Output format: clickbench | json | markdown (default: clickbench)
  --queries, -q IDS   Run specific queries (comma-separated, e.g., 0,1,5,10)
  --skip IDS          Skip specific queries (comma-separated)
  --backend, -b TYPE  Backend: duckdb | chdb (default: duckdb)
  --data-path, -d     Path to hits.parquet file
  --verbose, -v       Enable verbose logging
  --help, -h          Show this help message

OUTPUT FORMATS:
  clickbench    ClickBench-compatible format (3 times per query, comma-separated)
  json          Detailed JSON with all metadata
  markdown      Human-readable markdown table

EXAMPLES:
  # Run all queries with default settings
  npx tsx benchmarks/run-clickbench.ts

  # Run specific queries with more iterations
  npx tsx benchmarks/run-clickbench.ts --queries 0,1,2,3,4 --hot-runs 5

  # Output JSON results to file
  npx tsx benchmarks/run-clickbench.ts -f json -o results.json

  # Use custom data path
  npx tsx benchmarks/run-clickbench.ts --data-path /path/to/hits.parquet

PERFORMANCE TARGETS (DuckDB-WASM reference):
  Q0  (COUNT(*)):           ~1-2 seconds
  Q4  (COUNT DISTINCT):     ~5-10 seconds
  Q20 (LIKE filter):        ~3-5 seconds
  Q29 (90-col aggregation): ~2-5 seconds

  Total benchmark: ~5-15 minutes depending on hardware
`);
}

// ============================================================================
// LOGGING
// ============================================================================

function log(config: BenchmarkConfig, message: string): void {
  if (config.verbose) {
    console.error(`[${new Date().toISOString()}] ${message}`);
  }
}

function logProgress(queryId: number, total: number, status: string): void {
  const progress = `[${queryId + 1}/${total}]`;
  console.error(`${progress} Q${queryId}: ${status}`);
}

// ============================================================================
// DATABASE ABSTRACTION
// ============================================================================

interface DatabaseBackend {
  init(config: BenchmarkConfig): Promise<void>;
  query(sql: string): Promise<{ rows: number; durationMs: number }>;
  dispose(): Promise<void>;
}

/**
 * DuckDB backend using DuckDB-WASM or native DuckDB.
 */
class DuckDBBackend implements DatabaseBackend {
  private db: any;
  private conn: any;
  private dataPath: string = '';

  async init(config: BenchmarkConfig): Promise<void> {
    this.dataPath = config.dataPath;

    // Try to use native DuckDB CLI for better performance
    // In WASM environment, this would use DuckDB-WASM
    try {
      const duckdb = await import('duckdb');
      this.db = new duckdb.Database(':memory:');
      this.conn = this.db.connect();

      // Create view to the parquet file
      log(config, `Creating view from ${this.dataPath}`);
      await this.runQuery(`CREATE VIEW hits AS SELECT * FROM read_parquet('${this.dataPath}')`);
      log(config, 'View created successfully');
    } catch (error) {
      throw new Error(`Failed to initialize DuckDB: ${error}`);
    }
  }

  private runQuery(sql: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.conn.all(sql, (err: Error | null, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async query(sql: string): Promise<{ rows: number; durationMs: number }> {
    const start = performance.now();
    const rows = await this.runQuery(sql);
    const durationMs = performance.now() - start;
    return { rows: rows.length, durationMs };
  }

  async dispose(): Promise<void> {
    if (this.conn) this.conn.close();
    if (this.db) this.db.close();
  }
}

/**
 * Mock backend for testing without actual database.
 */
class MockBackend implements DatabaseBackend {
  async init(_config: BenchmarkConfig): Promise<void> {
    console.error('Using mock backend - no actual queries will be executed');
  }

  async query(_sql: string): Promise<{ rows: number; durationMs: number }> {
    // Simulate query execution
    const simulatedTime = Math.random() * 1000 + 100;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { rows: 100, durationMs: simulatedTime };
  }

  async dispose(): Promise<void> {}
}

function createBackend(config: BenchmarkConfig): DatabaseBackend {
  switch (config.backend) {
    case 'duckdb':
      return new DuckDBBackend();
    case 'chdb':
      // TODO: Implement chdb backend when WASM is ready
      console.error('chdb backend not yet implemented, using DuckDB');
      return new DuckDBBackend();
    default:
      return new MockBackend();
  }
}

// ============================================================================
// BENCHMARK EXECUTION
// ============================================================================

async function runQuery(
  backend: DatabaseBackend,
  queryId: number,
  config: BenchmarkConfig
): Promise<QueryResult> {
  const sql = CLICKBENCH_QUERIES[queryId];
  const result: QueryResult = {
    queryId,
    coldRunMs: null,
    hotRunsMs: [],
  };

  try {
    // Cold run(s)
    for (let i = 0; i < config.coldRuns; i++) {
      log(config, `  Cold run ${i + 1}/${config.coldRuns}`);
      const { rows, durationMs } = await executeWithTimeout(backend, sql, config.timeoutMs);
      result.coldRunMs = durationMs;
      result.rowCount = rows;
    }

    // Hot runs
    for (let i = 0; i < config.hotRuns; i++) {
      log(config, `  Hot run ${i + 1}/${config.hotRuns}`);
      const { durationMs } = await executeWithTimeout(backend, sql, config.timeoutMs);
      result.hotRunsMs.push(durationMs);
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

async function executeWithTimeout(
  backend: DatabaseBackend,
  sql: string,
  timeoutMs: number
): Promise<{ rows: number; durationMs: number }> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Query timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([backend.query(sql), timeoutPromise]);
}

async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResults> {
  const startTime = new Date();
  const results: QueryResult[] = [];

  // Determine which queries to run
  let queryIds: number[];
  if (config.queries) {
    queryIds = config.queries.filter((id) => !config.skipQueries.includes(id));
  } else {
    queryIds = Array.from({ length: CLICKBENCH_QUERIES.length }, (_, i) => i).filter(
      (id) => !config.skipQueries.includes(id)
    );
  }

  console.error(`Running ${queryIds.length} ClickBench queries`);
  console.error(`Backend: ${config.backend}`);
  console.error(`Data: ${config.dataPath}`);
  console.error(`Cold runs: ${config.coldRuns}, Hot runs: ${config.hotRuns}`);
  console.error('');

  // Initialize backend
  const backend = createBackend(config);
  try {
    await backend.init(config);

    // Run queries
    for (const queryId of queryIds) {
      const meta = QUERY_METADATA[queryId];
      logProgress(queryId, queryIds.length, `${meta.description}...`);

      const result = await runQuery(backend, queryId, config);
      results.push(result);

      // Log result
      if (result.error) {
        logProgress(queryId, queryIds.length, `FAILED: ${result.error}`);
      } else {
        const coldMs = result.coldRunMs?.toFixed(2) ?? 'N/A';
        const hotMs = result.hotRunsMs.length > 0
          ? result.hotRunsMs[0]?.toFixed(2)
          : 'N/A';
        logProgress(queryId, queryIds.length, `Cold: ${coldMs}ms, Hot: ${hotMs}ms`);
      }
    }
  } finally {
    await backend.dispose();
  }

  const endTime = new Date();

  return {
    config,
    results,
    metadata: {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      totalDurationMs: endTime.getTime() - startTime.getTime(),
      backend: config.backend,
      dataPath: config.dataPath,
      platform: typeof process !== 'undefined' ? `Node.js ${process.version}` : 'Browser',
    },
  };
}

// ============================================================================
// OUTPUT FORMATTING
// ============================================================================

/**
 * Format results in ClickBench-compatible format.
 * Each line: cold_run, hot_run_1, hot_run_2 (times in seconds)
 */
function formatClickBench(results: BenchmarkResults): string {
  const lines: string[] = [];

  for (let i = 0; i < CLICKBENCH_QUERIES.length; i++) {
    const result = results.results.find((r) => r.queryId === i);

    if (!result || result.error) {
      // Failed or skipped query
      lines.push('null,null,null');
    } else {
      // Convert milliseconds to seconds
      const cold = result.coldRunMs !== null ? (result.coldRunMs / 1000).toFixed(3) : 'null';
      const hot1 = result.hotRunsMs[0] !== null && result.hotRunsMs[0] !== undefined
        ? (result.hotRunsMs[0] / 1000).toFixed(3)
        : 'null';
      const hot2 = result.hotRunsMs[1] !== null && result.hotRunsMs[1] !== undefined
        ? (result.hotRunsMs[1] / 1000).toFixed(3)
        : 'null';
      lines.push(`${cold},${hot1},${hot2}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format results as JSON.
 */
function formatJson(results: BenchmarkResults): string {
  return JSON.stringify(results, null, 2);
}

/**
 * Format results as markdown table.
 */
function formatMarkdown(results: BenchmarkResults): string {
  const lines: string[] = [
    '# ClickBench Results',
    '',
    `**Backend:** ${results.metadata.backend}`,
    `**Data:** ${results.metadata.dataPath}`,
    `**Date:** ${results.metadata.startTime}`,
    `**Total Duration:** ${(results.metadata.totalDurationMs / 1000).toFixed(2)}s`,
    '',
    '## Query Results',
    '',
    '| Query | Description | Cold (s) | Hot 1 (s) | Hot 2 (s) | Status |',
    '|-------|-------------|----------|-----------|-----------|--------|',
  ];

  for (const result of results.results) {
    const meta = QUERY_METADATA[result.queryId];
    const cold = result.coldRunMs !== null ? (result.coldRunMs / 1000).toFixed(3) : '-';
    const hot1 = result.hotRunsMs[0] !== null && result.hotRunsMs[0] !== undefined
      ? (result.hotRunsMs[0] / 1000).toFixed(3)
      : '-';
    const hot2 = result.hotRunsMs[1] !== null && result.hotRunsMs[1] !== undefined
      ? (result.hotRunsMs[1] / 1000).toFixed(3)
      : '-';
    const status = result.error ? `Error: ${result.error.slice(0, 20)}` : 'OK';

    lines.push(`| Q${result.queryId} | ${meta.description} | ${cold} | ${hot1} | ${hot2} | ${status} |`);
  }

  // Summary statistics
  const successful = results.results.filter((r) => !r.error);
  const totalCold = successful.reduce((sum, r) => sum + (r.coldRunMs ?? 0), 0);
  const totalHot = successful.reduce((sum, r) => sum + (r.hotRunsMs[0] ?? 0), 0);

  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Queries Run:** ${results.results.length}`);
  lines.push(`- **Successful:** ${successful.length}`);
  lines.push(`- **Failed:** ${results.results.length - successful.length}`);
  lines.push(`- **Total Cold Time:** ${(totalCold / 1000).toFixed(2)}s`);
  lines.push(`- **Total Hot Time:** ${(totalHot / 1000).toFixed(2)}s`);

  return lines.join('\n');
}

function formatResults(results: BenchmarkResults, format: BenchmarkConfig['format']): string {
  switch (format) {
    case 'clickbench':
      return formatClickBench(results);
    case 'json':
      return formatJson(results);
    case 'markdown':
      return formatMarkdown(results);
    default:
      return formatClickBench(results);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = parseArgs(args);

  try {
    const results = await runBenchmark(config);
    const output = formatResults(results, config.format);

    if (config.outputPath) {
      const outputDir = path.dirname(config.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.writeFileSync(config.outputPath, output);
      console.error(`\nResults written to: ${config.outputPath}`);
    } else {
      console.log(output);
    }

    // Exit with error if any queries failed
    const failed = results.results.filter((r) => r.error);
    if (failed.length > 0) {
      console.error(`\n${failed.length} queries failed.`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
main().catch(console.error);

// Export for programmatic use
export {
  runBenchmark,
  CLICKBENCH_QUERIES as queries,
  QUERY_METADATA as queryMetadata,
  type BenchmarkConfig,
  type BenchmarkResults,
  type QueryResult,
};
