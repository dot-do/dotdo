/**
 * Message Encoder/Decoder
 *
 * Handles serialization of messages for WebSocket transmission.
 * Uses JSON for simplicity, but can be extended for binary encoding.
 */

import type { Message } from './messages'
import { LIMITS } from './constants'

// ============================================================================
// JSON Encoding (Default)
// ============================================================================

export function encodeMessage(message: Message): string {
  const json = JSON.stringify(message)

  if (json.length > LIMITS.MAX_MESSAGE_SIZE) {
    throw new Error(`Message too large: ${json.length} bytes (max: ${LIMITS.MAX_MESSAGE_SIZE})`)
  }

  return json
}

export function decodeMessage(data: string | ArrayBuffer): Message {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data)

  try {
    return JSON.parse(text) as Message
  } catch (error) {
    throw new Error(`Invalid message format: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// ============================================================================
// Binary Encoding (Optional, for better performance)
// ============================================================================

/**
 * Encode message to binary format using a simple TLV (Type-Length-Value) scheme
 * Format: [type: 1 byte][length: 4 bytes][JSON payload: variable]
 */
export function encodeBinaryMessage(message: Message): Uint8Array {
  const json = JSON.stringify(message)
  const jsonBytes = new TextEncoder().encode(json)

  const typeCode = getMessageTypeCode(message.type)
  const buffer = new Uint8Array(5 + jsonBytes.length)

  // Type byte
  buffer[0] = typeCode

  // Length (4 bytes, big-endian)
  const view = new DataView(buffer.buffer)
  view.setUint32(1, jsonBytes.length)

  // Payload
  buffer.set(jsonBytes, 5)

  return buffer
}

/**
 * Decode binary message
 */
export function decodeBinaryMessage(data: ArrayBuffer): Message {
  const view = new DataView(data)
  const buffer = new Uint8Array(data)

  // Read type (ignored for now, JSON includes it)
  // const typeCode = buffer[0]

  // Read length
  const length = view.getUint32(1)

  // Read payload
  const payload = buffer.slice(5, 5 + length)
  const json = new TextDecoder().decode(payload)

  return JSON.parse(json) as Message
}

/**
 * Get numeric code for message type (for binary encoding)
 */
function getMessageTypeCode(type: string): number {
  const types: Record<string, number> = {
    // Connection (0x00 - 0x0F)
    connect: 0x00,
    connected: 0x01,
    disconnect: 0x02,
    ping: 0x03,
    pong: 0x04,
    error: 0x0f,
    // Sync (0x10 - 0x1F)
    'sync:request': 0x10,
    'sync:response': 0x11,
    'sync:update': 0x12,
    'sync:ack': 0x13,
    // Presence (0x20 - 0x2F)
    'presence:join': 0x20,
    'presence:leave': 0x21,
    'presence:update': 0x22,
    'presence:sync': 0x23,
    // Cursor (0x30 - 0x3F)
    'cursor:update': 0x30,
    'cursor:sync': 0x31,
    // Channel (0x40 - 0x4F)
    'channel:subscribe': 0x40,
    'channel:unsubscribe': 0x41,
    'channel:message': 0x42,
    'channel:history': 0x43,
    'channel:typing': 0x44,
    // Whiteboard (0x50 - 0x5F)
    'whiteboard:draw': 0x50,
    'whiteboard:update': 0x51,
    'whiteboard:delete': 0x52,
    'whiteboard:lock': 0x53,
    'whiteboard:unlock': 0x54,
    'whiteboard:sync': 0x55,
  }

  return types[type] ?? 0xff
}

// ============================================================================
// Message Batching
// ============================================================================

export interface MessageBatch {
  messages: Message[]
  timestamp: number
}

/**
 * Batch multiple messages into a single transmission
 */
export function batchMessages(messages: Message[]): MessageBatch {
  if (messages.length > LIMITS.MAX_BATCH_SIZE) {
    throw new Error(`Too many messages in batch: ${messages.length} (max: ${LIMITS.MAX_BATCH_SIZE})`)
  }

  return {
    messages,
    timestamp: Date.now(),
  }
}

/**
 * Encode a batch of messages
 */
export function encodeBatch(batch: MessageBatch): string {
  return JSON.stringify(batch)
}

/**
 * Decode a batch of messages
 */
export function decodeBatch(data: string): MessageBatch {
  return JSON.parse(data) as MessageBatch
}

// ============================================================================
// Compression (Optional)
// ============================================================================

/**
 * Compress message using CompressionStream (Web API)
 * Only use for large messages as compression has overhead
 */
export async function compressMessage(data: string): Promise<Uint8Array> {
  const stream = new Blob([data]).stream()
  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'))
  const chunks: Uint8Array[] = []

  const reader = compressedStream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  // Concatenate chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

/**
 * Decompress message
 */
export async function decompressMessage(data: Uint8Array): Promise<string> {
  const stream = new Blob([data]).stream()
  const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'))
  const chunks: Uint8Array[] = []

  const reader = decompressedStream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  // Concatenate and decode
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return new TextDecoder().decode(result)
}
