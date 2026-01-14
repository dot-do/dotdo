import { describe, it, expect } from 'vitest'
import {
  encodePktLine,
  decodePktLine,
  encodeFlushPkt,
  encodeDelimPkt,
  pktLineStream,
  FLUSH_PKT,
  DELIM_PKT,
  MAX_PKT_LINE_DATA,
} from '../../src/wire/pkt-line'

describe('pkt-line', () => {
  describe('encodePktLine', () => {
    it('should encode a simple string', () => {
      const result = encodePktLine('hello')
      // 4 bytes for length + 5 bytes for 'hello' = 9 = 0009
      expect(result).toBe('0009hello')
    })

    it('should encode a string with newline', () => {
      const result = encodePktLine('hello\n')
      // 4 bytes for length + 6 bytes = 10 = 000a
      expect(result).toBe('000ahello\n')
    })

    it('should encode an empty string', () => {
      const result = encodePktLine('')
      // 4 bytes for length + 0 bytes = 4 = 0004
      expect(result).toBe('0004')
    })

    it('should handle longer strings', () => {
      const data = 'a'.repeat(100)
      const result = encodePktLine(data)
      // 4 + 100 = 104 = 0x68
      expect(result).toBe('0068' + data)
    })

    it('should encode Uint8Array data', () => {
      const data = new TextEncoder().encode('test')
      const result = encodePktLine(data)
      // 4 + 4 = 8 = 0008
      expect(result).toBe('0008test')
    })

    it('should handle binary data with Uint8Array', () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0xff])
      const result = encodePktLine(data)
      // Returns Uint8Array for binary data
      expect(result).toBeInstanceOf(Uint8Array)
      // 4 hex chars + 4 bytes = check first 4 bytes are '0008'
      const decoded = new TextDecoder().decode((result as Uint8Array).slice(0, 4))
      expect(decoded).toBe('0008')
    })
  })

  describe('decodePktLine', () => {
    it('should decode a simple pkt-line', () => {
      const result = decodePktLine('0009hello')
      expect(result).toEqual({ data: 'hello', bytesRead: 9 })
    })

    it('should decode a pkt-line with newline', () => {
      const result = decodePktLine('000ahello\n')
      expect(result).toEqual({ data: 'hello\n', bytesRead: 10 })
    })

    it('should decode an empty data pkt-line', () => {
      const result = decodePktLine('0004')
      expect(result).toEqual({ data: '', bytesRead: 4 })
    })

    it('should detect flush-pkt', () => {
      const result = decodePktLine('0000')
      expect(result).toEqual({ data: null, type: 'flush', bytesRead: 4 })
    })

    it('should detect delim-pkt', () => {
      const result = decodePktLine('0001')
      expect(result).toEqual({ data: null, type: 'delim', bytesRead: 4 })
    })

    it('should decode from Uint8Array', () => {
      const input = new TextEncoder().encode('0009hello')
      const result = decodePktLine(input)
      expect(result.data).toBe('hello')
      expect(result.bytesRead).toBe(9)
    })

    it('should handle incomplete data', () => {
      const result = decodePktLine('000')
      expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
    })

    it('should handle data shorter than declared length', () => {
      const result = decodePktLine('0009hel')
      expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
    })

    it('should throw error for oversized packets', () => {
      // Create a hex length that exceeds MAX_PKT_LINE_DATA + 4 (65520)
      // ffff = 65535 which exceeds the maximum
      const oversizedPacket = 'ffff' + 'x'.repeat(65535 - 4)
      expect(() => decodePktLine(oversizedPacket)).toThrow(
        `Packet too large: 65535 bytes exceeds maximum ${MAX_PKT_LINE_DATA + 4}`
      )
    })

    it('should accept packets at maximum allowed size', () => {
      // MAX_PKT_LINE_DATA + 4 = 65520, which in hex is fff0
      const maxLength = MAX_PKT_LINE_DATA + 4
      const hexLength = maxLength.toString(16).padStart(4, '0')
      // We don't need the full data, just check it doesn't throw
      // It will return incomplete since we don't have enough data
      const packet = hexLength + 'x'.repeat(10)
      const result = decodePktLine(packet)
      expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
    })
  })

  describe('encodeFlushPkt', () => {
    it('should return flush packet constant', () => {
      expect(encodeFlushPkt()).toBe('0000')
    })

    it('should equal FLUSH_PKT constant', () => {
      expect(encodeFlushPkt()).toBe(FLUSH_PKT)
    })
  })

  describe('encodeDelimPkt', () => {
    it('should return delim packet constant', () => {
      expect(encodeDelimPkt()).toBe('0001')
    })

    it('should equal DELIM_PKT constant', () => {
      expect(encodeDelimPkt()).toBe(DELIM_PKT)
    })
  })

  describe('pktLineStream', () => {
    it('should parse multiple pkt-lines', () => {
      const input = '0009hello0009world0000'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([
        { data: 'hello', type: 'data' },
        { data: 'world', type: 'data' },
        { data: null, type: 'flush' },
      ])
      expect(result.remaining).toBe('')
    })

    it('should handle incomplete trailing data', () => {
      const input = '0009hello0009wor'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([{ data: 'hello', type: 'data' }])
      expect(result.remaining).toBe('0009wor')
    })

    it('should handle empty input', () => {
      const result = pktLineStream('')
      expect(result.packets).toEqual([])
      expect(result.remaining).toBe('')
    })

    it('should parse from Uint8Array', () => {
      const input = new TextEncoder().encode('0009hello0000')
      const result = pktLineStream(input)
      expect(result.packets).toEqual([
        { data: 'hello', type: 'data' },
        { data: null, type: 'flush' },
      ])
    })

    it('should handle delim packets in stream', () => {
      const input = '0009hello00010009world0000'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([
        { data: 'hello', type: 'data' },
        { data: null, type: 'delim' },
        { data: 'world', type: 'data' },
        { data: null, type: 'flush' },
      ])
    })

    it('should handle real git protocol example', () => {
      // Example: git capabilities advertisement
      const input = '000eversion 2\n0000'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([
        { data: 'version 2\n', type: 'data' },
        { data: null, type: 'flush' },
      ])
    })
  })
})
