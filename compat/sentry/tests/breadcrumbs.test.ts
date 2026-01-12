/**
 * @dotdo/sentry - Breadcrumbs Module Tests
 *
 * Tests for advanced breadcrumb management functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  init,
  addBreadcrumb,
  getCurrentScope,
  captureException,
  _clear,
  InMemoryTransport,
} from '../index'

import {
  BreadcrumbManager,
  createHttpBreadcrumb,
  createNavigationBreadcrumb,
  createConsoleBreadcrumb,
  createClickBreadcrumb,
  createErrorBreadcrumb,
  createQueryBreadcrumb,
} from '../breadcrumbs'

describe('@dotdo/sentry - Breadcrumbs Module', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // BreadcrumbManager
  // ===========================================================================

  describe('BreadcrumbManager', () => {
    it('should create manager with default config', () => {
      const manager = new BreadcrumbManager()
      expect(manager).toBeDefined()
    })

    it('should respect max breadcrumbs limit', () => {
      const manager = new BreadcrumbManager({ maxBreadcrumbs: 3 })

      manager.add({ message: 'Event 1' })
      manager.add({ message: 'Event 2' })
      manager.add({ message: 'Event 3' })
      manager.add({ message: 'Event 4' })
      manager.add({ message: 'Event 5' })

      const breadcrumbs = manager.getAll()
      expect(breadcrumbs.length).toBe(3)
      expect(breadcrumbs[0].message).toBe('Event 3')
      expect(breadcrumbs[2].message).toBe('Event 5')
    })

    it('should filter breadcrumbs by category', () => {
      const manager = new BreadcrumbManager()

      manager.add({ category: 'http', message: 'GET /api' })
      manager.add({ category: 'navigation', message: 'Page load' })
      manager.add({ category: 'http', message: 'POST /api' })
      manager.add({ category: 'console', message: 'Log message' })

      const httpBreadcrumbs = manager.getByCategory('http')
      expect(httpBreadcrumbs.length).toBe(2)
      expect(httpBreadcrumbs[0].message).toBe('GET /api')
      expect(httpBreadcrumbs[1].message).toBe('POST /api')
    })

    it('should filter breadcrumbs by level', () => {
      const manager = new BreadcrumbManager()

      manager.add({ level: 'info', message: 'Info message' })
      manager.add({ level: 'warning', message: 'Warning message' })
      manager.add({ level: 'error', message: 'Error message' })
      manager.add({ level: 'info', message: 'Another info' })

      const errorBreadcrumbs = manager.getByLevel('error')
      expect(errorBreadcrumbs.length).toBe(1)
      expect(errorBreadcrumbs[0].message).toBe('Error message')
    })

    it('should get breadcrumbs since timestamp', () => {
      const manager = new BreadcrumbManager()

      const now = Date.now() / 1000

      manager.add({ message: 'Old event', timestamp: now - 100 })
      manager.add({ message: 'Recent event 1', timestamp: now - 10 })
      manager.add({ message: 'Recent event 2', timestamp: now - 5 })

      const recentBreadcrumbs = manager.getSince(now - 20)
      expect(recentBreadcrumbs.length).toBe(2)
      expect(recentBreadcrumbs[0].message).toBe('Recent event 1')
    })

    it('should clear all breadcrumbs', () => {
      const manager = new BreadcrumbManager()

      manager.add({ message: 'Event 1' })
      manager.add({ message: 'Event 2' })
      expect(manager.getAll().length).toBe(2)

      manager.clear()
      expect(manager.getAll().length).toBe(0)
    })

    it('should auto-add timestamps', () => {
      const manager = new BreadcrumbManager()

      manager.add({ message: 'Test' })

      const breadcrumbs = manager.getAll()
      expect(breadcrumbs[0].timestamp).toBeDefined()
      expect(typeof breadcrumbs[0].timestamp).toBe('number')
    })

    it('should support beforeBreadcrumb hook', () => {
      const manager = new BreadcrumbManager({
        beforeBreadcrumb: (breadcrumb) => {
          if (breadcrumb.category === 'ignore') {
            return null
          }
          return {
            ...breadcrumb,
            data: { ...breadcrumb.data, enriched: true },
          }
        },
      })

      manager.add({ category: 'ignore', message: 'Should be ignored' })
      manager.add({ category: 'keep', message: 'Should be kept' })

      const breadcrumbs = manager.getAll()
      expect(breadcrumbs.length).toBe(1)
      expect(breadcrumbs[0].category).toBe('keep')
      expect(breadcrumbs[0].data?.enriched).toBe(true)
    })

    it('should apply category filters', () => {
      const manager = new BreadcrumbManager({
        enabledCategories: ['http', 'navigation'],
      })

      manager.add({ category: 'http', message: 'Request' })
      manager.add({ category: 'console', message: 'Log' })
      manager.add({ category: 'navigation', message: 'Navigate' })
      manager.add({ category: 'ui', message: 'Click' })

      const breadcrumbs = manager.getAll()
      expect(breadcrumbs.length).toBe(2)
      expect(breadcrumbs.map(b => b.category)).toEqual(['http', 'navigation'])
    })
  })

  // ===========================================================================
  // Breadcrumb Factory Functions
  // ===========================================================================

  describe('createHttpBreadcrumb', () => {
    it('should create HTTP request breadcrumb', () => {
      const breadcrumb = createHttpBreadcrumb({
        method: 'POST',
        url: '/api/users',
        statusCode: 201,
        duration: 150,
      })

      expect(breadcrumb.type).toBe('http')
      expect(breadcrumb.category).toBe('http')
      expect(breadcrumb.level).toBe('info')
      expect(breadcrumb.data?.method).toBe('POST')
      expect(breadcrumb.data?.url).toBe('/api/users')
      expect(breadcrumb.data?.status_code).toBe(201)
      expect(breadcrumb.data?.duration_ms).toBe(150)
    })

    it('should set error level for failed requests', () => {
      const breadcrumb = createHttpBreadcrumb({
        method: 'GET',
        url: '/api/error',
        statusCode: 500,
      })

      expect(breadcrumb.level).toBe('error')
    })

    it('should set warning level for client errors', () => {
      const breadcrumb = createHttpBreadcrumb({
        method: 'GET',
        url: '/api/missing',
        statusCode: 404,
      })

      expect(breadcrumb.level).toBe('warning')
    })

    it('should include request/response size', () => {
      const breadcrumb = createHttpBreadcrumb({
        method: 'POST',
        url: '/api/upload',
        statusCode: 200,
        requestBodySize: 1024,
        responseBodySize: 512,
      })

      expect(breadcrumb.data?.request_body_size).toBe(1024)
      expect(breadcrumb.data?.response_body_size).toBe(512)
    })
  })

  describe('createNavigationBreadcrumb', () => {
    it('should create navigation breadcrumb', () => {
      const breadcrumb = createNavigationBreadcrumb({
        from: '/home',
        to: '/dashboard',
      })

      expect(breadcrumb.type).toBe('navigation')
      expect(breadcrumb.category).toBe('navigation')
      expect(breadcrumb.data?.from).toBe('/home')
      expect(breadcrumb.data?.to).toBe('/dashboard')
    })

    it('should include navigation type', () => {
      const breadcrumb = createNavigationBreadcrumb({
        from: '/home',
        to: '/about',
        navigationType: 'push',
      })

      expect(breadcrumb.data?.navigation_type).toBe('push')
    })
  })

  describe('createConsoleBreadcrumb', () => {
    it('should create console log breadcrumb', () => {
      const breadcrumb = createConsoleBreadcrumb('log', 'Debug message')

      expect(breadcrumb.type).toBe('debug')
      expect(breadcrumb.category).toBe('console')
      expect(breadcrumb.level).toBe('log')
      expect(breadcrumb.message).toBe('Debug message')
    })

    it('should create console error breadcrumb', () => {
      const breadcrumb = createConsoleBreadcrumb('error', 'Error occurred')

      expect(breadcrumb.level).toBe('error')
      expect(breadcrumb.message).toBe('Error occurred')
    })

    it('should create console warn breadcrumb', () => {
      const breadcrumb = createConsoleBreadcrumb('warn', 'Warning')

      expect(breadcrumb.level).toBe('warning')
    })

    it('should include extra arguments', () => {
      const breadcrumb = createConsoleBreadcrumb('log', 'Message', ['arg1', 42])

      expect(breadcrumb.data?.arguments).toEqual(['arg1', 42])
    })
  })

  describe('createClickBreadcrumb', () => {
    it('should create click breadcrumb', () => {
      const breadcrumb = createClickBreadcrumb({
        target: 'button.submit',
        text: 'Submit',
      })

      expect(breadcrumb.type).toBe('ui')
      expect(breadcrumb.category).toBe('ui.click')
      expect(breadcrumb.message).toBe('Submit')
      expect(breadcrumb.data?.target).toBe('button.submit')
    })

    it('should include element attributes', () => {
      const breadcrumb = createClickBreadcrumb({
        target: 'button#login',
        text: 'Login',
        attributes: {
          id: 'login',
          class: 'btn btn-primary',
        },
      })

      expect(breadcrumb.data?.id).toBe('login')
      expect(breadcrumb.data?.class).toBe('btn btn-primary')
    })
  })

  describe('createErrorBreadcrumb', () => {
    it('should create error breadcrumb from Error', () => {
      const error = new Error('Something went wrong')
      const breadcrumb = createErrorBreadcrumb(error)

      expect(breadcrumb.type).toBe('error')
      expect(breadcrumb.category).toBe('error')
      expect(breadcrumb.level).toBe('error')
      expect(breadcrumb.message).toBe('Something went wrong')
      expect(breadcrumb.data?.name).toBe('Error')
    })

    it('should create error breadcrumb with custom message', () => {
      const error = new TypeError('Invalid type')
      const breadcrumb = createErrorBreadcrumb(error, 'Type validation failed')

      expect(breadcrumb.message).toBe('Type validation failed')
      expect(breadcrumb.data?.original_message).toBe('Invalid type')
    })

    it('should include error stack if available', () => {
      const error = new Error('With stack')
      const breadcrumb = createErrorBreadcrumb(error)

      expect(breadcrumb.data?.stack).toBeDefined()
    })
  })

  describe('createQueryBreadcrumb', () => {
    it('should create database query breadcrumb', () => {
      const breadcrumb = createQueryBreadcrumb({
        system: 'postgresql',
        query: 'SELECT * FROM users WHERE id = $1',
        duration: 25,
      })

      expect(breadcrumb.type).toBe('query')
      expect(breadcrumb.category).toBe('query')
      expect(breadcrumb.message).toBe('SELECT * FROM users WHERE id = $1')
      expect(breadcrumb.data?.['db.system']).toBe('postgresql')
      expect(breadcrumb.data?.duration_ms).toBe(25)
    })

    it('should include row count', () => {
      const breadcrumb = createQueryBreadcrumb({
        system: 'mysql',
        query: 'SELECT * FROM products',
        rowCount: 150,
      })

      expect(breadcrumb.data?.row_count).toBe(150)
    })

    it('should set warning level for slow queries', () => {
      const breadcrumb = createQueryBreadcrumb({
        system: 'postgresql',
        query: 'SELECT * FROM large_table',
        duration: 5000,
        slowThreshold: 1000,
      })

      expect(breadcrumb.level).toBe('warning')
    })
  })

  // ===========================================================================
  // Integration with Sentry Core
  // ===========================================================================

  describe('Breadcrumbs Integration', () => {
    it('should include breadcrumbs in captured exceptions', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      addBreadcrumb({
        category: 'navigation',
        message: 'User navigated to /checkout',
      })

      addBreadcrumb({
        category: 'http',
        message: 'POST /api/order',
        data: { status_code: 200 },
      })

      captureException(new Error('Payment failed'))

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].breadcrumbs?.length).toBe(2)
      expect(events[0].breadcrumbs?.[0].category).toBe('navigation')
      expect(events[0].breadcrumbs?.[1].category).toBe('http')
    })

    it('should preserve breadcrumb order', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
        maxBreadcrumbs: 10,
      })

      for (let i = 1; i <= 5; i++) {
        addBreadcrumb({ message: `Event ${i}` })
      }

      captureException(new Error('Test'))

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      const breadcrumbs = events[0].breadcrumbs!

      expect(breadcrumbs[0].message).toBe('Event 1')
      expect(breadcrumbs[4].message).toBe('Event 5')
    })

    it('should respect maxBreadcrumbs setting', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
        maxBreadcrumbs: 3,
      })

      for (let i = 1; i <= 10; i++) {
        addBreadcrumb({ message: `Event ${i}` })
      }

      captureException(new Error('Test'))

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      const breadcrumbs = events[0].breadcrumbs!

      expect(breadcrumbs.length).toBe(3)
      expect(breadcrumbs[0].message).toBe('Event 8')
      expect(breadcrumbs[2].message).toBe('Event 10')
    })
  })
})
