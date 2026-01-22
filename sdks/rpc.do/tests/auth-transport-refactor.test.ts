/**
 * AuthTransport HTTP Helper Refactor Tests
 *
 * TDD tests verifying that AuthTransport properly consolidates duplicated code
 * by using the decorator pattern - wrapping an inner transport and delegating
 * requests after adding authentication headers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthTransport } from '../auth/auth-transport'
import type { ITokenStore } from '../auth/token-store'
import type { Transport, TransportState } from '../transport/types'
import type { RPCMessage, RPCResponse } from '../types'

/**
 * Create a mock token store for testing
 */
function createMockTokenStore(tokens: {
  access_token?: string
  refresh_token?: string
  expires_at?: number
} | null = null): ITokenStore {
  return {
    getTokens: vi.fn().mockResolvedValue(tokens),
    isTokenExpired: vi.fn().mockResolvedValue(false),
    saveTokens: vi.fn(),
    deleteTokens: vi.fn(),
  }
}

/**
 * Create a mock transport for testing the decorator pattern
 */
function createMockTransport(responses: RPCResponse<unknown>[]): Transport & { sendSpy: ReturnType<typeof vi.fn> } {
  let callIndex = 0
  const sendSpy = vi.fn().mockImplementation(() => {
    const response = responses[callIndex] ?? { result: 'default' }
    callIndex++
    return Promise.resolve(response)
  })

  return {
    send: sendSpy,
    sendSpy,
    close: vi.fn(),
    getState: vi.fn().mockReturnValue('CONNECTED' as TransportState),
  }
}

