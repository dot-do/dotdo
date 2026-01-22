/**
 * MergeTree WASM Request Handler
 *
 * Handles HTTP requests for the /mergetree endpoint, providing access to
 * MergeTree part reading via the WASM module.
 *
 * Endpoints:
 *   GET /mergetree/version        - Get WASM module version
 *   GET /mergetree/test           - Run self-test
 *   GET /mergetree/parts/:db/:table          - List parts
 *   GET /mergetree/parts/:db/:table/:partition/:part  - Get part info
 *   GET /mergetree/parts/:db/:table/:partition/:part/columns  - Get columns
 *   GET /mergetree/parts/:db/:table/:partition/:part/marks/:column  - Get marks
 *   GET /mergetree/parts/:db/:table/:partition/:part/data/:column  - Read column data
 */

import { MergeTreeLoader, InMemoryStorageProvider, type VFSStorageProvider } from './wasm/index';
import type { DurableObjectNamespace, R2Bucket } from './http-query-handler';
import { createMergeTreeVFSProviderFromEnv } from './mergetree-r2-storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Environment bindings for MergeTree handler
 */
export interface MergeTreeRequestEnv {
  ASSETS: Fetcher;
  DATA_BUCKET?: R2Bucket;
  MERGETREE_DO?: DurableObjectNamespace;
}

/**
 * CORS headers for API responses
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ---------------------------------------------------------------------------
// Global State (per-isolate)
// ---------------------------------------------------------------------------

// Cache the loader per isolate (Cloudflare Workers reuse isolates)
let cachedLoader: MergeTreeLoader | null = null;
let loaderInitPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

/**
 * Handle MergeTree API requests
 */
