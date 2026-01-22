/**
 * Cloudflare Worker for serving chDB WASM binaries via Static Assets
 *
 * This worker handles requests for WASM files and other static assets,
 * applying appropriate caching headers and content types.
 * It also provides the ClickHouse-compatible HTTP query interface.
 */

import { handleHttpQuery, setSqlExecutor, type HttpQueryEnv, type DurableObjectNamespace, type R2Bucket, type SqlExecutor } from './http-query-handler';
import { handleMergeTreeRequest, type MergeTreeRequestEnv } from './mergetree-handler';
import { handleClickBenchRequest, setClickBenchSqlExecutor, type ClickBenchRequestEnv } from './clickbench/handler';
import { handleCollectionsRequest, setCollectionSqlExecutor, type CollectionHandlerEnv } from './collection-handler';
import { handleDocumentRequest, type DocumentApiEnv } from './document-rest-api';
import { handleDocumentApiV1Request, setDocumentApiSqlExecutor, type DocumentApiV1Env } from './document-api-v1';
import { createChdbExecutor, type ChdbBackendEnv, getStreamingLoaderCacheStats } from './chdb-backend';
import { createBundledExecutor } from './bundled-executor';
import { ExtensionLoader, type ExtensionLoaderConfig } from './extension-loader';
import { detectRequiredExtensions, ExtensionFunctionRegistry } from './extension-auto-detect';
import { createLogger, configureLogging } from './utils/logger';
import { isStreamingCompilationAvailable } from './wasm/streaming-loader';
import { createMergeTreeStorage, type MergeTreeStorageManager } from './mergetree-r2-storage';

// Export Durable Object classes for wrangler
export { MergeTreeDO } from './storage/mergetree-do';
export { MemoryEngineDO } from './storage/memory-do';
export { DocumentDBDO } from './storage/document-do';

// Create logger for the worker module
const log = createLogger('worker');

export interface Env {
  // Static assets binding - optional for test mode
  ASSETS?: Fetcher;

  // -----------------------------------------------------------------
  // Durable Object bindings (configured via wrangler.toml)
  // -----------------------------------------------------------------
  // Memory Engine DO - for in-memory tables with DO persistence
  MEMORY_ENGINE_DO?: DurableObjectNamespace;
  // MergeTree DO - for MergeTree table metadata and part management
  MERGETREE_DO?: DurableObjectNamespace;
  // Document DB DO - for MongoDB/Firebase compatibility layer
  // Handles: collections, documents, indexes, realtime subscriptions
  DOCUMENT_DB_DO?: DurableObjectNamespace;

  // -----------------------------------------------------------------
  // R2 Storage bindings (configured via wrangler.toml)
  // -----------------------------------------------------------------
  // Primary data bucket for document DBs and MergeTree parts (hybrid mode)
  DATA_BUCKET?: R2Bucket;
  // WASM bucket for storing the chdb WASM binary
  WASM_BUCKET?: R2Bucket;
  // ClickBench dataset bucket for analytical benchmarks
  CLICKBENCH_BUCKET?: R2Bucket;
  CLICKBENCH_BUCKET_PREVIEW?: R2Bucket;

  // -----------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------
  DEFAULT_DATABASE?: string;
  // Debug mode - set to "true" to enable debug logging
  DEBUG?: string;
}

/**
 * CORS headers for cross-origin WASM loading
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Cache control for immutable WASM binaries (1 year)
 */
const WASM_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Cache control for other assets (1 hour)
 */
const DEFAULT_CACHE_CONTROL = 'public, max-age=3600';

/**
 * Global extension registry for tracking function-to-extension mappings
 */
const extensionRegistry = new ExtensionFunctionRegistry();

/**
 * Track loaded extensions across requests (in-memory for single isolate)
 */
const loadedExtensions: Set<string> = new Set();
const requestedExtensions: Set<string> = new Set();

/**
 * Global SQL executor instance (singleton per isolate)
 */
let globalSqlExecutor: SqlExecutor | null = null;
let executorInitPromise: Promise<SqlExecutor> | null = null;

/**
 * Global MergeTree storage manager (singleton per isolate)
 * Provides access to MergeTree R2 storage and Durable Object coordination
 */
