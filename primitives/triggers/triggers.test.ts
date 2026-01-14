/**
 * Trigger Registry Tests
 *
 * Tests for the TriggerRegistry primitive covering:
 * - Registration and unregistration
 * - Lookup operations (get, has)
 * - Listing with filters
 * - Enable/disable functionality
 * - Statistics and counting
 * - Handler execution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TriggerRegistry,
  createTriggerRegistry,
  type Trigger,
  type TriggerContext,
  type TriggerResult,
  type TriggerType,
} from './index'

describe('TriggerRegistry', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    registry = new TriggerRegistry()
  })

  // ===========================================================================
  // Registration Tests
  // ===========================================================================

  describe('register', () => {
    it('should register a trigger', () => {
      registry.register({
        id: 'test-trigger',
        type: 'webhook',
        config: { path: '/webhook' },
        handler: async () => ({ success: true }),
      })

      expect(registry.has('test-trigger')).toBe(true)
    })

    it('should register trigger with all properties', () => {
      const now = Date.now()
      registry.register({
        id: 'full-trigger',
        type: 'polling',
        config: { url: 'https://api.example.com', intervalMs: 60000 },
        enabled: true,
        status: 'active',
        description: 'A test trigger',
        tags: ['test', 'polling'],
        handler: async () => ({ success: true }),
      })

      const trigger = registry.get('full-trigger')
      expect(trigger).toBeDefined()
      expect(trigger?.type).toBe('polling')
      expect(trigger?.enabled).toBe(true)
      expect(trigger?.description).toBe('A test trigger')
      expect(trigger?.tags).toEqual(['test', 'polling'])
      expect(trigger?.createdAt).toBeGreaterThanOrEqual(now)
    })

    it('should throw when registering duplicate ID', () => {
      registry.register({
        id: 'duplicate',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })

      expect(() => {
        registry.register({
          id: 'duplicate',
          type: 'event',
          config: {},
          handler: async () => ({ success: true }),
        })
      }).toThrow(/already registered/i)
    })

    it('should default enabled to true', () => {
      registry.register({
        id: 'default-enabled',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })

      const trigger = registry.get('default-enabled')
      expect(trigger?.enabled).toBe(true)
    })

    it('should default status to active', () => {
      registry.register({
        id: 'default-status',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })

      const trigger = registry.get('default-status')
      expect(trigger?.status).toBe('active')
    })

    it('should set createdAt and updatedAt timestamps', () => {
      const before = Date.now()
      registry.register({
        id: 'timestamped',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })
      const after = Date.now()

      const trigger = registry.get('timestamped')
      expect(trigger?.createdAt).toBeGreaterThanOrEqual(before)
      expect(trigger?.createdAt).toBeLessThanOrEqual(after)
      expect(trigger?.updatedAt).toBeGreaterThanOrEqual(before)
      expect(trigger?.updatedAt).toBeLessThanOrEqual(after)
    })
  })

  // ===========================================================================
  // Unregistration Tests
  // ===========================================================================

  describe('unregister', () => {
    it('should unregister a trigger', () => {
      registry.register({
        id: 'to-remove',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })

      const result = registry.unregister('to-remove')

      expect(result).toBe(true)
      expect(registry.has('to-remove')).toBe(false)
    })

    it('should return false when unregistering non-existent trigger', () => {
      const result = registry.unregister('non-existent')
      expect(result).toBe(false)
    })

    it('should not affect other triggers', () => {
      registry.register({
        id: 'trigger-1',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 'trigger-2',
        type: 'event',
        config: {},
        handler: async () => ({ success: true }),
      })

      registry.unregister('trigger-1')

      expect(registry.has('trigger-1')).toBe(false)
      expect(registry.has('trigger-2')).toBe(true)
    })
  })

  // ===========================================================================
  // Lookup Tests
  // ===========================================================================

  describe('get', () => {
    it('should get trigger by ID', () => {
      registry.register({
        id: 'lookup-test',
        type: 'schedule',
        config: { cron: '0 9 * * *' },
        handler: async () => ({ success: true }),
      })

      const trigger = registry.get('lookup-test')

      expect(trigger).toBeDefined()
      expect(trigger?.id).toBe('lookup-test')
      expect(trigger?.type).toBe('schedule')
      expect(trigger?.config.cron).toBe('0 9 * * *')
    })

    it('should return undefined for non-existent ID', () => {
      const trigger = registry.get('non-existent')
      expect(trigger).toBeUndefined()
    })
  })

  describe('has', () => {
    it('should return true for existing trigger', () => {
      registry.register({
        id: 'exists',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })

      expect(registry.has('exists')).toBe(true)
    })

    it('should return false for non-existent trigger', () => {
      expect(registry.has('does-not-exist')).toBe(false)
    })
  })

  // ===========================================================================
  // List Tests
  // ===========================================================================

  describe('list', () => {
    beforeEach(() => {
      // Setup test triggers
      registry.register({
        id: 'webhook-1',
        type: 'webhook',
        config: { path: '/hook1' },
        enabled: true,
        status: 'active',
        tags: ['api', 'production'],
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 'webhook-2',
        type: 'webhook',
        config: { path: '/hook2' },
        enabled: false,
        status: 'inactive',
        tags: ['api'],
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 'polling-1',
        type: 'polling',
        config: { url: 'https://api.example.com', intervalMs: 60000 },
        enabled: true,
        status: 'active',
        tags: ['production'],
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 'event-1',
        type: 'event',
        config: { eventName: 'user.created' },
        enabled: true,
        status: 'error',
        handler: async () => ({ success: true }),
      })
    })

    it('should list all triggers', () => {
      const triggers = registry.list()
      expect(triggers).toHaveLength(4)
    })

    it('should filter by type', () => {
      const webhooks = registry.list({ type: 'webhook' })
      expect(webhooks).toHaveLength(2)
      expect(webhooks.every((t) => t.type === 'webhook')).toBe(true)
    })

    it('should filter by enabled status', () => {
      const enabled = registry.list({ enabled: true })
      expect(enabled).toHaveLength(3)
      expect(enabled.every((t) => t.enabled === true)).toBe(true)
    })

    it('should filter by status', () => {
      const active = registry.list({ status: 'active' })
      expect(active).toHaveLength(2)
      expect(active.every((t) => t.status === 'active')).toBe(true)
    })

    it('should filter by tags', () => {
      const production = registry.list({ tags: ['production'] })
      expect(production).toHaveLength(2)

      const apiProduction = registry.list({ tags: ['api', 'production'] })
      expect(apiProduction).toHaveLength(1)
      expect(apiProduction[0].id).toBe('webhook-1')
    })

    it('should apply limit', () => {
      const limited = registry.list({ limit: 2 })
      expect(limited).toHaveLength(2)
    })

    it('should apply offset', () => {
      const offset = registry.list({ offset: 2 })
      expect(offset).toHaveLength(2)
    })

    it('should apply limit and offset together', () => {
      const paginated = registry.list({ limit: 1, offset: 1 })
      expect(paginated).toHaveLength(1)
    })

    it('should combine multiple filters', () => {
      const filtered = registry.list({
        type: 'webhook',
        enabled: true,
        status: 'active',
      })
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('webhook-1')
    })
  })

  describe('listByType', () => {
    it('should list triggers of specific type', () => {
      registry.register({
        id: 'w1',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 'p1',
        type: 'polling',
        config: { url: 'http://example.com', intervalMs: 1000 },
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 'w2',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })

      const webhooks = registry.listByType('webhook')
      expect(webhooks).toHaveLength(2)
      expect(webhooks.map((t) => t.id)).toEqual(['w1', 'w2'])
    })
  })

  describe('listEnabled / listDisabled', () => {
    it('should list only enabled triggers', () => {
      registry.register({
        id: 'enabled-1',
        type: 'webhook',
        config: {},
        enabled: true,
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 'disabled-1',
        type: 'webhook',
        config: {},
        enabled: false,
        handler: async () => ({ success: true }),
      })

      const enabled = registry.listEnabled()
      expect(enabled).toHaveLength(1)
      expect(enabled[0].id).toBe('enabled-1')
    })

    it('should list only disabled triggers', () => {
      registry.register({
        id: 'enabled-1',
        type: 'webhook',
        config: {},
        enabled: true,
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 'disabled-1',
        type: 'webhook',
        config: {},
        enabled: false,
        handler: async () => ({ success: true }),
      })

      const disabled = registry.listDisabled()
      expect(disabled).toHaveLength(1)
      expect(disabled[0].id).toBe('disabled-1')
    })
  })

  // ===========================================================================
  // Enable/Disable Tests
  // ===========================================================================

  describe('enable / disable', () => {
    it('should enable a disabled trigger', () => {
      registry.register({
        id: 'toggle-test',
        type: 'webhook',
        config: {},
        enabled: false,
        handler: async () => ({ success: true }),
      })

      const result = registry.enable('toggle-test')

      expect(result).toBe(true)
      expect(registry.get('toggle-test')?.enabled).toBe(true)
    })

    it('should disable an enabled trigger', () => {
      registry.register({
        id: 'toggle-test',
        type: 'webhook',
        config: {},
        enabled: true,
        handler: async () => ({ success: true }),
      })

      const result = registry.disable('toggle-test')

      expect(result).toBe(true)
      expect(registry.get('toggle-test')?.enabled).toBe(false)
    })

    it('should return false when enabling non-existent trigger', () => {
      const result = registry.enable('non-existent')
      expect(result).toBe(false)
    })

    it('should return false when disabling non-existent trigger', () => {
      const result = registry.disable('non-existent')
      expect(result).toBe(false)
    })

    it('should update updatedAt when enabling', () => {
      registry.register({
        id: 'toggle-test',
        type: 'webhook',
        config: {},
        enabled: false,
        handler: async () => ({ success: true }),
      })
      const before = registry.get('toggle-test')?.updatedAt ?? 0

      // Small delay to ensure timestamp difference
      const waitTime = 10
      vi.useFakeTimers()
      vi.advanceTimersByTime(waitTime)

      registry.enable('toggle-test')

      const after = registry.get('toggle-test')?.updatedAt ?? 0
      expect(after).toBeGreaterThan(before)

      vi.useRealTimers()
    })
  })

  // ===========================================================================
  // Status Tests
  // ===========================================================================

  describe('setStatus', () => {
    it('should update trigger status', () => {
      registry.register({
        id: 'status-test',
        type: 'webhook',
        config: {},
        status: 'active',
        handler: async () => ({ success: true }),
      })

      const result = registry.setStatus('status-test', 'error')

      expect(result).toBe(true)
      expect(registry.get('status-test')?.status).toBe('error')
    })

    it('should return false for non-existent trigger', () => {
      const result = registry.setStatus('non-existent', 'error')
      expect(result).toBe(false)
    })
  })

  // ===========================================================================
  // Update Tests
  // ===========================================================================

  describe('update', () => {
    it('should update trigger properties', () => {
      registry.register({
        id: 'update-test',
        type: 'webhook',
        config: { path: '/old' },
        description: 'Old description',
        handler: async () => ({ success: true }),
      })

      const updated = registry.update('update-test', {
        config: { path: '/new' },
        description: 'New description',
        tags: ['updated'],
      })

      expect(updated).toBeDefined()
      expect(updated?.config.path).toBe('/new')
      expect(updated?.description).toBe('New description')
      expect(updated?.tags).toEqual(['updated'])
    })

    it('should preserve id and createdAt', () => {
      registry.register({
        id: 'preserve-test',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })

      const original = registry.get('preserve-test')
      const originalCreatedAt = original?.createdAt

      registry.update('preserve-test', { description: 'Updated' })

      const updated = registry.get('preserve-test')
      expect(updated?.id).toBe('preserve-test')
      expect(updated?.createdAt).toBe(originalCreatedAt)
    })

    it('should return undefined for non-existent trigger', () => {
      const result = registry.update('non-existent', { description: 'test' })
      expect(result).toBeUndefined()
    })
  })

  // ===========================================================================
  // Count and Stats Tests
  // ===========================================================================

  describe('count', () => {
    it('should return the number of triggers', () => {
      expect(registry.count()).toBe(0)

      registry.register({
        id: 't1',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })
      expect(registry.count()).toBe(1)

      registry.register({
        id: 't2',
        type: 'event',
        config: {},
        handler: async () => ({ success: true }),
      })
      expect(registry.count()).toBe(2)

      registry.unregister('t1')
      expect(registry.count()).toBe(1)
    })
  })

  describe('stats', () => {
    it('should return registry statistics', () => {
      registry.register({
        id: 'w1',
        type: 'webhook',
        config: {},
        enabled: true,
        status: 'active',
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 'w2',
        type: 'webhook',
        config: {},
        enabled: false,
        status: 'inactive',
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 'p1',
        type: 'polling',
        config: { url: 'http://example.com', intervalMs: 1000 },
        enabled: true,
        status: 'error',
        handler: async () => ({ success: true }),
      })

      const stats = registry.stats()

      expect(stats.total).toBe(3)
      expect(stats.enabled).toBe(2)
      expect(stats.disabled).toBe(1)
      expect(stats.byType.webhook).toBe(2)
      expect(stats.byType.polling).toBe(1)
      expect(stats.byType.event).toBe(0)
      expect(stats.byStatus.active).toBe(1)
      expect(stats.byStatus.inactive).toBe(1)
      expect(stats.byStatus.error).toBe(1)
    })
  })

  // ===========================================================================
  // Clear and IDs Tests
  // ===========================================================================

  describe('clear', () => {
    it('should remove all triggers', () => {
      registry.register({
        id: 't1',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 't2',
        type: 'event',
        config: {},
        handler: async () => ({ success: true }),
      })

      registry.clear()

      expect(registry.count()).toBe(0)
      expect(registry.list()).toEqual([])
    })
  })

  describe('ids', () => {
    it('should return all trigger IDs', () => {
      registry.register({
        id: 'alpha',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })
      registry.register({
        id: 'beta',
        type: 'event',
        config: {},
        handler: async () => ({ success: true }),
      })

      const ids = registry.ids()

      expect(ids).toContain('alpha')
      expect(ids).toContain('beta')
      expect(ids).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Execution Tests
  // ===========================================================================

  describe('execute', () => {
    it('should execute trigger handler', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true, data: { processed: true } })

      registry.register({
        id: 'exec-test',
        type: 'webhook',
        config: {},
        handler,
      })

      const result = await registry.execute('exec-test', { input: 'data' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerId: 'exec-test',
          triggerType: 'webhook',
          data: { input: 'data' },
        })
      )
      expect(result).toEqual({ success: true, data: { processed: true } })
    })

    it('should return undefined for non-existent trigger', async () => {
      const result = await registry.execute('non-existent', {})
      expect(result).toBeUndefined()
    })

    it('should return error for disabled trigger', async () => {
      registry.register({
        id: 'disabled-exec',
        type: 'webhook',
        config: {},
        enabled: false,
        handler: async () => ({ success: true }),
      })

      const result = await registry.execute('disabled-exec', {})

      expect(result?.success).toBe(false)
      expect(result?.error).toMatch(/disabled/i)
    })

    it('should catch handler errors', async () => {
      registry.register({
        id: 'error-test',
        type: 'webhook',
        config: {},
        handler: async () => {
          throw new Error('Handler failed!')
        },
      })

      const result = await registry.execute('error-test', {})

      expect(result?.success).toBe(false)
      expect(result?.error).toBe('Handler failed!')
    })

    it('should pass metadata from config', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      registry.register({
        id: 'metadata-test',
        type: 'webhook',
        config: {
          metadata: { source: 'github', version: '1.0' },
        },
        handler,
      })

      await registry.execute('metadata-test', {})

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { source: 'github', version: '1.0' },
        })
      )
    })
  })

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('createTriggerRegistry', () => {
    it('should create a new registry instance', () => {
      const registry = createTriggerRegistry()

      expect(registry).toBeInstanceOf(TriggerRegistry)
      expect(registry.count()).toBe(0)
    })

    it('should create independent instances', () => {
      const registry1 = createTriggerRegistry()
      const registry2 = createTriggerRegistry()

      registry1.register({
        id: 'only-in-1',
        type: 'webhook',
        config: {},
        handler: async () => ({ success: true }),
      })

      expect(registry1.has('only-in-1')).toBe(true)
      expect(registry2.has('only-in-1')).toBe(false)
    })
  })

  // ===========================================================================
  // Type-specific Tests
  // ===========================================================================

  describe('trigger types', () => {
    const triggerTypes: TriggerType[] = ['webhook', 'polling', 'schedule', 'event', 'manual']

    it.each(triggerTypes)('should support %s type', (type) => {
      registry.register({
        id: `${type}-trigger`,
        type,
        config: {},
        handler: async () => ({ success: true }),
      })

      const trigger = registry.get(`${type}-trigger`)
      expect(trigger?.type).toBe(type)
    })
  })
})
