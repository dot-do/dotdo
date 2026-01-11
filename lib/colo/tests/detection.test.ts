/**
 * DO Location Detection Tests
 *
 * Tests for detecting Cloudflare colo location from within a Durable Object.
 * DOs can detect their colo by fetching `https://cloudflare.com/cdn-cgi/trace`
 * from within the DO. The response contains `colo=XXX` where XXX is a 3-letter IATA code.
 *
 * RED PHASE: These tests are expected to FAIL until lib/colo/detection.ts is implemented.
 *
 * Reference: dotdo-c3g99 - DO location detection mechanism
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'

// Import the module under test (will fail until implemented)
import {
  detectColoFromTrace,
  fetchDOLocation,
  parseTraceResponse,
  TraceData,
  DOLocation,
  CLOUDFLARE_TRACE_URL,
} from '../detection'

import type { ColoCode } from '../../../types/Location'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Sample trace response from Cloudflare's /cdn-cgi/trace endpoint
 */
const VALID_TRACE_RESPONSE = `fl=123f456
h=cloudflare.com
ip=203.0.113.50
ts=1704931200.123
visit_scheme=https
uag=Mozilla/5.0
colo=SJC
sliver=none
http=http/2
loc=US
tls=TLSv1.3
sni=plaintext
warp=off
gateway=off
rbi=off
kex=X25519`

const TRACE_RESPONSE_LOWERCASE_COLO = `fl=123f456
h=cloudflare.com
ip=203.0.113.50
ts=1704931200.123
visit_scheme=https
uag=Mozilla/5.0
colo=sjc
sliver=none
http=http/2
loc=US
tls=TLSv1.3
sni=plaintext
warp=off
gateway=off
rbi=off
kex=X25519`

const TRACE_RESPONSE_MIXED_CASE_COLO = `fl=123f456
h=cloudflare.com
ip=203.0.113.50
ts=1704931200.123
visit_scheme=https
uag=Mozilla/5.0
colo=SjC
sliver=none
http=http/2
loc=US
tls=TLSv1.3
sni=plaintext
warp=off
gateway=off
rbi=off
kex=X25519`

const TRACE_RESPONSE_MISSING_COLO = `fl=123f456
h=cloudflare.com
ip=203.0.113.50
ts=1704931200.123
visit_scheme=https
uag=Mozilla/5.0
sliver=none
http=http/2
loc=US
tls=TLSv1.3
sni=plaintext
warp=off
gateway=off
rbi=off
kex=X25519`

const TRACE_RESPONSE_EMPTY_COLO = `fl=123f456
h=cloudflare.com
ip=203.0.113.50
ts=1704931200.123
visit_scheme=https
uag=Mozilla/5.0
colo=
sliver=none
http=http/2
loc=US
tls=TLSv1.3
sni=plaintext
warp=off
gateway=off
rbi=off
kex=X25519`

const TRACE_RESPONSE_INVALID_COLO = `fl=123f456
h=cloudflare.com
ip=203.0.113.50
ts=1704931200.123
visit_scheme=https
uag=Mozilla/5.0
colo=INVALID
sliver=none
http=http/2
loc=US
tls=TLSv1.3
sni=plaintext
warp=off
gateway=off
rbi=off
kex=X25519`

const TRACE_RESPONSE_LHR = `fl=789a012
h=cloudflare.com
ip=198.51.100.25
ts=1704931500.456
visit_scheme=https
uag=curl/7.88.1
colo=LHR
sliver=none
http=http/2
loc=GB
tls=TLSv1.3
sni=plaintext
warp=off
gateway=off
rbi=off
kex=X25519`

// ============================================================================
// CLOUDFLARE_TRACE_URL Constant Tests
// ============================================================================

describe('CLOUDFLARE_TRACE_URL constant', () => {
  it('should export the Cloudflare trace URL', () => {
    expect(CLOUDFLARE_TRACE_URL).toBe('https://cloudflare.com/cdn-cgi/trace')
  })
})

// ============================================================================
// detectColoFromTrace Function Tests
// ============================================================================