let globalMergeTreeStorage: MergeTreeStorageManager | null = null;

/**
 * Initialize the WASM SQL executor
 *
 * Strategy:
 * 1. If R2 bucket is configured with full ClickHouse WASM, use StreamingWasmLoader
 *    - Uses WebAssembly.compileStreaming() when available for faster loading
 *    - Falls back to ArrayBuffer compilation if streaming not supported
 *    - Caches compiled modules for subsequent requests
 * 2. Fall back to bundled executor.wasm (always available, faster initialization)
 *
 * The bundled executor handles basic SQL queries. For production deployments
 * that need full ClickHouse features, configure WASM_BUCKET with the full binary.
 */
async function initializeSqlExecutor(env: Env): Promise<SqlExecutor | null> {
  // Return existing executor if already initialized
  if (globalSqlExecutor) {
    return globalSqlExecutor;
  }

  // Return pending initialization if in progress
  if (executorInitPromise) {
    return executorInitPromise;
  }

  // Start initialization
  executorInitPromise = (async () => {
    try {
      // Check for WASM bucket (prefer WASM_BUCKET, fall back to DATA_BUCKET)
      const wasmBucket = env.WASM_BUCKET || env.DATA_BUCKET;

      // Log streaming compilation availability
      const streamingAvailable = isStreamingCompilationAvailable();
      log.debug('WASM loading capabilities', {
        streamingCompilationAvailable: streamingAvailable,
        wasmBucketConfigured: !!wasmBucket,
      });

      // Try R2-based executor first if bucket is available
      if (wasmBucket) {
        try {
          log.debug('Attempting to initialize R2-based WASM SQL executor using StreamingWasmLoader...');
          const backendEnv: ChdbBackendEnv = {
            WASM_BUCKET: wasmBucket,
          };
          const executor = await createChdbExecutor(backendEnv);
          globalSqlExecutor = executor;
          setSqlExecutor(executor);
          setCollectionSqlExecutor(executor);
          setDocumentApiSqlExecutor(executor);
          setClickBenchSqlExecutor(executor);

          // Log cache stats after successful initialization
          const cacheStats = getStreamingLoaderCacheStats();
          log.debug('R2-based WASM SQL executor initialized successfully', {
            cacheEntries: cacheStats?.entries ?? 0,
            cachedModules: cacheStats?.keys ?? [],
          });
          return executor;
        } catch (r2Error) {
          log.debug('R2-based executor not available, falling back to bundled executor', {
            error: r2Error instanceof Error ? r2Error.message : String(r2Error)
          });
        }
      }

      // Fall back to bundled executor
      log.debug('Initializing bundled WASM SQL executor...');
      const executor = await createBundledExecutor();
      globalSqlExecutor = executor;
      setSqlExecutor(executor);
      setCollectionSqlExecutor(executor);
      setDocumentApiSqlExecutor(executor);
      setClickBenchSqlExecutor(executor);
      log.debug('Bundled WASM SQL executor initialized successfully');
      return executor;
    } catch (error) {
      log.error('Failed to initialize any WASM SQL executor', {
        error: error instanceof Error ? error.message : String(error)
      });
      executorInitPromise = null;
      throw error;
    }
  })();

  return executorInitPromise;
}

/**
 * Initialize MergeTree R2 storage
 *
 * Creates a MergeTreeStorageManager that coordinates between:
 * - R2 bucket for data file storage (DATA_BUCKET)
 * - Durable Object for metadata and coordination (MERGETREE_DO)
 *
 * This is used for MergeTree tables that persist data to R2.
 */
