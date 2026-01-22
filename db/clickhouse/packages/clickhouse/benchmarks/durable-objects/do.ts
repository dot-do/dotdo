/**
 * Benchmark Durable Object for ClickHouse/chdb-wasm
 *
 * This Durable Object provides persistent, warm WASM instances for benchmarking
 * chdb-wasm performance on Cloudflare's edge infrastructure.
 *
 * Key features:
 * - Single WASM initialization per DO instance (stays warm)
 * - Cold start vs warm query timing measurement
 * - Supports all 43 ClickBench queries
 * - Memory-efficient singleton pattern
 */

import { benchmarkConfig } from '../config';

/**
 * Environment bindings for the Durable Object
 */
export interface Env {
  /** Durable Object namespace binding */
  BENCHMARK_DO: DurableObjectNamespace;
  /** R2 bucket for benchmark data (optional) */
  R2_DATA?: R2Bucket;
  /** KV namespace for caching results (optional) */
  BENCHMARK_CACHE?: KVNamespace;
}

/**
 * chdb-wasm instance interface
 * Matches the expected API from @dotdo/chdb-wasm
 */
export interface ChdbInstance {
  /** Execute a SQL query and return JSON result */
  query(sql: string, format?: string): Promise<string>;
  /** Close the instance and free resources */
  close(): void;
}

/**
 * Function to create a chdb instance
 * This should be imported from @dotdo/chdb-wasm in production
 */
export type CreateChdbFn = () => Promise<ChdbInstance>;

/**
 * Query result returned by the Durable Object
 */
export interface DOQueryResult {
  /** Query index (0-42) */
  query: number;
  /** Execution time in milliseconds */
  elapsed: number;
  /** Number of rows returned */
  rows: number;
  /** Whether this was a warm query (WASM already initialized) */
  warm: boolean;
  /** WASM initialization time (only set on cold start) */
  initTime?: number;
  /** Error message if query failed */
  error?: string;
  /** Timestamp of query execution */
  timestamp: string;
}

/**
 * Batch query request
 */
export interface BatchQueryRequest {
  /** Array of query indices to run */
  queries: number[];
  /** Number of times to run each query */
  runs?: number;
}

/**
 * Batch query response
 */
export interface BatchQueryResponse {
  /** Results for each query run */
  results: DOQueryResult[];
  /** Total elapsed time for all queries */
  totalElapsed: number;
  /** Whether WASM was warm at start */
  wasWarm: boolean;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  /** Whether the DO is healthy */
  ok: boolean;
  /** Whether WASM is initialized */
  wasmInitialized: boolean;
  /** Uptime in milliseconds (since WASM init) */
  uptime?: number;
  /** Memory usage if available */
  memoryUsage?: number;
}

/**
 * Benchmark Durable Object
 *
 * Provides a persistent WASM instance for running ClickBench queries.
 * The WASM instance is lazily initialized on first request and stays warm
 * for subsequent requests, enabling accurate cold vs warm benchmarking.
 */
export class BenchmarkDO implements DurableObject {
  /** Singleton chdb-wasm instance */
  private chdb: ChdbInstance | null = null;

  /** Timestamp when WASM was initialized */
  private initTimestamp: number | null = null;

  /** WASM initialization time in milliseconds */
  private wasmInitTime: number = 0;

  /** Request counter for metrics */
  private requestCount: number = 0;

  constructor(
    private state: DurableObjectState,
    private env: Env
  ) {}

