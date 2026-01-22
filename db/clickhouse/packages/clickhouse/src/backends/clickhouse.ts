/**
 * ClickHouse Server Backend Implementation
 *
 * Provides a backend that connects to a remote ClickHouse server via HTTP.
 * This is the most full-featured backend with complete ClickHouse capabilities.
 */

import {
  BaseBackend,
  BackendCapabilities,
  QueryOptions,
  FULL_CAPABILITIES,
} from './base';
import {
  ClickHouseError,
  TimeoutError,
  ConnectionError,
  AuthenticationError,
} from '../types';

/**
 * Configuration options for the ClickHouse server backend
 */
export interface ClickHouseBackendConfig {
  /** Server host URL (e.g., 'http://localhost:8123') */
  host: string;
  /** Authentication username (default: 'default') */
  username?: string;
  /** Authentication password (default: '') */
  password?: string;
  /** Default database (default: 'default') */
  database?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Additional ClickHouse settings */
  settings?: Record<string, string | number | boolean>;
  /** Use HTTPS (auto-detected from host URL) */
  secure?: boolean;
}

/**
 * ClickHouse Server Backend implementation
 */
export class ClickHouseBackend extends BaseBackend {
  readonly name = 'clickhouse' as const;
  readonly capabilities: BackendCapabilities;

  private config: Required<Omit<ClickHouseBackendConfig, 'secure'>> & { secure: boolean };

  constructor(config: ClickHouseBackendConfig) {
    super();

    if (!config.host) {
      throw new ConnectionError('ClickHouse host is required');
    }

    // Normalize host URL
    let host = config.host.replace(/\/$/, '');
    if (!host.startsWith('http://') && !host.startsWith('https://')) {
      host = `http://${host}`;
    }

    this.config = {
      host,
      username: config.username ?? 'default',
      password: config.password ?? '',
      database: config.database ?? 'default',
      timeout: config.timeout ?? 30000,
      settings: config.settings ?? {},
      secure: config.secure ?? host.startsWith('https://'),
    };

    // Full capabilities for ClickHouse server
    this.capabilities = { ...FULL_CAPABILITIES };
  }

  /**
   * Build Basic auth header
   */
  private getAuthHeader(): string {
    // Use btoa for browser, Buffer for Node.js
    const credentials = `${this.config.username}:${this.config.password}`;
    if (typeof btoa === 'function') {
      return `Basic ${btoa(credentials)}`;
    } else {
      return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
  }

  /**
   * Build query URL with parameters
   */
  private buildQueryUrl(
    options?: QueryOptions,
    additionalParams?: Record<string, string>
  ): URL {
    const url = new URL('/', this.config.host);

    // Set database
    url.searchParams.set('database', this.config.database);

    // Apply global settings
    for (const [key, value] of Object.entries(this.config.settings)) {
      url.searchParams.set(key, String(value));
    }

    // Apply query-specific settings
    if (options?.settings) {
      for (const [key, value] of Object.entries(options.settings)) {
        url.searchParams.set(key, String(value));
      }
    }

    // Apply query parameters
    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.set(`param_${key}`, String(value));
      }
    }

    // Apply additional parameters
    if (additionalParams) {
      for (const [key, value] of Object.entries(additionalParams)) {
        url.searchParams.set(key, value);
      }
    }

