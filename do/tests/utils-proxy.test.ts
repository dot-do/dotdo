/**
 * Tests for do/utils/proxy utilities
 */

import { describe, it, expect, vi } from 'vitest'
import { createNestedProxy, createMethodProxy, createCallableNestedProxy } from '../utils/proxy'

describe('createNestedProxy', () => {
  it('should create a two-level proxy', () => {
    const results: string[] = []

    const proxy = createNestedProxy<{
      [noun: string]: { [verb: string]: () => void }
    }>((noun, verb) => {
      return () => results.push(`${noun}.${verb}`)
    })

    proxy.Customer.signup()
    proxy.Order.placed()
    proxy.Invoice.sent()

    expect(results).toEqual(['Customer.signup', 'Order.placed', 'Invoice.sent'])
  })

  it('should allow arbitrary property combinations', () => {
    const captured: Array<{ noun: string; verb: string; args: unknown[] }> = []

    const proxy = createNestedProxy<{
      [noun: string]: { [verb: string]: (...args: unknown[]) => void }
    }>((noun, verb) => {
      return (...args: unknown[]) => captured.push({ noun, verb, args })
    })

    proxy.Foo.bar('arg1', 'arg2')
    proxy['custom-noun']['custom-verb']()
    proxy['*'].wildcard()

    expect(captured).toEqual([
      { noun: 'Foo', verb: 'bar', args: ['arg1', 'arg2'] },
      { noun: 'custom-noun', verb: 'custom-verb', args: [] },
      { noun: '*', verb: 'wildcard', args: [] },
    ])
  })

  it('should support wildcards', () => {
    const handlers = new Map<string, () => void>()

    const proxy = createNestedProxy<{
      [noun: string]: { [verb: string]: (handler: () => void) => void }
    }>((noun, verb) => {
      return (handler: () => void) => {
        handlers.set(`${noun}.${verb}`, handler)
      }
    })

    const h1 = vi.fn()
    const h2 = vi.fn()
    const h3 = vi.fn()

    proxy['*'].created(h1)
    proxy.Customer['*'](h2)
    proxy['*']['*'](h3)

    expect(handlers.get('*.created')).toBe(h1)
    expect(handlers.get('Customer.*')).toBe(h2)
    expect(handlers.get('*.*')).toBe(h3)
  })
})

describe('createMethodProxy', () => {
  it('should forward method calls to invoke function', async () => {
    const invocations: Array<{ method: string; args: unknown[] }> = []

    const proxy = createMethodProxy<{
      greet(name: string): Promise<string>
      add(a: number, b: number): Promise<number>
    }>(async (method, args) => {
      invocations.push({ method, args })
      if (method === 'greet') return `Hello, ${args[0]}!`
      if (method === 'add') return (args[0] as number) + (args[1] as number)
      return null
    })

    const greeting = await proxy.greet('World')
    const sum = await proxy.add(2, 3)

    expect(greeting).toBe('Hello, World!')
    expect(sum).toBe(5)
    expect(invocations).toEqual([
      { method: 'greet', args: ['World'] },
      { method: 'add', args: [2, 3] },
    ])
  })

  it('should not be thenable (avoid promise detection issues)', async () => {
    const proxy = createMethodProxy<Record<string, () => Promise<unknown>>>(async () => 'result')

    // These should be undefined to prevent async/await issues
    expect((proxy as any).then).toBeUndefined()
    expect((proxy as any).catch).toBeUndefined()
    expect((proxy as any).finally).toBeUndefined()
  })

  it('should handle async errors', async () => {
    const proxy = createMethodProxy<{
      fail(): Promise<void>
    }>(async () => {
      throw new Error('RPC failed')
    })

    await expect(proxy.fail()).rejects.toThrow('RPC failed')
  })
})

describe('createCallableNestedProxy', () => {
  interface BuilderState {
    path: string[]
    value?: number
  }

  it('should support chained property access', () => {
    const captured: string[][] = []

    const proxy = createCallableNestedProxy<any, BuilderState>(
      {
        onGet: (prop, state) => ({
          ...state,
          path: [...state.path, prop]
        }),
        onApply: (args, state) => {
          if (typeof args[0] === 'function') {
            captured.push(state.path)
            args[0]()
          }
          return undefined
        }
      },
      { path: [] }
    )

    const handler = vi.fn()
    proxy.Monday.at9am(handler)

    expect(captured).toEqual([['Monday', 'at9am']])
    expect(handler).toHaveBeenCalled()
  })

  it('should support callable at any level', () => {
    const captured: Array<{ path: string[]; value?: number }> = []

    const proxy = createCallableNestedProxy<any, BuilderState>(
      {
        onGet: (prop, state) => ({
          ...state,
          path: [...state.path, prop]
        }),
        onApply: (args, state) => {
          // Numeric arg starts interval mode
          if (typeof args[0] === 'number') {
            return createCallableNestedProxy<any, BuilderState>(
              {
                onGet: (prop, s) => ({ ...s, path: [...s.path, prop] }),
                onApply: (a, s) => {
                  if (typeof a[0] === 'function') {
                    captured.push({ path: s.path, value: s.value })
                    a[0]()
                  }
                  return undefined
                }
              },
              { path: state.path, value: args[0] as number }
            )
          }
          // Function arg registers handler
          if (typeof args[0] === 'function') {
            captured.push({ path: state.path })
            args[0]()
          }
          return undefined
        }
      },
      { path: [] }
    )

    const h1 = vi.fn()
    const h2 = vi.fn()

    proxy.day(h1)
    proxy(5).minutes(h2)

    expect(captured).toEqual([
      { path: ['day'] },
      { path: ['minutes'], value: 5 }
    ])
    expect(h1).toHaveBeenCalled()
    expect(h2).toHaveBeenCalled()
  })
})