describe('detectColoFromTrace', () => {
  describe('valid trace response parsing', () => {
    it('should extract colo from valid trace response', () => {
      const result = detectColoFromTrace(VALID_TRACE_RESPONSE)

      expect(result).toBe('sjc')
    })

    it('should extract colo from London trace response', () => {
      const result = detectColoFromTrace(TRACE_RESPONSE_LHR)

      expect(result).toBe('lhr')
    })

    it('should normalize uppercase colo to lowercase', () => {
      const result = detectColoFromTrace(VALID_TRACE_RESPONSE)

      expect(result).toBe('sjc')
      expect(result).not.toBe('SJC')
    })

    it('should normalize mixed case colo to lowercase', () => {
      const result = detectColoFromTrace(TRACE_RESPONSE_MIXED_CASE_COLO)

      expect(result).toBe('sjc')
    })

    it('should handle already lowercase colo', () => {
      const result = detectColoFromTrace(TRACE_RESPONSE_LOWERCASE_COLO)

      expect(result).toBe('sjc')
    })
  })

  describe('invalid trace response handling', () => {
    it('should return null for empty response', () => {
      const result = detectColoFromTrace('')

      expect(result).toBeNull()
    })

    it('should return null for missing colo field', () => {
      const result = detectColoFromTrace(TRACE_RESPONSE_MISSING_COLO)

      expect(result).toBeNull()
    })

    it('should return null for empty colo value', () => {
      const result = detectColoFromTrace(TRACE_RESPONSE_EMPTY_COLO)

      expect(result).toBeNull()
    })

    it('should return null for whitespace-only response', () => {
      const result = detectColoFromTrace('   \n\n   ')

      expect(result).toBeNull()
    })

    it('should return null for malformed response', () => {
      const result = detectColoFromTrace('not a valid trace response')

      expect(result).toBeNull()
    })

    it('should return null for response with no key=value pairs', () => {
      const result = detectColoFromTrace('randomtext\nmorerandom')

      expect(result).toBeNull()
    })
  })

  describe('colo code validation', () => {
    it('should validate against known colo codes and return valid code', () => {
      const result = detectColoFromTrace(VALID_TRACE_RESPONSE)

      // sjc is a valid colo code
      expect(result).toBe('sjc')
    })

    it('should return null for unknown colo code', () => {
      const result = detectColoFromTrace(TRACE_RESPONSE_INVALID_COLO)

      // 'INVALID' is not a valid 3-letter IATA colo code
      expect(result).toBeNull()
    })

    it('should validate lhr as known colo code', () => {
      const result = detectColoFromTrace(TRACE_RESPONSE_LHR)

      expect(result).toBe('lhr')
    })

    it('should return ColoCode type', () => {
      const result = detectColoFromTrace(VALID_TRACE_RESPONSE)

      // Type assertion to verify return type
      const coloCode: ColoCode | null = result
      expect(coloCode).toBe('sjc')
    })
  })

  describe('edge cases', () => {
    it('should handle colo field with extra whitespace', () => {
      const response = `colo= SJC \nhttp=http/2`
      const result = detectColoFromTrace(response)

      // Should trim whitespace
      expect(result).toBe('sjc')
    })

    it('should handle response with only colo field', () => {
      const response = 'colo=LAX'
      const result = detectColoFromTrace(response)

      expect(result).toBe('lax')
    })

    it('should handle colo field at different positions', () => {
      const responseAtStart = 'colo=IAD\nother=value'
      const responseAtEnd = 'other=value\ncolo=IAD'
      const responseInMiddle = 'first=1\ncolo=IAD\nlast=3'

      expect(detectColoFromTrace(responseAtStart)).toBe('iad')
      expect(detectColoFromTrace(responseAtEnd)).toBe('iad')
      expect(detectColoFromTrace(responseInMiddle)).toBe('iad')
    })

    it('should handle Windows-style line endings (CRLF)', () => {
      const response = 'fl=123\r\ncolo=SJC\r\nhttp=http/2'
      const result = detectColoFromTrace(response)

      expect(result).toBe('sjc')
    })

    it('should handle mixed line endings', () => {
      const response = 'fl=123\ncolo=SJC\r\nhttp=http/2\rloc=US'
      const result = detectColoFromTrace(response)

      expect(result).toBe('sjc')
    })
  })
})

// ============================================================================
// parseTraceResponse Function Tests
// ============================================================================

