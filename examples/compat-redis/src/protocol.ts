/**
 * RESP (Redis Serialization Protocol) Parser
 * Supports RESP2 and RESP3 protocols for Redis CLI compatibility
 */

export type RedisValue = string | number | null | RedisValue[] | Map<string, RedisValue>

// RESP type prefixes
const SIMPLE_STRING = '+'
const ERROR = '-'
const INTEGER = ':'
const BULK_STRING = '$'
const ARRAY = '*'
const NULL = '_'
const BOOLEAN = '#'
const DOUBLE = ','
const BIG_NUMBER = '('
const BULK_ERROR = '!'
const VERBATIM_STRING = '='
const MAP = '%'
const SET = '~'
const PUSH = '>'

export class RedisProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RedisProtocolError'
  }
}

/**
 * Parse RESP protocol data into JavaScript values
 */
export function parseRESP(data: string | ArrayBuffer): { value: RedisValue; remaining: string } {
  const str = typeof data === 'string' ? data : new TextDecoder().decode(data)
  return parseValue(str)
}

function parseValue(data: string): { value: RedisValue; remaining: string } {
  if (data.length === 0) {
    throw new RedisProtocolError('Empty input')
  }

  const type = data[0]
  const rest = data.slice(1)

  switch (type) {
    case SIMPLE_STRING:
      return parseSimpleString(rest)
    case ERROR:
      return parseError(rest)
    case INTEGER:
      return parseInteger(rest)
    case BULK_STRING:
      return parseBulkString(rest)
    case ARRAY:
      return parseArray(rest)
    case NULL:
      return parseNull(rest)
    case BOOLEAN:
      return parseBoolean(rest)
    case DOUBLE:
      return parseDouble(rest)
    case BIG_NUMBER:
      return parseBigNumber(rest)
    case MAP:
      return parseMap(rest)
    case SET:
      return parseSet(rest)
    default:
      // Inline command (plain text separated by spaces, ending with \r\n)
      return parseInlineCommand(data)
  }
}

function parseSimpleString(data: string): { value: string; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) throw new RedisProtocolError('Missing CRLF in simple string')
  return { value: data.slice(0, end), remaining: data.slice(end + 2) }
}

function parseError(data: string): { value: RedisValue; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) throw new RedisProtocolError('Missing CRLF in error')
  throw new RedisProtocolError(data.slice(0, end))
}

function parseInteger(data: string): { value: number; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) throw new RedisProtocolError('Missing CRLF in integer')
  return { value: parseInt(data.slice(0, end), 10), remaining: data.slice(end + 2) }
}

function parseBulkString(data: string): { value: string | null; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) throw new RedisProtocolError('Missing CRLF in bulk string length')

  const length = parseInt(data.slice(0, end), 10)
  if (length === -1) {
    return { value: null, remaining: data.slice(end + 2) }
  }

  const start = end + 2
  const value = data.slice(start, start + length)
  const remaining = data.slice(start + length + 2) // Skip value + CRLF

  return { value, remaining }
}

function parseArray(data: string): { value: RedisValue[] | null; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) throw new RedisProtocolError('Missing CRLF in array length')

  const count = parseInt(data.slice(0, end), 10)
  if (count === -1) {
    return { value: null, remaining: data.slice(end + 2) }
  }

  const result: RedisValue[] = []
  let remaining = data.slice(end + 2)

  for (let i = 0; i < count; i++) {
    const parsed = parseValue(remaining)
    result.push(parsed.value)
    remaining = parsed.remaining
  }

  return { value: result, remaining }
}

function parseNull(data: string): { value: null; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) throw new RedisProtocolError('Missing CRLF in null')
  return { value: null, remaining: data.slice(end + 2) }
}

function parseBoolean(data: string): { value: number; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) throw new RedisProtocolError('Missing CRLF in boolean')
  const char = data[0]
  return { value: char === 't' ? 1 : 0, remaining: data.slice(end + 2) }
}

