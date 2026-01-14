/**
 * Git Push Operation
 *
 * Push refs and objects to a remote repository with progress reporting.
 *
 * @module bashx/remote/push
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
 * Pack index entry for caching
 */
interface PackIndexEntry {
  sha: string
  offset: number
  size: number
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
}

export interface PushOptions {
  remote: string
  refspecs?: string[]
  force?: boolean
  setUpstream?: boolean
  tags?: boolean
  http: MockHttpClient
  localRepo: MockRepo
  /** Progress callback */
  onProgress?: ProgressCallback
  /** Progress options (advanced) */
  progress?: ProgressOptions
  /** Use pack cache to send minimal objects */
  usePackCache?: boolean
}

export interface PushResult {
  exitCode: number
  stdout: string
  stderr: string
  pushedRefs?: string[]
  createdRefs?: string[]
  deletedRefs?: string[]
  forcePushed?: string[]
  objectsSent: number
  /** Bytes sent */
  bytesSent?: number
}

/**
 * Check if we can fast-forward from remoteSha to localSha
 * In a real implementation, we'd walk the commit graph
 * For mock, we check if we know about the remote commit through refs or objects
 */
function canFastForward(
  _localSha: string,
  remoteSha: string,
  objects: Map<string, { type: string; data: Uint8Array }>,
  refs: Map<string, string>
): boolean {
  // Check if we have the remote SHA in our objects (we fetched it)
  if (objects.has(remoteSha)) {
    return true
  }

  // Check if any of our refs point to the remote SHA (we know about it)
  for (const sha of refs.values()) {
    if (sha === remoteSha) {
      return true
    }
  }

  return false
}

/**
 * Collect objects to push by walking commit history
 * Returns the SHAs of objects that need to be sent
 */
function collectObjectsToSend(
  localSha: string,
  remoteSha: string | null,
  objects: Map<string, { type: string; data: Uint8Array }>,
  knownRemoteObjects: Set<string>
): Set<string> {
  const toSend = new Set<string>()
  const visited = new Set<string>()
  const queue: string[] = [localSha]

  while (queue.length > 0) {
    const sha = queue.shift()!
    if (visited.has(sha) || knownRemoteObjects.has(sha)) {
      continue
    }
    visited.add(sha)

    // Stop if we reach the remote SHA (objects from here are already on remote)
    if (sha === remoteSha) {
      continue
    }

    const obj = objects.get(sha)
    if (!obj) continue

    toSend.add(sha)

    // For commits, also queue parents and tree
    if (obj.type === 'commit' || obj.type === 'comm') {
      const content = new TextDecoder().decode(obj.data)
      const treeMatch = content.match(/tree ([0-9a-z]{40})/i)
      if (treeMatch && objects.has(treeMatch[1])) {
        queue.push(treeMatch[1])
      }
      const parentMatches = content.matchAll(/parent ([0-9a-z]{40})/gi)
      for (const match of parentMatches) {
        queue.push(match[1])
      }
    }
  }

  return toSend
}

/**
 * Push to a remote repository with progress reporting
 *
 * @param options - Push configuration options
 * @returns Push result with exit code and output
 */
