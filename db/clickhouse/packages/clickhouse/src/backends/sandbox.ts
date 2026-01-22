/**
 * Sandbox Backend Implementation
 *
 * Provides a ClickHouse backend running as a local sandboxed process.
 * This enables local ClickHouse queries without requiring a full server
 * deployment, using the ClickHouse Local binary.
 */

import {
  BaseBackend,
  BackendCapabilities,
  QueryOptions,
  SANDBOX_CAPABILITIES,
} from './base';
import { ClickHouseError, TimeoutError, ConnectionError } from '../types';

/**
 * Configuration options for the Sandbox backend
 */
export interface SandboxBackendConfig {
  /** Path to ClickHouse binary (default: 'clickhouse') */
  binary?: string;
  /** Execution timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum memory limit in bytes (default: 1GB) */
  memoryLimit?: number;
  /** Data directory for persistent storage */
  dataDir?: string;
  /** Additional ClickHouse settings */
  settings?: Record<string, string | number | boolean>;
  /** Initial database to use */
  database?: string;
}

/**
 * Interface for process execution result
 */
interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Sandbox Backend implementation using ClickHouse Local
 */
export class SandboxBackend extends BaseBackend {
  readonly name = 'sandbox' as const;
  readonly capabilities: BackendCapabilities;

  private config: SandboxBackendConfig;
  private execModule: typeof import('child_process') | null = null;
  private fsModule: typeof import('fs') | null = null;

  constructor(config: SandboxBackendConfig = {}) {
    super();
    this.config = {
      binary: config.binary ?? 'clickhouse',
      timeout: config.timeout ?? 30000,
      memoryLimit: config.memoryLimit ?? 1024 * 1024 * 1024, // 1GB
      dataDir: config.dataDir,
      settings: config.settings ?? {},
      database: config.database ?? 'default',
    };

    this.capabilities = {
      ...SANDBOX_CAPABILITIES,
      maxMemory: this.config.memoryLimit!,
    };
  }

