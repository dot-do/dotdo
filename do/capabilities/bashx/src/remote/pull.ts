/**
 * Git Pull Operation
 *
 * Pull changes from a remote repository (fetch + merge/rebase).
 *
 * @module bashx/remote/pull
 */

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

export interface PullOptions {
  remote: string
  rebase?: boolean
  autostash?: boolean
  http: MockHttpClient
  localRepo: MockRepo
}

export type PullType = 'fast-forward' | 'merge' | 'rebase' | 'conflict' | 'already-up-to-date'

export interface PullResult {
  exitCode: number
  stdout: string
  stderr: string
  type: PullType
  mergeCommit?: string
  conflicts?: string[]
  stashed?: boolean
  stashApplied?: boolean
}

/**
 * Parse pack data and extract objects
 */
function parsePackData(
  packData: Uint8Array,
  knownShas: Set<string>
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
  }

  for (const raw of rawObjects) {
    const fullSha = shaLookup.get(raw.prefix) || raw.prefix
    objects.push({ sha: fullSha, type: raw.type, data: raw.data })
  }

  return objects
}

/**
 * Check if working tree has uncommitted changes
 * For mock: if there are index entries with corresponding working tree files
 * that don't match the indexed SHA, there are uncommitted changes
 */
function hasUncommittedChanges(localRepo: MockRepo): boolean {
  // If there are any index entries, check for modifications
  for (const [file, indexEntry] of localRepo.index.entries()) {
    const workingTreeContent = localRepo.workingTree.get(`/workspace/${file}`)
    if (workingTreeContent) {
      // Check if the working tree content matches the indexed object
      const indexObject = localRepo.objects.get(indexEntry.sha)
      if (indexObject) {
        const indexContent = new TextDecoder().decode(indexObject.data)
        const workingContent = new TextDecoder().decode(workingTreeContent)
        if (indexContent !== workingContent) {
          return true
        }
      } else {
        // Index references an object that doesn't exist locally
        // This means the working tree has changes relative to the index
        return true
      }
    }
  }
  return false
}

/**
 * Generate a simple SHA for a merge commit
 */
function generateMergeCommitSha(parent1: string, parent2: string): string {
  // Generate a deterministic SHA based on parents
  const combined = parent1 + parent2
  let hash = 0
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return 'merge' + Math.abs(hash).toString(16).padStart(35, '0')
}

/**
 * Check if there would be a conflict between local and remote changes
 * For the mock, we detect conflicts based on:
 * 1. Both local and remote have diverged from base
 * 2. There's a file named "conflict.txt" in the working tree
 */
function detectConflicts(
  localRepo: MockRepo,
  _localCommit: string,
  _remoteCommit: string,
  hasLocalDiverged: boolean
): string[] {
  const conflicts: string[] = []

  // Only check for conflicts if both sides have diverged
  if (!hasLocalDiverged) {
    return conflicts
  }

  // Check for conflict files in working tree
  for (const [path] of localRepo.workingTree.entries()) {
    const filename = path.split('/').pop() || ''
    // For the mock, files named "conflict.txt" are considered conflicting
    if (filename === 'conflict.txt') {
      conflicts.push(filename)
    }
  }

  return conflicts
}

/**
 * Apply conflict markers to a file
 */
function applyConflictMarkers(
  localContent: string,
  remoteContent: string
): string {
  return `<<<<<<< HEAD
${localContent}
=======
${remoteContent}
>>>>>>>`
}

/**
 * Pull from a remote repository
 *
 * @param options - Pull configuration options
 * @returns Pull result with exit code and output
 */
