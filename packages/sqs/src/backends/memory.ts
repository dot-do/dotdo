/**
 * @dotdo/sqs - In-memory backend
 *
 * Provides in-memory storage for SQS queues and messages.
 * Suitable for testing, development, and edge environments.
 */

import type { MessageAttributes } from '../types'

// ============================================================================
// IN-MEMORY STORAGE TYPES
// ============================================================================

/**
 * Internal message structure with visibility tracking
 */
export interface InternalMessage {
  messageId: string
  body: string
  md5OfBody: string
  attributes?: MessageAttributes
  md5OfAttributes?: string
  sentTimestamp: number
  approximateReceiveCount: number
  approximateFirstReceiveTimestamp?: number
  visibleAt: number
  receiptHandle?: string
  messageGroupId?: string
  messageDeduplicationId?: string
  sequenceNumber?: string
}

/**
 * Queue data structure
 */
export interface QueueData {
  name: string
  url: string
  arn: string
  createdTimestamp: number
  lastModifiedTimestamp: number
  visibilityTimeout: number
  messageRetentionPeriod: number
  maximumMessageSize: number
  delaySeconds: number
  receiveMessageWaitTimeSeconds: number
  fifoQueue: boolean
  contentBasedDeduplication: boolean
  messages: Map<string, InternalMessage>
  deadLetterQueue?: string
  tags: Record<string, string>
  purgeInProgress: boolean
}

// ============================================================================
// GLOBAL STORAGE
// ============================================================================

/**
 * Global in-memory storage for all queues
 */
const globalQueues = new Map<string, QueueData>()

// ============================================================================
// STORAGE ACCESS
// ============================================================================

/**
 * Get all queues
 */
export function getQueues(): Map<string, QueueData> {
  return globalQueues
}

/**
 * Get queue by name
 */
export function getQueueByName(name: string): QueueData | undefined {
  return globalQueues.get(name)
}

/**
 * Get queue by URL
 */
export function getQueueByUrl(queueUrl: string): QueueData | undefined {
  for (const [, queue] of globalQueues) {
    if (queue.url === queueUrl) {
      return queue
    }
  }
  return undefined
}

/**
 * Set queue
 */
export function setQueue(name: string, queue: QueueData): void {
  globalQueues.set(name, queue)
}

/**
 * Delete queue
 */
export function deleteQueue(name: string): boolean {
  return globalQueues.delete(name)
}

/**
 * Clear all queues (for testing)
 */
export function clearAll(): void {
  globalQueues.clear()
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Generate message ID (UUID-like format)
 */
export function generateMessageId(): string {
  const parts = [
    Math.random().toString(16).slice(2, 10),
    Math.random().toString(16).slice(2, 6),
    '4' + Math.random().toString(16).slice(2, 5),
    ((Math.random() * 4) | 8).toString(16) + Math.random().toString(16).slice(2, 5),
    Math.random().toString(16).slice(2, 14),
  ]
  return parts.join('-')
}

/**
 * Generate receipt handle
 */
export function generateReceiptHandle(): string {
  const parts = []
  for (let i = 0; i < 4; i++) {
    parts.push(Math.random().toString(36).slice(2, 14))
  }
  return parts.join('')
}

/**
 * Create queue URL from name
 */
export function createQueueUrl(queueName: string, region = 'us-east-1'): string {
  return `https://sqs.${region}.amazonaws.com/000000000000/${queueName}`
}

/**
 * Create queue ARN from name
 */
export function createQueueArn(queueName: string, region = 'us-east-1'): string {
  return `arn:aws:sqs:${region}:000000000000:${queueName}`
}

// ============================================================================
// MD5 HASHING
// ============================================================================

/**
 * Compute MD5 hash
 * Uses pure JavaScript implementation for cross-platform compatibility
 * (Node.js doesn't support MD5 via crypto.subtle, Cloudflare Workers do)
 */
export async function md5Hash(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)

  // Try crypto.subtle first (Cloudflare Workers)
  try {
    const hashBuffer = await crypto.subtle.digest('MD5', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    // Fall back to pure JavaScript MD5 implementation
    return md5Pure(data)
  }
}

/**
 * Pure JavaScript MD5 implementation
 * Based on RFC 1321
 */
function md5Pure(data: Uint8Array): string {
  // Convert to array of 32-bit words
  const bytes = data
  const len = bytes.length

  // Initialize MD5 state
  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  // Pre-processing: add padding bits
  // Message length in bits
  const bitLen = len * 8

  // Pad message to 512-bit boundary (64 bytes)
  // Padding: 1 bit, then 0s, then 64-bit length
  const paddedLen = Math.ceil((len + 9) / 64) * 64
  const padded = new Uint8Array(paddedLen)
  padded.set(bytes)
  padded[len] = 0x80 // Add 1 bit

  // Add length in bits as 64-bit little-endian
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLen - 8, bitLen >>> 0, true)
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true)

  // MD5 constants
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]

  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(0x100000000 * Math.abs(Math.sin(i + 1)))
  }

  // Process each 512-bit block
  for (let offset = 0; offset < paddedLen; offset += 64) {
    const M = new Uint32Array(16)
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(offset + j * 4, true)
    }

    let AA = a, BB = b, CC = c, DD = d

    for (let i = 0; i < 64; i++) {
      let F: number, g: number

      if (i < 16) {
        F = (BB & CC) | (~BB & DD)
        g = i
      } else if (i < 32) {
        F = (DD & BB) | (~DD & CC)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = BB ^ CC ^ DD
        g = (3 * i + 5) % 16
      } else {
        F = CC ^ (BB | ~DD)
        g = (7 * i) % 16
      }

      F = (F + AA + K[i] + M[g]) >>> 0
      AA = DD
      DD = CC
      CC = BB
      const rotated = ((F << S[i]) | (F >>> (32 - S[i]))) >>> 0
      BB = (BB + rotated) >>> 0
    }

    a = (a + AA) >>> 0
    b = (b + BB) >>> 0
    c = (c + CC) >>> 0
    d = (d + DD) >>> 0
  }

  // Output as hex string (little-endian)
  const result = new Uint8Array(16)
  const resultView = new DataView(result.buffer)
  resultView.setUint32(0, a, true)
  resultView.setUint32(4, b, true)
  resultView.setUint32(8, c, true)
  resultView.setUint32(12, d, true)

  return Array.from(result).map(b => b.toString(16).padStart(2, '0')).join('')
}