describe('parseTraceResponse', () => {
  describe('full trace data parsing', () => {
    it('should parse all fields from valid trace response', () => {
      const result = parseTraceResponse(VALID_TRACE_RESPONSE)

      expect(result.fl).toBe('123f456')
      expect(result.h).toBe('cloudflare.com')
      expect(result.ip).toBe('203.0.113.50')
      expect(result.ts).toBe('1704931200.123')
      expect(result.visit_scheme).toBe('https')
      expect(result.uag).toBe('Mozilla/5.0')
      expect(result.colo).toBe('SJC')
      expect(result.sliver).toBe('none')
      expect(result.http).toBe('http/2')
      expect(result.loc).toBe('US')
      expect(result.tls).toBe('TLSv1.3')
      expect(result.sni).toBe('plaintext')
      expect(result.warp).toBe('off')
      expect(result.gateway).toBe('off')
      expect(result.rbi).toBe('off')
      expect(result.kex).toBe('X25519')
    })

    it('should return typed TraceData object', () => {
      const result: TraceData = parseTraceResponse(VALID_TRACE_RESPONSE)

      expect(result).toBeDefined()
      expect(typeof result.fl).toBe('string')
      expect(typeof result.h).toBe('string')
      expect(typeof result.ip).toBe('string')
      expect(typeof result.ts).toBe('string')
      expect(typeof result.visit_scheme).toBe('string')
      expect(typeof result.uag).toBe('string')
      expect(typeof result.colo).toBe('string')
      expect(typeof result.sliver).toBe('string')
      expect(typeof result.http).toBe('string')
      expect(typeof result.loc).toBe('string')
      expect(typeof result.tls).toBe('string')
      expect(typeof result.sni).toBe('string')
      expect(typeof result.warp).toBe('string')
      expect(typeof result.gateway).toBe('string')
      expect(typeof result.rbi).toBe('string')
      expect(typeof result.kex).toBe('string')
    })

    it('should parse different trace responses correctly', () => {
      const result = parseTraceResponse(TRACE_RESPONSE_LHR)

      expect(result.ip).toBe('198.51.100.25')
      expect(result.colo).toBe('LHR')
      expect(result.loc).toBe('GB')
      expect(result.uag).toBe('curl/7.88.1')
    })
  })

  describe('multiline format handling', () => {
    it('should handle key=value per line format', () => {
      const simpleResponse = 'key1=value1\nkey2=value2\nkey3=value3'
      const result = parseTraceResponse(simpleResponse)

      // Should parse as generic key-value pairs
      expect(result).toBeDefined()
    })

    it('should handle lines without equals sign gracefully', () => {
      const response = 'validkey=validvalue\ninvalidline\ncolo=SJC'
      const result = parseTraceResponse(response)

      expect(result.colo).toBe('SJC')
    })

    it('should handle empty lines in response', () => {
      const response = 'fl=123\n\ncolo=SJC\n\nhttp=http/2'
      const result = parseTraceResponse(response)

      expect(result.fl).toBe('123')
      expect(result.colo).toBe('SJC')
      expect(result.http).toBe('http/2')
    })

    it('should handle values with equals sign', () => {
      // Edge case: value contains = character
      const response = 'key=value=with=equals\ncolo=SJC'
      const result = parseTraceResponse(response)

      expect(result.colo).toBe('SJC')
    })
  })

  describe('error handling', () => {
    it('should handle empty response', () => {
      const result = parseTraceResponse('')

      // Should return object with empty/undefined fields
      expect(result).toBeDefined()
    })

    it('should handle whitespace-only response', () => {
      const result = parseTraceResponse('   \n\n   ')

      expect(result).toBeDefined()
    })
  })
})

// ============================================================================
// fetchDOLocation Function Tests
// ============================================================================

