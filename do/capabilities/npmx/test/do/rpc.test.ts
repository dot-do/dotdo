/**
 * @fileoverview TDD Tests for Cap'n Web RPC Integration in NpmDO
 *
 * Issue: dotdo-lk9xm - Add Cap'n Web RPC for cross-DO calls
 *
 * Problem: NpmDO uses raw HTTP fetch for cross-DO calls instead of Cap'n Web RPC.
 * Missing promise pipelining (multiple calls = multiple round trips).
 *
 * These tests verify:
 * - RPC client can call fsx operations
 * - Batch operations are pipelined (single round trip)
 * - Errors propagate with type info
 * - Typed client for fsx/bashx
 *
 * TDD RED Phase: These tests should FAIL initially
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock DurableObjectStorage for testing
 */
class MockStorage {
  private data = new Map<string, unknown>()

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    for (const [key, value] of this.data) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T)
      }
    }
    return result
  }

  _clear(): void {
    this.data.clear()
  }

  async setAlarm(_time: Date | number): Promise<void> {
    // Mock alarm setting
  }

  async getAlarm(): Promise<number | null> {
    return null
  }

  async deleteAlarm(): Promise<void> {
    // Mock alarm deletion
  }
}

/**
 * Mock DurableObjectState for testing DO classes
 */
function createMockState(): DurableObjectState {
  const storage = new MockStorage()
  return {
    id: { toString: () => 'test-npm-do-id', name: 'test' },
    storage: storage as unknown as DurableObjectStorage,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    waitUntil: () => {},
  } as unknown as DurableObjectState
}

/**
 * Network tracker for verifying pipelining reduces round trips
 */
interface NetworkTracker {
  /** Number of network round trips */
  roundTrips: number
  /** All batched call payloads */
  batches: unknown[][]
  /** Timestamps of each round trip */
  timestamps: number[]
  /** Reset tracking */
  reset(): void
}

function createNetworkTracker(): NetworkTracker {
  const tracker: NetworkTracker = {
    roundTrips: 0,
    batches: [],
    timestamps: [],
    reset() {
      tracker.roundTrips = 0
      tracker.batches = []
      tracker.timestamps = []
    },
  }
  return tracker
}

/**
 * Mock Fetcher that tracks network calls for pipelining verification.
 * Properly handles both single and batch RPC requests.
 */
function createMockFetcher(tracker: NetworkTracker): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      tracker.roundTrips++
      tracker.timestamps.push(Date.now())

      // Extract the payload
      let payload: unknown = null
      if (init?.body) {
        try {
          payload = JSON.parse(init.body as string)
          tracker.batches.push(Array.isArray(payload) ? payload : [payload])
        } catch {
          tracker.batches.push([])
        }
      }

      // Determine response based on payload type
      let responseData: unknown

      if (Array.isArray(payload)) {
        // Batch request - return array of results
        responseData = payload.map((op: { method?: string }) => {
          // Generate appropriate mock data based on method
          if (op.method === 'readdir') {
            return { data: [{ name: 'lodash', type: 'directory' }, { name: 'express', type: 'directory' }] }
          }
          if (op.method === 'readFile') {
            return { data: JSON.stringify({ name: 'test', version: '1.0.0', dependencies: { lodash: '^4.17.21' } }) }
          }
          return { data: '{}' }
        })
      } else {
        // Single request - return single result
        const method = (payload as { method?: string })?.method
        if (method === 'readdir') {
          responseData = { data: [{ name: 'lodash', type: 'directory' }, { name: 'express', type: 'directory' }] }
        } else if (method === 'readFile') {
          responseData = { data: JSON.stringify({ name: 'test', version: '1.0.0', dependencies: { lodash: '^4.17.21' } }) }
        } else {
          responseData = { data: '{}' }
        }
      }

      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  } as unknown as Fetcher
}

/**
 * Extended mock environment with RPC-capable fetchers
 */
interface NpmEnvWithRpc {
  DO?: DurableObjectNamespace
  FSX?: Fetcher
  BASHX?: Fetcher
  PIPELINE?: { send: (events: unknown[]) => Promise<void> }
}

function createMockEnv(tracker: NetworkTracker): NpmEnvWithRpc {
  return {
    DO: {
      idFromName: (name: string) => ({ toString: () => `id-${name}` }),
      get: () => ({ fetch: async () => new Response('OK') }),
    } as unknown as DurableObjectNamespace,
    FSX: createMockFetcher(tracker),
    BASHX: createMockFetcher(tracker),
  }
}

// ============================================================================
// Test Suite: Cap'n Web RPC Client Integration
// ============================================================================

