/**
 * Replica Targeting Performance Benchmarks
 *
 * Tests routing performance for replica targeting via query strings:
 * - ?replica=primary - Always read from primary (strong consistency)
 * - ?replica=nearest - Read from geographically nearest replica
 * - ?replica={region} - Read from specific region (us-east, eu-west, etc.)
 *
 * @see db/core/replica.ts for implementation
 * @see dotdo-gj6wa for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

/** Available replica regions for testing */
const REGIONS = ['us-east', 'us-west', 'eu-west', 'eu-central', 'ap-northeast', 'ap-southeast'] as const
type Region = (typeof REGIONS)[number]

/** Cloudflare colos by region */
const REGION_COLOS: Record<Region, string[]> = {
  'us-east': ['IAD', 'EWR', 'ATL', 'MIA'],
  'us-west': ['SJC', 'LAX', 'SEA', 'DEN'],
  'eu-west': ['LHR', 'CDG', 'AMS', 'DUB'],
  'eu-central': ['FRA', 'ZRH', 'VIE', 'WAW'],
  'ap-northeast': ['NRT', 'HND', 'ICN'],
  'ap-southeast': ['SIN', 'SYD', 'HKG'],
}

describe('replica targeting', () => {
  describe('read from primary (?replica=primary)', () => {
    it('routes all reads to primary', async () => {
      const result = await benchmark({
        name: 'replica-primary-read',
        target: 'replicated.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.fetch('/data?replica=primary')
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)
    })

    it('maintains strong consistency', async () => {
      let lastWriteValue = 0
      let consistentReads = 0
      let totalReads = 0

      const result = await benchmark({
        name: 'replica-primary-consistency',
        target: 'replicated.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          // Write a value
          const writeValue = i + 1
          await ctx.fetch('/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: writeValue }),
          })
          lastWriteValue = writeValue

          // Immediately read from primary
          const readResponse = await ctx.fetch('/data?replica=primary')
          const data = (await readResponse.json()) as { value?: number }

          totalReads++
          if (data.value === lastWriteValue) {
            consistentReads++
          }

          return readResponse
        },
      })

      record(result)

      // Primary reads should be 100% consistent
      const consistencyRate = consistentReads / totalReads
      expect(consistencyRate).toBe(1)
    })

    it('primary read latency baseline', async () => {
      const result = await benchmark({
        name: 'replica-primary-latency-baseline',
        target: 'replicated.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.fetch('/ping?replica=primary')
        },
      })

      record(result)

      // Store as baseline for comparison
      expect(result.stats.p50).toBeGreaterThan(0)
      expect(result.stats.p99).toBeGreaterThan(0)
    })
  })

  describe('read from nearest (?replica=nearest)', () => {
    it('routes to geographically nearest replica', async () => {
      const result = await benchmark({
        name: 'replica-nearest-read',
        target: 'replicated.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.fetch('/data?replica=nearest')
        },
      })

      record(result)

      // Nearest routing should have low latency
      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)
    })

    it('should be faster than primary for remote clients', async () => {
      // Test from different simulated locations
      const locations = ['us-west', 'eu-west', 'ap-northeast'] as const

      for (const location of locations) {
        const nearestResult = await benchmark({
          name: `replica-nearest-from-${location}`,
          target: 'replicated.perf.do',
          iterations: 50,
          warmup: 5,
          colo: REGION_COLOS[location][0], // Use first colo in region
          run: async (ctx) => {
            return ctx.fetch('/data?replica=nearest')
          },
        })

        const primaryResult = await benchmark({
          name: `replica-primary-from-${location}`,
          target: 'replicated.perf.do',
          iterations: 50,
          warmup: 5,
          colo: REGION_COLOS[location][0],
          run: async (ctx) => {
            return ctx.fetch('/data?replica=primary')
          },
        })

        record([nearestResult, primaryResult])

        // For remote locations, nearest should be <= primary latency
        // (nearest is at worst equal to primary if primary IS nearest)
        expect(nearestResult.stats.p50).toBeLessThanOrEqual(primaryResult.stats.p50 * 1.1)
      }
    })

    it('tracks which colo served each request', async () => {
      const colosServed = new Set<string>()

      const result = await benchmark({
        name: 'replica-nearest-colo-tracking',
        target: 'replicated.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          const response = await ctx.fetch('/data?replica=nearest')
          if (ctx.lastColoServed) {
            colosServed.add(ctx.lastColoServed)
          }
          return response
        },
      })

      record(result)

      // Should have tracked at least one colo
      expect(colosServed.size).toBeGreaterThanOrEqual(1)

      // Verify colos are valid (3-letter codes)
      for (const colo of Array.from(colosServed)) {
        expect(colo).toMatch(/^[A-Z]{3}$/)
      }
    })
  })

  describe('read from specific region (?replica={region})', () => {
    it.each(REGIONS)('routes to %s region', async (region) => {
      const result = await benchmark({
        name: `replica-region-${region}`,
        target: 'replicated.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          return ctx.fetch(`/data?replica=${region}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeGreaterThan(0)
    })

    it('respects region affinity', async () => {
      const regionResults: Array<{ region: Region; colosServed: string[] }> = []

      for (const region of REGIONS) {
        const colosServed: string[] = []

        await benchmark({
          name: `replica-region-affinity-${region}`,
          target: 'replicated.perf.do',
          iterations: 20,
          warmup: 3,
          run: async (ctx) => {
            const response = await ctx.fetch(`/data?replica=${region}`)
            if (ctx.lastColoServed) {
              colosServed.push(ctx.lastColoServed)
            }
            return response
          },
        })

        regionResults.push({ region, colosServed })
      }

      // Verify each region routes to appropriate colos
      for (const { region, colosServed } of regionResults) {
        const expectedColos = REGION_COLOS[region]
        const matchingColos = colosServed.filter((colo) => expectedColos.includes(colo))

        // Most requests should route to expected region colos
        const matchRate = matchingColos.length / colosServed.length
        expect(matchRate).toBeGreaterThanOrEqual(0.8)
      }
    })

    it('compares latency across regions', async () => {
      const regionLatencies: Array<{ region: Region; p50: number; p99: number }> = []

      for (const region of REGIONS) {
        const result = await benchmark({
          name: `replica-region-latency-${region}`,
          target: 'replicated.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx) => {
            return ctx.fetch(`/data?replica=${region}`)
          },
        })

        regionLatencies.push({
          region,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      // Log latency comparison
      const sortedByLatency = [...regionLatencies].sort((a, b) => a.p50 - b.p50)

      // Verify all regions are reachable
      for (const { region, p50 } of regionLatencies) {
        expect(p50).toBeGreaterThan(0)
      }
    })

    it('handles invalid region gracefully', async () => {
      const result = await benchmark({
        name: 'replica-invalid-region',
        target: 'replicated.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx) => {
          const response = await ctx.fetch('/data?replica=invalid-region')
          // Should fallback to default behavior, not error
          expect(response.status).toBeLessThan(500)
          return response
        },
      })

      record(result)

      expect(result.errors?.length ?? 0).toBe(0)
    })
  })

  describe('write routing', () => {
    it('writes always go to primary', async () => {
      const result = await benchmark({
        name: 'replica-write-to-primary',
        target: 'replicated.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          return ctx.fetch('/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: `write-test-${i}`, value: i }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
    })

    it('write latency is consistent regardless of read replica setting', async () => {
      const writeLatencies: Array<{ setting: string; p50: number }> = []

      for (const replicaSetting of ['primary', 'nearest', 'us-east', 'eu-west']) {
        const result = await benchmark({
          name: `replica-write-with-${replicaSetting}`,
          target: 'replicated.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx, i) => {
            return ctx.fetch(`/data?replica=${replicaSetting}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: `write-${replicaSetting}-${i}`, value: i }),
            })
          },
        })

        writeLatencies.push({ setting: replicaSetting, p50: result.stats.p50 })
        record(result)
      }

      // All write latencies should be similar (all go to primary)
      const p50Values = writeLatencies.map((w) => w.p50)
      const mean = p50Values.reduce((a, b) => a + b, 0) / p50Values.length
      const maxDeviation = Math.max(...p50Values.map((v) => Math.abs(v - mean)))

      // Write latency should not vary more than 50% based on replica setting
      expect(maxDeviation / mean).toBeLessThan(0.5)
    })
  })

  describe('replica failover', () => {
    it('fails over to another replica when region unavailable', async () => {
      const result = await benchmark({
        name: 'replica-failover',
        target: 'replicated.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          // Request with failover flag
          const response = await ctx.fetch('/data?replica=us-east&failover=true')
          expect(response.status).toBeLessThan(500)
          return response
        },
      })

      record(result)

      expect(result.errors?.length ?? 0).toBe(0)
    })

    it('failover latency is acceptable', async () => {
      const normalResult = await benchmark({
        name: 'replica-normal',
        target: 'replicated.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          return ctx.fetch('/data?replica=nearest')
        },
      })

      const failoverResult = await benchmark({
        name: 'replica-with-failover',
        target: 'replicated.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          // Simulate unavailable primary region
          return ctx.fetch('/data?replica=nearest&simulateFailure=primary')
        },
      })

      record([normalResult, failoverResult])

      // Failover should not be more than 2x slower
      expect(failoverResult.stats.p50).toBeLessThan(normalResult.stats.p50 * 2)
    })
  })

  describe('concurrent replica access', () => {
    it('handles concurrent reads from multiple regions', async () => {
      const concurrentRegions = ['us-east', 'eu-west', 'ap-northeast'] as const

      const results = await Promise.all(
        concurrentRegions.map((region) =>
          benchmark({
            name: `replica-concurrent-${region}`,
            target: 'replicated.perf.do',
            iterations: 30,
            warmup: 5,
            run: async (ctx) => {
              return ctx.fetch(`/data?replica=${region}`)
            },
          })
        )
      )

      record(results)

      // All concurrent reads should complete successfully
      for (const result of results) {
        expect(result.errors?.length ?? 0).toBe(0)
        expect(result.samples.length).toBe(30)
      }
    })

    it('mixed read/write workload across replicas', async () => {
      let writeCount = 0
      let readCount = 0

      const result = await benchmark({
        name: 'replica-mixed-workload',
        target: 'replicated.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          if (i % 5 === 0) {
            // 20% writes
            writeCount++
            return ctx.fetch('/data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: `mixed-${i}`, value: i }),
            })
          } else {
            // 80% reads from nearest
            readCount++
            return ctx.fetch('/data?replica=nearest')
          }
        },
      })

      record(result)

      // Verify mix ratio
      expect(writeCount).toBe(20)
      expect(readCount).toBe(80)

      // Mixed workload should complete without errors
      expect(result.errors?.length ?? 0).toBeLessThan(5)
    })
  })
})