describe('fetchDOLocation', () => {
  let mockFetch: Mock
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  describe('successful fetch', () => {
    it('should try cf.json first, fall back to trace', async () => {
      // cf.json fails, trace succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('cf.json failed'))
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(VALID_TRACE_RESPONSE),
        })

      await fetchDOLocation()

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://workers.cloudflare.com/cf.json'
      )
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://cloudflare.com/cdn-cgi/trace'
      )
    })

    it('should use cf.json when available', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            colo: 'SJC',
            country: 'US',
            city: 'San Jose',
            latitude: '37.3639',
            longitude: '-121.929',
            timezone: 'America/Los_Angeles',
          }),
      })

      const result = await fetchDOLocation()

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://workers.cloudflare.com/cf.json'
      )
      expect(result.colo).toBe('sjc')
      expect(result.coordinates).toEqual({
        latitude: 37.3639,
        longitude: -121.929,
      })
    })

    it('should parse response and return DOLocation', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(VALID_TRACE_RESPONSE),
      })

      const result = await fetchDOLocation()

      expect(result.colo).toBe('sjc')
      expect(result.ip).toBe('203.0.113.50')
      expect(result.loc).toBe('US')
    })

    it('should include detectedAt timestamp', async () => {
      vi.useFakeTimers()
      const now = new Date('2024-01-11T12:00:00Z')
      vi.setSystemTime(now)

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(VALID_TRACE_RESPONSE),
      })

      const result = await fetchDOLocation()

      expect(result.detectedAt).toBeInstanceOf(Date)
      expect(result.detectedAt.getTime()).toBe(now.getTime())
    })

    it('should return DOLocation with all expected fields', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(VALID_TRACE_RESPONSE),
      })

      const result = await fetchDOLocation()

      // Verify structure of DOLocation
      expect(result).toHaveProperty('colo')
      expect(result).toHaveProperty('ip')
      expect(result).toHaveProperty('loc')
      expect(result).toHaveProperty('detectedAt')
      expect(result).toHaveProperty('traceData')
    })

    it('should include full TraceData in result', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(VALID_TRACE_RESPONSE),
      })

      const result = await fetchDOLocation()

      expect(result.traceData).toBeDefined()
      expect(result.traceData.fl).toBe('123f456')
      expect(result.traceData.http).toBe('http/2')
    })
  })

  describe('error handling', () => {
    it('should throw on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      await expect(fetchDOLocation()).rejects.toThrow('Network error')
    })

    it('should throw on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(fetchDOLocation()).rejects.toThrow()
    })

    it('should throw on 404 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      await expect(fetchDOLocation()).rejects.toThrow()
    })

    it('should throw on invalid response (missing colo)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(TRACE_RESPONSE_MISSING_COLO),
      })

      await expect(fetchDOLocation()).rejects.toThrow()
    })

    it('should throw on empty response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      })

      await expect(fetchDOLocation()).rejects.toThrow()
    })

    it('should throw on timeout', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 100)
          )
      )

      await expect(fetchDOLocation()).rejects.toThrow('Timeout')
    })

    it('should throw descriptive error for invalid colo', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(TRACE_RESPONSE_INVALID_COLO),
      })

      await expect(fetchDOLocation()).rejects.toThrow(/colo|invalid/i)
    })
  })

  describe('response validation', () => {
    it('should validate colo is a known code', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(VALID_TRACE_RESPONSE),
      })

      const result = await fetchDOLocation()

      // sjc is a valid colo code
      expect(['sjc', 'lax', 'iad', 'lhr', 'cdg', 'ams', 'fra', 'sin', 'hkg', 'nrt']).toContain(result.colo)
    })

    it('should normalize colo to lowercase in result', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(VALID_TRACE_RESPONSE),
      })

      const result = await fetchDOLocation()

      expect(result.colo).toBe('sjc')
      expect(result.colo).toMatch(/^[a-z]{3}$/)
    })
  })
})

// ============================================================================
// TraceData Interface Tests
// ============================================================================