export async function handleMergeTreeRequest(
  request: Request,
  env: MergeTreeRequestEnv
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  try {
    // Route requests
    if (path === '/mergetree' || path === '/mergetree/') {
      return handleInfo();
    }

    if (path === '/mergetree/version') {
      return await handleVersion(env);
    }

    if (path === '/mergetree/test') {
      return await handleTest(env);
    }

    if (path === '/mergetree/storage') {
      return handleStorageStatus(env);
    }

    if (path.startsWith('/mergetree/parts/')) {
      return await handleParts(request, env, path);
    }

    // Unknown endpoint
    return jsonResponse({ error: 'Not found', path }, 404);
  } catch (error) {
    console.error('MergeTree handler error:', error);
    return jsonResponse(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

/**
 * GET /mergetree - API info
 */
function handleInfo(): Response {
  return jsonResponse({
    name: 'MergeTree WASM API',
    version: '1.0.0',
    endpoints: [
      'GET /mergetree/version - Get WASM module version',
      'GET /mergetree/test - Run self-test',
      'GET /mergetree/storage - Get R2 storage status',
      'GET /mergetree/parts/:db/:table - List parts',
      'GET /mergetree/parts/:db/:table/:partition/:part - Get part info',
      'GET /mergetree/parts/:db/:table/:partition/:part/columns - Get columns',
      'GET /mergetree/parts/:db/:table/:partition/:part/marks/:column - Get marks',
      'GET /mergetree/parts/:db/:table/:partition/:part/data/:column - Read column data',
    ],
  });
}

/**
 * GET /mergetree/storage - R2 storage status
 */
function handleStorageStatus(env: MergeTreeRequestEnv): Response {
  return jsonResponse({
    r2Configured: !!env.DATA_BUCKET,
    doConfigured: !!env.MERGETREE_DO,
    storageBackend: env.DATA_BUCKET && env.MERGETREE_DO ? 'r2+do' : 'in-memory',
    message: env.DATA_BUCKET && env.MERGETREE_DO
      ? 'MergeTree R2 storage is configured and ready'
      : 'MergeTree R2 storage not configured - using in-memory storage',
  });
}

/**
 * GET /mergetree/version
 */
async function handleVersion(env: MergeTreeRequestEnv): Promise<Response> {
  const loader = await getLoader(env);
  const version = loader.getVersion();
  return jsonResponse({ version });
}

/**
 * GET /mergetree/test
 */
async function handleTest(env: MergeTreeRequestEnv): Promise<Response> {
  const loader = await getLoader(env);
  const result = loader.runSelfTest();
  const success = result === 0;

  return jsonResponse({
    success,
    result,
    error: success ? null : loader.getLastError(),
  });
}

/**
 * Handle /mergetree/parts/* requests
 */
async function handleParts(
  request: Request,
  env: MergeTreeRequestEnv,
  path: string
): Promise<Response> {
  // Parse path: /mergetree/parts/:db/:table[/:partition/:part[/columns|/marks/:col|/data/:col]]
  const pathParts = path.replace('/mergetree/parts/', '').split('/');

  if (pathParts.length < 2) {
    return jsonResponse({ error: 'Missing database or table name' }, 400);
  }

  const database = decodeURIComponent(pathParts[0]);
  const table = decodeURIComponent(pathParts[1]);

  // List parts: GET /mergetree/parts/:db/:table
  if (pathParts.length === 2) {
    return handleListParts(env, database, table);
  }

  if (pathParts.length < 4) {
    return jsonResponse({ error: 'Missing partition or part name' }, 400);
  }

  const partition = decodeURIComponent(pathParts[2]);
  const partName = decodeURIComponent(pathParts[3]);

  // Get part info: GET /mergetree/parts/:db/:table/:partition/:part
  if (pathParts.length === 4) {
    return handlePartInfo(env, database, table, partition, partName);
  }

  const subPath = pathParts[4];

  // Get columns: GET /mergetree/parts/:db/:table/:partition/:part/columns
  if (subPath === 'columns' && pathParts.length === 5) {
    return handleColumns(env, database, table, partition, partName);
  }

  // Get marks: GET /mergetree/parts/:db/:table/:partition/:part/marks/:column
  if (subPath === 'marks' && pathParts.length >= 6) {
    const column = decodeURIComponent(pathParts[5]);
    return handleMarks(env, database, table, partition, partName, column);
  }

  // Read data: GET /mergetree/parts/:db/:table/:partition/:part/data/:column
  if (subPath === 'data' && pathParts.length >= 6) {
    const column = decodeURIComponent(pathParts[5]);
    const url = new URL(request.url);
    const startMark = BigInt(url.searchParams.get('start_mark') || '0');
    const endMark = BigInt(url.searchParams.get('end_mark') || '0');
    return handleReadData(env, database, table, partition, partName, column, startMark, endMark);
  }

  return jsonResponse({ error: 'Unknown endpoint', path }, 404);
}

/**
 * List parts in a table
 */
async function handleListParts(
  _env: MergeTreeRequestEnv,
  database: string,
  table: string
): Promise<Response> {
  // For now, return empty list - in production this would query the DO
  // to get the list of registered parts
  return jsonResponse({
    database,
    table,
    parts: [],
    message: 'Part listing requires MERGETREE_DO binding',
  });
}

/**
 * Get part information
 */
async function handlePartInfo(
  env: MergeTreeRequestEnv,
  database: string,
  table: string,
  partition: string,
  partName: string
): Promise<Response> {
  const loader = await getLoader(env);

  let reader;
  try {
    reader = await loader.createReader(database, table, partition, partName);

    const info = {
      database,
      table,
      partition,
      partName,
      rowCount: reader.getRowCount().toString(),
      columnCount: reader.getColumnCount(),
      markCount: reader.getMarkCount().toString(),
    };

    return jsonResponse(info);
  } catch (error) {
    return jsonResponse(
      {
        error: 'Failed to read part',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  } finally {
    if (reader) {
      reader.destroy();
    }
  }
}

/**
 * Get column information
 */
async function handleColumns(
  env: MergeTreeRequestEnv,
  database: string,
  table: string,
  partition: string,
  partName: string
): Promise<Response> {
  const loader = await getLoader(env);

  let reader;
  try {
    reader = await loader.createReader(database, table, partition, partName);
    const columns = reader.getColumns();

    return jsonResponse({
      database,
      table,
      partition,
      partName,
      columns,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: 'Failed to read columns',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  } finally {
    if (reader) {
      reader.destroy();
    }
  }
}

/**
 * Get marks for a column
 */
async function handleMarks(
  env: MergeTreeRequestEnv,
  database: string,
  table: string,
  partition: string,
  partName: string,
  column: string
): Promise<Response> {
  const loader = await getLoader(env);

  let reader;
  try {
    reader = await loader.createReader(database, table, partition, partName);
    const marks = reader.readMarks(column);

    // Convert BigInts to strings for JSON serialization
    const marksJson = marks.map((m, i) => ({
      index: i,
      compressedOffset: m.offsetInCompressedFile.toString(),
      decompressedOffset: m.offsetInDecompressedBlock.toString(),
    }));

    return jsonResponse({
      database,
      table,
      partition,
      partName,
      column,
      markCount: marks.length,
      marks: marksJson,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: 'Failed to read marks',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  } finally {
    if (reader) {
      reader.destroy();
    }
  }
}

/**
 * Read column data
 */
async function handleReadData(
  env: MergeTreeRequestEnv,
  database: string,
  table: string,
  partition: string,
  partName: string,
  column: string,
  startMark: bigint,
  endMark: bigint
): Promise<Response> {
  const loader = await getLoader(env);

  let reader;
  try {
    reader = await loader.createReader(database, table, partition, partName);
    const data = reader.readColumnRaw(column, startMark, endMark);

    // Return binary data
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length.toString(),
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        error: 'Failed to read column data',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  } finally {
    if (reader) {
      reader.destroy();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get or create the MergeTree loader
 */
async function getLoader(env: MergeTreeRequestEnv): Promise<MergeTreeLoader> {
  // Return cached loader if available
  if (cachedLoader && cachedLoader.isInitialized()) {
    return cachedLoader;
  }

  // Wait for ongoing initialization
  if (loaderInitPromise) {
    await loaderInitPromise;
    if (cachedLoader && cachedLoader.isInitialized()) {
      return cachedLoader;
    }
  }

  // Initialize new loader
  loaderInitPromise = initLoader(env);
  await loaderInitPromise;

  if (!cachedLoader) {
    throw new Error('Failed to initialize MergeTree loader');
  }

  return cachedLoader;
}

/**
 * Initialize the loader
 */
async function initLoader(env: MergeTreeRequestEnv): Promise<void> {
  // Create storage provider
  // Try to use MergeTreeVFSProvider with R2/DO if available, otherwise use in-memory
  let storage: VFSStorageProvider;

  if (env.DATA_BUCKET && env.MERGETREE_DO) {
    // Use R2-backed storage provider with Durable Object coordination
    const vfsProvider = createMergeTreeVFSProviderFromEnv({
      DATA_BUCKET: env.DATA_BUCKET,
      MERGETREE_DO: env.MERGETREE_DO,
    });

    if (vfsProvider) {
      console.log('[MergeTree] Using R2-backed VFS provider');
      storage = vfsProvider;
    } else {
      console.log('[MergeTree] R2 VFS provider creation failed, using in-memory provider');
      storage = new InMemoryStorageProvider();
    }
  } else {
    // Fall back to in-memory provider for testing
    console.log('[MergeTree] Using in-memory storage provider (no R2/DO bindings)');
    storage = new InMemoryStorageProvider();
  }

  // Create loader with asset fetcher
  const loader = new MergeTreeLoader(env.ASSETS, '/wasm/mergetree.wasm');

  // Load WASM binary
  const wasmResponse = await env.ASSETS.fetch(
    new Request('https://placeholder/wasm/mergetree.wasm')
  );

  if (!wasmResponse.ok) {
    throw new Error(`Failed to load mergetree.wasm: ${wasmResponse.status}`);
  }

  const wasmBinary = await wasmResponse.arrayBuffer();

  // Initialize the module
  await loader.init(storage, wasmBinary);

  cachedLoader = loader;
}

/**
 * Create a JSON response
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