  /**
   * Ensure we have access to Node.js modules
   */
  private async ensureNodeModules(): Promise<void> {
    if (this.execModule && this.fsModule) {
      return;
    }

    if (typeof process === 'undefined' || !process.versions?.node) {
      throw new ClickHouseError(
        'Sandbox backend requires Node.js environment'
      );
    }

    try {
      this.execModule = await import('child_process');
      this.fsModule = await import('fs');
    } catch (error) {
      throw new ClickHouseError(
        `Failed to load Node.js modules: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Build ClickHouse Local command arguments
   */
  private buildArgs(sql: string, format: string): string[] {
    const args: string[] = ['local'];

    // Add query
    args.push('--query', sql);

    // Add format
    args.push('--output-format', format);

    // Add database
    if (this.config.database) {
      args.push('--database', this.config.database);
    }

    // Add data directory if specified
    if (this.config.dataDir) {
      args.push('--path', this.config.dataDir);
    }

    // Add memory limit setting
    args.push('--max_memory_usage', String(this.config.memoryLimit));

    // Add additional settings
    for (const [key, value] of Object.entries(this.config.settings ?? {})) {
      args.push(`--${key}`, String(value));
    }

    return args;
  }

  /**
   * Execute a ClickHouse Local command
   */
  private async exec(
    sql: string,
    format: string,
    timeout?: number
  ): Promise<ExecResult> {
    await this.ensureNodeModules();

    const { execFile } = this.execModule!;
    const args = this.buildArgs(sql, format);
    const execTimeout = timeout ?? this.config.timeout;

    return new Promise((resolve, reject) => {
      const process = execFile(
        this.config.binary!,
        args,
        {
          timeout: execTimeout,
          maxBuffer: 100 * 1024 * 1024, // 100MB buffer
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          if (error) {
            // Check if it's a timeout
            if (error.killed || (error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
              reject(new TimeoutError(`Query timed out after ${execTimeout}ms`));
              return;
            }

            // Check if binary not found
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              reject(new ConnectionError(
                `ClickHouse binary not found at '${this.config.binary}'. ` +
                'Please install ClickHouse or specify the correct binary path.'
              ));
              return;
            }

            // Other execution error
            const errorMessage = stderr || error.message;
            reject(new ClickHouseError(`Query execution failed: ${errorMessage}`));
            return;
          }

          resolve({
            stdout: stdout as string,
            stderr: stderr as string,
            exitCode: 0,
          });
        }
      );

      // Handle process errors
      process.on('error', (err) => {
        reject(new ClickHouseError(`Process error: ${err.message}`));
      });
    });
  }

  /**
   * Execute a query and return parsed results
   */
  async query<T>(sql: string, options?: QueryOptions): Promise<T[]> {
    const { controller, cleanup } = this.createTimeoutController(
      options?.timeout ?? this.config.timeout,
      options?.signal
    );

    try {
      if (controller.signal.aborted) {
        throw new TimeoutError('Query aborted');
      }

      const format = options?.format ?? 'JSONEachRow';
      const result = await this.exec(sql, format, options?.timeout);

      if (controller.signal.aborted) {
        throw new TimeoutError('Query aborted');
      }

      return this.parseJsonEachRow<T>(result.stdout);
    } finally {
      cleanup();
    }
  }

  /**
   * Execute a query and return raw response
   */
  async queryRaw(sql: string, options?: QueryOptions): Promise<string> {
    const { controller, cleanup } = this.createTimeoutController(
      options?.timeout ?? this.config.timeout,
      options?.signal
    );

    try {
      if (controller.signal.aborted) {
        throw new TimeoutError('Query aborted');
      }

      const format = options?.format ?? 'TabSeparated';
      const result = await this.exec(sql, format, options?.timeout);

      return result.stdout;
    } finally {
      cleanup();
    }
  }

  /**
   * Execute a query and return a stream of batched results
   */
  async *queryStream<T>(sql: string, options?: QueryOptions): AsyncIterable<T[]> {
    await this.ensureNodeModules();

    const { spawn } = this.execModule!;
    const format = options?.format ?? 'JSONEachRow';
    const args = this.buildArgs(sql, format);
    const batchSize = options?.batchSize ?? 1000;
    const timeout = options?.timeout ?? this.config.timeout;

    const process = spawn(this.config.binary!, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Set up timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (timeout && timeout > 0) {
      timeoutId = setTimeout(() => {
        process.kill('SIGTERM');
      }, timeout);
    }

    // Handle abort signal
    const abortHandler = () => {
      process.kill('SIGTERM');
    };
    if (options?.signal) {
      options.signal.addEventListener('abort', abortHandler);
    }

    try {
      let buffer = '';
      let batch: T[] = [];

      for await (const chunk of process.stdout!) {
        buffer += chunk.toString();
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

      // Process remaining buffer
      if (buffer.trim().length > 0) {
        try {
          batch.push(JSON.parse(buffer) as T);
        } catch {
          // Skip malformed line
        }
      }

      // Yield remaining batch
      if (batch.length > 0) {
        yield batch;
      }

      // Wait for process to finish and check for errors
      const exitCode = await new Promise<number>((resolve, reject) => {
        let stderr = '';
        process.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        process.on('close', (code) => {
          if (code !== 0 && stderr) {
            reject(new ClickHouseError(`Query failed: ${stderr}`));
          } else {
            resolve(code ?? 0);
          }
        });

        process.on('error', (err) => {
          reject(new ClickHouseError(`Process error: ${err.message}`));
        });
      });

      if (exitCode !== 0) {
        throw new ClickHouseError(`Query exited with code ${exitCode}`);
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
      process.kill();
    }
  }

  /**
   * Check if the sandbox backend is available
   */
  async ping(): Promise<boolean> {
    try {
      await this.ensureNodeModules();
      const result = await this.query<{ result: number }>('SELECT 1 AS result');
      return result.length === 1 && result[0].result === 1;
    } catch {
      return false;
    }
  }

  /**
   * Clean up sandbox resources
   */
  dispose(): void {
    // No persistent resources to clean up
    this.execModule = null;
    this.fsModule = null;
  }
}

/**
 * Create a new Sandbox backend instance
 */
export function createSandboxBackend(config?: SandboxBackendConfig): SandboxBackend {
  return new SandboxBackend(config);
}

/**
 * Check if Sandbox backend is supported in the current environment
 */
export function isSandboxSupported(): boolean {
  return typeof process !== 'undefined' &&
         process.versions != null &&
         process.versions.node != null;
}

/**
 * Find the ClickHouse binary in common locations
 */
export async function findClickHouseBinary(): Promise<string | null> {
  if (!isSandboxSupported()) {
    return null;
  }

  const { execSync } = await import('child_process');

  // Common binary names to try
  const binaryNames = ['clickhouse', 'clickhouse-local'];

  for (const name of binaryNames) {
    try {
      // Use 'which' on Unix or 'where' on Windows
      const command = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
      const result = execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const path = result.trim().split('\n')[0];
      if (path) {
        return path;
      }
    } catch {
      // Binary not found, try next
    }
  }

  return null;
}
