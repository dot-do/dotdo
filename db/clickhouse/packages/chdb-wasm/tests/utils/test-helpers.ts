/**
 * Test Utilities and Helpers for chdb WASM Tests
 *
 * This module provides common testing utilities including:
 * - Mock fetch for URL tests
 * - Mock R2 for S3 tests
 * - Test data generators
 * - Assertion helpers
 */

import { vi } from 'vitest';

// ============================================================================
// Mock chdb Instance
// ============================================================================

/**
 * Create a mock chdb instance for unit testing
 */
export function createMockChdbInstance() {
  return {
    query: vi.fn().mockResolvedValue('{"data":[],"meta":[],"rows":0}'),
    queryStream: vi.fn().mockImplementation(async function* () {
      yield '{}';
    }),
    getMemoryStats: vi.fn().mockReturnValue({
      used: 1024 * 1024,
      peak: 2 * 1024 * 1024,
      limit: 64 * 1024 * 1024,
    }),
    clearCache: vi.fn(),
    dispose: vi.fn(),
    disposed: false,
  };
}

/**
 * Create a mock chdb instance with configurable responses
 */
export function createConfigurableChdbMock(config?: {
  queryResponse?: string;
  memoryStats?: { used: number; peak: number; limit: number };
}) {
  const defaultMemoryStats = {
    used: 1024 * 1024,
    peak: 2 * 1024 * 1024,
    limit: 64 * 1024 * 1024,
  };

  return {
    query: vi.fn().mockResolvedValue(config?.queryResponse ?? '{"data":[],"meta":[],"rows":0}'),
    queryStream: vi.fn().mockImplementation(async function* () {
      yield config?.queryResponse ?? '{}';
    }),
    getMemoryStats: vi.fn().mockReturnValue(config?.memoryStats ?? defaultMemoryStats),
    clearCache: vi.fn(),
    dispose: vi.fn(),
    disposed: false,
  };
}

// ============================================================================
// Mock Fetch for URL Tests
// ============================================================================

export interface MockFetchResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string | object;
}

export interface MockFetchConfig {
  responses: Record<string, MockFetchResponse>;
  defaultResponse?: MockFetchResponse;
}

/**
 * Create a mock fetch function for URL tests
 */
export function createMockFetch(config: MockFetchConfig) {
  return vi.fn().mockImplementation(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const mockResponse = config.responses[url] || config.defaultResponse;

    if (!mockResponse) {
      return new Response('Not Found', { status: 404 });
    }

    const body = typeof mockResponse.body === 'object'
      ? JSON.stringify(mockResponse.body)
      : mockResponse.body ?? '';

    return new Response(body, {
      status: mockResponse.status ?? 200,
      statusText: mockResponse.statusText ?? 'OK',
      headers: new Headers(mockResponse.headers ?? {}),
    });
  });
}

/**
 * Create a mock fetch that returns JSON data
 */
export function createJsonFetchMock(data: object) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

/**
 * Create a mock fetch that returns CSV data
 */
export function createCsvFetchMock(csvContent: string) {
  return vi.fn().mockResolvedValue(
    new Response(csvContent, {
      status: 200,
      headers: { 'Content-Type': 'text/csv' },
    })
  );
}

/**
 * Create a mock fetch that fails with an error
 */
export function createFailingFetchMock(errorMessage: string, status = 500) {
  return vi.fn().mockResolvedValue(
    new Response(errorMessage, {
      status,
      statusText: 'Error',
    })
  );
}

// ============================================================================
// Mock R2 for S3 Tests
// ============================================================================

export interface MockR2Object {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  body?: ReadableStream | ArrayBuffer | string;
  customMetadata?: Record<string, string>;
}

/**
 * Create a mock R2 bucket for S3/R2 tests
 */
