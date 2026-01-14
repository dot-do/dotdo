/**
 * Git Object Negotiation
 *
 * Implementation of the Git fetch/clone negotiation protocol.
 * See: https://git-scm.com/docs/pack-protocol#_packfile_negotiation
 */

import { generatePktLine } from './pkt-line.js'

/** ACK response types */
export type AckStatus = 'continue' | 'ready' | 'common'

/** Parsed ACK response */
export interface AckResponse {
  type: 'ACK'
  sha: string
  status?: AckStatus
}

/** Parsed NAK response */
export interface NakResponse {
  type: 'NAK'
}

/** State for multi-round negotiation */
export interface NegotiationState {
  /** Common ancestors found so far */
  commonAncestors: string[]
  /** Haves that haven't been acknowledged */
  pendingHaves: string[]
  /** Server has enough info to send pack */
  isReady: boolean
  /** Negotiation is complete */
  isDone: boolean
}

/** SHA-1 pattern (40 hex chars) */
const SHA1_REGEX = /^[0-9a-f]{40}$/i

/** SHA-256 pattern (64 hex chars) */
const SHA256_REGEX = /^[0-9a-f]{64}$/i

/**
 * Validate SHA format (SHA-1 or SHA-256)
 */
function validateSha(sha: string): void {
  if (!SHA1_REGEX.test(sha) && !SHA256_REGEX.test(sha)) {
    throw new Error(`Invalid SHA format: ${sha}`)
  }
}

/**
 * Generate a want line with optional capabilities (first want)
 */
export function generateWantLine(sha: string, capabilities: string[]): string {
  validateSha(sha)

  let payload = `want ${sha}`
  if (capabilities.length > 0) {
    payload += ' ' + capabilities.join(' ')
  }
  payload += '\n'

  return generatePktLine(payload)
}

/**
 * Generate a have line
 */
export function generateHaveLine(sha: string): string {
  validateSha(sha)
  return generatePktLine(`have ${sha}\n`)
}

/**
 * Generate a done packet
 */
export function generateDonePkt(): string {
  return generatePktLine('done\n')
}

/**
 * Extract payload from pkt-line format if present
 */
function extractPayload(input: string): string {
  // Check if input starts with a 4-digit hex length
  if (input.length >= 4 && /^[0-9a-f]{4}/i.test(input)) {
    const len = parseInt(input.slice(0, 4), 16)
    if (len >= 4 && len <= input.length) {
      return input.slice(4, len)
    }
  }
  return input
}

/**
 * Parse a NAK response
 */
export function parseNakResponse(input: string): NakResponse | null {
  const payload = extractPayload(input)
  // NAK can appear as "NAK\n" in the payload
  if (payload.trim() === 'NAK') {
    return { type: 'NAK' }
  }
  return null
}

/**
 * Parse an ACK response
 */
export function parseAckResponse(input: string): AckResponse | null {
  const payload = extractPayload(input)
  // ACK format: "ACK <sha> [status]\n"
  const ackMatch = payload.match(/ACK\s+([0-9a-f]{40,64})(?:\s+(continue|ready|common))?/)
  if (!ackMatch) {
    return null
  }

  const result: AckResponse = {
    type: 'ACK',
    sha: ackMatch[1],
  }

  if (ackMatch[2]) {
    result.status = ackMatch[2] as AckStatus
  }

  return result
}