function initializeMergeTreeStorage(env: Env): MergeTreeStorageManager | null {
  // Return existing storage manager if already initialized
  if (globalMergeTreeStorage) {
    return globalMergeTreeStorage;
  }

  // Check if required bindings are configured
  if (!env.DATA_BUCKET && !env.MERGETREE_DO) {
    log.debug('MergeTree R2 storage not configured (no DATA_BUCKET or MERGETREE_DO bindings)');
    return null;
  }

  try {
    globalMergeTreeStorage = createMergeTreeStorage({
      DATA_BUCKET: env.DATA_BUCKET,
      MERGETREE_DO: env.MERGETREE_DO,
    });

    const isConfigured = globalMergeTreeStorage.isConfigured();
    log.debug('MergeTree R2 storage initialized', {
      configured: isConfigured,
      hasR2: !!env.DATA_BUCKET,
      hasDO: !!env.MERGETREE_DO,
    });

    return globalMergeTreeStorage;
  } catch (error) {
    log.warn('Failed to initialize MergeTree R2 storage', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Get the global MergeTree storage manager
 */
export function getMergeTreeStorage(): MergeTreeStorageManager | null {
  return globalMergeTreeStorage;
}

/**
 * Available extensions that can be loaded
 */
const AVAILABLE_EXTENSIONS = [
  'ext-geo',
  'ext-json',
  'ext-crypto',
  'ext-math',
  'ext-url',
  'ext-datetime',
];

/**
 * Load extensions required by a SQL query.
 *
 * This function detects which extensions are needed based on function calls in the SQL,
 * loads any that haven't been loaded yet, and returns info about the loading results.
 *
 * @param sql - The SQL query to analyze
 * @param env - Worker environment with ASSETS binding
 * @returns Object with required, loaded, and missing extension names
 */
async function loadExtensionsForQuery(
  sql: string,
  env: Env
): Promise<{ required: string[]; loaded: string[]; missing: string[] }> {
  // Detect required extensions from the SQL
  const requiredExtensions = detectRequiredExtensions(sql);
  const missingExtensions: string[] = [];

  // Track requested extensions
  for (const ext of requiredExtensions) {
    requestedExtensions.add(ext);
    if (!loadedExtensions.has(ext)) {
      if (!AVAILABLE_EXTENSIONS.includes(ext)) {
        missingExtensions.push(ext);
      }
    }
  }

  // Load required extensions that haven't been loaded yet
  const extensionsToLoad = requiredExtensions.filter(
    ext => AVAILABLE_EXTENSIONS.includes(ext) && !loadedExtensions.has(ext)
  );

  if (extensionsToLoad.length > 0) {
    log.debug('Loading required extensions for query', { extensions: extensionsToLoad });

    // Create extension loader
    const loaderConfig: ExtensionLoaderConfig = {
      assetsPath: '/extensions',
      env: {
        ASSETS: env.ASSETS,
      },
    };
    const loader = new ExtensionLoader(loaderConfig);

    // Load extensions in parallel
    const loadResults = await Promise.allSettled(
      extensionsToLoad.map(async (extName) => {
        try {
          await loader.load(extName);
          loadedExtensions.add(extName);
          log.debug('Extension loaded successfully', { extension: extName });
          return { name: extName, success: true };
        } catch (error) {
          // Extension loading may fail in workerd due to WASM compilation restrictions
          // Log the error but don't fail the query - the SQL executor may have
          // built-in implementations or the functions may not actually be used
          const message = error instanceof Error ? error.message : String(error);
          log.warn('Failed to load extension', { extension: extName, error: message });
          return { name: extName, success: false, error: message };
        }
      })
    );

    // Log summary of extension loading
    const successful = loadResults.filter(r => r.status === 'fulfilled' && r.value.success);
    const failed = loadResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));
    if (successful.length > 0) {
      log.debug('Extensions loaded', { count: successful.length });
    }
    if (failed.length > 0) {
      log.debug('Some extensions failed to load', { count: failed.length });
    }
  }

  return {
    required: requiredExtensions,
    loaded: Array.from(loadedExtensions),
    missing: missingExtensions,
  };
}

/**
 * Extract SQL query from a request (handles both GET and POST).
 *
 * @param request - The HTTP request
 * @returns The SQL query string, or null if not found
 */
async function extractQueryFromRequest(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // For GET requests, query is in URL parameter
  let sql = url.searchParams.get('query');

  // For POST requests, query may be in body if not in URL
  if (method === 'POST' && !sql) {
    try {
      // Clone the request to read the body without consuming it
      const clonedRequest = request.clone();
      sql = await clonedRequest.text();
    } catch {
      return null;
    }
  }

  return sql || null;
}

/**
 * Handle GET /extensions - list loaded and available extensions
 */
async function handleExtensionsEndpoint(_request: Request, _env: Env): Promise<Response> {
  const response = {
    loaded: Array.from(loadedExtensions),
    available: AVAILABLE_EXTENSIONS,
    requested: Array.from(requestedExtensions),
    registry: {
      'ext-geo': extensionRegistry.getFunctions('ext-geo'),
      'ext-json': extensionRegistry.getFunctions('ext-json'),
      'ext-crypto': extensionRegistry.getFunctions('ext-crypto'),
    },
    metadata: {
      version: '0.1.0',
      cacheSize: loadedExtensions.size,
      timestamp: new Date().toISOString(),
    },
  };

  return new Response(JSON.stringify(response, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...CORS_HEADERS,
    },
  });
}

