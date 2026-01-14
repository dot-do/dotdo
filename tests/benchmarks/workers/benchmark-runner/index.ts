import type { BenchmarkRequest, BenchmarkResponse } from '../../framework/remote-types'

export interface Env {
  API_KEY: string
  DO?: DurableObjectNamespace
}

// Maximum limits for benchmark requests
const MAX_ITERATIONS = 1000
const MAX_DATASET_SIZE = 10000

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Auth check
    const authHeader = request.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.slice(7)
    if (token !== env.API_KEY) {
      return new Response(JSON.stringify({ error: 'Invalid API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Parse request
    const url = new URL(request.url)
    if (url.pathname !== '/benchmark' || request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    let body: BenchmarkRequest
    try {
      body = (await request.json()) as BenchmarkRequest
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Validate limits
    if ((body.iterations || 0) > MAX_ITERATIONS) {
      return new Response(
        JSON.stringify({
          error: `iterations exceeds maximum of ${MAX_ITERATIONS}`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if ((body.dataset?.size || 0) > MAX_DATASET_SIZE) {
      return new Response(
        JSON.stringify({
          error: `dataset.size exceeds maximum of ${MAX_DATASET_SIZE}`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Run benchmark (simplified implementation)
    const iterations = body.iterations || 10
    const samples: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      // Simulate work - in production this would use actual stores
      await new Promise((r) => setTimeout(r, 1))
      const elapsed = performance.now() - start
      samples.push(elapsed)
    }

    // Calculate metrics
    const sorted = [...samples].sort((a, b) => a - b)
    const sum = samples.reduce((a, b) => a + b, 0)
    const avg = sum / samples.length
    const squareDiffs = samples.map((s) => Math.pow(s - avg, 2))
    const stdDev = Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / samples.length)

    const percentile = (p: number) => {
      const index = Math.ceil((p / 100) * sorted.length) - 1
      return sorted[Math.max(0, index)]
    }

    const response: BenchmarkResponse = {
      metrics: {
        latency: {
          avg,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          p50: percentile(50),
          p95: percentile(95),
          p99: percentile(99),
          stdDev
        },
        throughput: { opsPerSecond: 1000 / avg, bytesPerSecond: 0 },
        cost: {
          rowWrites: iterations,
          rowReads: 0,
          storageBytes: 0,
          storageGb: 0,
          estimatedCost: iterations * 0.000001,
          breakdown: { writeCost: iterations * 0.000001, readCost: 0, storageCost: 0 }
        },
        resources: { peakMemoryMb: 0, storageBytesUsed: 0 }
      },
      raw: samples,
      environment: 'production'
    }

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'CF-Ray': request.headers.get('CF-Ray') || 'local'
      }
    })
  }
}
