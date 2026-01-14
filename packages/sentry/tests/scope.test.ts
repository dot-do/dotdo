/**
 * @dotdo/sentry - Scope Tests
 *
 * RED phase: Tests for scope functionality
 * - Scope class methods
 * - Scope cloning
 * - Event application
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Scope } from '../src/scope.js'
import type { SentryEvent } from '../src/types.js'

describe('@dotdo/sentry - Scope', () => {
  let scope: Scope

  beforeEach(() => {
    scope = new Scope()
  })

  describe('User', () => {
    it('should set and get user', () => {
      scope.setUser({ id: 'user-1', email: 'test@example.com' })

      expect(scope.getUser()).toEqual({ id: 'user-1', email: 'test@example.com' })
    })

    it('should clear user with null', () => {
      scope.setUser({ id: 'user-1' })
      scope.setUser(null)

      expect(scope.getUser()).toBeNull()
    })

    it('should return the scope for chaining', () => {
      const result = scope.setUser({ id: 'user-1' })

      expect(result).toBe(scope)
    })
  })

  describe('Tags', () => {
    it('should set single tag', () => {
      scope.setTag('feature', 'checkout')

      expect(scope.getTags()).toEqual({ feature: 'checkout' })
    })

    it('should merge multiple tags', () => {
      scope.setTag('feature', 'checkout')
      scope.setTags({ tier: 'premium', version: '1.0' })

      expect(scope.getTags()).toEqual({
        feature: 'checkout',
        tier: 'premium',
        version: '1.0',
      })
    })

    it('should overwrite existing tags', () => {
      scope.setTag('feature', 'old')
      scope.setTag('feature', 'new')

      expect(scope.getTags()).toEqual({ feature: 'new' })
    })
  })

  describe('Extras', () => {
    it('should set single extra', () => {
      scope.setExtra('orderId', 'order-123')

      expect(scope.getExtras()).toEqual({ orderId: 'order-123' })
    })

    it('should merge multiple extras', () => {
      scope.setExtra('orderId', 'order-123')
      scope.setExtras({ items: ['a', 'b'], total: 100 })

      expect(scope.getExtras()).toEqual({
        orderId: 'order-123',
        items: ['a', 'b'],
        total: 100,
      })
    })

    it('should handle complex values', () => {
      scope.setExtra('nested', { deep: { value: true } })

      expect(scope.getExtras()).toEqual({
        nested: { deep: { value: true } },
      })
    })
  })

  describe('Context', () => {
    it('should set context', () => {
      scope.setContext('browser', { name: 'Chrome', version: '120' })

      expect(scope.getContext('browser')).toEqual({ name: 'Chrome', version: '120' })
    })

    it('should remove context with null', () => {
      scope.setContext('browser', { name: 'Chrome' })
      scope.setContext('browser', null)

      expect(scope.getContext('browser')).toBeUndefined()
    })

    it('should get all contexts', () => {
      scope.setContext('browser', { name: 'Chrome' })
      scope.setContext('os', { name: 'macOS' })

      expect(scope.getContexts()).toEqual({
        browser: { name: 'Chrome' },
        os: { name: 'macOS' },
      })
    })
  })

  describe('Level', () => {
    it('should set and get level', () => {
      scope.setLevel('warning')

      expect(scope.getLevel()).toBe('warning')
    })
  })

  describe('Transaction Name', () => {
    it('should set and get transaction name', () => {
      scope.setTransactionName('GET /api/users')

      expect(scope.getTransactionName()).toBe('GET /api/users')
    })
  })

  describe('Breadcrumbs', () => {
    it('should add breadcrumb', () => {
      scope.addBreadcrumb({ message: 'Test' })

      expect(scope.getBreadcrumbs()).toHaveLength(1)
      expect(scope.getBreadcrumbs()[0]?.message).toBe('Test')
    })

    it('should respect max breadcrumbs', () => {
      for (let i = 0; i < 150; i++) {
        scope.addBreadcrumb({ message: `Breadcrumb ${i}` })
      }

      // Default max is 100
      expect(scope.getBreadcrumbs().length).toBeLessThanOrEqual(100)
    })

    it('should respect custom max breadcrumbs', () => {
      const customScope = new Scope(5)

      for (let i = 0; i < 10; i++) {
        customScope.addBreadcrumb({ message: `Breadcrumb ${i}` })
      }

      expect(customScope.getBreadcrumbs()).toHaveLength(5)
    })

    it('should clear breadcrumbs', () => {
      scope.addBreadcrumb({ message: 'Test' })
      scope.clearBreadcrumbs()

      expect(scope.getBreadcrumbs()).toHaveLength(0)
    })

    it('should auto-populate timestamp', () => {
      const before = Date.now() / 1000
      scope.addBreadcrumb({ message: 'Test' })
      const after = Date.now() / 1000

      const timestamp = scope.getBreadcrumbs()[0]?.timestamp ?? 0
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('Fingerprint', () => {
    it('should set and get fingerprint', () => {
      scope.setFingerprint(['{{ default }}', 'my-custom-fingerprint'])

      expect(scope.getFingerprint()).toEqual(['{{ default }}', 'my-custom-fingerprint'])
    })
  })

  describe('clear', () => {
    it('should clear all scope data', () => {
      scope.setUser({ id: 'user-1' })
      scope.setTags({ feature: 'test' })
      scope.setExtras({ data: 'test' })
      scope.setContext('browser', { name: 'Chrome' })
      scope.setLevel('warning')
      scope.setTransactionName('test')
      scope.addBreadcrumb({ message: 'Test' })
      scope.setFingerprint(['custom'])

      scope.clear()

      expect(scope.getUser()).toBeNull()
      expect(scope.getTags()).toEqual({})
      expect(scope.getExtras()).toEqual({})
      expect(scope.getContexts()).toEqual({})
      expect(scope.getLevel()).toBeUndefined()
      expect(scope.getTransactionName()).toBeUndefined()
      expect(scope.getBreadcrumbs()).toHaveLength(0)
      expect(scope.getFingerprint()).toBeUndefined()
    })
  })

  describe('clone', () => {
    it('should create independent copy', () => {
      scope.setUser({ id: 'user-1' })
      scope.setTag('feature', 'original')

      const cloned = scope.clone()

      // Modify original
      scope.setTag('feature', 'modified')
      scope.setUser({ id: 'user-2' })

      // Clone should be unchanged
      expect(cloned.getTags()).toEqual({ feature: 'original' })
      expect(cloned.getUser()).toEqual({ id: 'user-1' })
    })

    it('should deep copy breadcrumbs', () => {
      scope.addBreadcrumb({ message: 'Test', data: { key: 'value' } })

      const cloned = scope.clone()

      // Modify original
      scope.addBreadcrumb({ message: 'New' })

      expect(cloned.getBreadcrumbs()).toHaveLength(1)
    })
  })

  describe('applyToEvent', () => {
    it('should apply user to event', () => {
      scope.setUser({ id: 'user-1', email: 'test@example.com' })

      const event: SentryEvent = {}
      const result = scope.applyToEvent(event)

      expect(result.user).toEqual({ id: 'user-1', email: 'test@example.com' })
    })

    it('should merge tags with event tags', () => {
      scope.setTags({ scope: 'true', shared: 'scope' })

      const event: SentryEvent = { tags: { event: 'true', shared: 'event' } }
      const result = scope.applyToEvent(event)

      // Event tags should take precedence
      expect(result.tags).toEqual({
        scope: 'true',
        event: 'true',
        shared: 'event',
      })
    })

    it('should merge extras with event extras', () => {
      scope.setExtras({ scopeData: true })

      const event: SentryEvent = { extra: { eventData: true } }
      const result = scope.applyToEvent(event)

      expect(result.extra).toEqual({
        scopeData: true,
        eventData: true,
      })
    })

    it('should merge contexts', () => {
      scope.setContext('browser', { name: 'Chrome' })

      const event: SentryEvent = { contexts: { os: { name: 'macOS' } } }
      const result = scope.applyToEvent(event)

      expect(result.contexts).toEqual({
        browser: { name: 'Chrome' },
        os: { name: 'macOS' },
      })
    })

    it('should apply level if not set on event', () => {
      scope.setLevel('warning')

      const event: SentryEvent = {}
      const result = scope.applyToEvent(event)

      expect(result.level).toBe('warning')
    })

    it('should not override event level', () => {
      scope.setLevel('warning')

      const event: SentryEvent = { level: 'error' }
      const result = scope.applyToEvent(event)

      expect(result.level).toBe('error')
    })

    it('should apply transaction name if not set', () => {
      scope.setTransactionName('GET /api/users')

      const event: SentryEvent = {}
      const result = scope.applyToEvent(event)

      expect(result.transaction).toBe('GET /api/users')
    })

    it('should prepend scope breadcrumbs', () => {
      scope.addBreadcrumb({ message: 'Scope breadcrumb' })

      const event: SentryEvent = {
        breadcrumbs: [{ message: 'Event breadcrumb' }],
      }
      const result = scope.applyToEvent(event)

      expect(result.breadcrumbs).toHaveLength(2)
      expect(result.breadcrumbs?.[0]?.message).toBe('Scope breadcrumb')
      expect(result.breadcrumbs?.[1]?.message).toBe('Event breadcrumb')
    })

    it('should apply fingerprint if not set', () => {
      scope.setFingerprint(['custom-fingerprint'])

      const event: SentryEvent = {}
      const result = scope.applyToEvent(event)

      expect(result.fingerprint).toEqual(['custom-fingerprint'])
    })

    it('should not mutate original event', () => {
      scope.setTag('test', 'value')

      const event: SentryEvent = { message: 'Test' }
      scope.applyToEvent(event)

      expect(event.tags).toBeUndefined()
    })
  })
})
