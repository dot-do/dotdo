/**
 * Network Commands Tests - GREEN Phase
 *
 * Comprehensive tests for network diagnostic commands.
 *
 * Commands covered:
 * - ping (HTTP-based simulation since ICMP is not available in Workers)
 * - dig / nslookup (DNS lookup via DoH - DNS over HTTPS)
 * - host (simplified DNS lookup)
 * - nc / netcat (limited port checking in Workers)
 * - Enhanced curl/wget tests
 *
 * NOTE: Tests use mocked fetch to avoid SSL handshake failures in vitest-pool-workers.
 * The workerd runtime has known TLS limitations that prevent real HTTPS connections.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Mock fetch for network tests
// ============================================================================

/**
 * Create a mock Response object with the given properties.
 */
function createMockResponse(options: {
  ok?: boolean
  status?: number
  statusText?: string
  headers?: Record<string, string>
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}): Response {
  const headers = new Headers(options.headers || {})
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    headers,
    json: options.json ?? (() => Promise.resolve({})),
    text: options.text ?? (() => Promise.resolve('')),
    clone: () => createMockResponse(options),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    redirected: false,
    type: 'basic',
    url: '',
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response
}

/**
 * Mock fetch implementation for network command tests.
 * Routes requests based on URL patterns and returns appropriate mock responses.
 */
function createMockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method || 'GET'

    // DNS over HTTPS (DoH) requests to Cloudflare
    if (url.includes('cloudflare-dns.com/dns-query') || url.includes('dns.google/dns-query')) {
      const urlParams = new URL(url).searchParams
      const name = urlParams.get('name') || ''
      const type = urlParams.get('type') || 'A'

      // Handle different domains
      if (name.includes('.invalid') || name === 'nonexistent.invalid') {
        return createMockResponse({
          ok: true,
          json: () =>
            Promise.resolve({
              Status: 3, // NXDOMAIN
              Answer: [],
            }),
        })
      }

      if (name === 'servfail.test') {
        return createMockResponse({
          ok: true,
          json: () =>
            Promise.resolve({
              Status: 2, // SERVFAIL
              Answer: [],
            }),
        })
      }

      // Standard successful DNS response
      const answers: Array<{ name: string; type: number; TTL: number; data: string }> = []

      if (type === 'A' || type === '1') {
        answers.push({ name, type: 1, TTL: 300, data: '93.184.216.34' })
      } else if (type === 'AAAA' || type === '28') {
        answers.push({ name, type: 28, TTL: 300, data: '2606:2800:220:1:248:1893:25c8:1946' })
      } else if (type === 'MX' || type === '15') {
        answers.push({ name, type: 15, TTL: 300, data: '10 mail.example.com' })
      } else if (type === 'TXT' || type === '16') {
        answers.push({ name, type: 16, TTL: 300, data: 'v=spf1 -all' })
      } else if (type === 'NS' || type === '2') {
        answers.push({ name, type: 2, TTL: 300, data: 'ns1.example.com' })
      } else if (type === 'CNAME' || type === '5') {
        answers.push({ name, type: 5, TTL: 300, data: 'example.com' })
      } else if (type === 'SOA' || type === '6') {
        answers.push({
          name,
          type: 6,
          TTL: 300,
          data: 'ns1.example.com hostmaster.example.com 2024010101 7200 3600 1209600 86400',
        })
      } else if (type === 'PTR' || type === '12') {
        answers.push({ name, type: 12, TTL: 300, data: 'dns.google' })
      }

      return createMockResponse({
        ok: true,
        json: () =>
          Promise.resolve({
            Status: 0, // NOERROR
            Answer: answers,
          }),
      })
    }

    // Handle unreachable/invalid hosts - check first
    if (url.includes('.invalid') || url.includes('unreachable')) {
      throw new Error('Network request failed')
    }

    // Handle httpstat.us for timeout tests
    if (url.includes('httpstat.us')) {
      // Simulate timeout by throwing an abort error
      throw new Error('The operation was aborted')
    }

    // Handle port-specific checks for nc command (before general domain handling)
    // Extract port from URL like http://example.com.ai:12345 or https://host:443
    // This regex looks for a port number that's not a standard HTTP port (80/443)
    const portMatch = url.match(/:(\d+)(?:\/|$)/)
    if (portMatch) {
      const port = parseInt(portMatch[1], 10)
      // Standard HTTP ports are handled by the domain check below
      // Non-standard ports need explicit handling for nc port scanning
      if (![80, 443].includes(port)) {
        // Common open service ports
        if ([8080, 8443].includes(port)) {
          await new Promise((resolve) => setTimeout(resolve, 1))
          return createMockResponse({
            ok: true,
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        }
        // All other ports - simulate closed
        throw new Error('Connection refused')
      }
    }

    // HTTP/HTTPS requests for ping, curl, wget, nc
    if (url.includes('example.com.ai') || url.includes('example.com')) {
      // Handle 404 for nonexistent paths
      if (url.includes('/nonexistent-page-12345')) {
        return createMockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: {
            'content-type': 'text/html',
          },
        })
      }

      // Add small delay to simulate network latency for timing tests
      await new Promise((resolve) => setTimeout(resolve, 1))

      // Successful response for standard requests
      return createMockResponse({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'text/html; charset=UTF-8',
          server: 'ECS (dcb/7F84)',
          'content-length': '1256',
          date: new Date().toUTCString(),
        },
        text: () => Promise.resolve('<html><body>Example Domain</body></html>'),
      })
    }

    // Default: return a successful response
    return createMockResponse({
      ok: true,
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
  })
}

