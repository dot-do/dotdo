/**
 * @dotdo/sentry - Breadcrumbs Tests
 *
 * RED phase: Tests for breadcrumb functionality
 * - addBreadcrumb
 * - BreadcrumbManager
 * - Factory functions for different breadcrumb types
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as Sentry from '../src/index.js'
import {
  BreadcrumbManager,
  createHttpBreadcrumb,
  createNavigationBreadcrumb,
  createConsoleBreadcrumb,
  createClickBreadcrumb,
  createErrorBreadcrumb,
  createQueryBreadcrumb,
  createBreadcrumb,
} from '../src/breadcrumbs.js'

describe('@dotdo/sentry - Breadcrumbs', () => {
  beforeEach(() => {
    Sentry._clear()
  })

  afterEach(() => {
    Sentry._clear()
  })

  describe('addBreadcrumb', () => {
    it('should add breadcrumb to current scope', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      Sentry.addBreadcrumb({
        category: 'test',
        message: 'Test breadcrumb',
        level: 'info',
      })

      const scope = Sentry.getCurrentScope()
      const breadcrumbs = scope.getBreadcrumbs()

      expect(breadcrumbs).toHaveLength(1)
      expect(breadcrumbs[0]).toMatchObject({
        category: 'test',
        message: 'Test breadcrumb',
        level: 'info',
      })
    })

    it('should auto-populate timestamp', () => {
      Sentry.init({ dsn: 'https://key@o0.ingest.sentry.io/123' })

      const before = Date.now() / 1000

      Sentry.addBreadcrumb({
        category: 'test',
        message: 'Test',
      })

      const after = Date.now() / 1000

      const scope = Sentry.getCurrentScope()
      const breadcrumbs = scope.getBreadcrumbs()
      const timestamp = breadcrumbs[0]?.timestamp ?? 0

      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })

    it('should respect maxBreadcrumbs option', () => {
      Sentry.init({
        dsn: 'https://key@o0.ingest.sentry.io/123',
        maxBreadcrumbs: 3,
      })

      for (let i = 0; i < 5; i++) {
        Sentry.addBreadcrumb({ message: `Breadcrumb ${i}` })
      }

      const scope = Sentry.getCurrentScope()
      const breadcrumbs = scope.getBreadcrumbs()

      expect(breadcrumbs).toHaveLength(3)
      // Should keep the most recent ones
      expect(breadcrumbs[0]?.message).toBe('Breadcrumb 2')
      expect(breadcrumbs[1]?.message).toBe('Breadcrumb 3')
      expect(breadcrumbs[2]?.message).toBe('Breadcrumb 4')
    })
  })

  describe('beforeBreadcrumb hook', () => {
    it('should allow filtering breadcrumbs', () => {
      Sentry.init({
        dsn: 'https://key@o0.ingest.sentry.io/123',
        beforeBreadcrumb: (breadcrumb) => {
          if (breadcrumb.category === 'ignore') {
            return null
          }
          return breadcrumb
        },
      })

      Sentry.addBreadcrumb({ category: 'keep', message: 'Keep me' })
      Sentry.addBreadcrumb({ category: 'ignore', message: 'Ignore me' })
      Sentry.addBreadcrumb({ category: 'keep', message: 'Keep me too' })

      const scope = Sentry.getCurrentScope()
      const breadcrumbs = scope.getBreadcrumbs()

      expect(breadcrumbs).toHaveLength(2)
      expect(breadcrumbs.every((b) => b.category === 'keep')).toBe(true)
    })

    it('should allow modifying breadcrumbs', () => {
      Sentry.init({
        dsn: 'https://key@o0.ingest.sentry.io/123',
        beforeBreadcrumb: (breadcrumb) => ({
          ...breadcrumb,
          data: { ...breadcrumb.data, modified: true },
        }),
      })

      Sentry.addBreadcrumb({ category: 'test', message: 'Test' })

      const scope = Sentry.getCurrentScope()
      const breadcrumbs = scope.getBreadcrumbs()

      expect(breadcrumbs[0]?.data?.modified).toBe(true)
    })
  })

  describe('BreadcrumbManager', () => {
    it('should store breadcrumbs up to max limit', () => {
      const manager = new BreadcrumbManager({ maxBreadcrumbs: 5 })

      for (let i = 0; i < 10; i++) {
        manager.add({ message: `Breadcrumb ${i}` })
      }

      expect(manager.length).toBe(5)
      expect(manager.getAll()).toHaveLength(5)
    })

    it('should filter by category', () => {
      const manager = new BreadcrumbManager()

      manager.add({ category: 'http', message: 'HTTP request' })
      manager.add({ category: 'navigation', message: 'Navigate' })
      manager.add({ category: 'http', message: 'Another HTTP' })

      const httpBreadcrumbs = manager.getByCategory('http')
      expect(httpBreadcrumbs).toHaveLength(2)
    })

    it('should filter by level', () => {
      const manager = new BreadcrumbManager()

      manager.add({ level: 'info', message: 'Info' })
      manager.add({ level: 'error', message: 'Error' })
      manager.add({ level: 'info', message: 'Another info' })

      const errorBreadcrumbs = manager.getByLevel('error')
      expect(errorBreadcrumbs).toHaveLength(1)
    })

    it('should get breadcrumbs since timestamp', () => {
      const manager = new BreadcrumbManager()

      const timestamp1 = Date.now() / 1000 - 10
      const timestamp2 = Date.now() / 1000 - 5
      const timestamp3 = Date.now() / 1000

      manager.add({ message: 'Old', timestamp: timestamp1 })
      manager.add({ message: 'Medium', timestamp: timestamp2 })
      manager.add({ message: 'New', timestamp: timestamp3 })

      const recent = manager.getSince(timestamp2)
      expect(recent).toHaveLength(2)
    })

    it('should get last N breadcrumbs', () => {
      const manager = new BreadcrumbManager()

      for (let i = 0; i < 10; i++) {
        manager.add({ message: `Breadcrumb ${i}` })
      }

      const last3 = manager.getLast(3)
      expect(last3).toHaveLength(3)
      expect(last3[0]?.message).toBe('Breadcrumb 7')
    })

    it('should clear all breadcrumbs', () => {
      const manager = new BreadcrumbManager()

      manager.add({ message: 'Test 1' })
      manager.add({ message: 'Test 2' })

      manager.clear()

      expect(manager.length).toBe(0)
    })

    it('should respect enabledCategories filter', () => {
      const manager = new BreadcrumbManager({
        enabledCategories: ['http', 'navigation'],
      })

      manager.add({ category: 'http', message: 'HTTP' })
      manager.add({ category: 'console', message: 'Console' })
      manager.add({ category: 'navigation', message: 'Nav' })

      expect(manager.length).toBe(2)
    })

    it('should respect disabledCategories filter', () => {
      const manager = new BreadcrumbManager({
        disabledCategories: ['console'],
      })

      manager.add({ category: 'http', message: 'HTTP' })
      manager.add({ category: 'console', message: 'Console' })
      manager.add({ category: 'navigation', message: 'Nav' })

      expect(manager.length).toBe(2)
    })
  })

  describe('createHttpBreadcrumb', () => {
    it('should create HTTP breadcrumb with success status', () => {
      const breadcrumb = createHttpBreadcrumb({
        method: 'GET',
        url: 'https://api.example.com/users',
        statusCode: 200,
        duration: 150,
      })

      expect(breadcrumb).toMatchObject({
        type: 'http',
        category: 'http',
        level: 'info',
        message: 'GET https://api.example.com/users',
        data: {
          method: 'GET',
          url: 'https://api.example.com/users',
          status_code: 200,
          duration_ms: 150,
        },
      })
    })

    it('should set warning level for 4xx status', () => {
      const breadcrumb = createHttpBreadcrumb({
        method: 'POST',
        url: '/api/login',
        statusCode: 401,
      })

      expect(breadcrumb.level).toBe('warning')
    })

    it('should set error level for 5xx status', () => {
      const breadcrumb = createHttpBreadcrumb({
        method: 'GET',
        url: '/api/data',
        statusCode: 500,
      })

      expect(breadcrumb.level).toBe('error')
    })

    it('should include failure reason', () => {
      const breadcrumb = createHttpBreadcrumb({
        method: 'GET',
        url: '/api/data',
        reason: 'Network error',
      })

      expect(breadcrumb.data?.reason).toBe('Network error')
    })
  })

  describe('createNavigationBreadcrumb', () => {
    it('should create navigation breadcrumb', () => {
      const breadcrumb = createNavigationBreadcrumb({
        from: '/home',
        to: '/dashboard',
        navigationType: 'push',
      })

      expect(breadcrumb).toMatchObject({
        type: 'navigation',
        category: 'navigation',
        level: 'info',
        message: 'Navigating from /home to /dashboard',
        data: {
          from: '/home',
          to: '/dashboard',
          navigation_type: 'push',
        },
      })
    })
  })

  describe('createConsoleBreadcrumb', () => {
    it('should create console breadcrumb with appropriate level', () => {
      const logBreadcrumb = createConsoleBreadcrumb('log', 'Log message')
      const errorBreadcrumb = createConsoleBreadcrumb('error', 'Error message')
      const warnBreadcrumb = createConsoleBreadcrumb('warn', 'Warning')

      expect(logBreadcrumb.level).toBe('log')
      expect(errorBreadcrumb.level).toBe('error')
      expect(warnBreadcrumb.level).toBe('warning')
    })

    it('should include arguments in data', () => {
      const breadcrumb = createConsoleBreadcrumb('log', 'Message', ['arg1', 'arg2'])

      expect(breadcrumb.data?.arguments).toEqual(['arg1', 'arg2'])
    })
  })

  describe('createClickBreadcrumb', () => {
    it('should create click breadcrumb', () => {
      const breadcrumb = createClickBreadcrumb({
        target: 'button#submit',
        text: 'Submit Order',
        attributes: { class: 'btn-primary' },
      })

      expect(breadcrumb).toMatchObject({
        type: 'ui',
        category: 'ui.click',
        level: 'info',
        message: 'Submit Order',
        data: {
          target: 'button#submit',
          class: 'btn-primary',
        },
      })
    })
  })

  describe('createErrorBreadcrumb', () => {
    it('should create error breadcrumb from Error object', () => {
      const error = new Error('Test error')
      const breadcrumb = createErrorBreadcrumb(error)

      expect(breadcrumb).toMatchObject({
        type: 'error',
        category: 'error',
        level: 'error',
        message: 'Test error',
      })
      expect(breadcrumb.data?.name).toBe('Error')
      expect(breadcrumb.data?.stack).toBeDefined()
    })

    it('should use custom message if provided', () => {
      const error = new Error('Original message')
      const breadcrumb = createErrorBreadcrumb(error, 'Custom message')

      expect(breadcrumb.message).toBe('Custom message')
      expect(breadcrumb.data?.original_message).toBe('Original message')
    })
  })

  describe('createQueryBreadcrumb', () => {
    it('should create query breadcrumb', () => {
      const breadcrumb = createQueryBreadcrumb({
        system: 'postgresql',
        query: 'SELECT * FROM users',
        duration: 50,
        rowCount: 10,
      })

      expect(breadcrumb).toMatchObject({
        type: 'query',
        category: 'query',
        level: 'info',
        message: 'SELECT * FROM users',
        data: {
          'db.system': 'postgresql',
          duration_ms: 50,
          row_count: 10,
        },
      })
    })

    it('should set warning level for slow queries', () => {
      const breadcrumb = createQueryBreadcrumb({
        system: 'mysql',
        query: 'SELECT * FROM large_table',
        duration: 5000,
        slowThreshold: 1000,
      })

      expect(breadcrumb.level).toBe('warning')
    })
  })

  describe('createBreadcrumb', () => {
    it('should create custom breadcrumb', () => {
      const breadcrumb = createBreadcrumb('custom-category', 'Custom message', {
        type: 'user',
        level: 'debug',
        data: { custom: 'data' },
      })

      expect(breadcrumb).toMatchObject({
        type: 'user',
        category: 'custom-category',
        level: 'debug',
        message: 'Custom message',
        data: { custom: 'data' },
      })
    })

    it('should use defaults for optional fields', () => {
      const breadcrumb = createBreadcrumb('test', 'Test message')

      expect(breadcrumb.type).toBe('default')
      expect(breadcrumb.level).toBe('info')
    })
  })
})