    return url;
  }

  /**
   * Execute a request to the ClickHouse server
   */
  private async executeRequest(
    sql: string,
    options?: QueryOptions & { format?: string }
  ): Promise<Response> {
    const format = options?.format ?? 'JSON';
    const url = this.buildQueryUrl(options, { default_format: format });

    const headers: Record<string, string> = {
      'Authorization': this.getAuthHeader(),
      'Content-Type': 'text/plain',
    };

    const { controller, cleanup } = this.createTimeoutController(
      options?.timeout ?? this.config.timeout,
      options?.signal
    );

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: sql,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Check for authentication errors
        if (response.status === 401 || response.status === 403) {
          throw new AuthenticationError(errorText || 'Authentication failed');
        }

        // Check for timeout (408)
        if (response.status === 408) {
          throw new TimeoutError(errorText || 'Request timed out');
        }

        throw new ClickHouseError(`Query failed (${response.status}): ${errorText}`);
      }

      return response;
    } catch (error) {
      if (error instanceof ClickHouseError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new TimeoutError('Query aborted');
        }

        // Connection errors
        if (error.message.includes('fetch') || error.message.includes('network')) {
          throw new ConnectionError(`Failed to connect to ${this.config.host}: ${error.message}`);
        }
      }

      throw new ClickHouseError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      cleanup();
    }
  }

  /**
   * Execute a query and return parsed results
   */
  async query<T>(sql: string, options?: QueryOptions): Promise<T[]> {
    const format = options?.format ?? 'JSON';
    const response = await this.executeRequest(sql, { ...options, format });

    if (format === 'JSON') {
      const json = await response.json() as {
        data: T[];
        rows?: number;
        statistics?: {
          elapsed: number;
          rows_read: number;
          bytes_read: number;
        };
      };

      return json.data;
    } else if (format === 'JSONEachRow') {
      const text = await response.text();
      return this.parseJsonEachRow<T>(text);
    } else {
      // For other formats, try to parse as JSON or return empty
      const text = await response.text();
      try {
        return this.parseJsonResponse<T>(text);
      } catch {
        return [];
      }
    }
  }

  /**
   * Execute a query and return raw response
   */
  async queryRaw(sql: string, options?: QueryOptions): Promise<string> {
    const format = options?.format ?? 'TabSeparated';
    const response = await this.executeRequest(sql, { ...options, format });

    // For binary formats, we could return ArrayBuffer, but interface expects string
    // In practice, callers should use specific formats
    return response.text();
  }

  /**
   * Execute a query and return a stream of batched results
   */
  async *queryStream<T>(sql: string, options?: QueryOptions): AsyncIterable<T[]> {
    const format = options?.format ?? 'JSONEachRow';
    const response = await this.executeRequest(sql, { ...options, format });

    if (!response.body) {
      throw new ClickHouseError('Streaming not supported: response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const batchSize = options?.batchSize ?? 1000;

    let buffer = '';
    let batch: T[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process remaining buffer
          if (buffer.trim().length > 0) {
            const lines = buffer.trim().split('\n').filter(line => line.length > 0);
            for (const line of lines) {
              try {
                batch.push(JSON.parse(line) as T);
              } catch {
                // Skip malformed lines
              }
            }
          }

          // Yield final batch
          if (batch.length > 0) {
            yield batch;
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.trim().length === 0) continue;

          try {
            batch.push(JSON.parse(line) as T);

            if (batch.length >= batchSize) {
              yield batch;
              batch = [];
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Check if the server is reachable
   */
  async ping(): Promise<boolean> {
    try {
      const url = new URL('/ping', this.config.host);
      const { controller, cleanup } = this.createTimeoutController(5000);

      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Authorization': this.getAuthHeader(),
          },
          signal: controller.signal,
        });

        return response.ok;
      } finally {
        cleanup();
      }
    } catch {
      return false;
    }
  }

  /**
   * Clean up resources (HTTP client doesn't need cleanup)
   */
  dispose(): void {
    // HTTP connections are stateless, no cleanup needed
  }

  /**
   * Get server version
   */
  async getVersion(): Promise<string> {
    const result = await this.query<{ version: string }>('SELECT version() AS version');
    return result[0]?.version ?? 'unknown';
  }

  /**
   * Get server timezone
   */
  async getTimezone(): Promise<string> {
    const result = await this.query<{ timezone: string }>('SELECT timezone() AS timezone');
    return result[0]?.timezone ?? 'UTC';
  }
}

/**
 * Create a new ClickHouse server backend instance
 */
export function createClickHouseBackend(config: ClickHouseBackendConfig): ClickHouseBackend {
  return new ClickHouseBackend(config);
}

/**
 * Check if a ClickHouse server is reachable at the given host
 */
export async function isClickHouseAvailable(
  host: string,
  timeout: number = 5000
): Promise<boolean> {
  try {
    let url = host.replace(/\/$/, '');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }

    const pingUrl = new URL('/ping', url);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(pingUrl.toString(), {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      clearTimeout(timeoutId);
      return false;
    }
  } catch {
    return false;
  }
}