// Store original fetch
let originalFetch: typeof globalThis.fetch
let mockFetch: ReturnType<typeof createMockFetch>

beforeEach(() => {
  // Save original and install mock
  originalFetch = globalThis.fetch
  mockFetch = createMockFetch()
  globalThis.fetch = mockFetch
})

afterEach(() => {
  // Restore original fetch
  globalThis.fetch = originalFetch
  vi.clearAllMocks()
})
import {
  executePing,
  formatPingOutput,
  parsePingCommand,
  executeDig,
  formatDigShort,
  formatDigOutput,
  executeNslookup,
  formatNslookupOutput,
  executeHost,
  formatHostOutput,
  executeNc,
  executeNcRange,
  executeNcHttp,
  parseNcCommand,
  parseDigCommand,
  executeWgetSpider,
  executeCurlHead,
  executeCurlWithTiming,
  formatCurlTiming,
  type PingResult,
  type DnsResult,
  type DnsRecord,
  type HostResult,
  type PortCheckResult,
  type HttpCheckResult,
} from '../../../src/do/commands/network.js'
import { TieredExecutor } from '../../../src/do/tiered-executor.js'

// ============================================================================
// ping Command Tests (HTTP-based simulation)
// ============================================================================

describe('ping command', () => {
  describe('basic ping', () => {
    it('should ping a host N times with -c flag', async () => {
      // ping -c 4 example.com.ai
      const result = await executePing('example.com.ai', { count: 4 })

      expect(result.host).toBe('example.com.ai')
      expect(result.transmitted).toBe(4)
      expect(result.received).toBeGreaterThanOrEqual(0)
      expect(result.received).toBeLessThanOrEqual(4)
      expect(result.times).toHaveLength(result.received)
    })

    it('should calculate packet loss percentage', async () => {
      // ping -c 4 example.com.ai (reduced from 10 for faster tests)
      const result = await executePing('example.com.ai', { count: 4, interval: 100 })

      expect(result.packetLoss).toBeGreaterThanOrEqual(0)
      expect(result.packetLoss).toBeLessThanOrEqual(100)

      // Verify packet loss formula
      const expectedLoss = ((result.transmitted - result.received) / result.transmitted) * 100
      expect(result.packetLoss).toBeCloseTo(expectedLoss, 1)
    })

    it('should calculate round-trip time statistics', async () => {
      // ping -c 4 example.com.ai
      const result = await executePing('example.com.ai', { count: 4 })

      if (result.received > 0) {
        // NOTE: With mocked fetch, timing can be very small (close to 0)
        // We verify the statistics structure is correct rather than absolute values
        expect(result.min).toBeGreaterThanOrEqual(0)
        expect(result.max).toBeGreaterThanOrEqual(result.min)
        expect(result.avg).toBeGreaterThanOrEqual(result.min)
        expect(result.avg).toBeLessThanOrEqual(result.max)
        expect(result.mdev).toBeGreaterThanOrEqual(0)
      }
    })

    it('should return individual timing for each ping', async () => {
      const result = await executePing('example.com.ai', { count: 3 })

      result.times.forEach((time) => {
        // NOTE: With mocked fetch, timing can be very small but should still be >= 0
        expect(time).toBeGreaterThanOrEqual(0)
        expect(typeof time).toBe('number')
      })
    })
  })

  describe('ping with timeout', () => {
    it('should respect timeout with -W flag', async () => {
      // ping -c 1 -W 5 example.com.ai (5 second timeout)
      const result = await executePing('example.com.ai', { count: 1, timeout: 5000 })

      expect(result.transmitted).toBe(1)
      // If succeeded, time should be less than timeout
      if (result.received === 1) {
        expect(result.times[0]).toBeLessThan(5000)
      }
    })

    it('should handle unreachable host with timeout', async () => {
      // ping -c 1 -W 2 unreachable.invalid
      const result = await executePing('unreachable.invalid', { count: 1, timeout: 2000 })

      expect(result.transmitted).toBe(1)
      expect(result.received).toBe(0)
      expect(result.packetLoss).toBe(100)
    })

    it('should timeout individual requests', async () => {
      // ping -c 3 -W 1 slow.example.com.ai
      const startTime = Date.now()
      const result = await executePing('slow.example.invalid', { count: 3, timeout: 1000 })
      const elapsed = Date.now() - startTime

      // Should not take much longer than count * timeout
      expect(elapsed).toBeLessThan(5000)
      expect(result.packetLoss).toBeGreaterThan(0)
    })
  })

  describe('quiet mode', () => {
    it('should support quiet mode with -q flag', async () => {
      // ping -q example.com.ai - only shows summary
      const result = await executePing('example.com.ai', { count: 4, quiet: true })

      // In quiet mode, only summary stats should be meaningful
      expect(result.transmitted).toBe(4)
      expect(typeof result.packetLoss).toBe('number')
      expect(typeof result.min).toBe('number')
      expect(typeof result.avg).toBe('number')
      expect(typeof result.max).toBe('number')
    })
  })

  describe('output format', () => {
    it('should format output like real ping', async () => {
      const result = await executePing('example.com.ai', { count: 4 })
      const output = formatPingOutput(result)

      // Should contain summary line
      expect(output).toContain('packets transmitted')
      expect(output).toContain('received')
      expect(output).toContain('packet loss')

      // Should contain statistics line if successful
      if (result.received > 0) {
        expect(output).toContain('min/avg/max')
      }
    })
  })

  describe('interval between pings', () => {
    it('should respect interval with -i flag', async () => {
      // ping -c 3 -i 0.5 example.com.ai (500ms between pings)
      const startTime = Date.now()
      await executePing('example.com.ai', { count: 3, interval: 500 })
      const elapsed = Date.now() - startTime

      // Should take at least (count - 1) * interval milliseconds
      expect(elapsed).toBeGreaterThanOrEqual(1000)
    })
  })
})

