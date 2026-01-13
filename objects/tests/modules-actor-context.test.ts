/**
 * ActorContextModule Unit Tests
 *
 * Tests for the extracted ActorContextModule from DOBase.
 * Verifies:
 * - Actor lifecycle (set, get, clear)
 * - Actor context management (userId, orgId)
 * - Actor format validation
 * - Helper properties (hasActor, hasUserId, hasOrgId)
 *
 * Part of Phase 1 DOBase decomposition (low-risk extractions).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ActorContextModule, type ActorContext } from '../modules/ActorContextModule'

// ============================================================================
// TEST SUITE: ActorContextModule
// ============================================================================

describe('ActorContextModule', () => {
  let actorModule: ActorContextModule

  beforeEach(() => {
    actorModule = new ActorContextModule()
  })

  // ==========================================================================
  // CONSTRUCTOR AND INITIALIZATION TESTS
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance', () => {
      expect(actorModule).toBeDefined()
      expect(actorModule).toBeInstanceOf(ActorContextModule)
    })

    it('should start with empty actor', () => {
      expect(actorModule.getCurrentActor()).toBe('')
      expect(actorModule.hasActor).toBe(false)
    })

    it('should start with empty actor context', () => {
      const context = actorModule.getActorContext()
      expect(context).toEqual({})
      expect(actorModule.hasUserId).toBe(false)
      expect(actorModule.hasOrgId).toBe(false)
    })
  })

  // ==========================================================================
  // ACTOR MANAGEMENT TESTS
  // ==========================================================================

  describe('actor management', () => {
    describe('setActor', () => {
      it('should set actor string', () => {
        actorModule.setActor('Human/nathan')
        expect(actorModule.getCurrentActor()).toBe('Human/nathan')
      })

      it('should set Human actor type', () => {
        actorModule.setActor('Human/user-123')
        expect(actorModule.getCurrentActor()).toBe('Human/user-123')
        expect(actorModule.hasActor).toBe(true)
      })

      it('should set Agent actor type', () => {
        actorModule.setActor('Agent/support-bot')
        expect(actorModule.getCurrentActor()).toBe('Agent/support-bot')
        expect(actorModule.hasActor).toBe(true)
      })

      it('should set Service actor type', () => {
        actorModule.setActor('Service/billing')
        expect(actorModule.getCurrentActor()).toBe('Service/billing')
        expect(actorModule.hasActor).toBe(true)
      })

      it('should set API actor type', () => {
        actorModule.setActor('API/key-abc123')
        expect(actorModule.getCurrentActor()).toBe('API/key-abc123')
        expect(actorModule.hasActor).toBe(true)
      })

      it('should overwrite previous actor', () => {
        actorModule.setActor('Human/alice')
        expect(actorModule.getCurrentActor()).toBe('Human/alice')

        actorModule.setActor('Human/bob')
        expect(actorModule.getCurrentActor()).toBe('Human/bob')
      })

      it('should accept email-like actor ids', () => {
        actorModule.setActor('Human/nathan@example.com')
        expect(actorModule.getCurrentActor()).toBe('Human/nathan@example.com')
      })

      it('should accept UUID actor ids', () => {
        actorModule.setActor('Human/550e8400-e29b-41d4-a716-446655440000')
        expect(actorModule.getCurrentActor()).toBe('Human/550e8400-e29b-41d4-a716-446655440000')
      })

      it('should accept empty string actor', () => {
        actorModule.setActor('Human/test')
        actorModule.setActor('')
        expect(actorModule.getCurrentActor()).toBe('')
        expect(actorModule.hasActor).toBe(false)
      })

      it('should accept actor with special characters', () => {
        actorModule.setActor('Agent/claude-3.5-sonnet')
        expect(actorModule.getCurrentActor()).toBe('Agent/claude-3.5-sonnet')
      })
    })

    describe('clearActor', () => {
      it('should clear the current actor', () => {
        actorModule.setActor('Human/nathan')
        expect(actorModule.hasActor).toBe(true)

        actorModule.clearActor()
        expect(actorModule.getCurrentActor()).toBe('')
        expect(actorModule.hasActor).toBe(false)
      })

      it('should be safe to call when actor is already empty', () => {
        actorModule.clearActor()
        expect(actorModule.getCurrentActor()).toBe('')
        expect(actorModule.hasActor).toBe(false)
      })

      it('should be safe to call multiple times', () => {
        actorModule.setActor('Human/test')
        actorModule.clearActor()
        actorModule.clearActor()
        actorModule.clearActor()
        expect(actorModule.getCurrentActor()).toBe('')
      })
    })

    describe('getCurrentActor', () => {
      it('should return empty string by default', () => {
        expect(actorModule.getCurrentActor()).toBe('')
      })

      it('should return current actor after setActor', () => {
        actorModule.setActor('Service/payment')
        expect(actorModule.getCurrentActor()).toBe('Service/payment')
      })

      it('should return empty string after clearActor', () => {
        actorModule.setActor('Human/admin')
        actorModule.clearActor()
        expect(actorModule.getCurrentActor()).toBe('')
      })
    })

    describe('hasActor', () => {
      it('should be false by default', () => {
        expect(actorModule.hasActor).toBe(false)
      })

      it('should be true after setActor with non-empty string', () => {
        actorModule.setActor('Human/test')
        expect(actorModule.hasActor).toBe(true)
      })

      it('should be false after setActor with empty string', () => {
        actorModule.setActor('')
        expect(actorModule.hasActor).toBe(false)
      })

      it('should be false after clearActor', () => {
        actorModule.setActor('Human/test')
        actorModule.clearActor()
        expect(actorModule.hasActor).toBe(false)
      })
    })
  })

  // ==========================================================================
  // ACTOR CONTEXT MANAGEMENT TESTS
  // ==========================================================================

  describe('actor context management', () => {
    describe('setActorContext', () => {
      it('should set userId only', () => {
        actorModule.setActorContext({ userId: 'usr_123' })

        expect(actorModule.getActorContext()).toEqual({ userId: 'usr_123' })
        expect(actorModule.hasUserId).toBe(true)
        expect(actorModule.hasOrgId).toBe(false)
      })

      it('should set orgId only', () => {
        actorModule.setActorContext({ orgId: 'org_456' })

        expect(actorModule.getActorContext()).toEqual({ orgId: 'org_456' })
        expect(actorModule.hasUserId).toBe(false)
        expect(actorModule.hasOrgId).toBe(true)
      })

      it('should set both userId and orgId', () => {
        actorModule.setActorContext({ userId: 'usr_123', orgId: 'org_456' })

        expect(actorModule.getActorContext()).toEqual({
          userId: 'usr_123',
          orgId: 'org_456',
        })
        expect(actorModule.hasUserId).toBe(true)
        expect(actorModule.hasOrgId).toBe(true)
      })

      it('should replace entire context (not merge)', () => {
        actorModule.setActorContext({ userId: 'usr_123', orgId: 'org_456' })
        actorModule.setActorContext({ userId: 'usr_789' })

        // orgId should be undefined now (full replacement)
        const context = actorModule.getActorContext()
        expect(context.userId).toBe('usr_789')
        expect(context.orgId).toBeUndefined()
      })

      it('should accept empty context object', () => {
        actorModule.setActorContext({ userId: 'usr_123' })
        actorModule.setActorContext({})

        expect(actorModule.getActorContext()).toEqual({})
        expect(actorModule.hasUserId).toBe(false)
        expect(actorModule.hasOrgId).toBe(false)
      })
    })

    describe('getActorContext', () => {
      it('should return empty object by default', () => {
        expect(actorModule.getActorContext()).toEqual({})
      })

      it('should return current context', () => {
        actorModule.setActorContext({ userId: 'usr_abc', orgId: 'org_xyz' })
        expect(actorModule.getActorContext()).toEqual({
          userId: 'usr_abc',
          orgId: 'org_xyz',
        })
      })

      it('should return reference to internal context (not clone)', () => {
        // This tests implementation detail - context returns reference
        const context1 = actorModule.getActorContext()
        const context2 = actorModule.getActorContext()
        expect(context1).toBe(context2)
      })
    })

    describe('clearActorContext', () => {
      it('should clear the context', () => {
        actorModule.setActorContext({ userId: 'usr_123', orgId: 'org_456' })
        actorModule.clearActorContext()

        expect(actorModule.getActorContext()).toEqual({})
        expect(actorModule.hasUserId).toBe(false)
        expect(actorModule.hasOrgId).toBe(false)
      })

      it('should be safe to call when context is already empty', () => {
        actorModule.clearActorContext()
        expect(actorModule.getActorContext()).toEqual({})
      })

      it('should be safe to call multiple times', () => {
        actorModule.setActorContext({ userId: 'usr_123' })
        actorModule.clearActorContext()
        actorModule.clearActorContext()
        actorModule.clearActorContext()
        expect(actorModule.getActorContext()).toEqual({})
      })
    })

    describe('userId property', () => {
      it('should return undefined by default', () => {
        expect(actorModule.userId).toBeUndefined()
      })

      it('should return userId when set', () => {
        actorModule.setActorContext({ userId: 'usr_123' })
        expect(actorModule.userId).toBe('usr_123')
      })

      it('should return undefined after clearActorContext', () => {
        actorModule.setActorContext({ userId: 'usr_123' })
        actorModule.clearActorContext()
        expect(actorModule.userId).toBeUndefined()
      })
    })

    describe('orgId property', () => {
      it('should return undefined by default', () => {
        expect(actorModule.orgId).toBeUndefined()
      })

      it('should return orgId when set', () => {
        actorModule.setActorContext({ orgId: 'org_456' })
        expect(actorModule.orgId).toBe('org_456')
      })

      it('should return undefined after clearActorContext', () => {
        actorModule.setActorContext({ orgId: 'org_456' })
        actorModule.clearActorContext()
        expect(actorModule.orgId).toBeUndefined()
      })
    })

    describe('hasUserId property', () => {
      it('should be false by default', () => {
        expect(actorModule.hasUserId).toBe(false)
      })

      it('should be true when userId is set', () => {
        actorModule.setActorContext({ userId: 'usr_123' })
        expect(actorModule.hasUserId).toBe(true)
      })

      it('should be false when only orgId is set', () => {
        actorModule.setActorContext({ orgId: 'org_456' })
        expect(actorModule.hasUserId).toBe(false)
      })

      it('should be false after clearActorContext', () => {
        actorModule.setActorContext({ userId: 'usr_123' })
        actorModule.clearActorContext()
        expect(actorModule.hasUserId).toBe(false)
      })
    })

    describe('hasOrgId property', () => {
      it('should be false by default', () => {
        expect(actorModule.hasOrgId).toBe(false)
      })

      it('should be true when orgId is set', () => {
        actorModule.setActorContext({ orgId: 'org_456' })
        expect(actorModule.hasOrgId).toBe(true)
      })

      it('should be false when only userId is set', () => {
        actorModule.setActorContext({ userId: 'usr_123' })
        expect(actorModule.hasOrgId).toBe(false)
      })

      it('should be false after clearActorContext', () => {
        actorModule.setActorContext({ orgId: 'org_456' })
        actorModule.clearActorContext()
        expect(actorModule.hasOrgId).toBe(false)
      })
    })
  })

  // ==========================================================================
  // CLEAR ALL TESTS
  // ==========================================================================

  describe('clearAll', () => {
    it('should clear both actor and context', () => {
      actorModule.setActor('Human/nathan')
      actorModule.setActorContext({ userId: 'usr_123', orgId: 'org_456' })

      actorModule.clearAll()

      expect(actorModule.getCurrentActor()).toBe('')
      expect(actorModule.hasActor).toBe(false)
      expect(actorModule.getActorContext()).toEqual({})
      expect(actorModule.hasUserId).toBe(false)
      expect(actorModule.hasOrgId).toBe(false)
    })

    it('should be safe to call when everything is already empty', () => {
      actorModule.clearAll()

      expect(actorModule.getCurrentActor()).toBe('')
      expect(actorModule.getActorContext()).toEqual({})
    })

    it('should clear actor but leave context if only actor is set', () => {
      actorModule.setActor('Agent/test')

      actorModule.clearAll()

      expect(actorModule.hasActor).toBe(false)
      expect(actorModule.getActorContext()).toEqual({})
    })

    it('should clear context but leave actor if only context is set', () => {
      actorModule.setActorContext({ userId: 'usr_123' })

      actorModule.clearAll()

      expect(actorModule.getCurrentActor()).toBe('')
      expect(actorModule.hasUserId).toBe(false)
    })
  })

  // ==========================================================================
  // ISOLATION TESTS
  // ==========================================================================

  describe('isolation', () => {
    it('should allow independent actor and context management', () => {
      // Set actor without context
      actorModule.setActor('Human/nathan')
      expect(actorModule.hasActor).toBe(true)
      expect(actorModule.hasUserId).toBe(false)

      // Set context without affecting actor
      actorModule.setActorContext({ userId: 'usr_123' })
      expect(actorModule.hasActor).toBe(true)
      expect(actorModule.hasUserId).toBe(true)

      // Clear actor without affecting context
      actorModule.clearActor()
      expect(actorModule.hasActor).toBe(false)
      expect(actorModule.hasUserId).toBe(true)

      // Clear context without affecting actor (it's already empty, just verify)
      actorModule.setActor('Agent/bot')
      actorModule.clearActorContext()
      expect(actorModule.hasActor).toBe(true)
      expect(actorModule.hasUserId).toBe(false)
    })

    it('should support simulated request lifecycle', () => {
      // Simulate request 1
      actorModule.setActor('Human/alice')
      actorModule.setActorContext({ userId: 'alice_id', orgId: 'org_1' })
      expect(actorModule.getCurrentActor()).toBe('Human/alice')
      expect(actorModule.userId).toBe('alice_id')

      // End request 1
      actorModule.clearAll()

      // Simulate request 2
      actorModule.setActor('Human/bob')
      actorModule.setActorContext({ userId: 'bob_id', orgId: 'org_2' })
      expect(actorModule.getCurrentActor()).toBe('Human/bob')
      expect(actorModule.userId).toBe('bob_id')

      // End request 2
      actorModule.clearAll()

      // Verify fully reset
      expect(actorModule.hasActor).toBe(false)
      expect(actorModule.hasUserId).toBe(false)
      expect(actorModule.hasOrgId).toBe(false)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle undefined userId in context', () => {
      actorModule.setActorContext({ userId: undefined, orgId: 'org_123' })
      expect(actorModule.hasUserId).toBe(false)
      expect(actorModule.hasOrgId).toBe(true)
    })

    it('should handle undefined orgId in context', () => {
      actorModule.setActorContext({ userId: 'usr_123', orgId: undefined })
      expect(actorModule.hasUserId).toBe(true)
      expect(actorModule.hasOrgId).toBe(false)
    })

    it('should handle actor with forward slashes in id', () => {
      actorModule.setActor('Human/users/nathan/profile')
      expect(actorModule.getCurrentActor()).toBe('Human/users/nathan/profile')
    })

    it('should handle very long actor strings', () => {
      const longId = 'a'.repeat(1000)
      actorModule.setActor(`Human/${longId}`)
      expect(actorModule.getCurrentActor()).toBe(`Human/${longId}`)
    })

    it('should handle very long userId/orgId', () => {
      const longId = 'x'.repeat(1000)
      actorModule.setActorContext({ userId: longId, orgId: longId })
      expect(actorModule.userId).toBe(longId)
      expect(actorModule.orgId).toBe(longId)
    })
  })
})
