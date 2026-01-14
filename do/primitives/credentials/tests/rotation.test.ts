/**
 * Rotation tests - Automatic credential rotation with configurable schedules
 *
 * TDD: These tests define the expected behavior of credential rotation.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { RotationManager, createRotationManager, type RotationConfig } from '../rotation'
import { createSecureVault } from '../vault'

// Mock fetch for OAuth refresh tests
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

afterEach(() => {
  mockFetch.mockReset()
  vi.useRealTimers()
})

function createTestRotationManager(config?: Partial<RotationConfig>): RotationManager {
  const vault = createSecureVault({
    encryptionKey: 'test-encryption-key-32-bytes-ok!',
  })
  return createRotationManager({ vault, ...config })
}

describe('RotationManager - Automatic Rotation', () => {
  describe('Manual Rotation', () => {
    it('should rotate credential with new value', async () => {
      const manager = createTestRotationManager()

      await manager.registerCredential('manual-key', 'old-value', { policy: 'manual' })
      await manager.rotate('manual-key', 'new-value')

      const current = await manager.getCurrentValue('manual-key')
      expect(current).toBe('new-value')
    })

    it('should increment version on rotation', async () => {
      const manager = createTestRotationManager()

      await manager.registerCredential('versioned', 'v1', { policy: 'manual' })
      const beforeRotate = await manager.getCredentialInfo('versioned')
      expect(beforeRotate?.version).toBe(1)

      await manager.rotate('versioned', 'v2')

      const afterRotate = await manager.getCredentialInfo('versioned')
      expect(afterRotate?.version).toBe(2)
    })

    it('should track rotation history', async () => {
      const manager = createTestRotationManager()

      await manager.registerCredential('history-key', 'initial', { policy: 'manual' })
      await manager.rotate('history-key', 'rotated-1')
      await manager.rotate('history-key', 'rotated-2')

      const history = await manager.getRotationHistory('history-key')
      expect(history).toHaveLength(2) // 2 rotations (not counting initial)
      expect(history[0].previousVersion).toBe(1)
      expect(history[0].newVersion).toBe(2)
    })
  })

  describe('Scheduled Rotation', () => {
    it('should calculate next rotation date from schedule', async () => {
      const manager = createTestRotationManager()
      const now = Date.now()

      await manager.registerCredential('scheduled-key', 'value', {
        policy: 'scheduled',
        schedule: '7d', // Weekly
      })

      const info = await manager.getCredentialInfo('scheduled-key')

      // Should be approximately 7 days from now
      expect(info?.nextRotation).toBeDefined()
      expect(info!.nextRotation!.getTime()).toBeGreaterThan(now + 6 * 24 * 60 * 60 * 1000)
      expect(info!.nextRotation!.getTime()).toBeLessThanOrEqual(now + 8 * 24 * 60 * 60 * 1000)
    })

    it('should support various schedule formats', async () => {
      const manager = createTestRotationManager()

      // Test different duration formats
      const schedules = [
        { schedule: '1h', minMs: 59 * 60 * 1000, maxMs: 61 * 60 * 1000 },
        { schedule: '24h', minMs: 23 * 60 * 60 * 1000, maxMs: 25 * 60 * 60 * 1000 },
        { schedule: '30d', minMs: 29 * 24 * 60 * 60 * 1000, maxMs: 31 * 24 * 60 * 60 * 1000 },
      ]

      for (const { schedule, minMs, maxMs } of schedules) {
        const name = `schedule-${schedule}`
        await manager.registerCredential(name, 'value', {
          policy: 'scheduled',
          schedule,
        })

        const info = await manager.getCredentialInfo(name)
        const diff = info!.nextRotation!.getTime() - Date.now()
        expect(diff).toBeGreaterThan(minMs)
        expect(diff).toBeLessThan(maxMs)
      }
    })

    it('should update next rotation after manual rotation', async () => {
      const manager = createTestRotationManager()

      await manager.registerCredential('update-schedule', 'value', {
        policy: 'scheduled',
        schedule: '1d',
      })

      const before = await manager.getCredentialInfo('update-schedule')

      // Wait a small amount to ensure time difference
      await new Promise((r) => setTimeout(r, 10))

      await manager.rotate('update-schedule', 'new-value')
      const after = await manager.getCredentialInfo('update-schedule')

      // Next rotation should be recalculated from now (>= since timing can be close)
      expect(after!.nextRotation!.getTime()).toBeGreaterThanOrEqual(before!.nextRotation!.getTime())
    })

    it('should list credentials due for rotation', async () => {
      const manager = createTestRotationManager()

      const pastDate = new Date(Date.now() - 86400000) // Yesterday
      const futureDate = new Date(Date.now() + 86400000) // Tomorrow

      await manager.registerCredential('overdue', 'value', {
        policy: 'scheduled',
        schedule: '1d',
        nextRotation: pastDate,
      })

      await manager.registerCredential('upcoming', 'value', {
        policy: 'scheduled',
        schedule: '1d',
        nextRotation: futureDate,
      })

      const due = await manager.listDueForRotation()

      expect(due).toHaveLength(1)
      expect(due[0].name).toBe('overdue')
    })
  })

  describe('OAuth2 Auto-Refresh', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    it('should auto-refresh OAuth2 token before expiry', async () => {
      vi.useRealTimers() // Need real timers for fetch
      const manager = createTestRotationManager()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      })

      const expiresAt = new Date(Date.now() + 60000) // Expires in 1 minute

      await manager.registerOAuthCredential('oauth-key', {
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt,
        refreshEndpoint: 'https://oauth.example.com/token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshBeforeExpiry: 300000, // 5 minutes
      })

      // This should trigger refresh since token expires within refresh window
      const token = await manager.getOAuthToken('oauth-key', { autoRefresh: true })

      expect(token?.accessToken).toBe('new-access-token')
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should handle refresh token rotation', async () => {
      vi.useRealTimers()
      const manager = createTestRotationManager()

      const expiresAt = new Date(Date.now() - 1000) // Already expired

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'rotated-refresh', // New refresh token
          expires_in: 3600,
        }),
      })

      await manager.registerOAuthCredential('rotating-refresh', {
        accessToken: 'expired-access',
        refreshToken: 'old-refresh',
        expiresAt,
        refreshEndpoint: 'https://oauth.example.com/token',
        clientId: 'id',
        clientSecret: 'secret',
      })

      await manager.getOAuthToken('rotating-refresh', { autoRefresh: true })

      const afterRefresh = await manager.getOAuthToken('rotating-refresh')
      expect(afterRefresh?.refreshToken).toBe('rotated-refresh')
    })

    it('should retry on transient refresh failures', async () => {
      vi.useRealTimers()
      const manager = createTestRotationManager()

      const expiresAt = new Date(Date.now() - 1000)

      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'success-token',
            expires_in: 3600,
          }),
        })

      await manager.registerOAuthCredential('retry-refresh', {
        accessToken: 'expired',
        refreshToken: 'refresh',
        expiresAt,
        refreshEndpoint: 'https://oauth.example.com/token',
        clientId: 'id',
        clientSecret: 'secret',
        maxRetries: 3,
      })

      const token = await manager.getOAuthToken('retry-refresh', { autoRefresh: true })

      expect(token?.accessToken).toBe('success-token')
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should emit event on refresh failure after max retries', async () => {
      vi.useRealTimers()
      const manager = createTestRotationManager()

      const events: string[] = []
      manager.on('refresh:failed', () => events.push('failed'))

      const expiresAt = new Date(Date.now() - 1000)

      mockFetch.mockRejectedValue(new Error('Permanent failure'))

      await manager.registerOAuthCredential('fail-refresh', {
        accessToken: 'expired',
        refreshToken: 'refresh',
        expiresAt,
        refreshEndpoint: 'https://oauth.example.com/token',
        clientId: 'id',
        clientSecret: 'secret',
        maxRetries: 2,
      })

      await expect(manager.getOAuthToken('fail-refresh', { autoRefresh: true })).rejects.toThrow()

      expect(events).toContain('failed')
    })

    it('should prevent concurrent refresh attempts', async () => {
      vi.useRealTimers()
      const manager = createTestRotationManager()

      let refreshCount = 0

      mockFetch.mockImplementation(async () => {
        refreshCount++
        await new Promise((r) => setTimeout(r, 100))
        return {
          ok: true,
          json: async () => ({
            access_token: `token-${refreshCount}`,
            expires_in: 3600,
          }),
        }
      })

      const expiresAt = new Date(Date.now() - 1000)

      await manager.registerOAuthCredential('concurrent-refresh', {
        accessToken: 'expired',
        refreshToken: 'refresh',
        expiresAt,
        refreshEndpoint: 'https://oauth.example.com/token',
        clientId: 'id',
        clientSecret: 'secret',
      })

      // Concurrent refresh attempts
      await Promise.all([
        manager.getOAuthToken('concurrent-refresh', { autoRefresh: true }),
        manager.getOAuthToken('concurrent-refresh', { autoRefresh: true }),
        manager.getOAuthToken('concurrent-refresh', { autoRefresh: true }),
      ])

      // Should only have refreshed once due to locking
      expect(refreshCount).toBe(1)
    })
  })

  describe('Rotation Callbacks', () => {
    it('should call pre-rotation hook before rotation', async () => {
      const preRotate = vi.fn()
      const manager = createTestRotationManager({
        onPreRotate: preRotate,
      })

      await manager.registerCredential('callback-key', 'old', { policy: 'manual' })
      await manager.rotate('callback-key', 'new')

      expect(preRotate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'callback-key',
          previousValue: 'old',
          newValue: 'new',
        })
      )
    })

    it('should call post-rotation hook after rotation', async () => {
      const postRotate = vi.fn()
      const manager = createTestRotationManager({
        onPostRotate: postRotate,
      })

      await manager.registerCredential('post-callback', 'old', { policy: 'manual' })
      await manager.rotate('post-callback', 'new')

      expect(postRotate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'post-callback',
          version: 2,
        })
      )
    })

    it('should abort rotation if pre-rotate hook throws', async () => {
      const manager = createTestRotationManager({
        onPreRotate: async () => {
          throw new Error('Validation failed')
        },
      })

      await manager.registerCredential('abort-key', 'original', { policy: 'manual' })

      await expect(manager.rotate('abort-key', 'new')).rejects.toThrow('Validation failed')

      const current = await manager.getCurrentValue('abort-key')
      expect(current).toBe('original')
    })
  })
})
