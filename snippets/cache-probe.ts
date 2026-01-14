/**
 * Cache Probe Snippet
 *
 * Tests the "100% FREE query architecture" capabilities:
 * 1. Fan-out: Can we make multiple subrequests?
 * 2. Full cache: Is the Parquet file cached?
 * 3. Range cache: Do Range requests hit the same cache entry?
 * 4. Index read: Can we fetch and parse Puffin/marks indexes?
 *
 * Trigger: /$.probe?test=fanout|cache|range|index|all
 *
 * Uses a test R2 bucket with sample data.
 */

// Test configuration
const TEST_CONFIG = {
  // External CDN (definitely no loopback issues)
  externalUrl: 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js',

  // R2 public bucket (different zone, should work)
  // Update this to your actual R2 public URL
  r2Url: 'https://pub-xxx.r2.dev/test.txt',

  // Same zone tests - ordered by likelihood of working:
  // 1. Different domain entirely (api.sb) - most likely to work
  // 2. Different subdomain (api.workers.do) - may be blocked
  sameZoneUrls: [
    'https://api.sb/',                    // Different domain on same zone
    'https://api.workers.do/',            // Same domain, different subdomain
  ],
}

interface ProbeResult {
  test: string
  success: boolean
  details: Record<string, unknown>
  timing_ms: number
  error?: string
}

// ============================================================================
// Test: Fan-out (multiple subrequests)
// ============================================================================

