/**
 * ClickBench Benchmark Worker for Cloudflare Workers
 *
 * This worker runs ClickBench queries using chdb-wasm and returns timing metrics.
 * Deploy this worker and use benchmark.ts to run benchmarks against it.
 */

import { createChdb, type ChdbInstance } from '@dotdo/chdb-wasm';
import { benchmarkConfig, getQuery, getQueryCount } from '../config';

/**
 * Environment bindings for the worker
 */
export interface Env {
  /** R2 bucket containing benchmark data */
  BENCHMARK_DATA?: R2Bucket;
  /** Optional: data file path override */
  DATA_PATH?: string;
}

/**
 * Response shape for benchmark queries
 */
interface BenchmarkResponse {
  /** Query index that was executed */
  query: number;
  /** Execution time in milliseconds */
  elapsed: number;
  /** Number of rows returned */
  rows: number;
  /** Query text that was executed */
  sql: string;
  /** Error message if query failed */
  error?: string;
  /** Timestamp when query started */
  timestamp: string;
  /** Worker metadata */
  worker: {
    /** Cloudflare colo/datacenter */
    colo?: string;
    /** Request ID */
    requestId?: string;
  };
}

/**
 * Cached chdb instance for hot runs
 */
let chdbInstance: ChdbInstance | null = null;

/**
 * Initialize or get cached chdb instance
 */
async function getChdb(): Promise<ChdbInstance> {
  if (!chdbInstance) {
    chdbInstance = await createChdb();
  }
  return chdbInstance;
}

/**
 * Parse query result to get row count
 */
function parseResultRows(result: string): number {
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) {
      return parsed.length;
    }
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return Array.isArray(parsed.data) ? parsed.data.length : 0;
    }
    return 0;
  } catch {
    // Result might be in a different format
    return 0;
  }
}

/**
 * Main request handler
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Health check endpoint
  if (url.pathname === '/health' || url.pathname === '/ping') {
    return Response.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      queryCount: getQueryCount(),
    });
  }

  // Info endpoint - returns available queries
  if (url.pathname === '/info') {
    return Response.json({
      name: 'clickbench-worker',
      queryCount: getQueryCount(),
      config: {
        r2Bucket: benchmarkConfig.r2Bucket,
        dataPath: benchmarkConfig.dataPath,
        tableName: benchmarkConfig.tableName,
      },
    });
  }

  // Benchmark endpoint - runs a single query
  if (url.pathname === '/benchmark' || url.pathname === '/') {
    const queryIndexStr = url.searchParams.get('q') || url.searchParams.get('query') || '0';
    const queryIndex = parseInt(queryIndexStr, 10);

    // Validate query index
    if (isNaN(queryIndex) || queryIndex < 0 || queryIndex >= getQueryCount()) {
      return Response.json(
        {
          error: `Invalid query index: ${queryIndexStr}. Must be between 0 and ${getQueryCount() - 1}`,
        },
        { status: 400 }
      );
    }

    const query = getQuery(queryIndex);
    const timestamp = new Date().toISOString();

    // Get Cloudflare metadata from request
    const cf = (request as { cf?: { colo?: string } }).cf;
    const colo = cf?.colo;
    const requestId = request.headers.get('cf-ray') || undefined;

    try {
      const chdb = await getChdb();

      const start = performance.now();
      const result = await chdb.query(query);
      const elapsed = performance.now() - start;

      const rows = parseResultRows(result);

      const response: BenchmarkResponse = {
        query: queryIndex,
        elapsed,
        rows,
        sql: query,
        timestamp,
        worker: {
          colo,
          requestId,
        },
      };

      return Response.json(response);
    } catch (error) {
      const response: BenchmarkResponse = {
        query: queryIndex,
        elapsed: 0,
        rows: 0,
        sql: query,
        error: error instanceof Error ? error.message : String(error),
        timestamp,
        worker: {
          colo,
          requestId,
        },
      };

      return Response.json(response, { status: 500 });
    }
  }

  // Custom query endpoint - runs arbitrary SQL
  if (url.pathname === '/query') {
    const sql = url.searchParams.get('sql');

    if (!sql) {
      return Response.json({ error: 'Missing sql parameter' }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const cf = (request as { cf?: { colo?: string } }).cf;
    const colo = cf?.colo;
    const requestId = request.headers.get('cf-ray') || undefined;

    try {
      const chdb = await getChdb();

      const start = performance.now();
      const result = await chdb.query(sql);
      const elapsed = performance.now() - start;

      const rows = parseResultRows(result);

      return Response.json({
        elapsed,
        rows,
        sql,
        result: JSON.parse(result),
        timestamp,
        worker: {
          colo,
          requestId,
        },
      });
    } catch (error) {
      return Response.json(
        {
          elapsed: 0,
          rows: 0,
          sql,
          error: error instanceof Error ? error.message : String(error),
          timestamp,
          worker: {
            colo,
            requestId,
          },
        },
        { status: 500 }
      );
    }
  }

  return Response.json(
    {
      error: 'Not found',
      endpoints: {
        '/': 'Run benchmark query (use ?q=0 to ?q=42)',
        '/benchmark?q=N': 'Run benchmark query N (0-42)',
        '/query?sql=...': 'Run custom SQL query',
        '/health': 'Health check',
        '/info': 'Worker info and available queries',
      },
    },
    { status: 404 }
  );
}

/**
 * Cloudflare Workers export
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const response = await handleRequest(request, env);

    // Add CORS headers to all responses
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
