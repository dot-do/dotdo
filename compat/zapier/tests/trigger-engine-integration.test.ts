/**
 * TriggerEngine Integration Tests for Zapier Compat
 *
 * Tests integration between Zapier's trigger system and dotdo's TriggerEngine primitive.
 * GREEN phase - implementation tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Bundle, ZObject, TriggerConfig } from '../types'
import { Trigger, PollingTriggerExecutor, WebhookTriggerManager } from '../triggers'
import {
  ZapierTriggerBridge,
  ZapierPollingBridge,
  ZapierWebhookBridge,
  TriggerEngine,
} from '../trigger-engine-bridge'

// =============================================================================
// TEST FIXTURES
// =============================================================================

function createMockZObject(): ZObject {
  return {
    request: vi.fn().mockResolvedValue({ data: [], status: 200 }),
    console: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    JSON: {
      parse: JSON.parse,
      stringify: JSON.stringify,
    },
    hash: vi.fn().mockReturnValue('mock-hash'),
    errors: {
      Error: Error,
      HaltedError: class HaltedError extends Error {},
      ExpiredAuthError: class ExpiredAuthError extends Error {},
      RefreshAuthError: class RefreshAuthError extends Error {},
      ThrottledError: class ThrottledError extends Error {},
    },
    cursor: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    generateCallbackUrl: vi.fn().mockReturnValue('https://hooks.zapier.com/callback/123'),
    dehydrate: vi.fn().mockImplementation((func, data) => `dehydrate:${JSON.stringify(data)}`),
    dehydrateFile: vi.fn().mockImplementation((url) => `file:${url}`),
    stashFile: vi.fn().mockResolvedValue('https://zapier.com/stashed/file'),
    cache: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as ZObject
}

function createMockBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    authData: { access_token: 'test-token' },
    inputData: {},
    meta: {
      isLoadingSample: false,
      isFillingDynamicDropdown: false,
      isTestingAuth: false,
      isPopulatingDedupe: false,
      limit: 100,
      page: 0,
      zap: { id: 'zap-123' },
    },
    ...overrides,
  }
}

// =============================================================================
// ZAPIER TRIGGER BRIDGE TESTS
// =============================================================================

describe('ZapierTriggerBridge', () => {
  describe('bridge creation', () => {
    it('should create a bridge from a Zapier polling trigger', async () => {
      const triggerConfig: TriggerConfig = {
        key: 'new_contact',
        noun: 'Contact',
        display: { label: 'New Contact', description: 'Triggers on new contact' },
        operation: {
          type: 'polling',
          perform: async (z, bundle) => {
            const response = await z.request('https://api.example.com/contacts')
            return response.data as unknown[]
          },
        },
      }

      const engine = new TriggerEngine()
      const bridge = new ZapierTriggerBridge(engine)

      const triggerId = await bridge.registerTrigger(triggerConfig, createMockBundle())

      expect(triggerId).toBeDefined()
      expect(engine.registry.has(triggerId)).toBe(true)
    })

    it('should create a bridge from a Zapier webhook trigger', async () => {
      const triggerConfig: TriggerConfig = {
        key: 'new_order',
        noun: 'Order',
        display: { label: 'New Order', description: 'Triggers on new order webhook' },
        operation: {
          type: 'hook',
          performSubscribe: async (z, bundle) => ({ id: 'sub-123' }),
          performUnsubscribe: async (z, bundle) => undefined,
          perform: async (z, bundle) => [bundle.cleanedRequest],
        },
      }

      const engine = new TriggerEngine()
      const bridge = new ZapierTriggerBridge(engine)

      const triggerId = await bridge.registerTrigger(triggerConfig, createMockBundle())

      expect(triggerId).toBeDefined()
      expect(engine.registry.has(triggerId)).toBe(true)

      // Should be registered as webhook type in engine
      const trigger = engine.registry.get(triggerId)
      expect(trigger?.type).toBe('webhook')
    })
  })

  describe('trigger execution', () => {
    it('should execute a polling trigger through the engine', async () => {
      const mockData = [
        { id: '1', name: 'Contact 1' },
        { id: '2', name: 'Contact 2' },
      ]

      const triggerConfig: TriggerConfig = {
        key: 'new_contact',
        noun: 'Contact',
        display: { label: 'New Contact', description: 'Triggers on new contact' },
        operation: {
          type: 'polling',
          perform: async (z, bundle) => mockData,
        },
      }

      const engine = new TriggerEngine()
      const bridge = new ZapierTriggerBridge(engine)
      const z = createMockZObject()
      const bundle = createMockBundle()

      const triggerId = await bridge.registerTrigger(triggerConfig, bundle)

      // Execute through bridge
      const results = await bridge.executeTrigger(triggerId, z, bundle)

      expect(results).toHaveLength(2)
      expect(results[0]).toMatchObject({ id: '1', name: 'Contact 1' })
    })

    it('should deduplicate results using TriggerEngine', async () => {
      let callCount = 0
      const triggerConfig: TriggerConfig = {
        key: 'new_contact',
        noun: 'Contact',
        display: { label: 'New Contact', description: 'Triggers on new contact' },
        operation: {
          type: 'polling',
          perform: async (z, bundle) => {
            callCount++
            // Return same items on second call
            if (callCount === 1) {
              return [
                { id: '1', name: 'Contact 1' },
                { id: '2', name: 'Contact 2' },
              ]
            }
            return [
              { id: '2', name: 'Contact 2' }, // duplicate
              { id: '3', name: 'Contact 3' }, // new
            ]
          },
        },
      }

      const engine = new TriggerEngine()
      const bridge = new ZapierTriggerBridge(engine)
      const z = createMockZObject()
      const bundle = createMockBundle()

      const triggerId = await bridge.registerTrigger(triggerConfig, bundle)

      // First execution
      const results1 = await bridge.executeTrigger(triggerId, z, bundle)
      expect(results1).toHaveLength(2)

      // Second execution - should deduplicate
      const results2 = await bridge.executeTrigger(triggerId, z, bundle)
      expect(results2).toHaveLength(1) // Only new item
      expect(results2[0]).toMatchObject({ id: '3', name: 'Contact 3' })
    })
  })

  describe('webhook handling', () => {
    it('should handle webhook through TriggerEngine', async () => {
      const triggerConfig: TriggerConfig = {
        key: 'new_order',
        noun: 'Order',
        display: { label: 'New Order', description: 'Triggers on new order' },
        operation: {
          type: 'hook',
          performSubscribe: async (z, bundle) => ({
            id: 'sub-123',
            targetUrl: bundle.targetUrl,
          }),
          performUnsubscribe: async (z, bundle) => undefined,
          perform: async (z, bundle) => {
            // Transform webhook payload
            return [bundle.cleanedRequest]
          },
        },
      }

      const engine = new TriggerEngine()
      const bridge = new ZapierWebhookBridge(engine)
      const z = createMockZObject()
      const bundle = createMockBundle({ targetUrl: 'https://hooks.zapier.com/abc' })

      // Register webhook trigger
      const triggerId = await bridge.registerTrigger(triggerConfig, z, bundle)

      // Simulate incoming webhook
      const webhookPayload = {
        order_id: 'ord-123',
        total: 99.99,
        customer: { email: 'test@example.com' },
      }

      const request = new Request('https://api.dotdo.dev/webhooks/new_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload),
      })

      const result = await bridge.handleWebhook(triggerId, request)

      expect(result.success).toBe(true)
      expect(result.data).toMatchObject(webhookPayload)
    })

    it('should validate webhook signatures', async () => {
      const engine = new TriggerEngine()
      const bridge = new ZapierWebhookBridge(engine, {
        secret: 'webhook-secret',
        signatureHeader: 'x-signature',
      })

      const triggerConfig: TriggerConfig = {
        key: 'secure_webhook',
        noun: 'Event',
        display: { label: 'Secure Event', description: 'Validates signatures' },
        operation: {
          type: 'hook',
          performSubscribe: async (z, bundle) => ({ id: 'sub-456' }),
          performUnsubscribe: async (z, bundle) => undefined,
          perform: async (z, bundle) => [bundle.cleanedRequest],
        },
      }

      const z = createMockZObject()
      const bundle = createMockBundle()
      const triggerId = await bridge.registerTrigger(triggerConfig, z, bundle)

      // Request without signature should fail
      const invalidRequest = new Request('https://api.dotdo.dev/webhooks/secure', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      })

      const result = await bridge.handleWebhook(triggerId, invalidRequest)
      expect(result.success).toBe(false)
      expect(result.error).toContain('signature')
    })
  })
})

// =============================================================================
// ZAPIER POLLING BRIDGE TESTS
// =============================================================================

describe('ZapierPollingBridge', () => {
  describe('interval management', () => {
    it('should configure polling interval from TriggerEngine', async () => {
      const engine = new TriggerEngine()
      const bridge = new ZapierPollingBridge(engine, {
        defaultIntervalMs: 60_000,
        minIntervalMs: 30_000,
      })

      const triggerConfig: TriggerConfig = {
        key: 'poll_data',
        noun: 'Data',
        display: { label: 'Poll Data', description: 'Polls for data' },
        operation: {
          type: 'polling',
          perform: async (z, bundle) => [],
        },
      }

      const bundle = createMockBundle()
      const triggerId = await bridge.registerTrigger(triggerConfig, bundle)

      // Check that TriggerEngine's polling scheduler has the right config
      const pollingConfig = bridge.getPollingConfig(triggerId)
      expect(pollingConfig.intervalMs).toBe(60_000)
      expect(pollingConfig.minIntervalMs).toBe(30_000)
    })

    it('should respect adaptive backoff from TriggerEngine', async () => {
      let failCount = 0
      const triggerConfig: TriggerConfig = {
        key: 'flaky_api',
        noun: 'Item',
        display: { label: 'Flaky API', description: 'Sometimes fails' },
        operation: {
          type: 'polling',
          perform: async (z, bundle) => {
            failCount++
            if (failCount <= 2) {
              throw new Error('API temporarily unavailable')
            }
            return [{ id: '1' }]
          },
        },
      }

      const engine = new TriggerEngine()
      const bridge = new ZapierPollingBridge(engine, {
        initialBackoffMs: 1000,
        maxBackoffMs: 30_000,
      })

      const z = createMockZObject()
      const bundle = createMockBundle()
      const triggerId = await bridge.registerTrigger(triggerConfig, bundle)

      // First call fails
      await expect(bridge.executeTrigger(triggerId, z, bundle)).rejects.toThrow()
      expect(bridge.getBackoffMs(triggerId)).toBe(1000)

      // Second call fails - backoff doubles
      await expect(bridge.executeTrigger(triggerId, z, bundle)).rejects.toThrow()
      expect(bridge.getBackoffMs(triggerId)).toBe(2000)

      // Third call succeeds - backoff resets
      const results = await bridge.executeTrigger(triggerId, z, bundle)
      expect(results).toHaveLength(1)
      expect(bridge.getBackoffMs(triggerId)).toBe(0)
    })
  })

  describe('cursor/pagination state', () => {
    it('should persist cursor state through TriggerEngine', async () => {
      let pageNumber = 0
      const triggerConfig: TriggerConfig = {
        key: 'paginated_api',
        noun: 'Item',
        display: { label: 'Paginated API', description: 'Uses cursor' },
        operation: {
          type: 'polling',
          canPaginate: true,
          perform: async (z, bundle) => {
            const cursor = await z.cursor.get()
            pageNumber = cursor ? parseInt(cursor as string, 10) : 0

            const items = [{ id: `${pageNumber * 10 + 1}` }, { id: `${pageNumber * 10 + 2}` }]

            // Set cursor for next page
            await z.cursor.set(String(pageNumber + 1))

            return items
          },
        },
      }

      const engine = new TriggerEngine()
      const bridge = new ZapierPollingBridge(engine)

      const z = createMockZObject()
      const bundle = createMockBundle()
      const triggerId = await bridge.registerTrigger(triggerConfig, bundle)

      // First poll - page 0
      const results1 = await bridge.executeTrigger(triggerId, z, bundle)
      expect(results1[0]).toMatchObject({ id: '1' })

      // Get stored cursor
      const cursor = await bridge.getCursor(triggerId)
      expect(cursor).toBe('1')

      // Second poll with cursor - page 1
      const results2 = await bridge.executeTrigger(triggerId, z, bundle)
      expect(results2[0]).toMatchObject({ id: '11' })
    })

    it('should handle cursor through bundle.meta.cursor', async () => {
      const engine = new TriggerEngine()
      const bridge = new ZapierPollingBridge(engine)

      const triggerConfig: TriggerConfig = {
        key: 'offset_api',
        noun: 'Record',
        display: { label: 'Offset API', description: 'Uses offset pagination' },
        operation: {
          type: 'polling',
          canPaginate: true,
          perform: async (z, bundle) => {
            const offset = (bundle.meta?.cursor as number) || 0
            return [
              { id: `${offset + 1}`, offset },
              { id: `${offset + 2}`, offset },
            ]
          },
        },
      }

      const z = createMockZObject()
      const bundle = createMockBundle()

      const triggerId = await bridge.registerTrigger(triggerConfig, bundle)

      // Execute with offset cursor
      await bridge.setCursor(triggerId, 10)
      const results = await bridge.executeTrigger(triggerId, z, bundle)

      expect(results[0]).toMatchObject({ id: '11', offset: 10 })
    })
  })

  describe('bundle context preservation', () => {
    it('should pass authData to TriggerEngine context', async () => {
      let capturedAuthData: unknown
      const triggerConfig: TriggerConfig = {
        key: 'auth_trigger',
        noun: 'Item',
        display: { label: 'Auth Trigger', description: 'Uses auth' },
        operation: {
          type: 'polling',
          perform: async (z, bundle) => {
            capturedAuthData = bundle.authData
            return []
          },
        },
      }

      const engine = new TriggerEngine()
      const bridge = new ZapierPollingBridge(engine)

      const z = createMockZObject()
      const bundle = createMockBundle({
        authData: {
          access_token: 'secret-token',
          refresh_token: 'refresh-token',
        },
      })

      const triggerId = await bridge.registerTrigger(triggerConfig, bundle)
      await bridge.executeTrigger(triggerId, z, bundle)

      expect(capturedAuthData).toMatchObject({
        access_token: 'secret-token',
        refresh_token: 'refresh-token',
      })
    })

    it('should pass inputData to TriggerEngine context', async () => {
      let capturedInputData: unknown
      const triggerConfig: TriggerConfig = {
        key: 'input_trigger',
        noun: 'Item',
        display: { label: 'Input Trigger', description: 'Uses input' },
        operation: {
          type: 'polling',
          inputFields: [
            { key: 'status', label: 'Status', type: 'string' },
            { key: 'limit', label: 'Limit', type: 'integer' },
          ],
          perform: async (z, bundle) => {
            capturedInputData = bundle.inputData
            return []
          },
        },
      }

      const engine = new TriggerEngine()
      const bridge = new ZapierPollingBridge(engine)

      const z = createMockZObject()
      const bundle = createMockBundle({
        inputData: {
          status: 'active',
          limit: 50,
        },
      })

      const triggerId = await bridge.registerTrigger(triggerConfig, bundle)
      await bridge.executeTrigger(triggerId, z, bundle)

      expect(capturedInputData).toMatchObject({
        status: 'active',
        limit: 50,
      })
    })
  })
})

// =============================================================================
// UNIFIED TRIGGER OUTPUT TESTS
// =============================================================================

describe('Unified Trigger Output', () => {
  it('should convert Zapier results to TriggerEngine TriggerOutput', async () => {
    const triggerConfig: TriggerConfig = {
      key: 'output_test',
      noun: 'Record',
      display: { label: 'Output Test', description: 'Tests output format' },
      operation: {
        type: 'polling',
        perform: async (z, bundle) => [
          { id: '1', email: 'test@example.com', created_at: '2024-01-01' },
        ],
      },
    }

    const engine = new TriggerEngine()
    const bridge = new ZapierTriggerBridge(engine)

    const z = createMockZObject()
    const bundle = createMockBundle()

    const triggerId = await bridge.registerTrigger(triggerConfig, bundle)

    // Get raw TriggerEngine output
    const output = await bridge.executeTriggerRaw(triggerId, z, bundle)

    expect(output).toMatchObject({
      success: true,
      triggerId: expect.stringContaining('output_test'),
      timestamp: expect.any(Number),
      source: 'polling',
      data: expect.arrayContaining([
        expect.objectContaining({ id: '1', email: 'test@example.com' }),
      ]),
    })
  })

  it('should include trigger metadata in output context', async () => {
    const triggerConfig: TriggerConfig = {
      key: 'metadata_test',
      noun: 'Event',
      display: { label: 'Metadata Test', description: 'Tests metadata' },
      operation: {
        type: 'polling',
        perform: async (z, bundle) => [{ id: '1' }],
      },
    }

    const engine = new TriggerEngine()
    const bridge = new ZapierTriggerBridge(engine)

    const z = createMockZObject()
    const bundle = createMockBundle({
      meta: {
        isLoadingSample: false,
        isFillingDynamicDropdown: false,
        isTestingAuth: false,
        isPopulatingDedupe: false,
        limit: 100,
        page: 0,
        zap: { id: 'zap-456' },
      },
    })

    const triggerId = await bridge.registerTrigger(triggerConfig, bundle)
    const output = await bridge.executeTriggerRaw(triggerId, z, bundle)

    expect(output.context).toMatchObject({
      zapier: {
        key: 'metadata_test',
        noun: 'Event',
        zapId: 'zap-456',
      },
    })
  })
})

// =============================================================================
// STATISTICS AND MONITORING TESTS
// =============================================================================

describe('Trigger Statistics', () => {
  it('should track trigger statistics through TriggerEngine', async () => {
    const triggerConfig: TriggerConfig = {
      key: 'stats_trigger',
      noun: 'Item',
      display: { label: 'Stats Trigger', description: 'For stats' },
      operation: {
        type: 'polling',
        perform: async (z, bundle) => [{ id: '1' }],
      },
    }

    const engine = new TriggerEngine()
    const bridge = new ZapierTriggerBridge(engine)

    const z = createMockZObject()
    const bundle = createMockBundle()

    const triggerId = await bridge.registerTrigger(triggerConfig, bundle)

    // Execute a few times
    await bridge.executeTrigger(triggerId, z, bundle)
    await bridge.executeTrigger(triggerId, z, bundle)
    await bridge.executeTrigger(triggerId, z, bundle)

    const stats = engine.getStats(triggerId)
    expect(stats.fireCount).toBe(3)
    expect(stats.successCount).toBe(3)
    expect(stats.failureCount).toBe(0)
    expect(stats.lastFiredAt).toBeDefined()
  })

  it('should track failures in statistics', async () => {
    let callCount = 0
    const triggerConfig: TriggerConfig = {
      key: 'failure_stats',
      noun: 'Item',
      display: { label: 'Failure Stats', description: 'May fail' },
      operation: {
        type: 'polling',
        perform: async (z, bundle) => {
          callCount++
          if (callCount === 2) {
            throw new Error('Simulated failure')
          }
          return [{ id: String(callCount) }]
        },
      },
    }

    const engine = new TriggerEngine()
    const bridge = new ZapierTriggerBridge(engine)

    const z = createMockZObject()
    const bundle = createMockBundle()

    const triggerId = await bridge.registerTrigger(triggerConfig, bundle)

    // First call succeeds
    await bridge.executeTrigger(triggerId, z, bundle)

    // Second call fails
    await expect(bridge.executeTrigger(triggerId, z, bundle)).rejects.toThrow()

    // Third call succeeds
    await bridge.executeTrigger(triggerId, z, bundle)

    const stats = engine.getStats(triggerId)
    expect(stats.fireCount).toBe(3)
    expect(stats.successCount).toBe(2)
    expect(stats.failureCount).toBe(1)
  })
})

// =============================================================================
// EVENT BUS INTEGRATION TESTS
// =============================================================================

describe('Event Bus Integration', () => {
  it('should emit events to TriggerEngine EventBus', async () => {
    const engine = new TriggerEngine()
    const bridge = new ZapierTriggerBridge(engine)

    const receivedEvents: unknown[] = []
    engine.events.on('zapier.trigger.fired', (data) => {
      receivedEvents.push(data)
    })

    const triggerConfig: TriggerConfig = {
      key: 'event_trigger',
      noun: 'Event',
      display: { label: 'Event Trigger', description: 'Emits events' },
      operation: {
        type: 'polling',
        perform: async (z, bundle) => [{ id: '1', type: 'test' }],
      },
    }

    const z = createMockZObject()
    const bundle = createMockBundle()

    const triggerId = await bridge.registerTrigger(triggerConfig, bundle)
    await bridge.executeTrigger(triggerId, z, bundle)

    expect(receivedEvents).toHaveLength(1)
    expect(receivedEvents[0]).toMatchObject({
      triggerId,
      triggerKey: 'event_trigger',
      resultCount: 1,
    })
  })

  it('should allow subscribing to trigger events', async () => {
    const engine = new TriggerEngine()
    const bridge = new ZapierTriggerBridge(engine)

    const triggerConfig: TriggerConfig = {
      key: 'subscribe_test',
      noun: 'Item',
      display: { label: 'Subscribe Test', description: 'For subscriptions' },
      operation: {
        type: 'polling',
        perform: async (z, bundle) => [{ id: '1' }],
      },
    }

    const z = createMockZObject()
    const bundle = createMockBundle()

    const triggerId = await bridge.registerTrigger(triggerConfig, bundle)

    // Subscribe to this specific trigger
    const receivedItems: unknown[] = []
    const unsubscribe = bridge.onTrigger(triggerId, (items) => {
      receivedItems.push(...items)
    })

    await bridge.executeTrigger(triggerId, z, bundle)

    expect(receivedItems).toHaveLength(1)

    // Unsubscribe
    unsubscribe()

    await bridge.executeTrigger(triggerId, z, bundle)
    expect(receivedItems).toHaveLength(1) // No new items after unsubscribe
  })
})