export function createMockR2Bucket(objects: Record<string, MockR2Object>) {
  return {
    get: vi.fn().mockImplementation(async (key: string) => {
      const obj = objects[key];
      if (!obj) return null;

      const body = typeof obj.body === 'string'
        ? new TextEncoder().encode(obj.body)
        : obj.body;

      return {
        ...obj,
        body: body instanceof ArrayBuffer
          ? new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(body));
              controller.close();
            },
          })
          : body,
        arrayBuffer: async () => {
          if (typeof obj.body === 'string') {
            return new TextEncoder().encode(obj.body).buffer;
          }
          return obj.body as ArrayBuffer;
        },
        text: async () => {
          if (typeof obj.body === 'string') return obj.body;
          return new TextDecoder().decode(obj.body as ArrayBuffer);
        },
        json: async () => JSON.parse(typeof obj.body === 'string' ? obj.body : new TextDecoder().decode(obj.body as ArrayBuffer)),
      };
    }),
    head: vi.fn().mockImplementation(async (key: string) => {
      const obj = objects[key];
      if (!obj) return null;
      return {
        key: obj.key,
        size: obj.size,
        etag: obj.etag,
        httpEtag: obj.httpEtag,
        customMetadata: obj.customMetadata,
      };
    }),
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockImplementation(async (options?: { prefix?: string; limit?: number }) => {
      let entries = Object.values(objects);
      if (options?.prefix) {
        entries = entries.filter(obj => obj.key.startsWith(options.prefix!));
      }
      if (options?.limit) {
        entries = entries.slice(0, options.limit);
      }
      return {
        objects: entries.map(obj => ({
          key: obj.key,
          size: obj.size,
          etag: obj.etag,
          httpEtag: obj.httpEtag,
        })),
        truncated: false,
        cursor: undefined,
      };
    }),
  };
}

// ============================================================================
// Test Data Generators
// ============================================================================

/**
 * Generate test JSON data
 */
export function generateTestJsonData(rows: number, columns: string[]): object {
  const data = [];
  const meta = columns.map(col => {
    let type = 'String';
    if (col.includes('int') || col.includes('id') || col.includes('number')) {
      type = 'UInt64';
    } else if (col.includes('float') || col.includes('price') || col.includes('amount')) {
      type = 'Float64';
    } else if (col.includes('bool')) {
      type = 'Bool';
    } else if (col.includes('date')) {
      type = 'Date';
    }
    return { name: col, type };
  });

  for (let i = 0; i < rows; i++) {
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      if (col.includes('int') || col.includes('id') || col.includes('number')) {
        row[col] = i + 1;
      } else if (col.includes('float') || col.includes('price') || col.includes('amount')) {
        row[col] = (i + 1) * 1.5;
      } else if (col.includes('bool')) {
        row[col] = i % 2 === 0;
      } else if (col.includes('date')) {
        const date = new Date(2024, 0, 1);
        date.setDate(date.getDate() + i);
        row[col] = date.toISOString().split('T')[0];
      } else {
        row[col] = `value_${i + 1}`;
      }
    }
    data.push(row);
  }

  return { meta, data, rows };
}

/**
 * Generate test CSV data
 */