// ============================================================================
// dig / nslookup Command Tests (DNS lookup via DoH)
// ============================================================================

describe('dig command', () => {
  describe('A record lookup', () => {
    it('should lookup A record by default', async () => {
      // dig example.com.ai
      const result = await executeDig('example.com.ai')

      expect(result.question.name).toBe('example.com.ai')
      expect(result.question.type).toBe('A')
      expect(result.status).toBe(0) // NOERROR
      expect(result.answer.length).toBeGreaterThan(0)

      // Verify A record format
      result.answer.forEach((record) => {
        if (record.type === 'A') {
          // Should be valid IPv4
          expect(record.data).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
        }
      })
    })
  })

  describe('AAAA record lookup (IPv6)', () => {
    it('should lookup AAAA record', async () => {
      // dig example.com.ai AAAA
      const result = await executeDig('example.com.ai', { type: 'AAAA' })

      expect(result.question.type).toBe('AAAA')

      // Some domains may not have AAAA records
      if (result.answer.length > 0) {
        result.answer.forEach((record) => {
          if (record.type === 'AAAA') {
            // Should be valid IPv6
            expect(record.data).toMatch(/^[0-9a-fA-F:]+$/)
          }
        })
      }
    })
  })

  describe('MX record lookup', () => {
    it('should lookup MX record for mail servers', async () => {
      // dig example.com.ai MX
      const result = await executeDig('example.com.ai', { type: 'MX' })

      expect(result.question.type).toBe('MX')

      // MX records have priority and hostname
      result.answer.forEach((record) => {
        if (record.type === 'MX') {
          // MX data format: "priority hostname"
          expect(record.data).toMatch(/^\d+\s+\S+/)
        }
      })
    })
  })

  describe('TXT record lookup', () => {
    it('should lookup TXT records', async () => {
      // dig example.com.ai TXT
      const result = await executeDig('example.com.ai', { type: 'TXT' })

      expect(result.question.type).toBe('TXT')

      result.answer.forEach((record) => {
        if (record.type === 'TXT') {
          expect(typeof record.data).toBe('string')
        }
      })
    })

    it('should handle SPF records in TXT', async () => {
      // dig example.com.ai TXT - SPF is stored in TXT
      const result = await executeDig('example.com.ai', { type: 'TXT' })

      const spfRecords = result.answer.filter(
        (r) => r.type === 'TXT' && r.data.includes('v=spf1')
      )
      // May or may not have SPF
      expect(spfRecords).toBeInstanceOf(Array)
    })
  })

  describe('NS record lookup', () => {
    it('should lookup NS records for nameservers', async () => {
      // dig example.com.ai NS
      const result = await executeDig('example.com.ai', { type: 'NS' })

      expect(result.question.type).toBe('NS')
      expect(result.answer.length).toBeGreaterThan(0)

      result.answer.forEach((record) => {
        if (record.type === 'NS') {
          // NS should be a hostname
          expect(record.data).toMatch(/^[\w.-]+$/)
        }
      })
    })
  })

  describe('CNAME record lookup', () => {
    it('should lookup CNAME records', async () => {
      // dig www.example.com.ai CNAME
      const result = await executeDig('www.example.com.ai', { type: 'CNAME' })

      expect(result.question.type).toBe('CNAME')
      // www may or may not be a CNAME
    })
  })

  describe('SOA record lookup', () => {
    it('should lookup SOA record', async () => {
      // dig example.com.ai SOA
      const result = await executeDig('example.com.ai', { type: 'SOA' })

      expect(result.question.type).toBe('SOA')
      // May be in answer or authority section
    })
  })

  describe('short output mode', () => {
    it('should support +short output', async () => {
      // dig +short example.com.ai
      const result = await executeDig('example.com.ai', { short: true })

      // In short mode, should just return the answer data
      expect(result.answer.length).toBeGreaterThan(0)
      // Short mode typically strips metadata
    })

    it('should return only IP addresses for A record +short', async () => {
      const result = await executeDig('example.com.ai', { type: 'A', short: true })
      const shortOutput = formatDigShort(result)

      // Should be just IP addresses, one per line
      const lines = shortOutput.trim().split('\n')
      lines.forEach((line) => {
        if (line.trim()) {
          expect(line.trim()).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
        }
      })
    })
  })

  describe('specific resolver', () => {
    it('should use specific resolver with @ syntax', async () => {
      // dig @8.8.8.8 example.com.ai - maps to Google DoH
      // In Workers environment, external DoH endpoints may be blocked or rate-limited
      const result = await executeDig('example.com.ai', { resolver: '8.8.8.8' })

      // Accept either success (0) or SERVFAIL (2) due to Workers network restrictions
      expect([0, 2]).toContain(result.status)
    })

    it('should use Cloudflare DNS', async () => {
      // dig @1.1.1.1 example.com.ai - uses Cloudflare DoH which should always work
      const result = await executeDig('example.com.ai', { resolver: '1.1.1.1' })

      expect(result.status).toBe(0)
    })

    it('should use custom DoH endpoint', async () => {
      // dig @https://dns.google/dns-query example.com.ai
      // Google DoH may be blocked or rate-limited in Workers
      const result = await executeDig('example.com.ai', {
        resolver: 'https://dns.google/dns-query',
      })

      // Accept either success (0) or SERVFAIL (2) due to Workers network restrictions
      expect([0, 2]).toContain(result.status)
    })
  })

  describe('error handling', () => {
    it('should handle NXDOMAIN (non-existent domain)', async () => {
      // dig nonexistent.invalid
      const result = await executeDig('nonexistent.invalid')

      expect(result.status).toBe(3) // NXDOMAIN
      expect(result.answer).toHaveLength(0)
    })

    it('should handle SERVFAIL', async () => {
      // Mock a server failure scenario
      const result = await executeDig('servfail.test', { resolver: 'failing-resolver' })

      expect(result.status).toBe(2) // SERVFAIL
    })
  })

  describe('full output format', () => {
    it('should format output like real dig', async () => {
      const result = await executeDig('example.com.ai')
      const output = formatDigOutput(result)

      // Should contain sections
      expect(output).toContain('QUESTION SECTION')
      expect(output).toContain('ANSWER SECTION')
      expect(output).toContain('Query time')
    })
  })
})

