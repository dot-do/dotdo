/**
 * TokenRefresher tests - OAuth2 token refresh with DO alarm scheduling
 *
 * TDD: These tests verify the TokenRefresher implementation.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { TokenRefresher, createTokenRefresher, type OAuth2TokenData, type TokenRefreshConfig, type TokenStorage, type TokenEventEmitter } from '../token-refresher'
import type { DOAlarmAdapter } from '../../../../objects/primitives/alarm-adapter'

// Mock fetch for OAuth refresh tests
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

afterEach(() => {
  mockFetch.mockReset()
  vi.useRealTimers()
})

function createMockAlarmAdapter(): DOAlarmAdapter {
  const callbacks = new Map<string, () => void | Promise<void>>()
  let scheduledTime: number | null = null

  return {
    scheduleAt: vi.fn(async (timestamp: number) => {
      scheduledTime = timestamp
    }),
    scheduleIn: vi.fn(async (delayMs: number) => {
      scheduledTime = Date.now() + delayMs
    }),
    cancel: vi.fn(async () => {
      scheduledTime = null
    }),
    getNextAlarmTime: vi.fn(async () => scheduledTime),
    onAlarm: vi.fn((name: string, callback: () => void | Promise<void>) => {
      callbacks.set(name, callback)
    }),
    offAlarm: vi.fn((name: string) => {
      callbacks.delete(name)
    }),
    handleAlarm: vi.fn(async () => {
      for (const callback of callbacks.values()) {
        await callback()
      }
    }),
  }
}

function createMockStorage(): TokenStorage & { tokens: Map<string, OAuth2TokenData> } {
  const tokens = new Map<string, OAuth2TokenData>()
  return {
    tokens,
    get: vi.fn(async (key: string) => tokens.get(key) ?? null),
    set: vi.fn(async (key: string, token: OAuth2TokenData) => {
      tokens.set(key, token)
    }),
    delete: vi.fn(async (key: string) => {
      tokens.delete(key)
    }),
  }
}

function createMockEventEmitter(): TokenEventEmitter & { events: Array<{ event: string; payload: unknown }> } {
  const events: Array<{ event: string; payload: unknown }> = []
  return {
    events,
    emit: vi.fn((event: string, payload: unknown) => {
      events.push({ event, payload })
    }),
  }
}

describe('TokenRefresher', () => {
  describe('Token Registration', () => {
    it('should register a token for management', async () => {
      const refresher = createTokenRefresher()

      const token: OAuth2TokenData = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 3600000),
      }

      const config: TokenRefreshConfig = {
        refreshEndpoint: 'https://oauth.example.com/token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      }

      await refresher.register('test-token', token, config)

      const result = await refresher.getToken('test-token')
      expect(result?.accessToken).toBe('access-token')
    })

    it('should list registered tokens', async () => {
      const refresher = createTokenRefresher()

      await refresher.register(
        'token-1',
        { accessToken: 'a1', expiresAt: new Date(Date.now() + 3600000) },
        { refreshEndpoint: 'https://oauth.example.com/token', clientId: 'id', clientSecret: 'secret' }
      )

      await refresher.register(
        'token-2',
        { accessToken: 'a2', expiresAt: new Date(Date.now() + 3600000) },
        { refreshEndpoint: 'https://oauth.example.com/token', clientId: 'id', clientSecret: 'secret' }
      )

      const tokens = refresher.listTokens()
      expect(tokens).toContain('token-1')
      expect(tokens).toContain('token-2')
      expect(tokens).toHaveLength(2)
    })

    it('should unregister a token', async () => {
      const refresher = createTokenRefresher()

      await refresher.register(
        'to-remove',
        { accessToken: 'a1', expiresAt: new Date(Date.now() + 3600000) },
        { refreshEndpoint: 'https://oauth.example.com/token', clientId: 'id', clientSecret: 'secret' }
      )

      await refresher.unregister('to-remove')

      const result = await refresher.getToken('to-remove')
      expect(result).toBeNull()
    })
  })

  describe('Proactive Refresh (5 minutes before expiry)', () => {
    it('should auto-refresh token before expiry', async () => {
      const refresher = createTokenRefresher()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      })

      // Token expires in 1 minute (within 5 minute refresh window)
      const expiresAt = new Date(Date.now() + 60000)

      await refresher.register(
        'oauth-key',
        {
          accessToken: 'old-access-token',
          refreshToken: 'refresh-token',
          expiresAt,
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          refreshBeforeExpiry: 300000, // 5 minutes
        }
      )

      // This should trigger refresh since token expires within refresh window
      const token = await refresher.getToken('oauth-key', { autoRefresh: true })

      expect(token?.accessToken).toBe('new-access-token')
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should not refresh token if not within refresh window', async () => {
      const refresher = createTokenRefresher()

      // Token expires in 10 minutes (outside 5 minute refresh window)
      const expiresAt = new Date(Date.now() + 600000)

      await refresher.register(
        'valid-token',
        {
          accessToken: 'current-access-token',
          refreshToken: 'refresh-token',
          expiresAt,
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          refreshBeforeExpiry: 300000, // 5 minutes
        }
      )

      const token = await refresher.getToken('valid-token', { autoRefresh: true })

      expect(token?.accessToken).toBe('current-access-token')
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('DO Alarm Scheduling', () => {
    it('should schedule alarm for token refresh', async () => {
      const alarmAdapter = createMockAlarmAdapter()
      const refresher = createTokenRefresher({ alarmAdapter })

      const expiresAt = new Date(Date.now() + 600000) // 10 minutes from now

      await refresher.register(
        'scheduled-token',
        {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresAt,
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          refreshBeforeExpiry: 300000, // 5 minutes
        }
      )

      // Should schedule alarm for 5 minutes before expiry
      expect(alarmAdapter.scheduleAt).toHaveBeenCalled()
      const scheduledTime = (alarmAdapter.scheduleAt as ReturnType<typeof vi.fn>).mock.calls[0][0]
      // Should be approximately 5 minutes from now (10 min expiry - 5 min buffer)
      expect(scheduledTime).toBeGreaterThan(Date.now() + 200000)
      expect(scheduledTime).toBeLessThan(Date.now() + 400000)
    })

    it('should register alarm callback on construction', async () => {
      const alarmAdapter = createMockAlarmAdapter()
      createTokenRefresher({ alarmAdapter })

      expect(alarmAdapter.onAlarm).toHaveBeenCalledWith('token-refresh', expect.any(Function))
    })
  })

  describe('Refresh Token Rotation', () => {
    it('should handle refresh token rotation', async () => {
      const refresher = createTokenRefresher()

      const expiresAt = new Date(Date.now() - 1000) // Already expired

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'rotated-refresh', // New refresh token
          expires_in: 3600,
        }),
      })

      await refresher.register(
        'rotating-refresh',
        {
          accessToken: 'expired-access',
          refreshToken: 'old-refresh',
          expiresAt,
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
        }
      )

      await refresher.getToken('rotating-refresh', { autoRefresh: true })

      const afterRefresh = await refresher.getToken('rotating-refresh')
      expect(afterRefresh?.refreshToken).toBe('rotated-refresh')
    })
  })

  describe('Retry with Exponential Backoff', () => {
    it('should retry on transient refresh failures', async () => {
      const refresher = createTokenRefresher()

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

      await refresher.register(
        'retry-refresh',
        {
          accessToken: 'expired',
          refreshToken: 'refresh',
          expiresAt,
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
          maxRetries: 3,
          baseRetryDelay: 10, // Fast for tests
        }
      )

      const token = await refresher.getToken('retry-refresh', { autoRefresh: true })

      expect(token?.accessToken).toBe('success-token')
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should use exponential backoff for retries', async () => {
      const refresher = createTokenRefresher()
      const startTime = Date.now()
      const delays: number[] = []

      const expiresAt = new Date(Date.now() - 1000)

      mockFetch
        .mockImplementationOnce(async () => {
          delays.push(Date.now() - startTime)
          throw new Error('Network error')
        })
        .mockImplementationOnce(async () => {
          delays.push(Date.now() - startTime)
          throw new Error('Network error')
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'success',
            expires_in: 3600,
          }),
        })

      await refresher.register(
        'backoff-test',
        {
          accessToken: 'expired',
          refreshToken: 'refresh',
          expiresAt,
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
          maxRetries: 3,
          baseRetryDelay: 50,
        }
      )

      await refresher.getToken('backoff-test', { autoRefresh: true })

      // Second call should be delayed by at least baseRetryDelay
      // Third call should be delayed by at least baseRetryDelay * 2
      expect(delays[1]! - delays[0]!).toBeGreaterThanOrEqual(40) // ~50ms first delay
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('Event Emission', () => {
    it('should emit refreshed event on successful refresh', async () => {
      const eventEmitter = createMockEventEmitter()
      const refresher = createTokenRefresher({ eventEmitter })

      const events: string[] = []
      refresher.on('refreshed', () => events.push('refreshed'))
      refresher.on('credential:refreshed', () => events.push('credential:refreshed'))

      const expiresAt = new Date(Date.now() - 1000)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-token',
          expires_in: 3600,
        }),
      })

      await refresher.register(
        'event-token',
        {
          accessToken: 'expired',
          refreshToken: 'refresh',
          expiresAt,
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
        }
      )

      await refresher.getToken('event-token', { autoRefresh: true })

      // Internal events
      expect(events).toContain('refreshed')
      expect(events).toContain('credential:refreshed')

      // External event emitter ($.on.Credential.refreshed pattern)
      expect(eventEmitter.events.some((e) => e.event === 'Credential.refreshed')).toBe(true)
    })

    it('should emit refresh:failed event on max retries exceeded', async () => {
      const eventEmitter = createMockEventEmitter()
      const refresher = createTokenRefresher({ eventEmitter })

      const events: string[] = []
      refresher.on('refresh:failed', () => events.push('failed'))

      const expiresAt = new Date(Date.now() - 1000)

      mockFetch.mockRejectedValue(new Error('Permanent failure'))

      await refresher.register(
        'fail-token',
        {
          accessToken: 'expired',
          refreshToken: 'refresh',
          expiresAt,
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
          maxRetries: 2,
          baseRetryDelay: 10,
        }
      )

      await expect(refresher.refresh('fail-token')).rejects.toThrow()

      expect(events).toContain('failed')
      expect(eventEmitter.events.some((e) => e.event === 'Credential.refresh_failed')).toBe(true)
    })
  })

  describe('Concurrent Refresh Prevention', () => {
    it('should prevent concurrent refresh attempts', async () => {
      const refresher = createTokenRefresher()

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

      await refresher.register(
        'concurrent-refresh',
        {
          accessToken: 'expired',
          refreshToken: 'refresh',
          expiresAt,
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
        }
      )

      // Concurrent refresh attempts
      const results = await Promise.all([
        refresher.getToken('concurrent-refresh', { autoRefresh: true }),
        refresher.getToken('concurrent-refresh', { autoRefresh: true }),
        refresher.getToken('concurrent-refresh', { autoRefresh: true }),
      ])

      // Should only have refreshed once due to locking
      expect(refreshCount).toBe(1)

      // All results should have the same token
      expect(results[0]?.accessToken).toBe(results[1]?.accessToken)
      expect(results[1]?.accessToken).toBe(results[2]?.accessToken)
    })
  })

  describe('Storage Persistence', () => {
    it('should persist tokens to storage', async () => {
      const storage = createMockStorage()
      const refresher = createTokenRefresher({ storage })

      await refresher.register(
        'persisted-token',
        {
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: new Date(Date.now() + 3600000),
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
        }
      )

      expect(storage.set).toHaveBeenCalled()
      expect(storage.tokens.get('persisted-token')?.accessToken).toBe('access')
    })

    it('should remove tokens from storage on unregister', async () => {
      const storage = createMockStorage()
      const refresher = createTokenRefresher({ storage })

      await refresher.register(
        'to-remove',
        {
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: new Date(Date.now() + 3600000),
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
        }
      )

      await refresher.unregister('to-remove')

      expect(storage.delete).toHaveBeenCalledWith('to-remove')
    })
  })

  describe('Alarm Handler', () => {
    it('should refresh due tokens on alarm', async () => {
      const alarmAdapter = createMockAlarmAdapter()
      const refresher = createTokenRefresher({ alarmAdapter })

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'refreshed-token',
          expires_in: 3600,
        }),
      })

      // Register a token that's due for refresh (expired)
      await refresher.register(
        'due-token',
        {
          accessToken: 'expired',
          refreshToken: 'refresh',
          expiresAt: new Date(Date.now() - 1000),
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
          refreshBeforeExpiry: 0, // No buffer for testing
        }
      )

      // Manually trigger alarm handler
      await refresher.handleAlarm()

      // Token should have been refreshed
      const token = await refresher.getToken('due-token')
      expect(token?.accessToken).toBe('refreshed-token')
    })

    it('should schedule next alarm after handling current one', async () => {
      const alarmAdapter = createMockAlarmAdapter()
      const refresher = createTokenRefresher({ alarmAdapter })

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'refreshed',
          expires_in: 3600, // 1 hour
        }),
      })

      await refresher.register(
        'recurring-token',
        {
          accessToken: 'expired',
          refreshToken: 'refresh',
          expiresAt: new Date(Date.now() - 1000),
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
          refreshBeforeExpiry: 300000, // 5 minutes
        }
      )

      // Clear previous calls
      ;(alarmAdapter.scheduleAt as ReturnType<typeof vi.fn>).mockClear()

      // Trigger alarm
      await refresher.handleAlarm()

      // Should have scheduled next alarm
      expect(alarmAdapter.scheduleAt).toHaveBeenCalled()
    })
  })

  describe('Token Info', () => {
    it('should return token info without values', async () => {
      const refresher = createTokenRefresher()

      const expiresAt = new Date(Date.now() + 3600000)

      await refresher.register(
        'info-token',
        {
          accessToken: 'secret-access',
          refreshToken: 'secret-refresh',
          expiresAt,
        },
        {
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
          refreshBeforeExpiry: 300000,
        }
      )

      const info = refresher.getTokenInfo('info-token')

      expect(info?.expiresAt).toEqual(expiresAt)
      expect(info?.nextRefreshAt).toBeDefined()
      // Info should not contain actual token values
      expect((info as unknown as { accessToken?: string }).accessToken).toBeUndefined()
    })

    it('should return null for unknown token', () => {
      const refresher = createTokenRefresher()
      const info = refresher.getTokenInfo('unknown')
      expect(info).toBeNull()
    })
  })
})
