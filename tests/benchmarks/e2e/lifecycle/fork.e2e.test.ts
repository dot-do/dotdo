/**
 * E2E Benchmarks: fork() Operation
 *
 * Tests DO forking to create isolated branches/namespaces.
 * Targets: fork.perf.do
 *
 * Operations tested:
 * - Fork to new namespace
 * - Branch isolation verification
 * - State independence after fork
 * - Fork with filtering (partial state copy)
 *
 * @see objects/DO.ts for fork() implementation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { benchmark, record, type BenchmarkResult } from '../../lib'

// ============================================================================
// BENCHMARK CONFIGURATION
// ============================================================================

/** Target DO endpoint for fork operations */
const TARGET = 'fork.perf.do'

/** Number of iterations for latency benchmarks */
const ITERATIONS = 20

/** Number of warmup iterations */
const WARMUP = 3

/** Maximum acceptable latency for fork operation (ms) */
const MAX_FORK_LATENCY_MS = 3000

/** Maximum acceptable latency for shallow fork (ms) */
const MAX_SHALLOW_FORK_MS = 1000

// ============================================================================
// E2E FORK BENCHMARKS
// ============================================================================

describe('fork() E2E Benchmarks', () => {
  const testRunId = `fork-${Date.now()}`
  const results: BenchmarkResult[] = []
  const createdForks: string[] = []

  afterAll(async () => {
    // Record all results at the end
    if (results.length > 0) {
      record(results)
    }
  })

  describe('Fork to New Namespace', () => {
    it('forks DO to new namespace', async () => {
      const result = await benchmark({
        name: 'fork-to-namespace',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const newNamespace = `fork-ns-${testRunId}-${iteration}`
          createdForks.push(newNamespace)

          return ctx.do.request('/fork', {
            method: 'POST',
            body: JSON.stringify({
              namespace: newNamespace,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_FORK_LATENCY_MS)
    })

    it('forks with custom ID', async () => {
      const result = await benchmark({
        name: 'fork-with-custom-id',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const namespace = `fork-custom-${testRunId}-${iteration}`
          const customId = `custom-do-${Date.now()}-${iteration}`
          createdForks.push(namespace)

          return ctx.do.request('/fork', {
            method: 'POST',
            body: JSON.stringify({
              namespace,
              id: customId,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_FORK_LATENCY_MS)
    })

    it('forks to same namespace with new ID (branch)', async () => {
      const result = await benchmark({
        name: 'fork-as-branch',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const branchId = `branch-${testRunId}-${iteration}`

          return ctx.do.request('/fork', {
            method: 'POST',
            body: JSON.stringify({
              id: branchId,
              asBranch: true,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_FORK_LATENCY_MS)
    })
  })

  describe('Branch Isolation', () => {
    it('verifies forked DO has isolated state', async () => {
      const result = await benchmark({
        name: 'fork-isolation-verify',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        setup: async (ctx) => {
          // Set initial state in source DO
          await ctx.do.request('/state', {
            method: 'PUT',
            body: JSON.stringify({
              key: 'isolation-test',
              value: { original: true, counter: 100 },
            }),
          })
        },
        run: async (ctx, iteration) => {
          const forkNamespace = `isolation-${testRunId}-${iteration}`
          createdForks.push(forkNamespace)

          // Fork the DO
          const forkResult = await ctx.do.request<{ forkUrl: string }>('/fork', {
            method: 'POST',
            body: JSON.stringify({ namespace: forkNamespace }),
          })

          // Modify state in forked DO
          await ctx.fetch(`https://${forkNamespace}.perf.do/state`, {
            method: 'PUT',
            body: JSON.stringify({
              key: 'isolation-test',
              value: { original: false, counter: 200 },
            }),
          })

          // Verify original DO state is unchanged
          const originalState = await ctx.do.get<{ value: { original: boolean; counter: number } }>(
            '/state?key=isolation-test'
          )

          if (originalState.value?.counter !== 100) {
            throw new Error('Fork modified original DO state!')
          }

          return { forkResult, originalState }
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it('verifies forked DO cannot access source DO data', async () => {
      const result = await benchmark({
        name: 'fork-no-cross-access',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Create secret data in source
          await ctx.do.request('/state', {
            method: 'PUT',
            body: JSON.stringify({
              key: 'secret-data',
              value: { secret: 'source-only' },
            }),
          })
        },
        run: async (ctx, iteration) => {
          const forkNamespace = `no-cross-${testRunId}-${iteration}`
          createdForks.push(forkNamespace)

          // Fork
          await ctx.do.request('/fork', {
            method: 'POST',
            body: JSON.stringify({ namespace: forkNamespace }),
          })

          // Update secret in source after fork
          await ctx.do.request('/state', {
            method: 'PUT',
            body: JSON.stringify({
              key: 'secret-data',
              value: { secret: 'updated-after-fork' },
            }),
          })

          // Fork should still have old value
          const forkState = await ctx.fetch(`https://${forkNamespace}.perf.do/state?key=secret-data`)
          const forkData = (await forkState.json()) as { value: { secret: string } }

          if (forkData.value?.secret === 'updated-after-fork') {
            throw new Error('Fork has access to source updates!')
          }

          return forkData
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })

  describe('State Independence After Fork', () => {
    it('verifies state changes are independent', async () => {
      const result = await benchmark({
        name: 'fork-state-independence',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const forkNamespace = `indep-${testRunId}-${iteration}`
          createdForks.push(forkNamespace)

          // Fork the DO
          await ctx.do.request('/fork', {
            method: 'POST',
            body: JSON.stringify({ namespace: forkNamespace }),
          })

          // Increment counter in source
          await ctx.do.request('/counter/increment', { method: 'POST' })

          // Decrement counter in fork
          await ctx.fetch(`https://${forkNamespace}.perf.do/counter/decrement`, {
            method: 'POST',
          })

          // Get both counters
          const sourceCounter = await ctx.do.get<{ value: number }>('/counter')
          const forkCounter = await ctx.fetch(`https://${forkNamespace}.perf.do/counter`)
          const forkCounterData = (await forkCounter.json()) as { value: number }

          // They should be different
          if (sourceCounter.value === forkCounterData.value) {
            throw new Error('Counters are not independent')
          }

          return { source: sourceCounter.value, fork: forkCounterData.value }
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it('verifies WebSocket connections are independent', async () => {
      const result = await benchmark({
        name: 'fork-websocket-independence',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          const forkNamespace = `ws-indep-${testRunId}-${iteration}`
          createdForks.push(forkNamespace)

          // Get connection count before fork
          const beforeFork = await ctx.do.get<{ connections: number }>('/ws/stats')

          // Fork
          await ctx.do.request('/fork', {
            method: 'POST',
            body: JSON.stringify({ namespace: forkNamespace }),
          })

          // Fork should start with 0 connections
          const forkStats = await ctx.fetch(`https://${forkNamespace}.perf.do/ws/stats`)
          const forkStatsData = (await forkStats.json()) as { connections: number }

          if (forkStatsData.connections !== 0) {
            throw new Error('Fork inherited WebSocket connections')
          }

          return { source: beforeFork.connections, fork: forkStatsData.connections }
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Fork with Filtering', () => {
    it('forks with partial state copy', async () => {
      const result = await benchmark({
        name: 'fork-partial-state',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        setup: async (ctx) => {
          // Set up multiple state keys
          await ctx.do.request('/state/batch', {
            method: 'PUT',
            body: JSON.stringify({
              items: [
                { key: 'public', value: { data: 'shareable' } },
                { key: 'private', value: { data: 'confidential' } },
                { key: 'temp', value: { data: 'temporary' } },
              ],
            }),
          })
        },
        run: async (ctx, iteration) => {
          const forkNamespace = `partial-${testRunId}-${iteration}`
          createdForks.push(forkNamespace)

          // Fork with filter - only copy public keys
          return ctx.do.request('/fork', {
            method: 'POST',
            body: JSON.stringify({
              namespace: forkNamespace,
              filter: {
                include: ['public'],
                exclude: ['private', 'temp'],
              },
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_FORK_LATENCY_MS)
    })

    it('forks with table filter', async () => {
      const result = await benchmark({
        name: 'fork-table-filter',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Create tables
          await ctx.do.request('/db/exec', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT);
                CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, message TEXT);
                CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, action TEXT);
              `,
            }),
          })
        },
        run: async (ctx, iteration) => {
          const forkNamespace = `table-filter-${testRunId}-${iteration}`
          createdForks.push(forkNamespace)

          // Fork only users table, exclude logs and audit
          return ctx.do.request('/fork', {
            method: 'POST',
            body: JSON.stringify({
              namespace: forkNamespace,
              tables: {
                include: ['users'],
                exclude: ['logs', 'audit'],
              },
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_FORK_LATENCY_MS)
    })
  })

  describe('Fork Performance Analysis', () => {
    it('measures fork latency by state size', async () => {
      const dataSizes = [
        { name: 'empty', records: 0 },
        { name: 'small', records: 100 },
        { name: 'medium', records: 1000 },
        { name: 'large', records: 10000 },
      ]

      for (const size of dataSizes) {
        const result = await benchmark({
          name: `fork-size-${size.name}`,
          target: TARGET,
          iterations: 5,
          warmup: 1,
          datasetSize: size.records,
          setup: async (ctx) => {
            if (size.records > 0) {
              // Batch insert test data
              await ctx.do.request('/db/seed', {
                method: 'POST',
                body: JSON.stringify({ records: size.records }),
              })
            }
          },
          run: async (ctx, iteration) => {
            const namespace = `size-${size.name}-${testRunId}-${iteration}`
            createdForks.push(namespace)

            return ctx.do.request('/fork', {
              method: 'POST',
              body: JSON.stringify({ namespace }),
            })
          },
          teardown: async (ctx) => {
            // Clean up test data
            await ctx.do.request('/db/truncate', { method: 'POST' })
          },
        })

        results.push(result)
        // Larger datasets should take longer
        const expectedMax = MAX_FORK_LATENCY_MS * (1 + size.records / 10000)
        expect(result.stats.p95).toBeLessThan(expectedMax)
      }
    })

    it('measures shallow fork performance', async () => {
      const result = await benchmark({
        name: 'fork-shallow',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const namespace = `shallow-${testRunId}-${iteration}`
          createdForks.push(namespace)

          // Shallow fork - copy-on-write semantics
          return ctx.do.request('/fork', {
            method: 'POST',
            body: JSON.stringify({
              namespace,
              shallow: true, // Uses copy-on-write
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_SHALLOW_FORK_MS)
    })

    it('measures concurrent fork operations', async () => {
      const result = await benchmark({
        name: 'fork-concurrent',
        target: TARGET,
        iterations: 5,
        warmup: 1,
        run: async (ctx, iteration) => {
          const forkPromises = Array.from({ length: 3 }, (_, i) => {
            const namespace = `concurrent-${testRunId}-${iteration}-${i}`
            createdForks.push(namespace)
            return ctx.do.request('/fork', {
              method: 'POST',
              body: JSON.stringify({ namespace }),
            })
          })

          return Promise.all(forkPromises)
        },
      })

      results.push(result)
      // Concurrent forks should complete within reasonable time
      expect(result.stats.p95).toBeLessThan(MAX_FORK_LATENCY_MS * 2)
    })
  })

  describe('Fork Event Handling', () => {
    it('emits fork events', async () => {
      const result = await benchmark({
        name: 'fork-events',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const namespace = `events-${testRunId}-${iteration}`
          createdForks.push(namespace)

          // Subscribe to fork events
          await ctx.do.request('/events/subscribe', {
            method: 'POST',
            body: JSON.stringify({
              events: ['fork.started', 'fork.completed'],
            }),
          })

          // Perform fork
          await ctx.do.request('/fork', {
            method: 'POST',
            body: JSON.stringify({ namespace }),
          })

          // Check events
          const events = await ctx.do.get<{ events: string[] }>('/events/recent')

          if (!events.events?.includes('fork.completed')) {
            throw new Error('fork.completed event not emitted')
          }

          return events
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })
})
