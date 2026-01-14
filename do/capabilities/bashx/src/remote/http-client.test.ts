/**
 * HTTP Client Tests (RED Phase)
 *
 * Tests for Git HTTP transport protocol (smart HTTP).
 * Covers refs discovery, upload-pack (fetch), receive-pack (push), and authentication.
 *
 * These tests are designed to FAIL initially (RED phase of TDD).
 * The implementation files (http-client.ts, auth.ts) don't exist yet.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, beforeAll } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// Import from files that don't exist yet - will fail until implemented
import {
  GitHttpClient,
  GitHttpError,
} from './http-client.js'

import {
  GitAuth,
  createAuthHeader,
  getTokenFromEnv,
  parseWwwAuthenticate,
} from './auth.js'

// =============================================================================
// Test Fixtures
// =============================================================================

const MOCK_REPO_URL = 'https://github.com/test/repo.git'
const MOCK_REFS_RESPONSE = `001e# service=git-upload-pack
0000009b1234567890abcdef1234567890abcdef12345678 HEAD\0multi_ack thin-pack side-band side-band-64k ofs-delta shallow deepen-since deepen-not deepen-relative no-progress include-tag multi_ack_detailed symref=HEAD:refs/heads/main agent=git/2.39.0
003f1234567890abcdef1234567890abcdef12345678 refs/heads/main
00441234567890abcdef1234567890abcdef12345678 refs/heads/feature-x
003fabcdef1234567890abcdef1234567890abcdef1234 refs/tags/v1.0.0
0000`

const MOCK_DUMB_REFS_RESPONSE = `1234567890abcdef1234567890abcdef12345678\trefs/heads/main
abcdef1234567890abcdef1234567890abcdef12\trefs/heads/feature
`

const MOCK_PACKFILE = new Uint8Array([
  0x50, 0x41, 0x43, 0x4b, // PACK
  0x00, 0x00, 0x00, 0x02, // version 2
  0x00, 0x00, 0x00, 0x01, // 1 object
  // ... rest of pack data would follow
])

// =============================================================================
// MSW Server Setup
// =============================================================================

const handlers = [
  // Smart HTTP refs discovery
  http.get('https://github.com/test/repo.git/info/refs', ({ request }) => {
    const url = new URL(request.url)
    const service = url.searchParams.get('service')

    if (service === 'git-upload-pack') {
      return new HttpResponse(MOCK_REFS_RESPONSE, {
        headers: {
          'Content-Type': 'application/x-git-upload-pack-advertisement',
          'Cache-Control': 'no-cache',
        },
      })
    }

    return new HttpResponse('Invalid service', { status: 400 })
  }),

  // Upload-pack (fetch)
  http.post('https://github.com/test/repo.git/git-upload-pack', async ({ request }) => {
    const contentType = request.headers.get('Content-Type')
    if (contentType !== 'application/x-git-upload-pack-request') {
      return new HttpResponse('Invalid content type', { status: 400 })
    }

    return new HttpResponse(MOCK_PACKFILE, {
      headers: {
        'Content-Type': 'application/x-git-upload-pack-result',
      },
    })
  }),

  // Receive-pack (push)
  http.post('https://github.com/test/repo.git/git-receive-pack', async ({ request }) => {
    const contentType = request.headers.get('Content-Type')
    if (contentType !== 'application/x-git-receive-pack-request') {
      return new HttpResponse('Invalid content type', { status: 400 })
    }

    return new HttpResponse('000eunpack ok\n0019ok refs/heads/main\n0000', {
      headers: {
        'Content-Type': 'application/x-git-receive-pack-result',
      },
    })
  }),
]

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// =============================================================================
// GitHttpClient - Refs Discovery Tests
// =============================================================================

describe('GitHttpClient - Refs Discovery', () => {
  let client: GitHttpClient

  beforeEach(() => {
    client = new GitHttpClient(MOCK_REPO_URL)
  })

  describe('GET /info/refs?service=git-upload-pack', () => {
    it('should fetch refs with correct URL and service parameter', async () => {
      const refs = await client.discoverRefs('upload-pack')

      expect(refs).toBeDefined()
      expect(refs.refs).toBeDefined()
      expect(Array.isArray(refs.refs)).toBe(true)
    })

    it('should parse refs advertisement response', async () => {
      const refs = await client.discoverRefs('upload-pack')

      expect(refs.refs.length).toBeGreaterThan(0)

      const headRef = refs.refs.find((r) => r.name === 'HEAD')
      expect(headRef).toBeDefined()
      expect(headRef?.oid).toBe('1234567890abcdef1234567890abcdef12345678')

      const mainRef = refs.refs.find((r) => r.name === 'refs/heads/main')
      expect(mainRef).toBeDefined()
      expect(mainRef?.oid).toBe('1234567890abcdef1234567890abcdef12345678')
    })

    it('should extract server capabilities from first line', async () => {
      const refs = await client.discoverRefs('upload-pack')

      expect(refs.capabilities).toBeDefined()
      expect(refs.capabilities.multiAck).toBe(true)
      expect(refs.capabilities.thinPack).toBe(true)
      expect(refs.capabilities.sideBand).toBe(true)
      expect(refs.capabilities.sideBand64k).toBe(true)
      expect(refs.capabilities.ofsDelta).toBe(true)
      expect(refs.capabilities.shallow).toBe(true)
      expect(refs.capabilities.noProgress).toBe(true)
      expect(refs.capabilities.includeTag).toBe(true)
    })

    it('should extract symref from capabilities', async () => {
      const refs = await client.discoverRefs('upload-pack')

      expect(refs.capabilities.symrefs).toBeDefined()
      expect(refs.capabilities.symrefs?.['HEAD']).toBe('refs/heads/main')
    })

    it('should extract agent version from capabilities', async () => {
      const refs = await client.discoverRefs('upload-pack')

      expect(refs.capabilities.agent).toBe('git/2.39.0')
    })

    it('should detect smart HTTP server', async () => {
      const refs = await client.discoverRefs('upload-pack')

      expect(refs.isSmartServer).toBe(true)
    })

    it('should include HEAD symbolic ref target', async () => {
      const refs = await client.discoverRefs('upload-pack')

      expect(refs.head).toBe('refs/heads/main')
    })
  })

  describe('Dumb HTTP fallback', () => {
    beforeEach(() => {
      server.use(
        http.get('https://github.com/test/repo.git/info/refs', () => {
          return new HttpResponse(MOCK_DUMB_REFS_RESPONSE, {
            headers: {
              'Content-Type': 'text/plain',
            },
          })
        })
      )
    })

    it('should detect dumb server from Content-Type', async () => {
      const refs = await client.discoverRefs('upload-pack')

      expect(refs.isSmartServer).toBe(false)
    })

    it('should parse dumb server refs format', async () => {
      const refs = await client.discoverRefs('upload-pack')

      expect(refs.refs).toHaveLength(2)

      const mainRef = refs.refs.find((r) => r.name === 'refs/heads/main')
      expect(mainRef).toBeDefined()
      expect(mainRef?.oid).toBe('1234567890abcdef1234567890abcdef12345678')
    })

    it('should return empty capabilities for dumb server', async () => {
      const refs = await client.discoverRefs('upload-pack')

      expect(refs.capabilities).toBeDefined()
      // Dumb servers don't advertise capabilities
      expect(Object.keys(refs.capabilities).length).toBe(0)
    })
  })

  describe('Error handling', () => {
    it('should handle 401 unauthorized', async () => {
      server.use(
        http.get('https://github.com/test/repo.git/info/refs', () => {
          return new HttpResponse('Unauthorized', {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Basic realm="GitHub"',
            },
          })
        })
      )

      await expect(client.discoverRefs('upload-pack')).rejects.toThrow('Authentication required')
    })

    it('should include WWW-Authenticate info in 401 error', async () => {
      server.use(
        http.get('https://github.com/test/repo.git/info/refs', () => {
          return new HttpResponse('Unauthorized', {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Basic realm="GitHub"',
            },
          })
        })
      )

      try {
        await client.discoverRefs('upload-pack')
        expect.fail('Should have thrown')
      } catch (error) {
        const httpError = error as GitHttpError
        expect(httpError.wwwAuthenticate).toBeDefined()
        expect(httpError.wwwAuthenticate?.scheme).toBe('Basic')
        expect(httpError.wwwAuthenticate?.realm).toBe('GitHub')
      }
    })

    it('should handle 404 not found', async () => {
      server.use(
        http.get('https://github.com/test/repo.git/info/refs', () => {
          return new HttpResponse('Not Found', { status: 404 })
        })
      )

      await expect(client.discoverRefs('upload-pack')).rejects.toThrow('Repository not found')
    })

    it('should handle redirect (301/302)', async () => {
      const redirectUrl = 'https://github.com/renamed/repo.git'

      server.use(
        http.get('https://github.com/test/repo.git/info/refs', () => {
          return new HttpResponse(null, {
            status: 301,
            headers: {
              Location: `${redirectUrl}/info/refs?service=git-upload-pack`,
            },
          })
        }),
        http.get(`${redirectUrl}/info/refs`, () => {
          return new HttpResponse(MOCK_REFS_RESPONSE, {
            headers: {
              'Content-Type': 'application/x-git-upload-pack-advertisement',
            },
          })
        })
      )

      const refs = await client.discoverRefs('upload-pack')

      expect(refs).toBeDefined()
      expect(refs.refs.length).toBeGreaterThan(0)
    })

    it('should limit redirect depth to prevent loops', async () => {
      server.use(
        http.get('https://github.com/test/repo.git/info/refs', () => {
          return new HttpResponse(null, {
            status: 301,
            headers: {
              Location: 'https://github.com/test/repo.git/info/refs?service=git-upload-pack',
            },
          })
        })
      )

      await expect(client.discoverRefs('upload-pack')).rejects.toThrow('Too many redirects')
    })

    it('should handle network errors', async () => {
      server.use(
        http.get('https://github.com/test/repo.git/info/refs', () => {
          return HttpResponse.error()
        })
      )

      await expect(client.discoverRefs('upload-pack')).rejects.toThrow()
    })

    it('should handle timeout', async () => {
      server.use(
        http.get('https://github.com/test/repo.git/info/refs', async () => {
          await new Promise((resolve) => setTimeout(resolve, 10000))
          return new HttpResponse(MOCK_REFS_RESPONSE)
        })
      )

      const timeoutClient = new GitHttpClient(MOCK_REPO_URL, {
        timeout: 100,
        retry: { maxRetries: 0 }, // Disable retries for timeout test
      })

      await expect(timeoutClient.discoverRefs('upload-pack')).rejects.toThrow('timed out')
    })
  })
})

// =============================================================================
// GitHttpClient - Upload-Pack (Fetch) Tests
// =============================================================================

describe('GitHttpClient - Upload-Pack (Fetch)', () => {
  let client: GitHttpClient

  beforeEach(() => {
    client = new GitHttpClient(MOCK_REPO_URL)
  })

  describe('POST /git-upload-pack', () => {
    it('should send request with correct content-type', async () => {
      let capturedContentType: string | null = null

      server.use(
        http.post('https://github.com/test/repo.git/git-upload-pack', async ({ request }) => {
          capturedContentType = request.headers.get('Content-Type')
          return new HttpResponse(MOCK_PACKFILE, {
            headers: { 'Content-Type': 'application/x-git-upload-pack-result' },
          })
        })
      )

      await client.uploadPack({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
        haves: [],
      })

      expect(capturedContentType).toBe('application/x-git-upload-pack-request')
    })

    it('should send want lines for requested objects', async () => {
      let capturedBody: string | null = null

      server.use(
        http.post('https://github.com/test/repo.git/git-upload-pack', async ({ request }) => {
          capturedBody = await request.text()
          return new HttpResponse(MOCK_PACKFILE, {
            headers: { 'Content-Type': 'application/x-git-upload-pack-result' },
          })
        })
      )

      await client.uploadPack({
        wants: ['1234567890abcdef1234567890abcdef12345678', 'abcdef1234567890abcdef1234567890abcdef12'],
        haves: [],
      })

      expect(capturedBody).toContain('want 1234567890abcdef1234567890abcdef12345678')
      expect(capturedBody).toContain('want abcdef1234567890abcdef1234567890abcdef12')
    })

    it('should send have lines for common ancestors', async () => {
      let capturedBody: string | null = null

      server.use(
        http.post('https://github.com/test/repo.git/git-upload-pack', async ({ request }) => {
          capturedBody = await request.text()
          return new HttpResponse(MOCK_PACKFILE, {
            headers: { 'Content-Type': 'application/x-git-upload-pack-result' },
          })
        })
      )

      await client.uploadPack({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
        haves: ['deadbeef1234567890abcdef1234567890abcdef', 'cafebabe1234567890abcdef1234567890abcdef'],
      })

      expect(capturedBody).toContain('have deadbeef1234567890abcdef1234567890abcdef')
      expect(capturedBody).toContain('have cafebabe1234567890abcdef1234567890abcdef')
    })

    it('should send done line to terminate negotiation', async () => {
      let capturedBody: string | null = null

      server.use(
        http.post('https://github.com/test/repo.git/git-upload-pack', async ({ request }) => {
          capturedBody = await request.text()
          return new HttpResponse(MOCK_PACKFILE, {
            headers: { 'Content-Type': 'application/x-git-upload-pack-result' },
          })
        })
      )

      await client.uploadPack({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
        haves: [],
        done: true,
      })

      expect(capturedBody).toContain('done')
    })

    it('should include capabilities with first want line', async () => {
      let capturedBody: string | null = null

      server.use(
        http.post('https://github.com/test/repo.git/git-upload-pack', async ({ request }) => {
          capturedBody = await request.text()
          return new HttpResponse(MOCK_PACKFILE, {
            headers: { 'Content-Type': 'application/x-git-upload-pack-result' },
          })
        })
      )

      await client.uploadPack({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
        haves: [],
        capabilities: ['multi_ack', 'thin-pack', 'side-band-64k', 'ofs-delta'],
      })

      // First want line should include capabilities
      expect(capturedBody).toMatch(/want 1234567890abcdef1234567890abcdef12345678.*multi_ack/)
    })

    it('should receive packfile in response', async () => {
      const response = await client.uploadPack({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
        haves: [],
      })

      expect(response.packfile).toBeDefined()
      expect(response.packfile).toBeInstanceOf(Uint8Array)
      expect(response.packfile.length).toBeGreaterThan(0)
    })

    it('should verify packfile starts with PACK signature', async () => {
      const response = await client.uploadPack({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
        haves: [],
      })

      // PACK signature: 0x50 0x41 0x43 0x4B
      expect(response.packfile[0]).toBe(0x50) // P
      expect(response.packfile[1]).toBe(0x41) // A
      expect(response.packfile[2]).toBe(0x43) // C
      expect(response.packfile[3]).toBe(0x4b) // K
    })

    it('should handle side-band demultiplexing', async () => {
      const sideBandResponse = new Uint8Array([
        // Sideband channel 1 (packfile data)
        0x30, 0x30, 0x31, 0x30, // length: 0010
        0x01, // channel 1
        0x50, 0x41, 0x43, 0x4b, // PACK...
        // Sideband channel 2 (progress)
        0x30, 0x30, 0x31, 0x35, // length: 0015
        0x02, // channel 2
        ...new TextEncoder().encode('Counting objects'),
        // Flush
        0x30, 0x30, 0x30, 0x30, // 0000
      ])

      server.use(
        http.post('https://github.com/test/repo.git/git-upload-pack', () => {
          return new HttpResponse(sideBandResponse, {
            headers: { 'Content-Type': 'application/x-git-upload-pack-result' },
          })
        })
      )

      const response = await client.uploadPack({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
        haves: [],
        capabilities: ['side-band-64k'],
      })

      expect(response.packfile).toBeDefined()
      expect(response.progress).toBeDefined()
      expect(response.progress).toContain('Counting objects')
    })

    it('should handle chunked transfer encoding', async () => {
      // Simulate chunked response by returning response in multiple parts
      const stream = new ReadableStream({
        start(controller) {
          // First chunk - PACK header
          controller.enqueue(new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0x00, 0x00, 0x00, 0x02]))
          // Second chunk - object count
          controller.enqueue(new Uint8Array([0x00, 0x00, 0x00, 0x01]))
          controller.close()
        },
      })

      server.use(
        http.post('https://github.com/test/repo.git/git-upload-pack', () => {
          return new HttpResponse(stream, {
            headers: {
              'Content-Type': 'application/x-git-upload-pack-result',
              'Transfer-Encoding': 'chunked',
            },
          })
        })
      )

      const response = await client.uploadPack({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
        haves: [],
      })

      expect(response.packfile).toBeDefined()
      // Verify the complete pack was assembled from chunks
      expect(response.packfile.length).toBe(12) // 8 + 4 bytes
    })

    it('should support shallow fetch with depth', async () => {
      let capturedBody: string | null = null

      server.use(
        http.post('https://github.com/test/repo.git/git-upload-pack', async ({ request }) => {
          capturedBody = await request.text()
          return new HttpResponse(MOCK_PACKFILE, {
            headers: { 'Content-Type': 'application/x-git-upload-pack-result' },
          })
        })
      )

      await client.uploadPack({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
        haves: [],
        depth: 1,
      })

      expect(capturedBody).toContain('deepen 1')
    })

    it('should support deepen-since for time-based shallow', async () => {
      let capturedBody: string | null = null
      const since = new Date('2024-01-01T00:00:00Z')

      server.use(
        http.post('https://github.com/test/repo.git/git-upload-pack', async ({ request }) => {
          capturedBody = await request.text()
          return new HttpResponse(MOCK_PACKFILE, {
            headers: { 'Content-Type': 'application/x-git-upload-pack-result' },
          })
        })
      )

      await client.uploadPack({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
        haves: [],
        deepenSince: since,
      })

      expect(capturedBody).toContain('deepen-since')
      expect(capturedBody).toContain(String(Math.floor(since.getTime() / 1000)))
    })
  })
})

// =============================================================================
// GitHttpClient - Receive-Pack (Push) Tests
// =============================================================================

describe('GitHttpClient - Receive-Pack (Push)', () => {
  let client: GitHttpClient

  beforeEach(() => {
    client = new GitHttpClient(MOCK_REPO_URL)
  })

  describe('POST /git-receive-pack', () => {
    it('should send request with correct content-type', async () => {
      let capturedContentType: string | null = null

      server.use(
        http.post('https://github.com/test/repo.git/git-receive-pack', async ({ request }) => {
          capturedContentType = request.headers.get('Content-Type')
          return new HttpResponse('000eunpack ok\n0000', {
            headers: { 'Content-Type': 'application/x-git-receive-pack-result' },
          })
        })
      )

      await client.receivePack({
        updates: [
          {
            ref: 'refs/heads/main',
            oldOid: '0000000000000000000000000000000000000000',
            newOid: '1234567890abcdef1234567890abcdef12345678',
          },
        ],
        packfile: MOCK_PACKFILE,
      })

      expect(capturedContentType).toBe('application/x-git-receive-pack-request')
    })

    it('should send ref update lines', async () => {
      let capturedBody: ArrayBuffer | null = null

      server.use(
        http.post('https://github.com/test/repo.git/git-receive-pack', async ({ request }) => {
          capturedBody = await request.arrayBuffer()
          return new HttpResponse('000eunpack ok\n0019ok refs/heads/main\n0000', {
            headers: { 'Content-Type': 'application/x-git-receive-pack-result' },
          })
        })
      )

      await client.receivePack({
        updates: [
          {
            ref: 'refs/heads/main',
            oldOid: 'deadbeef1234567890abcdef1234567890abcdef',
            newOid: '1234567890abcdef1234567890abcdef12345678',
          },
        ],
        packfile: MOCK_PACKFILE,
      })

      const bodyText = new TextDecoder().decode(capturedBody!)
      expect(bodyText).toContain('deadbeef1234567890abcdef1234567890abcdef')
      expect(bodyText).toContain('1234567890abcdef1234567890abcdef12345678')
      expect(bodyText).toContain('refs/heads/main')
    })

    it('should send packfile after ref updates', async () => {
      let capturedBody: ArrayBuffer | null = null

      server.use(
        http.post('https://github.com/test/repo.git/git-receive-pack', async ({ request }) => {
          capturedBody = await request.arrayBuffer()
          return new HttpResponse('000eunpack ok\n0000', {
            headers: { 'Content-Type': 'application/x-git-receive-pack-result' },
          })
        })
      )

      await client.receivePack({
        updates: [
          {
            ref: 'refs/heads/main',
            oldOid: '0000000000000000000000000000000000000000',
            newOid: '1234567890abcdef1234567890abcdef12345678',
          },
        ],
        packfile: MOCK_PACKFILE,
      })

      const bodyBytes = new Uint8Array(capturedBody!)
      // Packfile should be present and contain PACK signature
      const packIndex = bodyBytes.findIndex(
        (_, i) =>
          bodyBytes[i] === 0x50 &&
          bodyBytes[i + 1] === 0x41 &&
          bodyBytes[i + 2] === 0x43 &&
          bodyBytes[i + 3] === 0x4b
      )
      expect(packIndex).toBeGreaterThan(0)
    })

    it('should parse server response for successful push', async () => {
      server.use(
        http.post('https://github.com/test/repo.git/git-receive-pack', () => {
          return new HttpResponse('000eunpack ok\n0019ok refs/heads/main\n0000', {
            headers: { 'Content-Type': 'application/x-git-receive-pack-result' },
          })
        })
      )

      const response = await client.receivePack({
        updates: [
          {
            ref: 'refs/heads/main',
            oldOid: '0000000000000000000000000000000000000000',
            newOid: '1234567890abcdef1234567890abcdef12345678',
          },
        ],
        packfile: MOCK_PACKFILE,
      })

      expect(response.unpackOk).toBe(true)
      expect(response.results).toHaveLength(1)
      expect(response.results[0].ref).toBe('refs/heads/main')
      expect(response.results[0].ok).toBe(true)
    })

    it('should parse server response for rejected ref', async () => {
      server.use(
        http.post('https://github.com/test/repo.git/git-receive-pack', () => {
          return new HttpResponse(
            '000eunpack ok\n0033ng refs/heads/main non-fast-forward\n0000',
            {
              headers: { 'Content-Type': 'application/x-git-receive-pack-result' },
            }
          )
        })
      )

      const response = await client.receivePack({
        updates: [
          {
            ref: 'refs/heads/main',
            oldOid: 'deadbeef1234567890abcdef1234567890abcdef',
            newOid: '1234567890abcdef1234567890abcdef12345678',
          },
        ],
        packfile: MOCK_PACKFILE,
      })

      expect(response.unpackOk).toBe(true)
      expect(response.results).toHaveLength(1)
      expect(response.results[0].ref).toBe('refs/heads/main')
      expect(response.results[0].ok).toBe(false)
      expect(response.results[0].error).toBe('non-fast-forward')
    })

    it('should parse unpack failure', async () => {
      server.use(
        http.post('https://github.com/test/repo.git/git-receive-pack', () => {
          return new HttpResponse('0019unpack unpack failed\n0000', {
            headers: { 'Content-Type': 'application/x-git-receive-pack-result' },
          })
        })
      )

      const response = await client.receivePack({
        updates: [
          {
            ref: 'refs/heads/main',
            oldOid: '0000000000000000000000000000000000000000',
            newOid: '1234567890abcdef1234567890abcdef12345678',
          },
        ],
        packfile: MOCK_PACKFILE,
      })

      expect(response.unpackOk).toBe(false)
      expect(response.unpackError).toBe('unpack failed')
    })

    it('should handle multiple ref updates', async () => {
      server.use(
        http.post('https://github.com/test/repo.git/git-receive-pack', async ({ request }) => {
          await request.arrayBuffer() // consume body
          return new HttpResponse(
            '000eunpack ok\n0019ok refs/heads/main\n001cok refs/heads/feature\n0000',
            {
              headers: { 'Content-Type': 'application/x-git-receive-pack-result' },
            }
          )
        })
      )

      const response = await client.receivePack({
        updates: [
          {
            ref: 'refs/heads/main',
            oldOid: 'deadbeef1234567890abcdef1234567890abcdef',
            newOid: '1234567890abcdef1234567890abcdef12345678',
          },
          {
            ref: 'refs/heads/feature',
            oldOid: '0000000000000000000000000000000000000000',
            newOid: 'abcdef1234567890abcdef1234567890abcdef12',
          },
        ],
        packfile: MOCK_PACKFILE,
      })

      expect(response.results).toHaveLength(2)
      expect(response.results[0].ok).toBe(true)
      expect(response.results[1].ok).toBe(true)
    })

    it('should handle ref deletion (newOid all zeros)', async () => {
      let capturedBody: string | null = null

      server.use(
        http.post('https://github.com/test/repo.git/git-receive-pack', async ({ request }) => {
          capturedBody = new TextDecoder().decode(await request.arrayBuffer())
          return new HttpResponse('000eunpack ok\n0019ok refs/heads/old\n0000', {
            headers: { 'Content-Type': 'application/x-git-receive-pack-result' },
          })
        })
      )

      await client.receivePack({
        updates: [
          {
            ref: 'refs/heads/old',
            oldOid: '1234567890abcdef1234567890abcdef12345678',
            newOid: '0000000000000000000000000000000000000000',
          },
        ],
        // No packfile needed for deletion
      })

      expect(capturedBody).toContain('0000000000000000000000000000000000000000')
    })

    it('should include report-status capability', async () => {
      let capturedBody: string | null = null

      server.use(
        http.post('https://github.com/test/repo.git/git-receive-pack', async ({ request }) => {
          capturedBody = new TextDecoder().decode(await request.arrayBuffer())
          return new HttpResponse('000eunpack ok\n0000', {
            headers: { 'Content-Type': 'application/x-git-receive-pack-result' },
          })
        })
      )

      await client.receivePack({
        updates: [
          {
            ref: 'refs/heads/main',
            oldOid: '0000000000000000000000000000000000000000',
            newOid: '1234567890abcdef1234567890abcdef12345678',
          },
        ],
        packfile: MOCK_PACKFILE,
        capabilities: ['report-status', 'side-band-64k'],
      })

      // First line should contain capabilities
      expect(capturedBody).toContain('report-status')
    })
  })
})

// =============================================================================
// Authentication Tests
// =============================================================================

describe('GitAuth - Authentication', () => {
  describe('createAuthHeader', () => {
    it('should create Bearer token header', () => {
      const header = createAuthHeader({
        method: 'bearer',
        token: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      })

      expect(header).toBe('Bearer ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
    })

    it('should create Basic auth header from user:pass', () => {
      const header = createAuthHeader({
        method: 'basic',
        username: 'user',
        password: 'pass123',
      })

      // Base64 of "user:pass123"
      const expected = 'Basic ' + btoa('user:pass123')
      expect(header).toBe(expected)
    })

    it('should handle special characters in password', () => {
      const header = createAuthHeader({
        method: 'basic',
        username: 'user',
        password: 'p@ss:word!',
      })

      const expected = 'Basic ' + btoa('user:p@ss:word!')
      expect(header).toBe(expected)
    })

    it('should handle empty password (token as username)', () => {
      // GitHub allows token as username with empty password
      const header = createAuthHeader({
        method: 'basic',
        username: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        password: '',
      })

      const expected = 'Basic ' + btoa('ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx:')
      expect(header).toBe(expected)
    })
  })

  describe('getTokenFromEnv', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should read GITHUB_TOKEN from environment', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token_123'

      const token = getTokenFromEnv('github.com')

      expect(token).toBe('ghp_test_token_123')
    })

    it('should read GH_TOKEN as fallback', () => {
      process.env.GH_TOKEN = 'gh_token_456'

      const token = getTokenFromEnv('github.com')

      expect(token).toBe('gh_token_456')
    })

    it('should prefer GITHUB_TOKEN over GH_TOKEN', () => {
      process.env.GITHUB_TOKEN = 'primary_token'
      process.env.GH_TOKEN = 'fallback_token'

      const token = getTokenFromEnv('github.com')

      expect(token).toBe('primary_token')
    })

    it('should read GITLAB_TOKEN for GitLab hosts', () => {
      process.env.GITLAB_TOKEN = 'glpat-xxxx'

      const token = getTokenFromEnv('gitlab.com')

      expect(token).toBe('glpat-xxxx')
    })

    it('should read BITBUCKET_TOKEN for Bitbucket hosts', () => {
      process.env.BITBUCKET_TOKEN = 'bb_token'

      const token = getTokenFromEnv('bitbucket.org')

      expect(token).toBe('bb_token')
    })

    it('should return undefined if no token found', () => {
      delete process.env.GITHUB_TOKEN
      delete process.env.GH_TOKEN

      const token = getTokenFromEnv('github.com')

      expect(token).toBeUndefined()
    })

    it('should support custom env var name', () => {
      process.env.MY_GIT_TOKEN = 'custom_token'

      const token = getTokenFromEnv('custom.git.example.com.ai', 'MY_GIT_TOKEN')

      expect(token).toBe('custom_token')
    })
  })

  describe('parseWwwAuthenticate', () => {
    it('should parse Basic realm', () => {
      const result = parseWwwAuthenticate('Basic realm="GitHub"')

      expect(result.scheme).toBe('Basic')
      expect(result.realm).toBe('GitHub')
    })

    it('should parse Bearer with error', () => {
      const result = parseWwwAuthenticate(
        'Bearer realm="api.github.com", error="invalid_token", error_description="The token has expired"'
      )

      expect(result.scheme).toBe('Bearer')
      expect(result.realm).toBe('api.github.com')
      expect(result.error).toBe('invalid_token')
      expect(result.errorDescription).toBe('The token has expired')
    })

    it('should handle multiple auth methods', () => {
      const result = parseWwwAuthenticate('Basic realm="Git", Bearer')

      expect(result.schemes).toContain('Basic')
      expect(result.schemes).toContain('Bearer')
    })
  })

  describe('HTTP client with authentication', () => {
    let client: GitHttpClient

    beforeEach(() => {
      client = new GitHttpClient(MOCK_REPO_URL)
    })

    it('should add Authorization header for token auth', async () => {
      let capturedAuth: string | null = null

      server.use(
        http.get('https://github.com/test/repo.git/info/refs', async ({ request }) => {
          capturedAuth = request.headers.get('Authorization')
          return new HttpResponse(MOCK_REFS_RESPONSE, {
            headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
          })
        })
      )

      const authedClient = new GitHttpClient(MOCK_REPO_URL, {
        auth: {
          method: 'bearer',
          token: 'ghp_test_token',
        },
      })

      await authedClient.discoverRefs('upload-pack')

      expect(capturedAuth).toBe('Bearer ghp_test_token')
    })

    it('should add Basic auth header', async () => {
      let capturedAuth: string | null = null

      server.use(
        http.get('https://github.com/test/repo.git/info/refs', async ({ request }) => {
          capturedAuth = request.headers.get('Authorization')
          return new HttpResponse(MOCK_REFS_RESPONSE, {
            headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
          })
        })
      )

      const authedClient = new GitHttpClient(MOCK_REPO_URL, {
        auth: {
          method: 'basic',
          username: 'user',
          password: 'pass',
        },
      })

      await authedClient.discoverRefs('upload-pack')

      expect(capturedAuth).toBe('Basic ' + btoa('user:pass'))
    })

    it('should handle 401 with helpful error message', async () => {
      server.use(
        http.get('https://github.com/test/repo.git/info/refs', () => {
          return new HttpResponse('Bad credentials', {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Basic realm="GitHub"',
            },
          })
        })
      )

      try {
        await client.discoverRefs('upload-pack')
        expect.fail('Should have thrown')
      } catch (error) {
        const httpError = error as GitHttpError
        expect(httpError.message).toContain('Authentication required')
        expect(httpError.message).toContain('github.com')
        expect(httpError.hint).toContain('GITHUB_TOKEN')
      }
    })

    it('should handle 403 rate limiting', async () => {
      server.use(
        http.get('https://github.com/test/repo.git/info/refs', () => {
          return new HttpResponse('Rate limit exceeded', {
            status: 403,
            headers: {
              'X-RateLimit-Limit': '60',
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
            },
          })
        })
      )

      // Use client with retries disabled to test error handling
      const rateLimitClient = new GitHttpClient(MOCK_REPO_URL, {
        retry: { maxRetries: 0, waitForRateLimit: false },
      })

      try {
        await rateLimitClient.discoverRefs('upload-pack')
        expect.fail('Should have thrown')
      } catch (error) {
        const httpError = error as GitHttpError
        expect(httpError.message).toContain('Rate limit exceeded')
        expect(httpError.rateLimit).toBeDefined()
        expect(httpError.rateLimit?.remaining).toBe(0)
        expect(httpError.rateLimit?.resetAt).toBeInstanceOf(Date)
      }
    })

    it('should detect token expiry from 401 response', async () => {
      server.use(
        http.get('https://github.com/test/repo.git/info/refs', () => {
          return new HttpResponse('Token expired', {
            status: 401,
            headers: {
              'WWW-Authenticate':
                'Bearer realm="api.github.com", error="invalid_token", error_description="The token has expired"',
            },
          })
        })
      )

      const authedClient = new GitHttpClient(MOCK_REPO_URL, {
        auth: { method: 'bearer', token: 'expired_token' },
      })

      try {
        await authedClient.discoverRefs('upload-pack')
        expect.fail('Should have thrown')
      } catch (error) {
        const httpError = error as GitHttpError
        expect(httpError.tokenExpired).toBe(true)
        expect(httpError.message).toContain('token has expired')
      }
    })

    it('should retry with auth after initial 401', async () => {
      let requestCount = 0

      server.use(
        http.get('https://github.com/test/repo.git/info/refs', async ({ request }) => {
          requestCount++
          const auth = request.headers.get('Authorization')

          if (!auth) {
            return new HttpResponse('Unauthorized', {
              status: 401,
              headers: { 'WWW-Authenticate': 'Basic realm="GitHub"' },
            })
          }

          return new HttpResponse(MOCK_REFS_RESPONSE, {
            headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
          })
        })
      )

      // Client with auth provider that returns credentials on demand
      const clientWithAuthProvider = new GitHttpClient(MOCK_REPO_URL, {
        authProvider: async () => ({
          method: 'basic',
          username: 'user',
          password: 'pass',
        }),
      })

      const refs = await clientWithAuthProvider.discoverRefs('upload-pack')

      // May be 2 or 3 requests depending on protocol v2 negotiation
      expect(requestCount).toBeGreaterThanOrEqual(2)
      expect(refs.refs.length).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// GitAuth Class Tests
// =============================================================================

describe('GitAuth Class', () => {
  it('should create instance with token', () => {
    const auth = new GitAuth({ token: 'test_token' })

    expect(auth.hasCredentials()).toBe(true)
  })

  it('should create instance with username/password', () => {
    const auth = new GitAuth({ username: 'user', password: 'pass' })

    expect(auth.hasCredentials()).toBe(true)
  })

  it('should create instance from environment', () => {
    const originalEnv = process.env
    process.env = { ...originalEnv, GITHUB_TOKEN: 'env_token' }

    const auth = GitAuth.fromEnv('github.com')

    expect(auth.hasCredentials()).toBe(true)

    process.env = originalEnv
  })

  it('should return auth header', () => {
    const auth = new GitAuth({ token: 'bearer_token' })

    expect(auth.getHeader()).toBe('Bearer bearer_token')
  })

  it('should detect token type from prefix', () => {
    const ghpAuth = new GitAuth({ token: 'ghp_xxxx' })
    expect(ghpAuth.getTokenType()).toBe('github-pat')

    const ghoAuth = new GitAuth({ token: 'gho_xxxx' })
    expect(ghoAuth.getTokenType()).toBe('github-oauth')

    const glpatAuth = new GitAuth({ token: 'glpat-xxxx' })
    expect(glpatAuth.getTokenType()).toBe('gitlab-pat')
  })

  it('should support credential caching', () => {
    const auth = new GitAuth({ token: 'cached_token' })

    // Store credentials for a host
    auth.cacheFor('github.com', 3600)

    // Later retrieval
    const cached = GitAuth.getCached('github.com')
    expect(cached?.getHeader()).toBe('Bearer cached_token')
  })

  it('should expire cached credentials', async () => {
    const auth = new GitAuth({ token: 'short_lived' })
    auth.cacheFor('example.com.ai', 0.001) // 1ms TTL

    await new Promise((resolve) => setTimeout(resolve, 10))

    const cached = GitAuth.getCached('example.com.ai')
    expect(cached).toBeUndefined()
  })
})

// =============================================================================
// Edge Cases and Protocol Details
// =============================================================================

describe('Protocol Edge Cases', () => {
  let client: GitHttpClient

  beforeEach(() => {
    client = new GitHttpClient(MOCK_REPO_URL)
  })

  it('should handle empty repository (no refs)', async () => {
    server.use(
      http.get('https://github.com/test/repo.git/info/refs', () => {
        // Empty repo response - just the service announcement and flush
        return new HttpResponse('001e# service=git-upload-pack\n0000', {
          headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        })
      })
    )

    const refs = await client.discoverRefs('upload-pack')

    expect(refs.refs).toHaveLength(0)
    expect(refs.isEmpty).toBe(true)
  })

  it('should handle peeled tag refs', async () => {
    const refsWithPeeled = `001e# service=git-upload-pack
0000003fabcdef1234567890abcdef1234567890abcdef1234 refs/tags/v1.0.0
003dabcdef1234567890abcdef1234567890abcdef1234^{}
0000`

    server.use(
      http.get('https://github.com/test/repo.git/info/refs', () => {
        return new HttpResponse(refsWithPeeled, {
          headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        })
      })
    )

    const refs = await client.discoverRefs('upload-pack')

    const tagRef = refs.refs.find((r) => r.name === 'refs/tags/v1.0.0')
    expect(tagRef).toBeDefined()
    expect(tagRef?.peeled).toBe('abcdef1234567890abcdef1234567890abcdef1234')
  })

  it('should use correct service for receive-pack discovery', async () => {
    let capturedService: string | null = null

    server.use(
      http.get('https://github.com/test/repo.git/info/refs', ({ request }) => {
        const url = new URL(request.url)
        capturedService = url.searchParams.get('service')
        return new HttpResponse('001e# service=git-receive-pack\n0000', {
          headers: { 'Content-Type': 'application/x-git-receive-pack-advertisement' },
        })
      })
    )

    await client.discoverRefs('receive-pack')

    expect(capturedService).toBe('git-receive-pack')
  })

  it('should handle git:// URL conversion to https', () => {
    const gitClient = new GitHttpClient('git://github.com/test/repo.git')

    expect(gitClient.httpsUrl).toBe('https://github.com/test/repo.git')
  })

  it('should handle SSH URL conversion', () => {
    const sshClient = new GitHttpClient('git@github.com:test/repo.git')

    expect(sshClient.httpsUrl).toBe('https://github.com/test/repo.git')
  })

  it('should strip .git suffix if not present', () => {
    const client1 = new GitHttpClient('https://github.com/test/repo')
    const client2 = new GitHttpClient('https://github.com/test/repo.git')

    expect(client1.repoPath).toBe('/test/repo')
    expect(client2.repoPath).toBe('/test/repo')
  })

  it('should add User-Agent header', async () => {
    let capturedUserAgent: string | null = null

    server.use(
      http.get('https://github.com/test/repo.git/info/refs', async ({ request }) => {
        capturedUserAgent = request.headers.get('User-Agent')
        return new HttpResponse(MOCK_REFS_RESPONSE, {
          headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        })
      })
    )

    await client.discoverRefs('upload-pack')

    expect(capturedUserAgent).toContain('git/')
  })

  it('should support custom User-Agent', async () => {
    let capturedUserAgent: string | null = null

    server.use(
      http.get('https://github.com/test/repo.git/info/refs', async ({ request }) => {
        capturedUserAgent = request.headers.get('User-Agent')
        return new HttpResponse(MOCK_REFS_RESPONSE, {
          headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        })
      })
    )

    const customClient = new GitHttpClient(MOCK_REPO_URL, {
      userAgent: 'my-app/1.0.0',
    })

    await customClient.discoverRefs('upload-pack')

    expect(capturedUserAgent).toBe('my-app/1.0.0')
  })
})
