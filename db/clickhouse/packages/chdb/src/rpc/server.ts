/**
 * capnweb RPC Server for chdb
 *
 * Provides a JSON-over-HTTP RPC protocol that mirrors the capnweb API
 * for running chdb in Cloudflare Workers.
 */

import type { ChdbClient, QueryOptions, QueryResult, Session } from '../types';
import { AuthenticationError, ChdbError, QueryError } from '../types';

/**
 * RPC server configuration
 */
export interface RpcServerConfig {
  /** Optional authentication configuration */
  auth?: {
    /** Validate a bearer token */
    validateToken: (token: string) => Promise<boolean>;
  };
  /** CORS configuration */
  cors?: {
    /** Allowed origins (default: '*') */
    allowedOrigins?: string[];
    /** Allow credentials (default: false) */
    allowCredentials?: boolean;
  };
}

/**
 * RPC request format
 */
interface RpcRequest {
  /** JSON-RPC version (always "2.0") */
  jsonrpc: '2.0';
  /** Method name */
  method: string;
  /** Method parameters */
  params?: unknown;
  /** Request ID */
  id: string | number;
}

/**
 * RPC response format
 */
interface RpcResponse {
  /** JSON-RPC version (always "2.0") */
  jsonrpc: '2.0';
  /** Result (on success) */
  result?: unknown;
  /** Error (on failure) */
  error?: RpcError;
  /** Request ID (echoed back) */
  id: string | number | null;
}

/**
 * RPC error format
 */
interface RpcError {
  /** Error code */
  code: number;
  /** Error message */
  message: string;
  /** Additional error data */
  data?: unknown;
}

// Standard JSON-RPC error codes
const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom error codes
  AUTHENTICATION_REQUIRED: -32000,
  AUTHENTICATION_FAILED: -32001,
  QUERY_ERROR: -32002,
  SESSION_NOT_FOUND: -32003,
} as const;

/**
 * Parameters for the query method
 */
interface QueryParams {
  sql: string;
  options?: QueryOptions;
}

/**
 * Parameters for the queryStream method
 */
interface QueryStreamParams {
  sql: string;
  options?: QueryOptions;
}

/**
 * Parameters for session methods
 */
interface SessionQueryParams {
  sessionId: string;
  sql: string;
  options?: QueryOptions;
}

interface SessionCloseParams {
  sessionId: string;
}

/**
 * RPC Server instance
 */
export interface RpcServer {
  /**
   * Handle an incoming HTTP request
   */
  handleRequest(request: Request): Promise<Response>;
}

/**
 * Create an RPC server for a chdb client
 */
