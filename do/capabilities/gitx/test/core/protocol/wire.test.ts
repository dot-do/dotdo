/**
 * Git Wire Protocol Tests (RED Phase)
 *
 * Comprehensive tests for Git smart HTTP wire protocol implementation.
 * These tests cover the core wire protocol primitives that enable
 * Git operations over HTTP.
 *
 * Protocol Documentation:
 * - https://git-scm.com/docs/protocol-v2
 * - https://git-scm.com/docs/pack-protocol
 * - https://git-scm.com/docs/http-protocol
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Pkt-line encoding/decoding
  encodePktLine,
  decodePktLine,
  decodePktLineStream,
  encodeFlushPkt,
  encodeDelimPkt,
  encodeResponseEndPkt,
  FLUSH_PKT,
  DELIM_PKT,
  RESPONSE_END_PKT,
  MAX_PKT_LINE_LENGTH,

  // Reference advertisement
  parseRefAdvertisement,
  formatRefAdvertisement,
  RefAdvertisement,
  RefLine,

  // Capabilities
  parseCapabilities,
  formatCapabilities,
  parseCapabilityLine,
  Capabilities,
  CapabilityValue,
  COMMON_CAPABILITIES,

  // Want/Have negotiation
  parseWantLine,
  parseHaveLine,
  formatWantLine,
  formatHaveLine,
  WantLine,
  HaveLine,

  // ACK/NAK responses
  parseAckNak,
  formatAck,
  formatNak,
  formatAckContinue,
  formatAckCommon,
  formatAckReady,
  AckNakResponse,
  AckStatus,

  // Side-band demultiplexing
  parseSideBandPacket,
  formatSideBandPacket,
  demultiplexSideBand,
  SideBandChannel,
  SideBandPacket,

  // Shallow/unshallow
  parseShallowLine,
  parseUnshallowLine,
  formatShallowLine,
  formatUnshallowLine,
  ShallowUpdate,

  // Info/refs response
  parseInfoRefsResponse,
  formatInfoRefsResponse,
  InfoRefsResponse,

  // Upload-pack request
  parseUploadPackRequest,
  formatUploadPackRequest,
  UploadPackRequest,

  // Receive-pack request
  parseReceivePackRequest,
  formatReceivePackRequest,
  ReceivePackRequest,
  RefUpdateCommand,

  // Protocol errors
  WireProtocolError,
  PktLineError,
  CapabilityError,
  NegotiationError,
} from '../../../core/protocol'

// =============================================================================
// Test Data
// =============================================================================

// Sample SHA-1 hashes (40 hex characters)
const SHA1_COMMIT_A = 'a'.repeat(40)
const SHA1_COMMIT_B = 'b'.repeat(40)
const SHA1_COMMIT_C = 'c'.repeat(40)
const SHA1_TREE_1 = 'd'.repeat(40)
const SHA1_TAG_1 = 'e'.repeat(40)
const ZERO_SHA = '0'.repeat(40)

// Text encoder/decoder for binary data handling
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// =============================================================================
// 1. Pkt-line Format Tests
// =============================================================================

describe('Pkt-line Format', () => {
  describe('encodePktLine', () => {
    it('should encode string data with 4-hex-digit length prefix', () => {
      const result = encodePktLine('hello')
      // 4 bytes for length + 5 bytes for 'hello' = 9 = 0x0009
      expect(result).toBe('0009hello')
    })

    it('should include the length bytes in the length calculation', () => {
      const result = encodePktLine('test')
      // 4 bytes for length + 4 bytes for 'test' = 8 = 0x0008
      expect(result).toBe('0008test')
    })

    it('should encode empty string as minimal pkt-line', () => {
      const result = encodePktLine('')
      // 4 bytes for length + 0 bytes = 4 = 0x0004
      expect(result).toBe('0004')
    })

    it('should use lowercase hexadecimal', () => {
      const data = 'x'.repeat(252) // 252 + 4 = 256 = 0x0100
      const result = encodePktLine(data)
      expect(result.slice(0, 4)).toBe('0100')
    })

    it('should handle string with newline', () => {
      const result = encodePktLine('hello\n')
      // 4 + 6 = 10 = 0x000a
      expect(result).toBe('000ahello\n')
    })

    it('should encode Uint8Array binary data', () => {
      const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]) // "Hello"
      const result = encodePktLine(data)
      expect(result).toBeInstanceOf(Uint8Array)
      // Check length prefix
      const lengthPrefix = decoder.decode((result as Uint8Array).slice(0, 4))
      expect(lengthPrefix).toBe('0009')
    })

    it('should handle binary data with null bytes', () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0xff])
      const result = encodePktLine(data)
      expect(result).toBeInstanceOf(Uint8Array)
      const lengthPrefix = decoder.decode((result as Uint8Array).slice(0, 4))
      expect(lengthPrefix).toBe('0008')
    })

    it('should throw for data exceeding maximum length', () => {
      const oversizedData = 'x'.repeat(MAX_PKT_LINE_LENGTH)
      expect(() => encodePktLine(oversizedData)).toThrow(PktLineError)
    })

    it('should accept data at exactly maximum length', () => {
      const maxData = 'x'.repeat(MAX_PKT_LINE_LENGTH - 4)
      expect(() => encodePktLine(maxData)).not.toThrow()
    })
  })

  describe('decodePktLine', () => {
    it('should decode valid pkt-line string', () => {
      const result = decodePktLine('0009hello')
      expect(result.data).toBe('hello')
      expect(result.bytesConsumed).toBe(9)
    })

    it('should decode pkt-line with newline', () => {
      const result = decodePktLine('000ahello\n')
      expect(result.data).toBe('hello\n')
      expect(result.bytesConsumed).toBe(10)
    })

    it('should detect flush packet (0000)', () => {
      const result = decodePktLine('0000')
      expect(result.type).toBe('flush')
      expect(result.data).toBeNull()
      expect(result.bytesConsumed).toBe(4)
    })

    it('should detect delimiter packet (0001)', () => {
      const result = decodePktLine('0001')
      expect(result.type).toBe('delim')
      expect(result.data).toBeNull()
      expect(result.bytesConsumed).toBe(4)
    })

    it('should detect response-end packet (0002)', () => {
      const result = decodePktLine('0002')
      expect(result.type).toBe('response-end')
      expect(result.data).toBeNull()
      expect(result.bytesConsumed).toBe(4)
    })

    it('should decode from Uint8Array', () => {
      const input = encoder.encode('0009hello')
      const result = decodePktLine(input)
      expect(result.data).toBe('hello')
    })

    it('should return incomplete for insufficient header bytes', () => {
      const result = decodePktLine('000')
      expect(result.type).toBe('incomplete')
      expect(result.bytesConsumed).toBe(0)
    })

    it('should return incomplete when data shorter than declared length', () => {
      const result = decodePktLine('0009hel')
      expect(result.type).toBe('incomplete')
      expect(result.bytesConsumed).toBe(0)
    })

    it('should throw for invalid hex in length prefix', () => {
      expect(() => decodePktLine('gggg')).toThrow(PktLineError)
    })

    it('should throw for oversized packet length', () => {
      // ffff = 65535, which exceeds maximum
      const packet = 'ffff' + 'x'.repeat(100)
      expect(() => decodePktLine(packet)).toThrow(PktLineError)
    })

    it('should handle length 0003 as reserved', () => {
      expect(() => decodePktLine('0003')).toThrow(PktLineError)
    })

    it('should decode empty data packet (0004)', () => {
      const result = decodePktLine('0004')
      expect(result.data).toBe('')
      expect(result.bytesConsumed).toBe(4)
    })
  })

  describe('decodePktLineStream', () => {
    it('should parse multiple consecutive pkt-lines', () => {
      const stream = '0009hello0009world0000'
      const result = decodePktLineStream(stream)

      expect(result.packets).toHaveLength(3)
      expect(result.packets[0].data).toBe('hello')
      expect(result.packets[1].data).toBe('world')
      expect(result.packets[2].type).toBe('flush')
      expect(result.remaining).toBe('')
    })

    it('should handle incomplete trailing data', () => {
      const stream = '0009hello0009wo'
      const result = decodePktLineStream(stream)

      expect(result.packets).toHaveLength(1)
      expect(result.packets[0].data).toBe('hello')
      expect(result.remaining).toBe('0009wo')
    })

    it('should handle empty input', () => {
      const result = decodePktLineStream('')
      expect(result.packets).toHaveLength(0)
      expect(result.remaining).toBe('')
    })

    it('should parse mixed packet types', () => {
      const stream = '0009hello00010009world0000'
      const result = decodePktLineStream(stream)

      expect(result.packets).toHaveLength(4)
      expect(result.packets[0].data).toBe('hello')
      expect(result.packets[1].type).toBe('delim')
      expect(result.packets[2].data).toBe('world')
      expect(result.packets[3].type).toBe('flush')
    })

    it('should decode from Uint8Array', () => {
      const stream = encoder.encode('0009hello0000')
      const result = decodePktLineStream(stream)

      expect(result.packets).toHaveLength(2)
      expect(result.packets[0].data).toBe('hello')
      expect(result.packets[1].type).toBe('flush')
    })
  })

  describe('Special packet constants', () => {
    it('should have correct flush packet value', () => {
      expect(FLUSH_PKT).toBe('0000')
      expect(encodeFlushPkt()).toBe('0000')
    })

    it('should have correct delimiter packet value', () => {
      expect(DELIM_PKT).toBe('0001')
      expect(encodeDelimPkt()).toBe('0001')
    })

    it('should have correct response-end packet value', () => {
      expect(RESPONSE_END_PKT).toBe('0002')
      expect(encodeResponseEndPkt()).toBe('0002')
    })
  })

  describe('MAX_PKT_LINE_LENGTH', () => {
    it('should be 65520 (0xfff0)', () => {
      expect(MAX_PKT_LINE_LENGTH).toBe(65520)
    })

    it('should be maximum length including 4-byte header', () => {
      // Maximum payload is 65520 - 4 = 65516 bytes
      const maxPayload = MAX_PKT_LINE_LENGTH - 4
      expect(maxPayload).toBe(65516)
    })
  })
})

// =============================================================================
// 2. Reference Advertisement Parsing Tests
// =============================================================================

describe('Reference Advertisement Parsing', () => {
  describe('parseRefAdvertisement', () => {
    it('should parse first ref line with capabilities', () => {
      const line = `${SHA1_COMMIT_A} refs/heads/main\0multi_ack thin-pack`
      const result = parseRefAdvertisement(line, true)

      expect(result.sha).toBe(SHA1_COMMIT_A)
      expect(result.ref).toBe('refs/heads/main')
      expect(result.capabilities).toBeDefined()
      expect(result.capabilities!.has('multi_ack')).toBe(true)
      expect(result.capabilities!.has('thin-pack')).toBe(true)
    })

    it('should parse subsequent ref line without capabilities', () => {
      const line = `${SHA1_COMMIT_B} refs/heads/feature`
      const result = parseRefAdvertisement(line, false)

      expect(result.sha).toBe(SHA1_COMMIT_B)
      expect(result.ref).toBe('refs/heads/feature')
      expect(result.capabilities).toBeUndefined()
    })

    it('should parse HEAD ref', () => {
      const line = `${SHA1_COMMIT_A} HEAD\0side-band-64k`
      const result = parseRefAdvertisement(line, true)

      expect(result.sha).toBe(SHA1_COMMIT_A)
      expect(result.ref).toBe('HEAD')
    })

    it('should parse peeled tag ref with ^{}', () => {
      const line = `${SHA1_COMMIT_C} refs/tags/v1.0.0^{}`
      const result = parseRefAdvertisement(line, false)

      expect(result.sha).toBe(SHA1_COMMIT_C)
      expect(result.ref).toBe('refs/tags/v1.0.0^{}')
      expect(result.peeled).toBe(true)
    })

    it('should handle line with trailing newline', () => {
      const line = `${SHA1_COMMIT_A} refs/heads/main\n`
      const result = parseRefAdvertisement(line, false)

      expect(result.sha).toBe(SHA1_COMMIT_A)
      expect(result.ref).toBe('refs/heads/main')
    })

    it('should parse symref capability value', () => {
      const line = `${SHA1_COMMIT_A} HEAD\0symref=HEAD:refs/heads/main agent=git/2.40.0`
      const result = parseRefAdvertisement(line, true)

      expect(result.capabilities!.get('symref')).toBe('HEAD:refs/heads/main')
      expect(result.capabilities!.get('agent')).toBe('git/2.40.0')
    })

    it('should throw for malformed ref line', () => {
      expect(() => parseRefAdvertisement('invalid', false)).toThrow(WireProtocolError)
    })

    it('should throw for invalid SHA format', () => {
      expect(() => parseRefAdvertisement('short refs/heads/main', false)).toThrow(WireProtocolError)
    })

    it('should throw for missing ref name', () => {
      expect(() => parseRefAdvertisement(SHA1_COMMIT_A, false)).toThrow(WireProtocolError)
    })
  })

  describe('formatRefAdvertisement', () => {
    it('should format refs as pkt-lines', () => {
      const refs: RefLine[] = [
        { sha: SHA1_COMMIT_A, ref: 'refs/heads/main' },
        { sha: SHA1_COMMIT_B, ref: 'refs/heads/feature' },
      ]
      const result = formatRefAdvertisement(refs)

      expect(result).toContain(SHA1_COMMIT_A)
      expect(result).toContain('refs/heads/main')
      expect(result).toContain(SHA1_COMMIT_B)
      expect(result).toContain('refs/heads/feature')
    })

    it('should include capabilities on first line only', () => {
      const refs: RefLine[] = [
        { sha: SHA1_COMMIT_A, ref: 'HEAD' },
        { sha: SHA1_COMMIT_A, ref: 'refs/heads/main' },
      ]
      const capabilities: Capabilities = new Map([
        ['side-band-64k', true],
        ['thin-pack', true],
      ])
      const result = formatRefAdvertisement(refs, capabilities)

      // First line should have NUL byte
      const firstNul = result.indexOf('\0')
      expect(firstNul).toBeGreaterThan(-1)

      // Only one NUL byte in the entire output
      const nulCount = (result.match(/\0/g) || []).length
      expect(nulCount).toBe(1)
    })

    it('should include peeled refs for annotated tags', () => {
      const refs: RefLine[] = [
        { sha: SHA1_TAG_1, ref: 'refs/tags/v1.0.0' },
        { sha: SHA1_COMMIT_C, ref: 'refs/tags/v1.0.0^{}', peeled: true },
      ]
      const result = formatRefAdvertisement(refs)

      expect(result).toContain('refs/tags/v1.0.0^{}')
    })

    it('should end with flush packet', () => {
      const refs: RefLine[] = [{ sha: SHA1_COMMIT_A, ref: 'refs/heads/main' }]
      const result = formatRefAdvertisement(refs)

      expect(result).toContain(FLUSH_PKT)
    })

    it('should format empty repository with capabilities line', () => {
      const refs: RefLine[] = []
      const capabilities: Capabilities = new Map([['agent', 'gitx/1.0']])
      const result = formatRefAdvertisement(refs, capabilities)

      // Empty repo should still have capabilities
      expect(result).toContain(ZERO_SHA)
      expect(result).toContain('capabilities^{}')
    })
  })
})

// =============================================================================
// 3. Capabilities Parsing Tests
// =============================================================================

describe('Capabilities Parsing', () => {
  describe('parseCapabilities', () => {
    it('should parse space-separated capabilities', () => {
      const capString = 'multi_ack thin-pack side-band-64k'
      const result = parseCapabilities(capString)

      expect(result.has('multi_ack')).toBe(true)
      expect(result.has('thin-pack')).toBe(true)
      expect(result.has('side-band-64k')).toBe(true)
    })

    it('should parse capability with value (key=value)', () => {
      const capString = 'agent=git/2.40.0 symref=HEAD:refs/heads/main'
      const result = parseCapabilities(capString)

      expect(result.get('agent')).toBe('git/2.40.0')
      expect(result.get('symref')).toBe('HEAD:refs/heads/main')
    })

    it('should parse mixed capabilities with and without values', () => {
      const capString = 'multi_ack thin-pack agent=git/2.40.0 shallow'
      const result = parseCapabilities(capString)

      expect(result.get('multi_ack')).toBe(true)
      expect(result.get('thin-pack')).toBe(true)
      expect(result.get('agent')).toBe('git/2.40.0')
      expect(result.get('shallow')).toBe(true)
    })

    it('should handle empty capability string', () => {
      const result = parseCapabilities('')
      expect(result.size).toBe(0)
    })

    it('should handle capability with multiple equals signs in value', () => {
      // e.g., filter=blob:limit=1000
      const capString = 'filter=blob:limit=1000'
      const result = parseCapabilities(capString)

      expect(result.get('filter')).toBe('blob:limit=1000')
    })

    it('should handle capability with empty value', () => {
      const capString = 'agent='
      const result = parseCapabilities(capString)

      expect(result.get('agent')).toBe('')
    })

    it('should handle extra whitespace', () => {
      const capString = 'thin-pack   side-band-64k    ofs-delta'
      const result = parseCapabilities(capString)

      expect(result.size).toBe(3)
    })

    it('should parse object-format capability', () => {
      const capString = 'object-format=sha1'
      const result = parseCapabilities(capString)

      expect(result.get('object-format')).toBe('sha1')
    })

    it('should parse object-format=sha256', () => {
      const capString = 'object-format=sha256'
      const result = parseCapabilities(capString)

      expect(result.get('object-format')).toBe('sha256')
    })
  })

  describe('formatCapabilities', () => {
    it('should format boolean capabilities', () => {
      const caps: Capabilities = new Map([
        ['thin-pack', true],
        ['side-band-64k', true],
      ])
      const result = formatCapabilities(caps)

      expect(result).toBe('thin-pack side-band-64k')
    })

    it('should format capabilities with values', () => {
      const caps: Capabilities = new Map([
        ['thin-pack', true],
        ['agent', 'gitx/1.0'],
      ])
      const result = formatCapabilities(caps)

      expect(result).toContain('thin-pack')
      expect(result).toContain('agent=gitx/1.0')
    })

    it('should return empty string for empty capabilities', () => {
      const caps: Capabilities = new Map()
      const result = formatCapabilities(caps)

      expect(result).toBe('')
    })

    it('should not include disabled capabilities', () => {
      const caps: Capabilities = new Map([
        ['thin-pack', true],
        ['shallow', false],
      ])
      const result = formatCapabilities(caps)

      expect(result).toContain('thin-pack')
      expect(result).not.toContain('shallow')
    })
  })

  describe('parseCapabilityLine', () => {
    it('should parse capability line after NUL byte', () => {
      const line = `${SHA1_COMMIT_A} refs/heads/main\0multi_ack thin-pack`
      const result = parseCapabilityLine(line)

      expect(result.refPart).toBe(`${SHA1_COMMIT_A} refs/heads/main`)
      expect(result.capabilities.has('multi_ack')).toBe(true)
      expect(result.capabilities.has('thin-pack')).toBe(true)
    })

    it('should return empty capabilities when no NUL byte', () => {
      const line = `${SHA1_COMMIT_A} refs/heads/main`
      const result = parseCapabilityLine(line)

      expect(result.refPart).toBe(line)
      expect(result.capabilities.size).toBe(0)
    })
  })

  describe('Common capabilities', () => {
    it('should include multi_ack in common capabilities', () => {
      expect(COMMON_CAPABILITIES).toContain('multi_ack')
    })

    it('should include multi_ack_detailed in common capabilities', () => {
      expect(COMMON_CAPABILITIES).toContain('multi_ack_detailed')
    })

    it('should include thin-pack in common capabilities', () => {
      expect(COMMON_CAPABILITIES).toContain('thin-pack')
    })

    it('should include side-band in common capabilities', () => {
      expect(COMMON_CAPABILITIES).toContain('side-band')
    })

    it('should include side-band-64k in common capabilities', () => {
      expect(COMMON_CAPABILITIES).toContain('side-band-64k')
    })

    it('should include ofs-delta in common capabilities', () => {
      expect(COMMON_CAPABILITIES).toContain('ofs-delta')
    })

    it('should include shallow in common capabilities', () => {
      expect(COMMON_CAPABILITIES).toContain('shallow')
    })

    it('should include no-progress in common capabilities', () => {
      expect(COMMON_CAPABILITIES).toContain('no-progress')
    })

    it('should include include-tag in common capabilities', () => {
      expect(COMMON_CAPABILITIES).toContain('include-tag')
    })

    it('should include agent in common capabilities', () => {
      expect(COMMON_CAPABILITIES).toContain('agent')
    })
  })
})

// =============================================================================
// 4. Want/Have Negotiation Tests
// =============================================================================

describe('Want/Have Negotiation', () => {
  describe('parseWantLine', () => {
    it('should parse simple want line', () => {
      const line = `want ${SHA1_COMMIT_A}`
      const result = parseWantLine(line)

      expect(result.sha).toBe(SHA1_COMMIT_A)
      expect(result.capabilities).toBeUndefined()
    })

    it('should parse want line with capabilities', () => {
      const line = `want ${SHA1_COMMIT_A} thin-pack side-band-64k ofs-delta`
      const result = parseWantLine(line)

      expect(result.sha).toBe(SHA1_COMMIT_A)
      expect(result.capabilities).toBeDefined()
      expect(result.capabilities!.has('thin-pack')).toBe(true)
      expect(result.capabilities!.has('side-band-64k')).toBe(true)
      expect(result.capabilities!.has('ofs-delta')).toBe(true)
    })

    it('should parse want line with agent capability', () => {
      const line = `want ${SHA1_COMMIT_A} agent=git/2.40.0`
      const result = parseWantLine(line)

      expect(result.capabilities!.get('agent')).toBe('git/2.40.0')
    })

    it('should handle trailing newline', () => {
      const line = `want ${SHA1_COMMIT_A}\n`
      const result = parseWantLine(line)

      expect(result.sha).toBe(SHA1_COMMIT_A)
    })

    it('should throw for missing want keyword', () => {
      expect(() => parseWantLine(SHA1_COMMIT_A)).toThrow(NegotiationError)
    })

    it('should throw for invalid SHA format', () => {
      expect(() => parseWantLine('want invalid-sha')).toThrow(NegotiationError)
    })

    it('should throw for short SHA', () => {
      expect(() => parseWantLine('want ' + 'a'.repeat(20))).toThrow(NegotiationError)
    })
  })

  describe('parseHaveLine', () => {
    it('should parse have line', () => {
      const line = `have ${SHA1_COMMIT_B}`
      const result = parseHaveLine(line)

      expect(result.sha).toBe(SHA1_COMMIT_B)
    })

    it('should handle trailing newline', () => {
      const line = `have ${SHA1_COMMIT_B}\n`
      const result = parseHaveLine(line)

      expect(result.sha).toBe(SHA1_COMMIT_B)
    })

    it('should throw for missing have keyword', () => {
      expect(() => parseHaveLine(SHA1_COMMIT_B)).toThrow(NegotiationError)
    })

    it('should throw for invalid SHA', () => {
      expect(() => parseHaveLine('have invalid')).toThrow(NegotiationError)
    })

    it('should normalize uppercase SHA to lowercase', () => {
      const line = `have ${SHA1_COMMIT_B.toUpperCase()}`
      const result = parseHaveLine(line)

      expect(result.sha).toBe(SHA1_COMMIT_B.toLowerCase())
    })
  })

  describe('formatWantLine', () => {
    it('should format simple want line', () => {
      const result = formatWantLine(SHA1_COMMIT_A)

      expect(result).toBe(`want ${SHA1_COMMIT_A}\n`)
    })

    it('should format want line with capabilities', () => {
      const caps: Capabilities = new Map([
        ['thin-pack', true],
        ['side-band-64k', true],
      ])
      const result = formatWantLine(SHA1_COMMIT_A, caps)

      expect(result).toBe(`want ${SHA1_COMMIT_A} thin-pack side-band-64k\n`)
    })

    it('should format want line with agent capability', () => {
      const caps: Capabilities = new Map([
        ['thin-pack', true],
        ['agent', 'gitx/1.0'],
      ])
      const result = formatWantLine(SHA1_COMMIT_A, caps)

      expect(result).toContain('thin-pack')
      expect(result).toContain('agent=gitx/1.0')
    })

    it('should use lowercase SHA', () => {
      const result = formatWantLine(SHA1_COMMIT_A.toUpperCase())

      expect(result).toBe(`want ${SHA1_COMMIT_A.toLowerCase()}\n`)
    })
  })

  describe('formatHaveLine', () => {
    it('should format have line', () => {
      const result = formatHaveLine(SHA1_COMMIT_B)

      expect(result).toBe(`have ${SHA1_COMMIT_B}\n`)
    })

    it('should use lowercase SHA', () => {
      const result = formatHaveLine(SHA1_COMMIT_B.toUpperCase())

      expect(result).toBe(`have ${SHA1_COMMIT_B.toLowerCase()}\n`)
    })
  })
})

// =============================================================================
// 5. ACK/NAK Response Tests
// =============================================================================

describe('ACK/NAK Responses', () => {
  describe('parseAckNak', () => {
    it('should parse NAK response', () => {
      const result = parseAckNak('NAK')

      expect(result.type).toBe('NAK')
      expect(result.sha).toBeUndefined()
    })

    it('should parse NAK with trailing newline', () => {
      const result = parseAckNak('NAK\n')

      expect(result.type).toBe('NAK')
    })

    it('should parse simple ACK', () => {
      const result = parseAckNak(`ACK ${SHA1_COMMIT_A}`)

      expect(result.type).toBe('ACK')
      expect(result.sha).toBe(SHA1_COMMIT_A)
      expect(result.status).toBeUndefined()
    })

    it('should parse ACK with continue status', () => {
      const result = parseAckNak(`ACK ${SHA1_COMMIT_A} continue`)

      expect(result.type).toBe('ACK')
      expect(result.sha).toBe(SHA1_COMMIT_A)
      expect(result.status).toBe('continue')
    })

    it('should parse ACK with common status', () => {
      const result = parseAckNak(`ACK ${SHA1_COMMIT_A} common`)

      expect(result.type).toBe('ACK')
      expect(result.sha).toBe(SHA1_COMMIT_A)
      expect(result.status).toBe('common')
    })

    it('should parse ACK with ready status', () => {
      const result = parseAckNak(`ACK ${SHA1_COMMIT_A} ready`)

      expect(result.type).toBe('ACK')
      expect(result.sha).toBe(SHA1_COMMIT_A)
      expect(result.status).toBe('ready')
    })

    it('should throw for invalid response format', () => {
      expect(() => parseAckNak('INVALID')).toThrow(NegotiationError)
    })

    it('should throw for ACK without SHA', () => {
      expect(() => parseAckNak('ACK')).toThrow(NegotiationError)
    })

    it('should throw for invalid ACK status', () => {
      expect(() => parseAckNak(`ACK ${SHA1_COMMIT_A} invalid`)).toThrow(NegotiationError)
    })
  })

  describe('formatAck', () => {
    it('should format simple ACK', () => {
      const result = formatAck(SHA1_COMMIT_A)

      expect(result).toBe(`ACK ${SHA1_COMMIT_A}\n`)
    })
  })

  describe('formatAckContinue', () => {
    it('should format ACK with continue status', () => {
      const result = formatAckContinue(SHA1_COMMIT_A)

      expect(result).toBe(`ACK ${SHA1_COMMIT_A} continue\n`)
    })
  })

  describe('formatAckCommon', () => {
    it('should format ACK with common status', () => {
      const result = formatAckCommon(SHA1_COMMIT_A)

      expect(result).toBe(`ACK ${SHA1_COMMIT_A} common\n`)
    })
  })

  describe('formatAckReady', () => {
    it('should format ACK with ready status', () => {
      const result = formatAckReady(SHA1_COMMIT_A)

      expect(result).toBe(`ACK ${SHA1_COMMIT_A} ready\n`)
    })
  })

  describe('formatNak', () => {
    it('should format NAK response', () => {
      const result = formatNak()

      expect(result).toBe('NAK\n')
    })
  })
})

// =============================================================================
// 6. Side-band Demultiplexing Tests
// =============================================================================

describe('Side-band Demultiplexing', () => {
  describe('parseSideBandPacket', () => {
    it('should parse pack data channel (1)', () => {
      const data = new Uint8Array([0x01, 0x50, 0x41, 0x43, 0x4b]) // Channel 1 + "PACK"
      const result = parseSideBandPacket(data)

      expect(result.channel).toBe(SideBandChannel.PackData)
      expect(result.data).toEqual(new Uint8Array([0x50, 0x41, 0x43, 0x4b]))
    })

    it('should parse progress channel (2)', () => {
      const progressMsg = encoder.encode('Counting objects: 100%')
      const data = new Uint8Array([0x02, ...progressMsg])
      const result = parseSideBandPacket(data)

      expect(result.channel).toBe(SideBandChannel.Progress)
      expect(decoder.decode(result.data)).toBe('Counting objects: 100%')
    })

    it('should parse error channel (3)', () => {
      const errorMsg = encoder.encode('error: repository not found')
      const data = new Uint8Array([0x03, ...errorMsg])
      const result = parseSideBandPacket(data)

      expect(result.channel).toBe(SideBandChannel.Error)
      expect(decoder.decode(result.data)).toBe('error: repository not found')
    })

    it('should throw for invalid channel number', () => {
      const data = new Uint8Array([0x04, 0x00])
      expect(() => parseSideBandPacket(data)).toThrow(WireProtocolError)
    })

    it('should throw for empty packet', () => {
      const data = new Uint8Array([])
      expect(() => parseSideBandPacket(data)).toThrow(WireProtocolError)
    })
  })

  describe('formatSideBandPacket', () => {
    it('should format pack data with channel 1', () => {
      const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b])
      const result = formatSideBandPacket(SideBandChannel.PackData, packData)

      expect(result[0]).toBe(0x01)
      expect(result.slice(1)).toEqual(packData)
    })

    it('should format progress message with channel 2', () => {
      const progress = encoder.encode('Progress...')
      const result = formatSideBandPacket(SideBandChannel.Progress, progress)

      expect(result[0]).toBe(0x02)
    })

    it('should format error message with channel 3', () => {
      const error = encoder.encode('Error!')
      const result = formatSideBandPacket(SideBandChannel.Error, error)

      expect(result[0]).toBe(0x03)
    })
  })

  describe('demultiplexSideBand', () => {
    it('should demultiplex stream of side-band packets', () => {
      // Create a stream with pack data and progress
      const packPkt = formatSideBandPacket(SideBandChannel.PackData, encoder.encode('data'))
      const progressPkt = formatSideBandPacket(SideBandChannel.Progress, encoder.encode('progress\n'))

      const stream = new Uint8Array([
        ...encoder.encode(encodePktLine(packPkt) as string),
        ...encoder.encode(encodePktLine(progressPkt) as string),
        ...encoder.encode(FLUSH_PKT),
      ])

      const result = demultiplexSideBand(stream)

      expect(result.packData.length).toBeGreaterThan(0)
      expect(result.progress.length).toBeGreaterThan(0)
      expect(result.errors.length).toBe(0)
    })

    it('should collect all pack data chunks', () => {
      const chunk1 = formatSideBandPacket(SideBandChannel.PackData, encoder.encode('chunk1'))
      const chunk2 = formatSideBandPacket(SideBandChannel.PackData, encoder.encode('chunk2'))

      const stream = new Uint8Array([
        ...encoder.encode(encodePktLine(chunk1) as string),
        ...encoder.encode(encodePktLine(chunk2) as string),
        ...encoder.encode(FLUSH_PKT),
      ])

      const result = demultiplexSideBand(stream)

      const combined = decoder.decode(result.packData)
      expect(combined).toContain('chunk1')
      expect(combined).toContain('chunk2')
    })

    it('should collect progress messages', () => {
      const progress1 = formatSideBandPacket(SideBandChannel.Progress, encoder.encode('Counting objects: 50%\n'))
      const progress2 = formatSideBandPacket(SideBandChannel.Progress, encoder.encode('Counting objects: 100%\n'))

      const stream = new Uint8Array([
        ...encoder.encode(encodePktLine(progress1) as string),
        ...encoder.encode(encodePktLine(progress2) as string),
        ...encoder.encode(FLUSH_PKT),
      ])

      const result = demultiplexSideBand(stream)

      expect(result.progress).toHaveLength(2)
      expect(result.progress[0]).toContain('50%')
      expect(result.progress[1]).toContain('100%')
    })

    it('should collect error messages', () => {
      const error = formatSideBandPacket(SideBandChannel.Error, encoder.encode('fatal: repository not found\n'))

      const stream = new Uint8Array([
        ...encoder.encode(encodePktLine(error) as string),
        ...encoder.encode(FLUSH_PKT),
      ])

      const result = demultiplexSideBand(stream)

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('repository not found')
    })
  })

  describe('SideBandChannel enum', () => {
    it('should have correct channel values', () => {
      expect(SideBandChannel.PackData).toBe(1)
      expect(SideBandChannel.Progress).toBe(2)
      expect(SideBandChannel.Error).toBe(3)
    })
  })
})

// =============================================================================
// 7. Shallow/Unshallow Handling Tests
// =============================================================================

describe('Shallow/Unshallow Handling', () => {
  describe('parseShallowLine', () => {
    it('should parse shallow line', () => {
      const line = `shallow ${SHA1_COMMIT_A}`
      const result = parseShallowLine(line)

      expect(result.type).toBe('shallow')
      expect(result.sha).toBe(SHA1_COMMIT_A)
    })

    it('should handle trailing newline', () => {
      const line = `shallow ${SHA1_COMMIT_A}\n`
      const result = parseShallowLine(line)

      expect(result.sha).toBe(SHA1_COMMIT_A)
    })

    it('should throw for invalid format', () => {
      expect(() => parseShallowLine('invalid')).toThrow(WireProtocolError)
    })

    it('should throw for invalid SHA', () => {
      expect(() => parseShallowLine('shallow bad')).toThrow(WireProtocolError)
    })
  })

  describe('parseUnshallowLine', () => {
    it('should parse unshallow line', () => {
      const line = `unshallow ${SHA1_COMMIT_B}`
      const result = parseUnshallowLine(line)

      expect(result.type).toBe('unshallow')
      expect(result.sha).toBe(SHA1_COMMIT_B)
    })

    it('should handle trailing newline', () => {
      const line = `unshallow ${SHA1_COMMIT_B}\n`
      const result = parseUnshallowLine(line)

      expect(result.sha).toBe(SHA1_COMMIT_B)
    })
  })

  describe('formatShallowLine', () => {
    it('should format shallow line', () => {
      const result = formatShallowLine(SHA1_COMMIT_A)

      expect(result).toBe(`shallow ${SHA1_COMMIT_A}\n`)
    })

    it('should use lowercase SHA', () => {
      const result = formatShallowLine(SHA1_COMMIT_A.toUpperCase())

      expect(result).toBe(`shallow ${SHA1_COMMIT_A.toLowerCase()}\n`)
    })
  })

  describe('formatUnshallowLine', () => {
    it('should format unshallow line', () => {
      const result = formatUnshallowLine(SHA1_COMMIT_B)

      expect(result).toBe(`unshallow ${SHA1_COMMIT_B}\n`)
    })
  })

  describe('ShallowUpdate type', () => {
    it('should distinguish shallow from unshallow', () => {
      const shallow: ShallowUpdate = { type: 'shallow', sha: SHA1_COMMIT_A }
      const unshallow: ShallowUpdate = { type: 'unshallow', sha: SHA1_COMMIT_B }

      expect(shallow.type).toBe('shallow')
      expect(unshallow.type).toBe('unshallow')
    })
  })
})

// =============================================================================
// 8. Info/Refs Response Parsing Tests
// =============================================================================

describe('Info/Refs Response Parsing', () => {
  describe('parseInfoRefsResponse', () => {
    it('should parse service header', () => {
      const response =
        '001e# service=git-upload-pack\n' +
        '0000' +
        `003f${SHA1_COMMIT_A} refs/heads/main\0side-band-64k\n` +
        '0000'

      const result = parseInfoRefsResponse(response)

      expect(result.service).toBe('git-upload-pack')
    })

    it('should parse refs after service flush', () => {
      const response =
        '001e# service=git-upload-pack\n' +
        '0000' +
        `003f${SHA1_COMMIT_A} refs/heads/main\0thin-pack\n` +
        `003d${SHA1_COMMIT_B} refs/heads/feature\n` +
        '0000'

      const result = parseInfoRefsResponse(response)

      expect(result.refs).toHaveLength(2)
      expect(result.refs[0].ref).toBe('refs/heads/main')
      expect(result.refs[1].ref).toBe('refs/heads/feature')
    })

    it('should extract capabilities from first ref', () => {
      const response =
        '001e# service=git-upload-pack\n' +
        '0000' +
        `0045${SHA1_COMMIT_A} refs/heads/main\0multi_ack thin-pack\n` +
        '0000'

      const result = parseInfoRefsResponse(response)

      expect(result.capabilities.has('multi_ack')).toBe(true)
      expect(result.capabilities.has('thin-pack')).toBe(true)
    })

    it('should parse peeled refs', () => {
      const response =
        '001e# service=git-upload-pack\n' +
        '0000' +
        `003f${SHA1_COMMIT_A} refs/heads/main\0\n` +
        `003b${SHA1_TAG_1} refs/tags/v1.0.0\n` +
        `003f${SHA1_COMMIT_C} refs/tags/v1.0.0^{}\n` +
        '0000'

      const result = parseInfoRefsResponse(response)

      expect(result.refs).toHaveLength(3)
      const peeled = result.refs.find((r) => r.ref === 'refs/tags/v1.0.0^{}')
      expect(peeled).toBeDefined()
      expect(peeled!.peeled).toBe(true)
    })

    it('should parse git-receive-pack service', () => {
      const response =
        '001f# service=git-receive-pack\n' +
        '0000' +
        `0045${SHA1_COMMIT_A} refs/heads/main\0report-status\n` +
        '0000'

      const result = parseInfoRefsResponse(response)

      expect(result.service).toBe('git-receive-pack')
    })

    it('should handle empty repository', () => {
      const response =
        '001e# service=git-upload-pack\n' +
        '0000' +
        `0044${ZERO_SHA} capabilities^{}\0side-band-64k\n` +
        '0000'

      const result = parseInfoRefsResponse(response)

      expect(result.refs).toHaveLength(0)
      expect(result.capabilities.has('side-band-64k')).toBe(true)
    })

    it('should throw for invalid service line', () => {
      const response = '001einvalid service line\n0000'

      expect(() => parseInfoRefsResponse(response)).toThrow(WireProtocolError)
    })

    it('should throw for missing service flush', () => {
      const response = '001e# service=git-upload-pack\n'

      expect(() => parseInfoRefsResponse(response)).toThrow(WireProtocolError)
    })
  })

  describe('formatInfoRefsResponse', () => {
    it('should include service announcement', () => {
      const info: InfoRefsResponse = {
        service: 'git-upload-pack',
        refs: [{ sha: SHA1_COMMIT_A, ref: 'refs/heads/main' }],
        capabilities: new Map([['side-band-64k', true]]),
      }
      const result = formatInfoRefsResponse(info)

      expect(result).toContain('# service=git-upload-pack')
    })

    it('should include flush after service line', () => {
      const info: InfoRefsResponse = {
        service: 'git-upload-pack',
        refs: [],
        capabilities: new Map(),
      }
      const result = formatInfoRefsResponse(info)

      // Should have two 0000 - one after service, one at end
      const flushCount = (result.match(/0000/g) || []).length
      expect(flushCount).toBeGreaterThanOrEqual(1)
    })

    it('should format all refs with capabilities on first', () => {
      const info: InfoRefsResponse = {
        service: 'git-upload-pack',
        refs: [
          { sha: SHA1_COMMIT_A, ref: 'refs/heads/main' },
          { sha: SHA1_COMMIT_B, ref: 'refs/heads/feature' },
        ],
        capabilities: new Map([['thin-pack', true]]),
      }
      const result = formatInfoRefsResponse(info)

      expect(result).toContain('refs/heads/main')
      expect(result).toContain('refs/heads/feature')
      expect(result).toContain('\0') // NUL byte for capabilities
    })
  })
})

// =============================================================================
// 9. Upload-Pack Request Format Tests
// =============================================================================

describe('Upload-Pack Request Format', () => {
  describe('parseUploadPackRequest', () => {
    it('should parse wants from request', () => {
      const request =
        `0032want ${SHA1_COMMIT_A}\n` +
        `0032want ${SHA1_COMMIT_B}\n` +
        '0000' +
        '0009done\n'

      const result = parseUploadPackRequest(request)

      expect(result.wants).toHaveLength(2)
      expect(result.wants).toContain(SHA1_COMMIT_A)
      expect(result.wants).toContain(SHA1_COMMIT_B)
    })

    it('should parse capabilities from first want', () => {
      const request =
        `003ewant ${SHA1_COMMIT_A} thin-pack\n` +
        '0000' +
        '0009done\n'

      const result = parseUploadPackRequest(request)

      expect(result.capabilities.has('thin-pack')).toBe(true)
    })

    it('should parse haves', () => {
      const request =
        `0032want ${SHA1_COMMIT_A}\n` +
        '0000' +
        `0032have ${SHA1_COMMIT_B}\n` +
        `0032have ${SHA1_COMMIT_C}\n` +
        '0009done\n'

      const result = parseUploadPackRequest(request)

      expect(result.haves).toHaveLength(2)
      expect(result.haves).toContain(SHA1_COMMIT_B)
      expect(result.haves).toContain(SHA1_COMMIT_C)
    })

    it('should detect done flag', () => {
      const requestWithDone =
        `0032want ${SHA1_COMMIT_A}\n` +
        '0000' +
        '0009done\n'

      const requestWithoutDone =
        `0032want ${SHA1_COMMIT_A}\n` +
        '0000' +
        `0032have ${SHA1_COMMIT_B}\n` +
        '0000'

      expect(parseUploadPackRequest(requestWithDone).done).toBe(true)
      expect(parseUploadPackRequest(requestWithoutDone).done).toBe(false)
    })

    it('should parse deepen request', () => {
      const request =
        `0032want ${SHA1_COMMIT_A}\n` +
        '000ddeepen 5\n' +
        '0000' +
        '0009done\n'

      const result = parseUploadPackRequest(request)

      expect(result.depth).toBe(5)
    })

    it('should parse deepen-since', () => {
      const request =
        `0032want ${SHA1_COMMIT_A}\n` +
        '0018deepen-since 1704067200\n' +
        '0000' +
        '0009done\n'

      const result = parseUploadPackRequest(request)

      expect(result.deepenSince).toBe(1704067200)
    })

    it('should parse deepen-not', () => {
      const request =
        `0032want ${SHA1_COMMIT_A}\n` +
        '001fdeepen-not refs/heads/main\n' +
        '0000' +
        '0009done\n'

      const result = parseUploadPackRequest(request)

      expect(result.deepenNot).toContain('refs/heads/main')
    })

    it('should parse shallow lines from client', () => {
      const request =
        `0035shallow ${SHA1_COMMIT_B}\n` +
        `0032want ${SHA1_COMMIT_A}\n` +
        '0000' +
        '0009done\n'

      const result = parseUploadPackRequest(request)

      expect(result.shallows).toContain(SHA1_COMMIT_B)
    })

    it('should parse filter capability', () => {
      const request =
        `003dwant ${SHA1_COMMIT_A} filter\n` +
        '0018filter blob:none\n' +
        '0000' +
        '0009done\n'

      const result = parseUploadPackRequest(request)

      expect(result.filter).toBe('blob:none')
    })

    it('should handle empty haves (clone)', () => {
      const request =
        `0032want ${SHA1_COMMIT_A}\n` +
        '0000' +
        '0009done\n'

      const result = parseUploadPackRequest(request)

      expect(result.haves).toHaveLength(0)
    })
  })

  describe('formatUploadPackRequest', () => {
    it('should format wants with capabilities on first', () => {
      const request: UploadPackRequest = {
        wants: [SHA1_COMMIT_A, SHA1_COMMIT_B],
        haves: [],
        capabilities: new Map([['thin-pack', true]]),
        done: true,
      }
      const result = formatUploadPackRequest(request)

      // First want should have capabilities
      expect(result).toContain('thin-pack')
      // Should contain both wants
      expect(result).toContain(SHA1_COMMIT_A)
      expect(result).toContain(SHA1_COMMIT_B)
    })

    it('should include flush after wants', () => {
      const request: UploadPackRequest = {
        wants: [SHA1_COMMIT_A],
        haves: [],
        capabilities: new Map(),
        done: true,
      }
      const result = formatUploadPackRequest(request)

      expect(result).toContain('0000')
    })

    it('should format haves', () => {
      const request: UploadPackRequest = {
        wants: [SHA1_COMMIT_A],
        haves: [SHA1_COMMIT_B, SHA1_COMMIT_C],
        capabilities: new Map(),
        done: true,
      }
      const result = formatUploadPackRequest(request)

      expect(result).toContain('have ' + SHA1_COMMIT_B)
      expect(result).toContain('have ' + SHA1_COMMIT_C)
    })

    it('should include done when specified', () => {
      const request: UploadPackRequest = {
        wants: [SHA1_COMMIT_A],
        haves: [],
        capabilities: new Map(),
        done: true,
      }
      const result = formatUploadPackRequest(request)

      expect(result).toContain('done')
    })

    it('should not include done when not specified', () => {
      const request: UploadPackRequest = {
        wants: [SHA1_COMMIT_A],
        haves: [SHA1_COMMIT_B],
        capabilities: new Map(),
        done: false,
      }
      const result = formatUploadPackRequest(request)

      expect(result).not.toContain('done')
    })

    it('should format deepen request', () => {
      const request: UploadPackRequest = {
        wants: [SHA1_COMMIT_A],
        haves: [],
        capabilities: new Map([['shallow', true]]),
        done: true,
        depth: 3,
      }
      const result = formatUploadPackRequest(request)

      expect(result).toContain('deepen 3')
    })

    it('should format shallow lines', () => {
      const request: UploadPackRequest = {
        wants: [SHA1_COMMIT_A],
        haves: [],
        capabilities: new Map(),
        done: true,
        shallows: [SHA1_COMMIT_B],
      }
      const result = formatUploadPackRequest(request)

      expect(result).toContain('shallow ' + SHA1_COMMIT_B)
    })
  })
})

// =============================================================================
// 10. Receive-Pack Request Format Tests
// =============================================================================

describe('Receive-Pack Request Format', () => {
  describe('parseReceivePackRequest', () => {
    it('should parse single ref update command', () => {
      const request =
        `0067${ZERO_SHA} ${SHA1_COMMIT_A} refs/heads/main\0report-status side-band-64k\n` +
        '0000'

      const result = parseReceivePackRequest(request)

      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].oldSha).toBe(ZERO_SHA)
      expect(result.commands[0].newSha).toBe(SHA1_COMMIT_A)
      expect(result.commands[0].ref).toBe('refs/heads/main')
    })

    it('should parse multiple ref update commands', () => {
      const request =
        `0067${ZERO_SHA} ${SHA1_COMMIT_A} refs/heads/main\0report-status\n` +
        `0059${ZERO_SHA} ${SHA1_COMMIT_B} refs/heads/feature\n` +
        '0000'

      const result = parseReceivePackRequest(request)

      expect(result.commands).toHaveLength(2)
      expect(result.commands[0].ref).toBe('refs/heads/main')
      expect(result.commands[1].ref).toBe('refs/heads/feature')
    })

    it('should parse capabilities from first command', () => {
      const request =
        `006d${ZERO_SHA} ${SHA1_COMMIT_A} refs/heads/main\0report-status atomic\n` +
        `0059${ZERO_SHA} ${SHA1_COMMIT_B} refs/heads/feature\n` +
        '0000'

      const result = parseReceivePackRequest(request)

      expect(result.capabilities.has('report-status')).toBe(true)
      expect(result.capabilities.has('atomic')).toBe(true)
    })

    it('should detect create command (oldSha = ZERO_SHA)', () => {
      const request =
        `0067${ZERO_SHA} ${SHA1_COMMIT_A} refs/heads/new-branch\0report-status\n` +
        '0000'

      const result = parseReceivePackRequest(request)

      expect(result.commands[0].type).toBe('create')
    })

    it('should detect update command (both SHAs non-zero)', () => {
      const request =
        `0067${SHA1_COMMIT_A} ${SHA1_COMMIT_B} refs/heads/main\0report-status\n` +
        '0000'

      const result = parseReceivePackRequest(request)

      expect(result.commands[0].type).toBe('update')
    })

    it('should detect delete command (newSha = ZERO_SHA)', () => {
      const request =
        `0067${SHA1_COMMIT_A} ${ZERO_SHA} refs/heads/old-branch\0delete-refs\n` +
        '0000'

      const result = parseReceivePackRequest(request)

      expect(result.commands[0].type).toBe('delete')
    })

    it('should extract packfile data after commands', () => {
      const packHeader = new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0x00, 0x00, 0x00, 0x02])
      const commandPart = `0067${ZERO_SHA} ${SHA1_COMMIT_A} refs/heads/main\0report-status\n0000`

      const request = new Uint8Array([
        ...encoder.encode(commandPart),
        ...packHeader,
      ])

      const result = parseReceivePackRequest(request)

      expect(result.packfile).toBeDefined()
      expect(result.packfile![0]).toBe(0x50) // 'P'
      expect(result.packfile![1]).toBe(0x41) // 'A'
      expect(result.packfile![2]).toBe(0x43) // 'C'
      expect(result.packfile![3]).toBe(0x4b) // 'K'
    })

    it('should handle delete without packfile', () => {
      const request =
        `0067${SHA1_COMMIT_A} ${ZERO_SHA} refs/heads/branch\0delete-refs\n` +
        '0000'

      const result = parseReceivePackRequest(request)

      expect(result.packfile).toBeUndefined()
    })

    it('should parse push options when enabled', () => {
      const request =
        `006d${ZERO_SHA} ${SHA1_COMMIT_A} refs/heads/main\0push-options report-status\n` +
        '0000' +
        '0013ci.skip=true\n' +
        '0014deploy=staging\n' +
        '0000'

      const result = parseReceivePackRequest(request)

      expect(result.pushOptions).toBeDefined()
      expect(result.pushOptions).toContain('ci.skip=true')
      expect(result.pushOptions).toContain('deploy=staging')
    })
  })

  describe('formatReceivePackRequest', () => {
    it('should format single command with capabilities', () => {
      const request: ReceivePackRequest = {
        commands: [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_A, ref: 'refs/heads/main', type: 'create' },
        ],
        capabilities: new Map([['report-status', true]]),
      }
      const result = formatReceivePackRequest(request)

      expect(result).toContain(ZERO_SHA)
      expect(result).toContain(SHA1_COMMIT_A)
      expect(result).toContain('refs/heads/main')
      expect(result).toContain('report-status')
    })

    it('should format multiple commands', () => {
      const request: ReceivePackRequest = {
        commands: [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_A, ref: 'refs/heads/main', type: 'create' },
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_B, ref: 'refs/heads/feature', type: 'create' },
        ],
        capabilities: new Map([['report-status', true]]),
      }
      const result = formatReceivePackRequest(request)

      expect(result).toContain('refs/heads/main')
      expect(result).toContain('refs/heads/feature')
    })

    it('should include capabilities only on first command', () => {
      const request: ReceivePackRequest = {
        commands: [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_A, ref: 'refs/heads/main', type: 'create' },
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_B, ref: 'refs/heads/feature', type: 'create' },
        ],
        capabilities: new Map([['report-status', true]]),
      }
      const result = formatReceivePackRequest(request)

      // Only one NUL byte (capabilities separator)
      const nulCount = (result.match(/\0/g) || []).length
      expect(nulCount).toBe(1)
    }
    )

    it('should include flush after commands', () => {
      const request: ReceivePackRequest = {
        commands: [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_A, ref: 'refs/heads/main', type: 'create' },
        ],
        capabilities: new Map(),
      }
      const result = formatReceivePackRequest(request)

      expect(result).toContain('0000')
    })

    it('should format push options', () => {
      const request: ReceivePackRequest = {
        commands: [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_A, ref: 'refs/heads/main', type: 'create' },
        ],
        capabilities: new Map([['push-options', true]]),
        pushOptions: ['ci.skip=true', 'deploy=staging'],
      }
      const result = formatReceivePackRequest(request)

      expect(result).toContain('ci.skip=true')
      expect(result).toContain('deploy=staging')
    })
  })

  describe('RefUpdateCommand type', () => {
    it('should have create type for new refs', () => {
      const cmd: RefUpdateCommand = {
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_A,
        ref: 'refs/heads/new',
        type: 'create',
      }
      expect(cmd.type).toBe('create')
    })

    it('should have update type for existing refs', () => {
      const cmd: RefUpdateCommand = {
        oldSha: SHA1_COMMIT_A,
        newSha: SHA1_COMMIT_B,
        ref: 'refs/heads/main',
        type: 'update',
      }
      expect(cmd.type).toBe('update')
    })

    it('should have delete type for removed refs', () => {
      const cmd: RefUpdateCommand = {
        oldSha: SHA1_COMMIT_A,
        newSha: ZERO_SHA,
        ref: 'refs/heads/old',
        type: 'delete',
      }
      expect(cmd.type).toBe('delete')
    })
  })
})

// =============================================================================
// Protocol Error Classes Tests
// =============================================================================

describe('Protocol Error Classes', () => {
  describe('WireProtocolError', () => {
    it('should be an instance of Error', () => {
      const error = new WireProtocolError('test error')
      expect(error).toBeInstanceOf(Error)
    })

    it('should have correct name', () => {
      const error = new WireProtocolError('test error')
      expect(error.name).toBe('WireProtocolError')
    })

    it('should have correct message', () => {
      const error = new WireProtocolError('specific error message')
      expect(error.message).toBe('specific error message')
    })
  })

  describe('PktLineError', () => {
    it('should be an instance of WireProtocolError', () => {
      const error = new PktLineError('pkt-line error')
      expect(error).toBeInstanceOf(WireProtocolError)
    })

    it('should have correct name', () => {
      const error = new PktLineError('pkt-line error')
      expect(error.name).toBe('PktLineError')
    })
  })

  describe('CapabilityError', () => {
    it('should be an instance of WireProtocolError', () => {
      const error = new CapabilityError('capability error')
      expect(error).toBeInstanceOf(WireProtocolError)
    })

    it('should have correct name', () => {
      const error = new CapabilityError('capability error')
      expect(error.name).toBe('CapabilityError')
    })
  })

  describe('NegotiationError', () => {
    it('should be an instance of WireProtocolError', () => {
      const error = new NegotiationError('negotiation error')
      expect(error).toBeInstanceOf(WireProtocolError)
    })

    it('should have correct name', () => {
      const error = new NegotiationError('negotiation error')
      expect(error.name).toBe('NegotiationError')
    })
  })
})

// =============================================================================
// Integration-like Tests
// =============================================================================

describe('Protocol Integration', () => {
  describe('Full upload-pack flow', () => {
    it('should parse and reformat info/refs response', () => {
      const response =
        '001e# service=git-upload-pack\n' +
        '0000' +
        `0053${SHA1_COMMIT_A} refs/heads/main\0multi_ack thin-pack side-band-64k\n` +
        `003d${SHA1_COMMIT_B} refs/heads/feature\n` +
        '0000'

      const parsed = parseInfoRefsResponse(response)
      const reformatted = formatInfoRefsResponse(parsed)

      expect(reformatted).toContain('# service=git-upload-pack')
      expect(reformatted).toContain('refs/heads/main')
      expect(reformatted).toContain('refs/heads/feature')
    })

    it('should parse and reformat upload-pack request', () => {
      const request =
        `003ewant ${SHA1_COMMIT_A} thin-pack\n` +
        `0032want ${SHA1_COMMIT_B}\n` +
        '0000' +
        `0032have ${SHA1_COMMIT_C}\n` +
        '0009done\n'

      const parsed = parseUploadPackRequest(request)
      const reformatted = formatUploadPackRequest(parsed)

      expect(reformatted).toContain(`want ${SHA1_COMMIT_A}`)
      expect(reformatted).toContain(`want ${SHA1_COMMIT_B}`)
      expect(reformatted).toContain(`have ${SHA1_COMMIT_C}`)
      expect(reformatted).toContain('done')
    })
  })

  describe('Full receive-pack flow', () => {
    it('should parse and reformat receive-pack request', () => {
      const request =
        `006d${ZERO_SHA} ${SHA1_COMMIT_A} refs/heads/main\0report-status atomic\n` +
        `0059${ZERO_SHA} ${SHA1_COMMIT_B} refs/heads/feature\n` +
        '0000'

      const parsed = parseReceivePackRequest(request)
      const reformatted = formatReceivePackRequest(parsed)

      expect(reformatted).toContain('refs/heads/main')
      expect(reformatted).toContain('refs/heads/feature')
      expect(reformatted).toContain('report-status')
    })
  })

  describe('Encoding round-trip', () => {
    it('should encode and decode pkt-line correctly', () => {
      const original = 'test data with special chars: \t\n'
      const encoded = encodePktLine(original)
      const decoded = decodePktLine(encoded)

      expect(decoded.data).toBe(original)
    })

    it('should encode and decode binary data correctly', () => {
      const original = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe])
      const encoded = encodePktLine(original)
      const decoded = decodePktLine(encoded)

      expect(new Uint8Array(decoded.data as any)).toEqual(original)
    })
  })
})
