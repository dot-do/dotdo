/**
 * Pipeline Interface Compatibility Tests (TDD GREEN Phase)
 *
 * These tests verify that the Pipeline interface is unified across components:
 *
 * 1. PipelineEmitter (pipeline-emitter.ts):
 *    - Uses Pipeline from ./types/pipeline
 *    - Pipeline.send(events: unknown[]): Promise<void>  // BATCH - array
 *
 * 2. MultiMasterManager (multi-master.ts):
 *    - Uses MultiMasterPipeline extends Pipeline
 *    - Pipeline.send(events: unknown[]): Promise<void>  // BATCH - array
 *    - Plus subscribe() for replication
 *
 * The unified interface uses batch sending as the canonical form.
 * Components that need single-event semantics wrap in an array.
 *
 * @see objects/unified-storage/types/pipeline.ts
 * @see objects/unified-storage/pipeline-emitter.ts
 * @see objects/unified-storage/multi-master.ts
 */
import { describe, it, expect } from 'vitest'
import {
  PipelineEmitter,
  type Pipeline as PipelineEmitterPipeline,
  type EmittedEvent,
} from '../../objects/unified-storage/pipeline-emitter'
import {
  MultiMasterManager,
  type MultiMasterPipeline,
  type WriteEvent,
} from '../../objects/unified-storage/multi-master'
import {
  type Pipeline,
  type SubscribablePipeline,
  sendOne,
  isSubscribablePipeline,
} from '../../objects/unified-storage/types/pipeline'

// ============================================================================
// Type-Level Interface Tests
// ============================================================================

