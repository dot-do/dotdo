/**
 * StreamBridge Unified Events Integration Tests
 *
 * Tests for unified event schema integration in StreamBridge:
 * - DO events are transformed correctly before batching
 * - DO actions are transformed correctly before batching
 * - Generic unified events are batched directly
 * - Batching and flushing still works
 * - Namespace is passed to transformers correctly
 *
 * Issue: do-x1m4
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { StreamBridge, type DoEventInput, type ActionInput, type UnifiedEvent } from '../stream-bridge'
import { createUnifiedEvent, type CoreIdentity } from '../../types/unified-event'

// ============================================================================
// MOCK PIPELINE
// ============================================================================

interface MockPipelineOptions {
  sendDelayMs?: number
  errorOnSend?: Error | null
}

const createMockPipeline = (options: MockPipelineOptions = {}) => {
  const events: unknown[] = []
  let delay = options.sendDelayMs ?? 0
  let error = options.errorOnSend ?? null

  const send = vi.fn(async (batch: unknown[]) => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (error) {
      throw error
    }
    events.push(...batch)
  })

  return {
    send,
    events,
    setDelay: (ms: number) => {
      delay = ms
    },
    setError: (err: Error | null) => {
      error = err
    },
    clear: () => {
      events.length = 0
      send.mockClear()
    },
  }
}

type MockPipeline = ReturnType<typeof createMockPipeline>

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a sample DO event for testing
 */
function createSampleDoEvent(overrides: Partial<DoEventInput> = {}): DoEventInput {
  return {
    id: 'evt-123',
    verb: 'signup',
    source: 'Customer/cust-1',
    sourceType: 'Customer',
    data: { email: 'alice@example.com' },
    createdAt: new Date('2026-01-10T10:00:00.000Z'),
    ...overrides,
  }
}

/**
 * Create a sample DO action for testing
 */
function createSampleDoAction(overrides: Partial<ActionInput> = {}): ActionInput {
  return {
    id: 'act-123',
    verb: 'create',
    actor: 'Human/nathan',
    target: 'Customer/cust-456',
    durability: 'do',
    status: 'completed',
    startedAt: new Date('2026-01-10T10:00:00.000Z'),
    completedAt: new Date('2026-01-10T10:00:01.000Z'),
    ...overrides,
  }
}

/**
 * Create a sample unified event for testing
 */
function createSampleUnifiedEvent(overrides: Partial<UnifiedEvent> & Partial<CoreIdentity> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: 'unified-123',
    event_type: 'track',
    event_name: 'page.view',
    ns: 'https://app.example.com',
    http_url: '/dashboard',
    ...overrides,
  })
}

// ============================================================================
// DO EVENT TRANSFORMATION TESTS
// ============================================================================

