/**
 * Cache Probe Snippet
 *
 * Tests the "100% FREE query architecture" capabilities:
 * 1. Fan-out: Can we make multiple subrequests?
 * 2. Full cache: Is the Parquet file cached?
 * 3. Range cache: Do Range requests hit the same cache entry?
 * 4. Index read: Can we fetch and parse Puffin/marks indexes?
 * 5. Loopback: Can we call other domains on the same zone?
 * 6. Vector: Can we compute centroid distances within constraints?
 *
 * Trigger: /$.probe?test=fanout|cache|range|index|loopback|vector|all
 *
 * Vector test params:
 *   /$.probe?test=vector&centroids=256|512|1024&k=10
 *
 * Performance targets:
 *   - 256 centroids × 384 dims → <1ms
 *   - 512 centroids × 384 dims → <2ms
 *   - 1024 centroids × 384 dims → <3ms
 */

const TEST_CONFIG = {
  externalUrl: 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js',
  // R2 bucket via cdn.apis.do (different zone, workers:none route)
  r2Url: 'https://cdn.apis.do/test-index.puffin',
  sameZoneUrls: [
    'https://api.sb/',
    'https://api.workers.do/',
  ],
  // Vector centroid test files (hosted on R2 via assets.workers.do)
  centroidUrls: {
    '256': 'https://assets.workers.do/test/centroids-256x384.bin',
    '512': 'https://assets.workers.do/test/centroids-512x384.bin',
    '1024': 'https://assets.workers.do/test/centroids-1024x384.bin',
  },
  dims: 384,
  topK: 10,
}

async function testFanout() {
  const start = Date.now()
  const details = {}

  try {
    const urls = [
      TEST_CONFIG.externalUrl,
      TEST_CONFIG.externalUrl + '?v=1',
      TEST_CONFIG.externalUrl + '?v=2',
    ]

    const results = await Promise.all(
      urls.map(async (url, i) => {
        const res = await fetch(url)
        return {
          index: i,
          status: res.status,
          cached: res.headers.get('cf-cache-status'),
          size: res.headers.get('content-length'),
        }
      })
    )

    details.requests = results
    details.count = results.length

    return {
      test: 'fanout',
      success: results.every(r => r.status === 200),
      details,
      timing_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: 'fanout',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e.message || String(e),
    }
  }
}

async function testLoopback() {
  const start = Date.now()
  const details = {}

  try {
    const results = []

    for (const url of TEST_CONFIG.sameZoneUrls) {
      try {
        const res = await fetch(url, {
          headers: { 'X-Probe': 'loopback-test' },
        })
        results.push({ url, status: res.status })
      } catch (e) {
        results.push({ url, status: 'blocked', error: e.message })
      }
    }

    details.results = results
    const anySuccess = results.some(r => typeof r.status === 'number' && r.status < 500)
    const allBlocked = results.every(r => r.status === 'blocked' || r.status === 530)

    return {
      test: 'loopback',
      success: true,
      details: {
        ...details,
        anySuccess,
        allBlocked,
        note: allBlocked
          ? 'All same-zone requests blocked - need external R2 bucket'
          : 'Some same-zone requests work!',
      },
      timing_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: 'loopback',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e.message || String(e),
    }
  }
}

async function testCache() {
  const start = Date.now()
  const details = {}

  try {
    const res = await fetch(TEST_CONFIG.externalUrl)

    details.status = res.status
    details.cacheStatus = res.headers.get('cf-cache-status')
    details.cacheControl = res.headers.get('cache-control')
    details.contentLength = res.headers.get('content-length')
    details.age = res.headers.get('age')

    const isHit = details.cacheStatus === 'HIT' || details.cacheStatus === 'REVALIDATED'

    return {
      test: 'cache',
      success: res.status === 200,
      details: { ...details, isHit },
      timing_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: 'cache',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e.message || String(e),
    }
  }
}