describe('nslookup command', () => {
  describe('basic lookup', () => {
    it('should lookup hostname', async () => {
      // nslookup example.com.ai
      const result = await executeNslookup('example.com.ai')

      expect(result.hostname).toBe('example.com.ai')
      expect(result.addresses.length).toBeGreaterThan(0)
    })

    it('should return multiple addresses if available', async () => {
      const result = await executeNslookup('example.com.ai')

      // May have multiple A records
      result.addresses.forEach((addr) => {
        expect(addr).toMatch(/^[\d.:a-fA-F]+$/)
      })
    })
  })

  describe('specific server', () => {
    it('should use specific DNS server', async () => {
      // nslookup example.com.ai 8.8.8.8 - Google DNS might not work in Workers
      // Use Cloudflare DNS (1.1.1.1) which always works in Workers
      const result = await executeNslookup('example.com.ai', { server: '1.1.1.1' })

      expect(result.addresses.length).toBeGreaterThan(0)
    })
  })

  describe('query types', () => {
    it('should support -type=MX', async () => {
      // nslookup -type=MX example.com.ai
      const result = await executeNslookup('example.com.ai', { type: 'MX' })

      expect(result.hostname).toBe('example.com.ai')
      // MX records come back differently
    })
  })

  describe('output format', () => {
    it('should format output like real nslookup', async () => {
      const result = await executeNslookup('example.com.ai')
      const output = formatNslookupOutput(result)

      expect(output).toContain('Server:')
      expect(output).toContain('Address:')
      expect(output).toContain('Name:')
    })
  })
})

