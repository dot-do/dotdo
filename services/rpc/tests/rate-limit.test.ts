/**
 * Rate Limit Tests
 *
 * Tests for rate limiting including:
 * - In-memory store
 * - Rate limit checks
 * - Concurrency limits
 * - Key generators
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  InMemoryRateLimitStore,
  tenantKeyGenerator,
  userKeyGenerator,
  ipKeyGenerator,
  DEFAULT_TIER_CONFIGS,
} from '../src/rate-limit'
import type { RateLimitConfig, RateLimitResult } from '../src/types'

describe('Rate Limiting', () => {
  describe('InMemoryRateLimitStore', () => {
    let store: InMemoryRateLimitStore

    beforeEach(() => {
      store = new InMemoryRateLimitStore()
    })

    it('should allow requests within limit', async () => {
      const config: RateLimitConfig = { rpm: 10 }

      const result = await store.check('tenant-1', config)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
    })

    it('should block requests exceeding limit', async () => {
      const config: RateLimitConfig = { rpm: 3 }

      // Make 3 requests (within limit)
      await store.check('tenant-1', config)
      await store.check('tenant-1', config)
      await store.check('tenant-1', config)

      // 4th request should be blocked
      const result = await store.check('tenant-1', config)

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.limitType).toBe('rpm')
    })

    it('should track different keys separately', async () => {
      const config: RateLimitConfig = { rpm: 2 }

      // Exhaust limit for tenant-1
      await store.check('tenant-1', config)
      await store.check('tenant-1', config)
      const blocked = await store.check('tenant-1', config)

      // tenant-2 should still be allowed
      const result = await store.check('tenant-2', config)

      expect(blocked.allowed).toBe(false)
      expect(result.allowed).toBe(true)
    })

    it('should respect multiple time windows', async () => {
      const config: RateLimitConfig = { rpm: 100, rph: 5 }

      // Make 5 requests (within minute limit but at hour limit)
      for (let i = 0; i < 5; i++) {
        await store.check('tenant-1', config)
      }

      // 6th request should be blocked by hour limit
      const result = await store.check('tenant-1', config)

      expect(result.allowed).toBe(false)
      expect(result.limitType).toBe('rph')
    })

    it('should include reset time', async () => {
      const config: RateLimitConfig = { rpm: 10 }

      const result = await store.check('tenant-1', config)

      expect(result.resetIn).toBeGreaterThan(0)
      expect(result.resetIn).toBeLessThanOrEqual(60)
    })

    it('should clear all data', async () => {
      const config: RateLimitConfig = { rpm: 2 }

      // Use up limit
      await store.check('tenant-1', config)
      await store.check('tenant-1', config)
      const beforeClear = await store.check('tenant-1', config)

      // Clear and check again
      store.clear()
      const afterClear = await store.check('tenant-1', config)

      expect(beforeClear.allowed).toBe(false)
      expect(afterClear.allowed).toBe(true)
    })

    describe('Concurrency Limits', () => {
      it('should acquire concurrency slot', async () => {
        const acquired = await store.acquireConcurrency('tenant-1', 5)
        expect(acquired).toBe(true)
      })

      it('should block when at concurrency limit', async () => {
        // Acquire all slots
        await store.acquireConcurrency('tenant-1', 2)
        await store.acquireConcurrency('tenant-1', 2)

        // Should be blocked
        const result = await store.acquireConcurrency('tenant-1', 2)
        expect(result).toBe(false)
      })

      it('should release concurrency slot', async () => {
        await store.acquireConcurrency('tenant-1', 1)
        await store.releaseConcurrency('tenant-1')

        // Should be able to acquire again
        const result = await store.acquireConcurrency('tenant-1', 1)
        expect(result).toBe(true)
      })

      it('should track concurrency per key', async () => {
        await store.acquireConcurrency('tenant-1', 1)

        // Different tenant should have its own limit
        const result = await store.acquireConcurrency('tenant-2', 1)
        expect(result).toBe(true)
      })
    })
  })

  describe('Default Tier Configs', () => {
    it('should have free tier', () => {
      expect(DEFAULT_TIER_CONFIGS.free).toBeDefined()
      expect(DEFAULT_TIER_CONFIGS.free.rpm).toBe(60)
      expect(DEFAULT_TIER_CONFIGS.free.concurrency).toBe(5)
    })

    it('should have pro tier with higher limits', () => {
      expect(DEFAULT_TIER_CONFIGS.pro).toBeDefined()
      expect(DEFAULT_TIER_CONFIGS.pro.rpm).toBeGreaterThan(DEFAULT_TIER_CONFIGS.free.rpm!)
    })

    it('should have enterprise tier with highest limits', () => {
      expect(DEFAULT_TIER_CONFIGS.enterprise).toBeDefined()
      expect(DEFAULT_TIER_CONFIGS.enterprise.rpm).toBeGreaterThan(DEFAULT_TIER_CONFIGS.pro.rpm!)
    })

    it('should have unlimited tier', () => {
      expect(DEFAULT_TIER_CONFIGS.unlimited).toBeDefined()
      expect(DEFAULT_TIER_CONFIGS.unlimited.rpm).toBeUndefined()
      expect(DEFAULT_TIER_CONFIGS.unlimited.concurrency).toBeDefined()
    })
  })

  describe('Key Generators', () => {
    it('tenantKeyGenerator should extract tenant ID from auth', () => {
      const mockContext = {
        get: vi.fn((key: string) => {
          if (key === 'auth') {
            return { tenantId: 'my-tenant' }
          }
          return undefined
        }),
        req: {
          header: vi.fn(() => undefined),
        },
      }

      const key = tenantKeyGenerator(mockContext as any)
      expect(key).toBe('my-tenant')
    })

    it('tenantKeyGenerator should fall back to IP', () => {
      const mockContext = {
        get: vi.fn(() => undefined),
        req: {
          header: vi.fn((name: string) => {
            if (name === 'cf-connecting-ip') return '192.168.1.1'
            return undefined
          }),
        },
      }

      const key = tenantKeyGenerator(mockContext as any)
      expect(key).toBe('192.168.1.1')
    })

    it('userKeyGenerator should extract user ID from auth', () => {
      const mockContext = {
        get: vi.fn((key: string) => {
          if (key === 'auth') {
            return { userId: 'user-123' }
          }
          return undefined
        }),
        req: {
          header: vi.fn(() => undefined),
        },
      }

      const key = userKeyGenerator(mockContext as any)
      expect(key).toBe('user-123')
    })

    it('ipKeyGenerator should extract IP from header', () => {
      const mockContext = {
        req: {
          header: vi.fn((name: string) => {
            if (name === 'cf-connecting-ip') return '10.0.0.1'
            return undefined
          }),
        },
      }

      const key = ipKeyGenerator(mockContext as any)
      expect(key).toBe('10.0.0.1')
    })

    it('ipKeyGenerator should fall back to x-forwarded-for', () => {
      const mockContext = {
        req: {
          header: vi.fn((name: string) => {
            if (name === 'x-forwarded-for') return '172.16.0.1'
            return undefined
          }),
        },
      }

      const key = ipKeyGenerator(mockContext as any)
      expect(key).toBe('172.16.0.1')
    })
  })
})
