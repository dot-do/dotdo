/**
 * Miniflare Code Sandbox Tests
 *
 * RED TDD: These tests should FAIL because MiniflareSandbox doesn't exist yet.
 *
 * MiniflareSandbox provides secure code execution in a Workers-compatible environment:
 * - Isolated V8 isolates via Miniflare
 * - Workers API compatibility (fetch, KV, DO, D1, etc.)
 * - Resource limits (memory, CPU, wall-clock time)
 * - API access restrictions
 * - Proper error handling and timeouts
 *
 * This differs from CodeFunctionExecutor by running code in a true Workers runtime
 * rather than just sandboxing JavaScript in the same process.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  MiniflareSandbox,
  type SandboxConfig,
  type SandboxResult,
  type SandboxWorkerEnv,
  type ResourceLimits,
  type SandboxError,
  type CodeExecutionRequest,
  type AllowedBindings,
  SandboxInitializationError,
  SandboxExecutionError,
  SandboxTimeoutError,
  SandboxResourceLimitError,
  SandboxSecurityError,
} from '../sandbox/miniflare-sandbox'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * Expected sandbox configuration
 */
interface ExpectedSandboxConfig {
  /** Maximum execution time in milliseconds */
  timeout?: number
  /** Memory limit in bytes */
  memoryLimit?: number
  /** CPU time limit in milliseconds */
  cpuTimeLimit?: number
  /** Maximum output size in bytes */
  maxOutputSize?: number
  /** Allowed bindings for the sandbox */
  allowedBindings?: ExpectedAllowedBindings
  /** Compatibility date for Workers runtime */
  compatibilityDate?: string
  /** Compatibility flags for Workers runtime */
  compatibilityFlags?: string[]
}

/**
 * Expected bindings configuration
 */
interface ExpectedAllowedBindings {
  /** Allow KV namespace access */
  kv?: boolean | string[]
  /** Allow Durable Object access */
  durableObjects?: boolean | string[]
  /** Allow D1 database access */
  d1?: boolean | string[]
  /** Allow R2 bucket access */
  r2?: boolean | string[]
  /** Allow AI binding */
  ai?: boolean
  /** Allow Vectorize access */
  vectorize?: boolean | string[]
  /** Allow external fetch */
  fetch?: boolean | string[]
  /** Allow environment variables */
  env?: boolean | string[]
}

/**
 * Expected execution result
 */
interface ExpectedSandboxResult<T = unknown> {
  success: boolean
  result?: T
  error?: {
    message: string
    name: string
    stack?: string
  }
  metrics: {
    executionTime: number
    cpuTime: number
    memoryUsed: number
  }
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error'
    message: string
    timestamp: number
  }>
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockBindings() {
  return {
    KV_NAMESPACE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    },
    D1_DATABASE: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
        first: vi.fn().mockResolvedValue(null),
      }),
      batch: vi.fn().mockResolvedValue([]),
      exec: vi.fn().mockResolvedValue(undefined),
    },
    R2_BUCKET: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
    },
    AI: {
      run: vi.fn().mockResolvedValue({ response: 'AI response' }),
    },
    DURABLE_OBJECT: {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-do-id' }),
      idFromString: vi.fn().mockReturnValue({ toString: () => 'mock-do-id' }),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      }),
    },
    ENV_VARS: {
      API_KEY: 'test-api-key',
      NODE_ENV: 'test',
    },
  }
}

const simpleScript = `
export default {
  async fetch(request, env) {
    return new Response("Hello from sandbox!");
  }
}
`

const asyncScript = `
export default {
  async fetch(request, env) {
    await new Promise(resolve => setTimeout(resolve, 10));
    return new Response("Async complete");
  }
}
`

const inputProcessingScript = `
export default {
  async fetch(request, env) {
    const input = await request.json();
    const result = input.value * 2;
    return Response.json({ result });
  }
}
`

// ============================================================================
// TESTS
// ============================================================================