export function generateTestCsvData(rows: number, columns: string[], includeHeader = true): string {
  const lines: string[] = [];

  if (includeHeader) {
    lines.push(columns.join(','));
  }

  for (let i = 0; i < rows; i++) {
    const values = columns.map(col => {
      if (col.includes('int') || col.includes('id') || col.includes('number')) {
        return String(i + 1);
      } else if (col.includes('float') || col.includes('price') || col.includes('amount')) {
        return String((i + 1) * 1.5);
      } else if (col.includes('bool')) {
        return i % 2 === 0 ? 'true' : 'false';
      } else if (col.includes('date')) {
        const date = new Date(2024, 0, 1);
        date.setDate(date.getDate() + i);
        return date.toISOString().split('T')[0];
      } else {
        return `value_${i + 1}`;
      }
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * Generate test Parquet-like binary data (mock)
 * In real tests, use actual parquet library or fixture files
 */
export function generateMockParquetData(rows: number): ArrayBuffer {
  // Parquet magic bytes: PAR1
  const magic = new Uint8Array([0x50, 0x41, 0x52, 0x31]);
  // Mock some data bytes
  const dataSize = rows * 8;
  const buffer = new ArrayBuffer(magic.length + dataSize + magic.length);
  const view = new Uint8Array(buffer);

  // Start magic
  view.set(magic, 0);

  // Mock data
  for (let i = 0; i < dataSize; i++) {
    view[magic.length + i] = i % 256;
  }

  // End magic
  view.set(magic, magic.length + dataSize);

  return buffer;
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Parse JSON safely with error context
 */
export function parseJSON<T = unknown>(jsonString: string, context?: string): T {
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    const preview = jsonString.slice(0, 100);
    throw new Error(
      `Failed to parse JSON${context ? ` (${context})` : ''}: ${error instanceof Error ? error.message : String(error)}\nPreview: ${preview}...`
    );
  }
}

/**
 * Compare floating point numbers with tolerance
 */
export function floatEquals(a: number, b: number, tolerance = 0.0001): boolean {
  return Math.abs(a - b) < tolerance;
}

/**
 * Assert that a JSON result matches expected structure
 */
export function assertJsonResult(
  result: string,
  expected: {
    rowCount?: number;
    columnNames?: string[];
    hasStatistics?: boolean;
  }
): void {
  const parsed = parseJSON<{
    data: unknown[];
    meta: Array<{ name: string }>;
    rows: number;
    statistics?: unknown;
  }>(result);

  if (expected.rowCount !== undefined) {
    if (parsed.data.length !== expected.rowCount) {
      throw new Error(`Expected ${expected.rowCount} rows, got ${parsed.data.length}`);
    }
  }

  if (expected.columnNames) {
    const actualColumns = parsed.meta.map(m => m.name);
    for (const col of expected.columnNames) {
      if (!actualColumns.includes(col)) {
        throw new Error(`Expected column "${col}" not found. Got: ${actualColumns.join(', ')}`);
      }
    }
  }

  if (expected.hasStatistics && !parsed.statistics) {
    throw new Error('Expected statistics in result');
  }
}

// ============================================================================
// Async Helpers
// ============================================================================

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Measure execution time of an async function
 */
export async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Retry an async operation with configurable options
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delayMs?: number; shouldRetry?: (error: Error) => boolean } = {}
): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, shouldRetry = () => true } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts || !shouldRetry(lastError)) {
        throw lastError;
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

// ============================================================================
// Memory Tracking
// ============================================================================

/**
 * Memory tracking utility for leak detection
 */
export class MemoryTracker {
  private snapshots: Array<{ label: string; usage: NodeJS.MemoryUsage; timestamp: number }> = [];

  snapshot(label: string): void {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      this.snapshots.push({
        label,
        usage: process.memoryUsage(),
        timestamp: Date.now(),
      });
    }
  }

  getReport(): string {
    if (this.snapshots.length === 0) {
      return 'No memory snapshots recorded';
    }

    const lines = ['Memory Usage Report:', ''];

    for (let i = 0; i < this.snapshots.length; i++) {
      const snap = this.snapshots[i];
      const heapUsedMB = (snap.usage.heapUsed / 1024 / 1024).toFixed(2);
      const heapTotalMB = (snap.usage.heapTotal / 1024 / 1024).toFixed(2);

      lines.push(`[${snap.label}] Heap: ${heapUsedMB}MB / ${heapTotalMB}MB`);

      if (i > 0) {
        const prev = this.snapshots[i - 1];
        const delta = snap.usage.heapUsed - prev.usage.heapUsed;
        const deltaMB = (delta / 1024 / 1024).toFixed(2);
        const sign = delta >= 0 ? '+' : '';
        lines.push(`  Delta from previous: ${sign}${deltaMB}MB`);
      }
    }

    return lines.join('\n');
  }

  clear(): void {
    this.snapshots = [];
  }

  getLastDelta(): number | null {
    if (this.snapshots.length < 2) return null;
    const prev = this.snapshots[this.snapshots.length - 2];
    const curr = this.snapshots[this.snapshots.length - 1];
    return curr.usage.heapUsed - prev.usage.heapUsed;
  }
}

// ============================================================================
// Request/Response Helpers for Worker Tests
// ============================================================================

/**
 * Create a Request object for testing
 */
export function createTestRequest(
  url: string,
  options?: RequestInit & { baseUrl?: string }
): Request {
  const baseUrl = options?.baseUrl ?? 'http://localhost';
  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  return new Request(fullUrl, options);
}

/**
 * Create a mock Worker environment
 */
export function createMockWorkerEnv(overrides?: Record<string, unknown>) {
  return {
    WASM_BUCKET: createMockR2Bucket({}),
    ...overrides,
  };
}

// ============================================================================
// Export All Utilities
// ============================================================================

export const testUtils = {
  createMockChdbInstance,
  createConfigurableChdbMock,
  createMockFetch,
  createJsonFetchMock,
  createCsvFetchMock,
  createFailingFetchMock,
  createMockR2Bucket,
  generateTestJsonData,
  generateTestCsvData,
  generateMockParquetData,
  parseJSON,
  floatEquals,
  assertJsonResult,
  waitFor,
  measureTime,
  retry,
  MemoryTracker,
  createTestRequest,
  createMockWorkerEnv,
};
