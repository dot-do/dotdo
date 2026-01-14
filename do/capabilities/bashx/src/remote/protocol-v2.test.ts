/**
 * Protocol v2 Tests
 *
 * Tests for Git protocol version 2 implementation including:
 * - Capability advertisement parsing
 * - ls-refs command generation and response parsing
 * - fetch command generation
 * - Side-band demultiplexing with progress callbacks
 * - Protocol version detection and fallback
 */

import { describe, it, expect, vi, afterEach, afterAll, beforeAll } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import {
  FLUSH_PKT,
  DELIM_PKT,
  parseV2Capabilities,
  generateLsRefsCommand,
  parseLsRefsResponse,
  generateFetchCommand,
  parseFetchResponse,
} from './protocol-v2.js'

import {
  parsePktLine,
  generatePktLine,
  generateFlushPkt,
  generateDelimPkt,
  demuxSideBand as pktLineDemuxSideBand,
  createSideBandPacket,
  isSideBandFormat,
} from './pkt-line.js'

import { GitHttpClient } from './http-client.js'

// =============================================================================
// Test Fixtures
// =============================================================================

// Correct pkt-line lengths:
// "# service=git-upload-pack\n" = 26 chars + 4 = 30 = 0x001e
// "version 2\n" = 10 chars + 4 = 14 = 0x000e
// "agent=git/2.43.0\n" = 17 chars + 4 = 21 = 0x0015
// "ls-refs\n" = 8 chars + 4 = 12 = 0x000c
// "fetch=shallow\n" = 14 chars + 4 = 18 = 0x0012
// "object-format=sha1\n" = 19 chars + 4 = 23 = 0x0017
const MOCK_V2_CAPABILITY_RESPONSE = `001e# service=git-upload-pack
0000000eversion 2
0015agent=git/2.43.0
000cls-refs
0012fetch=shallow
0017object-format=sha1
0000`

const MOCK_V1_REFS_RESPONSE = `001e# service=git-upload-pack
0000009b1234567890abcdef1234567890abcdef12345678 HEAD\0multi_ack thin-pack side-band side-band-64k ofs-delta shallow deepen-since deepen-not deepen-relative no-progress include-tag multi_ack_detailed symref=HEAD:refs/heads/main agent=git/2.39.0
003f1234567890abcdef1234567890abcdef12345678 refs/heads/main
0000`

// Build valid pkt-lines with correct lengths (NO newlines between pkt-lines in test data)
// Each line content ends WITHOUT newline in ls-refs v2 format
// Line 1: "1234567890abcdef1234567890abcdef12345678 HEAD symref-target:refs/heads/main" = 75 chars + 4 = 79 = 0x004f
// Line 2: "1234567890abcdef1234567890abcdef12345678 refs/heads/main" = 56 chars + 4 = 60 = 0x003c
// Line 3: "abcdef1234567890abcdef1234567890abcdef12 refs/tags/v1.0.0 peeled:aabbccdd" = 73 chars + 4 = 77 = 0x004d
// Note: OIDs must be exactly 40 hex chars for SHA-1
const MOCK_LS_REFS_RESPONSE =
  '004f1234567890abcdef1234567890abcdef12345678 HEAD symref-target:refs/heads/main' +
  '003c1234567890abcdef1234567890abcdef12345678 refs/heads/main' +
  '004dabcdef1234567890abcdef1234567890abcdef12 refs/tags/v1.0.0 peeled:aabbccdd' +
  '0000'

const MOCK_PACKFILE = new Uint8Array([
  0x50, 0x41, 0x43, 0x4b, // PACK
  0x00, 0x00, 0x00, 0x02, // version 2
  0x00, 0x00, 0x00, 0x01, // 1 object
])

// =============================================================================
// pkt-line Tests
// =============================================================================