describe('NpmDO Cap\'n Web RPC Integration', () => {
  let mockState: DurableObjectState
  let tracker: NetworkTracker
  let mockEnv: NpmEnvWithRpc

  beforeEach(() => {
    mockState = createMockState()
    tracker = createNetworkTracker()
    mockEnv = createMockEnv(tracker)
  })

  afterEach(() => {
    tracker.reset()
  })

  // ==========================================================================
  // 1. RPC Client Available
  // ==========================================================================

  describe('RPC Client Availability', () => {
    it('should have rpcClient for fsx available', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // NpmDO should have an RPC client for fsx operations
      expect((instance as any).fsxClient).toBeDefined()
    })

    it('should have rpcClient for bashx available', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // NpmDO should have an RPC client for bashx operations
      expect((instance as any).bashxClient).toBeDefined()
    })

    it('should create RPC client using createClient from capnweb-compat', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // Verify the client is created with proper capnweb integration
      const fsxClient = (instance as any).fsxClient
      expect(fsxClient).toBeDefined()

      // The client should support promise pipelining
      expect(typeof fsxClient.readFile).toBe('function')
    })
  })

  // ==========================================================================
  // 2. Promise Pipelining Tests
  // ==========================================================================

  describe('Promise Pipelining', () => {
    it('should batch multiple fsx calls into single round trip', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // Execute multiple file operations that should be pipelined
      const operations = [
        (instance as any).fsxClient.readFile('/package.json'),
        (instance as any).fsxClient.readFile('/node_modules/lodash/package.json'),
        (instance as any).fsxClient.readFile('/node_modules/react/package.json'),
      ]

      await Promise.all(operations)

      // All operations should be batched into ONE round trip
      expect(tracker.roundTrips).toBe(1)
    })

    it('should pipeline dependent operations in single batch', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // Cap'n Web style property access on unresolved promises.
      // The pipeline proxy allows chaining property access without awaiting.
      //
      // Note: Using pipeline results in template literals requires
      // Symbol.toPrimitive which is a more advanced feature. This test
      // verifies the basic property chaining works with parse().

      const client = (instance as any).fsxClient

      // Build pipeline with property access using parse()
      const pkg = client.readFile('/package.json')
      const depVersion = pkg.parse().dependencies.lodash

      // Now resolve the chain
      const result = await depVersion

      // Result should be the lodash version from mock data
      expect(result).toBe('^4.17.21')

      // Should be single round trip
      expect(tracker.roundTrips).toBe(1)
    })

    it('should support method chaining with pipelining', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const client = (instance as any).fsxClient

      // Chain operations
      const result = client
        .readFile('/package.json')
        .then((content: string) => JSON.parse(content))

      await result

      // Method chaining should still use pipelining
      expect(tracker.roundTrips).toBeLessThanOrEqual(1)
    })
  })

  // ==========================================================================
  // 3. Install Operation Pipelining
  // ==========================================================================

  describe('Install Operation Pipelining', () => {
    it('should pipeline all fsx calls during install', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // Mock registry fetch
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.url

        if (url.includes('registry.npmjs.org/lodash')) {
          return new Response(JSON.stringify({
            name: 'lodash',
            version: '4.17.21',
            description: 'Lodash utilities',
            dist: {
              tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
            },
          }))
        }

        // Mock tarball as empty gzip
        if (url.includes('.tgz')) {
          return new Response(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))
        }

        return new Response('Not Found', { status: 404 })
      })

      // Install should batch:
      // 1. Check if package exists (readFile)
      // 2. Extract tarball (extractTarball)
      await instance.install([{ name: 'lodash', version: '4.17.21' }])

      // The fsx operations should be batched
      // Instead of 2+ round trips, should be <= 2 (check + extract)
      expect(tracker.roundTrips).toBeLessThanOrEqual(2)

      vi.restoreAllMocks()
    })

    it('should batch multiple package installs efficiently', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // Mock registry
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.url

        if (url.includes('registry.npmjs.org')) {
          const name = url.includes('react') ? 'react' : 'lodash'
          return new Response(JSON.stringify({
            name,
            version: '18.0.0',
            dist: {
              tarball: `https://registry.npmjs.org/${name}/-/${name}-18.0.0.tgz`,
            },
          }))
        }

        if (url.includes('.tgz')) {
          return new Response(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))
        }

        return new Response('Not Found', { status: 404 })
      })

      // Install 2 packages - fsx calls should use batching
      await instance.install([
        { name: 'lodash', version: '4.17.21' },
        { name: 'react', version: '18.0.0' },
      ])

      // The install method processes packages sequentially.
      // Each package may require multiple fsx calls (extract, write).
      // With pipelining, each package's fsx calls ARE batched together.
      // Currently expecting <= 4 round trips (2 packages, up to 2 batches each)
      expect(tracker.roundTrips).toBeLessThanOrEqual(4)

      vi.restoreAllMocks()
    })
  })

  // ==========================================================================
  // 4. Error Propagation
  // ==========================================================================

  describe('Error Propagation', () => {
    it('should propagate RPC errors with type info', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')

      // Create mock that returns an error
      const errorTracker = createNetworkTracker()
      const errorEnv = {
        ...mockEnv,
        FSX: {
          fetch: async () => {
            errorTracker.roundTrips++
            return new Response(JSON.stringify({
              error: {
                code: 'FILE_NOT_FOUND',
                message: 'File does not exist',
              },
            }), { status: 404 })
          },
        } as unknown as Fetcher,
      }

      const instance = new NpmDO(mockState, errorEnv as any)

      // Attempt operation that will fail
      try {
        await (instance as any).fsxClient.readFile('/nonexistent.txt')
        expect.fail('Should have thrown')
      } catch (error) {
        // Error should have structured info
        expect(error).toBeDefined()
        expect((error as any).code).toBe('FILE_NOT_FOUND')
        expect((error as any).message).toContain('does not exist')
      }
    })

    it('should handle pipelined operation failures gracefully', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')

      // Mock that returns batch response where second item fails
      const mixedEnv = {
        ...mockEnv,
        FSX: {
          fetch: async (_input: unknown, init?: { body?: string }) => {
            const body = init?.body ? JSON.parse(init.body) : null

            // Handle batch request
            if (Array.isArray(body)) {
              // Return mixed results - first succeeds, second fails
              return new Response(JSON.stringify([
                { data: '{}' },
                { error: { code: 'PERMISSION_DENIED', message: 'Access denied' } },
              ]))
            }

            // Single request
            return new Response(JSON.stringify({ data: '{}' }))
          },
        } as unknown as Fetcher,
      }

      const instance = new NpmDO(mockState, mixedEnv as any)

      const client = (instance as any).fsxClient

      // Two operations, one will fail
      const op1 = client.readFile('/good.txt')
      const op2 = client.readFile('/forbidden.txt')

      const results = await Promise.allSettled([op1, op2])

      // First should succeed
      expect(results[0].status).toBe('fulfilled')

      // Second should fail with error info
      expect(results[1].status).toBe('rejected')
      if (results[1].status === 'rejected') {
        expect((results[1].reason as any).code).toBe('PERMISSION_DENIED')
      }
    })

    it('should include error stage info for pipelined operations', async () => {
      const { NpmDO, RpcError } = await import('../../src/do/NpmDO.js')

      const stageErrorEnv = {
        ...mockEnv,
        FSX: {
          fetch: async () => {
            // Server returns error with stage info
            return new Response(JSON.stringify({
              error: {
                code: 'PIPELINE_ERROR',
                message: 'Failed at stage 2',
                stage: 2,
              },
            }), { status: 500 })
          },
        } as unknown as Fetcher,
      }

      const instance = new NpmDO(mockState, stageErrorEnv as any)
      const client = (instance as any).fsxClient

      // Call should throw with stage info
      let caughtError: any = null
      try {
        await client.readFile('/test.txt')
      } catch (error) {
        caughtError = error
      }

      // Error should be an RpcError with stage info
      expect(caughtError).toBeDefined()
      expect(caughtError).toBeInstanceOf(RpcError)
      expect(caughtError.code).toBe('PIPELINE_ERROR')
      expect(caughtError.stage).toBe(2)
    })
  })

  // ==========================================================================
  // 5. Typed Client Generation
  // ==========================================================================

  describe('Typed Client', () => {
    it('should have typed readFile method', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const client = (instance as any).fsxClient

      // TypeScript should know readFile returns a promise
      const result = client.readFile('/test.txt')
      expect(result).toBeDefined()
      expect(typeof result.then).toBe('function')
    })

    it('should have typed writeFile method', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const client = (instance as any).fsxClient

      // writeFile should accept content and options
      const result = client.writeFile('/test.txt', 'content', { encoding: 'utf-8' })
      expect(result).toBeDefined()
      expect(typeof result.then).toBe('function')
    })

    it('should have typed exec method for bashx', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const client = (instance as any).bashxClient

      // exec should accept command and args
      const result = client.exec('npm', ['install', 'lodash'])
      expect(result).toBeDefined()
      expect(typeof result.then).toBe('function')
    })

    it('should have typed extractTarball method', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const client = (instance as any).fsxClient

      // extractTarball should accept data and destination
      const result = client.extractTarball(new Uint8Array([]), '/dest')
      expect(result).toBeDefined()
      expect(typeof result.then).toBe('function')
    })
  })

  // ==========================================================================
  // 6. Batch Efficiency Verification
  // ==========================================================================

  describe('Batch Efficiency', () => {
    it('should send 10 operations in single batch', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const client = (instance as any).fsxClient

      // Create 10 independent operations
      const operations = []
      for (let i = 0; i < 10; i++) {
        operations.push(client.readFile(`/file${i}.txt`))
      }

      await Promise.all(operations)

      // All 10 should be in ONE batch
      expect(tracker.roundTrips).toBe(1)
      expect(tracker.batches[0].length).toBe(10)
    })

    it('should batch listInstalled efficiently', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // listInstalled reads directory and then reads each package.json
      // Old way: 1 readdir + N readFile = N+1 round trips
      // New way: Should batch the readFile calls

      // Reset tracker
      tracker.reset()

      await instance.listInstalled()

      // With pipelining, should be minimal round trips
      // At most 2: one for readdir, one for batched readFiles
      expect(tracker.roundTrips).toBeLessThanOrEqual(2)
    })
  })

  // ==========================================================================
  // 7. Magic Map Pattern Support
  // ==========================================================================

  describe('Magic Map Pattern', () => {
    it('should support magic map for array operations', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const client = (instance as any).fsxClient

      // Read directory and then read all package.json files using magic map
      const files = client.readdir('/node_modules')
      const packages = files.map((entry: { name: string }) =>
        client.readFile(`/node_modules/${entry.name}/package.json`)
      )

      await packages

      // Magic map should batch all reads into single round trip
      expect(tracker.roundTrips).toBeLessThanOrEqual(2)
    })
  })

  // ==========================================================================
  // 8. Cross-DO Resolution Pattern
  // ==========================================================================

  describe('Cross-DO Resolution', () => {
    it('should resolve fsx.do via $ context', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // $ context should provide access to cross-DO services
      const $ = instance.$

      // Should be able to resolve fsx operations via $ proxy
      const fsxProxy = $.resolve('fsx.do')
      expect(fsxProxy).toBeDefined()
    })

    it('should pipeline cross-DO calls via $ proxy', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const $ = instance.$

      // Build pipeline of cross-DO operations
      const fsx = $.resolve('fsx.do')
      const content = fsx.fs.read('/package.json')
      const parsed = content.parse()

      // These should all be captured as pipeline expressions
      expect(parsed).toBeDefined()
    })
  })
})

