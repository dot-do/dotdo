/**
 * Process polyfill tests (RED phase)
 *
 * Tests for Node.js process API compatibility in Cloudflare Workers.
 * The polyfill provides a virtual process object that mimics Node.js behavior
 * while running in the Workers runtime.
 *
 * @module primitives-core/process.test
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createProcess,
  ProcessExitError,
  type Process,
  type ProcessEnv,
  type HRTime,
} from './process'

describe('process polyfill', () => {
  let proc: Process

  beforeEach(() => {
    proc = createProcess()
  })

  describe('process.env', () => {
    test('returns an object', () => {
      expect(typeof proc.env).toBe('object')
      expect(proc.env).not.toBeNull()
    })

    test('can read environment variables', () => {
      proc.env.TEST_VAR = 'test_value'
      expect(proc.env.TEST_VAR).toBe('test_value')
    })

    test('returns undefined for missing variables', () => {
      expect(proc.env.NONEXISTENT_VAR).toBeUndefined()
    })

    test('can set and delete environment variables', () => {
      proc.env.MY_VAR = 'value'
      expect(proc.env.MY_VAR).toBe('value')

      delete proc.env.MY_VAR
      expect(proc.env.MY_VAR).toBeUndefined()
    })

    test('converts non-string values to strings', () => {
      // Node.js process.env coerces values to strings
      proc.env.NUMBER_VAR = 42 as unknown as string
      expect(proc.env.NUMBER_VAR).toBe('42')
    })

    test('env is enumerable', () => {
      proc.env.A = '1'
      proc.env.B = '2'
      const keys = Object.keys(proc.env)
      expect(keys).toContain('A')
      expect(keys).toContain('B')
    })

    test('supports Object.entries()', () => {
      proc.env.KEY1 = 'val1'
      proc.env.KEY2 = 'val2'
      const entries = Object.entries(proc.env)
      expect(entries).toContainEqual(['KEY1', 'val1'])
      expect(entries).toContainEqual(['KEY2', 'val2'])
    })
  })

  describe('process.argv', () => {
    test('returns an array', () => {
      expect(Array.isArray(proc.argv)).toBe(true)
    })

    test('first element is the runtime path', () => {
      expect(typeof proc.argv[0]).toBe('string')
      expect(proc.argv[0]).toContain('worker')
    })

    test('second element is the script path', () => {
      expect(typeof proc.argv[1]).toBe('string')
    })

    test('is read-only array', () => {
      const originalLength = proc.argv.length
      // Attempting to modify should not change the array
      expect(() => {
        proc.argv.push('new-arg')
      }).toThrow()
      expect(proc.argv.length).toBe(originalLength)
    })

    test('argv0 returns the first argument', () => {
      expect(proc.argv0).toBe(proc.argv[0])
    })
  })

  describe('process.cwd()', () => {
    test('returns a string', () => {
      expect(typeof proc.cwd()).toBe('string')
    })

    test('returns the virtual working directory', () => {
      const cwd = proc.cwd()
      expect(cwd.startsWith('/')).toBe(true)
    })

    test('returns consistent value across calls', () => {
      expect(proc.cwd()).toBe(proc.cwd())
    })
  })

  describe('process.chdir()', () => {
    test('changes the working directory', () => {
      const originalCwd = proc.cwd()
      proc.chdir('/tmp')
      expect(proc.cwd()).toBe('/tmp')
      // Restore
      proc.chdir(originalCwd)
    })

    test('throws on invalid path', () => {
      expect(() => proc.chdir('')).toThrow()
    })

    test('normalizes paths', () => {
      proc.chdir('/a/b/../c')
      expect(proc.cwd()).toBe('/a/c')
    })
  })

  describe('process.exit()', () => {
    test('throws ProcessExitError', () => {
      expect(() => proc.exit(0)).toThrow(ProcessExitError)
    })

    test('exit code is captured in error', () => {
      try {
        proc.exit(1)
      } catch (e) {
        expect(e).toBeInstanceOf(ProcessExitError)
        expect((e as ProcessExitError).code).toBe(1)
      }
    })

    test('exit code defaults to 0', () => {
      try {
        proc.exit()
      } catch (e) {
        expect((e as ProcessExitError).code).toBe(0)
      }
    })

    test('accepts undefined as exit code', () => {
      try {
        proc.exit(undefined)
      } catch (e) {
        expect((e as ProcessExitError).code).toBe(0)
      }
    })
  })

  describe('process.platform', () => {
    test('returns "worker" for Workers runtime', () => {
      expect(proc.platform).toBe('worker')
    })

    test('is a string', () => {
      expect(typeof proc.platform).toBe('string')
    })
  })

  describe('process.arch', () => {
    test('returns architecture string', () => {
      expect(typeof proc.arch).toBe('string')
      // Workers run on wasm
      expect(proc.arch).toBe('wasm')
    })
  })

  describe('process.version', () => {
    test('returns a string', () => {
      expect(typeof proc.version).toBe('string')
    })

    test('starts with v', () => {
      expect(proc.version.startsWith('v')).toBe(true)
    })

    test('follows semver format', () => {
      // e.g., v18.0.0 or v20.10.0
      expect(proc.version).toMatch(/^v\d+\.\d+\.\d+/)
    })
  })

  describe('process.versions', () => {
    test('returns an object', () => {
      expect(typeof proc.versions).toBe('object')
      expect(proc.versions).not.toBeNull()
    })

    test('has node version', () => {
      expect(typeof proc.versions.node).toBe('string')
    })

    test('has v8 version', () => {
      expect(typeof proc.versions.v8).toBe('string')
    })
  })

  describe('process.nextTick()', () => {
    test('schedules callback to run async', async () => {
      const order: number[] = []

      proc.nextTick(() => order.push(2))
      order.push(1)

      // Wait for microtask
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(order).toEqual([1, 2])
    })

    test('passes arguments to callback', async () => {
      let result: unknown[] = []

      proc.nextTick(
        (a: number, b: string) => {
          result = [a, b]
        },
        42,
        'hello'
      )

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(result).toEqual([42, 'hello'])
    })

    test('multiple nextTick calls execute in order', async () => {
      const order: number[] = []

      proc.nextTick(() => order.push(1))
      proc.nextTick(() => order.push(2))
      proc.nextTick(() => order.push(3))

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(order).toEqual([1, 2, 3])
    })
  })

  describe('process.hrtime()', () => {
    test('returns [seconds, nanoseconds] tuple', () => {
      const time = proc.hrtime()
      expect(Array.isArray(time)).toBe(true)
      expect(time.length).toBe(2)
      expect(typeof time[0]).toBe('number')
      expect(typeof time[1]).toBe('number')
    })

    test('nanoseconds is less than 1e9', () => {
      const time = proc.hrtime()
      expect(time[1]).toBeLessThan(1e9)
      expect(time[1]).toBeGreaterThanOrEqual(0)
    })

    test('returns difference when called with previous time', () => {
      const start = proc.hrtime()
      // Busy wait
      const end = Date.now() + 1
      while (Date.now() < end) {
        // spin
      }
      const diff = proc.hrtime(start)

      expect(diff[0]).toBeGreaterThanOrEqual(0)
      expect(diff[1]).toBeGreaterThanOrEqual(0)
    })

    test('difference is positive for sequential calls', () => {
      const start = proc.hrtime()
      const diff = proc.hrtime(start)

      // Total nanoseconds should be >= 0
      const totalNs = diff[0] * 1e9 + diff[1]
      expect(totalNs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('process.hrtime.bigint()', () => {
    test('returns a bigint', () => {
      const time = proc.hrtime.bigint()
      expect(typeof time).toBe('bigint')
    })

    test('increases over time', async () => {
      const start = proc.hrtime.bigint()
      await new Promise((resolve) => setTimeout(resolve, 1))
      const end = proc.hrtime.bigint()
      expect(end).toBeGreaterThan(start)
    })
  })

  describe('process.memoryUsage()', () => {
    test('returns memory usage object', () => {
      const usage = proc.memoryUsage()
      expect(typeof usage).toBe('object')
    })

    test('has heapTotal property', () => {
      const usage = proc.memoryUsage()
      expect(typeof usage.heapTotal).toBe('number')
      expect(usage.heapTotal).toBeGreaterThan(0)
    })

    test('has heapUsed property', () => {
      const usage = proc.memoryUsage()
      expect(typeof usage.heapUsed).toBe('number')
      expect(usage.heapUsed).toBeGreaterThan(0)
    })

    test('has rss property', () => {
      const usage = proc.memoryUsage()
      expect(typeof usage.rss).toBe('number')
    })

    test('has external property', () => {
      const usage = proc.memoryUsage()
      expect(typeof usage.external).toBe('number')
    })

    test('has arrayBuffers property', () => {
      const usage = proc.memoryUsage()
      expect(typeof usage.arrayBuffers).toBe('number')
    })

    test('heapUsed is less than or equal to heapTotal', () => {
      const usage = proc.memoryUsage()
      expect(usage.heapUsed).toBeLessThanOrEqual(usage.heapTotal)
    })
  })

  describe('process.pid', () => {
    test('returns a number', () => {
      expect(typeof proc.pid).toBe('number')
    })

    test('is a positive integer', () => {
      expect(proc.pid).toBeGreaterThan(0)
      expect(Number.isInteger(proc.pid)).toBe(true)
    })
  })

  describe('process.ppid', () => {
    test('returns a number', () => {
      expect(typeof proc.ppid).toBe('number')
    })

    test('is a positive integer', () => {
      expect(proc.ppid).toBeGreaterThan(0)
      expect(Number.isInteger(proc.ppid)).toBe(true)
    })
  })

  describe('process.uptime()', () => {
    test('returns a number', () => {
      expect(typeof proc.uptime()).toBe('number')
    })

    test('returns seconds since start', () => {
      const uptime = proc.uptime()
      expect(uptime).toBeGreaterThanOrEqual(0)
    })

    test('increases over time', async () => {
      const start = proc.uptime()
      await new Promise((resolve) => setTimeout(resolve, 10))
      const end = proc.uptime()
      expect(end).toBeGreaterThan(start)
    })
  })

  describe('process.title', () => {
    test('returns a string', () => {
      expect(typeof proc.title).toBe('string')
    })

    test('can be set', () => {
      proc.title = 'my-worker'
      expect(proc.title).toBe('my-worker')
    })
  })

  describe('process.execPath', () => {
    test('returns a string', () => {
      expect(typeof proc.execPath).toBe('string')
    })

    test('contains worker reference', () => {
      expect(proc.execPath).toContain('worker')
    })
  })

  describe('process.execArgv', () => {
    test('returns an array', () => {
      expect(Array.isArray(proc.execArgv)).toBe(true)
    })
  })

  describe('process.stdout', () => {
    test('has write method', () => {
      expect(typeof proc.stdout.write).toBe('function')
    })

    test('write returns true', () => {
      expect(proc.stdout.write('test')).toBe(true)
    })

    test('has isTTY property', () => {
      expect(typeof proc.stdout.isTTY).toBe('boolean')
    })
  })

  describe('process.stderr', () => {
    test('has write method', () => {
      expect(typeof proc.stderr.write).toBe('function')
    })

    test('write returns true', () => {
      expect(proc.stderr.write('test')).toBe(true)
    })

    test('has isTTY property', () => {
      expect(typeof proc.stderr.isTTY).toBe('boolean')
    })
  })

  describe('process.stdin', () => {
    test('has read method or is null', () => {
      // In Workers, stdin is typically not available
      expect(proc.stdin === null || typeof proc.stdin.read === 'function').toBe(
        true
      )
    })
  })

  describe('process.on() / process.emit()', () => {
    test('can register event listeners', () => {
      const handler = vi.fn()
      proc.on('customEvent', handler)
      proc.emit('customEvent', 'data')
      expect(handler).toHaveBeenCalledWith('data')
    })

    test('can remove event listeners', () => {
      const handler = vi.fn()
      proc.on('customEvent', handler)
      proc.off('customEvent', handler)
      proc.emit('customEvent', 'data')
      expect(handler).not.toHaveBeenCalled()
    })

    test('once() only fires once', () => {
      const handler = vi.fn()
      proc.once('singleEvent', handler)
      proc.emit('singleEvent', 1)
      proc.emit('singleEvent', 2)
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(1)
    })

    test('removeAllListeners() clears all', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      proc.on('event', handler1)
      proc.on('event', handler2)
      proc.removeAllListeners('event')
      proc.emit('event')
      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).not.toHaveBeenCalled()
    })
  })

  describe('process.abort()', () => {
    test('throws error', () => {
      expect(() => proc.abort()).toThrow()
    })
  })

  describe('process.kill()', () => {
    test('throws error (not supported in Workers)', () => {
      expect(() => proc.kill(1234)).toThrow()
    })
  })

  describe('process.umask()', () => {
    test('returns current umask', () => {
      const mask = proc.umask()
      expect(typeof mask).toBe('number')
    })

    test('can set umask', () => {
      const oldMask = proc.umask(0o022)
      expect(typeof oldMask).toBe('number')
      // Restore
      proc.umask(oldMask)
    })
  })

  describe('process.config', () => {
    test('returns an object', () => {
      expect(typeof proc.config).toBe('object')
      expect(proc.config).not.toBeNull()
    })

    test('has target_defaults', () => {
      expect(typeof proc.config.target_defaults).toBe('object')
    })

    test('has variables', () => {
      expect(typeof proc.config.variables).toBe('object')
    })
  })

  describe('process.release', () => {
    test('returns release info object', () => {
      expect(typeof proc.release).toBe('object')
      expect(proc.release).not.toBeNull()
    })

    test('has name property', () => {
      expect(typeof proc.release.name).toBe('string')
    })
  })

  describe('process.features', () => {
    test('returns features object', () => {
      expect(typeof proc.features).toBe('object')
      expect(proc.features).not.toBeNull()
    })
  })

  describe('edge cases', () => {
    test('process object is extensible', () => {
      ;(proc as unknown as Record<string, unknown>).customProp = 'test'
      expect((proc as unknown as Record<string, unknown>).customProp).toBe(
        'test'
      )
    })

    test('multiple createProcess() calls return independent instances', () => {
      const proc1 = createProcess()
      const proc2 = createProcess()

      proc1.env.UNIQUE = 'proc1'
      proc2.env.UNIQUE = 'proc2'

      expect(proc1.env.UNIQUE).toBe('proc1')
      expect(proc2.env.UNIQUE).toBe('proc2')
    })

    test('process can be used with typeof checks', () => {
      expect(typeof proc).toBe('object')
      expect(typeof proc.env).toBe('object')
      expect(typeof proc.exit).toBe('function')
      expect(typeof proc.cwd).toBe('function')
    })
  })
})

describe('ProcessExitError', () => {
  test('is an Error', () => {
    const error = new ProcessExitError(1)
    expect(error).toBeInstanceOf(Error)
  })

  test('has correct name', () => {
    const error = new ProcessExitError(1)
    expect(error.name).toBe('ProcessExitError')
  })

  test('has code property', () => {
    const error = new ProcessExitError(42)
    expect(error.code).toBe(42)
  })

  test('has message with exit code', () => {
    const error = new ProcessExitError(1)
    expect(error.message).toContain('1')
  })

  test('preserves stack trace', () => {
    const error = new ProcessExitError(1)
    expect(error.stack).toBeDefined()
  })
})