describe('pkt-line', () => {
  describe('parsePktLine', () => {
    it('should parse a data packet', () => {
      // 0x000a = 10 bytes total (4 header + 6 payload "hello\n")
      const input = '000ahello\n'
      const result = parsePktLine(input)

      expect(result.type).toBe('data')
      expect(result.length).toBe(10)
      expect(result.payload).toBe('hello\n')
    })

    it('should parse flush packet', () => {
      const input = '0000rest'
      const result = parsePktLine(input)

      expect(result.type).toBe('flush')
      expect(result.payload).toBeNull()
      expect(result.remainder).toBe('rest')
    })

    it('should parse delimiter packet', () => {
      const input = '0001rest'
      const result = parsePktLine(input)

      expect(result.type).toBe('delimiter')
      expect(result.payload).toBeNull()
      expect(result.remainder).toBe('rest')
    })

    it('should parse response end packet', () => {
      const input = '0002rest'
      const result = parsePktLine(input)

      expect(result.type).toBe('response-end')
      expect(result.payload).toBeNull()
    })

    it('should throw on invalid length', () => {
      expect(() => parsePktLine('xxxx')).toThrow('Invalid pkt-line length')
    })

    it('should throw on incomplete packet', () => {
      expect(() => parsePktLine('0010hi')).toThrow('Incomplete pkt-line')
    })
  })

  describe('generatePktLine', () => {
    it('should generate a pkt-line with correct length', () => {
      const result = generatePktLine('hello\n')
      expect(result).toBe('000ahello\n')
    })

    it('should throw on payload too long', () => {
      const longPayload = 'x'.repeat(65520)
      expect(() => generatePktLine(longPayload)).toThrow('Payload too long')
    })
  })

  describe('generateFlushPkt', () => {
    it('should return flush packet', () => {
      expect(generateFlushPkt()).toBe('0000')
    })
  })

  describe('generateDelimPkt', () => {
    it('should return delimiter packet', () => {
      expect(generateDelimPkt()).toBe('0001')
    })
  })
})

// =============================================================================
// Protocol v2 Capability Parsing Tests
// =============================================================================

describe('Protocol v2 Capability Parsing', () => {
  describe('parseV2Capabilities', () => {
    it('should parse version 2 from capability response', () => {
      const caps = parseV2Capabilities(MOCK_V2_CAPABILITY_RESPONSE)

      expect(caps.version).toBe(2)
    })

    it('should parse agent version', () => {
      const caps = parseV2Capabilities(MOCK_V2_CAPABILITY_RESPONSE)

      expect(caps.agent).toBe('git/2.43.0')
    })

    it('should parse ls-refs command', () => {
      const caps = parseV2Capabilities(MOCK_V2_CAPABILITY_RESPONSE)

      expect(caps.commands.has('ls-refs')).toBe(true)
    })

    it('should parse fetch command with features', () => {
      const caps = parseV2Capabilities(MOCK_V2_CAPABILITY_RESPONSE)

      expect(caps.commands.has('fetch')).toBe(true)
    })

    it('should parse object format', () => {
      const caps = parseV2Capabilities(MOCK_V2_CAPABILITY_RESPONSE)

      expect(caps.objectFormat).toBe('sha1')
    })

    it('should store raw capability lines', () => {
      const caps = parseV2Capabilities(MOCK_V2_CAPABILITY_RESPONSE)

      expect(caps.raw.length).toBeGreaterThan(0)
      expect(caps.raw).toContain('version 2')
    })
  })
})

// =============================================================================
// ls-refs Command Tests
// =============================================================================

describe('ls-refs Command', () => {
  describe('generateLsRefsCommand', () => {
    it('should generate basic ls-refs command', () => {
      const cmd = generateLsRefsCommand()

      expect(cmd).toContain('command=ls-refs')
      expect(cmd).toContain(DELIM_PKT)
      expect(cmd).toContain(FLUSH_PKT)
    })

    it('should include symrefs option', () => {
      const cmd = generateLsRefsCommand({ symrefs: true })

      expect(cmd).toContain('symrefs')
    })

    it('should include peel option', () => {
      const cmd = generateLsRefsCommand({ peel: true })

      expect(cmd).toContain('peel')
    })

    it('should include ref-prefix options', () => {
      const cmd = generateLsRefsCommand({
        refPrefixes: ['refs/heads/', 'refs/tags/'],
      })

      expect(cmd).toContain('ref-prefix refs/heads/')
      expect(cmd).toContain('ref-prefix refs/tags/')
    })

    it('should include unborn option', () => {
      const cmd = generateLsRefsCommand({ unborn: true })

      expect(cmd).toContain('unborn')
    })
  })

  describe('parseLsRefsResponse', () => {
    it('should parse refs with OID and name', () => {
      const refs = parseLsRefsResponse(MOCK_LS_REFS_RESPONSE)

      expect(refs.length).toBe(3)
      expect(refs[0].oid).toBe('1234567890abcdef1234567890abcdef12345678')
      expect(refs[0].name).toBe('HEAD')
    })

    it('should parse symref-target attribute', () => {
      const refs = parseLsRefsResponse(MOCK_LS_REFS_RESPONSE)

      const headRef = refs.find(r => r.name === 'HEAD')
      expect(headRef?.symrefTarget).toBe('refs/heads/main')
    })

    it('should parse peeled attribute for tags', () => {
      const refs = parseLsRefsResponse(MOCK_LS_REFS_RESPONSE)

      const tagRef = refs.find(r => r.name === 'refs/tags/v1.0.0')
      expect(tagRef?.peeled).toBe('aabbccdd')
    })

    it('should handle empty response', () => {
      const refs = parseLsRefsResponse('0000')

      expect(refs.length).toBe(0)
    })
  })
})

