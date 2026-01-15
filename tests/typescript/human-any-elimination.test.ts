/**
 * Human Module - Any Type Elimination Tests (GREEN Phase)
 *
 * These tests verify that the human module exports properly typed APIs
 * without any `any` types leaking through the public interface.
 *
 * Issue: do-igh [TS-4] Eliminate any in human module
 *
 * Fix implemented:
 * - EscalationConfig now has typed onEscalateHandler and onNotifyHandler properties
 * - EscalationChainItem includes optional typed handler references
 * - No more `as any` casts in escalation policy implementation
 *
 * All tests should PASS with the fix in place.
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  ApprovalRequest,
  ApprovalResponse,
  EscalationConfig,
  EscalationEvent,
  EscalationNotification,
  SLACheck,
  ReviewItem,
  NotificationResult,
  NotificationChannel,
  Priority,
} from '../../human/index'

import {
  ApprovalWorkflow,
  EscalationPolicy,
  SLATracker,
  ReviewQueue,
  NotificationDispatcher,
} from '../../human/index'

// ============================================================================
// Type-Level Tests: Verify No `any` Types Leak Through API
// ============================================================================

describe('Human Module Type Safety - No any Types', () => {
  describe('EscalationConfig type safety', () => {
    /**
     * This test verifies that EscalationConfig has properly typed callback properties.
     *
     * Current implementation stores callbacks as:
     *   (config as any)._onEscalate = handler
     *   (config as any)._onNotify = handler
     *
     * This should be replaced with proper typed properties on EscalationConfig.
     */
    it('should have typed onEscalate handler property accessible on config', () => {
      const policy = new EscalationPolicy()
      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('manager')
        .onEscalate((event) => {
          // The event parameter should be properly typed as EscalationEvent
          expectTypeOf(event).toEqualTypeOf<EscalationEvent>()
        })

      // The config should expose the handler in a typed way, not hidden as _onEscalate
      // This will fail because _onEscalate is not a proper property on EscalationConfig
      expect(config).toHaveProperty('onEscalateHandler')
      expectTypeOf(config).toHaveProperty('onEscalateHandler')
    })

    it('should have typed onNotify handler property accessible on config', () => {
      const policy = new EscalationPolicy()
      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('manager')
        .onNotify((notification) => {
          // The notification parameter should be properly typed as EscalationNotification
          expectTypeOf(notification).toEqualTypeOf<EscalationNotification>()
        })

      // The config should expose the handler in a typed way, not hidden as _onNotify
      // This will fail because _onNotify is not a proper property on EscalationConfig
      expect(config).toHaveProperty('onNotifyHandler')
      expectTypeOf(config).toHaveProperty('onNotifyHandler')
    })

    it('should preserve callback types through chaining without any casts', () => {
      const policy = new EscalationPolicy()

      // Define handlers with explicit types
      const escalateHandler = (event: EscalationEvent): void => {
        console.log(event.escalatedTo)
      }
      const notifyHandler = (notification: EscalationNotification): void => {
        console.log(notification.recipient)
      }

      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('manager')
        .escalateAfter('2 hours')
        .escalateTo('director')
        .onEscalate(escalateHandler)
        .onNotify(notifyHandler)

      // Both handlers should be retrievable with their original types
      // This tests that handlers are stored as proper typed properties
      expect(config).toHaveProperty('onEscalateHandler')
      expect(config).toHaveProperty('onNotifyHandler')

      // Type assertions that the handlers maintain their types
      // Handlers are now properly typed and accessible
      const retrievedEscalateHandler = config.onEscalateHandler
      const retrievedNotifyHandler = config.onNotifyHandler

      // Handlers should be defined (not undefined) since we set them
      expect(retrievedEscalateHandler).toBeDefined()
      expect(retrievedNotifyHandler).toBeDefined()

      // Type check that handlers have correct types (optional, may be undefined)
      expectTypeOf(retrievedEscalateHandler).toEqualTypeOf<
        ((event: EscalationEvent) => void | Promise<void>) | undefined
      >()
      expectTypeOf(retrievedNotifyHandler).toEqualTypeOf<
        ((notification: EscalationNotification) => void | Promise<void>) | undefined
      >()
    })
  })

  describe('EscalationConfig interface completeness', () => {
    it('EscalationConfig should declare handler properties in its interface', () => {
      // This test verifies the type definition includes handler storage properties
      // The current EscalationConfig interface is:
      //   duration: number
      //   target: string
      //   chain?: Array<{ duration: number; target: string }>
      //   escalateTo: ...
      //   escalateAfter: ...
      //   onEscalate: ...
      //   onNotify: ...
      //
      // It should also include:
      //   onEscalateHandler?: (event: EscalationEvent) => void | Promise<void>
      //   onNotifyHandler?: (notification: EscalationNotification) => void | Promise<void>

      type ExpectedEscalationConfig = {
        duration: number
        target: string
        chain?: Array<{ duration: number; target: string }>
        escalateTo: (target: string) => EscalationConfig
        escalateAfter: (duration: string) => EscalationConfig
        onEscalate: (handler: (event: EscalationEvent) => void | Promise<void>) => EscalationConfig
        onNotify: (
          handler: (notification: EscalationNotification) => void | Promise<void>
        ) => EscalationConfig
        // These should exist but currently don't:
        onEscalateHandler?: (event: EscalationEvent) => void | Promise<void>
        onNotifyHandler?: (notification: EscalationNotification) => void | Promise<void>
      }

      // This will fail until EscalationConfig includes the handler properties
      expectTypeOf<EscalationConfig>().toMatchTypeOf<ExpectedEscalationConfig>()
    })
  })

  describe('No any in internal implementation patterns', () => {
    /**
     * This test verifies that the track() method can access handlers without any casts.
     *
     * Current implementation in track():
     *   const onEscalate = (config as any)._onEscalate
     *   const onNotify = (config as any)._onNotify
     *
     * This should be:
     *   const onEscalate = config.onEscalateHandler
     *   const onNotify = config.onNotifyHandler
     */
    it('should be able to access handlers from config without any casts', async () => {
      const policy = new EscalationPolicy()
      let handlerWasCalled = false

      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('manager')
        .onEscalate(() => {
          handlerWasCalled = true
        })

      // The config should have a typed property we can check
      // This fails because the handler is stored as _onEscalate (untyped)
      expect('onEscalateHandler' in config).toBe(true)
      expect(typeof config.onEscalateHandler).toBe('function')
    })

    it('should store handlers in the escalation chain with proper types', () => {
      const policy = new EscalationPolicy()

      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('manager')
        .onEscalate((event) => {
          // Type should be inferred
          const _target: string = event.escalatedTo
        })
        .onNotify((notification) => {
          // Type should be inferred
          const _recipient: string = notification.recipient
        })

      // The chain items should have typed handler references
      // Chain items now include optional handler properties
      if (config.chain && config.chain.length > 0) {
        const chainItem = config.chain[0]
        // Chain items have optional handler references (set when onEscalate/onNotify are called)
        expect(chainItem).toHaveProperty('onEscalateHandler')
        expect(chainItem).toHaveProperty('onNotifyHandler')
      }
    })
  })

  describe('Type preservation through fluent API', () => {
    it('escalateAfter should return fully typed EscalationConfig', () => {
      const policy = new EscalationPolicy()
      const config = policy.escalateAfter('1 hour')

      // All methods should be available and typed
      expectTypeOf(config.escalateTo).toBeFunction()
      expectTypeOf(config.escalateAfter).toBeFunction()
      expectTypeOf(config.onEscalate).toBeFunction()
      expectTypeOf(config.onNotify).toBeFunction()

      // The config should have typed duration
      expectTypeOf(config.duration).toBeNumber()
    })

    it('escalateTo should maintain type through chain', () => {
      const policy = new EscalationPolicy()
      const config = policy.escalateAfter('1 hour').escalateTo('manager')

      expectTypeOf(config.target).toBeString()
      // Chain items now include optional handler properties
      expect(config.chain).toBeDefined()
      if (config.chain) {
        expect(config.chain.length).toBe(1)
        expect(config.chain[0]).toHaveProperty('duration')
        expect(config.chain[0]).toHaveProperty('target')
      }
    })

    it('onEscalate handler parameter should be strictly typed', () => {
      const policy = new EscalationPolicy()

      policy.escalateAfter('1 hour').escalateTo('manager').onEscalate((event) => {
        // All properties should be typed
        expectTypeOf(event.requestId).toBeString()
        expectTypeOf(event.escalatedTo).toBeString()
        expectTypeOf(event.reason).toBeString()
        expectTypeOf(event.escalatedAt).toEqualTypeOf<Date>()

        // Should not allow accessing undefined properties
        // @ts-expect-error - unknownProperty does not exist on EscalationEvent
        const _invalid = event.unknownProperty
      })
    })

    it('onNotify handler parameter should be strictly typed', () => {
      const policy = new EscalationPolicy()

      policy.escalateAfter('1 hour').escalateTo('manager').onNotify((notification) => {
        // All properties should be typed
        expectTypeOf(notification.recipient).toBeString()
        expectTypeOf(notification.type).toEqualTypeOf<'escalation' | 'assignment'>()
        expectTypeOf(notification.message).toBeString()

        // Should not allow accessing undefined properties
        // @ts-expect-error - unknownProperty does not exist on EscalationNotification
        const _invalid = notification.unknownProperty
      })
    })
  })

  describe('Return type consistency', () => {
    it('ApprovalWorkflow.request should return strongly typed ApprovalResponse', async () => {
      const workflow = new ApprovalWorkflow()
      const action: ApprovalRequest = {
        id: 'test-1',
        type: 'expense',
        title: 'Test',
        description: 'Test description',
        requestedBy: 'user@example.com',
        requestedAt: new Date(),
      }

      const response = await workflow.request(action, ['approver@example.com'])

      // All properties should be typed
      expectTypeOf(response.id).toBeString()
      expectTypeOf(response.status).toEqualTypeOf<
        'pending' | 'approved' | 'approved_at_level' | 'rejected'
      >()
      expectTypeOf(response.action).toEqualTypeOf<ApprovalRequest>()
      expectTypeOf(response.approvers).toEqualTypeOf<string[]>()
    })

    it('ReviewQueue.add should return strongly typed ReviewItem', async () => {
      const queue = new ReviewQueue()
      const item: ReviewItem = {
        id: 'item-1',
        type: 'review',
        title: 'Test Review',
        data: {},
        createdAt: new Date(),
      }

      const added = await queue.add(item)

      expectTypeOf(added.id).toBeString()
      expectTypeOf(added.type).toBeString()
      expectTypeOf(added.status).toEqualTypeOf<'pending' | 'claimed' | 'completed' | undefined>()
      expectTypeOf(added.priority).toEqualTypeOf<Priority | undefined>()
    })

    it('NotificationDispatcher.notify should return strongly typed NotificationResult', async () => {
      const dispatcher = new NotificationDispatcher()

      const result = await dispatcher.notify('user@example.com', 'email', {
        subject: 'Test',
        body: 'Test body',
      })

      expectTypeOf(result.id).toBeString()
      expectTypeOf(result.delivered).toBeBoolean()
      expectTypeOf(result.channel).toEqualTypeOf<NotificationChannel>()
      expectTypeOf(result.recipient).toBeString()
      expectTypeOf(result.sentAt).toEqualTypeOf<Date>()
    })

    it('SLATracker.check should return strongly typed SLACheck', () => {
      const sla = new SLATracker()
      sla.track('req-1', new Date(Date.now() + 3600000))

      const check = sla.check('req-1')

      expectTypeOf(check.requestId).toBeString()
      expectTypeOf(check.breached).toBeBoolean()
      expectTypeOf(check.remaining).toBeNumber()
      expectTypeOf(check.overdueBy).toEqualTypeOf<number | undefined>()
      expectTypeOf(check.percentageElapsed).toEqualTypeOf<number | undefined>()
    })
  })

  describe('Generic type preservation', () => {
    it('ReviewItem.data should be Record<string, unknown> not any', async () => {
      const queue = new ReviewQueue()
      const item: ReviewItem = {
        id: 'item-1',
        type: 'review',
        title: 'Test',
        data: { key: 'value', nested: { deep: true } },
        createdAt: new Date(),
      }

      const added = await queue.add(item)

      // data should be typed as Record<string, unknown>
      expectTypeOf(added.data).toEqualTypeOf<Record<string, unknown>>()

      // Accessing data properties should require type narrowing
      const value = added.data['key']
      expectTypeOf(value).toBeUnknown()
    })

    it('ApprovalRequest.metadata should be Record<string, unknown> not any', async () => {
      const workflow = new ApprovalWorkflow()
      const action: ApprovalRequest = {
        id: 'test-1',
        type: 'expense',
        title: 'Test',
        description: 'Test',
        requestedBy: 'user@example.com',
        requestedAt: new Date(),
        metadata: { custom: 'data' },
      }

      const response = await workflow.request(action, ['approver@example.com'])

      if (response.action.metadata) {
        expectTypeOf(response.action.metadata).toEqualTypeOf<Record<string, unknown>>()
        const value = response.action.metadata['custom']
        expectTypeOf(value).toBeUnknown()
      }
    })

    it('ReviewItem.decision should be Record<string, unknown> not any', async () => {
      const queue = new ReviewQueue()
      await queue.add({
        id: 'item-1',
        type: 'review',
        title: 'Test',
        data: {},
        createdAt: new Date(),
      })
      await queue.claim('reviewer@example.com')

      const completed = await queue.complete('item-1', { approved: true, notes: 'LGTM' })

      if (completed.decision) {
        expectTypeOf(completed.decision).toEqualTypeOf<Record<string, unknown>>()
        const value = completed.decision['approved']
        expectTypeOf(value).toBeUnknown()
      }
    })
  })

  describe('Callback type inference', () => {
    it('SLATracker configure callbacks should have proper parameter types', () => {
      const sla = new SLATracker()

      sla.configure({
        warningThreshold: 0.75,
        onWarning: (event) => {
          // Event should be properly typed
          expectTypeOf(event.requestId).toBeString()
          expectTypeOf(event.remaining).toBeNumber()
          expectTypeOf(event.threshold).toBeNumber()
        },
        criticalThreshold: 0.9,
        onCritical: (event) => {
          expectTypeOf(event.requestId).toBeString()
          expectTypeOf(event.remaining).toBeNumber()
          expectTypeOf(event.threshold).toBeNumber()
        },
        onBreach: (event) => {
          expectTypeOf(event.requestId).toBeString()
          expectTypeOf(event.overdueBy).toBeNumber()
        },
      })
    })
  })
})

