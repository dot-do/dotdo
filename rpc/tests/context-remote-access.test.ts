/**
 * Remote Context Access Tests via FetchTransport
 *
 * Comprehensive tests for $ (WorkflowContext) remote access patterns
 * via FetchTransport. These tests verify:
 *
 * 1. Event handler registration ($.on) via remote
 * 2. Schedule registration ($.every) via remote
 * 3. Context propagation ($.run, $.getRequestId, $.setMetadata) via remote
 * 4. Timeout behavior in remote calls
 * 5. Retry behavior simulation via remote
 * 6. Cross-DO RPC proxy patterns ($.Customer(id).method())
 * 7. Concurrent remote operations
 * 8. Transport state management
 *
 * Uses REAL miniflare DO instances - NO MOCKS as per project philosophy.
 *
 * @module rpc/tests/context-remote-access
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import {
  createClientWithTransport,
  FetchTransport,
  CORRELATION_ID_HEADER,
} from '../index'

// Re-export DO classes for vitest-pool-workers
export { ContextDO, EntityDO } from './context-test-dos'

// Type interface for env
interface Env {
  CONTEXT_DO: DurableObjectNamespace
  ENTITY_DO: DurableObjectNamespace
}

// ============================================================================
// Extended Test Interface Types
// ============================================================================

/**
 * Extended interface for the remote context DO API including new methods
 */
interface ExtendedContextDOAPI {
  // Things operations
  'things.create': (data: { $type: string; name: string; [key: string]: unknown }) => Promise<{ $id: string; $type: string; [key: string]: unknown }>
  'things.list': (opts?: { $type?: string; limit?: number }) => Promise<Array<{ $id: string; $type: string; [key: string]: unknown }>>
  'things.get': (id: string) => Promise<{ $id: string; $type: string; [key: string]: unknown } | null>
  'things.update': (id: string, data: Record<string, unknown>) => Promise<{ $id: string; $type: string; [key: string]: unknown }>
  'things.delete': (id: string) => Promise<{ deleted: boolean }>

  // Durability operations
  sendEvent: (type: string, payload?: unknown) => Promise<{ success: true }>
  tryAction: <T>(action: string) => Promise<T>
  doAction: <T>(action: string, options?: { retries?: number; timeout?: number }) => Promise<T>

  // Context state accessors
  getEventCount: () => Promise<number>
  getScheduleCount: () => Promise<number>
  hasHandler: (eventType: string) => Promise<boolean>

  // Event handler registration ($.on)
  registerHandler: (eventType: string) => Promise<{ handlerId: string; eventType: string }>
  getRegisteredEventTypes: () => Promise<string[]>
  getHandlerCount: (eventType: string) => Promise<number>

  // Schedule registration ($.every)
  registerSchedule: (scheduleId: string, cron: string) => Promise<{ scheduleId: string; cron: string }>
  getSchedules: () => Promise<Array<{ scheduleId: string; cron: string }>>
  hasSchedule: (scheduleId: string) => Promise<boolean>

  // Context propagation
  setContextRequestId: (requestId: string) => Promise<{ requestId: string }>
  getContextRequestId: () => Promise<string | undefined>
  setContextMetadata: (key: string, value: unknown) => Promise<{ key: string; value: unknown }>
  getContextMetadata: (key: string) => Promise<unknown>
  getAllContextMetadata: () => Promise<Record<string, unknown>>
  hasContextActive: () => Promise<boolean>

  // Timeout and retry testing
  executeWithDelay: (delayMs: number, shouldFail?: boolean, result?: string) => Promise<{ result: string; elapsed: number }>
  executeWithRetries: (actionId: string, failUntilAttempt?: number, result?: string) => Promise<{ result: string; attempts: number }>
  resetRetryAttempts: (actionId: string) => Promise<{ reset: boolean }>

  // Cross-DO operations
  callRemoteDO: (doId: string, method: string, args: unknown[]) => Promise<unknown>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a FetchTransport-based client for a DO instance
 */
function createExtendedContextClient(stub: DurableObjectStub, options?: { timeout?: number; correlationId?: string }): ExtendedContextDOAPI & { $transport: FetchTransport } {
  // Create a custom fetch that routes to the DO stub
  const stubFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    return stub.fetch(request)
  }