function parseDouble(data: string): { value: number; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) throw new RedisProtocolError('Missing CRLF in double')
  return { value: parseFloat(data.slice(0, end)), remaining: data.slice(end + 2) }
}

function parseBigNumber(data: string): { value: number; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) throw new RedisProtocolError('Missing CRLF in big number')
  return { value: parseInt(data.slice(0, end), 10), remaining: data.slice(end + 2) }
}

function parseMap(data: string): { value: Map<string, RedisValue>; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) throw new RedisProtocolError('Missing CRLF in map length')

  const count = parseInt(data.slice(0, end), 10)
  const result = new Map<string, RedisValue>()
  let remaining = data.slice(end + 2)

  for (let i = 0; i < count; i++) {
    const keyParsed = parseValue(remaining)
    const valueParsed = parseValue(keyParsed.remaining)
    result.set(String(keyParsed.value), valueParsed.value)
    remaining = valueParsed.remaining
  }

  return { value: result, remaining }
}

function parseSet(data: string): { value: RedisValue[]; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) throw new RedisProtocolError('Missing CRLF in set length')

  const count = parseInt(data.slice(0, end), 10)
  const result: RedisValue[] = []
  let remaining = data.slice(end + 2)

  for (let i = 0; i < count; i++) {
    const parsed = parseValue(remaining)
    result.push(parsed.value)
    remaining = parsed.remaining
  }

  return { value: result, remaining }
}

function parseInlineCommand(data: string): { value: RedisValue[]; remaining: string } {
  const end = data.indexOf('\r\n')
  if (end === -1) {
    // Try to parse as space-separated command without CRLF
    const parts = data.trim().split(/\s+/)
    return { value: parts, remaining: '' }
  }
  const line = data.slice(0, end)
  const parts = line.split(/\s+/).filter((p) => p.length > 0)
  return { value: parts, remaining: data.slice(end + 2) }
}

/**
 * Encode JavaScript value to RESP protocol
 */
export function encodeRESP(value: RedisValue): string {
  if (value === null || value === undefined) {
    return '$-1\r\n' // Null bulk string
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return `:${value}\r\n`
    }
    return `,${value}\r\n` // Double
  }

  if (typeof value === 'string') {
    // Use bulk string for safety with special characters
    return `$${Buffer.byteLength(value)}\r\n${value}\r\n`
  }

  if (Array.isArray(value)) {
    const parts = value.map((v) => encodeRESP(v))
    return `*${value.length}\r\n${parts.join('')}`
  }

  if (value instanceof Map) {
    const parts: string[] = []
    for (const [k, v] of value) {
      parts.push(encodeRESP(k))
      parts.push(encodeRESP(v))
    }
    return `%${value.size}\r\n${parts.join('')}`
  }

  // Plain objects
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    const parts: string[] = []
    for (const [k, v] of entries) {
      parts.push(encodeRESP(k))
      parts.push(encodeRESP(v as RedisValue))
    }
    return `%${entries.length}\r\n${parts.join('')}`
  }

  return `$-1\r\n`
}

/**
 * Encode a simple string response (no special chars allowed)
 */
export function encodeSimpleString(value: string): string {
  return `+${value}\r\n`
}

/**
 * Encode an error response
 */
export function encodeError(message: string, type = 'ERR'): string {
  return `-${type} ${message}\r\n`
}

/**
 * Encode OK response
 */
export function encodeOK(): string {
  return '+OK\r\n'
}

/**
 * Encode PONG response
 */
export function encodePong(): string {
  return '+PONG\r\n'
}

/**
 * Parse a Redis command from RESP or inline format
 * Returns [command, ...args]
 */
export function parseCommand(data: string | ArrayBuffer): string[] {
  const { value } = parseRESP(data)

  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? ''))
  }

  if (typeof value === 'string') {
    return [value]
  }

  throw new RedisProtocolError('Invalid command format')
}

/**
 * Build a RESP command (for client use)
 */
export function buildCommand(args: string[]): string {
  return encodeRESP(args)
}
