/**
 * Tests for use$ hook (workflow context)
 *
 * RED phase: These tests verify use$ behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import * as React from 'react'
import { use$ } from '../../src/hooks/use-$'
import { DO } from '../../src/provider'

// Mock fetch
const mockFetch = vi.fn()

// Mock @dotdo/client
vi.mock('@dotdo/client', () => ({
  createClient: vi.fn(() => ({
    connectionState: 'connected',
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  })),
}))

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.OPEN
  url: string

  constructor(url: string) {
    this.url = url
  }

  send = vi.fn()
  close = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ results: [{ value: { success: true } }] }),
  })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

// Provider wrapper for hooks
function createWrapper(ns = 'https://api.example.com/do/workspace') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <DO ns={ns}>{children}</DO>
  }
}

describe('use$', () => {
  describe('returns workflow context', () => {
    it('should return workflow context object', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBeDefined()
      expect(typeof result.current).toBe('object')
    })

    it('should have send method', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.send).toBe('function')
    })

    it('should have try method', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.try).toBe('function')
    })

    it('should have do method', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.do).toBe('function')
    })

    it('should have in method for scheduling', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.in).toBe('function')
    })

    it('should have client reference', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      expect(result.current.client).toBeDefined()
    })
  })

  describe('$.do executes action', () => {
    it('should execute action and return result', async () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      const action = vi.fn().mockResolvedValue({ success: true })

      const outcome = await result.current.do(action)

      expect(action).toHaveBeenCalled()
      expect(outcome).toEqual({ success: true })
    })

    it('should handle async actions', async () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      const action = async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return 'done'
      }

      const outcome = await result.current.do(action)

      expect(outcome).toBe('done')
    })

    it('should propagate errors from action', async () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      const action = vi.fn().mockRejectedValue(new Error('Action failed'))

      await expect(result.current.do(action)).rejects.toThrow('Action failed')
    })

    it('should support nested actions', async () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      const innerAction = vi.fn().mockResolvedValue('inner')
      const outerAction = async () => {
        const inner = await result.current.do(innerAction)
        return `outer-${inner}`
      }

      const outcome = await result.current.do(outerAction)

      expect(innerAction).toHaveBeenCalled()
      expect(outcome).toBe('outer-inner')
    })
  })

  describe('$.send fires event', () => {
    it('should call send without waiting for response', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      // send is fire-and-forget
      result.current.send({ type: 'user.signup', userId: '123' })

      // Should have made an RPC call
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should send event via RPC', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      result.current.send({ type: 'payment.failed', amount: 100 })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/do/workspace/rpc',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    it('should not throw on send error (fire-and-forget)', () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      // Should not throw
      expect(() => {
        result.current.send({ type: 'test.event' })
      }).not.toThrow()
    })

    it('should support various event payloads', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      // Object event
      result.current.send({ type: 'order.created', orderId: '456' })

      // String event
      result.current.send('simple-event')

      // Array event
      result.current.send(['multi', 'part', 'event'])

      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('$.in schedules action', () => {
    it('should return a context for scheduling', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      const scheduled = result.current.in('1 hour')

      expect(scheduled).toBeDefined()
    })

    it('should accept string delay', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      const scheduled = result.current.in('30 minutes')

      expect(scheduled).toBeDefined()
    })

    it('should accept numeric delay (milliseconds)', () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      const scheduled = result.current.in(5000)

      expect(scheduled).toBeDefined()
    })

    it('should allow chaining scheduled calls', async () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      // Schedule a reminder
      const scheduledResult = await result.current.in('1 hour').remind('task-123')

      // Should have called RPC with schedule
      expect(mockFetch).toHaveBeenCalled()
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls[0].method).toBe('$.schedule')
    })
  })

  describe('dynamic Noun.verb proxying', () => {
    it('should support $.Customer(id).method() pattern', async () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      await result.current.Customer('cust-123').notify()

      expect(mockFetch).toHaveBeenCalled()
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls[0].method).toBe('Customer(cust-123).notify')
    })

    it('should support $.Payment.process() pattern', async () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      await result.current.Payment().process({ amount: 100 })

      expect(mockFetch).toHaveBeenCalled()
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls[0].method).toContain('Payment')
      expect(body.calls[0].method).toContain('process')
    })

    it('should pass arguments to verb methods', async () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      await result.current.Order('ord-456').update({ status: 'shipped' })

      expect(mockFetch).toHaveBeenCalled()
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls[0].args[0].value).toEqual({ status: 'shipped' })
    })

    it('should support various Noun types', async () => {
      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      // Different noun types
      await result.current.Task('t-1').complete()
      await result.current.User('u-1').deactivate()
      await result.current.Invoice('i-1').send()

      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should handle RPC errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          error: { code: 'NOT_FOUND', message: 'Customer not found' },
        }),
      })

      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      await expect(
        result.current.Customer('invalid').notify()
      ).rejects.toThrow('Customer not found')
    })

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const { result } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      await expect(
        result.current.Customer('cust-123').notify()
      ).rejects.toThrow('HTTP error: 500')
    })
  })

  describe('throws outside provider', () => {
    it('should throw error when used outside DO provider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        renderHook(() => use$())
      }).toThrow('useDotdoContext must be used within a DotdoProvider')

      spy.mockRestore()
    })
  })

  describe('stability', () => {
    it('should memoize workflow context across re-renders', () => {
      const { result, rerender } = renderHook(() => use$(), {
        wrapper: createWrapper(),
      })

      const first$ = result.current

      rerender()

      expect(result.current).toBe(first$)
    })
  })
})
