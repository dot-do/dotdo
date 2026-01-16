/**
 * Test utilities for Cap'n Web RPC
 *
 * Provides mock schemas and behaviors for testing without hardcoding
 * test-specific logic in production code.
 */

import type { Schema } from './shared-types'

/**
 * Mock RPC handler function type
 */
export type MockRpcHandler = (method: string, args: unknown[]) => Promise<unknown>

/**
 * Schema provider function type
 */
export type SchemaProvider = (targetUrl: string) => Schema | undefined

/**
 * Test entity schema for contract tests
 */
export const TestEntitySchema: Schema = {
  name: 'TestEntity',
  fields: [
    { name: '$id', type: 'string', required: true, description: 'Unique identifier' },
    { name: 'name', type: 'string', required: true },
    { name: 'value', type: 'number', required: true },
    { name: 'tags', type: 'string[]', required: true },
    { name: 'createdAt', type: 'Date', required: true },
    { name: 'metadata', type: 'object', required: true },
  ],
  methods: [
    { name: 'getValue', params: [], returns: 'Promise<number>' },
    { name: 'setValue', params: [{ name: 'value', type: 'number', required: true }], returns: 'Promise<void>' },
    { name: 'increment', params: [{ name: 'by', type: 'number', required: false }], returns: 'Promise<number>' },
    { name: 'getTags', params: [], returns: 'Promise<string[]>' },
    { name: 'addTag', params: [{ name: 'tag', type: 'string', required: true }], returns: 'Promise<void>' },
    { name: 'setMetadata', params: [{ name: 'key', type: 'string', required: true }, { name: 'value', type: 'unknown', required: true }], returns: 'Promise<void>' },
    { name: 'getMetadata', params: [{ name: 'key', type: 'string', required: true }], returns: 'Promise<unknown>' },
  ],
}

/**
 * Customer schema for default/backwards compatibility
 */
export const CustomerSchema: Schema = {
  name: 'Customer',
  fields: [
    { name: '$id', type: 'string', required: true, description: 'Unique identifier' },
    { name: 'name', type: 'string', required: true },
    { name: 'email', type: 'string', required: true },
    { name: 'orders', type: 'string[]', required: false },
  ],
  methods: [
    {
      name: 'charge',
      params: [{ name: 'amount', type: 'number', required: true }],
      returns: 'Promise<Receipt>',
    },
    {
      name: 'getOrders',
      params: [],
      returns: 'Promise<Order[]>',
    },
    {
      name: 'notify',
      params: [{ name: 'message', type: 'string', required: true }],
      returns: 'Promise<void>',
    },
  ],
}

/**
 * Default mock RPC handler for testing
 * Simulates common method responses
 */
export function createDefaultMockHandler(): MockRpcHandler {
  return async (method: string, args: unknown[]): Promise<unknown> => {
    if (method === 'getOrders') {
      return []
    }

    if (method === 'notify') {
      return undefined
    }

    if (method === 'charge') {
      return {
        id: `rcpt-${Date.now()}`,
        amount: args[0],
        timestamp: new Date(),
      }
    }

    if (method === 'streamOrders') {
      // Return an async iterable
      return {
        [Symbol.asyncIterator](): AsyncIterator<unknown> {
          let i = 0
          return {
            async next() {
              if (i >= 10) {
                return { done: true, value: undefined }
              }
              // Yield to event loop to allow proper async iteration
              await Promise.resolve()
              i++
              return {
                done: false,
                value: { id: `order-${i}`, customerId: 'cust-123', total: 100, items: [], createdAt: new Date() },
              }
            },
          }
        },
      }
    }

    return undefined
  }
}

/**
 * Create a slow mock handler that delays before responding
 * Used for testing timeout behavior
 */
export function createSlowMockHandler(delayMs: number, abortCheckIntervalMs: number = 5): MockRpcHandler {
  return async (_method: string, _args: unknown[]): Promise<unknown> => {
    // Simulate a slow operation using polling-based abort detection
    const startTime = Date.now()

    while (Date.now() - startTime < delayMs) {
      // Yield to event loop with a short wait
      await new Promise(resolve => setTimeout(resolve, abortCheckIntervalMs))
    }

    return undefined
  }
}

/**
 * Configuration for test behaviors in RPC client
 */
export interface TestBehaviorConfig {
  /** Custom schema provider for URL-based schema resolution */
  schemaProvider?: SchemaProvider
  /** Custom mock handler for simulating RPC responses */
  mockHandler?: MockRpcHandler
  /** Simulate slow responses (for timeout testing) */
  simulateSlowMs?: number
}

/**
 * Global test behavior registry
 * Tests can register behaviors here without modifying production code
 */
let globalTestBehaviors: TestBehaviorConfig | undefined

/**
 * Set global test behaviors (call in test setup)
 */
export function setTestBehaviors(config: TestBehaviorConfig | undefined): void {
  globalTestBehaviors = config
}

/**
 * Get current test behaviors
 */
export function getTestBehaviors(): TestBehaviorConfig | undefined {
  return globalTestBehaviors
}

/**
 * Clear test behaviors (call in test teardown)
 */
export function clearTestBehaviors(): void {
  globalTestBehaviors = undefined
}