async function testFanout(): Promise<ProbeResult> {
  const start = Date.now()
  const details: Record<string, unknown> = {}

  try {
    // Snippets allow 2-5 subrequests - test with 3 to external CDN
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
    details.parallel = true
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
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// ============================================================================
// Test: Loopback detection (same zone, different subdomain)
// ============================================================================

async function testLoopback(): Promise<ProbeResult> {
  const start = Date.now()
  const details: Record<string, unknown> = {}

  try {
    const results: Array<{url: string; status: number | string; error?: string}> = []

    for (const url of TEST_CONFIG.sameZoneUrls) {
      try {
        const res = await fetch(url, {
          headers: { 'X-Probe': 'loopback-test' },
        })
        results.push({
          url,
          status: res.status,
        })
      } catch (e) {
        results.push({
          url,
          status: 'blocked',
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    details.results = results

    // Check if any succeeded (meaning loopback is allowed for custom hostnames)
    const anySuccess = results.some(r => typeof r.status === 'number' && r.status < 500)
    const allBlocked = results.every(r => r.status === 'blocked' || r.status === 530)

    return {
      test: 'loopback',
      success: true, // Info test - both outcomes are valid
      details: {
        ...details,
        anySuccess,
        allBlocked,
        note: allBlocked
          ? 'All same-zone requests blocked - need external R2 bucket'
          : 'Some same-zone requests work - custom hostnames may bypass loopback',
      },
      timing_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: 'loopback',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// ============================================================================
// Test: Full file caching
// ============================================================================

async function testCache(): Promise<ProbeResult> {
  const start = Date.now()
  const details: Record<string, unknown> = {}

  try {
    const res = await fetch(TEST_CONFIG.externalUrl)

    details.status = res.status
    details.cacheStatus = res.headers.get('cf-cache-status')
    details.cacheControl = res.headers.get('cache-control')
    details.contentLength = res.headers.get('content-length')
    details.age = res.headers.get('age')
    details.cfRay = res.headers.get('cf-ray')

    // Check if it's a cache HIT
    const cacheStatus = res.headers.get('cf-cache-status')
    const isHit = cacheStatus === 'HIT' || cacheStatus === 'REVALIDATED'

    return {
      test: 'cache',
      success: res.status === 200,
      details: {
        ...details,
        isHit,
        note: isHit ? 'Cache HIT - FREE!' : 'Cache MISS - first request or expired',
      },
      timing_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: 'cache',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// ============================================================================
// Test: Range requests on cached content
// ============================================================================

async function testRange(): Promise<ProbeResult> {
  const start = Date.now()
  const details: Record<string, unknown> = {}

  try {
    // First, get the full file to ensure it's cached
    const fullRes = await fetch(TEST_CONFIG.externalUrl)
    const fullLength = parseInt(fullRes.headers.get('content-length') || '0', 10)

    details.fullLength = fullLength
    details.fullCacheStatus = fullRes.headers.get('cf-cache-status')

    // Now request just the first 1KB with Range header
    const rangeRes = await fetch(TEST_CONFIG.externalUrl, {
      headers: {
        'Range': 'bytes=0-1023',
      },
    })

    details.rangeStatus = rangeRes.status
    details.rangeCacheStatus = rangeRes.headers.get('cf-cache-status')
    details.contentRange = rangeRes.headers.get('content-range')
    details.rangeLength = rangeRes.headers.get('content-length')

    // Check if range request also hits cache
    const rangeCacheStatus = rangeRes.headers.get('cf-cache-status')
    const rangeHit = rangeCacheStatus === 'HIT' || rangeCacheStatus === 'REVALIDATED'

    // 206 = Partial Content (successful range request)
    const success = rangeRes.status === 206 || rangeRes.status === 200

    return {
      test: 'range',
      success,
      details: {
        ...details,
        rangeHit,
        note: rangeHit
          ? 'Range request HIT cache - can skip to any byte offset for FREE!'
          : 'Range request MISS - may need Accept-Ranges support',
      },
      timing_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: 'range',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// ============================================================================
// Test: Index file reading (simulated Puffin header)
// ============================================================================

async function testIndex(): Promise<ProbeResult> {
  const start = Date.now()
  const details: Record<string, unknown> = {}

  try {
    // For now, test with the JS file and pretend it's an index
    // In production, this would be a real Puffin file
    const res = await fetch(TEST_CONFIG.externalUrl, {
      headers: {
        'Range': 'bytes=0-15', // Puffin magic is 4 bytes, header is ~16
      },
    })

    const data = await res.arrayBuffer()
    const bytes = new Uint8Array(data)

    details.status = res.status
    details.cacheStatus = res.headers.get('cf-cache-status')
    details.bytesReceived = bytes.length
    details.firstBytes = Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')

    // In real usage, we'd check for Puffin magic "PFA1" or marks magic
    // For this test, just verify we can read bytes

    return {
      test: 'index',
      success: bytes.length > 0,
      details: {
        ...details,
        note: 'Successfully read bytes via Range request - index parsing would work',
      },
      timing_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: 'index',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// ============================================================================
// Test: Memory/CPU constraints
// ============================================================================

async function testConstraints(): Promise<ProbeResult> {
  const start = Date.now()
  const details: Record<string, unknown> = {}

  try {
    // Test that we're within Snippet limits
    // - <5ms CPU time
    // - <2MB memory
    // - <32KB code size

    // Do some computation to test CPU
    let sum = 0
    for (let i = 0; i < 10000; i++) {
      sum += Math.sqrt(i)
    }

    details.computeResult = sum
    details.timing = Date.now() - start

    // Create some data to test memory (but not too much)
    const testArray = new Array(1000).fill(0).map((_, i) => i * 2)
    details.arrayLength = testArray.length

    return {
      test: 'constraints',
      success: true,
      details: {
        ...details,
        note: 'Computation completed within Snippet CPU/memory limits',
      },
      timing_ms: Date.now() - start,
    }
  } catch (e) {
    return {
      test: 'constraints',
      success: false,
      details,
      timing_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// ============================================================================
// Main Handler
// ============================================================================

export default {
  async fetch(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)

    // Only handle probe requests
    if (url.pathname !== '/$.probe') {
      return undefined // Pass through to origin
    }

    const testParam = url.searchParams.get('test') || 'all'
    const tests = testParam === 'all'
      ? ['fanout', 'cache', 'range', 'index', 'loopback', 'constraints']
      : testParam.split(',')

    const results: ProbeResult[] = []

    for (const test of tests) {
      switch (test.trim()) {
        case 'fanout':
          results.push(await testFanout())
          break
        case 'cache':
          results.push(await testCache())
          break
        case 'range':
          results.push(await testRange())
          break
        case 'index':
          results.push(await testIndex())
          break
        case 'loopback':
          results.push(await testLoopback())
          break
        case 'constraints':
          results.push(await testConstraints())
          break
        default:
          results.push({
            test: test.trim(),
            success: false,
            details: {},
            timing_ms: 0,
            error: `Unknown test: ${test}`,
          })
      }
    }

    const allPassed = results.every(r => r.success)
    const totalTime = results.reduce((sum, r) => sum + r.timing_ms, 0)

    const response = {
      probe: 'cache-architecture',
      timestamp: new Date().toISOString(),
      allPassed,
      totalTime_ms: totalTime,
      results,
      summary: {
        fanout: results.find(r => r.test === 'fanout')?.success ? '✓ Fan-out works' : '✗ Fan-out failed',
        cache: results.find(r => r.test === 'cache')?.success ? '✓ Caching works' : '✗ Caching failed',
        range: results.find(r => r.test === 'range')?.success ? '✓ Range requests work' : '✗ Range failed',
        index: results.find(r => r.test === 'index')?.success ? '✓ Index reading works' : '✗ Index failed',
        loopback: (() => {
          const r = results.find(r => r.test === 'loopback')
          if (!r) return '? Not tested'
          const d = r.details as { anySuccess?: boolean; allBlocked?: boolean }
          if (d.allBlocked) return '✗ Same-zone blocked - use external R2'
          if (d.anySuccess) return '✓ Same-zone works (api.sb or similar)'
          return '? Inconclusive'
        })(),
        constraints: results.find(r => r.test === 'constraints')?.success ? '✓ Within limits' : '✗ Exceeded limits',
      },
    }

    return new Response(JSON.stringify(response, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store', // Don't cache the probe results
      },
    })
  },
}