  /**
   * Initialize the chdb-wasm instance
   * This is called lazily on first query request
   */
  private async initializeWasm(): Promise<number> {
    if (this.chdb) {
      return 0; // Already initialized
    }

    const initStart = performance.now();

    try {
      // Dynamic import to allow for different chdb-wasm implementations
      // In production, use: import { createChdb } from '@dotdo/chdb-wasm';
      const { createChdb } = await import('@dotdo/chdb-wasm');
      this.chdb = await createChdb();
      this.initTimestamp = Date.now();
      this.wasmInitTime = performance.now() - initStart;

      console.log(`[BenchmarkDO] WASM initialized in ${this.wasmInitTime.toFixed(2)}ms`);

      return this.wasmInitTime;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[BenchmarkDO] WASM initialization failed: ${errorMessage}`);
      throw new Error(`WASM initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Handle incoming fetch requests
   */
  async fetch(request: Request): Promise<Response> {
    this.requestCount++;

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Route requests based on path
      switch (path) {
        case '/query':
          return await this.handleQuery(url);

        case '/batch':
          return await this.handleBatch(request);

        case '/health':
          return this.handleHealth();

        case '/reset':
          return await this.handleReset();

        case '/stats':
          return this.handleStats();

        default:
          return new Response(
            JSON.stringify({
              error: 'Not Found',
              availableEndpoints: ['/query', '/batch', '/health', '/reset', '/stats'],
            }),
            {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            }
          );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[BenchmarkDO] Request error: ${errorMessage}`);

      return new Response(
        JSON.stringify({
          error: errorMessage,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  /**
   * Handle single query request
   * GET /query?q=<index>
   */
  private async handleQuery(url: URL): Promise<Response> {
    const queryIndexStr = url.searchParams.get('q') || '0';
    const queryIndex = parseInt(queryIndexStr, 10);

    if (isNaN(queryIndex) || queryIndex < 0 || queryIndex >= benchmarkConfig.queries.length) {
      return new Response(
        JSON.stringify({
          error: `Invalid query index: ${queryIndexStr}. Valid range: 0-${benchmarkConfig.queries.length - 1}`,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if WASM was already warm
    const wasWarm = this.chdb !== null;

    // Initialize WASM if needed (lazy initialization)
    let initTime: number | undefined;
    if (!this.chdb) {
      initTime = await this.initializeWasm();
    }

    const query = benchmarkConfig.queries[queryIndex];

    // Execute the query
    const start = performance.now();
    let result: DOQueryResult;

    try {
      const queryResult = await this.chdb!.query(query, 'JSON');
      const elapsed = performance.now() - start;
      const parsedResult = JSON.parse(queryResult);

      result = {
        query: queryIndex,
        elapsed,
        rows: Array.isArray(parsedResult) ? parsedResult.length : (parsedResult.rows ?? 0),
        warm: wasWarm,
        initTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const elapsed = performance.now() - start;
      const errorMessage = error instanceof Error ? error.message : String(error);

      result = {
        query: queryIndex,
        elapsed,
        rows: 0,
        warm: wasWarm,
        initTime,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      };
    }

    return Response.json(result);
  }

  /**
   * Handle batch query request
   * POST /batch with JSON body { queries: number[], runs?: number }
   */
  private async handleBatch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed. Use POST.' }),
        {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    let body: BatchQueryRequest;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const { queries, runs = 1 } = body;

    if (!Array.isArray(queries) || queries.length === 0) {
      return new Response(
        JSON.stringify({ error: 'queries must be a non-empty array of query indices' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate all query indices
    for (const idx of queries) {
      if (typeof idx !== 'number' || idx < 0 || idx >= benchmarkConfig.queries.length) {
        return new Response(
          JSON.stringify({
            error: `Invalid query index: ${idx}. Valid range: 0-${benchmarkConfig.queries.length - 1}`,
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    const wasWarm = this.chdb !== null;

    // Initialize WASM if needed
    if (!this.chdb) {
      await this.initializeWasm();
    }

    const results: DOQueryResult[] = [];
    const batchStart = performance.now();

    // Run each query the specified number of times
    for (let run = 0; run < runs; run++) {
      for (const queryIndex of queries) {
        const query = benchmarkConfig.queries[queryIndex];
        const start = performance.now();

        try {
          const queryResult = await this.chdb!.query(query, 'JSON');
          const elapsed = performance.now() - start;
          const parsedResult = JSON.parse(queryResult);

          results.push({
            query: queryIndex,
            elapsed,
            rows: Array.isArray(parsedResult) ? parsedResult.length : (parsedResult.rows ?? 0),
            warm: true, // After first query, all are warm
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          const elapsed = performance.now() - start;
          const errorMessage = error instanceof Error ? error.message : String(error);

          results.push({
            query: queryIndex,
            elapsed,
            rows: 0,
            warm: true,
            error: errorMessage,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    const totalElapsed = performance.now() - batchStart;

    const response: BatchQueryResponse = {
      results,
      totalElapsed,
      wasWarm,
    };

    return Response.json(response);
  }

  /**
   * Handle health check request
   * GET /health
   */
  private handleHealth(): Response {
    const response: HealthCheckResponse = {
      ok: true,
      wasmInitialized: this.chdb !== null,
      uptime: this.initTimestamp ? Date.now() - this.initTimestamp : undefined,
    };

    return Response.json(response);
  }

  /**
   * Handle reset request - reinitialize WASM
   * POST /reset
   */
  private async handleReset(): Promise<Response> {
    if (this.chdb) {
      try {
        this.chdb.close();
      } catch (error) {
        console.error('[BenchmarkDO] Error closing WASM instance:', error);
      }
      this.chdb = null;
      this.initTimestamp = null;
      this.wasmInitTime = 0;
    }

    return Response.json({
      ok: true,
      message: 'WASM instance reset. Will reinitialize on next query.',
    });
  }

  /**
   * Handle stats request
   * GET /stats
   */
  private handleStats(): Response {
    return Response.json({
      requestCount: this.requestCount,
      wasmInitialized: this.chdb !== null,
      wasmInitTime: this.wasmInitTime,
      uptime: this.initTimestamp ? Date.now() - this.initTimestamp : null,
      queryCount: benchmarkConfig.queries.length,
    });
  }
}

/**
 * Worker entrypoint that routes requests to the Durable Object
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Get or create DO instance
    // Using a fixed ID means all requests go to the same DO instance
    // For distributed benchmarks, use different IDs or location hints
    const doId = url.searchParams.get('do_id') || 'default-benchmark';
    const id = env.BENCHMARK_DO.idFromName(doId);

    // Optional: Use location hints for geo-distributed testing
    // const id = env.BENCHMARK_DO.idFromName(doId, { locationHint: 'weur' });

    const stub = env.BENCHMARK_DO.get(id);

    // Forward the request to the Durable Object
    return stub.fetch(request);
  },
};