// ============================================================================
// Test Suite: Integration with Existing API
// ============================================================================

describe('NpmDO RPC Integration Compatibility', () => {
  let mockState: DurableObjectState
  let tracker: NetworkTracker
  let mockEnv: NpmEnvWithRpc

  beforeEach(() => {
    mockState = createMockState()
    tracker = createNetworkTracker()
    mockEnv = createMockEnv(tracker)
  })

  afterEach(() => {
    tracker.reset()
    vi.restoreAllMocks()
  })

  it('should maintain backward compatibility with getPackageMetadata', async () => {
    const { NpmDO } = await import('../../src/do/NpmDO.js')
    const instance = new NpmDO(mockState, mockEnv as any)

    // Mock registry fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        name: 'lodash',
        version: '4.17.21',
        description: 'Lodash utilities',
      }))
    })

    // Existing API should still work
    const metadata = await instance.getPackageMetadata('lodash')
    expect(metadata.name).toBe('lodash')
    expect(metadata.version).toBe('4.17.21')
  })

  it('should maintain backward compatibility with search', async () => {
    const { NpmDO } = await import('../../src/do/NpmDO.js')
    const instance = new NpmDO(mockState, mockEnv as any)

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        objects: [
          { package: { name: 'lodash', version: '4.17.21', description: 'Utilities' } },
        ],
      }))
    })

    const results = await instance.search('lodash')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].name).toBe('lodash')
  })

  it('should use RPC client internally but expose same API', async () => {
    const { NpmDO } = await import('../../src/do/NpmDO.js')
    const instance = new NpmDO(mockState, mockEnv as any)

    // The public API should be unchanged
    expect(typeof instance.getPackageMetadata).toBe('function')
    expect(typeof instance.search).toBe('function')
    expect(typeof instance.install).toBe('function')
    expect(typeof instance.exec).toBe('function')
    expect(typeof instance.runScript).toBe('function')
    expect(typeof instance.listInstalled).toBe('function')
    expect(typeof instance.clearCache).toBe('function')

    // But internally, it should now use RPC clients
    expect((instance as any).fsxClient).toBeDefined()
  })
})
