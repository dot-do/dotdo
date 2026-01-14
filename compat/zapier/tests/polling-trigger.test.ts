/**
 * Polling Trigger Tests - TDD RED Phase
 *
 * Comprehensive tests for Zapier-compatible polling triggers:
 * - Polling trigger definition
 * - perform() function execution
 * - Deduplication via id field
 * - Reverse chronological ordering
 * - Bundle context (authData, inputData)
 * - Pagination handling
 * - Sample data retrieval
 *
 * These tests are expected to FAIL because the PollingTrigger class
 * and related functionality don't exist yet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Bundle, ZObject } from '../types'
import { createZObject } from '../z-object'

// These imports will fail until implementation exists
// import {
//   PollingTrigger,
//   createPollingTriggerWithDedup,
//   PollingTriggerRunner,
//   PollingTriggerSampleLoader,
// } from '../polling'

describe('Polling Trigger', () => {
  let z: ZObject
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    z = createZObject()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // ============================================================================
  // POLLING TRIGGER DEFINITION TESTS
  // ============================================================================

  describe('Polling Trigger Definition', () => {
    it('should define a polling trigger with key, noun, and display', () => {
      // PollingTrigger class should accept a config object
      const PollingTrigger = (globalThis as any).PollingTrigger
      expect(PollingTrigger).toBeDefined()

      const trigger = new PollingTrigger({
        key: 'new_order',
        noun: 'Order',
        display: {
          label: 'New Order',
          description: 'Triggers when a new order is created',
        },
        perform: async (z: ZObject, bundle: Bundle) => [],
      })

      expect(trigger.key).toBe('new_order')
      expect(trigger.noun).toBe('Order')
      expect(trigger.display.label).toBe('New Order')
      expect(trigger.type).toBe('polling')
    })

    it('should define polling trigger with input fields for filtering', () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'new_contact',
        noun: 'Contact',
        display: { label: 'New Contact', description: 'Triggers on new contacts' },
        perform: async () => [],
        inputFields: [
          { key: 'list_id', label: 'List', type: 'string', dynamic: 'lists.id.name' },
          { key: 'status', label: 'Status', choices: ['active', 'inactive'] },
        ],
      })

      expect(trigger.inputFields).toHaveLength(2)
      expect(trigger.inputFields[0].key).toBe('list_id')
      expect(trigger.inputFields[0].dynamic).toBe('lists.id.name')
      expect(trigger.inputFields[1].choices).toEqual(['active', 'inactive'])
    })

    it('should define polling trigger with output fields', () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'new_order',
        noun: 'Order',
        display: { label: 'New Order', description: 'Triggers on orders' },
        perform: async () => [],
        outputFields: [
          { key: 'id', label: 'Order ID', type: 'string' },
          { key: 'total', label: 'Total Amount', type: 'number' },
          { key: 'created_at', label: 'Created At', type: 'datetime' },
        ],
      })

      expect(trigger.outputFields).toHaveLength(3)
      expect(trigger.outputFields[0].key).toBe('id')
      expect(trigger.outputFields[1].type).toBe('number')
    })

    it('should support canPaginate flag', () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'paginated_items',
        noun: 'Item',
        display: { label: 'Items', description: 'Paginated items' },
        perform: async () => [],
        canPaginate: true,
      })

      expect(trigger.canPaginate).toBe(true)
    })

    it('should default canPaginate to false', () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'simple_items',
        noun: 'Item',
        display: { label: 'Items', description: 'Simple items' },
        perform: async () => [],
      })

      expect(trigger.canPaginate).toBe(false)
    })

    it('should validate required fields on construction', () => {
      const PollingTrigger = (globalThis as any).PollingTrigger

      expect(() => new PollingTrigger({
        noun: 'Order',
        display: { label: 'Order', description: 'Order' },
        perform: async () => [],
      })).toThrow(/key.*required/i)

      expect(() => new PollingTrigger({
        key: 'new_order',
        display: { label: 'Order', description: 'Order' },
        perform: async () => [],
      })).toThrow(/noun.*required/i)

      expect(() => new PollingTrigger({
        key: 'new_order',
        noun: 'Order',
        perform: async () => [],
      })).toThrow(/display.*required/i)

      expect(() => new PollingTrigger({
        key: 'new_order',
        noun: 'Order',
        display: { label: 'Order', description: 'Order' },
      })).toThrow(/perform.*required/i)
    })
  })

  // ============================================================================
  // PERFORM() FUNCTION EXECUTION TESTS
  // ============================================================================

  describe('perform() Function Execution', () => {
    it('should execute perform function and return array of items', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([
          { id: '1', name: 'Order 1' },
          { id: '2', name: 'Order 2' },
        ]), { status: 200 })
      )

      const trigger = new PollingTrigger({
        key: 'new_order',
        noun: 'Order',
        display: { label: 'New Order', description: 'Orders' },
        perform: async (z: ZObject, bundle: Bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/orders',
            method: 'GET',
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      const results = await trigger.perform(z, bundle)

      expect(Array.isArray(results)).toBe(true)
      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('1')
    })

    it('should pass inputData to perform function', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([{ id: '1' }]), { status: 200 })
      )

      let capturedInputData: Record<string, unknown> | undefined

      const trigger = new PollingTrigger({
        key: 'filtered_items',
        noun: 'Item',
        display: { label: 'Items', description: 'Filtered items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          capturedInputData = bundle.inputData
          const response = await z.request({
            url: 'https://api.example.com/items',
            params: { status: bundle.inputData.status as string },
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
      })

      const bundle: Bundle = {
        inputData: { status: 'active', category: 'electronics' },
        authData: {},
      }

      await trigger.perform(z, bundle)

      expect(capturedInputData).toEqual({ status: 'active', category: 'electronics' })
    })

    it('should pass authData to perform function', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 })
      )

      let capturedAuthData: Record<string, unknown> | undefined

      const trigger = new PollingTrigger({
        key: 'authenticated_items',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          capturedAuthData = bundle.authData
          return []
        },
      })

      const bundle: Bundle = {
        inputData: {},
        authData: { access_token: 'token123', api_key: 'key456' },
      }

      await trigger.perform(z, bundle)

      expect(capturedAuthData).toEqual({ access_token: 'token123', api_key: 'key456' })
    })

    it('should handle perform function errors gracefully', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'error_trigger',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => {
          throw new Error('API unavailable')
        },
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      await expect(trigger.perform(z, bundle)).rejects.toThrow('API unavailable')
    })

    it('should return empty array when API returns no items', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 })
      )

      const trigger = new PollingTrigger({
        key: 'empty_items',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject) => {
          const response = await z.request({
            url: 'https://api.example.com/items',
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      const results = await trigger.perform(z, bundle)

      expect(results).toEqual([])
    })
  })

  // ============================================================================
  // DEDUPLICATION VIA ID FIELD TESTS
  // ============================================================================

  describe('Deduplication via id Field', () => {
    it('should deduplicate results by id field', async () => {
      const createPollingTriggerWithDedup = (globalThis as any).createPollingTriggerWithDedup
      expect(createPollingTriggerWithDedup).toBeDefined()

      const trigger = createPollingTriggerWithDedup({
        key: 'dedupe_items',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [
          { id: '1', name: 'Item A' },
          { id: '2', name: 'Item B' },
          { id: '1', name: 'Item A duplicate' },
          { id: '3', name: 'Item C' },
        ],
        dedupeKey: 'id',
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      const results = await trigger.performWithDedup(z, bundle)

      expect(results).toHaveLength(3)
      expect(results.map((r: any) => r.id)).toEqual(['1', '2', '3'])
    })

    it('should use custom deduplication key', async () => {
      const createPollingTriggerWithDedup = (globalThis as any).createPollingTriggerWithDedup

      const trigger = createPollingTriggerWithDedup({
        key: 'custom_dedupe',
        noun: 'Event',
        display: { label: 'Events', description: 'Events' },
        perform: async () => [
          { event_id: 'evt1', type: 'click' },
          { event_id: 'evt2', type: 'view' },
          { event_id: 'evt1', type: 'click' },
        ],
        dedupeKey: 'event_id',
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      const results = await trigger.performWithDedup(z, bundle)

      expect(results).toHaveLength(2)
    })

    it('should track seen IDs across multiple poll cycles', async () => {
      const PollingTriggerRunner = (globalThis as any).PollingTriggerRunner
      expect(PollingTriggerRunner).toBeDefined()

      const performFn = vi.fn()
        .mockResolvedValueOnce([{ id: '1' }, { id: '2' }])
        .mockResolvedValueOnce([{ id: '2' }, { id: '3' }])
        .mockResolvedValueOnce([{ id: '3' }, { id: '4' }])

      const runner = new PollingTriggerRunner({
        key: 'multi_cycle',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: performFn,
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      // First poll - both items are new
      const results1 = await runner.poll(z, bundle)
      expect(results1).toHaveLength(2)
      expect(results1.map((r: any) => r.id)).toEqual(['1', '2'])

      // Second poll - only id:3 is new
      const results2 = await runner.poll(z, bundle)
      expect(results2).toHaveLength(1)
      expect(results2[0].id).toBe('3')

      // Third poll - only id:4 is new
      const results3 = await runner.poll(z, bundle)
      expect(results3).toHaveLength(1)
      expect(results3[0].id).toBe('4')
    })

    it('should handle missing id field gracefully', async () => {
      const createPollingTriggerWithDedup = (globalThis as any).createPollingTriggerWithDedup

      const trigger = createPollingTriggerWithDedup({
        key: 'missing_id',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [
          { id: '1', name: 'Has ID' },
          { name: 'No ID' },
          { id: '2', name: 'Has ID too' },
        ],
        dedupeKey: 'id',
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      // Should not throw, but may log a warning or skip items without ID
      const results = await trigger.performWithDedup(z, bundle)

      // Items without dedupeKey should be included (or excluded based on policy)
      expect(results.length).toBeGreaterThanOrEqual(2)
    })

    it('should clear deduplication state when reset', async () => {
      const PollingTriggerRunner = (globalThis as any).PollingTriggerRunner

      const runner = new PollingTriggerRunner({
        key: 'resettable',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [{ id: '1' }, { id: '2' }],
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      // First poll
      const results1 = await runner.poll(z, bundle)
      expect(results1).toHaveLength(2)

      // Second poll - deduplicated
      const results2 = await runner.poll(z, bundle)
      expect(results2).toHaveLength(0)

      // Reset state
      runner.reset()

      // Third poll - should see items again
      const results3 = await runner.poll(z, bundle)
      expect(results3).toHaveLength(2)
    })

    it('should provide seen IDs count', async () => {
      const PollingTriggerRunner = (globalThis as any).PollingTriggerRunner

      const runner = new PollingTriggerRunner({
        key: 'count_seen',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [{ id: '1' }, { id: '2' }, { id: '3' }],
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      expect(runner.getSeenCount()).toBe(0)

      await runner.poll(z, bundle)

      expect(runner.getSeenCount()).toBe(3)
    })
  })

  // ============================================================================
  // REVERSE CHRONOLOGICAL ORDERING TESTS
  // ============================================================================

  describe('Reverse Chronological Ordering', () => {
    it('should sort results newest first by default date field', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'sorted_items',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [
          { id: '1', created_at: '2024-01-01T10:00:00Z' },
          { id: '2', created_at: '2024-01-03T10:00:00Z' },
          { id: '3', created_at: '2024-01-02T10:00:00Z' },
        ],
        sortField: 'created_at',
        sortOrder: 'desc',
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      const results = await trigger.performSorted(z, bundle)

      expect(results[0].id).toBe('2') // newest
      expect(results[1].id).toBe('3')
      expect(results[2].id).toBe('1') // oldest
    })

    it('should sort by custom date field', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'custom_sort',
        noun: 'Event',
        display: { label: 'Events', description: 'Events' },
        perform: async () => [
          { id: '1', occurred_at: '2024-01-01T10:00:00Z' },
          { id: '2', occurred_at: '2024-01-03T10:00:00Z' },
          { id: '3', occurred_at: '2024-01-02T10:00:00Z' },
        ],
        sortField: 'occurred_at',
        sortOrder: 'desc',
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      const results = await trigger.performSorted(z, bundle)

      expect(results[0].id).toBe('2')
      expect(results[2].id).toBe('1')
    })

    it('should handle numeric timestamps', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'numeric_sort',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [
          { id: '1', timestamp: 1704067200000 }, // 2024-01-01
          { id: '2', timestamp: 1704240000000 }, // 2024-01-03
          { id: '3', timestamp: 1704153600000 }, // 2024-01-02
        ],
        sortField: 'timestamp',
        sortOrder: 'desc',
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      const results = await trigger.performSorted(z, bundle)

      expect(results[0].id).toBe('2')
      expect(results[2].id).toBe('1')
    })

    it('should support ascending order when explicitly specified', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'asc_sort',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [
          { id: '1', created_at: '2024-01-01T10:00:00Z' },
          { id: '2', created_at: '2024-01-03T10:00:00Z' },
          { id: '3', created_at: '2024-01-02T10:00:00Z' },
        ],
        sortField: 'created_at',
        sortOrder: 'asc',
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      const results = await trigger.performSorted(z, bundle)

      expect(results[0].id).toBe('1') // oldest first
      expect(results[2].id).toBe('2') // newest last
    })

    it('should maintain order when sort field is missing from some items', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'partial_sort',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [
          { id: '1', created_at: '2024-01-01T10:00:00Z' },
          { id: '2' }, // no created_at
          { id: '3', created_at: '2024-01-02T10:00:00Z' },
        ],
        sortField: 'created_at',
        sortOrder: 'desc',
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      const results = await trigger.performSorted(z, bundle)

      // Items without sort field should be placed at the end
      expect(results).toHaveLength(3)
      expect(results[results.length - 1].id).toBe('2')
    })
  })

  // ============================================================================
  // BUNDLE CONTEXT TESTS
  // ============================================================================

  describe('Bundle Context (authData, inputData)', () => {
    it('should provide full bundle context to perform function', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      let capturedBundle: Bundle | undefined

      const trigger = new PollingTrigger({
        key: 'context_test',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          capturedBundle = bundle
          return []
        },
      })

      const bundle: Bundle = {
        inputData: { filter: 'active' },
        authData: { access_token: 'token123' },
        meta: {
          isLoadingSample: false,
          isFillingDynamicDropdown: false,
          limit: 100,
          page: 1,
        },
      }

      await trigger.perform(z, bundle)

      expect(capturedBundle).toBeDefined()
      expect(capturedBundle!.inputData).toEqual({ filter: 'active' })
      expect(capturedBundle!.authData).toEqual({ access_token: 'token123' })
      expect(capturedBundle!.meta?.limit).toBe(100)
    })

    it('should use authData for authenticated API requests', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([{ id: '1' }]), { status: 200 })
      )

      const trigger = new PollingTrigger({
        key: 'auth_context',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/items',
            headers: {
              Authorization: `Bearer ${bundle.authData.access_token}`,
            },
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
      })

      const bundle: Bundle = {
        inputData: {},
        authData: { access_token: 'my-secret-token' },
      }

      await trigger.perform(z, bundle)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-secret-token',
          }),
        })
      )
    })

    it('should use inputData to filter API requests', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 })
      )

      const trigger = new PollingTrigger({
        key: 'filter_context',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/items',
            params: {
              status: bundle.inputData.status as string,
              category: bundle.inputData.category as string,
            },
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
      })

      const bundle: Bundle = {
        inputData: { status: 'pending', category: 'electronics' },
        authData: {},
      }

      await trigger.perform(z, bundle)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=pending'),
        expect.anything()
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('category=electronics'),
        expect.anything()
      )
    })

    it('should handle meta.isLoadingSample flag', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      let receivedMeta: Bundle['meta'] | undefined

      const trigger = new PollingTrigger({
        key: 'sample_flag',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          receivedMeta = bundle.meta
          // When loading sample, might return limited/different data
          if (bundle.meta?.isLoadingSample) {
            return [{ id: 'sample', name: 'Sample Item' }]
          }
          return []
        },
      })

      const bundle: Bundle = {
        inputData: {},
        authData: {},
        meta: { isLoadingSample: true },
      }

      const results = await trigger.perform(z, bundle)

      expect(receivedMeta?.isLoadingSample).toBe(true)
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('sample')
    })

    it('should respect meta.limit when provided', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger

      const trigger = new PollingTrigger({
        key: 'limit_context',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          const items = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }))
          const limit = bundle.meta?.limit || 100
          return items.slice(0, limit)
        },
      })

      const bundle: Bundle = {
        inputData: {},
        authData: {},
        meta: { limit: 10 },
      }

      const results = await trigger.perform(z, bundle)

      expect(results).toHaveLength(10)
    })
  })

  // ============================================================================
  // PAGINATION HANDLING TESTS
  // ============================================================================

  describe('Pagination Handling', () => {
    it('should support cursor-based pagination via z.cursor', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      let cursorValue: string | undefined

      // Mock cursor storage
      const cursorStore: { value?: string } = {}
      z.cursor = {
        get: vi.fn(async () => cursorStore.value),
        set: vi.fn(async (value: string) => { cursorStore.value = value }),
      }

      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            items: [{ id: '1' }, { id: '2' }],
            next_cursor: 'cursor_page_2',
          }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            items: [{ id: '3' }, { id: '4' }],
            next_cursor: null,
          }), { status: 200 })
        )

      const trigger = new PollingTrigger({
        key: 'cursor_pagination',
        noun: 'Item',
        display: { label: 'Items', description: 'Paginated items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          const cursor = await z.cursor.get()
          const response = await z.request({
            url: 'https://api.example.com/items',
            params: cursor ? { cursor } : {},
            skipThrowForStatus: true,
          })
          const data = response.data as { items: unknown[], next_cursor: string | null }
          if (data.next_cursor) {
            await z.cursor.set(data.next_cursor)
          }
          return data.items
        },
        canPaginate: true,
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      // First page
      const results1 = await trigger.perform(z, bundle)
      expect(results1).toHaveLength(2)
      expect(z.cursor.set).toHaveBeenCalledWith('cursor_page_2')

      // Second page
      const results2 = await trigger.perform(z, bundle)
      expect(results2).toHaveLength(2)
    })

    it('should support page-based pagination via bundle.meta.page', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      mockFetch.mockImplementation(async (url: string) => {
        const pageMatch = url.match(/page=(\d+)/)
        const page = pageMatch ? parseInt(pageMatch[1]) : 1
        const items = [
          { id: String(page * 2 - 1) },
          { id: String(page * 2) },
        ]
        return new Response(JSON.stringify(items), { status: 200 })
      })

      const trigger = new PollingTrigger({
        key: 'page_pagination',
        noun: 'Item',
        display: { label: 'Items', description: 'Paginated items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          const page = bundle.meta?.page || 1
          const response = await z.request({
            url: 'https://api.example.com/items',
            params: { page: String(page), per_page: '2' },
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
        canPaginate: true,
      })

      // Page 1
      const results1 = await trigger.perform(z, {
        inputData: {},
        authData: {},
        meta: { page: 1 },
      })
      expect(results1).toEqual([{ id: '1' }, { id: '2' }])

      // Page 2
      const results2 = await trigger.perform(z, {
        inputData: {},
        authData: {},
        meta: { page: 2 },
      })
      expect(results2).toEqual([{ id: '3' }, { id: '4' }])
    })

    it('should aggregate results across all pages', async () => {
      const PollingTriggerRunner = (globalThis as any).PollingTriggerRunner

      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            items: [{ id: '1' }, { id: '2' }],
            has_more: true,
          }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            items: [{ id: '3' }, { id: '4' }],
            has_more: true,
          }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            items: [{ id: '5' }],
            has_more: false,
          }), { status: 200 })
        )

      const runner = new PollingTriggerRunner({
        key: 'aggregate_pages',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          const page = bundle.meta?.page || 1
          const response = await z.request({
            url: `https://api.example.com/items?page=${page}`,
            skipThrowForStatus: true,
          })
          return response.data as { items: unknown[], has_more: boolean }
        },
        canPaginate: true,
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      const allResults = await runner.pollAllPages(z, bundle, { maxPages: 10 })

      expect(allResults).toHaveLength(5)
    })

    it('should respect maxPages limit during pagination', async () => {
      const PollingTriggerRunner = (globalThis as any).PollingTriggerRunner

      // Infinite pages
      mockFetch.mockImplementation(async () =>
        new Response(JSON.stringify({
          items: [{ id: '1' }],
          has_more: true,
        }), { status: 200 })
      )

      const runner = new PollingTriggerRunner({
        key: 'max_pages',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject) => {
          const response = await z.request({
            url: 'https://api.example.com/items',
            skipThrowForStatus: true,
          })
          return response.data as { items: unknown[], has_more: boolean }
        },
        canPaginate: true,
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      const results = await runner.pollAllPages(z, bundle, { maxPages: 3 })

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(results).toHaveLength(3)
    })

    it('should handle pagination errors gracefully', async () => {
      const PollingTriggerRunner = (globalThis as any).PollingTriggerRunner

      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            items: [{ id: '1' }],
            has_more: true,
          }), { status: 200 })
        )
        .mockRejectedValueOnce(new Error('Network error'))

      const runner = new PollingTriggerRunner({
        key: 'pagination_error',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          const response = await z.request({
            url: `https://api.example.com/items?page=${bundle.meta?.page || 1}`,
            skipThrowForStatus: true,
          })
          return response.data as { items: unknown[], has_more: boolean }
        },
        canPaginate: true,
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      // Should return partial results or throw depending on policy
      await expect(runner.pollAllPages(z, bundle)).rejects.toThrow('Network error')
    })
  })

  // ============================================================================
  // SAMPLE DATA RETRIEVAL TESTS
  // ============================================================================

  describe('Sample Data Retrieval', () => {
    it('should return sample data when defined', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'with_sample',
        noun: 'Order',
        display: { label: 'Orders', description: 'Orders' },
        perform: async () => [],
        sample: {
          id: 'sample-123',
          customer_name: 'John Doe',
          total: 99.99,
          created_at: '2024-01-01T00:00:00Z',
        },
      })

      const sample = trigger.getSample()

      expect(sample).toBeDefined()
      expect(sample.id).toBe('sample-123')
      expect(sample.customer_name).toBe('John Doe')
      expect(sample.total).toBe(99.99)
    })

    it('should return undefined when no sample defined', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'no_sample',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [],
      })

      const sample = trigger.getSample()

      expect(sample).toBeUndefined()
    })

    it('should use performSample when isLoadingSample is true', async () => {
      const PollingTriggerSampleLoader = (globalThis as any).PollingTriggerSampleLoader
      expect(PollingTriggerSampleLoader).toBeDefined()

      const loader = new PollingTriggerSampleLoader({
        key: 'sample_loader',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [{ id: 'live-1' }, { id: 'live-2' }],
        sample: { id: 'static-sample' },
      })

      const bundle: Bundle = {
        inputData: {},
        authData: {},
        meta: { isLoadingSample: true },
      }

      const results = await loader.getSampleData(z, bundle)

      // Should return static sample when isLoadingSample is true
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('static-sample')
    })

    it('should fetch live sample when no static sample and isLoadingSample', async () => {
      const PollingTriggerSampleLoader = (globalThis as any).PollingTriggerSampleLoader
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([{ id: 'live-1' }]), { status: 200 })
      )

      const loader = new PollingTriggerSampleLoader({
        key: 'live_sample',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject) => {
          const response = await z.request({
            url: 'https://api.example.com/items',
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
        // No static sample defined
      })

      const bundle: Bundle = {
        inputData: {},
        authData: {},
        meta: { isLoadingSample: true, limit: 1 },
      }

      const results = await loader.getSampleData(z, bundle)

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('live-1')
    })

    it('should limit sample results to reasonable count', async () => {
      const PollingTriggerSampleLoader = (globalThis as any).PollingTriggerSampleLoader
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(
          Array.from({ length: 100 }, (_, i) => ({ id: String(i) }))
        ), { status: 200 })
      )

      const loader = new PollingTriggerSampleLoader({
        key: 'limited_sample',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject) => {
          const response = await z.request({
            url: 'https://api.example.com/items',
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
      })

      const bundle: Bundle = {
        inputData: {},
        authData: {},
        meta: { isLoadingSample: true },
      }

      const results = await loader.getSampleData(z, bundle)

      // Should limit to reasonable count (e.g., 3-5 items for samples)
      expect(results.length).toBeLessThanOrEqual(5)
    })

    it('should validate sample data matches output fields', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'validated_sample',
        noun: 'Order',
        display: { label: 'Orders', description: 'Orders' },
        perform: async () => [],
        outputFields: [
          { key: 'id', label: 'ID', type: 'string' },
          { key: 'total', label: 'Total', type: 'number' },
        ],
        sample: {
          id: 'sample-123',
          total: 99.99,
        },
      })

      const validation = trigger.validateSample()

      expect(validation.valid).toBe(true)
      expect(validation.errors).toHaveLength(0)
    })

    it('should report missing fields in sample data', async () => {
      const PollingTrigger = (globalThis as any).PollingTrigger
      const trigger = new PollingTrigger({
        key: 'incomplete_sample',
        noun: 'Order',
        display: { label: 'Orders', description: 'Orders' },
        perform: async () => [],
        outputFields: [
          { key: 'id', label: 'ID', type: 'string' },
          { key: 'total', label: 'Total', type: 'number' },
          { key: 'status', label: 'Status', type: 'string' },
        ],
        sample: {
          id: 'sample-123',
          // missing: total, status
        },
      })

      const validation = trigger.validateSample()

      expect(validation.valid).toBe(false)
      expect(validation.missingFields).toContain('total')
      expect(validation.missingFields).toContain('status')
    })
  })

  // ============================================================================
  // POLLING INTERVAL TESTS
  // ============================================================================

  describe('Polling Interval', () => {
    it('should support configurable polling interval in milliseconds', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler
      expect(PollingTriggerScheduler).toBeDefined()

      const scheduler = new PollingTriggerScheduler({
        key: 'interval_trigger',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [{ id: '1' }],
        pollingInterval: 60000, // 1 minute
      })

      expect(scheduler.getPollingInterval()).toBe(60000)
    })

    it('should default to 5 minutes (300000ms) polling interval', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      const scheduler = new PollingTriggerScheduler({
        key: 'default_interval',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [],
        // No pollingInterval specified
      })

      expect(scheduler.getPollingInterval()).toBe(300000) // 5 minutes default
    })

    it('should enforce minimum polling interval of 1 minute', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      // Attempting to set interval below 1 minute should be clamped
      const scheduler = new PollingTriggerScheduler({
        key: 'fast_polling',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [],
        pollingInterval: 10000, // 10 seconds - too fast
      })

      // Should be clamped to minimum of 60000ms (1 minute)
      expect(scheduler.getPollingInterval()).toBeGreaterThanOrEqual(60000)
    })

    it('should poll at configured interval using scheduler', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      const pollFn = vi.fn().mockResolvedValue([{ id: '1' }])

      const scheduler = new PollingTriggerScheduler({
        key: 'scheduled_trigger',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: pollFn,
        pollingInterval: 60000, // 1 minute
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      // Start scheduled polling
      scheduler.start(z, bundle)

      // Initial poll should happen immediately
      expect(pollFn).toHaveBeenCalledTimes(1)

      // Advance time by 30 seconds - should NOT poll again yet
      vi.advanceTimersByTime(30000)
      expect(pollFn).toHaveBeenCalledTimes(1)

      // Advance time to 1 minute total - should poll again
      vi.advanceTimersByTime(30000)
      expect(pollFn).toHaveBeenCalledTimes(2)

      // Advance another minute - should poll again
      vi.advanceTimersByTime(60000)
      expect(pollFn).toHaveBeenCalledTimes(3)

      // Stop the scheduler
      scheduler.stop()
    })

    it('should stop polling when scheduler is stopped', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      const pollFn = vi.fn().mockResolvedValue([])

      const scheduler = new PollingTriggerScheduler({
        key: 'stoppable_trigger',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: pollFn,
        pollingInterval: 60000,
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      scheduler.start(z, bundle)
      expect(pollFn).toHaveBeenCalledTimes(1)

      // Stop before next interval
      scheduler.stop()

      // Advance time past the interval
      vi.advanceTimersByTime(120000)

      // Should still only have 1 call (initial)
      expect(pollFn).toHaveBeenCalledTimes(1)
    })

    it('should report if scheduler is running', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      const scheduler = new PollingTriggerScheduler({
        key: 'status_trigger',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [],
        pollingInterval: 60000,
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      expect(scheduler.isRunning()).toBe(false)

      scheduler.start(z, bundle)
      expect(scheduler.isRunning()).toBe(true)

      scheduler.stop()
      expect(scheduler.isRunning()).toBe(false)
    })

    it('should track last poll timestamp', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      const scheduler = new PollingTriggerScheduler({
        key: 'timestamp_trigger',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [],
        pollingInterval: 60000,
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      expect(scheduler.getLastPollTime()).toBeNull()

      scheduler.start(z, bundle)

      expect(scheduler.getLastPollTime()).toEqual(new Date('2024-01-15T10:00:00Z'))

      // Advance time and poll again
      vi.advanceTimersByTime(60000)

      expect(scheduler.getLastPollTime()).toEqual(new Date('2024-01-15T10:01:00Z'))

      scheduler.stop()
    })

    it('should calculate next poll time based on interval', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      const scheduler = new PollingTriggerScheduler({
        key: 'next_poll_trigger',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [],
        pollingInterval: 300000, // 5 minutes
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      scheduler.start(z, bundle)

      // Next poll should be in 5 minutes
      expect(scheduler.getNextPollTime()).toEqual(new Date('2024-01-15T10:05:00Z'))

      scheduler.stop()
    })

    it('should support dynamic polling interval based on results', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      let pollCount = 0
      const pollFn = vi.fn().mockImplementation(async () => {
        pollCount++
        // Return items on first poll, empty on subsequent
        return pollCount === 1 ? [{ id: '1' }] : []
      })

      const scheduler = new PollingTriggerScheduler({
        key: 'dynamic_interval',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: pollFn,
        pollingInterval: 60000,
        // Backoff when no new items
        adaptiveInterval: {
          enabled: true,
          minInterval: 60000,
          maxInterval: 900000, // 15 minutes
          backoffMultiplier: 2,
        },
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      scheduler.start(z, bundle)

      // First poll returns items - interval stays at 60s
      expect(scheduler.getCurrentInterval()).toBe(60000)

      // Advance time and poll again (returns empty)
      vi.advanceTimersByTime(60000)

      // After empty result, interval should increase (backoff)
      expect(scheduler.getCurrentInterval()).toBe(120000) // 2x backoff

      scheduler.stop()
    })

    it('should reset adaptive interval when new items found', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      let pollCount = 0
      const pollFn = vi.fn().mockImplementation(async () => {
        pollCount++
        // Empty on polls 1-3, items on poll 4
        return pollCount >= 4 ? [{ id: '1' }] : []
      })

      const scheduler = new PollingTriggerScheduler({
        key: 'reset_interval',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: pollFn,
        pollingInterval: 60000,
        adaptiveInterval: {
          enabled: true,
          minInterval: 60000,
          maxInterval: 900000,
          backoffMultiplier: 2,
        },
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      scheduler.start(z, bundle)

      // Simulate several empty polls
      vi.advanceTimersByTime(60000)  // Poll 2 - empty
      vi.advanceTimersByTime(120000) // Poll 3 - empty (after backoff)
      vi.advanceTimersByTime(240000) // Poll 4 - has items

      // After finding items, interval should reset to base
      expect(scheduler.getCurrentInterval()).toBe(60000)

      scheduler.stop()
    })

    it('should emit events on poll completion', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      const onPoll = vi.fn()

      const scheduler = new PollingTriggerScheduler({
        key: 'event_trigger',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async () => [{ id: '1' }, { id: '2' }],
        pollingInterval: 60000,
      })

      scheduler.on('poll', onPoll)

      const bundle: Bundle = { inputData: {}, authData: {} }
      scheduler.start(z, bundle)

      expect(onPoll).toHaveBeenCalledWith({
        items: [{ id: '1' }, { id: '2' }],
        newItems: 2,
        timestamp: expect.any(Date),
      })

      scheduler.stop()
    })

    it('should handle poll errors without stopping scheduler', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      let pollCount = 0
      const pollFn = vi.fn().mockImplementation(async () => {
        pollCount++
        if (pollCount === 2) {
          throw new Error('Temporary API error')
        }
        return [{ id: String(pollCount) }]
      })

      const onError = vi.fn()

      const scheduler = new PollingTriggerScheduler({
        key: 'error_resilient',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: pollFn,
        pollingInterval: 60000,
      })

      scheduler.on('error', onError)

      const bundle: Bundle = { inputData: {}, authData: {} }
      scheduler.start(z, bundle)

      expect(pollFn).toHaveBeenCalledTimes(1)
      expect(scheduler.isRunning()).toBe(true)

      // Advance to second poll (which errors)
      vi.advanceTimersByTime(60000)

      expect(pollFn).toHaveBeenCalledTimes(2)
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
      expect(scheduler.isRunning()).toBe(true) // Still running

      // Third poll should succeed
      vi.advanceTimersByTime(60000)
      expect(pollFn).toHaveBeenCalledTimes(3)

      scheduler.stop()
    })

    it('should track poll statistics', async () => {
      const PollingTriggerScheduler = (globalThis as any).PollingTriggerScheduler

      let pollCount = 0
      const scheduler = new PollingTriggerScheduler({
        key: 'stats_trigger',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: vi.fn().mockImplementation(async () => {
          pollCount++
          return pollCount <= 2 ? [{ id: String(pollCount) }] : []
        }),
        pollingInterval: 60000,
      })

      const bundle: Bundle = { inputData: {}, authData: {} }
      scheduler.start(z, bundle)

      vi.advanceTimersByTime(60000) // Poll 2
      vi.advanceTimersByTime(60000) // Poll 3

      const stats = scheduler.getStats()

      expect(stats.totalPolls).toBe(3)
      expect(stats.totalItems).toBe(2)
      expect(stats.emptyPolls).toBe(1)

      scheduler.stop()
    })
  })

  // ============================================================================
  // CURSOR/OFFSET TRACKING TESTS
  // ============================================================================

  describe('Cursor/Offset Tracking', () => {
    it('should persist cursor between poll cycles', async () => {
      const PollingTriggerRunner = (globalThis as any).PollingTriggerRunner
      expect(PollingTriggerRunner).toBeDefined()

      const cursorStore: { value?: string } = {}
      z.cursor = {
        get: vi.fn(async () => cursorStore.value),
        set: vi.fn(async (value: string) => { cursorStore.value = value }),
      }

      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            items: [{ id: '1' }, { id: '2' }],
            cursor: 'next_cursor_abc',
          }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            items: [{ id: '3' }],
            cursor: 'next_cursor_def',
          }), { status: 200 })
        )

      const runner = new PollingTriggerRunner({
        key: 'cursor_persist',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          const cursor = await z.cursor.get()
          const response = await z.request({
            url: 'https://api.example.com/items',
            params: cursor ? { after: cursor } : {},
            skipThrowForStatus: true,
          })
          const data = response.data as { items: unknown[], cursor: string }
          await z.cursor.set(data.cursor)
          return data.items
        },
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      // First poll
      await runner.poll(z, bundle)
      expect(z.cursor.set).toHaveBeenCalledWith('next_cursor_abc')
      expect(cursorStore.value).toBe('next_cursor_abc')

      // Second poll should use stored cursor
      await runner.poll(z, bundle)
      expect(z.cursor.get).toHaveBeenCalled()
      expect(z.cursor.set).toHaveBeenCalledWith('next_cursor_def')
    })

    it('should support offset-based pagination tracking', async () => {
      const PollingTriggerWithOffset = (globalThis as any).PollingTriggerWithOffset
      expect(PollingTriggerWithOffset).toBeDefined()

      mockFetch.mockImplementation(async (url: string) => {
        const offsetMatch = url.match(/offset=(\d+)/)
        const offset = offsetMatch ? parseInt(offsetMatch[1]) : 0
        const items = [
          { id: String(offset + 1) },
          { id: String(offset + 2) },
        ]
        return new Response(JSON.stringify({
          items,
          total: 10,
          offset,
          limit: 2,
        }), { status: 200 })
      })

      const trigger = new PollingTriggerWithOffset({
        key: 'offset_tracking',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject, bundle: Bundle) => {
          const offset = bundle.meta?.offset || 0
          const response = await z.request({
            url: `https://api.example.com/items?offset=${offset}&limit=2`,
            skipThrowForStatus: true,
          })
          return response.data as { items: unknown[], total: number, offset: number, limit: number }
        },
      })

      const bundle: Bundle = { inputData: {}, authData: {}, meta: { offset: 0 } }

      // First request
      const result1 = await trigger.perform(z, bundle)
      expect(result1.items).toEqual([{ id: '1' }, { id: '2' }])
      expect(result1.offset).toBe(0)

      // Next offset should be calculated
      const nextOffset = trigger.getNextOffset(result1)
      expect(nextOffset).toBe(2)
    })

    it('should track high-water mark for timestamp-based polling', async () => {
      const PollingTriggerRunner = (globalThis as any).PollingTriggerRunner

      const highWaterMark = { timestamp: null as string | null }

      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify([
            { id: '1', created_at: '2024-01-01T10:00:00Z' },
            { id: '2', created_at: '2024-01-01T11:00:00Z' },
          ]), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([
            { id: '3', created_at: '2024-01-01T12:00:00Z' },
          ]), { status: 200 })
        )

      const runner = new PollingTriggerRunner({
        key: 'high_water_mark',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject) => {
          const since = highWaterMark.timestamp
          const response = await z.request({
            url: 'https://api.example.com/items',
            params: since ? { since } : {},
            skipThrowForStatus: true,
          })
          const items = response.data as Array<{ id: string, created_at: string }>
          // Update high water mark to newest item
          if (items.length > 0) {
            highWaterMark.timestamp = items.reduce(
              (max, item) => item.created_at > max ? item.created_at : max,
              items[0].created_at
            )
          }
          return items
        },
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      // First poll
      await runner.poll(z, bundle)
      expect(highWaterMark.timestamp).toBe('2024-01-01T11:00:00Z')

      // Second poll should use high water mark
      await runner.poll(z, bundle)
      expect(highWaterMark.timestamp).toBe('2024-01-01T12:00:00Z')
    })

    it('should support resumable cursor with checkpoint', async () => {
      const PollingTriggerCheckpoint = (globalThis as any).PollingTriggerCheckpoint
      expect(PollingTriggerCheckpoint).toBeDefined()

      const checkpoint = new PollingTriggerCheckpoint()

      // Save checkpoint
      await checkpoint.save({
        cursor: 'cursor_123',
        offset: 50,
        timestamp: '2024-01-15T10:00:00Z',
        seenIds: ['id1', 'id2', 'id3'],
      })

      // Restore checkpoint
      const restored = await checkpoint.restore()

      expect(restored.cursor).toBe('cursor_123')
      expect(restored.offset).toBe(50)
      expect(restored.timestamp).toBe('2024-01-15T10:00:00Z')
      expect(restored.seenIds).toEqual(['id1', 'id2', 'id3'])
    })

    it('should clear cursor/offset on reset', async () => {
      const PollingTriggerCheckpoint = (globalThis as any).PollingTriggerCheckpoint

      const checkpoint = new PollingTriggerCheckpoint()

      await checkpoint.save({
        cursor: 'cursor_abc',
        offset: 100,
      })

      await checkpoint.clear()

      const restored = await checkpoint.restore()
      expect(restored).toBeNull()
    })

    it('should handle cursor expiration gracefully', async () => {
      const PollingTriggerRunner = (globalThis as any).PollingTriggerRunner

      const cursorStore: { value?: string } = { value: 'expired_cursor' }
      z.cursor = {
        get: vi.fn(async () => cursorStore.value),
        set: vi.fn(async (value: string) => { cursorStore.value = value }),
      }

      mockFetch
        .mockRejectedValueOnce(new Error('Cursor expired or invalid'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            items: [{ id: '1' }],
            cursor: 'new_cursor',
          }), { status: 200 })
        )

      const runner = new PollingTriggerRunner({
        key: 'cursor_expiry',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: async (z: ZObject) => {
          const cursor = await z.cursor.get()
          try {
            const response = await z.request({
              url: 'https://api.example.com/items',
              params: cursor ? { cursor } : {},
              skipThrowForStatus: true,
            })
            const data = response.data as { items: unknown[], cursor: string }
            await z.cursor.set(data.cursor)
            return data.items
          } catch (error: any) {
            if (error.message.includes('expired')) {
              // Clear cursor and retry from beginning
              await z.cursor.set('')
              throw error
            }
            throw error
          }
        },
        retryOnCursorExpiry: true,
      })

      const bundle: Bundle = { inputData: {}, authData: {} }

      // First poll with expired cursor should fail then retry
      const results = await runner.pollWithRetry(z, bundle)

      // Should have cleared the expired cursor and fetched fresh
      expect(results).toHaveLength(1)
      expect(cursorStore.value).toBe('new_cursor')
    })

    it('should support multiple cursor types (page, offset, timestamp)', async () => {
      const CursorManager = (globalThis as any).CursorManager
      expect(CursorManager).toBeDefined()

      const manager = new CursorManager({
        type: 'composite',
        fields: {
          page: { type: 'number', initial: 1 },
          offset: { type: 'number', initial: 0 },
          since: { type: 'timestamp', initial: null },
        },
      })

      // Update multiple cursor fields
      manager.update({
        page: 2,
        offset: 50,
        since: '2024-01-15T10:00:00Z',
      })

      expect(manager.get('page')).toBe(2)
      expect(manager.get('offset')).toBe(50)
      expect(manager.get('since')).toBe('2024-01-15T10:00:00Z')

      // Serialize for storage
      const serialized = manager.serialize()
      expect(serialized).toBe(JSON.stringify({
        page: 2,
        offset: 50,
        since: '2024-01-15T10:00:00Z',
      }))

      // Deserialize from storage
      const restored = CursorManager.deserialize(serialized, {
        type: 'composite',
        fields: {
          page: { type: 'number', initial: 1 },
          offset: { type: 'number', initial: 0 },
          since: { type: 'timestamp', initial: null },
        },
      })

      expect(restored.get('page')).toBe(2)
    })

    it('should track cursor history for debugging', async () => {
      const PollingTriggerRunner = (globalThis as any).PollingTriggerRunner

      const runner = new PollingTriggerRunner({
        key: 'cursor_history',
        noun: 'Item',
        display: { label: 'Items', description: 'Items' },
        perform: vi.fn().mockResolvedValue([]),
        trackCursorHistory: true,
      })

      // Simulate cursor updates
      runner.updateCursor('cursor_1')
      runner.updateCursor('cursor_2')
      runner.updateCursor('cursor_3')

      const history = runner.getCursorHistory()

      expect(history).toHaveLength(3)
      expect(history[0]).toBe('cursor_1')
      expect(history[2]).toBe('cursor_3')
    })
  })

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration', () => {
    it('should work end-to-end with real-world polling scenario', async () => {
      const PollingTriggerRunner = (globalThis as any).PollingTriggerRunner

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([
          { id: '3', name: 'New Order', created_at: '2024-01-03T10:00:00Z' },
          { id: '2', name: 'Older Order', created_at: '2024-01-02T10:00:00Z' },
          { id: '1', name: 'Oldest Order', created_at: '2024-01-01T10:00:00Z' },
        ]), { status: 200 })
      )

      const runner = new PollingTriggerRunner({
        key: 'new_order',
        noun: 'Order',
        display: {
          label: 'New Order',
          description: 'Triggers when a new order is placed'
        },
        perform: async (z: ZObject, bundle: Bundle) => {
          const response = await z.request({
            url: 'https://api.shop.com/orders',
            headers: {
              Authorization: `Bearer ${bundle.authData.access_token}`,
            },
            params: {
              status: bundle.inputData.status as string || 'all',
            },
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
        inputFields: [
          { key: 'status', label: 'Order Status', choices: ['all', 'pending', 'completed'] },
        ],
        outputFields: [
          { key: 'id', label: 'Order ID' },
          { key: 'name', label: 'Order Name' },
          { key: 'created_at', label: 'Created At', type: 'datetime' },
        ],
        sample: {
          id: 'sample-order',
          name: 'Sample Order',
          created_at: '2024-01-01T00:00:00Z',
        },
        sortField: 'created_at',
        sortOrder: 'desc',
      })

      const bundle: Bundle = {
        inputData: { status: 'pending' },
        authData: { access_token: 'shop-token-123' },
      }

      // First poll
      const results1 = await runner.poll(z, bundle)
      expect(results1).toHaveLength(3)
      expect(results1[0].id).toBe('3') // Newest first

      // Second poll - should be deduplicated
      const results2 = await runner.poll(z, bundle)
      expect(results2).toHaveLength(0)

      // Verify sample
      const sample = runner.getSample()
      expect(sample).toBeDefined()
      expect(sample.id).toBe('sample-order')
    })
  })
})
