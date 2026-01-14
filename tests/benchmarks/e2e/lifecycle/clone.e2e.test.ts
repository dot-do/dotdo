/**
 * E2E Benchmarks: clone() Operation Modes
 *
 * Tests different DO cloning strategies and modes.
 * Targets: clone.perf.do
 *
 * Operations tested:
 * - Atomic mode (blockConcurrencyWhile)
 * - Staged mode (2PC with tokens)
 * - Eventual mode (background sync)
 * - Resumable mode (checkpoints)
 *
 * @see objects/DO.ts for clone() implementation
 */

import { describe, it, expect, afterAll } from 'vitest'
import { benchmark, record, type BenchmarkResult } from '../../lib'

// ============================================================================
// BENCHMARK CONFIGURATION
// ============================================================================

/** Target DO endpoint for clone operations */
const TARGET = 'clone.perf.do'

/** Number of iterations for latency benchmarks */
const ITERATIONS = 20

/** Number of warmup iterations */
const WARMUP = 3

/** Maximum acceptable latency for atomic clone (ms) */
const MAX_ATOMIC_CLONE_MS = 3000

/** Maximum acceptable latency for staged clone prepare (ms) */
const MAX_STAGED_PREPARE_MS = 1000

/** Maximum acceptable latency for eventual clone initiation (ms) */
const MAX_EVENTUAL_INIT_MS = 500

/** Maximum acceptable latency for checkpoint operations (ms) */
const MAX_CHECKPOINT_MS = 1500

// ============================================================================
// E2E CLONE BENCHMARKS
// ============================================================================

