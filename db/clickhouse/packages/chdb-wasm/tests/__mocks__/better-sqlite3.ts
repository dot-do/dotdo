/**
 * Mock for better-sqlite3 module
 *
 * This mock provides stub implementations for better-sqlite3
 * which is a Node.js-only native module that doesn't work in browser/Vitest.
 *
 * The mergetree-lite-schema.test.ts uses better-sqlite3 directly,
 * but we need to mock it for the test environment.
 */

import { vi } from 'vitest';

/**
 * Mock Statement class
 */
class MockStatement {
  private sql: string;

  constructor(sql: string) {
    this.sql = sql;
  }

  run = vi.fn((..._params: unknown[]) => ({ changes: 0, lastInsertRowid: 0 }));
  get = vi.fn((..._params: unknown[]) => undefined);
  all = vi.fn((..._params: unknown[]) => []);
  iterate = vi.fn(function* (..._params: unknown[]) {});
  bind = vi.fn((..._params: unknown[]) => this);
  pluck = vi.fn((_toggle?: boolean) => this);
  expand = vi.fn((_toggle?: boolean) => this);
  raw = vi.fn((_toggle?: boolean) => this);
  columns = vi.fn(() => []);
  safeIntegers = vi.fn((_toggle?: boolean) => this);
}

/**
 * Mock Transaction class
 */
class MockTransaction<T> {
  private fn: (...args: unknown[]) => T;

  constructor(fn: (...args: unknown[]) => T) {
    this.fn = fn;
  }

  default = vi.fn((...args: unknown[]) => this.fn(...args));
  deferred = vi.fn((...args: unknown[]) => this.fn(...args));
  immediate = vi.fn((...args: unknown[]) => this.fn(...args));
  exclusive = vi.fn((...args: unknown[]) => this.fn(...args));
}

/**
 * Mock Database class that mimics better-sqlite3's API
 */
class MockDatabase {
  name: string;
  open: boolean;
  inTransaction: boolean;
  readonly: boolean;
  memory: boolean;

  constructor(filename?: string, _options?: Record<string, unknown>) {
    this.name = filename || ':memory:';
    this.open = true;
    this.inTransaction = false;
    this.readonly = false;
    this.memory = filename === ':memory:';
  }

  prepare = vi.fn((sql: string) => new MockStatement(sql));

  transaction = vi.fn(<T>(fn: (...args: unknown[]) => T) => {
    const transaction = new MockTransaction(fn);
    return Object.assign((...args: unknown[]) => {
      this.inTransaction = true;
      try {
        return fn(...args);
      } finally {
        this.inTransaction = false;
      }
    }, transaction);
  });

  exec = vi.fn((_sql: string) => this);

  pragma = vi.fn((_pragma: string, _options?: { simple?: boolean }) => undefined);

  function = vi.fn((_name: string, _fn: (...args: unknown[]) => unknown) => this);

  aggregate = vi.fn((_name: string, _options: Record<string, unknown>) => this);

  table = vi.fn((_name: string, _definition: Record<string, unknown>) => this);

  loadExtension = vi.fn((_path: string, _entryPoint?: string) => this);

  close = vi.fn(() => {
    this.open = false;
  });

  defaultSafeIntegers = vi.fn((_toggle?: boolean) => this);

  unsafeMode = vi.fn((_toggle?: boolean) => this);

  backup = vi.fn((_destinationFile: string, _options?: Record<string, unknown>) => {
    return Promise.resolve({
      totalPages: 0,
      remainingPages: 0,
      idle: false,
      completed: false,
      transfer: vi.fn(() => 0),
      close: vi.fn(),
    });
  });

  serialize = vi.fn((_options?: Record<string, unknown>) => Buffer.from([]));
}

// Export the mock Database as the default export (matching better-sqlite3's API)
export default MockDatabase;

// Also export as named export for flexibility
export { MockDatabase as Database };
