/**
 * Mock for cloudflare:workers module
 *
 * This mock provides stub implementations of Cloudflare Workers APIs
 * for use in Node.js test environments (vitest).
 *
 * The actual cloudflare:workers module is only available in the
 * Cloudflare Workers runtime, so we need to mock it for unit/integration tests.
 */

import { vi } from 'vitest';

/**
 * Mock DurableObjectState - provides storage and concurrency control
 */
export class MockDurableObjectState {
  private data: Map<string, unknown> = new Map();

  storage = {
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
      return this.data.get(key) as T | undefined;
    }),
    put: vi.fn(async (key: string, value: unknown): Promise<void> => {
      this.data.set(key, value);
    }),
    delete: vi.fn(async (key: string): Promise<boolean> => {
      return this.data.delete(key);
    }),
    list: vi.fn(async (): Promise<Map<string, unknown>> => {
      return new Map(this.data);
    }),
  };

  blockConcurrencyWhile = vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => {
    return await callback();
  });

  waitUntil = vi.fn((_promise: Promise<unknown>): void => {
    // No-op in tests
  });
}

/**
 * Mock DurableObject base class
 *
 * This is the base class that Durable Objects extend in Cloudflare Workers.
 * We provide a minimal implementation for testing purposes.
 */
export class DurableObject {
  protected ctx: MockDurableObjectState;
  protected env: Record<string, unknown>;

  constructor(ctx?: MockDurableObjectState, env?: Record<string, unknown>) {
    this.ctx = ctx || new MockDurableObjectState();
    this.env = env || {};
  }

  /**
   * Default fetch handler - can be overridden by subclasses
   */
  async fetch(_request: Request): Promise<Response> {
    return new Response('Not implemented', { status: 501 });
  }
}

/**
 * Mock DurableObjectNamespace
 */
export class MockDurableObjectNamespace<T extends DurableObject = DurableObject> {
  private instances: Map<string, T> = new Map();
  private DOClass: new (ctx: MockDurableObjectState, env: Record<string, unknown>) => T;
  private env: Record<string, unknown>;

  constructor(DOClass: new (ctx: MockDurableObjectState, env: Record<string, unknown>) => T, env: Record<string, unknown> = {}) {
    this.DOClass = DOClass;
    this.env = env;
  }

  idFromName(name: string): DurableObjectId {
    return { name, toString: () => name } as DurableObjectId;
  }

  idFromString(id: string): DurableObjectId {
    return { name: id, toString: () => id } as DurableObjectId;
  }

  get(id: DurableObjectId): DurableObjectStub<T> {
    const idStr = id.toString();
    if (!this.instances.has(idStr)) {
      const ctx = new MockDurableObjectState();
      this.instances.set(idStr, new this.DOClass(ctx, this.env));
    }
    const instance = this.instances.get(idStr)!;

    // Return a stub that proxies to the instance
    return {
      fetch: (request: Request) => instance.fetch(request),
      id,
      name: idStr,
    } as unknown as DurableObjectStub<T>;
  }

  newUniqueId(): DurableObjectId {
    const id = `unique_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return { name: id, toString: () => id } as DurableObjectId;
  }
}

/**
 * Mock DurableObjectId interface
 */
export interface DurableObjectId {
  name?: string;
  toString(): string;
  equals(other: DurableObjectId): boolean;
}

/**
 * Mock DurableObjectStub interface
 */
export interface DurableObjectStub<T extends DurableObject = DurableObject> {
  fetch(request: Request): Promise<Response>;
  id: DurableObjectId;
  name?: string;
}

// Re-export types that may be expected from cloudflare:workers
export type { MockDurableObjectState as DurableObjectState };
export type DurableObjectNamespace<T extends DurableObject = DurableObject> = MockDurableObjectNamespace<T>;

// Default export for module compatibility
export default {
  DurableObject,
  MockDurableObjectState,
  MockDurableObjectNamespace,
};
