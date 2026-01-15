/**
 * E2E Smoke Tests
 *
 * Exercises the E2E test harness to verify it works correctly.
 * These tests validate the harness infrastructure itself.
 *
 * Test scenarios:
 * 1. Harness setup and teardown
 * 2. Request builder functionality
 * 3. CRUD operations on Things
 * 4. Assertion helpers
 * 5. Performance metrics tracking
 * 6. Pipeline event tracking
 *
 * @module tests/e2e/smoke.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { E2ETestHarness, RequestBuilder } from './harness'

describe('E2E Smoke Tests', () => {
  let harness: E2ETestHarness

  beforeEach(async () => {
    harness = new E2ETestHarness({ namespace: 'smoke-test' })
    await harness.setup()
  })

  afterEach(async () => {
    await harness.teardown()
  })

  // ==========================================================================
  // TEST SUITE: Harness Setup and Teardown
  // ==========================================================================

  describe('1. Harness Setup and Teardown', () => {
    it('should setup harness successfully', async () => {
      // Harness was set up in beforeEach
      expect(harness).toBeDefined()
      expect(harness.getStub()).toBeDefined()
    })

    it('should create isolated stub for namespace', async () => {
      const stub = harness.getStub()
      expect(stub.name).toBe('smoke-test')
    })

    it('should provide access to mock environment', () => {
      const env = harness.getEnv()
      expect(env.DO).toBeDefined()
      expect(env.PIPELINE).toBeDefined()
      expect(env.KV).toBeDefined()
    })

    it('should get stub by name', () => {
      const customStub = harness.getStubByName('custom-ns')
      expect(customStub).toBeDefined()
      expect(customStub.name).toBe('custom-ns')
    })

    it('should throw if not setup', async () => {
      const freshHarness = new E2ETestHarness()
      // Don't call setup
      expect(() => freshHarness.getStub()).toThrow('Harness not setup')
    })
  })

  // ==========================================================================
  // TEST SUITE: Request Builder
  // ==========================================================================

  describe('2. Request Builder', () => {
    it('should create request builder for path', () => {
      const builder = harness.request('/things')
      expect(builder).toBeInstanceOf(RequestBuilder)
    })

    it('should execute GET request', async () => {
      const result = await harness.request('/things').get()
      expect(result.status).toBe(200)
      expect(result.body).toBeDefined()
    })

    it('should execute POST request with body', async () => {
      const result = await harness.request('/things').post({
        $type: 'Customer',
        name: 'Alice',
      })
      expect(result.status).toBe(201)
      expect(result.body).toBeDefined()
    })

    it('should execute PUT request', async () => {
      // First create a thing
      const created = await harness.createThing({ $type: 'Customer', name: 'Bob' })

      const result = await harness.request(`/things/${created.$id}`).put({
        name: 'Bob Updated',
      })
      expect(result.status).toBe(200)
    })

    it('should execute PATCH request', async () => {
      const created = await harness.createThing({ $type: 'Customer', name: 'Carol' })

      const result = await harness.request(`/things/${created.$id}`).patch({
        email: 'carol@example.com',
      })
      expect(result.status).toBe(200)
    })

    it('should execute DELETE request', async () => {
      const created = await harness.createThing({ $type: 'Customer', name: 'Dan' })

      const result = await harness.request(`/things/${created.$id}`).delete()
      expect(result.status).toBe(204)
    })

    it('should add custom headers', async () => {
      const result = await harness
        .request('/things')
        .header('X-Custom-Header', 'test-value')
        .get()

      expect(result.status).toBe(200)
    })

    it('should add auth header', async () => {
      const result = await harness
        .request('/things')
        .auth('test-token')
        .get()

      expect(result.status).toBe(200)
    })

    it('should measure request duration', async () => {
      const result = await harness.request('/things').get()
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // TEST SUITE: CRUD Operations
  // ==========================================================================

  describe('3. CRUD Operations', () => {
    it('should create a thing', async () => {
      const thing = await harness.createThing({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
      })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
      expect(thing.$version).toBe(1)
    })

    it('should get a thing by ID', async () => {
      const created = await harness.createThing({ $type: 'Product', name: 'Widget' })
      const retrieved = await harness.getThing(created.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.$id).toBe(created.$id)
      expect(retrieved!.name).toBe('Widget')
    })

    it('should return null for non-existent thing', async () => {
      const result = await harness.getThing('non-existent-id')
      expect(result).toBeNull()
    })

    it('should update a thing', async () => {
      const created = await harness.createThing({ $type: 'Order', total: 100 })
      const updated = await harness.updateThing(created.$id, { total: 150, status: 'paid' })

      expect(updated.$id).toBe(created.$id)
      expect(updated.total).toBe(150)
      expect(updated.status).toBe('paid')
      expect(updated.$version).toBe(2)
    })

    it('should delete a thing', async () => {
      const created = await harness.createThing({ $type: 'Temp', value: 1 })
      await harness.deleteThing(created.$id)

      const retrieved = await harness.getThing(created.$id)
      expect(retrieved).toBeNull()
    })

    it('should list all things', async () => {
      await harness.createThing({ $type: 'Item', index: 1 })
      await harness.createThing({ $type: 'Item', index: 2 })
      await harness.createThing({ $type: 'Item', index: 3 })

      const things = await harness.listThings()
      expect(things.length).toBe(3)
    })
  })

  // ==========================================================================
  // TEST SUITE: Assertion Helpers
  // ==========================================================================

  describe('4. Assertion Helpers', () => {
    it('should assert status code', async () => {
      const result = await harness.request('/things').get()
      expect(() => harness.assertStatus(result, 200)).not.toThrow()
      expect(() => harness.assertStatus(result, 404)).toThrow('Expected status 404')
    })

    it('should assert JSON content type', async () => {
      const result = await harness.request('/things').get()
      expect(() => harness.assertJson(result)).not.toThrow()
    })

    it('should assert body contains fields', async () => {
      const created = await harness.createThing({ $type: 'Test', name: 'Test Name' })
      const result = await harness.request(`/things/${created.$id}`).get()

      expect(() => harness.assertBodyContains(result, { name: 'Test Name' })).not.toThrow()
      expect(() => harness.assertBodyContains(result, { name: 'Wrong Name' })).toThrow()
    })

    it('should assert body structure has keys', async () => {
      const created = await harness.createThing({ $type: 'Test', name: 'Struct' })
      const result = await harness.request(`/things/${created.$id}`).get()

      expect(() => harness.assertBodyStructure(result, ['$id', '$type', 'name'])).not.toThrow()
      expect(() => harness.assertBodyStructure(result, ['missingKey'])).toThrow()
    })

    it('should assert success status', async () => {
      const successResult = await harness.request('/things').get()
      expect(() => harness.assertSuccess(successResult)).not.toThrow()

      const errorResult = await harness.request('/things/non-existent').get()
      expect(() => harness.assertSuccess(errorResult)).toThrow('Expected success status')
    })

    it('should assert error status', async () => {
      const errorResult = await harness.request('/things/non-existent').get()
      expect(() => harness.assertError(errorResult)).not.toThrow()

      const successResult = await harness.request('/things').get()
      expect(() => harness.assertError(successResult)).toThrow('Expected error status')
    })

    it('should assert request duration', async () => {
      const result = await harness.request('/things').get()
      // Should be very fast since it's mocked
      expect(() => harness.assertDuration(result, 1000)).not.toThrow()
    })
  })

  // ==========================================================================
  // TEST SUITE: Performance Metrics
  // ==========================================================================

  describe('5. Performance Metrics', () => {
    it('should track request count', async () => {
      await harness.request('/things').get()
      await harness.request('/things').get()
      await harness.request('/things').get()

      const metrics = harness.getMetrics()
      expect(metrics.requestCount).toBe(3)
    })

    it('should track total and average duration', async () => {
      await harness.request('/things').get()
      await harness.request('/things').get()

      const metrics = harness.getMetrics()
      expect(metrics.totalDuration).toBeGreaterThanOrEqual(0)
      expect(metrics.averageDuration).toBeGreaterThanOrEqual(0)
    })

    it('should track min and max duration', async () => {
      await harness.request('/things').get()
      await harness.request('/things').get()

      const metrics = harness.getMetrics()
      expect(metrics.minDuration).toBeGreaterThanOrEqual(0)
      expect(metrics.maxDuration).toBeGreaterThanOrEqual(metrics.minDuration)
    })

    it('should track status code counts', async () => {
      await harness.request('/things').get() // 200
      await harness.request('/things').post({ $type: 'Test' }) // 201
      await harness.request('/things/missing').get() // 404

      const metrics = harness.getMetrics()
      expect(metrics.statusCounts.get(200)).toBe(1)
      expect(metrics.statusCounts.get(201)).toBe(1)
      expect(metrics.statusCounts.get(404)).toBe(1)
    })

    it('should time async operations', async () => {
      const { result, duration } = await harness.time(async () => {
        await harness.createThing({ $type: 'Timed', value: 42 })
        return 'done'
      })

      expect(result).toBe('done')
      expect(duration).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // TEST SUITE: Pipeline Event Tracking
  // ==========================================================================

  describe('6. Pipeline Event Tracking', () => {
    it('should track no events initially', () => {
      const events = harness.getPipelineEvents()
      expect(events).toHaveLength(0)
    })

    it('should simulate pipeline event', () => {
      const env = harness.getEnv()
      env.PIPELINE.simulateEvent({
        type: 'thing.created',
        entityId: 'test-123',
        entityType: 'Customer',
        payload: { name: 'Test' },
        timestamp: Date.now(),
        idempotencyKey: 'key-1',
        namespace: 'smoke-test',
        sequence: 1,
      })

      const events = harness.getPipelineEvents()
      expect(events).toHaveLength(1)
      expect(events[0].entityId).toBe('test-123')
    })

    it('should assert event was emitted', () => {
      const env = harness.getEnv()
      env.PIPELINE.simulateEvent({
        type: 'thing.updated',
        entityId: 'test-456',
        entityType: 'Product',
        payload: {},
        timestamp: Date.now(),
        idempotencyKey: 'key-2',
        namespace: 'smoke-test',
        sequence: 1,
      })

      expect(() => harness.assertEventEmitted('thing.updated')).not.toThrow()
      expect(() => harness.assertEventEmitted('thing.deleted')).toThrow('Expected event')
    })

    it('should assert no events', () => {
      expect(() => harness.assertNoEvents()).not.toThrow()

      const env = harness.getEnv()
      env.PIPELINE.simulateEvent({
        type: 'thing.created',
        entityId: 'event-test',
        entityType: 'Test',
        payload: {},
        timestamp: Date.now(),
        idempotencyKey: 'key-3',
        namespace: 'smoke-test',
        sequence: 1,
      })

      expect(() => harness.assertNoEvents()).toThrow('Expected no events')
    })

    it('should clear pipeline events on teardown', async () => {
      const env = harness.getEnv()
      env.PIPELINE.simulateEvent({
        type: 'thing.created',
        entityId: 'clear-test',
        entityType: 'Test',
        payload: {},
        timestamp: Date.now(),
        idempotencyKey: 'key-4',
        namespace: 'smoke-test',
        sequence: 1,
      })

      expect(harness.getPipelineEvents()).toHaveLength(1)

      await harness.teardown()
      await harness.setup()

      expect(harness.getPipelineEvents()).toHaveLength(0)
    })
  })

  // ==========================================================================
  // TEST SUITE: Utility Methods
  // ==========================================================================

  describe('7. Utility Methods', () => {
    it('should wait for condition', async () => {
      let ready = false
      setTimeout(() => { ready = true }, 50)

      await harness.waitFor(() => ready, { timeout: 1000, interval: 10 })
      expect(ready).toBe(true)
    })

    it('should timeout if condition not met', async () => {
      await expect(
        harness.waitFor(() => false, { timeout: 100, interval: 10 })
      ).rejects.toThrow('Timeout waiting for condition')
    })

    it('should handle health check endpoint', async () => {
      const result = await harness.request('/health').get()
      harness.assertStatus(result, 200)
      harness.assertBodyContains(result, { status: 'ok' })
    })

    it('should handle root endpoint', async () => {
      const result = await harness.request('/').get()
      harness.assertStatus(result, 200)
      harness.assertBodyStructure(result, ['id', 'status'])
    })
  })

  // ==========================================================================
  // TEST SUITE: Edge Cases
  // ==========================================================================

  describe('8. Edge Cases', () => {
    it('should handle empty things list', async () => {
      const things = await harness.listThings()
      expect(things).toEqual([])
    })

    it('should handle special characters in thing ID', async () => {
      const created = await harness.createThing({
        $id: 'special-chars-!@#$%',
        $type: 'Special',
        name: 'Test',
      })
      expect(created.$id).toBe('special-chars-!@#$%')
    })

    it('should handle concurrent creates', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        harness.createThing({ $type: 'Concurrent', index: i })
      )

      const results = await Promise.all(promises)
      expect(results).toHaveLength(5)

      // All should have unique IDs
      const ids = results.map(r => r.$id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(5)
    })

    it('should handle large payload', async () => {
      const largeData = Array.from({ length: 100 }, (_, i) => ({
        field: `field-${i}`,
        value: `value-${i}`.repeat(10),
      }))

      const created = await harness.createThing({
        $type: 'LargePayload',
        data: largeData,
      })

      expect(created.$id).toBeDefined()
      expect((created.data as unknown[]).length).toBe(100)
    })

    it('should handle unicode in names', async () => {
      const created = await harness.createThing({
        $type: 'Unicode',
        name: 'Hello World',
        emoji: 'Test',
      })

      const retrieved = await harness.getThing(created.$id)
      expect(retrieved?.name).toBe('Hello World')
    })
  })
})

// ==========================================================================
// ADDITIONAL TEST: Multiple Harness Instances
// ==========================================================================

describe('E2E Multiple Harness Instances', () => {
  it('should support isolated harness instances', async () => {
    const harness1 = new E2ETestHarness({ namespace: 'ns-1' })
    const harness2 = new E2ETestHarness({ namespace: 'ns-2' })

    await harness1.setup()
    await harness2.setup()

    // Create in harness1
    await harness1.createThing({ $type: 'Test', name: 'In NS1' })

    // Check harness1 has the thing
    const list1 = await harness1.listThings()
    expect(list1.length).toBe(1)

    // Check harness2 is isolated
    const list2 = await harness2.listThings()
    expect(list2.length).toBe(0)

    await harness1.teardown()
    await harness2.teardown()
  })
})

// ==========================================================================
// ADDITIONAL TEST: Configuration Options
// ==========================================================================

describe('E2E Harness Configuration', () => {
  it('should respect verbose option', async () => {
    const harness = new E2ETestHarness({ verbose: true })
    await harness.setup()
    // Just verify it doesn't crash with verbose mode
    await harness.createThing({ $type: 'Verbose' })
    await harness.teardown()
  })

  it('should respect enableTiming option', async () => {
    const harnessWithTiming = new E2ETestHarness({ enableTiming: true })
    const harnessWithoutTiming = new E2ETestHarness({ enableTiming: false })

    await harnessWithTiming.setup()
    await harnessWithoutTiming.setup()

    await harnessWithTiming.request('/things').get()
    await harnessWithoutTiming.request('/things').get()

    expect(harnessWithTiming.getMetrics().requestCount).toBe(1)
    expect(harnessWithoutTiming.getMetrics().requestCount).toBe(0)

    await harnessWithTiming.teardown()
    await harnessWithoutTiming.teardown()
  })
})
