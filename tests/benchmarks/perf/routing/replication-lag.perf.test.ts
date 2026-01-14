/**
 * Replication Lag Performance Benchmarks
 *
 * Tests write-then-read consistency and replication lag measurement:
 * - Write-then-read consistency rates
 * - Measuring how often replicas have latest data
 * - Calculating consistency rate percentages
 * - Lag distribution across different replica regions
 *
 * @see db/core/replica.ts for implementation
 * @see dotdo-gj6wa for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record, type BenchmarkResult } from '../../lib'

/** Available replica regions */
const REGIONS = ['us-east', 'us-west', 'eu-west', 'eu-central', 'ap-northeast', 'ap-southeast'] as const
type Region = (typeof REGIONS)[number]

/** Extended result type for consistency metrics */
interface ConsistencyResult extends BenchmarkResult {
  metadata: {
    consistentReads: number
    inconsistentReads: number
    consistencyRate: number
    avgLagMs?: number
    maxLagMs?: number
    [key: string]: unknown
  }
}

describe('replication lag', () => {
  describe('write-then-read consistency', () => {
    it('measures immediate read-after-write consistency', async () => {
      let consistentReads = 0
      let inconsistentReads = 0
      const iterations = 50

      const result = await benchmark({
        name: 'replication-lag-immediate',
        target: 'replicated.perf.do',
        iterations,
        warmup: 5,
        run: async (ctx, i) => {
          const testKey = `lag-test-${i}-${Date.now()}`
          const testValue = { data: i, timestamp: Date.now() }

          // Write to primary
          await ctx.fetch('/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: testKey, value: testValue }),
          })

          // Immediately read from nearest replica (not primary)
          const readResponse = await ctx.fetch(`/data/${testKey}?replica=nearest`)
          const readData = (await readResponse.json()) as { value?: { data: number } }

          if (readData.value?.data === i) {
            consistentReads++
          } else {
            inconsistentReads++
          }

          return readResponse
        },
      })

      const consistencyRate = consistentReads / iterations

      // Create extended result with consistency metrics
      const consistencyResult: ConsistencyResult = {
        ...result,
        metadata: {
          consistentReads,
          inconsistentReads,
          consistencyRate,
        },
      }

      record(consistencyResult)

      // Log results
      console.log(`Immediate read-after-write consistency: ${(consistencyRate * 100).toFixed(1)}%`)
      console.log(`  Consistent: ${consistentReads}/${iterations}`)
      console.log(`  Inconsistent: ${inconsistentReads}/${iterations}`)

      // Immediate reads may have low consistency rate due to replication lag
      // This is expected behavior - we're measuring, not asserting a threshold
      expect(consistencyRate).toBeGreaterThanOrEqual(0)
      expect(consistencyRate).toBeLessThanOrEqual(1)
    })

    it('measures read-after-write with delay', async () => {
      const delays = [0, 10, 50, 100, 200] as const
      const results: Array<{ delayMs: number; consistencyRate: number }> = []

      for (const delayMs of delays) {
        let consistentReads = 0
        const iterations = 30

        const result = await benchmark({
          name: `replication-lag-delay-${delayMs}ms`,
          target: 'replicated.perf.do',
          iterations,
          warmup: 3,
          run: async (ctx, i) => {
            const testKey = `lag-delay-${delayMs}-${i}-${Date.now()}`
            const testValue = i

            // Write to primary
            await ctx.fetch('/data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: testKey, value: testValue }),
            })

            // Wait for specified delay
            if (delayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, delayMs))
            }

            // Read from nearest replica
            const readResponse = await ctx.fetch(`/data/${testKey}?replica=nearest`)
            const readData = (await readResponse.json()) as { value?: number }

            if (readData.value === testValue) {
              consistentReads++
            }

            return readResponse
          },
        })

        const consistencyRate = consistentReads / iterations
        results.push({ delayMs, consistencyRate })

        const consistencyResult: ConsistencyResult = {
          ...result,
          metadata: {
            consistentReads,
            inconsistentReads: iterations - consistentReads,
            consistencyRate,
            delayMs,
          },
        }

        record(consistencyResult)
      }

      // Log consistency vs delay curve
      console.log('\nConsistency vs Delay:')
      console.log('  Delay (ms) | Consistency Rate')
      console.log('  -----------|------------------')
      for (const { delayMs, consistencyRate } of results) {
        console.log(`  ${delayMs.toString().padStart(10)} | ${(consistencyRate * 100).toFixed(1)}%`)
      }

      // Consistency should generally improve with longer delays
      // (eventual consistency)
      if (results.length >= 2) {
        const firstRate = results[0]!.consistencyRate
        const lastRate = results[results.length - 1]!.consistencyRate
        // With enough delay, consistency should be at least as good
        expect(lastRate).toBeGreaterThanOrEqual(firstRate * 0.9)
      }
    })

    it('measures consistency across different regions', async () => {
      const regionResults: Array<{ region: Region; consistencyRate: number }> = []

      for (const region of REGIONS) {
        let consistentReads = 0
        const iterations = 20

        const result = await benchmark({
          name: `replication-lag-region-${region}`,
          target: 'replicated.perf.do',
          iterations,
          warmup: 3,
          run: async (ctx, i) => {
            const testKey = `lag-region-${region}-${i}-${Date.now()}`
            const testValue = i

            // Write to primary
            await ctx.fetch('/data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: testKey, value: testValue }),
            })

            // Small delay to allow some replication
            await new Promise((resolve) => setTimeout(resolve, 50))

            // Read from specific region
            const readResponse = await ctx.fetch(`/data/${testKey}?replica=${region}`)
            const readData = (await readResponse.json()) as { value?: number }

            if (readData.value === testValue) {
              consistentReads++
            }

            return readResponse
          },
        })

        const consistencyRate = consistentReads / iterations
        regionResults.push({ region, consistencyRate })

        const consistencyResult: ConsistencyResult = {
          ...result,
          metadata: {
            consistentReads,
            inconsistentReads: iterations - consistentReads,
            consistencyRate,
            region,
          },
        }

        record(consistencyResult)
      }

      // Log regional consistency
      console.log('\nRegional Consistency (50ms delay):')
      console.log('  Region        | Consistency Rate')
      console.log('  --------------|------------------')
      for (const { region, consistencyRate } of regionResults) {
        console.log(`  ${region.padEnd(13)} | ${(consistencyRate * 100).toFixed(1)}%`)
      }
    })
  })

  describe('measure replication lag', () => {
    it('calculates average replication lag', async () => {
      const lagMeasurements: number[] = []
      const iterations = 30

      const result = await benchmark({
        name: 'replication-lag-measurement',
        target: 'replicated.perf.do',
        iterations,
        warmup: 5,
        run: async (ctx, i) => {
          const testKey = `lag-measure-${i}-${Date.now()}`
          const writeTimestamp = Date.now()

          // Write with timestamp
          await ctx.fetch('/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key: testKey,
              value: { data: i, writeTimestamp },
            }),
          })

          // Poll replica until data arrives (with timeout)
          const maxWaitMs = 500
          const pollIntervalMs = 10
          let readTimestamp = Date.now()
          let found = false

          while (Date.now() - writeTimestamp < maxWaitMs) {
            const readResponse = await ctx.fetch(`/data/${testKey}?replica=nearest`)
            const readData = (await readResponse.json()) as { value?: { writeTimestamp: number } }

            if (readData.value?.writeTimestamp === writeTimestamp) {
              readTimestamp = Date.now()
              found = true
              break
            }

            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
          }

          if (found) {
            const lagMs = readTimestamp - writeTimestamp
            lagMeasurements.push(lagMs)
          }

          return ctx.fetch(`/data/${testKey}?replica=nearest`)
        },
      })

      // Calculate lag statistics
      if (lagMeasurements.length > 0) {
        lagMeasurements.sort((a, b) => a - b)
        const avgLag = lagMeasurements.reduce((a, b) => a + b, 0) / lagMeasurements.length
        const minLag = lagMeasurements[0]!
        const maxLag = lagMeasurements[lagMeasurements.length - 1]!
        const p50Lag = lagMeasurements[Math.floor(lagMeasurements.length * 0.5)]!
        const p95Lag = lagMeasurements[Math.floor(lagMeasurements.length * 0.95)]!
        const p99Lag = lagMeasurements[Math.floor(lagMeasurements.length * 0.99)]!

        console.log('\nReplication Lag Statistics:')
        console.log(`  Samples: ${lagMeasurements.length}/${iterations}`)
        console.log(`  Avg: ${avgLag.toFixed(1)}ms`)
        console.log(`  Min: ${minLag}ms, Max: ${maxLag}ms`)
        console.log(`  P50: ${p50Lag}ms, P95: ${p95Lag}ms, P99: ${p99Lag}ms`)

        const consistencyResult: ConsistencyResult = {
          ...result,
          metadata: {
            consistentReads: lagMeasurements.length,
            inconsistentReads: iterations - lagMeasurements.length,
            consistencyRate: lagMeasurements.length / iterations,
            avgLagMs: avgLag,
            maxLagMs: maxLag,
            p50LagMs: p50Lag,
            p95LagMs: p95Lag,
            p99LagMs: p99Lag,
          },
        }

        record(consistencyResult)
      }
    })

    it('measures lag distribution per region', async () => {
      const regionLags: Map<Region, number[]> = new Map()
      for (const region of REGIONS) {
        regionLags.set(region, [])
      }

      const iterationsPerRegion = 15

      for (const region of REGIONS) {
        const result = await benchmark({
          name: `replication-lag-distribution-${region}`,
          target: 'replicated.perf.do',
          iterations: iterationsPerRegion,
          warmup: 3,
          run: async (ctx, i) => {
            const testKey = `lag-dist-${region}-${i}-${Date.now()}`
            const writeTimestamp = Date.now()

            // Write to primary
            await ctx.fetch('/data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                key: testKey,
                value: { data: i, writeTimestamp },
              }),
            })

            // Poll specific region until data arrives
            const maxWaitMs = 500
            const pollIntervalMs = 10

            while (Date.now() - writeTimestamp < maxWaitMs) {
              const readResponse = await ctx.fetch(`/data/${testKey}?replica=${region}`)
              const readData = (await readResponse.json()) as { value?: { writeTimestamp: number } }

              if (readData.value?.writeTimestamp === writeTimestamp) {
                const lagMs = Date.now() - writeTimestamp
                regionLags.get(region)!.push(lagMs)
                break
              }

              await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
            }

            return ctx.fetch(`/data/${testKey}?replica=${region}`)
          },
        })

        const lags = regionLags.get(region)!
        if (lags.length > 0) {
          const avgLag = lags.reduce((a, b) => a + b, 0) / lags.length
          const maxLag = Math.max(...lags)

          const consistencyResult: ConsistencyResult = {
            ...result,
            metadata: {
              consistentReads: lags.length,
              inconsistentReads: iterationsPerRegion - lags.length,
              consistencyRate: lags.length / iterationsPerRegion,
              avgLagMs: avgLag,
              maxLagMs: maxLag,
              region,
            },
          }

          record(consistencyResult)
        }
      }

      // Log regional lag comparison
      console.log('\nReplication Lag by Region:')
      console.log('  Region        | Avg Lag (ms) | Max Lag (ms) | Success Rate')
      console.log('  --------------|--------------|--------------|-------------')
      for (const region of REGIONS) {
        const lags = regionLags.get(region)!
        if (lags.length > 0) {
          const avgLag = lags.reduce((a, b) => a + b, 0) / lags.length
          const maxLag = Math.max(...lags)
          const successRate = lags.length / iterationsPerRegion
          console.log(
            `  ${region.padEnd(13)} | ${avgLag.toFixed(1).padStart(12)} | ${maxLag.toString().padStart(12)} | ${(successRate * 100).toFixed(0)}%`
          )
        } else {
          console.log(`  ${region.padEnd(13)} | N/A          | N/A          | 0%`)
        }
      }
    })
  })

  describe('consistency rate percentage', () => {
    it('calculates overall consistency rate', async () => {
      const testScenarios = [
        { name: 'immediate', delayMs: 0 },
        { name: 'short-delay', delayMs: 25 },
        { name: 'medium-delay', delayMs: 100 },
        { name: 'long-delay', delayMs: 250 },
      ] as const

      const scenarioResults: Array<{
        name: string
        delayMs: number
        consistencyRate: number
        avgLatencyMs: number
      }> = []

      for (const scenario of testScenarios) {
        let consistentReads = 0
        const iterations = 25

        const result = await benchmark({
          name: `consistency-rate-${scenario.name}`,
          target: 'replicated.perf.do',
          iterations,
          warmup: 3,
          run: async (ctx, i) => {
            const testKey = `consistency-${scenario.name}-${i}-${Date.now()}`
            const testValue = { iteration: i, scenario: scenario.name }

            // Write
            await ctx.fetch('/data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: testKey, value: testValue }),
            })

            // Delay
            if (scenario.delayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, scenario.delayMs))
            }

            // Read from nearest
            const readResponse = await ctx.fetch(`/data/${testKey}?replica=nearest`)
            const readData = (await readResponse.json()) as { value?: { iteration: number } }

            if (readData.value?.iteration === i) {
              consistentReads++
            }

            return readResponse
          },
        })

        const consistencyRate = consistentReads / iterations

        scenarioResults.push({
          name: scenario.name,
          delayMs: scenario.delayMs,
          consistencyRate,
          avgLatencyMs: result.stats.mean,
        })

        const consistencyResult: ConsistencyResult = {
          ...result,
          metadata: {
            consistentReads,
            inconsistentReads: iterations - consistentReads,
            consistencyRate,
            scenario: scenario.name,
            delayMs: scenario.delayMs,
          },
        }

        record(consistencyResult)
      }

      // Summary table
      console.log('\nConsistency Rate Summary:')
      console.log('  Scenario      | Delay (ms) | Consistency | Avg Latency')
      console.log('  --------------|------------|-------------|------------')
      for (const s of scenarioResults) {
        console.log(
          `  ${s.name.padEnd(13)} | ${s.delayMs.toString().padStart(10)} | ${(s.consistencyRate * 100).toFixed(1).padStart(10)}% | ${s.avgLatencyMs.toFixed(1).padStart(10)}ms`
        )
      }

      // Verify we collected meaningful data
      for (const s of scenarioResults) {
        expect(s.consistencyRate).toBeGreaterThanOrEqual(0)
        expect(s.consistencyRate).toBeLessThanOrEqual(1)
      }
    })

    it('tracks consistency under load', async () => {
      const concurrency = 5
      const iterationsPerWorker = 15
      const allConsistencyRates: number[] = []

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) => {
          let consistentReads = 0

          return benchmark({
            name: `consistency-load-worker-${workerIndex}`,
            target: 'replicated.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            run: async (ctx, i) => {
              const testKey = `load-${workerIndex}-${i}-${Date.now()}`
              const testValue = workerIndex * 1000 + i

              // Write
              await ctx.fetch('/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: testKey, value: testValue }),
              })

              // Small delay
              await new Promise((resolve) => setTimeout(resolve, 50))

              // Read
              const readResponse = await ctx.fetch(`/data/${testKey}?replica=nearest`)
              const readData = (await readResponse.json()) as { value?: number }

              if (readData.value === testValue) {
                consistentReads++
              }

              return readResponse
            },
          }).then((result) => {
            const consistencyRate = consistentReads / iterationsPerWorker
            allConsistencyRates.push(consistencyRate)

            const consistencyResult: ConsistencyResult = {
              ...result,
              metadata: {
                consistentReads,
                inconsistentReads: iterationsPerWorker - consistentReads,
                consistencyRate,
                worker: workerIndex,
              },
            }

            return consistencyResult
          })
        })
      )

      record(results)

      // Calculate aggregate consistency
      const avgConsistency = allConsistencyRates.reduce((a, b) => a + b, 0) / allConsistencyRates.length
      const minConsistency = Math.min(...allConsistencyRates)
      const maxConsistency = Math.max(...allConsistencyRates)

      console.log('\nConsistency Under Load:')
      console.log(`  Workers: ${concurrency}`)
      console.log(`  Iterations per worker: ${iterationsPerWorker}`)
      console.log(`  Avg consistency: ${(avgConsistency * 100).toFixed(1)}%`)
      console.log(`  Min consistency: ${(minConsistency * 100).toFixed(1)}%`)
      console.log(`  Max consistency: ${(maxConsistency * 100).toFixed(1)}%`)

      // All workers should have some successful reads
      for (const rate of allConsistencyRates) {
        expect(rate).toBeGreaterThan(0)
      }
    })
  })

  describe('read-your-writes guarantee', () => {
    it('same client always sees own writes immediately', async () => {
      let successfulReadYourWrites = 0
      const iterations = 30

      const result = await benchmark({
        name: 'read-your-writes',
        target: 'replicated.perf.do',
        iterations,
        warmup: 5,
        run: async (ctx, i) => {
          const testKey = `ryw-${i}-${Date.now()}`
          const testValue = i

          // Write
          await ctx.fetch('/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: testKey, value: testValue }),
          })

          // Read from PRIMARY (not replica) - should always succeed
          const readResponse = await ctx.fetch(`/data/${testKey}?replica=primary`)
          const readData = (await readResponse.json()) as { value?: number }

          if (readData.value === testValue) {
            successfulReadYourWrites++
          }

          return readResponse
        },
      })

      const rywRate = successfulReadYourWrites / iterations

      const consistencyResult: ConsistencyResult = {
        ...result,
        metadata: {
          consistentReads: successfulReadYourWrites,
          inconsistentReads: iterations - successfulReadYourWrites,
          consistencyRate: rywRate,
        },
      }

      record(consistencyResult)

      console.log(`\nRead-Your-Writes Success Rate: ${(rywRate * 100).toFixed(1)}%`)

      // Read-your-writes from primary should be 100%
      expect(rywRate).toBe(1)
    })

    it('session affinity maintains consistency', async () => {
      let consistentWithSession = 0
      let consistentWithoutSession = 0
      const iterations = 20

      // With session affinity
      await benchmark({
        name: 'session-affinity-enabled',
        target: 'replicated.perf.do',
        iterations,
        warmup: 3,
        headers: {
          'X-Session-Id': 'test-session-123',
        },
        run: async (ctx, i) => {
          const testKey = `session-${i}-${Date.now()}`
          const testValue = i

          await ctx.fetch('/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: testKey, value: testValue }),
          })

          const readResponse = await ctx.fetch(`/data/${testKey}?replica=nearest`)
          const readData = (await readResponse.json()) as { value?: number }

          if (readData.value === testValue) {
            consistentWithSession++
          }

          return readResponse
        },
      })

      // Without session affinity
      await benchmark({
        name: 'session-affinity-disabled',
        target: 'replicated.perf.do',
        iterations,
        warmup: 3,
        run: async (ctx, i) => {
          const testKey = `no-session-${i}-${Date.now()}`
          const testValue = i

          await ctx.fetch('/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: testKey, value: testValue }),
          })

          const readResponse = await ctx.fetch(`/data/${testKey}?replica=nearest`)
          const readData = (await readResponse.json()) as { value?: number }

          if (readData.value === testValue) {
            consistentWithoutSession++
          }

          return readResponse
        },
      })

      const withSessionRate = consistentWithSession / iterations
      const withoutSessionRate = consistentWithoutSession / iterations

      console.log('\nSession Affinity Impact:')
      console.log(`  With session: ${(withSessionRate * 100).toFixed(1)}% consistent`)
      console.log(`  Without session: ${(withoutSessionRate * 100).toFixed(1)}% consistent`)

      // Session affinity should improve or maintain consistency
      expect(withSessionRate).toBeGreaterThanOrEqual(withoutSessionRate * 0.9)
    })
  })
})