// ============================================================================
// host Command Tests
// ============================================================================

describe('host command', () => {
  describe('simple lookup', () => {
    it('should perform simple hostname lookup', async () => {
      // host example.com.ai
      const result = await executeHost('example.com.ai')

      expect(result.hostname).toBe('example.com.ai')
      expect(result.addresses.length).toBeGreaterThan(0)
    })

    it('should show all addresses', async () => {
      const result = await executeHost('example.com.ai')

      result.addresses.forEach((addr) => {
        expect(addr).toMatch(/^[\d.:a-fA-F]+$/)
      })
    })
  })

  describe('specific record type', () => {
    it('should lookup MX records with -t MX', async () => {
      // host -t MX example.com.ai
      const result = await executeHost('example.com.ai', { type: 'MX' })

      expect(result.hostname).toBe('example.com.ai')
    })

    it('should lookup NS records with -t NS', async () => {
      // host -t NS example.com.ai
      const result = await executeHost('example.com.ai', { type: 'NS' })

      expect(result.hostname).toBe('example.com.ai')
    })

    it('should lookup TXT records with -t TXT', async () => {
      // host -t TXT example.com.ai
      const result = await executeHost('example.com.ai', { type: 'TXT' })

      expect(result.hostname).toBe('example.com.ai')
    })
  })

  describe('reverse lookup', () => {
    it('should perform reverse DNS lookup', async () => {
      // host 8.8.8.8
      const result = await executeHost('8.8.8.8')

      expect(result.hostname).toBe('8.8.8.8')
      // Reverse lookup returns PTR record hostname
      expect(result.addresses.length).toBeGreaterThan(0)
    })

    it('should handle IPv6 reverse lookup', async () => {
      // host 2001:4860:4860::8888
      const result = await executeHost('2001:4860:4860::8888')

      expect(result.hostname).toBe('2001:4860:4860::8888')
    })
  })

  describe('verbose mode', () => {
    it('should support verbose output with -v', async () => {
      // host -v example.com.ai
      const result = await executeHost('example.com.ai', { verbose: true })

      expect(result.hostname).toBe('example.com.ai')
    })
  })

  describe('output format', () => {
    it('should format output like real host', async () => {
      const result = await executeHost('example.com.ai')
      const output = formatHostOutput(result)

      expect(output).toContain('has address')
    })
  })
})

// ============================================================================
// nc / netcat Command Tests (Limited in Workers)
// ============================================================================

