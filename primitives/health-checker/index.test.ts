/**
 * HealthChecker Tests - TDD Red-Green-Refactor
 *
 * Comprehensive tests for health monitoring primitives
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  HealthChecker,
  HTTPChecker,
  DatabaseChecker,
  DiskChecker,
  MemoryChecker,
  CustomChecker,
  AlertManager,
  HistoryTracker,
  createHealthChecker,
  createHTTPChecker,
  createCustomChecker,
} from './index'
import type {
  HealthCheck,
  HealthReport,
  CheckResult,
  HealthStatus,
  AlertConfig,
  StatusChangeEvent,
  HTTPCheckerConfig,
} from './types'

// =============================================================================
// HealthChecker Basic Tests
// =============================================================================

describe('HealthChecker', () => {
  let healthChecker: HealthChecker

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    healthChecker = new HealthChecker()
  })

  afterEach(() => {
    healthChecker.stop()
    vi.useRealTimers()
  })

  describe('registration', () => {
    it('should register a health check', () => {
      const check: HealthCheck = {
        name: 'test-check',
        checker: async () => ({
          name: 'test-check',
          status: 'healthy',
          duration: 10,
        }),
      }

      healthChecker.register(check)
      expect(healthChecker.getChecks()).toContain('test-check')
    })

    it('should register multiple health checks', () => {
      healthChecker.register({
        name: 'check-1',
        checker: async () => ({ name: 'check-1', status: 'healthy', duration: 10 }),
      })
      healthChecker.register({
        name: 'check-2',
        checker: async () => ({ name: 'check-2', status: 'healthy', duration: 10 }),
      })

      const checks = healthChecker.getChecks()
      expect(checks).toContain('check-1')
      expect(checks).toContain('check-2')
      expect(checks).toHaveLength(2)
    })

    it('should throw error when registering duplicate check name', () => {
      healthChecker.register({
        name: 'duplicate',
        checker: async () => ({ name: 'duplicate', status: 'healthy', duration: 10 }),
      })

      expect(() => {
        healthChecker.register({
          name: 'duplicate',
          checker: async () => ({ name: 'duplicate', status: 'healthy', duration: 10 }),
        })
      }).toThrow('Check with name "duplicate" already exists')
    })

    it('should unregister a health check', () => {
      healthChecker.register({
        name: 'to-remove',
        checker: async () => ({ name: 'to-remove', status: 'healthy', duration: 10 }),
      })

      healthChecker.unregister('to-remove')
      expect(healthChecker.getChecks()).not.toContain('to-remove')
    })

    it('should not throw when unregistering non-existent check', () => {
      expect(() => healthChecker.unregister('non-existent')).not.toThrow()
    })
  })

  describe('check execution', () => {
    it('should run all registered checks', async () => {
      healthChecker.register({
        name: 'check-1',
        checker: async () => ({ name: 'check-1', status: 'healthy', duration: 10 }),
      })
      healthChecker.register({
        name: 'check-2',
        checker: async () => ({ name: 'check-2', status: 'healthy', duration: 20 }),
      })

      const report = await healthChecker.check()

      expect(report.checks).toHaveLength(2)
      expect(report.checks.map(c => c.name)).toContain('check-1')
      expect(report.checks.map(c => c.name)).toContain('check-2')
    })

    it('should return healthy status when all checks pass', async () => {
      healthChecker.register({
        name: 'check-1',
        checker: async () => ({ name: 'check-1', status: 'healthy', duration: 10 }),
      })
      healthChecker.register({
        name: 'check-2',
        checker: async () => ({ name: 'check-2', status: 'healthy', duration: 10 }),
      })

      const report = await healthChecker.check()

      expect(report.status).toBe('healthy')
    })

    it('should return unhealthy status when critical check fails', async () => {
      healthChecker.register({
        name: 'critical-check',
        checker: async () => ({ name: 'critical-check', status: 'unhealthy', duration: 10 }),
        critical: true,
      })

      const report = await healthChecker.check()

      expect(report.status).toBe('unhealthy')
    })

    it('should return degraded status when non-critical check fails', async () => {
      healthChecker.register({
        name: 'healthy-check',
        checker: async () => ({ name: 'healthy-check', status: 'healthy', duration: 10 }),
        critical: true,
      })
      healthChecker.register({
        name: 'unhealthy-check',
        checker: async () => ({ name: 'unhealthy-check', status: 'unhealthy', duration: 10 }),
        critical: false,
      })

      const report = await healthChecker.check()

      expect(report.status).toBe('degraded')
    })

    it('should include timestamp in report', async () => {
      healthChecker.register({
        name: 'check',
        checker: async () => ({ name: 'check', status: 'healthy', duration: 10 }),
      })

      const report = await healthChecker.check()

      expect(report.timestamp).toBe(Date.now())
    })

    it('should include total duration in report', async () => {
      healthChecker.register({
        name: 'check',
        checker: () => ({ name: 'check', status: 'healthy', duration: 50 }),
      })

      const report = await healthChecker.check()

      expect(report.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('single check execution', () => {
    it('should run a single check by name', async () => {
      healthChecker.register({
        name: 'single-check',
        checker: async () => ({
          name: 'single-check',
          status: 'healthy',
          duration: 10,
          message: 'All good',
        }),
      })

      const result = await healthChecker.checkOne('single-check')

      expect(result.name).toBe('single-check')
      expect(result.status).toBe('healthy')
      expect(result.message).toBe('All good')
    })

    it('should throw error when check not found', async () => {
      await expect(healthChecker.checkOne('non-existent')).rejects.toThrow(
        'Check with name "non-existent" not found'
      )
    })
  })

  describe('timeout handling', () => {
    it('should timeout check that takes too long', async () => {
      vi.useRealTimers() // Use real timers for this test

      healthChecker.register({
        name: 'slow-check',
        checker: async () => {
          await new Promise(resolve => setTimeout(resolve, 5000))
          return { name: 'slow-check', status: 'healthy', duration: 5000 }
        },
        timeout: 50, // Very short timeout
      })

      const result = await healthChecker.checkOne('slow-check')

      expect(result.status).toBe('unhealthy')
      expect(result.message).toContain('timed out')
    }, 10000)

    it('should use default timeout when not specified', async () => {
      vi.useRealTimers() // Use real timers for this test

      const checker = new HealthChecker({ defaultTimeout: 50 })
      checker.register({
        name: 'slow-check',
        checker: async () => {
          await new Promise(resolve => setTimeout(resolve, 5000))
          return { name: 'slow-check', status: 'healthy', duration: 5000 }
        },
      })

      const result = await checker.checkOne('slow-check')

      expect(result.status).toBe('unhealthy')
      expect(result.message).toContain('timed out')
      checker.stop()
    }, 10000)
  })

  describe('status retrieval', () => {
    it('should return healthy status when no checks run yet', () => {
      expect(healthChecker.getStatus()).toBe('healthy')
    })

    it('should return cached status without running checks', async () => {
      healthChecker.register({
        name: 'check',
        checker: async () => ({ name: 'check', status: 'unhealthy', duration: 10 }),
        critical: true,
      })

      // Before running checks
      expect(healthChecker.getStatus()).toBe('healthy')

      // Run checks
      await healthChecker.check()

      // After running checks
      expect(healthChecker.getStatus()).toBe('unhealthy')
    })

    it('should return cached report without running checks', async () => {
      healthChecker.register({
        name: 'check',
        checker: async () => ({ name: 'check', status: 'healthy', duration: 10 }),
      })

      await healthChecker.check()
      const report = healthChecker.getReport()

      expect(report.checks).toHaveLength(1)
      expect(report.status).toBe('healthy')
    })
  })

  describe('background monitoring', () => {
    it('should start background monitoring', async () => {
      let checkCount = 0
      healthChecker.register({
        name: 'periodic-check',
        checker: async () => {
          checkCount++
          return { name: 'periodic-check', status: 'healthy', duration: 10 }
        },
      })

      healthChecker.start(100)
      expect(healthChecker.isRunning()).toBe(true)

      vi.advanceTimersByTime(350)

      expect(checkCount).toBeGreaterThan(2)
    })

    it('should stop background monitoring', async () => {
      let checkCount = 0
      healthChecker.register({
        name: 'periodic-check',
        checker: async () => {
          checkCount++
          return { name: 'periodic-check', status: 'healthy', duration: 10 }
        },
      })

      healthChecker.start(100)
      vi.advanceTimersByTime(150)

      healthChecker.stop()
      expect(healthChecker.isRunning()).toBe(false)

      const countAfterStop = checkCount
      vi.advanceTimersByTime(300)

      expect(checkCount).toBe(countAfterStop)
    })

    it('should use check-specific intervals', async () => {
      let fastCheckCount = 0
      let slowCheckCount = 0

      healthChecker.register({
        name: 'fast-check',
        checker: async () => {
          fastCheckCount++
          return { name: 'fast-check', status: 'healthy', duration: 10 }
        },
        interval: 50,
      })

      healthChecker.register({
        name: 'slow-check',
        checker: async () => {
          slowCheckCount++
          return { name: 'slow-check', status: 'healthy', duration: 10 }
        },
        interval: 200,
      })

      healthChecker.start()
      vi.advanceTimersByTime(250)

      expect(fastCheckCount).toBeGreaterThan(slowCheckCount)
    })
  })

  describe('status change events', () => {
    it('should emit event when status changes', async () => {
      const events: StatusChangeEvent[] = []

      healthChecker.register({
        name: 'flaky-check',
        checker: vi.fn()
          .mockResolvedValueOnce({ name: 'flaky-check', status: 'healthy', duration: 10 })
          .mockResolvedValueOnce({ name: 'flaky-check', status: 'unhealthy', duration: 10 }),
        critical: true,
      })

      healthChecker.onStatusChange(event => events.push(event))

      await healthChecker.check() // healthy
      await healthChecker.check() // unhealthy

      expect(events).toHaveLength(1)
      expect(events[0].previousStatus).toBe('healthy')
      expect(events[0].newStatus).toBe('unhealthy')
      expect(events[0].triggeredBy).toBe('flaky-check')
    })

    it('should not emit event when status unchanged', async () => {
      const events: StatusChangeEvent[] = []

      healthChecker.register({
        name: 'stable-check',
        checker: async () => ({ name: 'stable-check', status: 'healthy', duration: 10 }),
      })

      healthChecker.onStatusChange(event => events.push(event))

      await healthChecker.check()
      await healthChecker.check()

      expect(events).toHaveLength(0)
    })

    it('should allow unsubscribing from status changes', async () => {
      const events: StatusChangeEvent[] = []

      healthChecker.register({
        name: 'flaky-check',
        checker: vi.fn()
          .mockResolvedValueOnce({ name: 'flaky-check', status: 'healthy', duration: 10 })
          .mockResolvedValueOnce({ name: 'flaky-check', status: 'unhealthy', duration: 10 })
          .mockResolvedValueOnce({ name: 'flaky-check', status: 'healthy', duration: 10 }),
        critical: true,
      })

      const unsubscribe = healthChecker.onStatusChange(event => events.push(event))

      await healthChecker.check() // healthy
      await healthChecker.check() // unhealthy - emits event
      unsubscribe()
      await healthChecker.check() // healthy - should not emit

      expect(events).toHaveLength(1)
    })
  })

  describe('critical vs non-critical checks', () => {
    it('should treat checks as non-critical by default', async () => {
      healthChecker.register({
        name: 'failing-check',
        checker: async () => ({ name: 'failing-check', status: 'unhealthy', duration: 10 }),
        // critical not specified - defaults to false
      })

      const report = await healthChecker.check()

      expect(report.status).toBe('degraded')
    })

    it('should be unhealthy only when critical checks fail', async () => {
      healthChecker.register({
        name: 'non-critical-failing',
        checker: async () => ({ name: 'non-critical-failing', status: 'unhealthy', duration: 10 }),
        critical: false,
      })

      healthChecker.register({
        name: 'critical-passing',
        checker: async () => ({ name: 'critical-passing', status: 'healthy', duration: 10 }),
        critical: true,
      })

      const report = await healthChecker.check()

      expect(report.status).toBe('degraded')
    })
  })

  describe('check dependencies', () => {
    it('should skip check if dependency is unhealthy', async () => {
      let dependentCheckRan = false

      healthChecker.register({
        name: 'database',
        checker: async () => ({ name: 'database', status: 'unhealthy', duration: 10 }),
        critical: true,
      })

      healthChecker.register({
        name: 'user-service',
        checker: async () => {
          dependentCheckRan = true
          return { name: 'user-service', status: 'healthy', duration: 10 }
        },
        dependencies: ['database'],
      })

      await healthChecker.check()

      expect(dependentCheckRan).toBe(false)
    })

    it('should run check if all dependencies are healthy', async () => {
      let dependentCheckRan = false

      healthChecker.register({
        name: 'database',
        checker: async () => ({ name: 'database', status: 'healthy', duration: 10 }),
        critical: true,
      })

      healthChecker.register({
        name: 'user-service',
        checker: async () => {
          dependentCheckRan = true
          return { name: 'user-service', status: 'healthy', duration: 10 }
        },
        dependencies: ['database'],
      })

      await healthChecker.check()

      expect(dependentCheckRan).toBe(true)
    })

    it('should mark skipped check as unhealthy with dependency info', async () => {
      healthChecker.register({
        name: 'database',
        checker: async () => ({ name: 'database', status: 'unhealthy', duration: 10 }),
        critical: true,
      })

      healthChecker.register({
        name: 'user-service',
        checker: async () => ({ name: 'user-service', status: 'healthy', duration: 10 }),
        dependencies: ['database'],
      })

      const report = await healthChecker.check()
      const userServiceResult = report.checks.find(c => c.name === 'user-service')

      expect(userServiceResult?.status).toBe('unhealthy')
      expect(userServiceResult?.message).toContain('dependency')
    })
  })

  describe('error handling', () => {
    it('should catch and report errors from checker function', async () => {
      healthChecker.register({
        name: 'error-check',
        checker: async () => {
          throw new Error('Something went wrong')
        },
        critical: true,
      })

      const report = await healthChecker.check()
      const errorResult = report.checks.find(c => c.name === 'error-check')

      expect(errorResult?.status).toBe('unhealthy')
      expect(errorResult?.message).toContain('Something went wrong')
    })

    it('should continue running other checks after error', async () => {
      healthChecker.register({
        name: 'error-check',
        checker: async () => {
          throw new Error('Boom')
        },
      })

      healthChecker.register({
        name: 'good-check',
        checker: async () => ({ name: 'good-check', status: 'healthy', duration: 10 }),
      })

      const report = await healthChecker.check()

      expect(report.checks).toHaveLength(2)
      expect(report.checks.find(c => c.name === 'good-check')?.status).toBe('healthy')
    })
  })
})

// =============================================================================
// HTTPChecker Tests
// =============================================================================

describe('HTTPChecker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should create a health check from HTTP config', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    })
    global.fetch = mockFetch

    const checker = new HTTPChecker({
      url: 'https://api.example.com/health',
    })

    const result = await checker.check()

    expect(result.status).toBe('healthy')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/health',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('should report unhealthy on non-200 status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })
    global.fetch = mockFetch

    const checker = new HTTPChecker({
      url: 'https://api.example.com/health',
    })

    const result = await checker.check()

    expect(result.status).toBe('unhealthy')
    expect(result.details?.statusCode).toBe(500)
  })

  it('should accept custom expected status codes', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 204,
    })
    global.fetch = mockFetch

    const checker = new HTTPChecker({
      url: 'https://api.example.com/health',
      expectedStatus: [200, 204],
    })

    const result = await checker.check()

    expect(result.status).toBe('healthy')
  })

  it('should send custom headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    })
    global.fetch = mockFetch

    const checker = new HTTPChecker({
      url: 'https://api.example.com/health',
      headers: {
        'Authorization': 'Bearer token123',
        'X-Custom-Header': 'value',
      },
    })

    await checker.check()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer token123',
          'X-Custom-Header': 'value',
        }),
      })
    )
  })

  it('should use custom HTTP method', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    })
    global.fetch = mockFetch

    const checker = new HTTPChecker({
      url: 'https://api.example.com/health',
      method: 'POST',
      body: JSON.stringify({ check: 'deep' }),
    })

    await checker.check()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ check: 'deep' }),
      })
    )
  })

  it('should handle network errors', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    global.fetch = mockFetch

    const checker = new HTTPChecker({
      url: 'https://api.example.com/health',
    })

    const result = await checker.check()

    expect(result.status).toBe('unhealthy')
    expect(result.message).toContain('Network error')
  })

  it('should measure response time', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    })
    global.fetch = mockFetch

    const checker = new HTTPChecker({
      url: 'https://api.example.com/health',
    })

    const result = await checker.check()

    expect(result.duration).toBeGreaterThanOrEqual(0)
    expect(typeof result.duration).toBe('number')
  })

  it('should convert to HealthCheck format', () => {
    const checker = new HTTPChecker({
      url: 'https://api.example.com/health',
    })

    const healthCheck = checker.toHealthCheck('api-health')

    expect(healthCheck.name).toBe('api-health')
    expect(typeof healthCheck.checker).toBe('function')
  })
})

// =============================================================================
// DatabaseChecker Tests
// =============================================================================

describe('DatabaseChecker', () => {
  it('should check database connectivity', async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ result: 1 }])

    const checker = new DatabaseChecker({
      connection: 'postgresql://localhost:5432/test',
      query: 'SELECT 1',
    })

    // Inject mock query function
    checker.setQueryFn(mockQuery)

    const result = await checker.check()

    expect(result.status).toBe('healthy')
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1')
  })

  it('should report unhealthy on query failure', async () => {
    const mockQuery = vi.fn().mockRejectedValue(new Error('Connection refused'))

    const checker = new DatabaseChecker({
      connection: 'postgresql://localhost:5432/test',
    })

    checker.setQueryFn(mockQuery)

    const result = await checker.check()

    expect(result.status).toBe('unhealthy')
    expect(result.message).toContain('Connection refused')
  })

  it('should use default query when not specified', async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ result: 1 }])

    const checker = new DatabaseChecker({
      connection: 'postgresql://localhost:5432/test',
    })

    checker.setQueryFn(mockQuery)
    await checker.check()

    expect(mockQuery).toHaveBeenCalledWith('SELECT 1')
  })
})

// =============================================================================
// DiskChecker Tests
// =============================================================================

describe('DiskChecker', () => {
  it('should report healthy when disk usage is below threshold', async () => {
    const checker = new DiskChecker({
      path: '/var/data',
      warningThreshold: 80,
      criticalThreshold: 90,
    })

    // Mock disk stats
    checker.setStatsFn(async () => ({
      total: 100 * 1024 * 1024 * 1024, // 100GB
      used: 50 * 1024 * 1024 * 1024,   // 50GB (50%)
      free: 50 * 1024 * 1024 * 1024,
    }))

    const result = await checker.check()

    expect(result.status).toBe('healthy')
    expect(result.details?.percentUsed).toBe(50)
  })

  it('should report degraded when above warning threshold', async () => {
    const checker = new DiskChecker({
      path: '/var/data',
      warningThreshold: 80,
      criticalThreshold: 90,
    })

    checker.setStatsFn(async () => ({
      total: 100 * 1024 * 1024 * 1024,
      used: 85 * 1024 * 1024 * 1024, // 85%
      free: 15 * 1024 * 1024 * 1024,
    }))

    const result = await checker.check()

    expect(result.status).toBe('degraded')
  })

  it('should report unhealthy when above critical threshold', async () => {
    const checker = new DiskChecker({
      path: '/var/data',
      warningThreshold: 80,
      criticalThreshold: 90,
    })

    checker.setStatsFn(async () => ({
      total: 100 * 1024 * 1024 * 1024,
      used: 95 * 1024 * 1024 * 1024, // 95%
      free: 5 * 1024 * 1024 * 1024,
    }))

    const result = await checker.check()

    expect(result.status).toBe('unhealthy')
  })
})

// =============================================================================
// MemoryChecker Tests
// =============================================================================

describe('MemoryChecker', () => {
  it('should report healthy when memory usage is below threshold', async () => {
    const checker = new MemoryChecker({
      warningThreshold: 80,
      criticalThreshold: 90,
    })

    checker.setStatsFn(async () => ({
      total: 16 * 1024 * 1024 * 1024, // 16GB
      used: 8 * 1024 * 1024 * 1024,  // 8GB (50%)
      free: 8 * 1024 * 1024 * 1024,
      heapTotal: 512 * 1024 * 1024,
      heapUsed: 256 * 1024 * 1024,
    }))

    const result = await checker.check()

    expect(result.status).toBe('healthy')
  })

  it('should report degraded when above warning threshold', async () => {
    const checker = new MemoryChecker({
      warningThreshold: 80,
      criticalThreshold: 90,
    })

    checker.setStatsFn(async () => ({
      total: 16 * 1024 * 1024 * 1024,
      used: 14 * 1024 * 1024 * 1024, // ~87.5%
      free: 2 * 1024 * 1024 * 1024,
    }))

    const result = await checker.check()

    expect(result.status).toBe('degraded')
  })

  it('should include heap details when configured', async () => {
    const checker = new MemoryChecker({
      includeHeapDetails: true,
    })

    checker.setStatsFn(async () => ({
      total: 16 * 1024 * 1024 * 1024,
      used: 8 * 1024 * 1024 * 1024,
      free: 8 * 1024 * 1024 * 1024,
      heapTotal: 512 * 1024 * 1024,
      heapUsed: 256 * 1024 * 1024,
    }))

    const result = await checker.check()

    expect(result.details?.heapTotal).toBeDefined()
    expect(result.details?.heapUsed).toBeDefined()
  })
})

// =============================================================================
// CustomChecker Tests
// =============================================================================

describe('CustomChecker', () => {
  it('should create checker from custom function', async () => {
    const checker = new CustomChecker(async () => ({
      name: 'custom',
      status: 'healthy',
      duration: 5,
      message: 'Custom check passed',
    }))

    const result = await checker.check()

    expect(result.status).toBe('healthy')
    expect(result.message).toBe('Custom check passed')
  })

  it('should handle sync checker functions', async () => {
    const checker = new CustomChecker(() => ({
      name: 'sync-custom',
      status: 'healthy',
      duration: 0,
    }))

    const result = await checker.check()

    expect(result.status).toBe('healthy')
  })

  it('should catch errors from custom function', async () => {
    const checker = new CustomChecker(async () => {
      throw new Error('Custom error')
    })

    const result = await checker.check()

    expect(result.status).toBe('unhealthy')
    expect(result.message).toContain('Custom error')
  })
})

// =============================================================================
// AlertManager Tests
// =============================================================================

describe('AlertManager', () => {
  let alertManager: AlertManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    alertManager = new AlertManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('configuration', () => {
    it('should configure alert settings', () => {
      const config: AlertConfig = {
        threshold: 3,
        channels: [{ type: 'webhook', config: { url: 'https://example.com/alert' } }],
        cooldown: 60000,
      }

      alertManager.configure(config)

      expect(alertManager.getConfig()).toEqual(config)
    })
  })

  describe('failure tracking', () => {
    it('should track consecutive failures', async () => {
      alertManager.configure({
        threshold: 3,
        channels: [],
        cooldown: 60000,
      })

      await alertManager.process({
        name: 'failing-check',
        status: 'unhealthy',
        duration: 10,
      })

      await alertManager.process({
        name: 'failing-check',
        status: 'unhealthy',
        duration: 10,
      })

      const counts = alertManager.getFailureCounts()
      expect(counts['failing-check']).toBe(2)
    })

    it('should reset failure count on success', async () => {
      alertManager.configure({
        threshold: 3,
        channels: [],
        cooldown: 60000,
      })

      await alertManager.process({ name: 'check', status: 'unhealthy', duration: 10 })
      await alertManager.process({ name: 'check', status: 'unhealthy', duration: 10 })
      await alertManager.process({ name: 'check', status: 'healthy', duration: 10 })

      const counts = alertManager.getFailureCounts()
      expect(counts['check']).toBe(0)
    })
  })

  describe('alert triggering', () => {
    it('should trigger alert when threshold reached', async () => {
      const alertFn = vi.fn()

      alertManager.configure({
        threshold: 2,
        channels: [{ type: 'custom', config: { handler: alertFn } }],
        cooldown: 60000,
      })

      await alertManager.process({ name: 'check', status: 'unhealthy', duration: 10 })
      expect(alertFn).not.toHaveBeenCalled()

      await alertManager.process({ name: 'check', status: 'unhealthy', duration: 10 })
      expect(alertFn).toHaveBeenCalledTimes(1)
    })

    it('should respect cooldown period', async () => {
      const alertFn = vi.fn()

      alertManager.configure({
        threshold: 1,
        channels: [{ type: 'custom', config: { handler: alertFn } }],
        cooldown: 60000,
      })

      await alertManager.process({ name: 'check', status: 'unhealthy', duration: 10 })
      expect(alertFn).toHaveBeenCalledTimes(1)

      // Still in cooldown
      await alertManager.process({ name: 'check', status: 'unhealthy', duration: 10 })
      expect(alertFn).toHaveBeenCalledTimes(1)

      // After cooldown
      vi.advanceTimersByTime(60001)
      await alertManager.process({ name: 'check', status: 'unhealthy', duration: 10 })
      expect(alertFn).toHaveBeenCalledTimes(2)
    })

    it('should only alert for configured checks', async () => {
      const alertFn = vi.fn()

      alertManager.configure({
        threshold: 1,
        channels: [{ type: 'custom', config: { handler: alertFn } }],
        cooldown: 60000,
        checks: ['important-check'],
      })

      await alertManager.process({ name: 'unimportant-check', status: 'unhealthy', duration: 10 })
      expect(alertFn).not.toHaveBeenCalled()

      await alertManager.process({ name: 'important-check', status: 'unhealthy', duration: 10 })
      expect(alertFn).toHaveBeenCalledTimes(1)
    })

    it('should only alert for configured statuses', async () => {
      const alertFn = vi.fn()

      alertManager.configure({
        threshold: 1,
        channels: [{ type: 'custom', config: { handler: alertFn } }],
        cooldown: 60000,
        statuses: ['unhealthy'],
      })

      await alertManager.process({ name: 'check', status: 'degraded', duration: 10 })
      expect(alertFn).not.toHaveBeenCalled()

      await alertManager.process({ name: 'check', status: 'unhealthy', duration: 10 })
      expect(alertFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('manual alerts', () => {
    it('should allow manual alert triggering', async () => {
      const alertFn = vi.fn()

      alertManager.configure({
        threshold: 3,
        channels: [{ type: 'custom', config: { handler: alertFn } }],
        cooldown: 60000,
      })

      await alertManager.alert('Manual alert', { severity: 'high' })

      expect(alertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Manual alert',
          details: { severity: 'high' },
        })
      )
    })
  })

  describe('reset', () => {
    it('should reset failure count for a check', async () => {
      alertManager.configure({
        threshold: 5,
        channels: [],
        cooldown: 60000,
      })

      await alertManager.process({ name: 'check', status: 'unhealthy', duration: 10 })
      await alertManager.process({ name: 'check', status: 'unhealthy', duration: 10 })

      alertManager.reset('check')

      const counts = alertManager.getFailureCounts()
      expect(counts['check']).toBe(0)
    })
  })
})

// =============================================================================
// HistoryTracker Tests
// =============================================================================

describe('HistoryTracker', () => {
  let historyTracker: HistoryTracker

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    historyTracker = new HistoryTracker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('recording', () => {
    it('should record check results', () => {
      historyTracker.record({
        name: 'check',
        status: 'healthy',
        duration: 10,
        timestamp: Date.now(),
      })

      const history = historyTracker.getHistory('check')
      expect(history).toHaveLength(1)
      expect(history[0].status).toBe('healthy')
    })

    it('should record multiple results', () => {
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'healthy', duration: 15 })
      historyTracker.record({ name: 'check', status: 'unhealthy', duration: 20 })

      const history = historyTracker.getHistory('check')
      expect(history).toHaveLength(3)
    })

    it('should limit history size', () => {
      historyTracker.setMaxSize(5)

      for (let i = 0; i < 10; i++) {
        historyTracker.record({ name: 'check', status: 'healthy', duration: i })
      }

      const history = historyTracker.getHistory('check')
      expect(history).toHaveLength(5)
      // Should keep most recent
      expect(history[history.length - 1].duration).toBe(9)
    })

    it('should return limited history', () => {
      for (let i = 0; i < 10; i++) {
        historyTracker.record({ name: 'check', status: 'healthy', duration: i })
      }

      const history = historyTracker.getHistory('check', 3)
      expect(history).toHaveLength(3)
    })
  })

  describe('trends', () => {
    it('should calculate success rate', () => {
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'unhealthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })

      const trend = historyTracker.getTrend('check')

      expect(trend?.successRate).toBe(0.75) // 3/4
    })

    it('should calculate average duration', () => {
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'healthy', duration: 20 })
      historyTracker.record({ name: 'check', status: 'healthy', duration: 30 })

      const trend = historyTracker.getTrend('check')

      expect(trend?.avgDuration).toBe(20) // (10+20+30)/3
    })

    it('should detect improving trend', () => {
      // Start with failures, end with successes
      historyTracker.record({ name: 'check', status: 'unhealthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'unhealthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'unhealthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })

      const trend = historyTracker.getTrend('check')

      expect(trend?.direction).toBe('improving')
    })

    it('should detect degrading trend', () => {
      // Start with successes, end with failures
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'unhealthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'unhealthy', duration: 10 })
      historyTracker.record({ name: 'check', status: 'unhealthy', duration: 10 })

      const trend = historyTracker.getTrend('check')

      expect(trend?.direction).toBe('degrading')
    })

    it('should detect stable trend', () => {
      // All same status
      for (let i = 0; i < 10; i++) {
        historyTracker.record({ name: 'check', status: 'healthy', duration: 10 })
      }

      const trend = historyTracker.getTrend('check')

      expect(trend?.direction).toBe('stable')
    })

    it('should return null trend for unknown check', () => {
      const trend = historyTracker.getTrend('unknown')
      expect(trend).toBeNull()
    })

    it('should get trends for all checks', () => {
      historyTracker.record({ name: 'check-1', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check-2', status: 'unhealthy', duration: 20 })

      const trends = historyTracker.getTrends()

      expect(trends).toHaveLength(2)
      expect(trends.map(t => t.name)).toContain('check-1')
      expect(trends.map(t => t.name)).toContain('check-2')
    })
  })

  describe('full history', () => {
    it('should return full history with trends', () => {
      historyTracker.record({ name: 'check', status: 'healthy', duration: 10, timestamp: 1000 })
      historyTracker.record({ name: 'check', status: 'healthy', duration: 20, timestamp: 2000 })

      const fullHistory = historyTracker.getFullHistory()

      expect(fullHistory.results).toHaveLength(2)
      expect(fullHistory.trends).toHaveLength(1)
      expect(fullHistory.startTime).toBe(1000)
      expect(fullHistory.endTime).toBe(2000)
    })
  })

  describe('clearing', () => {
    it('should clear history for a specific check', () => {
      historyTracker.record({ name: 'check-1', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check-2', status: 'healthy', duration: 10 })

      historyTracker.clear('check-1')

      expect(historyTracker.getHistory('check-1')).toHaveLength(0)
      expect(historyTracker.getHistory('check-2')).toHaveLength(1)
    })

    it('should clear all history', () => {
      historyTracker.record({ name: 'check-1', status: 'healthy', duration: 10 })
      historyTracker.record({ name: 'check-2', status: 'healthy', duration: 10 })

      historyTracker.clearAll()

      expect(historyTracker.getHistory('check-1')).toHaveLength(0)
      expect(historyTracker.getHistory('check-2')).toHaveLength(0)
    })
  })
})

// =============================================================================
// Factory Functions Tests
// =============================================================================

describe('Factory Functions', () => {
  it('should create health checker with createHealthChecker', () => {
    const checker = createHealthChecker()
    expect(checker).toBeInstanceOf(HealthChecker)
  })

  it('should create HTTP checker with createHTTPChecker', () => {
    const checker = createHTTPChecker({
      url: 'https://example.com/health',
    })
    expect(checker).toBeInstanceOf(HTTPChecker)
  })

  it('should create custom checker with createCustomChecker', () => {
    const checker = createCustomChecker(async () => ({
      name: 'custom',
      status: 'healthy',
      duration: 0,
    }))
    expect(checker).toBeInstanceOf(CustomChecker)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  it('should integrate HealthChecker with AlertManager', async () => {
    const alertFn = vi.fn()
    const healthChecker = new HealthChecker()
    const alertManager = new AlertManager()

    alertManager.configure({
      threshold: 2,
      channels: [{ type: 'custom', config: { handler: alertFn } }],
      cooldown: 60000,
    })

    let checkStatus: HealthStatus = 'healthy'
    healthChecker.register({
      name: 'flaky-check',
      checker: async () => ({
        name: 'flaky-check',
        status: checkStatus,
        duration: 10,
      }),
      critical: true,
    })

    healthChecker.onStatusChange(async (event) => {
      for (const check of event.report.checks) {
        await alertManager.process(check)
      }
    })

    await healthChecker.check() // healthy

    checkStatus = 'unhealthy'
    await healthChecker.check() // unhealthy - triggers status change
    await alertManager.process({ name: 'flaky-check', status: 'unhealthy', duration: 10 })
    await alertManager.process({ name: 'flaky-check', status: 'unhealthy', duration: 10 })

    expect(alertFn).toHaveBeenCalled()
    healthChecker.stop()
  })

  it('should integrate HealthChecker with HistoryTracker', async () => {
    const healthChecker = new HealthChecker()
    const historyTracker = new HistoryTracker()

    healthChecker.register({
      name: 'tracked-check',
      checker: async () => ({
        name: 'tracked-check',
        status: 'healthy',
        duration: 10,
      }),
    })

    healthChecker.onStatusChange((event) => {
      for (const check of event.report.checks) {
        historyTracker.record(check)
      }
    })

    // Initial check
    const report = await healthChecker.check()
    for (const check of report.checks) {
      historyTracker.record(check)
    }

    const history = historyTracker.getHistory('tracked-check')
    expect(history).toHaveLength(1)
    expect(history[0].status).toBe('healthy')

    healthChecker.stop()
  })
})
