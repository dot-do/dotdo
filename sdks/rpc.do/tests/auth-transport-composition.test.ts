// AuthTransport Composition Tests - TDD Decorator Pattern Refactor
// RED phase: These tests define the expected behavior for AuthTransport wrapping transports
// Task: do-y5p2.6

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Transport } from '../transport/types'
import type { RPCMessage, RPCResponse } from '../types'

// ============================================================================
// AuthTransport Composition (Decorator Pattern) Tests
// ============================================================================

describe('AuthTransport Composition', () => {
  let mockTokenStore: {
    getTokens: ReturnType<typeof vi.fn>
    isTokenExpired: ReturnType<typeof vi.fn>
    saveTokens: ReturnType<typeof vi.fn>
    deleteTokens: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockTokenStore = {
      getTokens: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expires_at: Date.now() + 3600000,
      }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }
  })

  describe('constructor', () => {
    it('should accept a wrapped transport (preferred API)', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')
      const { FetchTransport } = await import('../transport/fetch')

      const baseTransport = new FetchTransport({ url: 'https://api.test.com' })
      const authTransport = new AuthTransport({
        transport: baseTransport,
        tokenStore: mockTokenStore,
      })

      expect(authTransport).toBeInstanceOf(AuthTransport)
    })

    it('should still accept url option for backward compatibility', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      const transport = new AuthTransport({
        url: 'https://api.test.com',
        tokenStore: mockTokenStore,
      })

      expect(transport).toBeInstanceOf(AuthTransport)
    })

    it('should throw error if neither transport nor url is provided', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      expect(() => {
        new AuthTransport({
          tokenStore: mockTokenStore,
        } as any)
      }).toThrow('AuthTransport requires either transport or url option')
    })

    it('should prefer transport option over url option when both are provided', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      const mockBaseTransport: Transport = {
        send: vi.fn().mockResolvedValue({ result: 'from-transport' }),
      }

      const authTransport = new AuthTransport({
        transport: mockBaseTransport,
        url: 'https://should-be-ignored.com',
        tokenStore: mockTokenStore,
      })

      await authTransport.send({ method: 'test', args: [] })

      // Should have used the transport, not created a new one from URL
      expect(mockBaseTransport.send).toHaveBeenCalled()
    })
  })

  describe('send - delegation', () => {
    it('should delegate to wrapped transport with auth headers', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      const mockBaseTransport: Transport = {
        send: vi.fn().mockResolvedValue({ result: 'ok' }),
      }

      const authTransport = new AuthTransport({
        transport: mockBaseTransport,
        tokenStore: mockTokenStore,
      })

      await authTransport.send({ method: 'test.method', args: ['arg1'] })

      // Verify the base transport was called
      expect(mockBaseTransport.send).toHaveBeenCalledTimes(1)

      // Verify the message was augmented with auth headers
      const calledMessage = (mockBaseTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as RPCMessage & { headers?: Record<string, string> }
      expect(calledMessage.method).toBe('test.method')
      expect(calledMessage.args).toEqual(['arg1'])
      expect(calledMessage.headers).toBeDefined()
      expect(calledMessage.headers?.['Authorization']).toBe('Bearer test-token')
    })

    it('should not add auth header when no token is available', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      mockTokenStore.getTokens.mockResolvedValue(null)

      const mockBaseTransport: Transport = {
        send: vi.fn().mockResolvedValue({ result: 'ok' }),
      }

      const authTransport = new AuthTransport({
        transport: mockBaseTransport,
        tokenStore: mockTokenStore,
      })

      await authTransport.send({ method: 'test', args: [] })

      const calledMessage = (mockBaseTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as RPCMessage & { headers?: Record<string, string> }
      expect(calledMessage.headers?.['Authorization']).toBeUndefined()
    })

    it('should preserve existing message headers when adding auth', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      const mockBaseTransport: Transport = {
        send: vi.fn().mockResolvedValue({ result: 'ok' }),
      }

      const authTransport = new AuthTransport({
        transport: mockBaseTransport,
        tokenStore: mockTokenStore,
      })

      const messageWithHeaders = {
        method: 'test',
        args: [],
        headers: { 'X-Custom': 'value' },
      } as RPCMessage & { headers: Record<string, string> }

      await authTransport.send(messageWithHeaders)

      const calledMessage = (mockBaseTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as RPCMessage & { headers?: Record<string, string> }
      expect(calledMessage.headers?.['X-Custom']).toBe('value')
      expect(calledMessage.headers?.['Authorization']).toBe('Bearer test-token')
    })

    it('should return response from wrapped transport', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      const expectedResponse: RPCResponse<{ data: string }> = {
        result: { data: 'test-data' },
        correlationId: 'corr-123',
      }

      const mockBaseTransport: Transport = {
        send: vi.fn().mockResolvedValue(expectedResponse),
      }

      const authTransport = new AuthTransport({
        transport: mockBaseTransport,
        tokenStore: mockTokenStore,
      })

      const response = await authTransport.send({ method: 'test', args: [] })

      expect(response).toEqual(expectedResponse)
    })
  })

  describe('401 retry with wrapped transport', () => {
    it('should retry with fresh token on 401 from wrapped transport', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      // First call returns 401 error
      const first401Response: RPCResponse<unknown> = {
        error: {
          type: 'AuthError',
          code: 'UNAUTHORIZED',
          message: 'Token expired',
          httpStatus: 401,
        },
        correlationId: 'corr-1',
      }

      // Second call returns success
      const successResponse: RPCResponse<{ data: string }> = {
        result: { data: 'success' },
        correlationId: 'corr-2',
      }

      const mockBaseTransport: Transport = {
        send: vi.fn()
          .mockResolvedValueOnce(first401Response)
          .mockResolvedValueOnce(successResponse),
      }

      // Update token store to return new token after refresh
      mockTokenStore.getTokens
        .mockResolvedValueOnce({
          access_token: 'old-token',
          refresh_token: 'refresh-token',
          expires_at: Date.now() + 3600000,
        })
        .mockResolvedValueOnce({
          access_token: 'new-token',
          refresh_token: 'new-refresh-token',
          expires_at: Date.now() + 3600000,
        })

      const mockRefresh = vi.fn().mockResolvedValue({
        access_token: 'new-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      const authTransport = new AuthTransport({
        transport: mockBaseTransport,
        tokenStore: mockTokenStore,
        onRefreshToken: mockRefresh,
      })

      const response = await authTransport.send({ method: 'test', args: [] })

      // Should have called send twice (initial + retry)
      expect(mockBaseTransport.send).toHaveBeenCalledTimes(2)

      // Should have refreshed the token
      expect(mockRefresh).toHaveBeenCalledWith('refresh-token')

      // Should return the success response
      expect(response.result).toEqual({ data: 'success' })

      // Second call should have new token
      const secondCallMessage = (mockBaseTransport.send as ReturnType<typeof vi.fn>).mock.calls[1]![0] as RPCMessage & { headers?: Record<string, string> }
      expect(secondCallMessage.headers?.['Authorization']).toBe('Bearer new-token')
    })
  })

  describe('compose with different transports', () => {
    it('should compose with WebSocketTransport', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      // Mock WebSocket transport
      const mockWsTransport: Transport = {
        send: vi.fn().mockResolvedValue({ result: 'ws-response' }),
        close: vi.fn().mockResolvedValue(undefined),
        getState: vi.fn().mockReturnValue('CONNECTED'),
      }

      const authTransport = new AuthTransport({
        transport: mockWsTransport,
        tokenStore: mockTokenStore,
      })

      const response = await authTransport.send({ method: 'ws.test', args: [] })

      expect(mockWsTransport.send).toHaveBeenCalled()
      expect(response.result).toBe('ws-response')
    })

    it('should compose with custom transport implementation', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      // Custom transport that transforms messages
      const customTransport: Transport = {
        send: vi.fn().mockImplementation(async (message: RPCMessage) => {
          return {
            result: { received: message.method },
            correlationId: 'custom-corr',
          }
        }),
      }

      const authTransport = new AuthTransport({
        transport: customTransport,
        tokenStore: mockTokenStore,
      })

      const response = await authTransport.send({ method: 'custom.method', args: [] })

      expect(response.result).toEqual({ received: 'custom.method' })
    })
  })

  describe('backward compatibility', () => {
    it('should work with old URL-based API', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'legacy-response' }),
        headers: new Headers(),
      })

      // Old API - still works
      const transport = new AuthTransport({
        url: 'https://api.example.com',
        tokenStore: mockTokenStore,
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/rpc',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
      expect(response.result).toEqual({ result: 'legacy-response' })
    })

    it('should work with all existing AuthTransport options', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'test' }),
        headers: new Headers(),
      })

      const mockRefresh = vi.fn()

      const transport = new AuthTransport({
        url: 'https://api.example.com',
        tokenStore: mockTokenStore,
        onRefreshToken: mockRefresh,
        timeout: 5000,
        correlationId: 'base-corr-id',
        fetch: mockFetch,
      })

      await transport.send({ method: 'test', args: [] })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      )
    })
  })

  describe('proactive token refresh', () => {
    it('should proactively refresh expired token before delegating to transport', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      mockTokenStore.isTokenExpired.mockResolvedValue(true)
      mockTokenStore.getTokens
        .mockResolvedValueOnce({
          access_token: 'expired-token',
          refresh_token: 'refresh-token',
          expires_at: Date.now() - 1000,
        })
        .mockResolvedValueOnce({
          access_token: 'new-token',
          refresh_token: 'new-refresh-token',
          expires_at: Date.now() + 3600000,
        })

      const mockRefresh = vi.fn().mockResolvedValue({
        access_token: 'new-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      const mockBaseTransport: Transport = {
        send: vi.fn().mockResolvedValue({ result: 'ok' }),
      }

      const authTransport = new AuthTransport({
        transport: mockBaseTransport,
        tokenStore: mockTokenStore,
        onRefreshToken: mockRefresh,
      })

      await authTransport.send({ method: 'test', args: [] })

      // Should have refreshed proactively
      expect(mockRefresh).toHaveBeenCalledWith('refresh-token')

      // Should use new token in request
      const calledMessage = (mockBaseTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as RPCMessage & { headers?: Record<string, string> }
      expect(calledMessage.headers?.['Authorization']).toBe('Bearer new-token')
    })
  })

  describe('state and lifecycle', () => {
    it('should delegate getState to wrapped transport if available', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')
      const { TransportState } = await import('../transport/types')

      const mockBaseTransport: Transport = {
        send: vi.fn(),
        getState: vi.fn().mockReturnValue(TransportState.CONNECTED),
      }

      const authTransport = new AuthTransport({
        transport: mockBaseTransport,
        tokenStore: mockTokenStore,
      })

      const state = authTransport.getState()

      expect(state).toBe(TransportState.CONNECTED)
    })

    it('should delegate close to wrapped transport if available', async () => {
      const { AuthTransport } = await import('../auth/auth-transport')

      const mockBaseTransport: Transport = {
        send: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const authTransport = new AuthTransport({
        transport: mockBaseTransport,
        tokenStore: mockTokenStore,
      })

      await authTransport.close()

      expect(mockBaseTransport.close).toHaveBeenCalled()
    })
  })
})