describe('AuthTransport Decorator Pattern', () => {
  it('should delegate requests to inner transport', async () => {
    const mockTransport = createMockTransport([{ result: 'success', correlationId: 'test-123' }])

    const mockTokenStore = createMockTokenStore({
      access_token: 'test-token',
      refresh_token: 'refresh-token',
      expires_at: Date.now() + 3600000,
    })

    const transport = new AuthTransport({
      transport: mockTransport,
      tokenStore: mockTokenStore,
    })

    const result = await transport.send({ method: 'test', args: ['arg1'] })

    expect(mockTransport.sendSpy).toHaveBeenCalledTimes(1)
    expect(result.result).toBe('success')
  })

  it('should augment message with Authorization header when token is available', async () => {
    const mockTransport = createMockTransport([{ result: 'ok', correlationId: 'test-123' }])

    const mockTokenStore = createMockTokenStore({
      access_token: 'my-test-token',
      refresh_token: 'refresh-token',
      expires_at: Date.now() + 3600000,
    })

    const transport = new AuthTransport({
      transport: mockTransport,
      tokenStore: mockTokenStore,
    })

    await transport.send({ method: 'test', args: [] })

    expect(mockTransport.sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'test',
        args: [],
        headers: expect.objectContaining({
          Authorization: 'Bearer my-test-token',
        }),
      })
    )
  })

  it('should not add Authorization header when no token is available', async () => {
    const mockTransport = createMockTransport([{ result: 'ok', correlationId: 'test-123' }])

    const mockTokenStore = createMockTokenStore(null)

    const transport = new AuthTransport({
      transport: mockTransport,
      tokenStore: mockTokenStore,
    })

    await transport.send({ method: 'test', args: [] })

    const sentMessage = mockTransport.sendSpy.mock.calls[0]![0]
    expect(sentMessage.headers?.['Authorization']).toBeUndefined()
  })

  it('should preserve existing message headers when adding auth', async () => {
    const mockTransport = createMockTransport([{ result: 'ok', correlationId: 'test-123' }])

    const mockTokenStore = createMockTokenStore({
      access_token: 'test-token',
      refresh_token: 'refresh-token',
      expires_at: Date.now() + 3600000,
    })

    const transport = new AuthTransport({
      transport: mockTransport,
      tokenStore: mockTokenStore,
    })

    await transport.send({
      method: 'test',
      args: [],
      headers: { 'X-Custom-Header': 'custom-value' },
    } as RPCMessage & { headers: Record<string, string> })

    const sentMessage = mockTransport.sendSpy.mock.calls[0]![0]
    expect(sentMessage.headers).toEqual({
      'X-Custom-Header': 'custom-value',
      Authorization: 'Bearer test-token',
    })
  })

  it('should use same augmentation logic for initial send and retry', async () => {
    // First response is 401, second is success
    const mockTransport = createMockTransport([
      { error: { type: 'AuthError', code: 'UNAUTHORIZED', message: 'Unauthorized', httpStatus: 401 }, correlationId: 'test-123' },
      { result: 'success-after-retry', correlationId: 'test-123' },
    ])

    const mockTokenStore = {
      getTokens: vi
        .fn()
        .mockResolvedValueOnce({
          access_token: 'old-token',
          refresh_token: 'refresh-token',
          expires_at: Date.now() + 3600000,
        })
        .mockResolvedValueOnce({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_at: Date.now() + 3600000,
        }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const mockRefresh = vi.fn().mockResolvedValue({
      access_token: 'new-token',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    })

    const transport = new AuthTransport({
      transport: mockTransport,
      tokenStore: mockTokenStore,
      onRefreshToken: mockRefresh,
    })

    const result = await transport.send({ method: 'test', args: ['arg1'] })

    // Should have made 2 calls (initial + retry)
    expect(mockTransport.sendSpy).toHaveBeenCalledTimes(2)

    // Both calls should have the same message structure (method and args)
    const firstCall = mockTransport.sendSpy.mock.calls[0]![0]
    const secondCall = mockTransport.sendSpy.mock.calls[1]![0]

    expect(firstCall.method).toBe('test')
    expect(firstCall.args).toEqual(['arg1'])
    expect(secondCall.method).toBe('test')
    expect(secondCall.args).toEqual(['arg1'])

    // First call had old token, second call has new token
    expect(firstCall.headers.Authorization).toBe('Bearer old-token')
    expect(secondCall.headers.Authorization).toBe('Bearer new-token')

    // Should return the success result
    expect(result.result).toBe('success-after-retry')
  })

  it('should preserve correlation ID between initial and retry requests', async () => {
    const mockTransport = createMockTransport([
      { error: { type: 'AuthError', code: 'UNAUTHORIZED', message: 'Unauthorized', httpStatus: 401 }, correlationId: 'test-123' },
      { result: 'success', correlationId: 'test-123' },
    ])

    const mockTokenStore = {
      getTokens: vi
        .fn()
        .mockResolvedValueOnce({
          access_token: 'old-token',
          refresh_token: 'refresh-token',
          expires_at: Date.now() + 3600000,
        })
        .mockResolvedValueOnce({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_at: Date.now() + 3600000,
        }),
      isTokenExpired: vi.fn().mockResolvedValue(false),
      saveTokens: vi.fn(),
      deleteTokens: vi.fn(),
    }

    const mockRefresh = vi.fn().mockResolvedValue({
      access_token: 'new-token',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    })

    const transport = new AuthTransport({
      transport: mockTransport,
      tokenStore: mockTokenStore,
      onRefreshToken: mockRefresh,
      correlationId: 'base-correlation-id',
    })

    await transport.send({ method: 'test', args: [] })

    const firstCall = mockTransport.sendSpy.mock.calls[0]![0]
    const secondCall = mockTransport.sendSpy.mock.calls[1]![0]

    // Both should use the same correlation ID
    expect(firstCall.correlationId).toBe(secondCall.correlationId)
  })

  it('should delegate close to inner transport', async () => {
    const mockTransport = createMockTransport([])
    const closeSpy = vi.fn()
    mockTransport.close = closeSpy

    const mockTokenStore = createMockTokenStore(null)

    const transport = new AuthTransport({
      transport: mockTransport,
      tokenStore: mockTokenStore,
    })

    await transport.close()

    expect(closeSpy).toHaveBeenCalled()
  })

  it('should delegate getState to inner transport', () => {
    const mockTransport = createMockTransport([])
    const getStateSpy = vi.fn().mockReturnValue('CONNECTING')
    mockTransport.getState = getStateSpy

    const mockTokenStore = createMockTokenStore(null)

    const transport = new AuthTransport({
      transport: mockTransport,
      tokenStore: mockTokenStore,
    })

    const state = transport.getState()

    expect(getStateSpy).toHaveBeenCalled()
    expect(state).toBe('CONNECTING')
  })
})

describe('AuthTransport Backward Compatibility', () => {
  it('should work with url option for backward compatibility', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'test' }),
      headers: new Headers(),
    })

    const mockTokenStore = createMockTokenStore({
      access_token: 'test-token',
      refresh_token: 'refresh-token',
      expires_at: Date.now() + 3600000,
    })

    const transport = new AuthTransport({
      url: 'https://api.example.com',
      tokenStore: mockTokenStore,
      fetch: mockFetch,
    })

    await transport.send({ method: 'test', args: [] })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/rpc',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
      })
    )
  })

  it('should throw error if neither transport nor url is provided', () => {
    const mockTokenStore = createMockTokenStore(null)

    expect(() => {
      new AuthTransport({
        tokenStore: mockTokenStore,
      })
    }).toThrow('AuthTransport requires either transport or url option')
  })
})
