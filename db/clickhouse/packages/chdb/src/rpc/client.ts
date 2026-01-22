/**
 * capnweb RPC client for chdb
 *
 * Provides a remote client that connects to a chdb RPC server
 * using the capnweb protocol over HTTP.
 */

import type { ChdbClient, QueryOptions, QueryResult, Session } from '../types';
import {
  ChdbError,
  QueryError,
  ConnectionError,
  AuthenticationError,
} from '../types';

/**
 * RPC client configuration
 */
export interface RpcClientConfig {
  /** URL of the RPC server */
  url: string;

  /** Authentication configuration */
  auth?: {
    /** Bearer token for authentication */
    token: string;
  };

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Custom fetch implementation (for testing or polyfills) */
  fetch?: typeof globalThis.fetch;
}

/**
 * RPC request payload
 */
interface RpcRequest {
  method: string;
  params: Record<string, unknown>;
  id?: string;
}

/**
 * RPC response payload
 */
interface RpcResponse<T = unknown> {
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: {
      position?: number;
    };
  };
  id?: string;
}

/**
 * Stream chunk from server
 */
interface StreamChunk<T = unknown> {
  type: 'data' | 'end' | 'error';
  data?: T[];
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Timeout error for RPC requests
 */
export class TimeoutError extends ChdbError {
  readonly timeout: number;

  constructor(message: string, timeout: number) {
    super(message);
    this.name = 'TimeoutError';
    this.timeout = timeout;
  }
}

/**
 * Create an AbortSignal that times out after the specified duration
 */
function createTimeoutSignal(timeout: number): AbortSignal {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Clean up timeout when signal is aborted externally
  controller.signal.addEventListener('abort', () => clearTimeout(timeoutId), { once: true });

  return controller.signal;
}

/**
 * Combine multiple AbortSignals into one
 */
function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  return controller.signal;
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create a capnweb RPC client for chdb
 *
 * @param config - Client configuration
 * @returns A ChdbClient that communicates with a remote RPC server
 *
 * @example
 * ```typescript
 * const client = await createRpcClient({
 *   url: 'https://chdb.example.com/rpc',
 *   auth: { token: 'your-token' },
 *   timeout: 30000
 * });
 *
 * const result = await client.query('SELECT * FROM system.tables');
 * ```
 */
export async function createRpcClient(config: RpcClientConfig): Promise<ChdbClient> {
  const {
    url,
    auth,
    timeout = 30000,
    fetch: fetchImpl = globalThis.fetch,
  } = config;

  // Validate URL
  try {
    new URL(url);
  } catch {
    throw new ConnectionError(`Invalid RPC URL: ${url}`);
  }

  /**
   * Build request headers
   */
  function buildHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (auth?.token) {
      headers['Authorization'] = `Bearer ${auth.token}`;
    }

    return headers;
  }