describe('TraceData Interface', () => {
  it('should define all required fields', () => {
    const traceData: TraceData = {
      fl: '123f456',
      h: 'cloudflare.com',
      ip: '203.0.113.50',
      ts: '1704931200.123',
      visit_scheme: 'https',
      uag: 'Mozilla/5.0',
      colo: 'SJC',
      sliver: 'none',
      http: 'http/2',
      loc: 'US',
      tls: 'TLSv1.3',
      sni: 'plaintext',
      warp: 'off',
      gateway: 'off',
      rbi: 'off',
      kex: 'X25519',
    }

    expect(traceData.fl).toBe('123f456')
    expect(traceData.h).toBe('cloudflare.com')
    expect(traceData.ip).toBe('203.0.113.50')
    expect(traceData.ts).toBe('1704931200.123')
    expect(traceData.visit_scheme).toBe('https')
    expect(traceData.uag).toBe('Mozilla/5.0')
    expect(traceData.colo).toBe('SJC')
    expect(traceData.sliver).toBe('none')
    expect(traceData.http).toBe('http/2')
    expect(traceData.loc).toBe('US')
    expect(traceData.tls).toBe('TLSv1.3')
    expect(traceData.sni).toBe('plaintext')
    expect(traceData.warp).toBe('off')
    expect(traceData.gateway).toBe('off')
    expect(traceData.rbi).toBe('off')
    expect(traceData.kex).toBe('X25519')
  })

  it('should enforce string types for all fields', () => {
    const traceData: TraceData = {
      fl: 'string',
      h: 'string',
      ip: 'string',
      ts: 'string',
      visit_scheme: 'string',
      uag: 'string',
      colo: 'string',
      sliver: 'string',
      http: 'string',
      loc: 'string',
      tls: 'string',
      sni: 'string',
      warp: 'string',
      gateway: 'string',
      rbi: 'string',
      kex: 'string',
    }

    expect(typeof traceData.fl).toBe('string')
    expect(typeof traceData.colo).toBe('string')
    expect(typeof traceData.ip).toBe('string')
  })
})

// ============================================================================
// DOLocation Interface Tests
// ============================================================================

describe('DOLocation Interface', () => {
  it('should define colo as ColoCode', () => {
    const location: DOLocation = {
      colo: 'sjc',
      ip: '203.0.113.50',
      loc: 'US',
      detectedAt: new Date(),
      traceData: {} as TraceData,
    }

    expect(location.colo).toBe('sjc')
  })

  it('should include ip address', () => {
    const location: DOLocation = {
      colo: 'lax',
      ip: '198.51.100.1',
      loc: 'US',
      detectedAt: new Date(),
      traceData: {} as TraceData,
    }

    expect(location.ip).toBe('198.51.100.1')
  })

  it('should include country code (loc)', () => {
    const location: DOLocation = {
      colo: 'lhr',
      ip: '203.0.113.50',
      loc: 'GB',
      detectedAt: new Date(),
      traceData: {} as TraceData,
    }

    expect(location.loc).toBe('GB')
  })

  it('should include detectedAt timestamp', () => {
    const now = new Date()
    const location: DOLocation = {
      colo: 'fra',
      ip: '203.0.113.50',
      loc: 'DE',
      detectedAt: now,
      traceData: {} as TraceData,
    }

    expect(location.detectedAt).toBe(now)
    expect(location.detectedAt).toBeInstanceOf(Date)
  })

  it('should include full TraceData', () => {
    const traceData: TraceData = {
      fl: '123',
      h: 'cloudflare.com',
      ip: '203.0.113.50',
      ts: '1704931200.123',
      visit_scheme: 'https',
      uag: 'test',
      colo: 'SJC',
      sliver: 'none',
      http: 'http/2',
      loc: 'US',
      tls: 'TLSv1.3',
      sni: 'plaintext',
      warp: 'off',
      gateway: 'off',
      rbi: 'off',
      kex: 'X25519',
    }

    const location: DOLocation = {
      colo: 'sjc',
      ip: '203.0.113.50',
      loc: 'US',
      detectedAt: new Date(),
      traceData,
    }

    expect(location.traceData).toBe(traceData)
    expect(location.traceData.fl).toBe('123')
  })
})

// ============================================================================
// Type Export Tests
// ============================================================================

describe('Type Exports', () => {
  it('exports detectColoFromTrace function', () => {
    expect(typeof detectColoFromTrace).toBe('function')
  })

  it('exports fetchDOLocation function', () => {
    expect(typeof fetchDOLocation).toBe('function')
  })

  it('exports parseTraceResponse function', () => {
    expect(typeof parseTraceResponse).toBe('function')
  })

  it('exports CLOUDFLARE_TRACE_URL constant', () => {
    expect(typeof CLOUDFLARE_TRACE_URL).toBe('string')
  })
})