describe('clone() E2E Benchmarks', () => {
  const testRunId = `clone-${Date.now()}`
  const results: BenchmarkResult[] = []

  afterAll(() => {
    if (results.length > 0) {
      record(results)
    }
  })

  describe('Atomic Mode (blockConcurrencyWhile)', () => {
    it('clones DO atomically', async () => {
      const result = await benchmark({
        name: 'clone-atomic',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const targetId = `atomic-clone-${testRunId}-${iteration}`

          return ctx.do.request('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'atomic',
              targetId,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_ATOMIC_CLONE_MS)
    })

    it('blocks concurrent requests during atomic clone', async () => {
      const result = await benchmark({
        name: 'clone-atomic-blocking',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          const targetId = `atomic-block-${testRunId}-${iteration}`

          // Start atomic clone
          const clonePromise = ctx.do.request('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'atomic',
              targetId,
            }),
          })

          // Try concurrent request (should be blocked)
          const concurrentStart = performance.now()
          const statusPromise = ctx.do.get('/status')

          // Wait for both
          const [cloneResult, status] = await Promise.all([clonePromise, statusPromise])
          const concurrentDuration = performance.now() - concurrentStart

          return {
            cloneResult,
            status,
            blockedMs: concurrentDuration,
          }
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_ATOMIC_CLONE_MS * 1.5)
    })

    it('ensures atomic clone consistency', async () => {
      const result = await benchmark({
        name: 'clone-atomic-consistency',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        setup: async (ctx) => {
          // Set up consistent state
          await ctx.do.request('/state', {
            method: 'PUT',
            body: JSON.stringify({
              key: 'atomic-test',
              value: { counter: 100, updated: Date.now() },
            }),
          })
        },
        run: async (ctx, iteration) => {
          const targetId = `atomic-consist-${testRunId}-${iteration}`

          // Clone atomically
          await ctx.do.request('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'atomic',
              targetId,
            }),
          })

          // Verify clone has exact same state
          const sourceState = await ctx.do.get<{ value: { counter: number } }>('/state?key=atomic-test')
          const cloneState = await ctx.fetch(`https://${targetId}.perf.do/state?key=atomic-test`)
          const cloneData = (await cloneState.json()) as { value: { counter: number } }

          if (sourceState.value?.counter !== cloneData.value?.counter) {
            throw new Error('Atomic clone state mismatch')
          }

          return { source: sourceState, clone: cloneData }
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it('handles atomic clone with large state', async () => {
      const result = await benchmark({
        name: 'clone-atomic-large-state',
        target: TARGET,
        iterations: 5,
        warmup: 1,
        datasetSize: 10000,
        setup: async (ctx) => {
          // Seed large dataset
          await ctx.do.request('/db/seed', {
            method: 'POST',
            body: JSON.stringify({ records: 10000 }),
          })
        },
        run: async (ctx, iteration) => {
          const targetId = `atomic-large-${testRunId}-${iteration}`

          return ctx.do.request('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'atomic',
              targetId,
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/db/truncate', { method: 'POST' })
        },
      })

      results.push(result)
      // Large state clone takes longer
      expect(result.stats.p95).toBeLessThan(MAX_ATOMIC_CLONE_MS * 3)
    })
  })

  describe('Staged Mode (2PC with Tokens)', () => {
    it('prepares staged clone', async () => {
      const result = await benchmark({
        name: 'clone-staged-prepare',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const targetId = `staged-prepare-${testRunId}-${iteration}`

          // Prepare phase
          return ctx.do.request<{ token: string; snapshot: unknown }>('/clone/prepare', {
            method: 'POST',
            body: JSON.stringify({ targetId }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_STAGED_PREPARE_MS)
    })

    it('commits staged clone', async () => {
      const result = await benchmark({
        name: 'clone-staged-commit',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const targetId = `staged-commit-${testRunId}-${iteration}`

          // Prepare phase
          const prepared = await ctx.do.request<{ token: string }>('/clone/prepare', {
            method: 'POST',
            body: JSON.stringify({ targetId }),
          })

          // Commit phase
          return ctx.do.request('/clone/commit', {
            method: 'POST',
            body: JSON.stringify({
              token: prepared.token,
              targetId,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_ATOMIC_CLONE_MS)
    })

    it('aborts staged clone', async () => {
      const result = await benchmark({
        name: 'clone-staged-abort',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const targetId = `staged-abort-${testRunId}-${iteration}`

          // Prepare phase
          const prepared = await ctx.do.request<{ token: string }>('/clone/prepare', {
            method: 'POST',
            body: JSON.stringify({ targetId }),
          })

          // Abort phase
          return ctx.do.request('/clone/abort', {
            method: 'POST',
            body: JSON.stringify({
              token: prepared.token,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_STAGED_PREPARE_MS)
    })

    it('handles token expiration', async () => {
      const result = await benchmark({
        name: 'clone-staged-token-expiry',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          const targetId = `staged-expiry-${testRunId}-${iteration}`

          // Prepare with short TTL
          const prepared = await ctx.do.request<{ token: string; expiresAt: number }>('/clone/prepare', {
            method: 'POST',
            body: JSON.stringify({
              targetId,
              tokenTtl: 1000, // 1 second
            }),
          })

          // Wait for token to expire
          await new Promise((resolve) => setTimeout(resolve, 1100))

          // Commit should fail with expired token
          try {
            await ctx.do.request('/clone/commit', {
              method: 'POST',
              body: JSON.stringify({
                token: prepared.token,
                targetId,
              }),
            })
            throw new Error('Expected token expiry error')
          } catch (e) {
            // Expected: token expired
            return { tokenExpired: true }
          }
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it('handles concurrent prepare requests', async () => {
      const result = await benchmark({
        name: 'clone-staged-concurrent-prepare',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          // Multiple concurrent prepares
          const prepares = Promise.all([
            ctx.do.request<{ token: string }>('/clone/prepare', {
              method: 'POST',
              body: JSON.stringify({ targetId: `concurrent-a-${testRunId}-${iteration}` }),
            }),
            ctx.do.request<{ token: string }>('/clone/prepare', {
              method: 'POST',
              body: JSON.stringify({ targetId: `concurrent-b-${testRunId}-${iteration}` }),
            }),
          ])

          const [prepA, prepB] = await prepares

          // Both should get different tokens
          if (prepA.token === prepB.token) {
            throw new Error('Concurrent prepares should have unique tokens')
          }

          return { tokenA: prepA.token, tokenB: prepB.token }
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Eventual Mode (Background Sync)', () => {
    it('initiates eventual clone', async () => {
      const result = await benchmark({
        name: 'clone-eventual-init',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const targetId = `eventual-init-${testRunId}-${iteration}`

          // Initiate eventual clone (returns immediately)
          return ctx.do.request<{ jobId: string; status: string }>('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'eventual',
              targetId,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_EVENTUAL_INIT_MS)
    })

    it('checks eventual clone progress', async () => {
      const result = await benchmark({
        name: 'clone-eventual-progress',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const targetId = `eventual-progress-${testRunId}-${iteration}`

          // Start clone
          const job = await ctx.do.request<{ jobId: string }>('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'eventual',
              targetId,
            }),
          })

          // Poll for progress
          let attempts = 0
          let status: { progress: number; status: string } | undefined

          while (attempts < 10) {
            status = await ctx.do.get<{ progress: number; status: string }>(`/clone/status/${job.jobId}`)
            if (status.status === 'completed' || status.status === 'failed') {
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 100))
            attempts++
          }

          return status
        },
      })

      results.push(result)
      // Eventual clone with polling takes longer
      expect(result.stats.p95).toBeLessThan(MAX_ATOMIC_CLONE_MS)
    })

    it('handles eventual clone cancellation', async () => {
      const result = await benchmark({
        name: 'clone-eventual-cancel',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          const targetId = `eventual-cancel-${testRunId}-${iteration}`

          // Start clone
          const job = await ctx.do.request<{ jobId: string }>('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'eventual',
              targetId,
            }),
          })

          // Cancel immediately
          return ctx.do.request('/clone/cancel', {
            method: 'POST',
            body: JSON.stringify({ jobId: job.jobId }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_EVENTUAL_INIT_MS * 2)
    })

    it('handles multiple eventual clones', async () => {
      const result = await benchmark({
        name: 'clone-eventual-multiple',
        target: TARGET,
        iterations: 5,
        warmup: 1,
        run: async (ctx, iteration) => {
          // Start multiple eventual clones
          const jobs = await Promise.all([
            ctx.do.request<{ jobId: string }>('/clone', {
              method: 'POST',
              body: JSON.stringify({
                mode: 'eventual',
                targetId: `multi-a-${testRunId}-${iteration}`,
              }),
            }),
            ctx.do.request<{ jobId: string }>('/clone', {
              method: 'POST',
              body: JSON.stringify({
                mode: 'eventual',
                targetId: `multi-b-${testRunId}-${iteration}`,
              }),
            }),
            ctx.do.request<{ jobId: string }>('/clone', {
              method: 'POST',
              body: JSON.stringify({
                mode: 'eventual',
                targetId: `multi-c-${testRunId}-${iteration}`,
              }),
            }),
          ])

          return { jobs: jobs.map((j) => j.jobId) }
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_EVENTUAL_INIT_MS * 3)
    })
  })

  describe('Resumable Mode (Checkpoints)', () => {
    it('creates checkpoint during clone', async () => {
      const result = await benchmark({
        name: 'clone-resumable-checkpoint',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const targetId = `checkpoint-${testRunId}-${iteration}`

          // Start resumable clone
          return ctx.do.request<{ checkpointId: string; progress: number }>('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'resumable',
              targetId,
              checkpointInterval: 1000, // Checkpoint every 1000 records
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_CHECKPOINT_MS)
    })

    it('resumes clone from checkpoint', async () => {
      const result = await benchmark({
        name: 'clone-resumable-resume',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Create some data to clone
          await ctx.do.request('/db/seed', {
            method: 'POST',
            body: JSON.stringify({ records: 5000 }),
          })
        },
        run: async (ctx, iteration) => {
          const targetId = `resume-${testRunId}-${iteration}`

          // Start clone and simulate interruption
          const job = await ctx.do.request<{ jobId: string; checkpointId: string }>('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'resumable',
              targetId,
              checkpointInterval: 500,
            }),
          })

          // Pause the clone
          await ctx.do.request('/clone/pause', {
            method: 'POST',
            body: JSON.stringify({ jobId: job.jobId }),
          })

          // Resume from checkpoint
          return ctx.do.request('/clone/resume', {
            method: 'POST',
            body: JSON.stringify({
              jobId: job.jobId,
              checkpointId: job.checkpointId,
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/db/truncate', { method: 'POST' })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_CHECKPOINT_MS * 2)
    })

    it('lists available checkpoints', async () => {
      const result = await benchmark({
        name: 'clone-resumable-list-checkpoints',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const targetId = `list-cp-${testRunId}-${iteration}`

          // Start clone with multiple checkpoints
          const job = await ctx.do.request<{ jobId: string }>('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'resumable',
              targetId,
              checkpointInterval: 100,
            }),
          })

          // List checkpoints
          return ctx.do.get<{ checkpoints: Array<{ id: string; progress: number }> }>(
            `/clone/checkpoints/${job.jobId}`
          )
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_CHECKPOINT_MS)
    })

    it('handles checkpoint cleanup', async () => {
      const result = await benchmark({
        name: 'clone-resumable-cleanup',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          const targetId = `cleanup-cp-${testRunId}-${iteration}`

          // Start and complete clone
          const job = await ctx.do.request<{ jobId: string }>('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'resumable',
              targetId,
              checkpointInterval: 100,
            }),
          })

          // Wait for completion
          let status: { status: string } = { status: 'pending' }
          while (status.status !== 'completed' && status.status !== 'failed') {
            await new Promise((resolve) => setTimeout(resolve, 50))
            status = await ctx.do.get<{ status: string }>(`/clone/status/${job.jobId}`)
          }

          // Cleanup checkpoints
          return ctx.do.request('/clone/cleanup', {
            method: 'POST',
            body: JSON.stringify({
              jobId: job.jobId,
              deleteCheckpoints: true,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_CHECKPOINT_MS)
    })
  })

  describe('Clone Mode Comparison', () => {
    it('compares clone modes performance', async () => {
      const modes = ['atomic', 'staged', 'eventual', 'resumable'] as const
      const modeResults: Array<{ mode: string; p50: number; p95: number }> = []

      for (const mode of modes) {
        const result = await benchmark({
          name: `clone-compare-${mode}`,
          target: TARGET,
          iterations: 10,
          warmup: 2,
          run: async (ctx, iteration) => {
            const targetId = `compare-${mode}-${testRunId}-${iteration}`

            if (mode === 'staged') {
              // Staged requires two phases
              const prepared = await ctx.do.request<{ token: string }>('/clone/prepare', {
                method: 'POST',
                body: JSON.stringify({ targetId }),
              })
              return ctx.do.request('/clone/commit', {
                method: 'POST',
                body: JSON.stringify({ token: prepared.token, targetId }),
              })
            }

            return ctx.do.request('/clone', {
              method: 'POST',
              body: JSON.stringify({ mode, targetId }),
            })
          },
        })

        results.push(result)
        modeResults.push({
          mode,
          p50: result.stats.p50,
          p95: result.stats.p95,
        })
      }

      // Log comparison
      console.log('\n--- Clone Mode Performance Comparison ---')
      console.log('Mode       | p50 (ms) | p95 (ms)')
      console.log('-----------|----------|----------')
      for (const r of modeResults) {
        console.log(`${r.mode.padEnd(10)} | ${r.p50.toFixed(2).padStart(8)} | ${r.p95.toFixed(2).padStart(8)}`)
      }
    })

    it('measures clone with varying data sizes', async () => {
      const sizes = [100, 1000, 5000]

      for (const size of sizes) {
        const result = await benchmark({
          name: `clone-size-${size}`,
          target: TARGET,
          iterations: 5,
          warmup: 1,
          datasetSize: size,
          setup: async (ctx) => {
            await ctx.do.request('/db/seed', {
              method: 'POST',
              body: JSON.stringify({ records: size }),
            })
          },
          run: async (ctx, iteration) => {
            return ctx.do.request('/clone', {
              method: 'POST',
              body: JSON.stringify({
                mode: 'atomic',
                targetId: `size-${size}-${testRunId}-${iteration}`,
              }),
            })
          },
          teardown: async (ctx) => {
            await ctx.do.request('/db/truncate', { method: 'POST' })
          },
        })

        results.push(result)
      }
    })
  })

  describe('Clone Event Handling', () => {
    it('emits clone lifecycle events', async () => {
      const result = await benchmark({
        name: 'clone-events',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const targetId = `events-${testRunId}-${iteration}`

          // Subscribe to events
          await ctx.do.request('/events/subscribe', {
            method: 'POST',
            body: JSON.stringify({
              events: ['clone.started', 'clone.progress', 'clone.completed'],
            }),
          })

          // Perform clone
          await ctx.do.request('/clone', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'atomic',
              targetId,
            }),
          })

          // Check events
          const events = await ctx.do.get<{ events: string[] }>('/events/recent')

          if (!events.events?.includes('clone.completed')) {
            throw new Error('clone.completed event not emitted')
          }

          return events
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })
})