describe('StreamBridge Unified Events', () => {
  let mockPipeline: MockPipeline
  let bridge: StreamBridge

  beforeEach(() => {
    vi.useFakeTimers()
    mockPipeline = createMockPipeline()
  })

  afterEach(async () => {
    if (bridge) {
      await bridge.close()
    }
    vi.useRealTimers()
  })

  describe('sendEvent() - DO Event Transformation', () => {
    it('should transform DO events correctly before batching', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://startups.studio',
        batchSize: 100,
      })

      const doEvent = createSampleDoEvent()
      await bridge.sendEvent(doEvent)
      await bridge.flushUnified()

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const sentEvents = mockPipeline.events as UnifiedEvent[]
      expect(sentEvents).toHaveLength(1)

      const unified = sentEvents[0]
      expect(unified.event_type).toBe('track')
      expect(unified.event_name).toBe('signup')
      expect(unified.ns).toBe('https://startups.studio')
      expect(unified.resource_type).toBe('Customer')
      expect(unified.resource_id).toBe('https://startups.studio/Customer/cust-1')
      expect(unified.action_verb).toBe('signup')
      expect(unified.data).toEqual({ email: 'alice@example.com' })
    })

    it('should use bridge namespace when no override provided', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://default.ns',
        batchSize: 100,
      })

      await bridge.sendEvent(createSampleDoEvent())
      await bridge.flushUnified()

      const unified = mockPipeline.events[0] as UnifiedEvent
      expect(unified.ns).toBe('https://default.ns')
    })

    it('should allow namespace override per event', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://default.ns',
        batchSize: 100,
      })

      await bridge.sendEvent(createSampleDoEvent(), 'https://override.ns')
      await bridge.flushUnified()

      const unified = mockPipeline.events[0] as UnifiedEvent
      expect(unified.ns).toBe('https://override.ns')
      expect(unified.resource_id).toBe('https://override.ns/Customer/cust-1')
    })

    it('should include actor fields when present', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 100,
      })

      const doEvent = createSampleDoEvent({
        actor: 'user-123',
        actorType: 'user',
      })
      await bridge.sendEvent(doEvent)
      await bridge.flushUnified()

      const unified = mockPipeline.events[0] as UnifiedEvent
      expect(unified.actor_id).toBe('user-123')
      expect(unified.actor_type).toBe('user')
    })

    it('should include EPCIS fields when present', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://supply.chain',
        batchSize: 100,
      })

      const doEvent = createSampleDoEvent({
        bizStep: 'shipping',
        disposition: 'in_transit',
        bizTransaction: 'PO-12345',
        bizLocation: 'urn:epc:id:sgln:0614141.12345.0',
        readPoint: 'urn:epc:id:sgln:0614141.12345.dock5',
      })
      await bridge.sendEvent(doEvent)
      await bridge.flushUnified()

      const unified = mockPipeline.events[0] as UnifiedEvent
      expect(unified.biz_step).toBe('shipping')
      expect(unified.biz_disposition).toBe('in_transit')
      expect(unified.biz_transaction).toBe('PO-12345')
      expect(unified.biz_location).toBe('urn:epc:id:sgln:0614141.12345.0')
      expect(unified.biz_read_point).toBe('urn:epc:id:sgln:0614141.12345.dock5')
    })

    it('should not accept events after close', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 100,
      })

      await bridge.close()
      await bridge.sendEvent(createSampleDoEvent())

      expect(bridge.unifiedBufferSize).toBe(0)
    })
  })

  // ============================================================================
  // DO ACTION TRANSFORMATION TESTS
  // ============================================================================

  describe('sendAction() - DO Action Transformation', () => {
    it('should transform DO actions correctly before batching', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://api.example.com',
        batchSize: 100,
      })

      const doAction = createSampleDoAction()
      await bridge.sendAction(doAction)
      await bridge.flushUnified()

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const sentEvents = mockPipeline.events as UnifiedEvent[]
      expect(sentEvents).toHaveLength(1)

      const unified = sentEvents[0]
      expect(unified.event_type).toBe('trace')
      expect(unified.event_name).toBe('action.create')
      expect(unified.ns).toBe('https://api.example.com')
      expect(unified.action_verb).toBe('create')
      expect(unified.action_durability).toBe('do')
      expect(unified.action_target).toBe('Customer/cust-456')
      expect(unified.actor_id).toBe('Human/nathan')
      expect(unified.outcome).toBe('success')
    })

    it('should map completed status to success outcome', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://api.example.com',
        batchSize: 100,
      })

      const doAction = createSampleDoAction({ status: 'completed' })
      await bridge.sendAction(doAction)
      await bridge.flushUnified()

      const unified = mockPipeline.events[0] as UnifiedEvent
      expect(unified.outcome).toBe('success')
    })

    it('should map failed status to error outcome', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://api.example.com',
        batchSize: 100,
      })

      const doAction = createSampleDoAction({
        status: 'failed',
        error: 'Validation failed',
      })
      await bridge.sendAction(doAction)
      await bridge.flushUnified()

      const unified = mockPipeline.events[0] as UnifiedEvent
      expect(unified.outcome).toBe('error')
      expect(unified.error_message).toBe('Validation failed')
    })

    it('should calculate duration from timestamps', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://api.example.com',
        batchSize: 100,
      })

      const doAction = createSampleDoAction({
        startedAt: new Date('2026-01-10T10:00:00.000Z'),
        completedAt: new Date('2026-01-10T10:00:01.500Z'),
      })
      await bridge.sendAction(doAction)
      await bridge.flushUnified()

      const unified = mockPipeline.events[0] as UnifiedEvent
      expect(unified.duration_ms).toBe(1500)
      expect(unified.started_at).toBe('2026-01-10T10:00:00.000Z')
      expect(unified.ended_at).toBe('2026-01-10T10:00:01.500Z')
    })

    it('should include causality chain fields', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://api.example.com',
        batchSize: 100,
      })

      const doAction = createSampleDoAction({
        requestId: 'req-123',
        sessionId: 'sess-456',
        workflowId: 'wf-789',
      })
      await bridge.sendAction(doAction)
      await bridge.flushUnified()

      const unified = mockPipeline.events[0] as UnifiedEvent
      expect(unified.correlation_id).toBe('req-123')
      expect(unified.session_id).toBe('sess-456')
      expect(unified.workflow_id).toBe('wf-789')
    })

    it('should throw for non-terminal action states', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://api.example.com',
        batchSize: 100,
      })

      const pendingAction = createSampleDoAction({ status: 'pending' })

      await expect(bridge.sendAction(pendingAction)).rejects.toThrow(
        'Only terminal action states should be transformed'
      )
    })
  })

  // ============================================================================
  // GENERIC UNIFIED EVENT TESTS
  // ============================================================================

  describe('sendUnified() - Generic Unified Events', () => {
    it('should batch unified events directly without transformation', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      const unifiedEvent = createSampleUnifiedEvent()
      await bridge.sendUnified(unifiedEvent)
      await bridge.flushUnified()

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const sentEvents = mockPipeline.events as UnifiedEvent[]
      expect(sentEvents).toHaveLength(1)
      expect(sentEvents[0]).toEqual(unifiedEvent)
    })

    it('should preserve all unified event fields', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      const unifiedEvent = createSampleUnifiedEvent({
        trace_id: 'trace-123',
        span_id: 'span-456',
        http_method: 'POST',
        http_status: 201,
        duration_ms: 150,
      })
      await bridge.sendUnified(unifiedEvent)
      await bridge.flushUnified()

      const unified = mockPipeline.events[0] as UnifiedEvent
      expect(unified.trace_id).toBe('trace-123')
      expect(unified.span_id).toBe('span-456')
      expect(unified.http_method).toBe('POST')
      expect(unified.http_status).toBe(201)
      expect(unified.duration_ms).toBe(150)
    })

    it('should not modify the original event', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      const originalEvent = createSampleUnifiedEvent()
      const originalCopy = { ...originalEvent }

      await bridge.sendUnified(originalEvent)
      await bridge.flushUnified()

      // Original should be unchanged
      expect(originalEvent.id).toBe(originalCopy.id)
      expect(originalEvent.event_type).toBe(originalCopy.event_type)
      expect(originalEvent.ns).toBe(originalCopy.ns)
    })
  })

  // ============================================================================
  // BATCHING AND FLUSHING TESTS
  // ============================================================================

  describe('Batching and Flushing', () => {
    it('should batch multiple unified events together', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 100,
      })

      await bridge.sendEvent(createSampleDoEvent({ id: 'evt-1' }))
      await bridge.sendEvent(createSampleDoEvent({ id: 'evt-2' }))
      await bridge.sendAction(createSampleDoAction({ id: 'act-1' }))
      await bridge.sendUnified(createSampleUnifiedEvent({ id: 'unified-1' }))

      await bridge.flushUnified()

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events).toHaveLength(4)
    })

    it('should auto-flush when batch size is reached', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 3,
      })

      await bridge.sendEvent(createSampleDoEvent({ id: 'evt-1' }))
      await bridge.sendEvent(createSampleDoEvent({ id: 'evt-2' }))

      expect(mockPipeline.send).not.toHaveBeenCalled()

      await bridge.sendEvent(createSampleDoEvent({ id: 'evt-3' }))

      // Auto-flush should have been triggered
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events).toHaveLength(3)
    })

    it('should flush unified events at interval', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 1000,
        flushInterval: 5_000,
      })

      await bridge.sendEvent(createSampleDoEvent())

      expect(mockPipeline.send).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(5_100)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should clear unified buffer after flush', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 100,
      })

      await bridge.sendEvent(createSampleDoEvent())
      expect(bridge.unifiedBufferSize).toBe(1)

      await bridge.flushUnified()
      expect(bridge.unifiedBufferSize).toBe(0)
    })

    it('should flush remaining unified events on close', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 100,
      })

      await bridge.sendEvent(createSampleDoEvent())
      await bridge.sendAction(createSampleDoAction())

      await bridge.close()

      expect(mockPipeline.send).toHaveBeenCalled()
      expect(mockPipeline.events).toHaveLength(2)
    })

    it('should track bytes for unified events', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 1000,
        batchBytes: 500, // Low byte limit
      })

      // Add events with data that will exceed byte limit
      await bridge.sendEvent(createSampleDoEvent({
        data: { payload: 'x'.repeat(200) },
      }))
      await bridge.sendEvent(createSampleDoEvent({
        data: { payload: 'x'.repeat(200) },
      }))

      // Wait for potential auto-flush
      await vi.advanceTimersByTimeAsync(10)

      // Should have auto-flushed due to byte limit
      expect(mockPipeline.send.mock.calls.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================================
  // NAMESPACE TESTS
  // ============================================================================

  describe('Namespace Handling', () => {
    it('should use constructor namespace by default', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://default.namespace.com',
        batchSize: 100,
      })

      expect(bridge.namespace).toBe('https://default.namespace.com')
    })

    it('should allow setting namespace after construction', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        batchSize: 100,
      })

      bridge.namespace = 'https://new.namespace.com'
      expect(bridge.namespace).toBe('https://new.namespace.com')

      await bridge.sendEvent(createSampleDoEvent())
      await bridge.flushUnified()

      const unified = mockPipeline.events[0] as UnifiedEvent
      expect(unified.ns).toBe('https://new.namespace.com')
    })

    it('should normalize namespace in transformed events', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com/', // Trailing slash
        batchSize: 100,
      })

      await bridge.sendEvent(createSampleDoEvent())
      await bridge.flushUnified()

      const unified = mockPipeline.events[0] as UnifiedEvent
      expect(unified.ns).toBe('https://app.example.com') // Trailing slash removed
    })

    it('should pass namespace to each transformer', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://tenant1.api.dotdo.dev',
        batchSize: 100,
      })

      await bridge.sendEvent(createSampleDoEvent())
      await bridge.sendAction(createSampleDoAction())
      await bridge.flushUnified()

      const events = mockPipeline.events as UnifiedEvent[]
      expect(events[0].ns).toBe('https://tenant1.api.dotdo.dev')
      expect(events[1].ns).toBe('https://tenant1.api.dotdo.dev')
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    it('should retry on pipeline error for unified events', async () => {
      mockPipeline.send
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValueOnce(undefined)

      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 100,
        maxRetries: 3,
        retryDelay: 10,
      })

      await bridge.sendEvent(createSampleDoEvent())
      await bridge.flushUnified()

      expect(mockPipeline.send).toHaveBeenCalledTimes(3)
    })

    it('should call error handler after max retries for unified events', async () => {
      const onError = vi.fn()
      mockPipeline.setError(new Error('Persistent failure'))

      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 100,
        maxRetries: 2,
        retryDelay: 10,
        onError,
      })

      await bridge.sendEvent(createSampleDoEvent())
      await bridge.flushUnified()

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.arrayContaining([expect.objectContaining({ operation: 'insert' })])
      )
    })
  })

  // ============================================================================
  // PENDING STATE TESTS
  // ============================================================================

  describe('Pending State', () => {
    it('should report pending when unified buffer has events', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 100,
      })

      expect(bridge.pending).toBe(false)

      await bridge.sendEvent(createSampleDoEvent())
      expect(bridge.pending).toBe(true)

      await bridge.flushUnified()
      expect(bridge.pending).toBe(false)
    })

    it('should report pending when either buffer has events', async () => {
      bridge = new StreamBridge(mockPipeline as any, {
        namespace: 'https://app.example.com',
        batchSize: 100,
      })

      // Add to legacy buffer
      bridge.emit('insert', 'users', { id: 1 })
      expect(bridge.pending).toBe(true)

      await bridge.flush()
      expect(bridge.pending).toBe(false)

      // Add to unified buffer
      await bridge.sendEvent(createSampleDoEvent())
      expect(bridge.pending).toBe(true)
    })
  })
})