export function createRpcServer(client: ChdbClient, config?: RpcServerConfig): RpcServer {
  // Store active sessions
  const sessions = new Map<string, Session>();

  /**
   * Generate a unique session ID
   */
  function generateSessionId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Create an error response
   */
  function createErrorResponse(
    code: number,
    message: string,
    id: string | number | null,
    data?: unknown
  ): RpcResponse {
    return {
      jsonrpc: '2.0',
      error: { code, message, data },
      id,
    };
  }

  /**
   * Create a success response
   */
  function createSuccessResponse(result: unknown, id: string | number): RpcResponse {
    return {
      jsonrpc: '2.0',
      result,
      id,
    };
  }

  /**
   * Validate authentication
   */
  async function validateAuth(request: Request): Promise<boolean> {
    if (!config?.auth) {
      return true;
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return false;
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return false;
    }

    const token = match[1];
    return config.auth.validateToken(token);
  }

  /**
   * Get CORS headers
   */
  function getCorsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get('Origin') || '*';
    const allowedOrigins = config?.cors?.allowedOrigins || ['*'];

    const allowedOrigin = allowedOrigins.includes('*')
      ? '*'
      : allowedOrigins.includes(origin)
        ? origin
        : allowedOrigins[0];

    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (config?.cors?.allowCredentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    return headers;
  }

  /**
   * Handle the query method
   */
  async function handleQuery(params: QueryParams): Promise<QueryResult> {
    if (!params.sql || typeof params.sql !== 'string') {
      throw new ChdbError('Invalid params: sql is required and must be a string');
    }

    return client.query(params.sql, params.options);
  }

  /**
   * Handle the queryStream method - returns a streaming response
   */
  async function handleQueryStream(
    params: QueryStreamParams,
    request: Request
  ): Promise<Response> {
    if (!params.sql || typeof params.sql !== 'string') {
      throw new ChdbError('Invalid params: sql is required and must be a string');
    }

    const corsHeaders = getCorsHeaders(request);
    const stream = client.queryStream(params.sql, params.options);

    // Create a ReadableStream that yields JSON-encoded batches
    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const batch of stream) {
            const chunk = JSON.stringify({ batch }) + '\n';
            controller.enqueue(encoder.encode(chunk));
          }
          controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'));
          controller.close();
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Stream error';
          controller.enqueue(
            encoder.encode(JSON.stringify({ error: errorMessage }) + '\n')
          );
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        ...corsHeaders,
      },
    });
  }

  /**
   * Handle the createSession method
   */
  async function handleCreateSession(): Promise<{ sessionId: string }> {
    const session = await client.createSession();
    const sessionId = generateSessionId();
    sessions.set(sessionId, session);
    return { sessionId };
  }

  /**
   * Handle session query
   */
  async function handleSessionQuery(params: SessionQueryParams): Promise<QueryResult> {
    if (!params.sessionId || typeof params.sessionId !== 'string') {
      throw new ChdbError('Invalid params: sessionId is required');
    }

    const session = sessions.get(params.sessionId);
    if (!session) {
      const error = new ChdbError('Session not found');
      (error as ChdbError & { code?: number }).code = ERROR_CODES.SESSION_NOT_FOUND;
      throw error;
    }

    if (!params.sql || typeof params.sql !== 'string') {
      throw new ChdbError('Invalid params: sql is required and must be a string');
    }

    return session.query(params.sql, params.options);
  }

  /**
   * Handle session close
   */
  async function handleSessionClose(params: SessionCloseParams): Promise<{ success: boolean }> {
    if (!params.sessionId || typeof params.sessionId !== 'string') {
      throw new ChdbError('Invalid params: sessionId is required');
    }

    const session = sessions.get(params.sessionId);
    if (!session) {
      const error = new ChdbError('Session not found');
      (error as ChdbError & { code?: number }).code = ERROR_CODES.SESSION_NOT_FOUND;
      throw error;
    }

    await session.close();
    sessions.delete(params.sessionId);
    return { success: true };
  }

  /**
   * Process an RPC request
   */
  async function processRequest(
    rpcRequest: RpcRequest,
    httpRequest: Request
  ): Promise<RpcResponse | Response> {
    const { method, params, id } = rpcRequest;

    try {
      switch (method) {
        case 'query': {
          const result = await handleQuery(params as QueryParams);
          return createSuccessResponse(result, id);
        }

        case 'queryStream': {
          // queryStream returns a streaming Response directly
          return handleQueryStream(params as QueryStreamParams, httpRequest);
        }

        case 'createSession': {
          const result = await handleCreateSession();
          return createSuccessResponse(result, id);
        }

        case 'session.query': {
          const result = await handleSessionQuery(params as SessionQueryParams);
          return createSuccessResponse(result, id);
        }

        case 'session.close': {
          const result = await handleSessionClose(params as SessionCloseParams);
          return createSuccessResponse(result, id);
        }

        default:
          return createErrorResponse(
            ERROR_CODES.METHOD_NOT_FOUND,
            `Method not found: ${method}`,
            id
          );
      }
    } catch (error) {
      if (error instanceof QueryError) {
        return createErrorResponse(ERROR_CODES.QUERY_ERROR, error.message, id, {
          position: error.position,
          code: error.code,
        });
      }

      if (error instanceof AuthenticationError) {
        return createErrorResponse(
          ERROR_CODES.AUTHENTICATION_FAILED,
          error.message,
          id
        );
      }

      if (error instanceof ChdbError) {
        const customError = error as ChdbError & { code?: number };
        return createErrorResponse(
          customError.code || ERROR_CODES.INTERNAL_ERROR,
          error.message,
          id
        );
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, message, id);
    }
  }

  /**
   * Handle an HTTP request
   */
  async function handleRequest(request: Request): Promise<Response> {
    const corsHeaders = getCorsHeaders(request);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify(
          createErrorResponse(
            ERROR_CODES.INVALID_REQUEST,
            'Only POST method is allowed',
            null
          )
        ),
        {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }

    // Validate authentication
    const isAuthenticated = await validateAuth(request);
    if (!isAuthenticated) {
      return new Response(
        JSON.stringify(
          createErrorResponse(
            ERROR_CODES.AUTHENTICATION_REQUIRED,
            'Authentication required',
            null
          )
        ),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer',
            ...corsHeaders,
          },
        }
      );
    }

    // Parse request body
    let rpcRequest: RpcRequest;
    try {
      const body = await request.text();
      rpcRequest = JSON.parse(body) as RpcRequest;
    } catch {
      return new Response(
        JSON.stringify(
          createErrorResponse(ERROR_CODES.PARSE_ERROR, 'Parse error', null)
        ),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }

    // Validate JSON-RPC format
    if (
      rpcRequest.jsonrpc !== '2.0' ||
      typeof rpcRequest.method !== 'string' ||
      rpcRequest.id === undefined
    ) {
      return new Response(
        JSON.stringify(
          createErrorResponse(
            ERROR_CODES.INVALID_REQUEST,
            'Invalid JSON-RPC request',
            rpcRequest?.id ?? null
          )
        ),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }

    // Process the request
    const result = await processRequest(rpcRequest, request);

    // If result is already a Response (streaming), return it directly
    if (result instanceof Response) {
      return result;
    }

    // Return JSON response
    return new Response(JSON.stringify(result), {
      status: result.error ? (result.error.code === ERROR_CODES.METHOD_NOT_FOUND ? 404 : 400) : 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }

  return {
    handleRequest,
  };
}

/**
 * Export error codes for client use
 */
export { ERROR_CODES };
