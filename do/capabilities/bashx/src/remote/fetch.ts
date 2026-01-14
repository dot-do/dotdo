/**
 * Git Fetch Operation
 *
 * Fetch refs and objects from a remote repository with progress reporting
 * and pack caching optimizations.
 *
 * @module bashx/remote/fetch
 */

import {
  type ProgressOptions,
  type ProgressCallback,
  emitPhase,
  emitProgress,
  emitComplete,
  createProgressEvent,
} from './progress.js'

/**
 * Pack index entry for caching
 */
interface PackIndexEntry {
  sha: string
  offset: number
  size: number
}

/**
 * Mock HTTP client interface for simulating Git smart protocol
 */
interface MockHttpClient {
  infoRefs: Map<string, { refs: Map<string, string>; capabilities: string[] }>
  packData: Map<string, Uint8Array>
  receivePack: Map<string, { ok: boolean; error?: string }>
  requests: Array<{ url: string; method: string; headers: Record<string, string>; body?: Uint8Array }>
  authRequired: Set<string>
  protectedBranches: Map<string, Set<string>>
  /** Pack index cache for optimized subsequent fetches */
  packIndexCache?: Map<string, PackIndexEntry[]>
  /** ETag cache for conditional requests */
  etagCache?: Map<string, string>
}

/**
 * Mock Git repository state
 */
interface MockRepo {
  objects: Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>
  refs: Map<string, string>
  head: { symbolic: boolean; target: string }
  remotes: Map<string, { url: string; fetch: string }>
  config: Map<string, string>
  workingTree: Map<string, Uint8Array>
  index: Map<string, { sha: string; mode: number }>
  /** Shallow boundary commits */
  shallowRoots?: Set<string>
}

/**
 * Shallow fetch options
 */
export interface ShallowFetchOptions {
  /** Fetch only the specified number of commits */
  depth?: number
  /** Fetch commits more recent than specified date */
  shallowSince?: Date
  /** Exclude commits reachable from these refs */
  shallowExclude?: string[]
  /** Unshallow: convert shallow clone to full clone */
  unshallow?: boolean
}

export interface FetchOptions {
  remote: string
  refspecs?: string[]
  prune?: boolean
  tags?: boolean
  http: MockHttpClient
  localRepo: MockRepo
  /** Progress callback */
  onProgress?: ProgressCallback
  /** Progress options (advanced) */
  progress?: ProgressOptions
  /** Shallow fetch options */
  shallow?: ShallowFetchOptions
  /** Use pack index cache for delta fetch */
  usePackCache?: boolean
  /** Use ETag for conditional requests */
  useConditionalRequests?: boolean
}

export interface FetchResult {
  exitCode: number
  stdout: string
  stderr: string
  updatedRefs?: string[]
  prunedRefs?: string[]
  objectsFetched: number
  /** Bytes received */
  bytesReceived?: number
  /** Whether objects were served from cache */
  cacheHit?: boolean
}

/**
 * Parse pack data and extract objects with progress reporting
 */
function parsePackData(
  packData: Uint8Array,
  knownShas: Set<string>,
  progress?: ProgressOptions
): Array<{ sha: string; type: string; data: Uint8Array }> {
  const objects: Array<{ sha: string; type: string; data: Uint8Array }> = []

  if (packData.length < 12) {
    return objects
  }

  const count = (packData[8] << 24) | (packData[9] << 16) | (packData[10] << 8) | packData[11]

  if (count === 0) {
    return objects
  }

  const shaLookup = new Map<string, string>()
  for (const sha of knownShas) {
    shaLookup.set(sha.slice(0, 20), sha)
  }

  const validTypes = new Set(['comm', 'tree', 'blob', 'tag '])
  const isShaLike = (s: string) => s.length === 20 && /^[0-9a-z]+$/i.test(s)

  const rawObjects: Array<{ prefix: string; type: string; data: Uint8Array }> = []
  let scanOffset = 12

  emitPhase(progress, 'receiving', `Receiving ${count} objects`)

  for (let i = 0; i < count && scanOffset + 24 <= packData.length; i++) {
    const shaPrefix = new TextDecoder().decode(packData.slice(scanOffset, scanOffset + 20))
    const typeStr = new TextDecoder().decode(packData.slice(scanOffset + 20, scanOffset + 24))
    const type = typeStr.trim()

    scanOffset += 24

    let dataEnd = scanOffset
    while (dataEnd < packData.length - 20) {
      const nextPrefix = new TextDecoder().decode(packData.slice(dataEnd, dataEnd + 20))
      const nextType = new TextDecoder().decode(packData.slice(dataEnd + 20, dataEnd + 24))
      if (isShaLike(nextPrefix) && validTypes.has(nextType)) {
        break
      }
      dataEnd++
    }

    const data = packData.slice(scanOffset, dataEnd)
    rawObjects.push({ prefix: shaPrefix, type, data })
    scanOffset = dataEnd

    // Report progress
    if (progress && i % 10 === 0) {
      emitProgress(progress, createProgressEvent('receiving', i + 1, count, {
        bytes: scanOffset,
        totalBytes: packData.length,
      }))
    }
  }

  emitPhase(progress, 'resolving', `Resolving ${rawObjects.length} objects`)

  for (let i = 0; i < rawObjects.length; i++) {
    const raw = rawObjects[i]
    const fullSha = shaLookup.get(raw.prefix) || raw.prefix
    objects.push({ sha: fullSha, type: raw.type, data: raw.data })

    // Report progress
    if (progress && i % 10 === 0) {
      emitProgress(progress, createProgressEvent('resolving', i + 1, rawObjects.length))
    }
  }

  return objects
}

