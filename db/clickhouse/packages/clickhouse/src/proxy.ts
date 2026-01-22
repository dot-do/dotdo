/**
 * HTTP proxy that forwards requests to ClickHouse
 * Supports: /, /ping, /play, /query endpoints
 * Adds authentication headers
 * Works as Cloudflare Worker
 */

export interface ProxyConfig {
  upstream: string;
  auth?: {
    username: string;
    password: string;
  };
  cors?: boolean;
}

export interface HttpProxy {
  handleRequest(request: Request): Promise<Response>;
}

/**
 * CORS headers for cross-origin requests
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-ClickHouse-User, X-ClickHouse-Key, X-ClickHouse-Database, X-ClickHouse-Format',
  'Access-Control-Max-Age': '86400',
};

/**
 * Supported endpoints that are proxied to ClickHouse
 */
const SUPPORTED_PATHS = ['/', '/ping', '/play', '/query'];

/**
 * Creates an HTTP proxy for ClickHouse
 *
 * @example
 * ```typescript
 * const proxy = createHttpProxy({
 *   upstream: 'http://localhost:8123',
 *   auth: {
 *     username: 'default',
 *     password: 'secret'
 *   }
 * });
 *
 * export default {
 *   async fetch(request: Request): Promise<Response> {
 *     return proxy.handleRequest(request);
 *   }
 * };
 * ```
 */
export function createHttpProxy(config: ProxyConfig): HttpProxy {
  const { upstream, auth, cors = true } = config;

  // Validate upstream URL
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(upstream);
  } catch {
    throw new Error(`Invalid upstream URL: ${upstream}`);
  }

  /**
   * Build the Basic Auth header value
   */
  function getAuthHeader(): string | null {
    if (!auth) return null;
    const credentials = btoa(`${auth.username}:${auth.password}`);
    return `Basic ${credentials}`;
  }

  /**
   * Handle CORS preflight requests
   */
  function handleOptions(): Response {
    return new Response(null, {
      status: 204,
      headers: cors ? CORS_HEADERS : {},
    });
  }

  /**
   * Add CORS headers to a response (if CORS is enabled)
   */
  function addCorsHeaders(response: Response): Response {
    if (!cors) {
      return response;
    }
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      newHeaders.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  /**
   * Create an error response with CORS headers (if CORS is enabled)
   */
  function errorResponse(message: string, status: number = 500): Response {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...(cors ? CORS_HEADERS : {}),
      },
    });
  }

  /**
   * Forward a request to the upstream ClickHouse server
   */
  async function forwardRequest(request: Request, path: string): Promise<Response> {
    // Build upstream URL
    const targetUrl = new URL(path, upstreamUrl);

    // Copy query parameters from original request
    const originalUrl = new URL(request.url);
    originalUrl.searchParams.forEach((value, key) => {
      targetUrl.searchParams.set(key, value);
    });

    // Build headers for upstream request
    const headers = new Headers();

    // Copy relevant headers from original request
    const headersToCopy = [
      'content-type',
      'accept',
      'accept-encoding',
      'x-clickhouse-user',
      'x-clickhouse-key',
      'x-clickhouse-database',
      'x-clickhouse-format',
    ];

    for (const header of headersToCopy) {
      const value = request.headers.get(header);
      if (value) {
        headers.set(header, value);
      }
    }

    // Add authentication header if configured
    const authHeader = getAuthHeader();
    if (authHeader) {
      headers.set('Authorization', authHeader);
    }

    // Build fetch options
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    // Include body for POST requests
    if (request.method === 'POST') {
      fetchOptions.body = await request.text();
    }

    try {
      const response = await fetch(targetUrl.toString(), fetchOptions);
      return addCorsHeaders(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return errorResponse(`Failed to connect to ClickHouse: ${message}`, 502);
    }
  }

  /**
   * Handle /ping endpoint for health checks
   * Returns 'Ok.' on success, or forwards to upstream for actual check
   */
  async function handlePing(request: Request): Promise<Response> {
    try {
      const response = await forwardRequest(request, '/ping');
      return response;
    } catch {
      // If upstream is unavailable, return a failure response
      return errorResponse('ClickHouse is not reachable', 503);
    }
  }

  /**
   * Handle /play endpoint for the web admin UI
   */
  async function handlePlay(request: Request): Promise<Response> {
    return forwardRequest(request, '/play');
  }

  /**
   * Handle /query endpoint for SQL queries
   * Accepts query in request body
   */
  async function handleQuery(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed. Use POST for /query endpoint.', 405);
    }
    return forwardRequest(request, '/');
  }

  /**
   * Handle root endpoint (/)
   * Supports both GET (with query param) and POST (with body)
   */
  async function handleRoot(request: Request): Promise<Response> {
    return forwardRequest(request, '/');
  }

  /**
   * Main request handler
   */
  async function handleRequest(request: Request): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    // Only allow GET and POST methods
    if (request.method !== 'GET' && request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    // Parse the request URL
    const url = new URL(request.url);
    const path = url.pathname;

    // Route to appropriate handler
    switch (path) {
      case '/':
        return handleRoot(request);

      case '/ping':
        return handlePing(request);

      case '/play':
      case '/play/':
        return handlePlay(request);

      case '/query':
        return handleQuery(request);

      default:
        // Check if path starts with /play/ (for play UI assets)
        if (path.startsWith('/play/')) {
          return forwardRequest(request, path);
        }

        // Return 404 for unsupported paths
        return errorResponse(
          `Unsupported endpoint: ${path}. Supported endpoints: ${SUPPORTED_PATHS.join(', ')}`,
          404
        );
    }
  }

  return {
    handleRequest,
  };
}

/**
 * Cloudflare Worker entry point
 *
 * @example
 * ```typescript
 * // wrangler.toml
 * // [vars]
 * // CLICKHOUSE_URL = "http://clickhouse:8123"
 * // CLICKHOUSE_USER = "default"
 * // CLICKHOUSE_PASSWORD = ""
 *
 * import { createWorkerHandler } from '@dotdo/clickhouse/proxy';
 *
 * export default createWorkerHandler();
 * ```
 */
export interface WorkerEnv {
  CLICKHOUSE_URL: string;
  CLICKHOUSE_USER?: string;
  CLICKHOUSE_PASSWORD?: string;
}

export function createWorkerHandler() {
  return {
    async fetch(request: Request, env: WorkerEnv): Promise<Response> {
      if (!env.CLICKHOUSE_URL) {
        return new Response(
          JSON.stringify({ error: 'CLICKHOUSE_URL environment variable is required' }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          }
        );
      }

      const proxy = createHttpProxy({
        upstream: env.CLICKHOUSE_URL,
        auth: env.CLICKHOUSE_USER
          ? {
              username: env.CLICKHOUSE_USER,
              password: env.CLICKHOUSE_PASSWORD || '',
            }
          : undefined,
      });

      return proxy.handleRequest(request);
    },
  };
}

export default createWorkerHandler();