/**
 * Handle POST /extensions/preload - preload specific extensions
 */
async function handleExtensionsPreloadEndpoint(request: Request, env: Env): Promise<Response> {
  try {
    // Parse request body
    let body: { extensions?: string[] };
    try {
      const text = await request.text();
      if (!text) {
        return new Response(
          JSON.stringify({ error: 'Empty request body' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...CORS_HEADERS,
            },
          }
        );
      }
      body = JSON.parse(text);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        }
      );
    }

    const extensionsToPreload = body.extensions || [];

    if (!Array.isArray(extensionsToPreload) || extensionsToPreload.length === 0) {
      return new Response(
        JSON.stringify({ error: 'extensions must be a non-empty array' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Validate extension names
    const invalidExtensions = extensionsToPreload.filter(ext => !AVAILABLE_EXTENSIONS.includes(ext));
    if (invalidExtensions.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Unknown extensions: ${invalidExtensions.join(', ')}`,
          available: AVAILABLE_EXTENSIONS,
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Create extension loader
    const loaderConfig: ExtensionLoaderConfig = {
      assetsPath: '/extensions',
      env: {
        ASSETS: env.ASSETS,
      },
    };
    const loader = new ExtensionLoader(loaderConfig);

    // Load extensions in parallel
    const loadStartTime = Date.now();
    const loadResults: Array<{ name: string; success: boolean; error?: string }> = [];

    await Promise.all(
      extensionsToPreload.map(async (extName) => {
        try {
          await loader.load(extName);
          loadedExtensions.add(extName);
          loadResults.push({ name: extName, success: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          loadResults.push({ name: extName, success: false, error: message });
        }
      })
    );

    const loadTime = Date.now() - loadStartTime;
    const successCount = loadResults.filter(r => r.success).length;
    const failedResults = loadResults.filter(r => !r.success);

    const response = {
      preloaded: loadResults.filter(r => r.success).map(r => r.name),
      failed: failedResults,
      loadTime,
      totalLoaded: loadedExtensions.size,
      allLoaded: Array.from(loadedExtensions),
    };

    const status = failedResults.length === 0 ? 200 : (successCount > 0 ? 207 : 500);

    return new Response(JSON.stringify(response, null, 2), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: `Extension preload failed: ${message}` }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        },
      }
    );
  }
}

/**
 * Handle POST /query - execute SQL with extension auto-loading
 */
async function handleQueryEndpoint(request: Request, env: Env): Promise<Response> {
  try {
    // Initialize WASM SQL executor if not already done
    try {
      await initializeSqlExecutor(env);
    } catch (error) {
      log.warn('WASM executor initialization failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Parse request body
    let body: { sql?: string; query?: string; format?: string };
    try {
      const text = await request.text();
      if (!text) {
        return new Response(
          JSON.stringify({ error: 'Empty request body' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...CORS_HEADERS,
            },
          }
        );
      }
      body = JSON.parse(text);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        }
      );
    }

    const sql = body.sql || body.query || '';
    const format = body.format || 'JSON';

    if (!sql.trim()) {
      return new Response(
        JSON.stringify({ error: 'Empty SQL query' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Load required extensions for this query
    const { required: requiredExtensions, loaded, missing: missingExtensions } = await loadExtensionsForQuery(sql, env);
    void loaded; // Used in response enhancement below

    // Execute query via the HTTP query handler
    // Build a synthetic request to pass to the existing handler
    const queryUrl = new URL(request.url);
    queryUrl.searchParams.set('query', sql);
    queryUrl.searchParams.set('default_format', format);

    const syntheticRequest = new Request(queryUrl.toString(), {
      method: 'GET',
      headers: request.headers,
    });

    const httpEnv: HttpQueryEnv = {
      chdb: {
        query: async () => { throw new Error('Not used'); },
      },
      MEMORY_ENGINE_DO: env.MEMORY_ENGINE_DO,
      MERGETREE_DO: env.MERGETREE_DO,
      DATA_BUCKET: env.DATA_BUCKET,
      DEFAULT_DATABASE: env.DEFAULT_DATABASE,
    };

    const queryResponse = await handleHttpQuery(syntheticRequest, httpEnv);

    // If successful and JSON format, enhance response with extension info
    if (queryResponse.ok && format.toUpperCase() === 'JSON') {
      try {
        const resultText = await queryResponse.text();
        const result = JSON.parse(resultText);

        const enhancedResult = {
          ...result,
          extensions: {
            required: requiredExtensions,
            loaded: Array.from(loadedExtensions),
            missing: missingExtensions,
          },
        };

        return new Response(JSON.stringify(enhancedResult, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        });
      } catch {
        // If parsing fails, return original response
        return queryResponse;
      }
    }

    return queryResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: `Query execution failed: ${message}` }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        },
      }
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Configure logging based on environment
    configureLogging(env);

    // Initialize MergeTree R2 storage (synchronous, fast)
    // This sets up the storage manager for MergeTree tables that persist to R2
    initializeMergeTreeStorage(env);

    const url = new URL(request.url);

    log.debug('Request received', { method: request.method, path: url.pathname });

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-ClickHouse-Format, X-ClickHouse-User, X-ClickHouse-Key',
        },
      });
    }

    // Serve /play web UI (GET only)
    if (url.pathname === '/play' && request.method === 'GET') {
      return servePlayUI(request, env);
    }

    // Serve WASM files with appropriate headers (GET only)
    if (url.pathname.endsWith('.wasm') && request.method === 'GET') {
      return serveWasmFile(request, env);
    }

    // Serve manifest or metadata files (GET only)
    if ((url.pathname === '/manifest.json' || url.pathname === '/wasm/manifest.json') && request.method === 'GET') {
      return serveManifest(request, env);
    }

    // Handle MergeTree WASM endpoints
    if (url.pathname.startsWith('/mergetree')) {
      // Type assertion needed because our Env has optional types but MergeTreeRequestEnv expects required ASSETS
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mergetreeEnv: MergeTreeRequestEnv = {
        ASSETS: env.ASSETS as any,
        DATA_BUCKET: env.DATA_BUCKET as any,
        MERGETREE_DO: env.MERGETREE_DO as any,
      };
      return handleMergeTreeRequest(request, mergetreeEnv);
    }

    // Handle ClickBench benchmark endpoints
    if (url.pathname.startsWith('/clickbench')) {
      // Initialize WASM SQL executor for real query execution
      try {
        await initializeSqlExecutor(env);
      } catch (error) {
        log.warn('WASM executor initialization failed for ClickBench', {
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue anyway - ClickBench will show real errors from WASM
      }

      // Type assertion needed because our Env has optional types but ClickBenchRequestEnv expects required ASSETS
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clickbenchEnv: ClickBenchRequestEnv = {
        ASSETS: env.ASSETS as any,
        DATA_BUCKET: env.DATA_BUCKET as any,
        MERGETREE_DO: env.MERGETREE_DO as any,
      };
      return handleClickBenchRequest(request, clickbenchEnv);
    }

    // Handle GET /extensions - list loaded and available extensions
    if (url.pathname === '/extensions' && request.method === 'GET') {
      return handleExtensionsEndpoint(request, env);
    }

    // Handle POST /extensions/preload - preload specific extensions
    if (url.pathname === '/extensions/preload' && request.method === 'POST') {
      return handleExtensionsPreloadEndpoint(request, env);
    }

    // Handle POST /query - execute SQL with extension auto-loading
    if (url.pathname === '/query' && request.method === 'POST') {
      return handleQueryEndpoint(request, env);
    }

    // Handle Document REST API endpoints
    // Routes:
    // - GET /docs - List all collections
    // - POST /docs/:collection - Insert document
    // - GET /docs/:collection - Query documents
    // - GET /docs/:collection/:id - Get document by ID
    // - PUT /docs/:collection/:id - Update document
    // - DELETE /docs/:collection/:id - Delete document
    // - POST /docs/:collection/batch - Bulk insert
    // - DELETE /docs/:collection/batch - Bulk delete
    if (url.pathname.startsWith('/docs')) {
      const documentEnv: DocumentApiEnv = {
        DOCUMENT_DB_DO: env.DOCUMENT_DB_DO,
        DEFAULT_DATABASE: env.DEFAULT_DATABASE,
      };
      return handleDocumentRequest(request, documentEnv);
    }

    // Handle Document API v1 endpoints (SQL-based)
    // Routes:
    // - POST /api/v1/collections/:name/docs - Insert document
    // - GET /api/v1/collections/:name/docs/:id - Get document by ID
    // - PUT /api/v1/collections/:name/docs/:id - Update document (upsert)
    // - DELETE /api/v1/collections/:name/docs/:id - Delete document (soft delete)
    // - POST /api/v1/collections/:name/query - Query documents
    if (url.pathname.startsWith('/api/v1/collections/') && (url.pathname.includes('/docs') || url.pathname.endsWith('/query'))) {
      // Initialize WASM SQL executor if not already done
      try {
        const executor = await initializeSqlExecutor(env);
        if (executor) {
          setDocumentApiSqlExecutor(executor);
        }
      } catch (error) {
        log.warn('WASM executor initialization failed for Document API v1', {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      const documentApiV1Env: DocumentApiV1Env = {
        DEFAULT_DATABASE: env.DEFAULT_DATABASE,
      };
      return handleDocumentApiV1Request(request, documentApiV1Env);
    }

    // Handle Collections API endpoints
    // Routes:
    // - POST /api/v1/collections - Create collection
    // - GET /api/v1/collections - List collections
    // - GET /api/v1/collections/:name - Get collection info
    // - DELETE /api/v1/collections/:name - Drop collection
    if (url.pathname.startsWith('/api/v1/collections')) {
      // Initialize WASM SQL executor if not already done
      try {
        await initializeSqlExecutor(env);
      } catch (error) {
        log.warn('WASM executor initialization failed for collections API', {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      const collectionsEnv: CollectionHandlerEnv = {
        DOCUMENT_DB_DO: env.DOCUMENT_DB_DO,
        DATA_BUCKET: env.DATA_BUCKET,
        DEFAULT_DATABASE: env.DEFAULT_DATABASE,
      };
      return handleCollectionsRequest(request, collectionsEnv);
    }

    // Handle ClickHouse HTTP query interface
    // This handles:
    // - GET /?query=... - query in URL parameter
    // - POST / with query in body
    // - /ping endpoint
    // - /replicas_status endpoint
    if (url.pathname === '/' || url.pathname === '/ping' || url.pathname === '/replicas_status') {
      // Initialize WASM SQL executor if not already done
      // This loads the WASM binary from R2 and wires it to the HTTP handler
      try {
        await initializeSqlExecutor(env);
      } catch (error) {
        // Log but don't fail - the handler will return appropriate error
        log.warn('WASM executor initialization failed, queries will fail', {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      // Load extensions required by the query (if any)
      // Skip for /ping and /replicas_status endpoints which don't have queries
      if (url.pathname === '/') {
        const sql = await extractQueryFromRequest(request);
        if (sql && sql.trim()) {
          await loadExtensionsForQuery(sql, env);
        }
      }

      // Create HttpQueryEnv with DO bindings when available
      // When DO bindings are present (from wrangler.toml), queries will use real storage
      const httpEnv: HttpQueryEnv = {
        chdb: {
          query: async () => { throw new Error('Not used'); },
        },
        // Pass DO bindings if configured in wrangler.toml
        MEMORY_ENGINE_DO: env.MEMORY_ENGINE_DO,
        MERGETREE_DO: env.MERGETREE_DO,
        DATA_BUCKET: env.DATA_BUCKET,
        DEFAULT_DATABASE: env.DEFAULT_DATABASE,
      };
      return handleHttpQuery(request, httpEnv);
    }

    // Only allow GET and HEAD for static asset requests
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: {
          Allow: 'GET, HEAD, OPTIONS',
          ...CORS_HEADERS,
        },
      });
    }

    // Serve other static assets
    return serveStaticAsset(request, env);
  },
};

/**
 * Serve WASM files with optimized caching headers
 */
async function serveWasmFile(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.ASSETS) {
      return new Response('WASM file not found (no assets binding)', {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    const response = await env.ASSETS.fetch(request);

    if (!response.ok) {
      return new Response('WASM file not found', {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    // Clone headers and add our custom ones
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/wasm');
    headers.set('Cache-Control', WASM_CACHE_CONTROL);

    // Add CORS headers
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    log.error('Error serving WASM file', { error: error instanceof Error ? error.message : String(error) });
    return new Response('Internal Server Error', {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}

/**
 * Serve the WASM manifest file
 */
async function serveManifest(request: Request, env: Env): Promise<Response> {
  try {
    // If no ASSETS binding, return default manifest
    if (!env.ASSETS) {
      return serveDefaultManifest();
    }

    const response = await env.ASSETS.fetch(request);

    if (!response.ok) {
      // Return a default manifest if none exists
      return serveDefaultManifest();
    }

    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', DEFAULT_CACHE_CONTROL);

    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    log.error('Error serving manifest', { error: error instanceof Error ? error.message : String(error) });
    return new Response('Internal Server Error', {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}

/**
 * Return default manifest when assets not available
 */
function serveDefaultManifest(): Response {
  const defaultManifest = {
    profiles: {
      minimal: {
        path: '/wasm/chdb-minimal.wasm',
        size: 0,
        features: ['core'],
      },
      standard: {
        path: '/wasm/chdb-standard.wasm',
        size: 0,
        features: ['core', 'formats', 'functions'],
      },
      full: {
        path: '/wasm/chdb-full.wasm',
        size: 0,
        features: ['core', 'formats', 'functions', 'dictionaries', 'ml'],
      },
    },
  };

  return new Response(JSON.stringify(defaultManifest, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': DEFAULT_CACHE_CONTROL,
      ...CORS_HEADERS,
    },
  });
}

/**
 * Serve other static assets with default caching
 */
async function serveStaticAsset(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.ASSETS) {
      return new Response('Not Found (no assets binding)', {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    const response = await env.ASSETS.fetch(request);

    if (!response.ok) {
      return new Response('Not Found', {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', DEFAULT_CACHE_CONTROL);

    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    log.error('Error serving static asset', { error: error instanceof Error ? error.message : String(error) });
    return new Response('Internal Server Error', {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}

/**
 * Embedded Play UI HTML template
 * This is embedded directly in the worker to ensure consistent delivery
 */
const PLAY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>chDB Play - ClickHouse SQL Query Editor</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      margin: 0;
      padding: 20px;
      background-color: #1a1a1a;
      color: #e0e0e0;
      min-height: 100vh;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 1px solid #333;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      color: #ffcc00;
    }

    .subtitle {
      color: #888;
      font-size: 14px;
      margin-top: 4px;
    }

    .editor-container {
      margin-bottom: 15px;
    }

    #query-editor {
      width: 100%;
      min-height: 150px;
      padding: 15px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 14px;
      background-color: #2d2d2d;
      color: #e0e0e0;
      border: 1px solid #444;
      border-radius: 6px;
      resize: vertical;
      outline: none;
    }

    #query-editor:focus {
      border-color: #ffcc00;
    }

    .controls {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      align-items: center;
    }

    #run-button {
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 600;
      background-color: #ffcc00;
      color: #1a1a1a;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    #run-button:hover {
      background-color: #e6b800;
    }

    #run-button:disabled {
      background-color: #666;
      color: #999;
      cursor: not-allowed;
    }

    .status {
      color: #888;
      font-size: 13px;
    }

    .status.loading {
      color: #ffcc00;
    }

    .status.error {
      color: #ff6b6b;
    }

    .status.success {
      color: #69db7c;
    }

    .results-container {
      background-color: #2d2d2d;
      border: 1px solid #444;
      border-radius: 6px;
      overflow: hidden;
    }

    .results-header {
      padding: 10px 15px;
      background-color: #333;
      border-bottom: 1px solid #444;
      font-size: 13px;
      color: #888;
    }

    #results {
      padding: 15px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 500px;
      overflow: auto;
    }

    #results table {
      border-collapse: collapse;
      width: 100%;
    }

    #results th, #results td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid #444;
    }

    #results th {
      background-color: #333;
      color: #ffcc00;
      font-weight: 600;
    }

    #results tr:hover td {
      background-color: #363636;
    }

    .keyboard-hint {
      color: #666;
      font-size: 12px;
    }

    kbd {
      background-color: #333;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: inherit;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>chDB Play</h1>
        <div class="subtitle">ClickHouse compiled to WebAssembly</div>
      </div>
      <div class="keyboard-hint">
        Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to run
      </div>
    </header>

    <div class="editor-container">
      <textarea id="query-editor" placeholder="Enter your SQL query here...">SELECT 1 + 1 AS result</textarea>
    </div>

    <div class="controls">
      <button id="run-button" type="submit">Run Query</button>
      <span id="status" class="status"></span>
    </div>

    <div class="results-container">
      <div class="results-header">Results</div>
      <div id="results">Run a query to see results here.</div>
    </div>
  </div>

  <script type="module">
    // chDB Play - Execute queries via the Worker HTTP API
    const queryEditor = document.getElementById('query-editor');
    const runButton = document.getElementById('run-button');
    const resultsDiv = document.getElementById('results');
    const statusSpan = document.getElementById('status');

    // Pre-populate query from URL parameter
    function loadQueryFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const query = params.get('query');
      if (query) {
        queryEditor.value = query;
      }
    }

    // Update status display
    function setStatus(message, type = '') {
      statusSpan.textContent = message;
      statusSpan.className = 'status ' + type;
    }

    // Execute query via Worker HTTP API
    async function executeQuery() {
      const sql = queryEditor.value.trim();

      if (!sql) {
        resultsDiv.textContent = 'Please enter a query.';
        return;
      }

      setStatus('Executing...', 'loading');
      runButton.disabled = true;

      const startTime = performance.now();

      try {
        // Call the Worker's HTTP API with JSON format
        const response = await fetch('/?query=' + encodeURIComponent(sql) + '&default_format=JSON');
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(3);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText);
        }

        const result = await response.json();
        const columns = result.meta.map(m => m.name);
        const rows = result.data;

        if (rows.length === 0) {
          resultsDiv.textContent = 'Query executed successfully. No rows returned.';
        } else {
          // Build HTML table
          let html = '<table><thead><tr>';
          for (const col of columns) {
            html += '<th>' + escapeHtml(col) + '</th>';
          }
          html += '</tr></thead><tbody>';

          for (const row of rows) {
            html += '<tr>';
            for (const col of columns) {
              const value = row[col];
              html += '<td>' + escapeHtml(formatValue(value)) + '</td>';
            }
            html += '</tr>';
          }
          html += '</tbody></table>';

          resultsDiv.innerHTML = html;
        }

        setStatus(rows.length + ' row' + (rows.length !== 1 ? 's' : '') + ' in ' + elapsed + 's', 'success');
      } catch (error) {
        console.error('Query error:', error);
        resultsDiv.textContent = 'Error: ' + error.message;
        setStatus('Query failed', 'error');
      } finally {
        runButton.disabled = false;
      }
    }

    // Format value for display
    function formatValue(value) {
      if (value === null || value === undefined) {
        return 'NULL';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    }

    // Escape HTML special characters
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Event listeners
    runButton.addEventListener('click', executeQuery);

    queryEditor.addEventListener('keydown', (e) => {
      // Ctrl+Enter or Cmd+Enter to run query
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        executeQuery();
      }
    });

    // Initialize on page load
    loadQueryFromUrl();
    setStatus('Ready', 'success');
  </script>
</body>
</html>`;

/**
 * Serve the /play web UI for query editing
 */
function servePlayUI(_request: Request, _env: Env): Response {
  return new Response(PLAY_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': DEFAULT_CACHE_CONTROL,
      ...CORS_HEADERS,
    },
  });
}