/**
 * Check if an object is in the pack cache
 */
function isInPackCache(sha: string, cache: PackIndexEntry[] | undefined): boolean {
  if (!cache) return false
  return cache.some(entry => entry.sha === sha)
}

/**
 * Get objects that are not in the cache
 */
function getUncachedObjects(wanted: Set<string>, cache: PackIndexEntry[] | undefined): Set<string> {
  if (!cache) return wanted
  const uncached = new Set<string>()
  for (const sha of wanted) {
    if (!isInPackCache(sha, cache)) {
      uncached.add(sha)
    }
  }
  return uncached
}

/**
 * Fetch from a remote repository with progress reporting
 *
 * @param options - Fetch configuration options
 * @returns Fetch result with exit code and output
 */
export async function fetch(options: FetchOptions): Promise<FetchResult> {
  const {
    remote,
    refspecs,
    prune,
    tags,
    http,
    localRepo,
    onProgress,
    progress: progressOpts,
    shallow,
    usePackCache,
    useConditionalRequests,
  } = options

  // Merge progress options
  const progress: ProgressOptions | undefined = progressOpts || (onProgress ? { onProgress } : undefined)

  // Get remote configuration
  const remoteConfig = localRepo.remotes.get(remote)
  if (!remoteConfig) {
    return {
      exitCode: 128,
      stdout: '',
      stderr: `fatal: Remote '${remote}' not found`,
      objectsFetched: 0,
    }
  }

  const remoteUrl = remoteConfig.url

  emitPhase(progress, 'connecting', `Connecting to ${remoteUrl}`)

  // Build request headers
  const headers: Record<string, string> = {
    'User-Agent': 'git/bashx',
    'Connection': 'keep-alive', // Request connection reuse
  }

  // Add conditional request headers if ETag is cached
  if (useConditionalRequests && http.etagCache?.has(remoteUrl)) {
    headers['If-None-Match'] = http.etagCache.get(remoteUrl)!
  }

  // Record the info/refs request
  http.requests.push({
    url: `${remoteUrl}/info/refs?service=git-upload-pack`,
    method: 'GET',
    headers,
  })

  // Get remote refs
  const remoteInfo = http.infoRefs.get(remoteUrl)
  if (!remoteInfo) {
    return {
      exitCode: 128,
      stdout: '',
      stderr: `fatal: Could not connect to ${remoteUrl}`,
      objectsFetched: 0,
    }
  }

  const remoteRefs = remoteInfo.refs
  const capabilities = remoteInfo.capabilities

  emitPhase(progress, 'counting', `Found ${remoteRefs.size} refs`)

  // Determine which refs to fetch based on refspecs or default fetch spec
  const fetchSpec = remoteConfig.fetch // e.g., '+refs/heads/*:refs/remotes/origin/*'
  const updatedRefs: string[] = []
  const refsToFetch = new Map<string, string>()

  if (refspecs && refspecs.length > 0) {
    // Parse explicit refspecs
    for (const refspec of refspecs) {
      const [src, dst] = refspec.split(':')
      if (src && dst) {
        const remoteSha = remoteRefs.get(src)
        if (remoteSha) {
          refsToFetch.set(dst, remoteSha)
        }
      }
    }
  } else {
    // Use default fetch spec to map remote refs to local tracking refs
    // fetchSpec is like '+refs/heads/*:refs/remotes/origin/*'
    // srcPattern and dstPattern reserved for future glob matching
    const [_srcPattern, _dstPattern] = fetchSpec.replace(/^\+/, '').split(':')
    void _srcPattern
    void _dstPattern

    for (const [ref, sha] of remoteRefs.entries()) {
      if (ref === 'HEAD') continue

      if (ref.startsWith('refs/heads/')) {
        // Map to tracking ref
        const branchName = ref.replace('refs/heads/', '')
        const trackingRef = `refs/remotes/${remote}/${branchName}`
        refsToFetch.set(trackingRef, sha)
      }
    }
  }

  // Also fetch tags if requested
  if (tags) {
    for (const [ref, sha] of remoteRefs.entries()) {
      if (ref.startsWith('refs/tags/')) {
        refsToFetch.set(ref, sha)
      }
    }
  }

  // Check if we need to fetch any new objects
  const objectsNeeded = new Set<string>()
  for (const [ref, sha] of refsToFetch.entries()) {
    const currentSha = localRepo.refs.get(ref)
    if (currentSha !== sha && !localRepo.objects.has(sha)) {
      objectsNeeded.add(sha)
    }
  }

  // Check pack cache to determine what we already have
  let cacheHit = false
  let effectiveObjectsNeeded = objectsNeeded
  if (usePackCache && http.packIndexCache?.has(remoteUrl)) {
    const cache = http.packIndexCache.get(remoteUrl)!
    effectiveObjectsNeeded = getUncachedObjects(objectsNeeded, cache)
    if (effectiveObjectsNeeded.size < objectsNeeded.size) {
      cacheHit = true
      emitPhase(progress, 'counting', `Using cached pack index (${objectsNeeded.size - effectiveObjectsNeeded.size} objects from cache)`)
    }
  }

  // Build upload-pack request with shallow options
  const uploadPackHeaders: Record<string, string> = {
    ...headers,
    'Content-Type': 'application/x-git-upload-pack-request',
  }

  // Build request body for shallow fetch
  let requestBody = ''
  if (shallow) {
    const supportsShallow = capabilities.includes('shallow')

    if (shallow.unshallow && localRepo.shallowRoots?.size) {
      // Unshallow: request full history
      requestBody += 'deepen 2147483647\n' // Max depth
      localRepo.shallowRoots.clear()
      localRepo.config.delete('shallow')
      localRepo.config.delete('shallow.depth')
    } else if (supportsShallow) {
      if (shallow.depth !== undefined) {
        requestBody += `deepen ${shallow.depth}\n`
      }
      if (shallow.shallowSince) {
        const timestamp = Math.floor(shallow.shallowSince.getTime() / 1000)
        requestBody += `deepen-since ${timestamp}\n`
      }
      if (shallow.shallowExclude) {
        for (const exclude of shallow.shallowExclude) {
          requestBody += `deepen-not ${exclude}\n`
        }
      }
    }
  }

  // Record the upload-pack request if we need objects
  if (effectiveObjectsNeeded.size > 0) {
    http.requests.push({
      url: `${remoteUrl}/git-upload-pack`,
      method: 'POST',
      headers: uploadPackHeaders,
      body: requestBody ? new TextEncoder().encode(requestBody) : undefined,
    })
  }

  // Get and parse pack data with progress
  let objectsFetched = 0
  let bytesReceived = 0
  const packData = http.packData.get(remoteUrl)

  if (packData && packData.length > 12) {
    bytesReceived = packData.length
    const knownShas = new Set<string>(refsToFetch.values())
    const objects = parsePackData(packData, knownShas, progress)

    for (const obj of objects) {
      if (!localRepo.objects.has(obj.sha)) {
        localRepo.objects.set(obj.sha, {
          type: obj.type as 'blob' | 'tree' | 'commit' | 'tag',
          data: obj.data,
        })
        objectsFetched++
      }
    }

    // Update pack cache
    if (!http.packIndexCache) {
      http.packIndexCache = new Map()
    }
    const existingCache = http.packIndexCache.get(remoteUrl) || []
    const newEntries: PackIndexEntry[] = objects
      .filter(obj => !existingCache.some(e => e.sha === obj.sha))
      .map((obj, i) => ({
        sha: obj.sha,
        offset: existingCache.length + i * 100,
        size: obj.data.length,
      }))
    http.packIndexCache.set(remoteUrl, [...existingCache, ...newEntries])
  }

  emitPhase(progress, 'updating-refs', 'Updating references')

  // Update refs
  for (const [ref, sha] of refsToFetch.entries()) {
    const currentSha = localRepo.refs.get(ref)
    if (currentSha !== sha) {
      localRepo.refs.set(ref, sha)
      updatedRefs.push(ref)
    }
  }

  // Handle pruning
  const prunedRefs: string[] = []
  if (prune) {
    // Find tracking refs that no longer exist on remote
    const remoteTrackingPrefix = `refs/remotes/${remote}/`
    for (const [ref] of localRepo.refs.entries()) {
      if (ref.startsWith(remoteTrackingPrefix)) {
        const branchName = ref.replace(remoteTrackingPrefix, '')
        const remoteBranchRef = `refs/heads/${branchName}`
        if (!remoteRefs.has(remoteBranchRef)) {
          localRepo.refs.delete(ref)
          prunedRefs.push(ref)
        }
      }
    }
  }

  emitComplete(progress)

  // Build output
  let stdout = ''
  if (objectsFetched === 0 && updatedRefs.length === 0) {
    stdout = 'Already up to date.'
  } else {
    stdout = `From ${remoteUrl}\n`
    for (const ref of updatedRefs) {
      const branchName = ref.split('/').pop()
      stdout += `   ${ref.includes('tags') ? '[new tag]' : ''} ${branchName}\n`
    }
  }

  return {
    exitCode: 0,
    stdout,
    stderr: '',
    updatedRefs: updatedRefs.length > 0 ? updatedRefs : undefined,
    prunedRefs: prunedRefs.length > 0 ? prunedRefs : undefined,
    objectsFetched,
    bytesReceived,
    cacheHit,
  }
}