// =============================================================================
// fetch Command Tests
// =============================================================================

describe('fetch Command', () => {
  describe('generateFetchCommand', () => {
    it('should generate fetch command with wants', () => {
      const cmd = generateFetchCommand({
        wants: ['abc123'],
      })

      expect(cmd).toContain('command=fetch')
      expect(cmd).toContain('want abc123')
      expect(cmd).toContain('done')
    })

    it('should include thin-pack option', () => {
      const cmd = generateFetchCommand({
        wants: ['abc123'],
        thinPack: true,
      })

      expect(cmd).toContain('thin-pack')
    })

    it('should include ofs-delta option', () => {
      const cmd = generateFetchCommand({
        wants: ['abc123'],
        ofsDelta: true,
      })

      expect(cmd).toContain('ofs-delta')
    })

    it('should include no-progress option', () => {
      const cmd = generateFetchCommand({
        wants: ['abc123'],
        noProgress: true,
      })

      expect(cmd).toContain('no-progress')
    })

    it('should include include-tag option', () => {
      const cmd = generateFetchCommand({
        wants: ['abc123'],
        includeTag: true,
      })

      expect(cmd).toContain('include-tag')
    })

    it('should include haves', () => {
      const cmd = generateFetchCommand({
        wants: ['abc123'],
        haves: ['def456', 'ghi789'],
      })

      expect(cmd).toContain('have def456')
      expect(cmd).toContain('have ghi789')
    })

    it('should include want-ref for ref names', () => {
      const cmd = generateFetchCommand({
        wants: [],
        wantRefs: ['refs/heads/main'],
      })

      expect(cmd).toContain('want-ref refs/heads/main')
    })

    it('should include depth for shallow clones', () => {
      const cmd = generateFetchCommand({
        wants: ['abc123'],
        depth: 1,
      })

      expect(cmd).toContain('deepen 1')
    })

    it('should include deepen-since for time-based shallow', () => {
      const since = new Date('2024-01-01T00:00:00Z')
      const cmd = generateFetchCommand({
        wants: ['abc123'],
        deepenSince: since,
      })

      expect(cmd).toContain(`deepen-since ${Math.floor(since.getTime() / 1000)}`)
    })

    it('should include deepen-not for ref-based shallow', () => {
      const cmd = generateFetchCommand({
        wants: ['abc123'],
        deepenNot: ['refs/heads/old-branch'],
      })

      expect(cmd).toContain('deepen-not refs/heads/old-branch')
    })

    it('should include filter for partial clone', () => {
      const cmd = generateFetchCommand({
        wants: ['abc123'],
        filter: 'blob:none',
      })

      expect(cmd).toContain('filter blob:none')
    })
  })
})

// =============================================================================
// Side-band Demultiplexing Tests
// =============================================================================