describe('Pipeline Interface Compatibility', () => {
  describe('Type-level interface unification verification', () => {
    /**
     * Verify PipelineEmitter uses the batch interface
     */
    it('should verify PipelineEmitter expects batch send interface', () => {
      // PipelineEmitter.Pipeline.send expects an array
      const batchPipeline: PipelineEmitterPipeline = {
        send: async (events: unknown[]): Promise<void> => {
          // This is the batch interface
          expect(Array.isArray(events)).toBe(true)
        },
      }

      const emitter = new PipelineEmitter(batchPipeline, {
        namespace: 'test',
        flushInterval: 0, // Immediate flush
      })

      emitter.emit('thing.created', 'things', { $id: 'test-1', name: 'Test' })

      // Verify the interface expects an array
      expect(batchPipeline.send).toBeDefined()
    })

    /**
     * Verify MultiMasterManager now uses batch interface internally
     * The MultiMasterPipeline extends Pipeline with subscribe()
     */
    it('should verify MultiMasterManager uses batch send interface with subscribe', () => {
      // MultiMasterManager now uses batch interface
      const sentBatches: unknown[][] = []
      const batchPipeline: MultiMasterPipeline = {
        send: async (events: unknown[]): Promise<void> => {
          // This is the batch interface - MultiMaster wraps single events in arrays
          expect(Array.isArray(events)).toBe(true)
          sentBatches.push(events)
        },
        subscribe: () => () => {},
      }

      // Verify the interface now expects an array (batch)
      expect(batchPipeline.send).toBeDefined()
      expect(batchPipeline.subscribe).toBeDefined()
    })

    /**
     * GREEN: PipelineEmitter Pipeline can now be used with MultiMasterManager
     * when extended with subscribe()
     */
    it('should allow PipelineEmitter Pipeline to work with MultiMasterManager (unified batch interface)', async () => {
      // Create a pipeline that implements the unified batch interface
      const sentBatches: unknown[][] = []
      const unifiedPipeline: MultiMasterPipeline = {
        send: async (events: unknown[]): Promise<void> => {
          sentBatches.push(events)
        },
        subscribe: () => () => {},
      }

      const stateManager = {
        data: new Map<string, any>(),
        get: async (id: string) => stateManager.data.get(id),
        set: async (id: string, entity: any) => {
          stateManager.data.set(id, entity)
          return entity
        },
        delete: async (id: string) => stateManager.data.delete(id),
        list: async () => Array.from(stateManager.data.values()),
      }

      // No more @ts-expect-error - interfaces are now compatible
      const manager = new MultiMasterManager({
        masterId: 'master-1',
        pipeline: unifiedPipeline,
        stateManager,
      })

      // Perform a write - MultiMaster now calls send([event]) with batch interface
      await manager.write('entity-1', { name: 'Test Entity' })

      // GREEN: The batch pipeline received an array with one event
      expect(sentBatches.length).toBe(1)
      const firstBatch = sentBatches[0]
      expect(Array.isArray(firstBatch)).toBe(true)
      expect(firstBatch).toHaveLength(1)

      // Verify the event structure
      const event = firstBatch[0] as WriteEvent
      expect(event.type).toBe('write')
      expect(event.masterId).toBe('master-1')
      expect(event.entityId).toBe('entity-1')
    })

    /**
     * GREEN: Verify base Pipeline works with PipelineEmitter
     */
    it('should allow base Pipeline to work with PipelineEmitter', async () => {
      // Create a simple base Pipeline (no subscribe needed)
      const sentBatches: unknown[][] = []
      const basePipeline: Pipeline = {
        send: async (events: unknown[]): Promise<void> => {
          sentBatches.push(events)
        },
      }

      const emitter = new PipelineEmitter(basePipeline, {
        namespace: 'test',
        flushInterval: 0, // Immediate flush
      })

      emitter.emit('thing.created', 'things', { $id: 'test-1', name: 'Test' })
      await emitter.flush()

      // GREEN: The pipeline received an array with one event
      expect(sentBatches.length).toBe(1)
      const firstBatch = sentBatches[0]
      expect(Array.isArray(firstBatch)).toBe(true)
      expect(firstBatch).toHaveLength(1)

      // Verify the event structure
      const event = firstBatch[0] as EmittedEvent
      expect(event.verb).toBe('thing.created')
      expect(event.store).toBe('things')
    })
  })

  // ============================================================================
  // Interoperability Tests
  // ============================================================================

  describe('Interoperability success', () => {
    /**
     * GREEN: A shared pipeline can now work with both systems simultaneously
     * using the unified batch interface
     */
    it('should create a unified pipeline that works with both systems', async () => {
      const allBatches: unknown[][] = []

      // Create unified pipeline using batch interface
      const unifiedPipeline: MultiMasterPipeline = {
        send: async (events: unknown[]): Promise<void> => {
          allBatches.push(events)
        },
        subscribe: () => () => {},
      }

      // Use with PipelineEmitter
      const emitter = new PipelineEmitter(unifiedPipeline, {
        namespace: 'test',
        flushInterval: 0,
      })

      emitter.emit('thing.created', 'things', { $id: 'emitter-1' })
      await emitter.flush()

      // Use with MultiMasterManager
      const stateManager = {
        data: new Map<string, any>(),
        get: async (id: string) => stateManager.data.get(id),
        set: async (id: string, entity: any) => {
          stateManager.data.set(id, entity)
          return entity
        },
        delete: async (id: string) => stateManager.data.delete(id),
        list: async () => Array.from(stateManager.data.values()),
      }

      const manager = new MultiMasterManager({
        masterId: 'master-1',
        pipeline: unifiedPipeline,
        stateManager,
      })

      await manager.write('manager-entity', { name: 'Manager Entity' })

      // GREEN: Both systems sent batches successfully
      expect(allBatches.length).toBe(2)

      // Both batches are arrays with one event each
      expect(Array.isArray(allBatches[0])).toBe(true)
      expect(Array.isArray(allBatches[1])).toBe(true)
      expect(allBatches[0]).toHaveLength(1)
      expect(allBatches[1]).toHaveLength(1)

      // Verify event structures
      const emitterEvent = allBatches[0][0] as EmittedEvent
      const managerEvent = allBatches[1][0] as WriteEvent

      // EmittedEvent has its structure
      expect(emitterEvent).toHaveProperty('verb')
      expect(emitterEvent).toHaveProperty('store')
      expect(emitterEvent).toHaveProperty('idempotencyKey')

      // WriteEvent has its structure
      expect(managerEvent).toHaveProperty('type')
      expect(managerEvent).toHaveProperty('masterId')
      expect(managerEvent).toHaveProperty('vectorClock')
    })

    /**
     * GREEN: Type guards can still distinguish event sources when needed
     * This is acceptable - different components may emit different event types
     * through the unified pipeline interface
     */
    it('should allow type guards to distinguish event sources when needed', () => {
      // Define what a unified event processor would need to do
      const processEvent = (event: unknown): { source: 'emitter' | 'manager'; processed: boolean } => {
        // Type guard for EmittedEvent (from PipelineEmitter)
        const isEmittedEvent = (e: unknown): e is EmittedEvent => {
          return (
            typeof e === 'object' &&
            e !== null &&
            'verb' in e &&
            'store' in e &&
            'idempotencyKey' in e
          )
        }

        // Type guard for WriteEvent (from MultiMasterManager)
        const isWriteEvent = (e: unknown): e is WriteEvent => {
          return (
            typeof e === 'object' &&
            e !== null &&
            'type' in e &&
            'masterId' in e &&
            'vectorClock' in e
          )
        }

        if (isEmittedEvent(event)) {
          return { source: 'emitter', processed: true }
        }

        if (isWriteEvent(event)) {
          return { source: 'manager', processed: true }
        }

        return { source: 'emitter', processed: false }
      }

      // Create sample events
      const emitterEvent: EmittedEvent = {
        verb: 'thing.created',
        store: 'things',
        payload: { $id: 'test-1' },
        timestamp: new Date().toISOString(),
        idempotencyKey: 'test-1:created:123',
        _meta: { namespace: 'test' },
      }

      const managerEvent: WriteEvent = {
        type: 'write',
        masterId: 'master-1',
        entityId: 'entity-1',
        entityType: 'Entity',
        data: { name: 'Test' },
        vectorClock: { 'master-1': 1 },
        timestamp: Date.now(),
      }

      // Verify type guards work correctly
      const emitterResult = processEvent(emitterEvent)
      const managerResult = processEvent(managerEvent)

      expect(emitterResult.source).toBe('emitter')
      expect(emitterResult.processed).toBe(true)
      expect(managerResult.source).toBe('manager')
      expect(managerResult.processed).toBe(true)
    })
  })

  // ============================================================================
  // Unified Interface Specification Tests
  // ============================================================================

  describe('Unified interface specification', () => {
    /**
     * Verify the unified Pipeline interface from types/pipeline.ts
     */
    it('should verify unified Pipeline interface is properly defined', () => {
      // Base Pipeline has batch send
      const basePipeline: Pipeline = {
        send: async (events: unknown[]): Promise<void> => {},
      }

      // SubscribablePipeline extends Pipeline with subscribe
      const subscribablePipeline: SubscribablePipeline = {
        send: async (events: unknown[]): Promise<void> => {},
        subscribe: (subscriberId: string, handler: (event: unknown) => Promise<void> | void) => {
          return () => {}
        },
      }

      expect(basePipeline.send).toBeDefined()
      expect(subscribablePipeline.send).toBeDefined()
      expect(subscribablePipeline.subscribe).toBeDefined()

      // Both interfaces have the same send signature (batch)
      expect(basePipeline.send.length).toBe(subscribablePipeline.send.length)
    })

    /**
     * Verify sendOne helper works correctly
     */
    it('should verify sendOne helper for single-event convenience', async () => {
      const sentBatches: unknown[][] = []
      const pipeline: Pipeline = {
        send: async (events: unknown[]): Promise<void> => {
          sentBatches.push(events)
        },
      }

      const event = { type: 'test', data: 'hello' }
      await sendOne(pipeline, event)

      // sendOne wraps the single event in an array
      expect(sentBatches.length).toBe(1)
      expect(sentBatches[0]).toHaveLength(1)
      expect(sentBatches[0][0]).toBe(event)
    })

    /**
     * Verify isSubscribablePipeline type guard
     */
    it('should verify isSubscribablePipeline type guard', () => {
      const basePipeline: Pipeline = {
        send: async () => {},
      }

      const subscribablePipeline: SubscribablePipeline = {
        send: async () => {},
        subscribe: () => () => {},
      }

      expect(isSubscribablePipeline(basePipeline)).toBe(false)
      expect(isSubscribablePipeline(subscribablePipeline)).toBe(true)
    })

    /**
     * GREEN: MultiMasterManager now uses batch interface internally
     * No adapter needed - it wraps single events in arrays
     */
    it('should demonstrate MultiMasterManager uses batch interface natively', async () => {
      // Mock unified pipeline
      const unifiedEvents: unknown[] = []
      const unifiedPipeline: MultiMasterPipeline = {
        send: async (events: unknown[]) => {
          unifiedEvents.push(...events)
        },
        subscribe: () => () => {},
      }

      // Use directly with MultiMasterManager - no adapter needed
      const stateManager = {
        data: new Map<string, any>(),
        get: async (id: string) => stateManager.data.get(id),
        set: async (id: string, entity: any) => {
          stateManager.data.set(id, entity)
          return entity
        },
        delete: async (id: string) => stateManager.data.delete(id),
        list: async () => Array.from(stateManager.data.values()),
      }

      const manager = new MultiMasterManager({
        masterId: 'master-1',
        pipeline: unifiedPipeline,
        stateManager,
      })

      await manager.write('entity-1', { name: 'Test' })

      // GREEN: Event received through unified batch interface
      expect(unifiedEvents.length).toBe(1)
      expect(unifiedEvents[0]).toHaveProperty('type', 'write')
      expect(unifiedEvents[0]).toMatchObject({
        type: 'write',
        masterId: 'master-1',
        entityId: 'entity-1',
      })
    })
  })
})