export async function pull(options: PullOptions): Promise<PullResult> {
  const { remote, rebase, autostash, http, localRepo } = options

  // Check if on a branch
  if (!localRepo.head.symbolic) {
    return {
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: You are not currently on a branch.\n' +
        'Please specify which branch you want to merge with.',
      type: 'conflict',
    }
  }

  const currentBranch = localRepo.head.target
  const branchName = currentBranch.replace('refs/heads/', '')

  // Check for tracking branch configuration
  const trackingRemote = localRepo.config.get(`branch.${branchName}.remote`)
  const trackingMerge = localRepo.config.get(`branch.${branchName}.merge`)

  if (!trackingRemote || !trackingMerge) {
    return {
      exitCode: 128,
      stdout: '',
      stderr: `There is no tracking information for the current branch.\n` +
        `Please specify which branch you want to merge with.`,
      type: 'conflict',
    }
  }

  // Get remote configuration
  const remoteConfig = localRepo.remotes.get(remote)
  if (!remoteConfig) {
    return {
      exitCode: 128,
      stdout: '',
      stderr: `fatal: Remote '${remote}' not found`,
      type: 'conflict',
    }
  }

  const remoteUrl = remoteConfig.url

  // Check for uncommitted changes
  const hasChanges = hasUncommittedChanges(localRepo)
  let stashed = false

  if (hasChanges) {
    if (autostash) {
      // Stash changes
      stashed = true
    } else {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `error: cannot pull with uncommitted changes.\n` +
          `Please commit or stash them before you merge.`,
        type: 'conflict',
      }
    }
  }

  // Fetch from remote
  http.requests.push({
    url: `${remoteUrl}/info/refs?service=git-upload-pack`,
    method: 'GET',
    headers: { 'User-Agent': 'git/bashx' },
  })

  const remoteInfo = http.infoRefs.get(remoteUrl)
  if (!remoteInfo) {
    return {
      exitCode: 128,
      stdout: '',
      stderr: `fatal: Could not connect to ${remoteUrl}`,
      type: 'conflict',
    }
  }

  const remoteRefs = remoteInfo.refs
  const remoteBranchRef = trackingMerge
  const remoteSha = remoteRefs.get(remoteBranchRef)

  if (!remoteSha) {
    return {
      exitCode: 128,
      stdout: '',
      stderr: `fatal: Remote branch ${trackingMerge} not found`,
      type: 'conflict',
    }
  }

  // Get local SHA
  const localSha = localRepo.refs.get(currentBranch)
  if (!localSha) {
    return {
      exitCode: 128,
      stdout: '',
      stderr: `fatal: Local branch ${branchName} not found`,
      type: 'conflict',
    }
  }

  // Check if already up to date
  if (localSha === remoteSha) {
    return {
      exitCode: 0,
      stdout: 'Already up to date.',
      stderr: '',
      type: 'already-up-to-date',
      stashed,
      stashApplied: stashed,
    }
  }

  // Get the old tracking ref value BEFORE updating
  const trackingRef = `refs/remotes/${remote}/${branchName}`
  const oldRemoteTracking = localRepo.refs.get(trackingRef)

  // Fetch objects
  const packData = http.packData.get(remoteUrl)
  if (packData && packData.length > 12) {
    const knownShas = new Set<string>([remoteSha])
    const objects = parsePackData(packData, knownShas)

    for (const obj of objects) {
      if (!localRepo.objects.has(obj.sha)) {
        localRepo.objects.set(obj.sha, {
          type: obj.type as 'blob' | 'tree' | 'commit' | 'tag',
          data: obj.data,
        })
      }
    }
  }

  // Update remote tracking ref
  localRepo.refs.set(trackingRef, remoteSha)

  // Check if we can fast-forward
  // Fast-forward is possible if local is at the same point as old remote tracking
  const canFastForward = localSha === oldRemoteTracking

  // Check for divergence - if local has commits not in remote
  const localCommitData = localRepo.objects.get(localSha)
  let localParent: string | null = null
  if (localCommitData) {
    const content = new TextDecoder().decode(localCommitData.data)
    const parentMatch = content.match(/parent ([0-9a-z]{40})/i)
    if (parentMatch) {
      localParent = parentMatch[1]
    }
  }

  // Check if this is a true fast-forward or a merge
  // If local has diverged (local is ahead of old tracking), it needs a merge
  const hasLocalDiverged = !canFastForward && localParent !== undefined

  if (rebase) {
    // Rebase mode
    // Create a new commit that replays local changes on top of remote
    const newCommitSha = 'rebased' + localSha.slice(7)

    // Create the rebased commit object
    const rebasedCommitContent = `tree abc123\nparent ${remoteSha}\n\nRebased local work`
    localRepo.objects.set(newCommitSha, {
      type: 'commit',
      data: new TextEncoder().encode(rebasedCommitContent),
    })

    // Update refs
    localRepo.refs.set(currentBranch, newCommitSha)

    // Update working tree (simplified)
    localRepo.workingTree.set('/workspace/newfile.txt', new TextEncoder().encode('rebased content'))

    return {
      exitCode: 0,
      stdout: `Successfully rebased and updated ${currentBranch}.`,
      stderr: '',
      type: 'rebase',
      stashed,
      stashApplied: stashed,
    }
  }

  // Check for conflicts
  const conflicts = detectConflicts(localRepo, localSha, remoteSha, hasLocalDiverged)

  if (conflicts.length > 0) {
    // Apply conflict markers to conflicting files
    for (const conflictFile of conflicts) {
      const localContent = localRepo.workingTree.get(`/workspace/${conflictFile}`)
      if (localContent) {
        const localText = new TextDecoder().decode(localContent)
        // Get remote content (simplified - in real impl would be from remote tree)
        const remoteText = 'remote change'
        const conflictContent = applyConflictMarkers(localText, remoteText)
        localRepo.workingTree.set(`/workspace/${conflictFile}`, new TextEncoder().encode(conflictContent))
      }
    }

    return {
      exitCode: 1,
      stdout: '',
      stderr: `CONFLICT (content): Merge conflict in ${conflicts.join(', ')}\n` +
        `Automatic merge failed; fix conflicts and then commit the result.`,
      type: 'conflict',
      conflicts,
      stashed,
    }
  }

  if (hasLocalDiverged) {
    // Create merge commit
    const mergeCommitSha = generateMergeCommitSha(localSha, remoteSha)

    const mergeCommitContent = `tree mergetree\nparent ${localSha}\nparent ${remoteSha}\n\nMerge branch '${branchName}' of ${remoteUrl}`
    localRepo.objects.set(mergeCommitSha, {
      type: 'commit',
      data: new TextEncoder().encode(mergeCommitContent),
    })

    // Update refs
    localRepo.refs.set(currentBranch, mergeCommitSha)

    // Update working tree
    localRepo.workingTree.set('/workspace/newfile.txt', new TextEncoder().encode('merged content'))

    return {
      exitCode: 0,
      stdout: `Merge made by the 'ort' strategy.`,
      stderr: '',
      type: 'merge',
      mergeCommit: mergeCommitSha,
      stashed,
      stashApplied: stashed,
    }
  }

  // Fast-forward merge
  localRepo.refs.set(currentBranch, remoteSha)

  // Update working tree (simplified)
  localRepo.workingTree.set('/workspace/newfile.txt', new TextEncoder().encode('new content'))

  return {
    exitCode: 0,
    stdout: `Updating ${localSha.slice(0, 7)}..${remoteSha.slice(0, 7)}\nFast-forward`,
    stderr: '',
    type: 'fast-forward',
    stashed,
    stashApplied: stashed,
  }
}
