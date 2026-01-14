/**
 * @dotdo/sentry - Sentry SDK Compat Layer Tests
 *
 * Comprehensive tests for the Sentry SDK compatibility layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Core API
  init,
  captureException,
  captureMessage,
  captureEvent,
  addBreadcrumb,
  setUser,
  setTags,
  setTag,
  setExtra,
  setExtras,
  setContext,
  withScope,
  configureScope,
  getCurrentScope,
  getCurrentHub,
  flush,
  close,

  // Classes
  Scope,
  SentryClient,
  FetchTransport,
  InMemoryTransport,

  // Utilities
  parseDsn,

  // Test utilities
  _clear,
  _getHub,
} from '../index'

import type {
  SentryEvent,
  SentryOptions,
  User,
  Breadcrumb,
} from '../index'

describe('@dotdo/sentry - Sentry SDK Compat Layer', () => {
  // Reset global state before each test
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // DSN Parsing
  // ===========================================================================

  describe('parseDsn', () => {
    it('should parse a valid DSN', () => {
      const dsn = 'https://abc123@o0.ingest.sentry.io/12345'
      const parsed = parseDsn(dsn)

      expect(parsed).toEqual({
        protocol: 'https',
        publicKey: 'abc123',
        secretKey: undefined,
        host: 'o0.ingest.sentry.io',
        port: undefined,
        path: undefined,
        projectId: '12345',
      })
    })

    it('should parse DSN with path', () => {
      const dsn = 'https://key@sentry.example.com/path/to/project/99'
      const parsed = parseDsn(dsn)

      expect(parsed?.projectId).toBe('99')
      expect(parsed?.path).toBe('/path/to/project')
    })

    it('should parse DSN with port', () => {
      const dsn = 'https://key@localhost:9000/1'
      const parsed = parseDsn(dsn)

      expect(parsed?.host).toBe('localhost')
      expect(parsed?.port).toBe('9000')
    })

    it('should return null for invalid DSN', () => {
      expect(parseDsn('invalid')).toBeNull()
      expect(parseDsn('')).toBeNull()
    })
  })

  // ===========================================================================
  // Initialization
  // ===========================================================================

  describe('init', () => {
    it('should initialize without DSN (no-op mode)', () => {
      init({})

      const hub = _getHub()
      expect(hub).toBeDefined()
      expect(hub?.getClient()).toBeUndefined()
    })

    it('should initialize with DSN', () => {
      init({
        dsn: 'https://key@sentry.example.com/1',
      })

      const hub = _getHub()
      expect(hub).toBeDefined()
      expect(hub?.getClient()).toBeDefined()
    })

    it('should apply initial scope', () => {
      init({
        dsn: 'https://key@sentry.example.com/1',
        initialScope: {
          user: { id: 'user-1' },
          tags: { env: 'test' },
          extra: { debug: true },
          level: 'warning',
        },
      })

      const scope = getCurrentScope()
      expect(scope.getUser()?.id).toBe('user-1')
      expect(scope.getTags().env).toBe('test')
      expect(scope.getExtras().debug).toBe(true)
      expect(scope.getLevel()).toBe('warning')
    })
  })

  // ===========================================================================
  // Scope
  // ===========================================================================

  describe('Scope', () => {
    it('should set and get user', () => {
      const scope = new Scope()
      const user: User = { id: 'user-123', email: 'test@example.com' }

      scope.setUser(user)
      expect(scope.getUser()).toEqual(user)

      scope.setUser(null)
      expect(scope.getUser()).toBeNull()
    })

    it('should set and get tags', () => {
      const scope = new Scope()

      scope.setTag('key1', 'value1')
      scope.setTags({ key2: 'value2', key3: 'value3' })

      expect(scope.getTags()).toEqual({
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
      })
    })

    it('should set and get extras', () => {
      const scope = new Scope()

      scope.setExtra('data1', { nested: true })
      scope.setExtras({ data2: [1, 2, 3] })

      const extras = scope.getExtras()
      expect(extras.data1).toEqual({ nested: true })
      expect(extras.data2).toEqual([1, 2, 3])
    })

    it('should set and get context', () => {
      const scope = new Scope()

      scope.setContext('browser', { name: 'Chrome', version: '120' })
      scope.setContext('os', { name: 'macOS' })

      expect(scope.getContext('browser')).toEqual({ name: 'Chrome', version: '120' })
      expect(scope.getContexts()).toHaveProperty('browser')
      expect(scope.getContexts()).toHaveProperty('os')

      scope.setContext('browser', null)
      expect(scope.getContext('browser')).toBeUndefined()
    })

    it('should manage breadcrumbs', () => {
      const scope = new Scope(3) // Max 3 breadcrumbs

      scope.addBreadcrumb({ message: 'Event 1' })
      scope.addBreadcrumb({ message: 'Event 2' })
      scope.addBreadcrumb({ message: 'Event 3' })
      scope.addBreadcrumb({ message: 'Event 4' })

      const breadcrumbs = scope.getBreadcrumbs()
      expect(breadcrumbs).toHaveLength(3)
      expect(breadcrumbs[0].message).toBe('Event 2')
      expect(breadcrumbs[2].message).toBe('Event 4')

      scope.clearBreadcrumbs()
      expect(scope.getBreadcrumbs()).toHaveLength(0)
    })

    it('should add timestamp to breadcrumbs', () => {
      const scope = new Scope()

      scope.addBreadcrumb({ message: 'Test' })

      const breadcrumbs = scope.getBreadcrumbs()
      expect(breadcrumbs[0].timestamp).toBeDefined()
      expect(typeof breadcrumbs[0].timestamp).toBe('number')
    })

    it('should set and get level', () => {
      const scope = new Scope()

      scope.setLevel('error')
      expect(scope.getLevel()).toBe('error')
    })

    it('should set and get transaction name', () => {
      const scope = new Scope()

      scope.setTransactionName('POST /api/users')
      expect(scope.getTransactionName()).toBe('POST /api/users')
    })

    it('should set and get fingerprint', () => {
      const scope = new Scope()

      scope.setFingerprint(['custom', 'fingerprint'])
      expect(scope.getFingerprint()).toEqual(['custom', 'fingerprint'])
    })

    it('should clone scope correctly', () => {
      const original = new Scope()
      original.setUser({ id: 'user-1' })
      original.setTag('env', 'test')
      original.addBreadcrumb({ message: 'Test' })

      const cloned = original.clone()

      // Should have same values
      expect(cloned.getUser()).toEqual({ id: 'user-1' })
      expect(cloned.getTags()).toEqual({ env: 'test' })

      // Modifications should not affect original
      cloned.setUser({ id: 'user-2' })
      expect(original.getUser()?.id).toBe('user-1')
    })

    it('should clear scope', () => {
      const scope = new Scope()
      scope.setUser({ id: 'user-1' })
      scope.setTag('env', 'test')
      scope.addBreadcrumb({ message: 'Test' })

      scope.clear()

      expect(scope.getUser()).toBeNull()
      expect(scope.getTags()).toEqual({})
      expect(scope.getBreadcrumbs()).toHaveLength(0)
    })

    it('should apply scope to event', () => {
      const scope = new Scope()
      scope.setUser({ id: 'user-1' })
      scope.setTag('env', 'test')
      scope.setExtra('debug', true)
      scope.setContext('browser', { name: 'Chrome' })
      scope.setLevel('warning')
      scope.setTransactionName('GET /api')
      scope.addBreadcrumb({ message: 'Navigation' })
      scope.setFingerprint(['custom'])

      const event: SentryEvent = { message: 'Test event' }
      const applied = scope.applyToEvent(event)

      expect(applied.user?.id).toBe('user-1')
      expect(applied.tags?.env).toBe('test')
      expect(applied.extra?.debug).toBe(true)
      expect(applied.contexts?.browser).toEqual({ name: 'Chrome' })
      expect(applied.level).toBe('warning')
      expect(applied.transaction).toBe('GET /api')
      expect(applied.breadcrumbs).toHaveLength(1)
      expect(applied.fingerprint).toEqual(['custom'])
    })
  })

  // ===========================================================================
  // Context Management
  // ===========================================================================

  describe('Context Management', () => {
    beforeEach(() => {
      init({ dsn: 'https://key@sentry.example.com/1' })
    })

    it('should set user via setUser', () => {
      setUser({ id: 'user-456', email: 'alice@example.com' })

      const scope = getCurrentScope()
      expect(scope.getUser()?.id).toBe('user-456')
    })

    it('should set tags via setTags', () => {
      setTags({ feature: 'checkout', version: '2.0' })

      const scope = getCurrentScope()
      expect(scope.getTags().feature).toBe('checkout')
    })

    it('should set single tag via setTag', () => {
      setTag('region', 'us-west')

      const scope = getCurrentScope()
      expect(scope.getTags().region).toBe('us-west')
    })

    it('should set extras via setExtras', () => {
      setExtras({ orderId: 123, items: ['a', 'b'] })

      const scope = getCurrentScope()
      expect(scope.getExtras().orderId).toBe(123)
    })

    it('should set single extra via setExtra', () => {
      setExtra('requestId', 'req-789')

      const scope = getCurrentScope()
      expect(scope.getExtras().requestId).toBe('req-789')
    })

    it('should set context via setContext', () => {
      setContext('device', { model: 'iPhone', os: 'iOS 17' })

      const scope = getCurrentScope()
      expect(scope.getContext('device')).toEqual({ model: 'iPhone', os: 'iOS 17' })
    })
  })

  // ===========================================================================
  // Breadcrumbs
  // ===========================================================================

  describe('Breadcrumbs', () => {
    beforeEach(() => {
      init({ dsn: 'https://key@sentry.example.com/1' })
    })

    it('should add breadcrumb via addBreadcrumb', () => {
      addBreadcrumb({
        category: 'navigation',
        message: 'User clicked button',
        level: 'info',
      })

      const scope = getCurrentScope()
      const breadcrumbs = scope.getBreadcrumbs()

      expect(breadcrumbs).toHaveLength(1)
      expect(breadcrumbs[0].category).toBe('navigation')
      expect(breadcrumbs[0].message).toBe('User clicked button')
    })

    it('should add breadcrumb with data', () => {
      addBreadcrumb({
        category: 'http',
        message: 'POST /api/users',
        data: {
          method: 'POST',
          url: '/api/users',
          status_code: 201,
        },
      })

      const breadcrumbs = getCurrentScope().getBreadcrumbs()
      expect(breadcrumbs[0].data?.status_code).toBe(201)
    })

    it('should respect beforeBreadcrumb hook', () => {
      init({
        dsn: 'https://key@sentry.example.com/1',
        beforeBreadcrumb(breadcrumb) {
          if (breadcrumb.category === 'ignore') {
            return null // Drop the breadcrumb
          }
          return {
            ...breadcrumb,
            data: { ...breadcrumb.data, modified: true },
          }
        },
      })

      addBreadcrumb({ category: 'ignore', message: 'Should be dropped' })
      addBreadcrumb({ category: 'keep', message: 'Should be kept' })

      const breadcrumbs = getCurrentScope().getBreadcrumbs()
      expect(breadcrumbs).toHaveLength(1)
      expect(breadcrumbs[0].category).toBe('keep')
      expect(breadcrumbs[0].data?.modified).toBe(true)
    })
  })

  // ===========================================================================
  // Scoped Operations
  // ===========================================================================

  describe('withScope', () => {
    beforeEach(() => {
      init({ dsn: 'https://key@sentry.example.com/1' })
    })

    it('should isolate scope changes', () => {
      setTag('global', 'yes')

      withScope((scope) => {
        scope.setTag('scoped', 'yes')
        expect(scope.getTags().global).toBe('yes')
        expect(scope.getTags().scoped).toBe('yes')
      })

      // After withScope, scoped tag should be gone
      const currentScope = getCurrentScope()
      expect(currentScope.getTags().global).toBe('yes')
      expect(currentScope.getTags().scoped).toBeUndefined()
    })

    it('should allow nested withScope', () => {
      setTag('level', '0')

      withScope((scope1) => {
        scope1.setTag('level', '1')

        withScope((scope2) => {
          scope2.setTag('level', '2')
          expect(scope2.getTags().level).toBe('2')
        })

        expect(scope1.getTags().level).toBe('1')
      })

      expect(getCurrentScope().getTags().level).toBe('0')
    })
  })

  describe('configureScope', () => {
    beforeEach(() => {
      init({ dsn: 'https://key@sentry.example.com/1' })
    })

    it('should modify current scope', () => {
      configureScope((scope) => {
        scope.setTag('configured', 'yes')
        scope.setUser({ id: 'config-user' })
      })

      const current = getCurrentScope()
      expect(current.getTags().configured).toBe('yes')
      expect(current.getUser()?.id).toBe('config-user')
    })
  })

  // ===========================================================================
  // Event Capture
  // ===========================================================================

  describe('captureException', () => {
    it('should return event ID even without DSN', () => {
      init({})

      const eventId = captureException(new Error('Test'))

      expect(eventId).toBeDefined()
      expect(typeof eventId).toBe('string')
    })

    it('should capture Error objects', () => {
      const events: SentryEvent[] = []
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureException(new Error('Test error'))

      // Give async transport time to process
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const captured = transport.getEvents()
          expect(captured).toHaveLength(1)
          expect(captured[0].exception?.values?.[0].value).toBe('Test error')
          expect(captured[0].level).toBe('error')
          resolve()
        }, 10)
      })
    })

    it('should capture non-Error values', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureException('String error')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const captured = transport.getEvents()
          expect(captured).toHaveLength(1)
          expect(captured[0].exception?.values?.[0].value).toBe('String error')
          resolve()
        }, 10)
      })
    })

    it('should include stack trace', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      const error = new Error('Stack test')
      captureException(error)

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const captured = transport.getEvents()
          const frames = captured[0].exception?.values?.[0].stacktrace?.frames
          expect(frames).toBeDefined()
          expect(frames!.length).toBeGreaterThan(0)
          resolve()
        }, 10)
      })
    })
  })

  describe('captureMessage', () => {
    it('should capture messages with default level', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureMessage('Info message')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const captured = transport.getEvents()
          expect(captured).toHaveLength(1)
          expect(captured[0].message).toBe('Info message')
          expect(captured[0].level).toBe('info')
          resolve()
        }, 10)
      })
    })

    it('should capture messages with custom level', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureMessage('Warning message', 'warning')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const captured = transport.getEvents()
          expect(captured[0].level).toBe('warning')
          resolve()
        }, 10)
      })
    })

    it('should attach stack trace when configured', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
        attachStacktrace: true,
      })

      captureMessage('With stack')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const captured = transport.getEvents()
          expect(captured[0].exception?.values?.[0].stacktrace).toBeDefined()
          resolve()
        }, 10)
      })
    })
  })

  describe('captureEvent', () => {
    it('should capture custom events', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureEvent({
        message: 'Custom event',
        level: 'debug',
        tags: { custom: 'true' },
      })

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const captured = transport.getEvents()
          expect(captured).toHaveLength(1)
          expect(captured[0].message).toBe('Custom event')
          expect(captured[0].level).toBe('debug')
          expect(captured[0].tags?.custom).toBe('true')
          resolve()
        }, 10)
      })
    })
  })

  // ===========================================================================
  // Sampling
  // ===========================================================================

  describe('Sampling', () => {
    it('should respect sample rate of 0', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
        sampleRate: 0,
      })

      for (let i = 0; i < 10; i++) {
        captureMessage(`Message ${i}`)
      }

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(transport.getEvents()).toHaveLength(0)
          resolve()
        }, 10)
      })
    })

    it('should respect sample rate of 1', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
        sampleRate: 1,
      })

      captureMessage('Test')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(transport.getEvents()).toHaveLength(1)
          resolve()
        }, 10)
      })
    })
  })

  // ===========================================================================
  // beforeSend Hook
  // ===========================================================================

  describe('beforeSend', () => {
    it('should allow dropping events', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
        beforeSend(event) {
          if (event.message?.includes('drop')) {
            return null
          }
          return event
        },
      })

      captureMessage('keep this')
      captureMessage('drop this')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const captured = transport.getEvents()
          expect(captured).toHaveLength(1)
          expect(captured[0].message).toBe('keep this')
          resolve()
        }, 10)
      })
    })

    it('should allow modifying events', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
        beforeSend(event) {
          return {
            ...event,
            tags: { ...event.tags, modified: 'yes' },
          }
        },
      })

      captureMessage('Test')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const captured = transport.getEvents()
          expect(captured[0].tags?.modified).toBe('yes')
          resolve()
        }, 10)
      })
    })
  })

  // ===========================================================================
  // Global Options
  // ===========================================================================

  describe('Global Options', () => {
    it('should include release in events', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
        release: 'my-app@1.2.3',
      })

      captureMessage('Test')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const captured = transport.getEvents()
          expect(captured[0].release).toBe('my-app@1.2.3')
          resolve()
        }, 10)
      })
    })

    it('should include environment in events', () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
        environment: 'production',
      })

      captureMessage('Test')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const captured = transport.getEvents()
          expect(captured[0].environment).toBe('production')
          resolve()
        }, 10)
      })
    })
  })

  // ===========================================================================
  // InMemoryTransport
  // ===========================================================================

  describe('InMemoryTransport', () => {
    it('should store events', async () => {
      const transport = new InMemoryTransport()

      await transport.send([
        { event_id: 'test-1' },
        [[{ type: 'event' }, { message: 'Test' }]],
      ])

      expect(transport.getEvents()).toHaveLength(1)
    })

    it('should clear events', async () => {
      const transport = new InMemoryTransport()

      await transport.send([
        { event_id: 'test-1' },
        [[{ type: 'event' }, { message: 'Test' }]],
      ])

      transport.clear()
      expect(transport.getEvents()).toHaveLength(0)
    })
  })

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('Lifecycle', () => {
    it('should flush pending events', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureMessage('Test')

      const result = await flush(1000)
      expect(result).toBe(true)
    })

    it('should close client', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      const result = await close(1000)
      expect(result).toBe(true)

      // After close, events should not be sent
      captureMessage('After close')

      await new Promise((resolve) => setTimeout(resolve, 10))
      // Only the initial test message should be captured
      expect(transport.getEvents()).toHaveLength(0)
    })
  })

  // ===========================================================================
  // Hub
  // ===========================================================================

  describe('Hub', () => {
    it('should get current hub', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const hub = getCurrentHub()
      expect(hub).toBeDefined()
      expect(hub.getClient()).toBeDefined()
    })
  })
})