  /**
   * Send an RPC request to the server
   */
  async function sendRequest<T>(
    method: string,
    params: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<T> {
    const requestId = generateRequestId();
    const requestTimeout = options?.timeout ?? timeout;

    const payload: RpcRequest = {
      method,
      params,
      id: requestId,
    };

    const timeoutSignal = createTimeoutSignal(requestTimeout);
    const signal = options?.signal
      ? combineSignals(options.signal, timeoutSignal)
      : timeoutSignal;

    let response: Response;

    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          if (options?.signal?.aborted) {
            throw new ChdbError('Request was cancelled');
          }
          throw new TimeoutError(`Request timed out after ${requestTimeout}ms`, requestTimeout);
        }
        throw new ConnectionError(`Failed to connect to RPC server: ${error.message}`);
      }
      throw new ConnectionError('Failed to connect to RPC server');
    }

    // Handle HTTP errors
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError(`Authentication failed: ${response.statusText}`);
      }
      throw new ConnectionError(`RPC server returned ${response.status}: ${response.statusText}`);
    }

    // Parse response
    let rpcResponse: RpcResponse<T>;
    try {
      rpcResponse = await response.json() as RpcResponse<T>;
    } catch {
      throw new ChdbError('Invalid JSON response from RPC server');
    }

    // Check for RPC error
    if (rpcResponse.error) {
      const { code, message, data } = rpcResponse.error;
      throw new QueryError(message, {
        code,
        position: data?.position,
      });
    }

    if (rpcResponse.result === undefined) {
      throw new ChdbError('RPC response missing result');
    }

    return rpcResponse.result;
  }

  /**
   * Send a streaming RPC request
   */
  async function* sendStreamingRequest<T>(
    method: string,
    params: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): AsyncIterable<T[]> {
    const requestId = generateRequestId();

    const payload: RpcRequest = {
      method,
      params,
      id: requestId,
    };

    let response: Response;

    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          ...buildHeaders(),
          'Accept': 'application/x-ndjson',
        },
        body: JSON.stringify(payload),
        signal: options?.signal,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new ChdbError('Stream was cancelled');
        }
        throw new ConnectionError(`Failed to connect to RPC server: ${error.message}`);
      }
      throw new ConnectionError('Failed to connect to RPC server');
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError(`Authentication failed: ${response.statusText}`);
      }
      throw new ConnectionError(`RPC server returned ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new ChdbError('Response body is not available for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const chunk = parseStreamChunk<T>(buffer);
            if (chunk.type === 'data' && chunk.data) {
              yield chunk.data;
            } else if (chunk.type === 'error' && chunk.error) {
              throw new QueryError(chunk.error.message, { code: chunk.error.code });
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines (NDJSON format)
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          const chunk = parseStreamChunk<T>(line);

          if (chunk.type === 'data' && chunk.data) {
            yield chunk.data;
          } else if (chunk.type === 'error' && chunk.error) {
            throw new QueryError(chunk.error.message, { code: chunk.error.code });
          } else if (chunk.type === 'end') {
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse a stream chunk from NDJSON
   */
  function parseStreamChunk<T>(line: string): StreamChunk<T> {
    try {
      return JSON.parse(line) as StreamChunk<T>;
    } catch {
      throw new ChdbError(`Invalid stream chunk: ${line}`);
    }
  }

  /**
   * Create a remote session
   */
  class RemoteSession implements Session {
    readonly id: string;
    private closed = false;

    constructor(sessionId: string) {
      this.id = sessionId;
    }

    async query<T = unknown>(sql: string, options?: QueryOptions): Promise<QueryResult<T>> {
      if (this.closed) {
        throw new ChdbError('Session is closed');
      }

      return sendRequest<QueryResult<T>>('session.query', {
        sessionId: this.id,
        sql,
        options: options || {},
      });
    }

    async *queryStream<T = unknown>(sql: string, options?: QueryOptions): AsyncIterable<T[]> {
      if (this.closed) {
        throw new ChdbError('Session is closed');
      }

      yield* sendStreamingRequest<T>('session.queryStream', {
        sessionId: this.id,
        sql,
        options: options || {},
      });
    }

    async close(): Promise<void> {
      if (this.closed) {
        return;
      }

      this.closed = true;

      await sendRequest<void>('session.close', {
        sessionId: this.id,
      });
    }
  }

  // Return the client interface
  const client: ChdbClient = {
    async query<T = unknown>(sql: string, options?: QueryOptions): Promise<QueryResult<T>> {
      return sendRequest<QueryResult<T>>('query', {
        sql,
        options: options || {},
      });
    },

    async queryRaw(sql: string, options?: QueryOptions): Promise<string | ArrayBuffer> {
      const result = await sendRequest<{ data: string; encoding?: 'base64' }>('queryRaw', {
        sql,
        options: options || {},
      });

      // Handle binary data encoded as base64
      if (result.encoding === 'base64') {
        const binary = atob(result.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
      }

      return result.data;
    },

    async *queryStream<T = unknown>(sql: string, options?: QueryOptions): AsyncIterable<T[]> {
      yield* sendStreamingRequest<T>('queryStream', {
        sql,
        options: options || {},
      });
    },

    async createSession(): Promise<Session> {
      const result = await sendRequest<{ sessionId: string }>('createSession', {});
      return new RemoteSession(result.sessionId);
    },

    async close(): Promise<void> {
      // No persistent connection to close for HTTP-based RPC
      // This is a no-op but satisfies the interface
    },
  };

  return client;
}

/**
 * Default export for convenience
 */
export default createRpcClient;