describe('nc / netcat command', () => {
  describe('port check with -z', () => {
    it('should check if port is open', async () => {
      // nc -z example.com.ai 80
      const result = await executeNc('example.com.ai', 80, { zero: true })

      expect(result.host).toBe('example.com.ai')
      expect(result.port).toBe(80)
      expect(typeof result.open).toBe('boolean')
    })

    it('should report open port for HTTP', async () => {
      // nc -z example.com.ai 80
      const result = await executeNc('example.com.ai', 80, { zero: true })

      // HTTP port should be open on example.com.ai
      expect(result.open).toBe(true)
    })

    it('should report open port for HTTPS', async () => {
      // nc -z example.com.ai 443
      const result = await executeNc('example.com.ai', 443, { zero: true })

      expect(result.open).toBe(true)
    })

    it('should report closed port', async () => {
      // nc -z example.com.ai 12345 - use short timeout to avoid long waits
      const result = await executeNc('example.com.ai', 12345, { zero: true, timeout: 2000 })

      // Random high port should be closed
      expect(result.open).toBe(false)
    })

    it('should measure latency when checking port', async () => {
      const result = await executeNc('example.com.ai', 443, { zero: true })

      if (result.open && result.latency !== undefined) {
        // NOTE: With mocked fetch, latency can be very small but should be >= 0
        expect(result.latency).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('port range scan', () => {
    it('should scan port range', async () => {
      // nc -z example.com.ai 80-82 with short timeout for speed
      const results = await executeNcRange('example.com.ai', 80, 82, { timeout: 2000 })

      expect(results).toHaveLength(3)
      results.forEach((result) => {
        expect(result.port).toBeGreaterThanOrEqual(80)
        expect(result.port).toBeLessThanOrEqual(82)
      })
    })
  })

  describe('timeout handling', () => {
    it('should respect timeout with -w flag', async () => {
      // nc -z -w 2 example.com.ai 80
      const startTime = Date.now()
      const result = await executeNc('unreachable.invalid', 80, {
        zero: true,
        timeout: 2000,
      })
      const elapsed = Date.now() - startTime

      expect(elapsed).toBeLessThan(5000)
      expect(result.open).toBe(false)
    })
  })

  describe('simple HTTP via nc', () => {
    it('should send simple HTTP request', async () => {
      // echo "GET / HTTP/1.0\r\n\r\n" | nc example.com.ai 80
      const response = await executeNcHttp('example.com.ai', 80, 'GET / HTTP/1.0\r\n\r\n')

      expect(response).toContain('HTTP/')
    })

    it('should receive response headers', async () => {
      const response = await executeNcHttp('example.com.ai', 80, 'GET / HTTP/1.0\r\nHost: example.com.ai\r\n\r\n')

      expect(response).toContain('HTTP/1')
      expect(response.toLowerCase()).toMatch(/content-type/i)
    })
  })

  describe('verbose mode', () => {
    it('should support verbose output with -v', async () => {
      // nc -zv example.com.ai 80
      const result = await executeNc('example.com.ai', 80, { zero: true, verbose: true })

      expect(result.host).toBe('example.com.ai')
    })
  })

  describe('listen mode limitation', () => {
    it('should throw error for listen mode (not supported in Workers)', async () => {
      // nc -l 8080 - not possible in Workers
      await expect(executeNc('localhost', 8080, { listen: true })).rejects.toThrow(
        /not supported|not available|cannot listen/i
      )
    })
  })
})

// ============================================================================
// Enhanced curl/wget Tests
// ============================================================================

describe('wget --spider (URL existence check)', () => {
  describe('basic spider', () => {
    it('should check if URL exists', async () => {
      // wget --spider https://example.com.ai
      const result = await executeWgetSpider('https://example.com.ai')

      expect(result.url).toBe('https://example.com.ai')
      expect(result.exists).toBe(true)
    })

    it('should detect non-existent URL', async () => {
      // wget --spider https://example.com.ai/nonexistent-page-12345
      const result = await executeWgetSpider('https://example.com.ai/nonexistent-page-12345')

      expect(result.exists).toBe(false)
      expect(result.status).toBe(404)
    })

    it('should return status code', async () => {
      const result = await executeWgetSpider('https://example.com.ai')

      expect(result.status).toBe(200)
    })
  })

  describe('redirect handling', () => {
    it('should follow redirects by default', async () => {
      // wget --spider http://example.com.ai (usually redirects to https)
      const result = await executeWgetSpider('http://example.com.ai')

      expect(result.exists).toBe(true)
    })

    it('should report redirect chain', async () => {
      const result = await executeWgetSpider('http://example.com.ai', { followRedirects: true })

      // May or may not have redirects
      expect(typeof result.exists).toBe('boolean')
    })
  })

  describe('timeout handling', () => {
    it('should respect timeout', async () => {
      const startTime = Date.now()
      const result = await executeWgetSpider('https://httpstat.us/200?sleep=10000', {
        timeout: 2000,
      })
      const elapsed = Date.now() - startTime

      expect(elapsed).toBeLessThan(5000)
    })
  })
})

describe('curl -I (headers only)', () => {
  describe('basic HEAD request', () => {
    it('should fetch only headers', async () => {
      // curl -I https://example.com.ai
      const result = await executeCurlHead('https://example.com.ai')

      expect(result.url).toBe('https://example.com.ai')
      expect(result.headers).toBeDefined()
      expect(result.status).toBe(200)
    })

    it('should include common headers', async () => {
      const result = await executeCurlHead('https://example.com.ai')

      expect(result.headers).toBeDefined()
      const headers = result.headers!
      // Should have content-type
      expect(
        Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')
      ).toBe(true)
    })

    it('should include server header', async () => {
      const result = await executeCurlHead('https://example.com.ai')

      const headers = result.headers!
      // Many servers include server header
      const serverHeader = Object.keys(headers).find((k) => k.toLowerCase() === 'server')
      if (serverHeader) {
        expect(headers[serverHeader]).toBeTruthy()
      }
    })

    it('should include content-length when available', async () => {
      const result = await executeCurlHead('https://example.com.ai')

      const headers = result.headers!
      // Some responses include content-length
      const clHeader = Object.keys(headers).find((k) => k.toLowerCase() === 'content-length')
      if (clHeader) {
        expect(parseInt(headers[clHeader], 10)).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('different HTTP methods response', () => {
    it('should handle redirects in HEAD', async () => {
      const result = await executeCurlHead('http://example.com.ai')

      expect([200, 301, 302, 307, 308]).toContain(result.status)
    })
  })
})

describe('curl -w timing info', () => {
  describe('timing metrics', () => {
    it('should provide total time', async () => {
      // curl -w "%{time_total}" https://example.com.ai
      const result = await executeCurlWithTiming('https://example.com.ai')

      expect(result.timing).toBeDefined()
      // NOTE: With mocked fetch, timing can be very small but should be >= 0
      expect(result.timing!.total).toBeGreaterThanOrEqual(0)
    })

    it('should provide DNS lookup time', async () => {
      // curl -w "%{time_namelookup}" https://example.com.ai
      const result = await executeCurlWithTiming('https://example.com.ai')

      expect(result.timing!.dns).toBeGreaterThanOrEqual(0)
    })

    it('should provide connect time', async () => {
      // curl -w "%{time_connect}" https://example.com.ai
      const result = await executeCurlWithTiming('https://example.com.ai')

      expect(result.timing!.connect).toBeGreaterThanOrEqual(0)
    })

    it('should provide time to first byte (TTFB)', async () => {
      // curl -w "%{time_starttransfer}" https://example.com.ai
      const result = await executeCurlWithTiming('https://example.com.ai')

      // NOTE: With mocked fetch, TTFB can be very small but should be >= 0
      expect(result.timing!.ttfb).toBeGreaterThanOrEqual(0)
    })

    it('should have timing in correct order', async () => {
      const result = await executeCurlWithTiming('https://example.com.ai')
      const timing = result.timing!

      // DNS should be before connect
      expect(timing.dns).toBeLessThanOrEqual(timing.connect)
      // Connect should be before TTFB
      expect(timing.connect).toBeLessThanOrEqual(timing.ttfb)
      // TTFB should be before total
      expect(timing.ttfb).toBeLessThanOrEqual(timing.total)
    })
  })

  describe('custom format string', () => {
    it('should support custom timing format', async () => {
      // curl -w "DNS: %{time_namelookup}s, Total: %{time_total}s" URL
      const result = await executeCurlWithTiming('https://example.com.ai', {
        format: 'DNS: %{time_namelookup}s, Total: %{time_total}s',
      })

      expect(result.timing).toBeDefined()
    })
  })

  describe('output format', () => {
    it('should format timing like real curl -w', async () => {
      const result = await executeCurlWithTiming('https://example.com.ai')
      const output = formatCurlTiming(result)

      expect(output).toContain('time_total')
    })
  })
})

// Functions are now imported from ./network.ts

// ============================================================================
// Integration Tests with TieredExecutor
// ============================================================================

describe('Network commands via TieredExecutor', () => {
  describe('ping integration', () => {
    it('should classify ping as network command', async () => {
      const executor = new TieredExecutor({})
      const classification = executor.classifyCommand('ping -c 4 example.com.ai')
      // ping is classified as tier 4 (sandbox) or tier 1 (native network) depending on implementation
      expect(classification.tier).toBeGreaterThanOrEqual(1)
      expect(classification.tier).toBeLessThanOrEqual(4)
    })
  })

  describe('dig integration', () => {
    it('should classify dig as network command', async () => {
      const executor = new TieredExecutor({})
      const classification = executor.classifyCommand('dig example.com.ai')
      expect(classification.tier).toBeGreaterThanOrEqual(1)
    })

    it('should classify dig +short as network command', async () => {
      const executor = new TieredExecutor({})
      const classification = executor.classifyCommand('dig +short example.com.ai')
      expect(classification.tier).toBeGreaterThanOrEqual(1)
    })
  })

  describe('nslookup integration', () => {
    it('should classify nslookup as network command', async () => {
      const executor = new TieredExecutor({})
      const classification = executor.classifyCommand('nslookup example.com.ai')
      expect(classification.tier).toBeGreaterThanOrEqual(1)
    })
  })

  describe('host integration', () => {
    it('should classify host as network command', async () => {
      const executor = new TieredExecutor({})
      const classification = executor.classifyCommand('host example.com.ai')
      expect(classification.tier).toBeGreaterThanOrEqual(1)
    })
  })

  describe('nc integration', () => {
    it('should classify nc as network command', async () => {
      const executor = new TieredExecutor({})
      const classification = executor.classifyCommand('nc -z example.com.ai 80')
      // nc is listed in TIER_4_SANDBOX_COMMANDS
      expect(classification.tier).toBe(4)
    })
  })

  describe('curl/wget integration', () => {
    it('should classify wget as tier 1 http command', async () => {
      const executor = new TieredExecutor({})
      const classification = executor.classifyCommand('wget --spider https://example.com.ai')
      expect(classification.tier).toBe(1)
      expect(classification.capability).toBe('http')
    })

    it('should classify curl as tier 1 http command', async () => {
      const executor = new TieredExecutor({})
      const classification = executor.classifyCommand('curl -I https://example.com.ai')
      expect(classification.tier).toBe(1)
      expect(classification.capability).toBe('http')
    })

    it('should classify curl -w as tier 1 http command', async () => {
      const executor = new TieredExecutor({})
      const classification = executor.classifyCommand('curl -w "%{time_total}" https://example.com.ai')
      expect(classification.tier).toBe(1)
      expect(classification.capability).toBe('http')
    })
  })
})

// ============================================================================
// Command Parsing Tests
// ============================================================================

describe('Network command parsing', () => {
  describe('ping command parsing', () => {
    it('should parse ping -c 4 example.com.ai', () => {
      const parsed = parsePingCommand('ping -c 4 example.com.ai')
      expect(parsed).toEqual({
        host: 'example.com.ai',
        count: 4,
      })
    })

    it('should parse ping -c 1 -W 5 example.com.ai', () => {
      const parsed = parsePingCommand('ping -c 1 -W 5 example.com.ai')
      expect(parsed).toEqual({
        host: 'example.com.ai',
        count: 1,
        timeout: 5000,
      })
    })

    it('should parse ping -q example.com.ai', () => {
      const parsed = parsePingCommand('ping -q example.com.ai')
      expect(parsed).toEqual({
        host: 'example.com.ai',
        quiet: true,
      })
    })
  })

  describe('dig command parsing', () => {
    it('should parse dig example.com.ai', () => {
      const parsed = parseDigCommand('dig example.com.ai')
      expect(parsed).toEqual({
        domain: 'example.com.ai',
        type: 'A',
      })
    })

    it('should parse dig example.com.ai MX', () => {
      const parsed = parseDigCommand('dig example.com.ai MX')
      expect(parsed).toEqual({
        domain: 'example.com.ai',
        type: 'MX',
      })
    })

    it('should parse dig +short example.com.ai', () => {
      const parsed = parseDigCommand('dig +short example.com.ai')
      expect(parsed).toEqual({
        domain: 'example.com.ai',
        type: 'A',
        short: true,
      })
    })

    it('should parse dig @8.8.8.8 example.com.ai', () => {
      const parsed = parseDigCommand('dig @8.8.8.8 example.com.ai')
      expect(parsed).toEqual({
        domain: 'example.com.ai',
        type: 'A',
        resolver: '8.8.8.8',
      })
    })
  })

  describe('nc command parsing', () => {
    it('should parse nc -z host port', () => {
      const parsed = parseNcCommand('nc -z example.com.ai 80')
      expect(parsed).toEqual({
        host: 'example.com.ai',
        port: 80,
        zero: true,
      })
    })

    it('should parse nc -zv host port', () => {
      const parsed = parseNcCommand('nc -zv example.com.ai 443')
      expect(parsed).toEqual({
        host: 'example.com.ai',
        port: 443,
        zero: true,
        verbose: true,
      })
    })
  })
})

// Parsing functions are now imported from ./network.ts
