/**
 * Sandbox backend for @dotdo/chdb
 *
 * Executes chdb using Cloudflare's sandbox-sdk for running native binaries
 * in a secure sandboxed environment.
 */

import type { ChdbClient, QueryOptions, QueryResult, Session } from '../types';
import { ChdbError, QueryError } from '../types';

/**
 * Configuration for the sandbox backend
 */
export interface SandboxConfig {
  /** Path to chdb binary (default: '/usr/local/bin/chdb') */
  binary?: string;
  /** Query timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Working directory for chdb (default: '/tmp/chdb') */
  workDir?: string;
  /** Maximum memory limit in bytes */
  memoryLimit?: number;
}

/**
 * Internal session state
 */
interface SessionState {
  id: string;
  dataPath: string;
  createdAt: number;
}

/**
 * Sandbox execution interface
 * Compatible with Cloudflare's sandbox-sdk
 */
interface SandboxProcess {
  spawn(
    command: string,
    args: string[],
    options?: {
      timeout?: number;
      stdin?: string;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

/**
 * Get the sandbox process from the environment
 * In Cloudflare Workers, this comes from the sandbox-sdk binding
 */
function getSandboxProcess(): SandboxProcess {
  // Check if we're in a Cloudflare Workers environment with sandbox binding
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalScope = globalThis as any;

  if (globalScope.SANDBOX) {
    return globalScope.SANDBOX;
  }

  // Fallback to child_process for Node.js environments
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  return {
    async spawn(command: string, args: string[], options?: { timeout?: number; stdin?: string; cwd?: string }) {
      try {
        const result = await execFileAsync(command, args, {
          timeout: options?.timeout,
          cwd: options?.cwd,
          maxBuffer: 50 * 1024 * 1024, // 50MB buffer
          encoding: 'utf8',
          ...(options?.stdin && { input: options.stdin }),
        });
        return {
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exitCode: 0,
        };
      } catch (error: unknown) {
        const execError = error as { stdout?: string; stderr?: string; code?: number | string };
        return {
          stdout: execError.stdout || '',
          stderr: execError.stderr || '',
          exitCode: typeof execError.code === 'number' ? execError.code : 1,
        };
      }
    },
  };
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Escape a value for safe use in ClickHouse queries
 */
function escapeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(escapeValue).join(', ')}]`;
  }
  // String escaping - escape single quotes and backslashes
  const str = String(value);
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Build command-line arguments for chdb
 */
function buildChdbArgs(
  sql: string,
  options?: QueryOptions,
  sessionDataPath?: string
): string[] {
  const args: string[] = [];

  // Add format
  const format = options?.format || 'JSON';
  args.push('--format', format);

  // Add session data path if provided
  if (sessionDataPath) {
    args.push('--path', sessionDataPath);
  }

  // Add settings
  if (options?.settings) {
    for (const [key, value] of Object.entries(options.settings)) {
      args.push('--' + key, String(value));
    }
  }

  // Process parameterized query
  let processedSql = sql;
  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      // Replace {key} style placeholders
      const placeholder = new RegExp(`\\{${key}\\}`, 'g');
      processedSql = processedSql.replace(placeholder, escapeValue(value));
    }
  }

  // Add the query
  args.push('--query', processedSql);

  return args;
}

/**
 * Parse JSON result from chdb output
 */
function parseJsonResult<T>(output: string): QueryResult<T> {
  if (!output.trim()) {
    return {
      data: [],
      rowsRead: 0,
      bytesRead: 0,
      elapsed: 0,
    };
  }

  try {
    const parsed = JSON.parse(output);

    // chdb JSON format includes metadata
    if (parsed.data !== undefined) {
      return {
        data: parsed.data as T[],
        rowsRead: parsed.statistics?.rows_read || parsed.rows_read || 0,
        bytesRead: parsed.statistics?.bytes_read || parsed.bytes_read || 0,
        elapsed: parsed.statistics?.elapsed || parsed.elapsed || 0,
      };
    }

    // If it's just an array of results
    if (Array.isArray(parsed)) {
      return {
        data: parsed as T[],
        rowsRead: parsed.length,
        bytesRead: output.length,
        elapsed: 0,
      };
    }

    // Single object result
    return {
      data: [parsed as T],
      rowsRead: 1,
      bytesRead: output.length,
      elapsed: 0,
    };
  } catch (e) {
    throw new QueryError(`Failed to parse JSON result: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
}

/**
 * Parse JSONEachRow format (newline-delimited JSON)
 */
function parseJsonEachRow<T>(output: string): T[] {
  if (!output.trim()) {
    return [];
  }

  const lines = output.trim().split('\n');
  const results: T[] = [];

  for (const line of lines) {
    if (line.trim()) {
      try {
        results.push(JSON.parse(line) as T);
      } catch {
        // Skip malformed lines
      }
    }
  }

  return results;
}

/**
 * Parse chdb error output
 */
function parseError(stderr: string, exitCode: number): QueryError {
  // Try to extract error code and position from ClickHouse error format
  // Example: "Code: 62. DB::Exception: Syntax error: ..."
  const codeMatch = stderr.match(/Code:\s*(\d+)/);
  const positionMatch = stderr.match(/position\s*(\d+)/i);

  return new QueryError(stderr.trim() || `chdb exited with code ${exitCode}`, {
    code: codeMatch ? parseInt(codeMatch[1], 10) : undefined,
    position: positionMatch ? parseInt(positionMatch[1], 10) : undefined,
  });
}

/**
 * Create a sandbox backend for chdb
 */
export async function createSandboxBackend(config?: SandboxConfig): Promise<ChdbClient> {
  const binaryPath = config?.binary || '/usr/local/bin/chdb';
  const timeout = config?.timeout || 30000;
  const workDir = config?.workDir || '/tmp/chdb';
  const sandbox = getSandboxProcess();

  // Track active sessions
  const sessions = new Map<string, SessionState>();

  /**
   * Execute a query using the sandbox
   */
  async function executeQuery(
    sql: string,
    options?: QueryOptions,
    sessionDataPath?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const args = buildChdbArgs(sql, options, sessionDataPath);

    const result = await sandbox.spawn(binaryPath, args, {
      timeout,
      cwd: workDir,
    });

    return result;
  }

  return {
    /**
     * Execute a query and return parsed results
     */
    async query<T = unknown>(sql: string, options?: QueryOptions): Promise<QueryResult<T>> {
      const format = options?.format || 'JSON';
      const result = await executeQuery(sql, { ...options, format });

      if (result.exitCode !== 0) {
        throw parseError(result.stderr, result.exitCode);
      }

      // Parse based on format
      if (format === 'JSON') {
        return parseJsonResult<T>(result.stdout);
      }

      if (format === 'JSONEachRow') {
        const data = parseJsonEachRow<T>(result.stdout);
        return {
          data,
          rowsRead: data.length,
          bytesRead: result.stdout.length,
          elapsed: 0,
        };
      }

      // For other formats, return raw data
      return {
        data: [] as T[],
        rowsRead: 0,
        bytesRead: result.stdout.length,
        elapsed: 0,
        raw: result.stdout,
      };
    },

    /**
     * Execute a query and return raw response
     */
    async queryRaw(sql: string, options?: QueryOptions): Promise<string | ArrayBuffer> {
      const result = await executeQuery(sql, options);

      if (result.exitCode !== 0) {
        throw parseError(result.stderr, result.exitCode);
      }

      return result.stdout;
    },

    /**
     * Execute a query and return a stream of batched results
     */
    async *queryStream<T = unknown>(sql: string, options?: QueryOptions): AsyncIterable<T[]> {
      // For streaming, we use JSONEachRow format and yield batches
      const format = 'JSONEachRow';
      const result = await executeQuery(sql, { ...options, format });

      if (result.exitCode !== 0) {
        throw parseError(result.stderr, result.exitCode);
      }

      // Split output into batches
      const lines = result.stdout.trim().split('\n');
      const batchSize = 1000;

      for (let i = 0; i < lines.length; i += batchSize) {
        const batch = lines.slice(i, i + batchSize);
        const parsedBatch: T[] = [];

        for (const line of batch) {
          if (line.trim()) {
            try {
              parsedBatch.push(JSON.parse(line) as T);
            } catch {
              // Skip malformed lines
            }
          }
        }

        if (parsedBatch.length > 0) {
          yield parsedBatch;
        }
      }
    },

    /**
     * Create a new session for executing multiple queries with shared state
     */
    async createSession(): Promise<Session> {
      const sessionId = generateId();
      const dataPath = `${workDir}/sessions/${sessionId}`;

      // Create session directory
      await sandbox.spawn('mkdir', ['-p', dataPath], { timeout: 5000 });

      const sessionState: SessionState = {
        id: sessionId,
        dataPath,
        createdAt: Date.now(),
      };

      sessions.set(sessionId, sessionState);

      const session: Session = {
        get id(): string {
          return sessionId;
        },

        async query<T = unknown>(sql: string, queryOptions?: QueryOptions): Promise<QueryResult<T>> {
          const format = queryOptions?.format || 'JSON';
          const result = await executeQuery(sql, { ...queryOptions, format }, dataPath);

          if (result.exitCode !== 0) {
            throw parseError(result.stderr, result.exitCode);
          }

          if (format === 'JSON') {
            return parseJsonResult<T>(result.stdout);
          }

          if (format === 'JSONEachRow') {
            const data = parseJsonEachRow<T>(result.stdout);
            return {
              data,
              rowsRead: data.length,
              bytesRead: result.stdout.length,
              elapsed: 0,
            };
          }

          return {
            data: [] as T[],
            rowsRead: 0,
            bytesRead: result.stdout.length,
            elapsed: 0,
            raw: result.stdout,
          };
        },

        async *queryStream<T = unknown>(sql: string, queryOptions?: QueryOptions): AsyncIterable<T[]> {
          const format = 'JSONEachRow';
          const result = await executeQuery(sql, { ...queryOptions, format }, dataPath);

          if (result.exitCode !== 0) {
            throw parseError(result.stderr, result.exitCode);
          }

          const lines = result.stdout.trim().split('\n');
          const batchSize = 1000;

          for (let i = 0; i < lines.length; i += batchSize) {
            const batch = lines.slice(i, i + batchSize);
            const parsedBatch: T[] = [];

            for (const line of batch) {
              if (line.trim()) {
                try {
                  parsedBatch.push(JSON.parse(line) as T);
                } catch {
                  // Skip malformed lines
                }
              }
            }

            if (parsedBatch.length > 0) {
              yield parsedBatch;
            }
          }
        },

        async close(): Promise<void> {
          // Clean up session data
          try {
            await sandbox.spawn('rm', ['-rf', dataPath], { timeout: 5000 });
          } catch {
            // Ignore cleanup errors
          }
          sessions.delete(sessionId);
        },
      };

      return session;
    },

    /**
     * Close the client and clean up resources
     */
    async close(): Promise<void> {
      // Close all active sessions
      for (const [, sessionState] of sessions) {
        try {
          await sandbox.spawn('rm', ['-rf', sessionState.dataPath], { timeout: 5000 });
        } catch {
          // Ignore cleanup errors
        }
      }
      sessions.clear();
    },
  };
}

/**
 * Default export for convenience
 */
export default createSandboxBackend;
