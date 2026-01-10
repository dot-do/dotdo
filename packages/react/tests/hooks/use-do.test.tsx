/**
 * Tests for useDO hook
 *
 * RED phase: These tests verify useDO behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import * as React from 'react'
import { useDO } from '../../src/hooks/use-do'
import { DO } from '../../src/provider'
import type { DOClient } from '@dotdo/client'

// Mock @dotdo/client
vi.mock('@dotdo/client', () => ({
  createClient: vi.fn(() => ({
    connectionState: 'connected',
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    Task: {
      create: vi.fn().mockResolvedValue({ $id: '1', title: 'Test' }),
      list: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ $id: '1', title: 'Updated' }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    User: {
      me: vi.fn().mockResolvedValue({ $id: 'user-1', name: 'Test User' }),
    },
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

// Type definitions for testing
interface TaskAPI {
  Task: {
    create(data: { title: string }): Promise<{ $id: string; title: string }>
    list(): Promise<{ $id: string; title: string }[]>
    update(id: string, data: Partial<{ title: string }>): Promise<{ $id: string; title: string }>
    delete(id: string): Promise<void>
  }
  User: {
    me(): Promise<{ $id: string; name: string }>
  }
}

describe('useDO', () => {
  describe('returns typed client', () => {
    it('should return client from context', () => {
      const { result } = renderHook(() => useDO(), {
        wrapper: createWrapper(),
      })

      expect(result.current).not.toBeNull()
      expect(result.current).not.toBeUndefined()
    })

    it('should return typed client with methods', () => {
      const { result } = renderHook(() => useDO<TaskAPI>(), {
        wrapper: createWrapper(),
      })

      // Client should have Task namespace
      expect(result.current.Task).toBeDefined()
      expect(typeof result.current.Task.create).toBe('function')
      expect(typeof result.current.Task.list).toBe('function')
    })

    it('should allow calling RPC methods', async () => {
      const { result } = renderHook(() => useDO<TaskAPI>(), {
        wrapper: createWrapper(),
      })

      const task = await result.current.Task.create({ title: 'New Task' })

      expect(task).toEqual({ $id: '1', title: 'Test' })
    })

    it('should provide access to User namespace', async () => {
      const { result } = renderHook(() => useDO<TaskAPI>(), {
        wrapper: createWrapper(),
      })

      const user = await result.current.User.me()

      expect(user).toEqual({ $id: 'user-1', name: 'Test User' })
    })

    it('should have connectionState property', () => {
      const { result } = renderHook(() => useDO(), {
        wrapper: createWrapper(),
      })

      expect(result.current.connectionState).toBe('connected')
    })

    it('should have disconnect method', () => {
      const { result } = renderHook(() => useDO(), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.disconnect).toBe('function')
    })

    it('should have on/off methods for events', () => {
      const { result } = renderHook(() => useDO(), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.on).toBe('function')
      expect(typeof result.current.off).toBe('function')
    })
  })

  describe('throws outside provider', () => {
    it('should throw error when used outside DO provider', () => {
      // Suppress React error boundary warnings
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        renderHook(() => useDO())
      }).toThrow('useDotdoContext must be used within a DO provider')

      spy.mockRestore()
    })

    it('should throw descriptive error message', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        renderHook(() => useDO())
        // Should not reach here
        expect(true).toBe(false)
      } catch (error) {
        expect((error as Error).message).toContain('DO provider')
      }

      spy.mockRestore()
    })

    it('should work when nested in provider', () => {
      // This should NOT throw
      const { result } = renderHook(() => useDO(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBeDefined()
    })
  })

  describe('stability', () => {
    it('should return same client reference across re-renders', () => {
      const { result, rerender } = renderHook(() => useDO(), {
        wrapper: createWrapper(),
      })

      const firstClient = result.current

      rerender()

      expect(result.current).toBe(firstClient)
    })
  })
})
