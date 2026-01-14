/**
 * @dotdo/sentry - Core Sentry API Tests
 *
 * RED phase: Tests for the core Sentry SDK functionality
 * - captureException
 * - captureMessage
 * - captureEvent
 * - User/tags/extras context
 * - Scope management
 * - beforeSend hook
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as Sentry from '../src/index.js'

describe('@dotdo/sentry', () => {
  beforeEach(() => {
    Sentry._clear()
  })

  afterEach(() => {
    Sentry._clear()
  })

  describe('init', () => {
    it('should initialize without DSN (disabled mode)', () => {
      expect(() => Sentry.init({})).not.toThrow()
    })

    it('should initialize with DSN', () => {
      expect(() =>
        Sentry.init({
          dsn: 'https://key@o0.ingest.sentry.io/123',
        })
      ).not.toThrow()
    })

    it('should apply initial scope configuration', () => {
      Sentry.init({
        dsn: 'https://key@o0.ingest.sentry.io/123',
        initialScope: {
          user: { id: 'user-1', email: 'test@example.com' },
          tags: { feature: 'test' },
          extra: { debug: true },
          level: 'warning',
        },
      })

      const scope = Sentry.getCurrentScope()
      expect(scope.getUser()).toEqual({ id: 'user-1', email: 'test@example.com' })
      expect(scope.getTags()).toEqual({ feature: 'test' })
      expect(scope.getExtras()).toEqual({ debug: true })
      expect(scope.getLevel()).toBe('warning')
    })
  })

  describe('captureException', () => {
    it('should capture Error objects and return event ID', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      const error = new Error('Test error')
      const eventId = Sentry.captureException(error)

      expect(eventId).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should capture string exceptions', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      const eventId = Sentry.captureException('String error')

      expect(eventId).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should capture null/undefined', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      const eventId1 = Sentry.captureException(null)
      const eventId2 = Sentry.captureException(undefined)

      expect(eventId1).toMatch(/^[a-f0-9]{32}$/)
      expect(eventId2).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should return empty string when disabled (no DSN)', () => {
      Sentry.init({})

      const eventId = Sentry.captureException(new Error('Test'))

      expect(eventId).toBe('')
    })
  })

  describe('captureMessage', () => {
    it('should capture messages with default level (info)', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      const eventId = Sentry.captureMessage('Test message')

      expect(eventId).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should capture messages with specified level', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      const eventId = Sentry.captureMessage('Warning message', 'warning')

      expect(eventId).toMatch(/^[a-f0-9]{32}$/)
    })
  })

  describe('captureEvent', () => {
    it('should capture custom events', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      const eventId = Sentry.captureEvent({
        message: 'Custom event',
        level: 'info',
        tags: { custom: 'tag' },
      })

      expect(eventId).toMatch(/^[a-f0-9]{32}$/)
    })
  })

  describe('User context', () => {
    it('should set and retrieve user', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.setUser({
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
      })

      const scope = Sentry.getCurrentScope()
      expect(scope.getUser()).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
      })
    })

    it('should clear user with null', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.setUser({ id: 'user-123' })
      Sentry.setUser(null)

      const scope = Sentry.getCurrentScope()
      expect(scope.getUser()).toBeNull()
    })
  })

  describe('Tags', () => {
    it('should set single tag', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.setTag('feature', 'checkout')

      const scope = Sentry.getCurrentScope()
      expect(scope.getTags()).toEqual({ feature: 'checkout' })
    })

    it('should set multiple tags', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.setTags({
        feature: 'checkout',
        tier: 'premium',
        version: '1.0.0',
      })

      const scope = Sentry.getCurrentScope()
      expect(scope.getTags()).toEqual({
        feature: 'checkout',
        tier: 'premium',
        version: '1.0.0',
      })
    })
  })

  describe('Extra data', () => {
    it('should set single extra', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.setExtra('orderId', 'order-456')

      const scope = Sentry.getCurrentScope()
      expect(scope.getExtras()).toEqual({ orderId: 'order-456' })
    })

    it('should set multiple extras', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.setExtras({
        orderId: 'order-456',
        items: ['item1', 'item2'],
        metadata: { debug: true },
      })

      const scope = Sentry.getCurrentScope()
      expect(scope.getExtras()).toEqual({
        orderId: 'order-456',
        items: ['item1', 'item2'],
        metadata: { debug: true },
      })
    })
  })

  describe('Context', () => {
    it('should set context', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.setContext('browser', {
        name: 'Chrome',
        version: '120.0',
      })

      const scope = Sentry.getCurrentScope()
      expect(scope.getContext('browser')).toEqual({
        name: 'Chrome',
        version: '120.0',
      })
    })

    it('should clear context with null', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.setContext('browser', { name: 'Chrome' })
      Sentry.setContext('browser', null)

      const scope = Sentry.getCurrentScope()
      expect(scope.getContext('browser')).toBeUndefined()
    })
  })

  describe('withScope', () => {
    it('should create isolated scope for callback', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.setTag('outer', 'value')

      Sentry.withScope((scope) => {
        scope.setTag('inner', 'scoped')
        expect(scope.getTags()).toEqual({ outer: 'value', inner: 'scoped' })
      })

      // Inner tag should not leak out
      const outerScope = Sentry.getCurrentScope()
      expect(outerScope.getTags()).toEqual({ outer: 'value' })
    })

    it('should support nested scopes', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.setTag('level', '0')

      Sentry.withScope((scope1) => {
        scope1.setTag('level', '1')

        Sentry.withScope((scope2) => {
          scope2.setTag('level', '2')
          expect(scope2.getTags()).toEqual({ level: '2' })
        })

        expect(scope1.getTags()).toEqual({ level: '1' })
      })

      expect(Sentry.getCurrentScope().getTags()).toEqual({ level: '0' })
    })
  })

  describe('configureScope', () => {
    it('should configure the current scope directly', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.configureScope((scope) => {
        scope.setTag('configured', 'true')
        scope.setUser({ id: 'user-1' })
      })

      const currentScope = Sentry.getCurrentScope()
      expect(currentScope.getTags()).toEqual({ configured: 'true' })
      expect(currentScope.getUser()).toEqual({ id: 'user-1' })
    })
  })

  describe('beforeSend hook', () => {
    it('should allow filtering events', async () => {
      const beforeSend = vi.fn().mockReturnValue(null)

      Sentry.init({
        dsn: 'https://key@o0.ingest.sentry.io/123',
        beforeSend,
      })

      Sentry.captureMessage('Should be filtered')

      // beforeSend should have been called
      expect(beforeSend).toHaveBeenCalled()
    })

    it('should allow modifying events', async () => {
      const beforeSend = vi.fn().mockImplementation((event) => ({
        ...event,
        tags: { ...event.tags, modified: 'true' },
      }))

      Sentry.init({
        dsn: 'https://key@o0.ingest.sentry.io/123',
        beforeSend,
      })

      Sentry.captureMessage('Should be modified')

      expect(beforeSend).toHaveBeenCalled()
      const [event] = beforeSend.mock.calls[0]
      expect(event.message).toBe('Should be modified')
    })
  })

  describe('sampling', () => {
    it('should respect sampleRate of 0', () => {
      Sentry.init({
        dsn: 'https://key@o0.ingest.sentry.io/123',
        sampleRate: 0,
      })

      // With 0 sample rate, events should be dropped but still return IDs
      const eventId = Sentry.captureMessage('Test')
      expect(eventId).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should respect sampleRate of 1', () => {
      Sentry.init({
        dsn: 'https://key@o0.ingest.sentry.io/123',
        sampleRate: 1,
      })

      const eventId = Sentry.captureMessage('Test')
      expect(eventId).toMatch(/^[a-f0-9]{32}$/)
    })
  })

  describe('flush and close', () => {
    it('should flush pending events', async () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      const result = await Sentry.flush(1000)
      expect(result).toBe(true)
    })

    it('should close and flush', async () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      const result = await Sentry.close(1000)
      expect(result).toBe(true)
    })
  })
})