export async function push(options: PushOptions): Promise<PushResult> {
  const {
    remote,
    refspecs,
    force,
    setUpstream,
    tags,
    http,
    localRepo,
    onProgress,
    progress: progressOpts,
    usePackCache,
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
      objectsSent: 0,
    }
  }

  const remoteUrl = remoteConfig.url

  emitPhase(progress, 'connecting', `Connecting to ${remoteUrl}`)

  // Build request headers
  const headers: Record<string, string> = {
    'User-Agent': 'git/bashx',
    'Connection': 'keep-alive', // Request connection reuse
  }

  // Record the info/refs request
  http.requests.push({
    url: `${remoteUrl}/info/refs?service=git-receive-pack`,
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
      objectsSent: 0,
    }
  }

  const remoteRefs = remoteInfo.refs

  emitPhase(progress, 'counting', `Remote has ${remoteRefs.size} refs`)

  // Determine what to push
  const refsToPush: Array<{
    src: string | null  // null for delete
    dst: string
    localSha: string | null
    remoteSha: string | null
  }> = []

  if (refspecs && refspecs.length > 0) {
    // Parse explicit refspecs
    for (const refspec of refspecs) {
      if (refspec.startsWith(':')) {
        // Delete refspec
        const dst = refspec.slice(1)
        refsToPush.push({
          src: null,
          dst,
          localSha: null,
          remoteSha: remoteRefs.get(dst) || null,
        })
      } else {
        const [src, dst] = refspec.split(':')
        const localSha = localRepo.refs.get(src)

        if (!localSha) {
          return {
            exitCode: 128,
            stdout: '',
            stderr: `error: src refspec ${src} does not match any`,
            objectsSent: 0,
          }
        }

        refsToPush.push({
          src,
          dst: dst || src,
          localSha,
          remoteSha: remoteRefs.get(dst || src) || null,
        })
      }
    }
  } else if (!tags) {
    // Push current branch (only if not doing tags-only push)
    if (!localRepo.head.symbolic) {
      return {
        exitCode: 128,
        stdout: '',
        stderr: 'fatal: You are not currently on a branch.',
        objectsSent: 0,
      }
    }

    const currentBranch = localRepo.head.target
    const localSha = localRepo.refs.get(currentBranch)

    if (!localSha) {
      return {
        exitCode: 128,
        stdout: '',
        stderr: `error: src refspec ${currentBranch} does not match any`,
        objectsSent: 0,
      }
    }

    refsToPush.push({
      src: currentBranch,
      dst: currentBranch,
      localSha,
      remoteSha: remoteRefs.get(currentBranch) || null,
    })
  }

  // Add tags if requested
  if (tags) {
    for (const [ref, sha] of localRepo.refs.entries()) {
      if (ref.startsWith('refs/tags/')) {
        const remoteSha = remoteRefs.get(ref)
        if (remoteSha !== sha) {
          refsToPush.push({
            src: ref,
            dst: ref,
            localSha: sha,
            remoteSha: remoteSha || null,
          })
        }
      }
    }
  }

  emitPhase(progress, 'compressing', `Preparing ${refsToPush.length} refs`)

  // Check for protected branches first (server-side rejection)
  const protectedBranches = http.protectedBranches.get(remoteUrl) || new Set()
  const receivePackResult = http.receivePack.get(remoteUrl)

  // Check if any ref we're pushing is protected and server rejects
  for (const ref of refsToPush) {
    if (ref.localSha !== null && ref.dst) {
      if (protectedBranches.has(ref.dst) || (receivePackResult && !receivePackResult.ok)) {
        if (receivePackResult && !receivePackResult.ok) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `error: failed to push to '${remoteUrl}'\n` +
              `remote: error: GH006: Protected branch update failed for ${ref.dst}.\n` +
              `remote: error: ${receivePackResult.error || 'protected branch hook declined'}\n` +
              `To ${remoteUrl}\n` +
              ` ! [remote rejected] ${ref.dst} -> ${ref.dst} (protected)`,
            objectsSent: 0,
          }
        }
      }
    }
  }

  // Check for non-fast-forward pushes
  const pushedRefs: string[] = []
  const createdRefs: string[] = []
  const deletedRefs: string[] = []
  const forcePushed: string[] = []
  const rejectedRefs: string[] = []

  for (let i = 0; i < refsToPush.length; i++) {
    const ref = refsToPush[i]

    // Report progress
    if (progress) {
      emitProgress(progress, createProgressEvent('compressing', i + 1, refsToPush.length, {
        message: `Checking ${ref.dst}`,
      }))
    }

    if (ref.localSha === null) {
      // Delete operation
      deletedRefs.push(ref.dst)
      continue
    }

    if (ref.remoteSha === null) {
      // New ref
      createdRefs.push(ref.dst)
      pushedRefs.push(ref.dst)
      continue
    }

    // Check if fast-forward is possible
    const isFastForward = canFastForward(ref.localSha, ref.remoteSha, localRepo.objects, localRepo.refs)

    if (!isFastForward && !force) {
      rejectedRefs.push(ref.dst)
    } else if (!isFastForward && force) {
      forcePushed.push(ref.dst)
      pushedRefs.push(ref.dst)
    } else {
      pushedRefs.push(ref.dst)
    }
  }

  // Check for rejections
  if (rejectedRefs.length > 0) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `error: failed to push some refs to '${remoteUrl}'\n` +
        `hint: Updates were rejected because the tip of your current branch is behind\n` +
        `hint: its remote counterpart. Merge the remote changes before pushing again.\n` +
        `To ${remoteUrl}\n` +
        ` ! [rejected]        ${rejectedRefs.join(', ')} -> ${rejectedRefs.join(', ')} (non-fast-forward)`,
      objectsSent: 0,
    }
  }

  emitPhase(progress, 'writing', 'Sending objects')

  // Collect objects to send
  let objectsSent = 0
  let bytesSent = 0
  const knownRemoteObjects = usePackCache && http.packIndexCache?.has(remoteUrl)
    ? new Set(http.packIndexCache.get(remoteUrl)!.map(e => e.sha))
    : new Set<string>()

  for (let i = 0; i < refsToPush.length; i++) {
    const ref = refsToPush[i]
    if (!ref.localSha) continue

    // Collect objects that need to be sent
    const objectsForRef = collectObjectsToSend(
      ref.localSha,
      ref.remoteSha,
      localRepo.objects,
      knownRemoteObjects
    )

    objectsSent += objectsForRef.size

    // Calculate bytes
    for (const sha of objectsForRef) {
      const obj = localRepo.objects.get(sha)
      if (obj) {
        bytesSent += obj.data.length
      }
    }

    // Report progress
    if (progress) {
      emitProgress(progress, createProgressEvent('writing', i + 1, refsToPush.length, {
        bytes: bytesSent,
        message: `Sending ${objectsForRef.size} objects`,
      }))
    }
  }

  // Record the receive-pack request
  http.requests.push({
    url: `${remoteUrl}/git-receive-pack`,
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/x-git-receive-pack-request',
    },
  })

  emitPhase(progress, 'updating-refs', 'Updating remote refs')

  // Update remote-tracking refs
  for (let i = 0; i < refsToPush.length; i++) {
    const ref = refsToPush[i]
    if (ref.localSha && ref.dst.startsWith('refs/heads/')) {
      const branchName = ref.dst.replace('refs/heads/', '')
      localRepo.refs.set(`refs/remotes/${remote}/${branchName}`, ref.localSha)
    }

    // Report progress
    if (progress) {
      emitProgress(progress, createProgressEvent('updating-refs', i + 1, refsToPush.length))
    }
  }

  // Set upstream if requested
  if (setUpstream) {
    for (const ref of refsToPush) {
      if (ref.src && ref.localSha) {
        const branchName = ref.src.replace('refs/heads/', '')
        localRepo.config.set(`branch.${branchName}.remote`, remote)
        localRepo.config.set(`branch.${branchName}.merge`, ref.dst)
      }
    }
  }

  emitComplete(progress)

  // Build output
  let stdout = `To ${remoteUrl}\n`
  for (const ref of createdRefs) {
    stdout += ` * [new branch]      ${ref}\n`
  }
  for (const ref of pushedRefs) {
    if (!createdRefs.includes(ref)) {
      stdout += `   ${ref}\n`
    }
  }
  for (const ref of deletedRefs) {
    stdout += ` - [deleted]         ${ref}\n`
  }

  return {
    exitCode: 0,
    stdout,
    stderr: '',
    pushedRefs: pushedRefs.length > 0 ? pushedRefs : undefined,
    createdRefs: createdRefs.length > 0 ? createdRefs : undefined,
    deletedRefs: deletedRefs.length > 0 ? deletedRefs : undefined,
    forcePushed: forcePushed.length > 0 ? forcePushed : undefined,
    objectsSent,
    bytesSent,
  }
}