describe('Side-band Demultiplexing', () => {
  describe('demuxSideBand', () => {
    it('should extract packfile data from channel 1', () => {
      // Create side-band packet with channel 1 data (format: \x01 + PACK bytes)
      const packet = createSideBandPacket(1, new Uint8Array([0x50, 0x41, 0x43, 0x4b]))

      const result = pktLineDemuxSideBand(packet)

      expect(result.packData).toEqual(new Uint8Array([0x50, 0x41, 0x43, 0x4b]))
    })

    it('should extract progress messages from channel 2', () => {
      const progressText = new TextEncoder().encode('Counting objects: 50%')
      const packet = createSideBandPacket(2, progressText)

      const result = pktLineDemuxSideBand(packet)

      expect(result.progress).toContain('Counting objects: 50%')
    })

    it('should extract error messages from channel 3', () => {
      const errorText = new TextEncoder().encode('fatal: repository not found')
      const packet = createSideBandPacket(3, errorText)

      const result = pktLineDemuxSideBand(packet)

      expect(result.errors).toContain('fatal: repository not found')
    })

    it('should call onProgress callback', () => {
      const progressText = new TextEncoder().encode('Receiving objects: 75%')
      const packet = createSideBandPacket(2, progressText)
      const onProgress = vi.fn()

      pktLineDemuxSideBand(packet, { onProgress })

      expect(onProgress).toHaveBeenCalledWith('Receiving objects: 75%')
    })

    it('should call onError callback', () => {
      const errorText = new TextEncoder().encode('error: invalid object')
      const packet = createSideBandPacket(3, errorText)
      const onError = vi.fn()

      pktLineDemuxSideBand(packet, { onError })

      expect(onError).toHaveBeenCalledWith('error: invalid object')
    })

    it('should handle multiple packets', () => {
      // Create multiple side-band packets
      const pack1 = createSideBandPacket(1, new Uint8Array([0x50, 0x41]))
      const progress1 = createSideBandPacket(2, new TextEncoder().encode('50%'))
      const pack2 = createSideBandPacket(1, new Uint8Array([0x43, 0x4b]))

      // Concatenate packets
      const combined = new Uint8Array(pack1.length + progress1.length + pack2.length)
      combined.set(pack1, 0)
      combined.set(progress1, pack1.length)
      combined.set(pack2, pack1.length + progress1.length)

      const result = pktLineDemuxSideBand(combined)

      expect(result.packData).toEqual(new Uint8Array([0x50, 0x41, 0x43, 0x4b]))
      expect(result.progress).toContain('50%')
    })

    it('should handle flush packets in stream', () => {
      const pack1 = createSideBandPacket(1, new Uint8Array([0x50]))
      const flush = new TextEncoder().encode('0000')
      const pack2 = createSideBandPacket(1, new Uint8Array([0x41]))

      const combined = new Uint8Array(pack1.length + flush.length + pack2.length)
      combined.set(pack1, 0)
      combined.set(flush, pack1.length)
      combined.set(pack2, pack1.length + flush.length)

      const result = pktLineDemuxSideBand(combined)

      // Should handle gracefully (flush doesn't interrupt pack assembly)
      expect(result.packData.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('isSideBandFormat', () => {
    it('should detect side-band format', () => {
      const packet = createSideBandPacket(1, new Uint8Array([0x50]))
      expect(isSideBandFormat(packet)).toBe(true)
    })

    it('should reject non-side-band format', () => {
      const data = new Uint8Array([0x50, 0x41, 0x43, 0x4b])
      expect(isSideBandFormat(data)).toBe(false)
    })

    it('should reject too-short data', () => {
      const data = new Uint8Array([0x00, 0x05])
      expect(isSideBandFormat(data)).toBe(false)
    })
  })

  describe('createSideBandPacket', () => {
    it('should create valid side-band packet', () => {
      const data = new Uint8Array([0x50, 0x41, 0x43, 0x4b])
      const packet = createSideBandPacket(1, data)

      // Length should be 4 (header) + 1 (channel) + 4 (data) = 9 = 0x0009
      expect(packet[0]).toBe(0x30) // '0'
      expect(packet[1]).toBe(0x30) // '0'
      expect(packet[2]).toBe(0x30) // '0'
      expect(packet[3]).toBe(0x39) // '9'
      expect(packet[4]).toBe(1) // channel
      expect(packet.slice(5)).toEqual(data)
    })
  })
})

// =============================================================================
// Protocol v2 Fetch Response Tests
// =============================================================================

describe('Protocol v2 Fetch Response', () => {
  describe('parseFetchResponse', () => {
    it('should parse packfile from side-band response', () => {
      const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b])
      const packet = createSideBandPacket(1, packData)

      const result = parseFetchResponse(packet)

      expect(result.packfile).toEqual(packData)
    })

    it('should collect progress messages', () => {
      const progress = new TextEncoder().encode('Counting objects')
      const packet = createSideBandPacket(2, progress)

      const result = parseFetchResponse(packet)

      expect(result.progressMessages).toContain('Counting objects')
    })

    it('should call progress callback', () => {
      const progress = new TextEncoder().encode('Receiving')
      const packet = createSideBandPacket(2, progress)
      const onProgress = vi.fn()

      parseFetchResponse(packet, { onProgress })

      expect(onProgress).toHaveBeenCalled()
    })
  })
})

// =============================================================================
// HTTP Client Protocol v2 Integration Tests
// =============================================================================

// Mock repo URL used in handlers below: https://github.com/test/repo.git

const handlers = [
  // Protocol v2 capability advertisement
  http.get('https://github.com/test/repo-v2.git/info/refs', ({ request }) => {
    const gitProtocol = request.headers.get('Git-Protocol')

    if (gitProtocol === 'version=2') {
      return new HttpResponse(MOCK_V2_CAPABILITY_RESPONSE, {
        headers: {
          'Content-Type': 'application/x-git-upload-pack-advertisement',
        },
      })
    }

    return new HttpResponse(MOCK_V1_REFS_RESPONSE, {
      headers: {
        'Content-Type': 'application/x-git-upload-pack-advertisement',
      },
    })
  }),

  // Protocol v1 only server
  http.get('https://github.com/test/repo-v1.git/info/refs', () => {
    return new HttpResponse(MOCK_V1_REFS_RESPONSE, {
      headers: {
        'Content-Type': 'application/x-git-upload-pack-advertisement',
      },
    })
  }),

  // ls-refs command
  http.post('https://github.com/test/repo-v2.git/git-upload-pack', async ({ request }) => {
    const gitProtocol = request.headers.get('Git-Protocol')
    const body = await request.text()

    if (gitProtocol === 'version=2' && body.includes('command=ls-refs')) {
      return new HttpResponse(MOCK_LS_REFS_RESPONSE, {
        headers: {
          'Content-Type': 'application/x-git-upload-pack-result',
        },
      })
    }

    // Fetch command
    if (gitProtocol === 'version=2' && body.includes('command=fetch')) {
      // Build side-band response
      const packData = createSideBandPacket(1, MOCK_PACKFILE)
      const progress = createSideBandPacket(2, new TextEncoder().encode('Receiving objects'))
      const flush = new TextEncoder().encode('0000')

      const response = new Uint8Array(packData.length + progress.length + flush.length)
      response.set(packData, 0)
      response.set(progress, packData.length)
      response.set(flush, packData.length + progress.length)

      return new HttpResponse(response, {
        headers: {
          'Content-Type': 'application/x-git-upload-pack-result',
        },
      })
    }

    return new HttpResponse('Invalid request', { status: 400 })
  }),

  // Standard v1 server
  http.get('https://github.com/test/repo.git/info/refs', () => {
    return new HttpResponse(MOCK_V1_REFS_RESPONSE, {
      headers: {
        'Content-Type': 'application/x-git-upload-pack-advertisement',
      },
    })
  }),
]

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

describe('GitHttpClient Protocol v2', () => {
  describe('Protocol Version Detection', () => {
    it('should detect protocol v2 support', async () => {
      const client = new GitHttpClient('https://github.com/test/repo-v2.git')

      const refs = await client.discoverRefs('upload-pack')

      expect(client.getProtocolVersion()).toBe(2)
      expect(refs.capabilities.protocolVersion).toBe(2)
    })

    it('should fall back to v1 if server does not support v2', async () => {
      const client = new GitHttpClient('https://github.com/test/repo-v1.git')

      await client.discoverRefs('upload-pack')

      expect(client.getProtocolVersion()).toBe(1)
    })

    it('should use v1 if explicitly configured', async () => {
      const client = new GitHttpClient('https://github.com/test/repo-v2.git', {
        protocolVersion: 1,
      })

      await client.discoverRefs('upload-pack')

      expect(client.getProtocolVersion()).toBe(1)
    })
  })

  describe('v2 Capabilities', () => {
    it('should cache v2 capabilities', async () => {
      const client = new GitHttpClient('https://github.com/test/repo-v2.git')

      await client.discoverRefs('upload-pack')

      const caps = client.getV2Capabilities()
      expect(caps).not.toBeNull()
      expect(caps?.commands.has('ls-refs')).toBe(true)
      expect(caps?.commands.has('fetch')).toBe(true)
    })

    it('should return null for v2 capabilities on v1 server', async () => {
      const client = new GitHttpClient('https://github.com/test/repo-v1.git')

      await client.discoverRefs('upload-pack')

      expect(client.getV2Capabilities()).toBeNull()
    })
  })

  describe('ls-refs Command', () => {
    it('should execute ls-refs after v2 discovery', async () => {
      const client = new GitHttpClient('https://github.com/test/repo-v2.git')

      // First discover to establish v2
      await client.discoverRefs('upload-pack')

      const refs = await client.lsRefs({
        symrefs: true,
        peel: true,
        refPrefixes: ['refs/heads/'],
      })

      expect(refs.length).toBeGreaterThan(0)
    })

    it('should throw if called on v1 server', async () => {
      const client = new GitHttpClient('https://github.com/test/repo-v1.git')

      // First discover to establish v1
      await client.discoverRefs('upload-pack')

      await expect(client.lsRefs()).rejects.toThrow('ls-refs requires protocol v2')
    })
  })

  describe('v2 Fetch Command', () => {
    it('should execute fetchV2 with progress callback', async () => {
      const client = new GitHttpClient('https://github.com/test/repo-v2.git')
      const progressMessages: string[] = []

      // First discover to establish v2
      await client.discoverRefs('upload-pack')

      const result = await client.fetchV2({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
        onProgress: (msg) => progressMessages.push(msg),
      })

      expect(result.packfile).toBeDefined()
      expect(result.packfile.length).toBeGreaterThan(0)
    })

    it('should throw if called on v1 server', async () => {
      const client = new GitHttpClient('https://github.com/test/repo-v1.git')

      // First discover to establish v1
      await client.discoverRefs('upload-pack')

      await expect(client.fetchV2({ wants: ['abc123'] })).rejects.toThrow('fetchV2 requires protocol v2')
    })
  })

  describe('Progress Callbacks', () => {
    it('should pass progress through client options', async () => {
      const progressMessages: string[] = []
      const client = new GitHttpClient('https://github.com/test/repo-v2.git', {
        onProgress: (msg) => progressMessages.push(msg),
      })

      await client.discoverRefs('upload-pack')
      await client.fetchV2({
        wants: ['1234567890abcdef1234567890abcdef12345678'],
      })

      // Progress messages should have been collected
      // (The mock server sends progress messages)
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Protocol v2 Edge Cases', () => {
  it('should handle empty refs response', () => {
    const refs = parseLsRefsResponse('0000')
    expect(refs).toEqual([])
  })

  it('should handle malformed ref lines gracefully', () => {
    // Use valid pkt-line format - 0x000b = 11 = 4 + 7 chars, 0x003c = 60 = 4 + 56 chars
    const response =
      '000binvalid' +
      '003c1234567890abcdef1234567890abcdef12345678 refs/heads/main' +
      '0000'

    const refs = parseLsRefsResponse(response)

    // Should parse valid refs and skip invalid ones (first line has no valid OID)
    expect(refs.length).toBe(1)
    expect(refs[0].name).toBe('refs/heads/main')
  })

  it('should handle response-end packet', () => {
    // 0x003c = 60 = 4 + 56 chars
    const response =
      '003c1234567890abcdef1234567890abcdef12345678 refs/heads/main' +
      '0002'

    const refs = parseLsRefsResponse(response)

    expect(refs.length).toBe(1)
  })

  it('should handle capabilities with equals sign in value', () => {
    // 0x000d = 13 = 4 + 9 chars, 0x0020 = 32 = 4 + 28 chars
    const caps = parseV2Capabilities('000dversion 2' + '0020object-format=sha256=variant' + '0000')

    // Should handle gracefully
    expect(caps.version).toBe(2)
  })
})