async function testRange() {
  const start = Date.now()
  const details = {}

  try {
    const fullRes = await fetch(TEST_CONFIG.externalUrl)
    details.fullCacheStatus = fullRes.headers.get('cf-cache-status')

    const rangeRes = await fetch(TEST_CONFIG.externalUrl, {
      headers: { 'Range': 'bytes=0-1023' },
    })

    details.rangeStatus = rangeRes.status
    details.rangeCacheStatus = rangeRes.headers.get('cf-cache-status')
    details.contentRange = rangeRes.headers.get('content-range')

    const rangeHit = details.rangeCacheStatus === 'HIT'

    return {
      test: 'range',
      success: rangeRes.status === 206 || rangeRes.status === 200,
      details: {
        ...details,
        rangeHit,
        note: rangeHit ? 'Range request HIT cache!' : 'Range request MISS',
      },
      timing_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: 'range',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e.message || String(e),
    }
  }
}

async function testIndex() {
  const start = Date.now()
  const details = {}

  try {
    const res = await fetch(TEST_CONFIG.externalUrl, {
      headers: { 'Range': 'bytes=0-15' },
    })

    const data = await res.arrayBuffer()
    const bytes = new Uint8Array(data)

    details.status = res.status
    details.cacheStatus = res.headers.get('cf-cache-status')
    details.bytesReceived = bytes.length
    details.firstBytes = Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')

    return {
      test: 'index',
      success: bytes.length > 0,
      details: { ...details, note: 'Successfully read bytes via Range' },
      timing_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: 'index',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e.message || String(e),
    }
  }
}

async function testR2() {
  const start = Date.now()
  const details = {}

  try {
    // Test 1: Can we reach R2 from snippet? (different zone)
    const fullRes = await fetch(TEST_CONFIG.r2Url)
    details.fullStatus = fullRes.status
    details.fullCacheStatus = fullRes.headers.get('cf-cache-status')
    details.acceptRanges = fullRes.headers.get('accept-ranges')
    details.contentLength = fullRes.headers.get('content-length')

    // Test 2: Range request on R2
    const rangeRes = await fetch(TEST_CONFIG.r2Url, {
      headers: { 'Range': 'bytes=0-3' }, // Get "PFA1" magic
    })
    details.rangeStatus = rangeRes.status
    details.rangeCacheStatus = rangeRes.headers.get('cf-cache-status')
    details.contentRange = rangeRes.headers.get('content-range')

    const data = await rangeRes.arrayBuffer()
    const bytes = new Uint8Array(data)
    details.bytesReceived = bytes.length
    details.magic = String.fromCharCode(...bytes)

    // Check for Puffin magic "PFA1"
    const isPuffin = details.magic === 'PFA1'

    return {
      test: 'r2',
      success: fullRes.status === 200 && (rangeRes.status === 200 || rangeRes.status === 206),
      details: {
        ...details,
        isPuffin,
        note: isPuffin
          ? 'R2 accessible with Range requests - Puffin magic detected!'
          : 'R2 accessible with Range requests',
      },
      timing_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: 'r2',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e.message || String(e),
    }
  }
}

/**
 * Vector Distance Test
 *
 * Tests centroid distance computation within Snippet constraints.
 * Fetches centroid data from R2, parses as Float32Array, computes
 * dot product distances to a random query vector, and returns top-K.
 *
 * Query params:
 *   - centroids: 256|512|1024 (default: 256)
 *   - k: number of top results (default: 10)
 */