// ============================================================================
// Runtime Tests: Verify Handlers Are Properly Stored and Accessible
// ============================================================================

describe('Human Module Runtime Type Safety', () => {
  describe('EscalationConfig handler storage', () => {
    it('should store onEscalate handler in a typed property', () => {
      const policy = new EscalationPolicy()
      const handler = (event: EscalationEvent): void => {
        console.log(event)
      }

      const config = policy.escalateAfter('1 hour').escalateTo('manager').onEscalate(handler)

      // This test will fail because the current implementation stores
      // the handler as (config as any)._onEscalate instead of a proper typed property
      expect(Object.keys(config)).toContain('onEscalateHandler')
    })

    it('should store onNotify handler in a typed property', () => {
      const policy = new EscalationPolicy()
      const handler = (notification: EscalationNotification): void => {
        console.log(notification)
      }

      const config = policy.escalateAfter('1 hour').escalateTo('manager').onNotify(handler)

      // This test will fail because the current implementation stores
      // the handler as (config as any)._onNotify instead of a proper typed property
      expect(Object.keys(config)).toContain('onNotifyHandler')
    })

    it('handlers should be accessible without type coercion', () => {
      const policy = new EscalationPolicy()

      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('manager')
        .onEscalate(() => {
          // Handler is set
        })
        .onNotify(() => {
          // Handler is set
        })

      // Access handlers through typed properties (now works with proper types)
      const escalateHandler = config.onEscalateHandler
      const notifyHandler = config.onNotifyHandler

      expect(typeof escalateHandler).toBe('function')
      expect(typeof notifyHandler).toBe('function')
    })
  })

  describe('No underscore-prefixed private properties exposed', () => {
    it('EscalationConfig should not have _onEscalate property', () => {
      const policy = new EscalationPolicy()
      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('manager')
        .onEscalate(() => {})

      // The implementation currently uses _onEscalate (underscore prefix)
      // which is a code smell indicating improper typing
      // This test will fail because _onEscalate exists
      expect(Object.keys(config)).not.toContain('_onEscalate')
    })

    it('EscalationConfig should not have _onNotify property', () => {
      const policy = new EscalationPolicy()
      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('manager')
        .onNotify(() => {})

      // The implementation currently uses _onNotify (underscore prefix)
      // which is a code smell indicating improper typing
      // This test will fail because _onNotify exists
      expect(Object.keys(config)).not.toContain('_onNotify')
    })
  })

  describe('Type narrowing preserves types', () => {
    it('approval status type narrowing should work correctly', async () => {
      const workflow = new ApprovalWorkflow()
      const action: ApprovalRequest = {
        id: 'test-1',
        type: 'expense',
        title: 'Test',
        description: 'Test',
        requestedBy: 'user@example.com',
        requestedAt: new Date(),
      }

      const response = await workflow.request(action, ['approver@example.com'])

      if (response.status === 'approved') {
        // These should be defined when status is 'approved'
        expect(response.approvedBy).toBeDefined()
        expect(response.approvedAt).toBeDefined()
        expect(response.completedAt).toBeDefined()
      }

      if (response.status === 'rejected') {
        // These should be defined when status is 'rejected'
        expect(response.rejectedBy).toBeDefined()
        expect(response.rejectedAt).toBeDefined()
        expect(response.rejectionReason).toBeDefined()
      }
    })

    it('review item status type narrowing should work correctly', async () => {
      const queue = new ReviewQueue()
      await queue.add({
        id: 'item-1',
        type: 'review',
        title: 'Test',
        data: {},
        createdAt: new Date(),
      })

      const item = await queue.get('item-1')

      if (item && item.status === 'claimed') {
        expect(item.claimedBy).toBeDefined()
        expect(item.claimedAt).toBeDefined()
      }

      if (item && item.status === 'completed') {
        expect(item.completedAt).toBeDefined()
        expect(item.decision).toBeDefined()
      }
    })
  })
})
