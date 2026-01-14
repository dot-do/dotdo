/**
 * Git Refs Discovery
 *
 * Parsing of refs advertisement from git-upload-pack and git-receive-pack.
 * See: https://git-scm.com/docs/protocol-v2#_ref_advertisement
 */

import { parsePktLines } from './pkt-line.js'

/** Information about a single ref */
export interface RefInfo {
  /** SHA-1 or SHA-256 hash */
  sha: string
  /** Full ref name (e.g., refs/heads/main) */
  name: string
  /** Short name (e.g., main) */
  shortName?: string
  /** Peeled commit SHA for annotated tags */
  peeled?: string
}

/** Complete refs response from server */
export interface RefsResponse {
  /** HEAD ref info */
  head?: RefInfo
  /** Branch refs */
  branches: RefInfo[]
  /** Tag refs */
  tags: RefInfo[]
  /** All other refs (pull requests, notes, etc.) */
  refs: RefInfo[]
  /** Raw capabilities string list */
  capabilities: string[]
  /** Parsed symref mappings */
  symrefs?: Record<string, string>
}

/** Service header parsing result */
export interface ServiceHeaderResult {
  /** Service name (git-upload-pack or git-receive-pack) */
  service: string
}

/**
 * Parse the service header line (# service=git-upload-pack)
 */
export function parseServiceHeader(input: string): ServiceHeaderResult {
  // Find the service header in the input
  // Format: pkt-line containing "# service=git-upload-pack\n" or similar
  const serviceMatch = input.match(/# service=(git-upload-pack|git-receive-pack)/)
  if (!serviceMatch) {
    throw new Error('Invalid service header: service not found')
  }
  return { service: serviceMatch[1] }
}

/**
 * Parse refs from refs advertisement
 */
export function parseRefs(input: string): RefsResponse {
  const result: RefsResponse = {
    branches: [],
    tags: [],
    refs: [],
    capabilities: [],
  }

  // Handle empty input or just flush
  if (!input || input === '0000' || input.trim() === '') {
    return result
  }

  const pktLines = parsePktLines(input)

  // Map to track peeled refs (tag^{})
  const peeledRefs = new Map<string, string>()

  for (const pkt of pktLines) {
    if (pkt.type !== 'data' || !pkt.payload) {
      continue
    }

    const line = typeof pkt.payload === 'string' ? pkt.payload : new TextDecoder().decode(pkt.payload)

    // Check for capabilities-only line (empty repo with version info)
    if (line.startsWith('\0')) {
      const capsStr = line.slice(1).trim()
      result.capabilities = capsStr.split(/\s+/).filter(Boolean)
      continue
    }

    // Parse ref line: "<sha> <refname>\0<caps>" or "<sha> <refname>"
    const nulIndex = line.indexOf('\0')
    let refPart: string
    let capsPart: string | null = null

    if (nulIndex >= 0) {
      refPart = line.slice(0, nulIndex)
      capsPart = line.slice(nulIndex + 1).trim()
    } else {
      refPart = line.trim()
    }

    // Parse SHA and ref name
    const spaceIndex = refPart.indexOf(' ')
    if (spaceIndex < 0) {
      continue
    }

    const sha = refPart.slice(0, spaceIndex)
    const refName = refPart.slice(spaceIndex + 1).trim()

    // Handle capabilities from first ref line
    if (capsPart && result.capabilities.length === 0) {
      result.capabilities = capsPart.split(/\s+/).filter(Boolean)

      // Extract symrefs
      result.symrefs = {}
      for (const cap of result.capabilities) {
        if (cap.startsWith('symref=')) {
          const symrefValue = cap.slice(7)
          const colonIndex = symrefValue.indexOf(':')
          if (colonIndex > 0) {
            const symName = symrefValue.slice(0, colonIndex)
            const targetName = symrefValue.slice(colonIndex + 1)
            result.symrefs[symName] = targetName
          }
        }
      }
    }

    // Handle peeled refs (tag^{})
    if (refName.endsWith('^{}')) {
      const baseRefName = refName.slice(0, -3)
      peeledRefs.set(baseRefName, sha)
      continue
    }

    // Categorize ref
    if (refName === 'HEAD') {
      result.head = { sha, name: refName }
    } else if (refName.startsWith('refs/heads/')) {
      result.branches.push({
        sha,
        name: refName,
        shortName: refName.slice('refs/heads/'.length),
      })
    } else if (refName.startsWith('refs/tags/')) {
      result.tags.push({
        sha,
        name: refName,
        shortName: refName.slice('refs/tags/'.length),
      })
    } else {
      result.refs.push({ sha, name: refName })
    }
  }

  // Apply peeled refs to tags
  for (const tag of result.tags) {
    const peeled = peeledRefs.get(tag.name)
    if (peeled) {
      tag.peeled = peeled
    }
  }

  return result
}

/**
 * Extract capabilities from first ref line
 */
export function extractCapabilities(line: string): string[] {
  const nulIndex = line.indexOf('\0')
  if (nulIndex < 0) {
    return []
  }
  const capsPart = line.slice(nulIndex + 1).trim()
  return capsPart.split(/\s+/).filter(Boolean)
}