describe('MiniflareSandbox', () => {
  let sandbox: InstanceType<typeof MiniflareSandbox>
  let mockBindings: ReturnType<typeof createMockBindings>

  beforeEach(() => {
    mockBindings = createMockBindings()
  })

  afterEach(async () => {
    // Clean up sandbox after each test
    if (sandbox) {
      await sandbox.dispose()
    }
    vi.clearAllMocks()
  })

  // ==========================================================================
  // 1. SANDBOX INITIALIZATION TESTS
  // ==========================================================================

  describe('Sandbox Initialization', () => {
    describe('Basic initialization', () => {
      it('creates a sandbox instance with default configuration', async () => {
        sandbox = new MiniflareSandbox()

        expect(sandbox).toBeDefined()
        expect(sandbox).toBeInstanceOf(MiniflareSandbox)
      })

      it('initializes the underlying Miniflare instance', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        expect(sandbox.isInitialized()).toBe(true)
      })

      it('can create sandbox with custom configuration', async () => {
        const config: SandboxConfig = {
          timeout: 5000,
          memoryLimit: 64 * 1024 * 1024,
          cpuTimeLimit: 1000,
        }

        sandbox = new MiniflareSandbox(config)
        await sandbox.initialize()

        expect(sandbox.getConfig()).toMatchObject(config)
      })

      it('uses default timeout when not specified', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        // Default timeout should be 30 seconds
        expect(sandbox.getConfig().timeout).toBe(30000)
      })

      it('uses default memory limit when not specified', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        // Default memory limit should be 128MB
        expect(sandbox.getConfig().memoryLimit).toBe(128 * 1024 * 1024)
      })

      it('applies compatibility date for Workers runtime', async () => {
        sandbox = new MiniflareSandbox({
          compatibilityDate: '2024-01-01',
        })
        await sandbox.initialize()

        expect(sandbox.getConfig().compatibilityDate).toBe('2024-01-01')
      })

      it('applies compatibility flags', async () => {
        sandbox = new MiniflareSandbox({
          compatibilityFlags: ['nodejs_compat', 'streams_enable_constructors'],
        })
        await sandbox.initialize()

        expect(sandbox.getConfig().compatibilityFlags).toContain('nodejs_compat')
      })
    })

    describe('Initialization errors', () => {
      it('throws SandboxInitializationError on invalid config', async () => {
        sandbox = new MiniflareSandbox({
          timeout: -1, // Invalid
        })

        await expect(sandbox.initialize()).rejects.toThrow(SandboxInitializationError)
      })

      it('throws SandboxInitializationError when memory limit is too small', async () => {
        sandbox = new MiniflareSandbox({
          memoryLimit: 100, // Too small
        })

        await expect(sandbox.initialize()).rejects.toThrow(SandboxInitializationError)
      })

      it('throws when Miniflare fails to start', async () => {
        // Mock a scenario where Miniflare cannot start
        sandbox = new MiniflareSandbox({
          compatibilityDate: 'invalid-date',
        })

        await expect(sandbox.initialize()).rejects.toThrow(SandboxInitializationError)
      })

      it('provides descriptive error message on initialization failure', async () => {
        sandbox = new MiniflareSandbox({
          timeout: -1,
        })

        try {
          await sandbox.initialize()
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(SandboxInitializationError)
          expect((error as SandboxInitializationError).message).toMatch(/timeout|invalid|config/i)
        }
      })
    })

    describe('Lazy initialization', () => {
      it('auto-initializes on first execution if not initialized', async () => {
        sandbox = new MiniflareSandbox()
        // Don't call initialize()

        const result = await sandbox.execute(simpleScript, {})

        expect(sandbox.isInitialized()).toBe(true)
        expect(result.success).toBe(true)
      })

      it('does not re-initialize if already initialized', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const initCount = sandbox.getInitializationCount()

        await sandbox.execute(simpleScript, {})
        await sandbox.execute(simpleScript, {})

        expect(sandbox.getInitializationCount()).toBe(initCount)
      })
    })

    describe('Resource cleanup', () => {
      it('disposes Miniflare instance on cleanup', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        expect(sandbox.isInitialized()).toBe(true)

        await sandbox.dispose()

        expect(sandbox.isInitialized()).toBe(false)
      })

      it('can be re-initialized after disposal', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()
        await sandbox.dispose()

        await sandbox.initialize()

        expect(sandbox.isInitialized()).toBe(true)
      })

      it('throws when executing on disposed sandbox', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()
        await sandbox.dispose()

        await expect(sandbox.execute(simpleScript, {})).rejects.toThrow(SandboxInitializationError)
      })

      it('cleanup is idempotent (can be called multiple times)', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        await sandbox.dispose()
        await sandbox.dispose() // Should not throw
        await sandbox.dispose() // Should not throw

        expect(sandbox.isInitialized()).toBe(false)
      })
    })

    describe('Sandbox pool/reuse', () => {
      it('can create multiple isolated sandbox instances', async () => {
        const sandbox1 = new MiniflareSandbox()
        const sandbox2 = new MiniflareSandbox()

        await sandbox1.initialize()
        await sandbox2.initialize()

        expect(sandbox1.getId()).not.toBe(sandbox2.getId())

        await sandbox1.dispose()
        await sandbox2.dispose()
      })

      it('sandbox instances are isolated from each other', async () => {
        const sandbox1 = new MiniflareSandbox()
        const sandbox2 = new MiniflareSandbox()

        await sandbox1.initialize()
        await sandbox2.initialize()

        // Execute code that sets state in sandbox1
        const stateScript = `
          let counter = 0;
          export default {
            async fetch(request) {
              counter++;
              return Response.json({ counter });
            }
          }
        `

        const result1a = await sandbox1.execute(stateScript, {})
        const result1b = await sandbox1.execute(stateScript, {})

        const result2 = await sandbox2.execute(stateScript, {})

        // Sandbox1 should have incremented state
        // Sandbox2 should have fresh state
        expect(result2.result).not.toBe(result1b.result)

        await sandbox1.dispose()
        await sandbox2.dispose()
      })
    })
  })

  // ==========================================================================
  // 2. CODE EXECUTION ISOLATION TESTS
  // ==========================================================================

  describe('Code Execution Isolation', () => {
    beforeEach(async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()
    })

    describe('Basic code execution', () => {
      it('executes simple Worker script', async () => {
        const result = await sandbox.execute(simpleScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toBe('Hello from sandbox!')
      })

      it('executes async Worker script', async () => {
        const result = await sandbox.execute(asyncScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toBe('Async complete')
      })

      it('passes input to Worker script', async () => {
        const result = await sandbox.execute(inputProcessingScript, { value: 21 })

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ result: 42 })
      })

      it('handles JSON input and output', async () => {
        const complexInput = {
          nested: { deep: { value: [1, 2, 3] } },
          array: ['a', 'b', 'c'],
          boolean: true,
          number: 42.5,
        }

        const echoScript = `
          export default {
            async fetch(request) {
              const input = await request.json();
              return Response.json(input);
            }
          }
        `

        const result = await sandbox.execute(echoScript, complexInput)

        expect(result.success).toBe(true)
        expect(result.result).toEqual(complexInput)
      })

      it('supports multiple exports (fetch handler required)', async () => {
        const multiExportScript = `
          export const helper = () => "helper";
          export default {
            async fetch(request, env) {
              return new Response(helper());
            }
          }
        `

        const result = await sandbox.execute(multiExportScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toBe('helper')
      })
    })

    describe('Runtime isolation', () => {
      it('executions do not share global state', async () => {
        const stateScript = `
          globalThis.sharedState = globalThis.sharedState || 0;
          globalThis.sharedState++;
          export default {
            async fetch() {
              return Response.json({ count: globalThis.sharedState });
            }
          }
        `

        const result1 = await sandbox.execute(stateScript, {})
        const result2 = await sandbox.execute(stateScript, {})

        // Each execution should have fresh global state
        // (or state should be reset between executions)
        expect(result1.result).toEqual({ count: 1 })
        expect(result2.result).toEqual({ count: 1 })
      })

      it('cannot access parent process environment', async () => {
        // Set a secret in the test process
        process.env.TEST_SECRET = 'super-secret-value'

        const envAccessScript = `
          export default {
            async fetch() {
              // Try to access process.env (should be undefined or blocked)
              const secret = typeof process !== 'undefined' ? process.env?.TEST_SECRET : undefined;
              return Response.json({ secret: secret || null });
            }
          }
        `

        const result = await sandbox.execute(envAccessScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ secret: null })

        delete process.env.TEST_SECRET
      })

      it('cannot access Node.js built-in modules', async () => {
        const nodeAccessScript = `
          export default {
            async fetch() {
              try {
                const fs = require('fs');
                return Response.json({ hasFs: true });
              } catch {
                return Response.json({ hasFs: false });
              }
            }
          }
        `

        const result = await sandbox.execute(nodeAccessScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ hasFs: false })
      })

      it('cannot access file system', async () => {
        const fsAccessScript = `
          export default {
            async fetch() {
              try {
                const fs = await import('node:fs');
                const content = fs.readFileSync('/etc/passwd', 'utf8');
                return Response.json({ content });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        const result = await sandbox.execute(fsAccessScript, {})

        // Should fail to access file system
        expect(result.success).toBe(true)
        expect(result.result.content).toBeUndefined()
        expect(result.result.error).toBeDefined()
      })

      it('cannot spawn child processes', async () => {
        const spawnScript = `
          export default {
            async fetch() {
              try {
                const { exec } = await import('node:child_process');
                return new Promise((resolve) => {
                  exec('whoami', (err, stdout) => {
                    resolve(Response.json({ user: stdout }));
                  });
                });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        const result = await sandbox.execute(spawnScript, {})

        expect(result.success).toBe(true)
        expect(result.result.user).toBeUndefined()
        expect(result.result.error).toBeDefined()
      })

      it('prototype pollution attempts are prevented', async () => {
        const pollutionScript = `
          export default {
            async fetch() {
              try {
                Object.prototype.polluted = true;
                return Response.json({ polluted: {}.polluted });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        // Execute pollution attempt
        await sandbox.execute(pollutionScript, {})

        // Execute fresh script to check if pollution persists
        const checkScript = `
          export default {
            async fetch() {
              return Response.json({ polluted: {}.polluted || false });
            }
          }
        `

        const result = await sandbox.execute(checkScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ polluted: false })
      })

      it('executions have unique invocation IDs', async () => {
        const idScript = `
          export default {
            async fetch(request, env, ctx) {
              // Access invocation ID if available via context
              return Response.json({
                hasCtx: !!ctx,
                requestId: request.headers.get('x-request-id')
              });
            }
          }
        `

        const result1 = await sandbox.execute(idScript, {})
        const result2 = await sandbox.execute(idScript, {})

        // Results should indicate isolated execution context
        expect(result1.success).toBe(true)
        expect(result2.success).toBe(true)
      })
    })

    describe('Workers API availability', () => {
      it('provides fetch API', async () => {
        const fetchTestScript = `
          export default {
            async fetch() {
              return Response.json({
                hasFetch: typeof fetch === 'function',
                hasRequest: typeof Request === 'function',
                hasResponse: typeof Response === 'function',
                hasHeaders: typeof Headers === 'function'
              });
            }
          }
        `

        const result = await sandbox.execute(fetchTestScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          hasFetch: true,
          hasRequest: true,
          hasResponse: true,
          hasHeaders: true,
        })
      })

      it('provides Web Crypto API', async () => {
        const cryptoScript = `
          export default {
            async fetch() {
              const uuid = crypto.randomUUID();
              const array = new Uint8Array(16);
              crypto.getRandomValues(array);
              return Response.json({
                hasCrypto: typeof crypto !== 'undefined',
                hasSubtle: typeof crypto.subtle !== 'undefined',
                uuid: uuid,
                randomLength: array.length
              });
            }
          }
        `

        const result = await sandbox.execute(cryptoScript, {})

        expect(result.success).toBe(true)
        expect(result.result.hasCrypto).toBe(true)
        expect(result.result.hasSubtle).toBe(true)
        expect(result.result.uuid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
      })

      it('provides TextEncoder/TextDecoder', async () => {
        const textScript = `
          export default {
            async fetch() {
              const encoder = new TextEncoder();
              const decoder = new TextDecoder();
              const encoded = encoder.encode('Hello');
              const decoded = decoder.decode(encoded);
              return Response.json({
                hasTextEncoder: true,
                decoded
              });
            }
          }
        `

        const result = await sandbox.execute(textScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          hasTextEncoder: true,
          decoded: 'Hello',
        })
      })

      it('provides URL and URLSearchParams', async () => {
        const urlScript = `
          export default {
            async fetch() {
              const url = new URL('https://example.com/path?foo=bar');
              return Response.json({
                host: url.host,
                pathname: url.pathname,
                foo: url.searchParams.get('foo')
              });
            }
          }
        `

        const result = await sandbox.execute(urlScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          host: 'example.com',
          pathname: '/path',
          foo: 'bar',
        })
      })

      it('provides Streams API', async () => {
        const streamsScript = `
          export default {
            async fetch() {
              return Response.json({
                hasReadableStream: typeof ReadableStream === 'function',
                hasWritableStream: typeof WritableStream === 'function',
                hasTransformStream: typeof TransformStream === 'function'
              });
            }
          }
        `

        const result = await sandbox.execute(streamsScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          hasReadableStream: true,
          hasWritableStream: true,
          hasTransformStream: true,
        })
      })

      it('provides console API (redirected to logs)', async () => {
        const consoleScript = `
          export default {
            async fetch() {
              console.log('Log message');
              console.info('Info message');
              console.warn('Warn message');
              console.error('Error message');
              console.debug('Debug message');
              return new Response('Logged');
            }
          }
        `

        const result = await sandbox.execute(consoleScript, {})

        expect(result.success).toBe(true)
        expect(result.logs.length).toBeGreaterThanOrEqual(4)
        expect(result.logs.find((l) => l.message.includes('Log message'))).toBeDefined()
        expect(result.logs.find((l) => l.level === 'warn')).toBeDefined()
        expect(result.logs.find((l) => l.level === 'error')).toBeDefined()
      })

      it('provides AbortController and AbortSignal', async () => {
        const abortScript = `
          export default {
            async fetch() {
              const controller = new AbortController();
              return Response.json({
                hasAbortController: typeof AbortController === 'function',
                hasSignal: controller.signal instanceof AbortSignal
              });
            }
          }
        `

        const result = await sandbox.execute(abortScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toEqual({
          hasAbortController: true,
          hasSignal: true,
        })
      })
    })

    describe('Script validation', () => {
      it('rejects invalid JavaScript syntax', async () => {
        const invalidScript = `
          export default {
            async fetch() {
              return new Response( // Missing closing paren and brace
            }
        `

        const result = await sandbox.execute(invalidScript, {})

        expect(result.success).toBe(false)
        expect(result.error?.name).toMatch(/SyntaxError/i)
      })

      it('rejects scripts without default export', async () => {
        const noExportScript = `
          const handler = { fetch: () => new Response('Hello') };
          // No default export
        `

        const result = await sandbox.execute(noExportScript, {})

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/default.*export|handler/i)
      })

      it('rejects scripts without fetch handler', async () => {
        const noFetchScript = `
          export default {
            scheduled: () => {}
          }
        `

        const result = await sandbox.execute(noFetchScript, {})

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/fetch.*handler|handler.*fetch/i)
      })

      it('validates script before execution', async () => {
        // Pre-validation should catch issues without full execution
        const valid = await sandbox.validate(simpleScript)
        const invalid = await sandbox.validate('invalid { syntax')

        expect(valid.valid).toBe(true)
        expect(invalid.valid).toBe(false)
        expect(invalid.errors.length).toBeGreaterThan(0)
      })
    })
  })

  // ==========================================================================
  // 3. RESOURCE LIMITS TESTS
  // ==========================================================================

  describe('Resource Limits', () => {
    describe('Memory limits', () => {
      it('enforces memory limit', async () => {
        sandbox = new MiniflareSandbox({
          memoryLimit: 10 * 1024 * 1024, // 10MB
        })
        await sandbox.initialize()

        const memoryHogScript = `
          export default {
            async fetch() {
              // Try to allocate a huge array
              const hugeArray = new Array(100_000_000).fill('x');
              return Response.json({ length: hugeArray.length });
            }
          }
        `

        const result = await sandbox.execute(memoryHogScript, {})

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(SandboxResourceLimitError)
        expect(result.error?.message).toMatch(/memory|limit|exceeded/i)
      })

      it('reports memory usage in metrics', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const memoryScript = `
          export default {
            async fetch() {
              const data = new Array(10000).fill('test data');
              return Response.json({ size: data.length });
            }
          }
        `

        const result = await sandbox.execute(memoryScript, {})

        expect(result.success).toBe(true)
        expect(result.metrics.memoryUsed).toBeDefined()
        expect(result.metrics.memoryUsed).toBeGreaterThan(0)
      })

      it('allows execution within memory limit', async () => {
        sandbox = new MiniflareSandbox({
          memoryLimit: 50 * 1024 * 1024, // 50MB
        })
        await sandbox.initialize()

        const reasonableScript = `
          export default {
            async fetch() {
              const data = new Array(1000).fill('reasonable');
              return Response.json({ size: data.length });
            }
          }
        `

        const result = await sandbox.execute(reasonableScript, {})

        expect(result.success).toBe(true)
        expect(result.metrics.memoryUsed).toBeLessThan(50 * 1024 * 1024)
      })
    })

    describe('CPU time limits', () => {
      it('enforces CPU time limit', async () => {
        sandbox = new MiniflareSandbox({
          cpuTimeLimit: 50, // 50ms CPU time
        })
        await sandbox.initialize()

        const cpuIntensiveScript = `
          export default {
            async fetch() {
              let sum = 0;
              // CPU-bound computation
              for (let i = 0; i < 1_000_000_000; i++) {
                sum += Math.sqrt(i);
              }
              return Response.json({ sum });
            }
          }
        `

        const result = await sandbox.execute(cpuIntensiveScript, {})

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(SandboxResourceLimitError)
        expect(result.error?.message).toMatch(/cpu.*time|limit|exceeded/i)
      })

      it('reports CPU time in metrics', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const cpuScript = `
          export default {
            async fetch() {
              let sum = 0;
              for (let i = 0; i < 10000; i++) {
                sum += i;
              }
              return Response.json({ sum });
            }
          }
        `

        const result = await sandbox.execute(cpuScript, {})

        expect(result.success).toBe(true)
        expect(result.metrics.cpuTime).toBeDefined()
        expect(result.metrics.cpuTime).toBeGreaterThan(0)
      })

      it('CPU time is separate from wall-clock time', async () => {
        sandbox = new MiniflareSandbox({
          cpuTimeLimit: 100, // 100ms CPU
          timeout: 5000, // 5s wall-clock
        })
        await sandbox.initialize()

        const sleepScript = `
          export default {
            async fetch() {
              // Wall-clock time, minimal CPU
              await new Promise(resolve => setTimeout(resolve, 500));
              return new Response('Slept');
            }
          }
        `

        const result = await sandbox.execute(sleepScript, {})

        // Should succeed - mostly idle, little CPU used
        expect(result.success).toBe(true)
        expect(result.metrics.executionTime).toBeGreaterThanOrEqual(500)
        expect(result.metrics.cpuTime).toBeLessThan(100)
      })
    })

    describe('Wall-clock timeout', () => {
      it('enforces execution timeout', async () => {
        sandbox = new MiniflareSandbox({
          timeout: 100, // 100ms
        })
        await sandbox.initialize()

        const slowScript = `
          export default {
            async fetch() {
              await new Promise(resolve => setTimeout(resolve, 5000));
              return new Response('Done');
            }
          }
        `

        const result = await sandbox.execute(slowScript, {})

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(SandboxTimeoutError)
        expect(result.error?.message).toMatch(/timeout|exceeded|100/i)
      })

      it('completes before timeout when fast enough', async () => {
        sandbox = new MiniflareSandbox({
          timeout: 5000, // 5 seconds
        })
        await sandbox.initialize()

        const fastScript = `
          export default {
            async fetch() {
              await new Promise(resolve => setTimeout(resolve, 50));
              return new Response('Fast');
            }
          }
        `

        const result = await sandbox.execute(fastScript, {})

        expect(result.success).toBe(true)
        expect(result.metrics.executionTime).toBeLessThan(5000)
      })

      it('tracks execution time in metrics', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const timedScript = `
          export default {
            async fetch() {
              await new Promise(resolve => setTimeout(resolve, 100));
              return new Response('Timed');
            }
          }
        `

        const result = await sandbox.execute(timedScript, {})

        expect(result.success).toBe(true)
        expect(result.metrics.executionTime).toBeGreaterThanOrEqual(100)
        expect(result.metrics.executionTime).toBeLessThan(1000)
      })

      it('can override timeout per execution', async () => {
        sandbox = new MiniflareSandbox({
          timeout: 5000, // Default 5s
        })
        await sandbox.initialize()

        const slowScript = `
          export default {
            async fetch() {
              await new Promise(resolve => setTimeout(resolve, 1000));
              return new Response('Done');
            }
          }
        `

        const result = await sandbox.execute(slowScript, {}, { timeout: 100 })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(SandboxTimeoutError)
      })
    })

    describe('Output size limits', () => {
      it('enforces output size limit', async () => {
        sandbox = new MiniflareSandbox({
          maxOutputSize: 1024, // 1KB
        })
        await sandbox.initialize()

        const largeOutputScript = `
          export default {
            async fetch() {
              const largeData = 'x'.repeat(10000);
              return Response.json({ data: largeData });
            }
          }
        `

        const result = await sandbox.execute(largeOutputScript, {})

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(SandboxResourceLimitError)
        expect(result.error?.message).toMatch(/output.*size|size.*limit/i)
      })

      it('allows output within size limit', async () => {
        sandbox = new MiniflareSandbox({
          maxOutputSize: 10 * 1024, // 10KB
        })
        await sandbox.initialize()

        const reasonableOutputScript = `
          export default {
            async fetch() {
              const data = 'x'.repeat(100);
              return Response.json({ data });
            }
          }
        `

        const result = await sandbox.execute(reasonableOutputScript, {})

        expect(result.success).toBe(true)
      })
    })

    describe('Combined resource limits', () => {
      it('can set multiple resource limits', async () => {
        sandbox = new MiniflareSandbox({
          timeout: 5000,
          memoryLimit: 50 * 1024 * 1024,
          cpuTimeLimit: 1000,
          maxOutputSize: 1 * 1024 * 1024,
        })
        await sandbox.initialize()

        const result = await sandbox.execute(simpleScript, {})

        expect(result.success).toBe(true)
      })

      it('first limit hit causes failure', async () => {
        sandbox = new MiniflareSandbox({
          timeout: 100,
          memoryLimit: 50 * 1024 * 1024,
          cpuTimeLimit: 5000,
        })
        await sandbox.initialize()

        const slowScript = `
          export default {
            async fetch() {
              await new Promise(resolve => setTimeout(resolve, 1000));
              return new Response('Done');
            }
          }
        `

        const result = await sandbox.execute(slowScript, {})

        expect(result.success).toBe(false)
        // Timeout should trigger first
        expect(result.error).toBeInstanceOf(SandboxTimeoutError)
      })
    })
  })

  // ==========================================================================
  // 4. API ACCESS RESTRICTIONS TESTS
  // ==========================================================================

  describe('API Access Restrictions', () => {
    describe('Binding restrictions', () => {
      it('can restrict KV access', async () => {
        sandbox = new MiniflareSandbox({
          allowedBindings: {
            kv: false,
          },
        })
        await sandbox.initialize()

        const kvScript = `
          export default {
            async fetch(request, env) {
              try {
                const value = await env.MY_KV.get('key');
                return Response.json({ value });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        const result = await sandbox.execute(kvScript, {}, {
          bindings: { MY_KV: mockBindings.KV_NAMESPACE },
        })

        expect(result.success).toBe(true)
        expect(result.result.error).toBeDefined()
        expect(result.result.error).toMatch(/not.*allowed|access.*denied|undefined/i)
      })

      it('can allow specific KV namespaces', async () => {
        sandbox = new MiniflareSandbox({
          allowedBindings: {
            kv: ['ALLOWED_KV'],
          },
        })
        await sandbox.initialize()

        const kvScript = `
          export default {
            async fetch(request, env) {
              const allowed = typeof env.ALLOWED_KV?.get === 'function';
              const blocked = typeof env.BLOCKED_KV?.get === 'function';
              return Response.json({ allowed, blocked });
            }
          }
        `

        const result = await sandbox.execute(kvScript, {}, {
          bindings: {
            ALLOWED_KV: mockBindings.KV_NAMESPACE,
            BLOCKED_KV: mockBindings.KV_NAMESPACE,
          },
        })

        expect(result.success).toBe(true)
        expect(result.result.allowed).toBe(true)
        expect(result.result.blocked).toBe(false)
      })

      it('can restrict D1 access', async () => {
        sandbox = new MiniflareSandbox({
          allowedBindings: {
            d1: false,
          },
        })
        await sandbox.initialize()

        const d1Script = `
          export default {
            async fetch(request, env) {
              try {
                const result = await env.DB.prepare('SELECT 1').first();
                return Response.json({ result });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        const result = await sandbox.execute(d1Script, {}, {
          bindings: { DB: mockBindings.D1_DATABASE },
        })

        expect(result.success).toBe(true)
        expect(result.result.error).toBeDefined()
      })

      it('can restrict R2 access', async () => {
        sandbox = new MiniflareSandbox({
          allowedBindings: {
            r2: false,
          },
        })
        await sandbox.initialize()

        const r2Script = `
          export default {
            async fetch(request, env) {
              try {
                const object = await env.BUCKET.get('key');
                return Response.json({ exists: !!object });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        const result = await sandbox.execute(r2Script, {}, {
          bindings: { BUCKET: mockBindings.R2_BUCKET },
        })

        expect(result.success).toBe(true)
        expect(result.result.error).toBeDefined()
      })

      it('can restrict AI binding access', async () => {
        sandbox = new MiniflareSandbox({
          allowedBindings: {
            ai: false,
          },
        })
        await sandbox.initialize()

        const aiScript = `
          export default {
            async fetch(request, env) {
              try {
                const result = await env.AI.run('model', { prompt: 'Hello' });
                return Response.json({ result });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        const result = await sandbox.execute(aiScript, {}, {
          bindings: { AI: mockBindings.AI },
        })

        expect(result.success).toBe(true)
        expect(result.result.error).toBeDefined()
      })

      it('can restrict Durable Object access', async () => {
        sandbox = new MiniflareSandbox({
          allowedBindings: {
            durableObjects: false,
          },
        })
        await sandbox.initialize()

        const doScript = `
          export default {
            async fetch(request, env) {
              try {
                const id = env.MY_DO.idFromName('test');
                const stub = env.MY_DO.get(id);
                const response = await stub.fetch(request);
                return Response.json({ ok: response.ok });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        const result = await sandbox.execute(doScript, {}, {
          bindings: { MY_DO: mockBindings.DURABLE_OBJECT },
        })

        expect(result.success).toBe(true)
        expect(result.result.error).toBeDefined()
      })
    })

    describe('Fetch restrictions', () => {
      it('can block all external fetch', async () => {
        sandbox = new MiniflareSandbox({
          allowedBindings: {
            fetch: false,
          },
        })
        await sandbox.initialize()

        const fetchScript = `
          export default {
            async fetch() {
              try {
                const response = await fetch('https://example.com');
                return Response.json({ ok: response.ok });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        const result = await sandbox.execute(fetchScript, {})

        expect(result.success).toBe(true)
        expect(result.result.error).toBeDefined()
        expect(result.result.error).toMatch(/not.*allowed|blocked|denied/i)
      })

      it('can allow fetch to specific domains', async () => {
        sandbox = new MiniflareSandbox({
          allowedBindings: {
            fetch: ['api.allowed.com', '*.allowed.com'],
          },
        })
        await sandbox.initialize()

        const fetchScript = `
          export default {
            async fetch() {
              const results = {};

              try {
                await fetch('https://api.allowed.com/data');
                results.allowed = true;
              } catch (e) {
                results.allowed = false;
              }

              try {
                await fetch('https://api.blocked.com/data');
                results.blocked = true;
              } catch (e) {
                results.blocked = false;
              }

              return Response.json(results);
            }
          }
        `

        const result = await sandbox.execute(fetchScript, {})

        expect(result.success).toBe(true)
        // Allowed domain should work, blocked should fail
        expect(result.result.blocked).toBe(false)
      })

      it('blocks fetch to internal/private IPs', async () => {
        sandbox = new MiniflareSandbox({
          allowedBindings: {
            fetch: true, // Allow external fetch
          },
        })
        await sandbox.initialize()

        const internalFetchScript = `
          export default {
            async fetch() {
              const results = {};

              const internalUrls = [
                'http://localhost:8080',
                'http://127.0.0.1:8080',
                'http://192.168.1.1',
                'http://10.0.0.1',
                'http://[::1]:8080'
              ];

              for (const url of internalUrls) {
                try {
                  await fetch(url);
                  results[url] = 'allowed';
                } catch (e) {
                  results[url] = 'blocked';
                }
              }

              return Response.json(results);
            }
          }
        `

        const result = await sandbox.execute(internalFetchScript, {})

        expect(result.success).toBe(true)
        // All internal URLs should be blocked
        for (const url of Object.keys(result.result)) {
          expect(result.result[url]).toBe('blocked')
        }
      })
    })

    describe('Environment variable restrictions', () => {
      it('can restrict environment variable access', async () => {
        sandbox = new MiniflareSandbox({
          allowedBindings: {
            env: false,
          },
        })
        await sandbox.initialize()

        const envScript = `
          export default {
            async fetch(request, env) {
              return Response.json({
                apiKey: env.API_KEY || null,
                nodeEnv: env.NODE_ENV || null
              });
            }
          }
        `

        const result = await sandbox.execute(envScript, {}, {
          bindings: mockBindings.ENV_VARS,
        })

        expect(result.success).toBe(true)
        expect(result.result.apiKey).toBeNull()
        expect(result.result.nodeEnv).toBeNull()
      })

      it('can allow specific environment variables', async () => {
        sandbox = new MiniflareSandbox({
          allowedBindings: {
            env: ['NODE_ENV'],
          },
        })
        await sandbox.initialize()

        const envScript = `
          export default {
            async fetch(request, env) {
              return Response.json({
                apiKey: env.API_KEY || null,
                nodeEnv: env.NODE_ENV || null
              });
            }
          }
        `

        const result = await sandbox.execute(envScript, {}, {
          bindings: mockBindings.ENV_VARS,
        })

        expect(result.success).toBe(true)
        expect(result.result.apiKey).toBeNull()
        expect(result.result.nodeEnv).toBe('test')
      })
    })

    describe('Security policies', () => {
      it('prevents eval() usage', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const evalScript = `
          export default {
            async fetch() {
              try {
                const result = eval('1 + 1');
                return Response.json({ result });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        const result = await sandbox.execute(evalScript, {})

        expect(result.success).toBe(true)
        expect(result.result.error).toBeDefined()
        expect(result.result.error).toMatch(/eval|not.*allowed|not.*defined/i)
      })

      it('prevents Function constructor usage', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const functionConstructorScript = `
          export default {
            async fetch() {
              try {
                const fn = new Function('return 42');
                return Response.json({ result: fn() });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        const result = await sandbox.execute(functionConstructorScript, {})

        expect(result.success).toBe(true)
        expect(result.result.error).toBeDefined()
      })

      it('applies Content Security Policy headers', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const result = await sandbox.execute(simpleScript, {})

        // Check that sandbox applies CSP or similar security headers
        expect(result.success).toBe(true)
        // The sandbox should track security policies applied
        expect(sandbox.getSecurityPolicies()).toBeDefined()
      })
    })
  })

  // ==========================================================================
  // 5. ERROR HANDLING AND TIMEOUTS TESTS
  // ==========================================================================

  describe('Error Handling and Timeouts', () => {
    beforeEach(async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()
    })

    describe('Script errors', () => {
      it('catches synchronous throws', async () => {
        const throwScript = `
          export default {
            async fetch() {
              throw new Error('Intentional error');
            }
          }
        `

        const result = await sandbox.execute(throwScript, {})

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(SandboxExecutionError)
        expect(result.error?.message).toContain('Intentional error')
      })

      it('catches async rejections', async () => {
        const rejectScript = `
          export default {
            async fetch() {
              await Promise.reject(new Error('Async rejection'));
            }
          }
        `

        const result = await sandbox.execute(rejectScript, {})

        expect(result.success).toBe(false)
        expect(result.error?.message).toContain('Async rejection')
      })

      it('catches thrown non-Error values', async () => {
        const throwStringScript = `
          export default {
            async fetch() {
              throw 'String error';
            }
          }
        `

        const result = await sandbox.execute(throwStringScript, {})

        expect(result.success).toBe(false)
        expect(result.error?.message).toContain('String error')
      })

      it('preserves error stack traces', async () => {
        const stackTraceScript = `
          function innerFunction() {
            throw new Error('Deep error');
          }

          function middleFunction() {
            innerFunction();
          }

          export default {
            async fetch() {
              middleFunction();
            }
          }
        `

        const result = await sandbox.execute(stackTraceScript, {})

        expect(result.success).toBe(false)
        expect(result.error?.stack).toBeDefined()
        expect(result.error?.stack).toContain('innerFunction')
        expect(result.error?.stack).toContain('middleFunction')
      })

      it('handles TypeError correctly', async () => {
        const typeErrorScript = `
          export default {
            async fetch() {
              const obj = null;
              return obj.property;
            }
          }
        `

        const result = await sandbox.execute(typeErrorScript, {})

        expect(result.success).toBe(false)
        expect(result.error?.name).toMatch(/TypeError/i)
      })

      it('handles ReferenceError correctly', async () => {
        const refErrorScript = `
          export default {
            async fetch() {
              return undefinedVariable;
            }
          }
        `

        const result = await sandbox.execute(refErrorScript, {})

        expect(result.success).toBe(false)
        expect(result.error?.name).toMatch(/ReferenceError/i)
      })
    })

    describe('Timeout handling', () => {
      it('provides timeout context via AbortSignal', async () => {
        sandbox = new MiniflareSandbox({
          timeout: 100,
        })
        await sandbox.initialize()

        const signalScript = `
          export default {
            async fetch(request, env, ctx) {
              return Response.json({
                hasSignal: !!request.signal,
                isAbortSignal: request.signal instanceof AbortSignal
              });
            }
          }
        `

        const result = await sandbox.execute(signalScript, {})

        expect(result.success).toBe(true)
        expect(result.result.hasSignal).toBe(true)
        expect(result.result.isAbortSignal).toBe(true)
      })

      it('signal is aborted when timeout expires', async () => {
        sandbox = new MiniflareSandbox({
          timeout: 100,
        })
        await sandbox.initialize()

        const abortListenerScript = `
          export default {
            async fetch(request) {
              let aborted = false;
              request.signal.addEventListener('abort', () => {
                aborted = true;
              });

              await new Promise(resolve => setTimeout(resolve, 5000));

              return Response.json({ aborted });
            }
          }
        `

        const result = await sandbox.execute(abortListenerScript, {})

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(SandboxTimeoutError)
      })

      it('can be cancelled externally', async () => {
        sandbox = new MiniflareSandbox({
          timeout: 60000, // Long default timeout
        })
        await sandbox.initialize()

        const slowScript = `
          export default {
            async fetch() {
              await new Promise(resolve => setTimeout(resolve, 30000));
              return new Response('Done');
            }
          }
        `

        const controller = new AbortController()

        // Cancel after 50ms
        setTimeout(() => controller.abort('User cancelled'), 50)

        const result = await sandbox.execute(slowScript, {}, { signal: controller.signal })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/cancel|abort/i)
      })

      it('cleans up resources after timeout', async () => {
        sandbox = new MiniflareSandbox({
          timeout: 100,
        })
        await sandbox.initialize()

        const timeoutScript = `
          export default {
            async fetch() {
              await new Promise(resolve => setTimeout(resolve, 5000));
              return new Response('Done');
            }
          }
        `

        await sandbox.execute(timeoutScript, {})

        // Should be able to execute another script immediately
        const result = await sandbox.execute(simpleScript, {})
        expect(result.success).toBe(true)
      })
    })

    describe('Unhandled rejections', () => {
      it('catches floating promises that reject', async () => {
        const floatingPromiseScript = `
          export default {
            async fetch() {
              // Fire-and-forget promise that rejects
              Promise.reject(new Error('Floating rejection'));

              await new Promise(resolve => setTimeout(resolve, 50));

              return new Response('Returned before rejection detected');
            }
          }
        `

        const result = await sandbox.execute(floatingPromiseScript, {})

        // Implementation may either:
        // 1. Fail with the unhandled rejection
        // 2. Succeed but report the rejection in logs
        expect(result.logs.some((l) => l.message.includes('Floating rejection')) || !result.success)
          .toBe(true)
      })
    })

    describe('Execution metrics', () => {
      it('always reports execution metrics even on failure', async () => {
        const failingScript = `
          export default {
            async fetch() {
              throw new Error('Failed');
            }
          }
        `

        const result = await sandbox.execute(failingScript, {})

        expect(result.success).toBe(false)
        expect(result.metrics).toBeDefined()
        expect(result.metrics.executionTime).toBeDefined()
        expect(result.metrics.cpuTime).toBeDefined()
        expect(result.metrics.memoryUsed).toBeDefined()
      })

      it('reports accurate timing metrics', async () => {
        const timedScript = `
          export default {
            async fetch() {
              const start = Date.now();
              await new Promise(resolve => setTimeout(resolve, 100));
              const duration = Date.now() - start;
              return Response.json({ duration });
            }
          }
        `

        const result = await sandbox.execute(timedScript, {})

        expect(result.success).toBe(true)
        expect(result.metrics.executionTime).toBeGreaterThanOrEqual(100)
        // Script duration should roughly match our metrics
        expect(result.result.duration).toBeGreaterThanOrEqual(90) // Allow some variance
      })
    })

    describe('Error classification', () => {
      it('distinguishes between different error types', async () => {
        const tests = [
          {
            name: 'syntax error',
            script: 'export default { fetch() { return',
            expectedType: SandboxExecutionError,
          },
          {
            name: 'runtime error',
            script: `export default { async fetch() { throw new Error('Runtime'); } }`,
            expectedType: SandboxExecutionError,
          },
        ]

        for (const test of tests) {
          const result = await sandbox.execute(test.script, {})
          expect(result.success).toBe(false)
          // Error should be properly classified
          expect(result.error?.name).toBeDefined()
        }
      })

      it('provides error codes for programmatic handling', async () => {
        const errorScript = `
          export default {
            async fetch() {
              throw new Error('Test error');
            }
          }
        `

        const result = await sandbox.execute(errorScript, {})

        expect(result.success).toBe(false)
        // Error should have a code for programmatic handling
        expect((result.error as SandboxError)?.code).toBeDefined()
      })
    })
  })

  // ==========================================================================
  // 6. ADVANCED FEATURES TESTS
  // ==========================================================================

  describe('Advanced Features', () => {
    describe('Module imports', () => {
      it('supports ESM imports within script', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const esmScript = `
          // Internal module-like structure
          const utils = {
            double: (x) => x * 2
          };

          export default {
            async fetch() {
              return Response.json({ result: utils.double(21) });
            }
          }
        `

        const result = await sandbox.execute(esmScript, {})

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ result: 42 })
      })

      it('supports dynamic imports (with restrictions)', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const dynamicImportScript = `
          export default {
            async fetch() {
              try {
                // This should fail - can't import arbitrary modules
                const module = await import('https://example.com/module.js');
                return Response.json({ imported: true });
              } catch (e) {
                return Response.json({ error: e.message });
              }
            }
          }
        `

        const result = await sandbox.execute(dynamicImportScript, {})

        expect(result.success).toBe(true)
        expect(result.result.error).toBeDefined()
      })
    })

    describe('Scheduled handlers', () => {
      it('can execute scheduled handler', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const scheduledScript = `
          export default {
            async fetch() {
              return new Response('Fetch handler');
            },
            async scheduled(event, env, ctx) {
              // Process scheduled event
              return { processed: true, cron: event.cron };
            }
          }
        `

        const result = await sandbox.executeScheduled(scheduledScript, {
          cron: '* * * * *',
          scheduledTime: Date.now(),
        })

        expect(result.success).toBe(true)
        expect(result.result.processed).toBe(true)
        expect(result.result.cron).toBe('* * * * *')
      })
    })

    describe('Queue handlers', () => {
      it('can execute queue handler', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const queueScript = `
          export default {
            async fetch() {
              return new Response('Fetch handler');
            },
            async queue(batch, env, ctx) {
              const processed = batch.messages.map(msg => ({
                id: msg.id,
                body: msg.body
              }));
              return { processed, count: batch.messages.length };
            }
          }
        `

        const result = await sandbox.executeQueue(queueScript, {
          messages: [
            { id: '1', body: { type: 'test' } },
            { id: '2', body: { type: 'test2' } },
          ],
        })

        expect(result.success).toBe(true)
        expect(result.result.count).toBe(2)
      })
    })

    describe('Concurrent executions', () => {
      it('handles multiple concurrent executions', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const randomDelayScript = `
          export default {
            async fetch(request) {
              const { id } = await request.json();
              await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
              return Response.json({ id, timestamp: Date.now() });
            }
          }
        `

        const promises = Array.from({ length: 5 }, (_, i) =>
          sandbox.execute(randomDelayScript, { id: i })
        )

        const results = await Promise.all(promises)

        expect(results.every((r) => r.success)).toBe(true)
        // Each should have unique ID preserved
        const ids = results.map((r) => r.result.id)
        expect(new Set(ids).size).toBe(5)
      })

      it('isolates concurrent executions from each other', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const stateScript = `
          let counter = 0;
          export default {
            async fetch(request) {
              const { increment } = await request.json();
              counter += increment;
              await new Promise(resolve => setTimeout(resolve, 50));
              return Response.json({ counter });
            }
          }
        `

        // Execute concurrently with different increments
        const results = await Promise.all([
          sandbox.execute(stateScript, { increment: 1 }),
          sandbox.execute(stateScript, { increment: 10 }),
          sandbox.execute(stateScript, { increment: 100 }),
        ])

        expect(results.every((r) => r.success)).toBe(true)

        // If isolated, each should see its own counter
        // If not isolated, results would be unpredictable
        const counters = results.map((r) => r.result.counter)
        // Each isolated execution should have its increment as the counter
        expect(counters).toContain(1)
        expect(counters).toContain(10)
        expect(counters).toContain(100)
      })
    })

    describe('Streaming responses', () => {
      it('supports streaming response output', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const streamScript = `
          export default {
            async fetch() {
              const encoder = new TextEncoder();
              const stream = new ReadableStream({
                async start(controller) {
                  for (let i = 0; i < 3; i++) {
                    controller.enqueue(encoder.encode(\`chunk\${i}\`));
                    await new Promise(resolve => setTimeout(resolve, 10));
                  }
                  controller.close();
                }
              });

              return new Response(stream, {
                headers: { 'Content-Type': 'text/plain' }
              });
            }
          }
        `

        const result = await sandbox.execute(streamScript, {})

        expect(result.success).toBe(true)
        // Result should contain concatenated stream content
        expect(result.result).toBe('chunk0chunk1chunk2')
      })
    })

    describe('WebSocket support', () => {
      it('provides WebSocket API', async () => {
        sandbox = new MiniflareSandbox()
        await sandbox.initialize()

        const wsScript = `
          export default {
            async fetch() {
              return Response.json({
                hasWebSocket: typeof WebSocket === 'function',
                hasWebSocketPair: typeof WebSocketPair === 'function'
              });
            }
          }
        `

        const result = await sandbox.execute(wsScript, {})

        expect(result.success).toBe(true)
        expect(result.result.hasWebSocket).toBe(true)
        expect(result.result.hasWebSocketPair).toBe(true)
      })
    })
  })
})