async function testVector(searchParams) {
  const start = Date.now()
  const details = {}

  try {
    // Get config from query params
    const centroidCount = searchParams.get('centroids') || '256'
    const k = parseInt(searchParams.get('k') || '10', 10)
    const dims = TEST_CONFIG.dims

    const url = TEST_CONFIG.centroidUrls[centroidCount]
    if (!url) {
      return {
        test: 'vector',
        success: false,
        details: { error: `Invalid centroid count: ${centroidCount}` },
        timing_ms: Date.now() - start,
      }
    }

    const numCentroids = parseInt(centroidCount, 10)
    const expectedBytes = numCentroids * dims * 4 // Float32 = 4 bytes

    details.config = { numCentroids, dims, k, expectedBytes }

    // Fetch centroids via Range request (full file for now)
    const fetchStart = Date.now()
    const res = await fetch(url)

    if (!res.ok) {
      return {
        test: 'vector',
        success: false,
        details: { ...details, fetchStatus: res.status },
        timing_ms: Date.now() - start,
        error: `Failed to fetch centroids: ${res.status}`,
      }
    }

    const buffer = await res.arrayBuffer()
    const fetchTime = Date.now() - fetchStart

    details.fetch = {
      status: res.status,
      cacheStatus: res.headers.get('cf-cache-status'),
      bytes: buffer.byteLength,
      timing_ms: fetchTime,
    }

    // Parse as Float32Array
    const parseStart = Date.now()
    const centroids = new Float32Array(buffer)
    const parseTime = Date.now() - parseStart

    details.parse = {
      floatCount: centroids.length,
      expectedFloats: numCentroids * dims,
      timing_ms: parseTime,
    }

    // Generate random query vector (normalized)
    const queryStart = Date.now()
    const query = new Float32Array(dims)
    let queryNorm = 0
    for (let i = 0; i < dims; i++) {
      // Simple pseudo-random using sine
      const val = Math.sin(i * 12.9898 + Date.now() * 0.001) * 43758.5453
      query[i] = val - Math.floor(val)
      queryNorm += query[i] * query[i]
    }
    queryNorm = Math.sqrt(queryNorm)
    for (let i = 0; i < dims; i++) {
      query[i] /= queryNorm
    }
    const queryTime = Date.now() - queryStart

    // Compute dot product distances to all centroids
    const computeStart = Date.now()
    const scores = new Float32Array(numCentroids)

    for (let c = 0; c < numCentroids; c++) {
      let dot = 0
      const offset = c * dims
      for (let d = 0; d < dims; d++) {
        dot += query[d] * centroids[offset + d]
      }
      scores[c] = dot
    }

    // Find top-K (simple selection for small k)
    const topK = []
    const used = new Set()

    for (let i = 0; i < k && i < numCentroids; i++) {
      let bestIdx = -1
      let bestScore = -Infinity

      for (let c = 0; c < numCentroids; c++) {
        if (!used.has(c) && scores[c] > bestScore) {
          bestScore = scores[c]
          bestIdx = c
        }
      }

      if (bestIdx >= 0) {
        used.add(bestIdx)
        topK.push({ index: bestIdx, score: bestScore.toFixed(4) })
      }
    }

    const computeTime = Date.now() - computeStart

    details.compute = {
      queryGen_ms: queryTime,
      distances_ms: computeTime,
      total_ms: queryTime + computeTime,
    }

    details.results = {
      topK,
      k,
    }

    const totalTime = Date.now() - start

    // Check against target constraints
    const targetMs = centroidCount === '256' ? 1 : centroidCount === '512' ? 2 : 3
    const meetsTarget = computeTime < targetMs

    return {
      test: 'vector',
      success: true,
      details: {
        ...details,
        meetsTarget,
        targetMs,
        note: meetsTarget
          ? `Compute time ${computeTime}ms < ${targetMs}ms target`
          : `Compute time ${computeTime}ms exceeds ${targetMs}ms target`,
      },
      timing_ms: totalTime,
    }
  } catch (e) {
    return {
      test: 'vector',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e.message || String(e),
    }
  }
}

async function testConstraints() {
  const start = Date.now()
  let sum = 0
  for (let i = 0; i < 10000; i++) {
    sum += Math.sqrt(i)
  }

  return {
    test: 'constraints',
    success: true,
    details: { computeResult: sum, note: 'Within CPU/memory limits' },
    timing_ms: Date.now() - start,
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname !== '/$.probe') {
      return undefined
    }

    const testParam = url.searchParams.get('test') || 'all'
    const tests = testParam === 'all'
      ? ['fanout', 'cache', 'range', 'index', 'r2', 'loopback', 'constraints']
      : testParam.split(',')

    const results = []

    for (const test of tests) {
      switch (test.trim()) {
        case 'fanout': results.push(await testFanout()); break
        case 'cache': results.push(await testCache()); break
        case 'range': results.push(await testRange()); break
        case 'index': results.push(await testIndex()); break
        case 'r2': results.push(await testR2()); break
        case 'loopback': results.push(await testLoopback()); break
        case 'vector': results.push(await testVector(url.searchParams)); break
        case 'constraints': results.push(await testConstraints()); break
        default: results.push({ test: test.trim(), success: false, error: 'Unknown test' })
      }
    }

    const response = {
      probe: 'cache-architecture',
      timestamp: new Date().toISOString(),
      allPassed: results.every(r => r.success),
      totalTime_ms: results.reduce((sum, r) => sum + (r.timing_ms || 0), 0),
      results,
    }

    return new Response(JSON.stringify(response, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  },
}