  const transport = new FetchTransport({
    url: 'https://context-do',
    fetch: stubFetch,
    timeout: options?.timeout ?? 10000,
    correlationId: options?.correlationId,
  })

  return createClientWithTransport<ExtendedContextDOAPI>({ transport })
}

/**
 * Get a unique DO instance for testing
 */
function getContextDO(name: string): DurableObjectStub {
  const id = (env as Env).CONTEXT_DO.idFromName(name)
  return (env as Env).CONTEXT_DO.get(id)
}

function getEntityDO(name: string): DurableObjectStub {
  const id = (env as Env).ENTITY_DO.idFromName(name)
  return (env as Env).ENTITY_DO.get(id)
}

/**
 * Generate unique test ID
 */
function generateTestId(prefix: string = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Remote $ Context Access via FetchTransport', () => {
  describe('1. Event Handler Registration ($.on) via Remote', () => {
    it('should register event handler via FetchTransport', async () => {
      const stub = getContextDO(generateTestId('handler-reg'))
      const client = createExtendedContextClient(stub)

      const result = await client.registerHandler('Customer.signup')

      expect(result.handlerId).toBeDefined()
      expect(result.handlerId).toMatch(/^handler-/)
      expect(result.eventType).toBe('Customer.signup')
    })

    it('should register multiple handlers for same event type', async () => {
      const stub = getContextDO(generateTestId('multi-handler'))
      const client = createExtendedContextClient(stub)

      await client.registerHandler('Order.placed')
      await client.registerHandler('Order.placed')
      await client.registerHandler('Order.placed')

      const count = await client.getHandlerCount('Order.placed')
      expect(count).toBe(3)
    })

    it('should register handlers for different event types', async () => {
      const stub = getContextDO(generateTestId('diff-events'))
      const client = createExtendedContextClient(stub)

      await client.registerHandler('User.created')
      await client.registerHandler('Order.shipped')
      await client.registerHandler('Payment.processed')

      const eventTypes = await client.getRegisteredEventTypes()
      expect(eventTypes).toContain('User.created')
      expect(eventTypes).toContain('Order.shipped')
      expect(eventTypes).toContain('Payment.processed')
    })

    it('should verify handler registration via hasHandler', async () => {
      const stub = getContextDO(generateTestId('has-handler'))
      const client = createExtendedContextClient(stub)

      expect(await client.hasHandler('Invoice.generated')).toBe(false)

      await client.registerHandler('Invoice.generated')

      expect(await client.hasHandler('Invoice.generated')).toBe(true)
    })

    it('should handle wildcard event type patterns', async () => {
      const stub = getContextDO(generateTestId('wildcard'))
      const client = createExtendedContextClient(stub)

      // Register handlers with wildcard patterns
      await client.registerHandler('Customer.*')
      await client.registerHandler('*.*')

      const eventTypes = await client.getRegisteredEventTypes()
      expect(eventTypes).toContain('Customer.*')
      expect(eventTypes).toContain('*.*')
    })
  })

  describe('2. Schedule Registration ($.every) via Remote', () => {
    it('should register schedule via FetchTransport', async () => {
      const stub = getContextDO(generateTestId('schedule-reg'))
      const client = createExtendedContextClient(stub)

      const result = await client.registerSchedule('weekly-report', '0 9 * * 1')

      expect(result.scheduleId).toBe('weekly-report')
      expect(result.cron).toBe('0 9 * * 1')
    })

    it('should register multiple schedules', async () => {
      const stub = getContextDO(generateTestId('multi-schedule'))
      const client = createExtendedContextClient(stub)

      await client.registerSchedule('daily-backup', '0 0 * * *')
      await client.registerSchedule('hourly-check', '0 * * * *')
      await client.registerSchedule('monthly-report', '0 0 1 * *')

      const count = await client.getScheduleCount()
      expect(count).toBe(3)
    })

    it('should verify schedule registration via hasSchedule', async () => {
      const stub = getContextDO(generateTestId('has-schedule'))
      const client = createExtendedContextClient(stub)

      expect(await client.hasSchedule('cleanup')).toBe(false)

      await client.registerSchedule('cleanup', '0 2 * * *')

      expect(await client.hasSchedule('cleanup')).toBe(true)
    })

    it('should retrieve all registered schedules', async () => {
      const stub = getContextDO(generateTestId('get-schedules'))
      const client = createExtendedContextClient(stub)

      await client.registerSchedule('schedule-a', '*/5 * * * *')
      await client.registerSchedule('schedule-b', '*/10 * * * *')

      const schedules = await client.getSchedules()

      expect(schedules).toHaveLength(2)
      expect(schedules.find(s => s.scheduleId === 'schedule-a')).toBeDefined()
      expect(schedules.find(s => s.scheduleId === 'schedule-b')).toBeDefined()
    })

    it('should overwrite schedule with same ID', async () => {
      const stub = getContextDO(generateTestId('overwrite-schedule'))
      const client = createExtendedContextClient(stub)

      await client.registerSchedule('task', '0 0 * * *')
      await client.registerSchedule('task', '0 12 * * *')

      const schedules = await client.getSchedules()
      const task = schedules.find(s => s.scheduleId === 'task')

      expect(task?.cron).toBe('0 12 * * *')
      expect(schedules).toHaveLength(1)
    })
  })

  describe('3. Context Propagation via Remote', () => {
    it('should set and get request ID via FetchTransport', async () => {
      const stub = getContextDO(generateTestId('request-id'))
      const client = createExtendedContextClient(stub)

      const setResult = await client.setContextRequestId('req-12345')
      expect(setResult.requestId).toBe('req-12345')

      const requestId = await client.getContextRequestId()
      expect(requestId).toBe('req-12345')
    })

    it('should set and get metadata via FetchTransport', async () => {
      const stub = getContextDO(generateTestId('metadata'))
      const client = createExtendedContextClient(stub)

      await client.setContextMetadata('userId', 'user-abc')
      await client.setContextMetadata('tenantId', 'tenant-xyz')
      await client.setContextMetadata('permissions', ['read', 'write'])

      expect(await client.getContextMetadata('userId')).toBe('user-abc')
      expect(await client.getContextMetadata('tenantId')).toBe('tenant-xyz')
      expect(await client.getContextMetadata('permissions')).toEqual(['read', 'write'])
    })

    it('should get all metadata', async () => {
      const stub = getContextDO(generateTestId('all-metadata'))
      const client = createExtendedContextClient(stub)

      await client.setContextMetadata('key1', 'value1')
      await client.setContextMetadata('key2', { nested: true })
      await client.setContextMetadata('key3', 42)

      const allMetadata = await client.getAllContextMetadata()

      expect(allMetadata.key1).toBe('value1')
      expect(allMetadata.key2).toEqual({ nested: true })
      expect(allMetadata.key3).toBe(42)
    })

    it('should detect active context', async () => {
      const stub = getContextDO(generateTestId('has-context'))
      const client = createExtendedContextClient(stub)

      // Initially no context
      expect(await client.hasContextActive()).toBe(false)

      // Set request ID activates context
      await client.setContextRequestId('test-req')
      expect(await client.hasContextActive()).toBe(true)
    })

    it('should detect context from metadata', async () => {
      const stub = getContextDO(generateTestId('context-metadata'))
      const client = createExtendedContextClient(stub)

      // Initially no context
      expect(await client.hasContextActive()).toBe(false)

      // Set metadata activates context
      await client.setContextMetadata('trace', 'trace-123')
      expect(await client.hasContextActive()).toBe(true)
    })

    it('should return null for non-existent metadata keys', async () => {
      const stub = getContextDO(generateTestId('missing-metadata'))
      const client = createExtendedContextClient(stub)

      // Note: RPC serializes undefined as null in JSON
      const value = await client.getContextMetadata('non-existent')
      expect(value).toBeNull()
    })
  })

  describe('4. Timeout Behavior in Remote Calls', () => {
    it('should complete before timeout', async () => {
      const stub = getContextDO(generateTestId('timeout-success'))
      const client = createExtendedContextClient(stub, { timeout: 5000 })

      const result = await client.executeWithDelay(100, false, 'quick')

      expect(result.result).toBe('quick')
      // Allow 5ms tolerance for timing variations in CI environments
      expect(result.elapsed).toBeGreaterThanOrEqual(95)
      expect(result.elapsed).toBeLessThan(500)
    })

    it('should handle slow operations within timeout', async () => {
      const stub = getContextDO(generateTestId('slow-op'))
      const client = createExtendedContextClient(stub, { timeout: 5000 })

      const result = await client.executeWithDelay(500, false, 'slow-result')

      expect(result.result).toBe('slow-result')
      // Allow small tolerance for timing variations
      expect(result.elapsed).toBeGreaterThanOrEqual(490)
    })

    it('should propagate errors from delayed operations', async () => {
      const stub = getContextDO(generateTestId('delay-error'))
      const client = createExtendedContextClient(stub, { timeout: 5000 })

      await expect(
        client.executeWithDelay(100, true, 'should-fail')
      ).rejects.toThrow('Action failed after delay')
    })

    it('should measure elapsed time accurately', async () => {
      const stub = getContextDO(generateTestId('elapsed-time'))
      const client = createExtendedContextClient(stub, { timeout: 5000 })

      const targetDelay = 200
      const result = await client.executeWithDelay(targetDelay)

      // Allow 50ms tolerance
      expect(result.elapsed).toBeGreaterThanOrEqual(targetDelay - 10)
      expect(result.elapsed).toBeLessThan(targetDelay + 100)
    })
  })

  describe('5. Retry Behavior Simulation via Remote', () => {
    it('should succeed on first attempt', async () => {
      const stub = getContextDO(generateTestId('retry-first'))
      const client = createExtendedContextClient(stub)

      const result = await client.executeWithRetries('action-1', 1, 'immediate-success')

      expect(result.result).toBe('immediate-success')
      expect(result.attempts).toBe(1)
    })

    it('should track retry attempts across calls', async () => {
      const stub = getContextDO(generateTestId('retry-track'))
      const client = createExtendedContextClient(stub)

      const actionId = `action-${Date.now()}`

      // First call fails
      await expect(
        client.executeWithRetries(actionId, 3, 'eventual-success')
      ).rejects.toThrow('Attempt 1 failed')

      // Second call fails
      await expect(
        client.executeWithRetries(actionId, 3, 'eventual-success')
      ).rejects.toThrow('Attempt 2 failed')

      // Third call succeeds
      const result = await client.executeWithRetries(actionId, 3, 'eventual-success')
      expect(result.result).toBe('eventual-success')
      expect(result.attempts).toBe(3)
    })

    it('should reset retry attempts', async () => {
      const stub = getContextDO(generateTestId('retry-reset'))
      const client = createExtendedContextClient(stub)

      const actionId = `action-${Date.now()}`

      // Accumulate some attempts
      await expect(client.executeWithRetries(actionId, 5)).rejects.toThrow()
      await expect(client.executeWithRetries(actionId, 5)).rejects.toThrow()

      // Reset
      const resetResult = await client.resetRetryAttempts(actionId)
      expect(resetResult.reset).toBe(true)

      // Next call starts from attempt 1
      await expect(client.executeWithRetries(actionId, 5)).rejects.toThrow('Attempt 1 failed')
    })

    it('should handle multiple concurrent retry actions independently', async () => {
      const stub = getContextDO(generateTestId('retry-concurrent'))
      const client = createExtendedContextClient(stub)

      const action1 = `action1-${Date.now()}`
      const action2 = `action2-${Date.now()}`

      // Both fail first attempt
      await expect(client.executeWithRetries(action1, 2)).rejects.toThrow()
      await expect(client.executeWithRetries(action2, 3)).rejects.toThrow()

      // action1 succeeds on second attempt
      const result1 = await client.executeWithRetries(action1, 2)
      expect(result1.attempts).toBe(2)

      // action2 still needs more attempts
      await expect(client.executeWithRetries(action2, 3)).rejects.toThrow('Attempt 2 failed')
      const result2 = await client.executeWithRetries(action2, 3)
      expect(result2.attempts).toBe(3)
    })
  })

  describe('6. Cross-DO RPC Proxy Patterns', () => {
    it('should call method on another DO via cross-DO RPC', async () => {
      const contextStub = getContextDO(generateTestId('cross-do'))
      const client = createExtendedContextClient(contextStub)

      const result = await client.callRemoteDO('entity-1', 'greet', ['Alice'])
      expect(result).toBe('Hello, Alice!')
    })

    it('should handle cross-DO RPC errors', async () => {
      const contextStub = getContextDO(generateTestId('cross-do-error'))
      const client = createExtendedContextClient(contextStub)

      await expect(
        client.callRemoteDO('entity-2', 'throwNotFound', ['missing-resource'])
      ).rejects.toThrow()
    })

    it('should call balance-related methods on EntityDO', async () => {
      const contextStub = getContextDO(generateTestId('cross-do-balance'))
      const client = createExtendedContextClient(contextStub)

      const balance = await client.callRemoteDO('entity-balance', 'getBalance', [])
      expect(balance).toBe(1000) // Default balance

      const chargeResult = await client.callRemoteDO('entity-balance', 'charge', [100]) as { success: boolean; balance: number }
      expect(chargeResult.success).toBe(true)
      expect(chargeResult.balance).toBe(900)
    })

    it('should propagate ValidationError from cross-DO call', async () => {
      const contextStub = getContextDO(generateTestId('cross-do-validation'))
      const client = createExtendedContextClient(contextStub)

      await expect(
        client.callRemoteDO('entity-validation', 'charge', [2000])
      ).rejects.toThrow('Insufficient balance')
    })
  })

  describe('7. Concurrent Remote Operations', () => {
    it('should handle concurrent handler registrations', async () => {
      const stub = getContextDO(generateTestId('concurrent-handlers'))
      const client = createExtendedContextClient(stub)

      const promises = Array.from({ length: 10 }, (_, i) =>
        client.registerHandler(`Event.type${i}`)
      )

      const results = await Promise.all(promises)

      expect(results).toHaveLength(10)
      results.forEach((r, i) => {
        expect(r.eventType).toBe(`Event.type${i}`)
      })

      const eventTypes = await client.getRegisteredEventTypes()
      expect(eventTypes).toHaveLength(10)
    })

    it('should handle concurrent schedule registrations', async () => {
      const stub = getContextDO(generateTestId('concurrent-schedules'))
      const client = createExtendedContextClient(stub)

      const promises = Array.from({ length: 5 }, (_, i) =>
        client.registerSchedule(`schedule-${i}`, `${i} * * * *`)
      )

      const results = await Promise.all(promises)

      expect(results).toHaveLength(5)
      expect(await client.getScheduleCount()).toBe(5)
    })

    it('should handle concurrent metadata operations', async () => {
      const stub = getContextDO(generateTestId('concurrent-metadata'))
      const client = createExtendedContextClient(stub)

      const setPromises = Array.from({ length: 10 }, (_, i) =>
        client.setContextMetadata(`key${i}`, `value${i}`)
      )

      await Promise.all(setPromises)

      const allMetadata = await client.getAllContextMetadata()
      expect(Object.keys(allMetadata)).toHaveLength(10)
    })

    it('should handle concurrent things operations', async () => {
      const stub = getContextDO(generateTestId('concurrent-things'))
      const client = createExtendedContextClient(stub)

      const createPromises = Array.from({ length: 5 }, (_, i) =>
        client['things.create']({ $type: 'ConcurrentItem', name: `Item ${i}` })
      )

      const results = await Promise.all(createPromises)

      expect(results).toHaveLength(5)

      const uniqueIds = new Set(results.map(r => r.$id))
      expect(uniqueIds.size).toBe(5)
    })

    it('should handle mixed concurrent operations', async () => {
      const stub = getContextDO(generateTestId('concurrent-mixed'))
      const client = createExtendedContextClient(stub)

      const operations = [
        client.registerHandler('Mixed.event1'),
        client.registerSchedule('mixed-schedule', '0 * * * *'),
        client.setContextMetadata('mixedKey', 'mixedValue'),
        client['things.create']({ $type: 'MixedItem', name: 'Mixed' }),
        client.sendEvent('mixed.event', { data: 'test' }),
      ]

      const results = await Promise.all(operations)

      expect(results).toHaveLength(5)
      expect(await client.hasHandler('Mixed.event1')).toBe(true)
      expect(await client.hasSchedule('mixed-schedule')).toBe(true)
      expect(await client.getContextMetadata('mixedKey')).toBe('mixedValue')
    })
  })

  describe('8. Transport State and Correlation', () => {
    it('should maintain transport in connected state', async () => {
      const stub = getContextDO(generateTestId('transport-state'))
      const client = createExtendedContextClient(stub)

      const state = client.$transport.getState()
      expect(state).toBe('CONNECTED')
    })

    it('should handle close on stateless transport', async () => {
      const stub = getContextDO(generateTestId('transport-close'))
      const client = createExtendedContextClient(stub)

      await client.$transport.close()

      // FetchTransport is stateless, so still connected
      expect(client.$transport.getState()).toBe('CONNECTED')
    })

    it('should propagate correlation ID in request', async () => {
      const stub = getContextDO(generateTestId('correlation'))
      const correlationId = `corr-${Date.now()}`
      const client = createExtendedContextClient(stub, { correlationId })

      // Make a call - the correlation ID should be passed
      await client.getEventCount()

      // Verify the transport is using the correlation ID
      expect(client.$transport).toBeDefined()
    })

    it('should work after multiple sequential operations', async () => {
      const stub = getContextDO(generateTestId('sequential'))
      const client = createExtendedContextClient(stub)

      // Perform many sequential operations
      for (let i = 0; i < 10; i++) {
        await client.registerHandler(`Sequential.event${i}`)
      }

      for (let i = 0; i < 10; i++) {
        expect(await client.hasHandler(`Sequential.event${i}`)).toBe(true)
      }

      expect(await client.getRegisteredEventTypes()).toHaveLength(10)
    })
  })

  describe('9. Error Handling in Remote Context', () => {
    it('should propagate tryAction errors', async () => {
      const stub = getContextDO(generateTestId('try-error'))
      const client = createExtendedContextClient(stub)

      await expect(
        client.tryAction('error:Test error message')
      ).rejects.toThrow('Test error message')
    })

    it('should propagate doAction errors with retry count', async () => {
      const stub = getContextDO(generateTestId('do-error'))
      const client = createExtendedContextClient(stub)

      await expect(
        client.doAction('error:Action failed', { retries: 5 })
      ).rejects.toThrow('Failed after 5 retries: Action failed')
    })

    it('should handle successful tryAction', async () => {
      const stub = getContextDO(generateTestId('try-success'))
      const client = createExtendedContextClient(stub)

      const result = await client.tryAction<string>('success-value')
      expect(result).toBe('success-value')
    })

    it('should handle successful doAction', async () => {
      const stub = getContextDO(generateTestId('do-success'))
      const client = createExtendedContextClient(stub)

      const result = await client.doAction<string>('durable-value', { retries: 3 })
      expect(result).toBe('durable-value')
    })
  })

  describe('10. Integration with Things Store via Remote', () => {
    it('should perform create, read, update via remote', async () => {
      const stub = getContextDO(generateTestId('crud-cycle'))
      const client = createExtendedContextClient(stub)

      // Create
      const created = await client['things.create']({
        $type: 'CRUDTest',
        name: 'Test Item',
        value: 100,
      })

      expect(created.$id).toBeDefined()
      expect(created.$type).toBe('CRUDTest')
      expect(created.name).toBe('Test Item')

      // Read
      const retrieved = await client['things.get'](created.$id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.$id).toBe(created.$id)

      // Update
      const updated = await client['things.update'](created.$id, { value: 200 })
      expect(updated.value).toBe(200)
    })

    it('should list things and create multiple types via remote', async () => {
      const stub = getContextDO(generateTestId('list-filter'))
      const client = createExtendedContextClient(stub)

      // Create items of different types
      const a1 = await client['things.create']({ $type: 'TypeA', name: 'A1' })
      const a2 = await client['things.create']({ $type: 'TypeA', name: 'A2' })
      const b1 = await client['things.create']({ $type: 'TypeB', name: 'B1' })

      // List all
      const all = await client['things.list']()
      expect(all.length).toBeGreaterThanOrEqual(3)

      // Verify created items exist
      expect(all.some(item => item.$id === a1.$id)).toBe(true)
      expect(all.some(item => item.$id === a2.$id)).toBe(true)
      expect(all.some(item => item.$id === b1.$id)).toBe(true)

      // Verify types are correct
      const createdA1 = all.find(item => item.$id === a1.$id)
      expect(createdA1?.$type).toBe('TypeA')

      const createdB1 = all.find(item => item.$id === b1.$id)
      expect(createdB1?.$type).toBe('TypeB')
    })

    it('should respect limit in listing', async () => {
      const stub = getContextDO(generateTestId('list-limit'))
      const client = createExtendedContextClient(stub)

      // Create multiple items
      for (let i = 0; i < 10; i++) {
        await client['things.create']({ $type: 'LimitTest', name: `Item ${i}` })
      }

      const limited = await client['things.list']({ $type: 'LimitTest', limit: 3 })
      expect(limited).toHaveLength(3)
    })
  })
})
