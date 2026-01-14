/**
 * Git Remote Operations Tests - RED Phase
 *
 * Comprehensive failing tests for git remote operations:
 * - clone: Clone repositories with auth, depth, branch options
 * - fetch: Fetch commits and update remote-tracking refs
 * - push: Push commits to remote with various options
 * - pull: Pull with fast-forward, merge, and rebase
 *
 * These tests define the expected behavior for git remote operations
 * in bashx.do, mocking HTTP and pack protocol internals.
 *
 * @module bashx/remote/operations.test
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import the remote operation handlers (to be implemented)
// These imports will fail until implementation exists
import { clone } from './clone.js'
import { fetch } from './fetch.js'
import { push } from './push.js'
import { pull } from './pull.js'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock HTTP client for simulating Git smart protocol
 */
interface MockHttpClient {
  /** Simulated responses for info/refs discovery */
  infoRefs: Map<string, { refs: Map<string, string>; capabilities: string[] }>
  /** Simulated pack data for upload-pack (clone/fetch) */
  packData: Map<string, Uint8Array>
  /** Simulated receive-pack responses */
  receivePack: Map<string, { ok: boolean; error?: string }>
  /** Track all HTTP requests made */
  requests: Array<{ url: string; method: string; headers: Record<string, string>; body?: Uint8Array }>
  /** Configure auth requirements */
  authRequired: Set<string>
  /** Configure protected branches */
  protectedBranches: Map<string, Set<string>>
}

function createMockHttpClient(): MockHttpClient {
  return {
    infoRefs: new Map(),
    packData: new Map(),
    receivePack: new Map(),
    requests: [],
    authRequired: new Set(),
    protectedBranches: new Map(),
  }
}

/**
 * Mock Git repository state
 */
interface MockRepo {
  /** Object store: SHA -> object data */
  objects: Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>
  /** Refs: ref name -> SHA */
  refs: Map<string, string>
  /** HEAD reference (symbolic or direct) */
  head: { symbolic: boolean; target: string }
  /** Remote configurations */
  remotes: Map<string, { url: string; fetch: string }>
  /** Config values */
  config: Map<string, string>
  /** Working tree files */
  workingTree: Map<string, Uint8Array>
  /** Index (staging area) */
  index: Map<string, { sha: string; mode: number }>
}

function createMockRepo(): MockRepo {
  return {
    objects: new Map(),
    refs: new Map(),
    head: { symbolic: true, target: 'refs/heads/main' },
    remotes: new Map(),
    config: new Map(),
    workingTree: new Map(),
    index: new Map(),
  }
}

/**
 * Helper to create sample pack data
 */
function createMockPackData(objects: Array<{ sha: string; type: string; data: Uint8Array }>): Uint8Array {
  // Simplified pack format for testing
  // Real implementation would use proper pack format
  const header = new TextEncoder().encode('PACK')
  const version = new Uint8Array([0, 0, 0, 2]) // version 2
  const count = new Uint8Array([0, 0, 0, objects.length])

  // Combine all (simplified - real impl is much more complex)
  const totalLength = header.length + version.length + count.length +
    objects.reduce((sum, obj) => sum + obj.data.length + 24, 0) + 20 // 20 for checksum

  const result = new Uint8Array(totalLength)
  let offset = 0
  result.set(header, offset); offset += header.length
  result.set(version, offset); offset += version.length
  result.set(count, offset); offset += count.length

  for (const obj of objects) {
    // Simplified object entry
    const shaBytes = new TextEncoder().encode(obj.sha.slice(0, 20))
    result.set(shaBytes, offset); offset += 20
    const typeBytes = new TextEncoder().encode(obj.type.padEnd(4))
    result.set(typeBytes, offset); offset += 4
    result.set(obj.data, offset); offset += obj.data.length
  }

  return result
}

// ============================================================================
// CLONE TESTS
// ============================================================================

describe('clone', () => {
  let http: MockHttpClient
  let localRepo: MockRepo

  beforeEach(() => {
    http = createMockHttpClient()
    localRepo = createMockRepo()
  })

  describe('basic clone operations', () => {
    it('should clone a public repository', async () => {
      // Setup: configure remote with refs and pack data
      const remoteUrl = 'https://github.com/example/repo.git'
      const headCommitSha = 'abc123def456789012345678901234567890abcd'
      const treeSha = 'tree123456789012345678901234567890abcdef'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', headCommitSha],
          ['refs/heads/main', headCommitSha],
        ]),
        capabilities: ['multi_ack', 'thin-pack', 'side-band', 'side-band-64k', 'ofs-delta'],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: headCommitSha, type: 'commit', data: new TextEncoder().encode('commit data') },
        { sha: treeSha, type: 'tree', data: new TextEncoder().encode('tree data') },
      ]))

      // Execute: clone the repository
      const result = await clone({
        url: remoteUrl,
        directory: '/workspace/repo',
        http,
        localRepo,
      })

      // Verify: refs created correctly
      expect(result.exitCode).toBe(0)
      expect(localRepo.refs.get('refs/heads/main')).toBe(headCommitSha)
      expect(localRepo.refs.get('refs/remotes/origin/main')).toBe(headCommitSha)
      expect(localRepo.head.target).toBe('refs/heads/main')

      // Verify: objects downloaded
      expect(localRepo.objects.has(headCommitSha)).toBe(true)
      expect(localRepo.objects.has(treeSha)).toBe(true)

      // Verify: working tree populated
      expect(localRepo.workingTree.size).toBeGreaterThan(0)

      // Verify: origin remote configured
      expect(localRepo.remotes.get('origin')?.url).toBe(remoteUrl)
    })

    it('should clone with token authentication for private repo', async () => {
      const remoteUrl = 'https://github.com/example/private-repo.git'
      const headCommitSha = 'private123456789012345678901234567890ab'
      const token = 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

      // Mark repo as requiring auth
      http.authRequired.add(remoteUrl)

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', headCommitSha],
          ['refs/heads/main', headCommitSha],
        ]),
        capabilities: ['multi_ack'],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: headCommitSha, type: 'commit', data: new TextEncoder().encode('private commit') },
      ]))

      // Execute: clone with auth token
      const result = await clone({
        url: remoteUrl,
        directory: '/workspace/private-repo',
        auth: { type: 'token', token },
        http,
        localRepo,
      })

      // Verify: successful clone
      expect(result.exitCode).toBe(0)
      expect(localRepo.refs.get('refs/heads/main')).toBe(headCommitSha)

      // Verify: auth header was sent
      const authRequests = http.requests.filter(r => r.url.includes(remoteUrl))
      expect(authRequests.length).toBeGreaterThan(0)
      expect(authRequests[0].headers['Authorization']).toBe(`Bearer ${token}`)
    })

    it('should fail without auth on private repo', async () => {
      const remoteUrl = 'https://github.com/example/private-repo.git'

      // Mark repo as requiring auth
      http.authRequired.add(remoteUrl)

      // Execute: attempt clone without auth
      const result = await clone({
        url: remoteUrl,
        directory: '/workspace/private-repo',
        http,
        localRepo,
      })

      // Verify: authentication error
      expect(result.exitCode).toBe(128)
      expect(result.stderr).toContain('Authentication required')
      expect(localRepo.refs.size).toBe(0)
    })

    it('should respect --depth for shallow clone', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const commit1 = 'commit1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      const commit2 = 'commit2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      const commit3 = 'commit3cccccccccccccccccccccccccccccccccc'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', commit1],
          ['refs/heads/main', commit1],
        ]),
        capabilities: ['shallow', 'deepen-since', 'deepen-not'],
      })

      // Only provide the shallow commit
      http.packData.set(remoteUrl, createMockPackData([
        { sha: commit1, type: 'commit', data: new TextEncoder().encode('shallow commit') },
      ]))

      // Execute: shallow clone with depth 1
      const result = await clone({
        url: remoteUrl,
        directory: '/workspace/shallow-repo',
        depth: 1,
        http,
        localRepo,
      })

      // Verify: only requested commits fetched
      expect(result.exitCode).toBe(0)
      expect(localRepo.objects.has(commit1)).toBe(true)
      expect(localRepo.objects.has(commit2)).toBe(false)
      expect(localRepo.objects.has(commit3)).toBe(false)

      // Verify: shallow grafts recorded
      expect(localRepo.config.get('shallow')).toBeDefined()
    })

    it('should respect --branch option', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const mainCommit = 'maincommit12345678901234567890123456789'
      const devCommit = 'devcommit123456789012345678901234567890'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', mainCommit],
          ['refs/heads/main', mainCommit],
          ['refs/heads/develop', devCommit],
          ['refs/heads/feature/test', 'featurecommit1234567890123456789012'],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: devCommit, type: 'commit', data: new TextEncoder().encode('dev commit') },
      ]))

      // Execute: clone specific branch
      const result = await clone({
        url: remoteUrl,
        directory: '/workspace/dev-repo',
        branch: 'develop',
        http,
        localRepo,
      })

      // Verify: checked out correct branch
      expect(result.exitCode).toBe(0)
      expect(localRepo.head.target).toBe('refs/heads/develop')
      expect(localRepo.refs.get('refs/heads/develop')).toBe(devCommit)
    })

    it('should handle empty repository', async () => {
      const remoteUrl = 'https://github.com/example/empty-repo.git'

      http.infoRefs.set(remoteUrl, {
        refs: new Map(), // No refs - empty repo
        capabilities: ['report-status', 'delete-refs'],
      })

      // Execute: clone empty repo
      const result = await clone({
        url: remoteUrl,
        directory: '/workspace/empty-repo',
        http,
        localRepo,
      })

      // Verify: clone succeeds but no commits
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('empty repository')
      expect(localRepo.objects.size).toBe(0)
      expect(localRepo.refs.size).toBe(0)

      // Verify: remote still configured
      expect(localRepo.remotes.get('origin')?.url).toBe(remoteUrl)
    })

    it('should set origin remote in config', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const headCommit = 'configtest12345678901234567890123456789'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', headCommit],
          ['refs/heads/main', headCommit],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: headCommit, type: 'commit', data: new TextEncoder().encode('config commit') },
      ]))

      // Execute: clone
      const result = await clone({
        url: remoteUrl,
        directory: '/workspace/config-repo',
        http,
        localRepo,
      })

      // Verify: remote configuration set correctly
      expect(result.exitCode).toBe(0)
      const origin = localRepo.remotes.get('origin')
      expect(origin).toBeDefined()
      expect(origin!.url).toBe(remoteUrl)
      expect(origin!.fetch).toBe('+refs/heads/*:refs/remotes/origin/*')
    })

    it('should fail on invalid URL', async () => {
      const result = await clone({
        url: 'not-a-valid-url',
        directory: '/workspace/invalid',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(128)
      expect(result.stderr).toContain('Invalid URL')
    })

    it('should fail when directory already exists and is not empty', async () => {
      // Pre-populate workspace
      localRepo.workingTree.set('/workspace/existing/file.txt', new TextEncoder().encode('content'))

      const result = await clone({
        url: 'https://github.com/example/repo.git',
        directory: '/workspace/existing',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(128)
      expect(result.stderr).toContain('destination path')
      expect(result.stderr).toContain('already exists')
    })
  })

  describe('clone with submodules', () => {
    it('should clone with --recurse-submodules', async () => {
      const remoteUrl = 'https://github.com/example/repo-with-submodules.git'
      const mainCommit = 'mainsubmod123456789012345678901234567'
      const submoduleUrl = 'https://github.com/example/submodule.git'
      const submoduleCommit = 'submodulecommit12345678901234567890'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([['HEAD', mainCommit], ['refs/heads/main', mainCommit]]),
        capabilities: [],
      })

      http.infoRefs.set(submoduleUrl, {
        refs: new Map([['HEAD', submoduleCommit], ['refs/heads/main', submoduleCommit]]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: mainCommit, type: 'commit', data: new TextEncoder().encode('main with submodule') },
      ]))

      http.packData.set(submoduleUrl, createMockPackData([
        { sha: submoduleCommit, type: 'commit', data: new TextEncoder().encode('submodule commit') },
      ]))

      const result = await clone({
        url: remoteUrl,
        directory: '/workspace/with-submodules',
        recurseSubmodules: true,
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(0)
      // Verify submodule was also cloned (implementation detail)
      expect(result.submodulesCloned).toContain('submodule')
    })
  })
})

// ============================================================================
// FETCH TESTS
// ============================================================================

describe('fetch', () => {
  let http: MockHttpClient
  let localRepo: MockRepo

  beforeEach(() => {
    http = createMockHttpClient()
    localRepo = createMockRepo()

    // Setup: local repo with existing clone
    localRepo.remotes.set('origin', {
      url: 'https://github.com/example/repo.git',
      fetch: '+refs/heads/*:refs/remotes/origin/*',
    })
    localRepo.refs.set('refs/heads/main', 'localcommit1234567890123456789012345')
    localRepo.refs.set('refs/remotes/origin/main', 'localcommit1234567890123456789012345')
    localRepo.objects.set('localcommit1234567890123456789012345', {
      type: 'commit',
      data: new TextEncoder().encode('local commit'),
    })
  })

  describe('basic fetch operations', () => {
    it('should fetch new commits from remote', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const newCommit = 'newremotecommit12345678901234567890'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', newCommit],
          ['refs/heads/main', newCommit],
        ]),
        capabilities: ['multi_ack_detailed', 'thin-pack'],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: newCommit, type: 'commit', data: new TextEncoder().encode('new remote commit') },
      ]))

      // Execute: fetch
      const result = await fetch({
        remote: 'origin',
        http,
        localRepo,
      })

      // Verify: new objects fetched
      expect(result.exitCode).toBe(0)
      expect(localRepo.objects.has(newCommit)).toBe(true)
      expect(result.updatedRefs).toContain('refs/remotes/origin/main')
    })

    it('should update remote-tracking refs (refs/remotes/origin/*)', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const newMainCommit = 'newmaincommit123456789012345678901'
      const newDevCommit = 'newdevcommit1234567890123456789012'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', newMainCommit],
          ['refs/heads/main', newMainCommit],
          ['refs/heads/develop', newDevCommit],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: newMainCommit, type: 'commit', data: new TextEncoder().encode('new main') },
        { sha: newDevCommit, type: 'commit', data: new TextEncoder().encode('new dev') },
      ]))

      const result = await fetch({
        remote: 'origin',
        http,
        localRepo,
      })

      // Verify: remote-tracking refs updated
      expect(result.exitCode).toBe(0)
      expect(localRepo.refs.get('refs/remotes/origin/main')).toBe(newMainCommit)
      expect(localRepo.refs.get('refs/remotes/origin/develop')).toBe(newDevCommit)
    })

    it('should not modify local branches', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const localMain = 'localcommit1234567890123456789012345'
      const remoteMain = 'remotemaincommit123456789012345678'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', remoteMain],
          ['refs/heads/main', remoteMain],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: remoteMain, type: 'commit', data: new TextEncoder().encode('remote main') },
      ]))

      const result = await fetch({
        remote: 'origin',
        http,
        localRepo,
      })

      // Verify: local branch unchanged
      expect(result.exitCode).toBe(0)
      expect(localRepo.refs.get('refs/heads/main')).toBe(localMain)
      expect(localRepo.refs.get('refs/remotes/origin/main')).toBe(remoteMain)
    })

    it('should only fetch missing objects (efficient)', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      // existingCommit would be 'localcommit1234567890123456789012345' - not sent in pack
      const newCommit = 'brandnewcommit12345678901234567890'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', newCommit],
          ['refs/heads/main', newCommit],
        ]),
        capabilities: ['multi_ack_detailed'],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: newCommit, type: 'commit', data: new TextEncoder().encode('new commit') },
        // Note: existing commit should NOT be in pack
      ]))

      const result = await fetch({
        remote: 'origin',
        http,
        localRepo,
      })

      // Verify: only new objects fetched
      expect(result.exitCode).toBe(0)
      expect(result.objectsFetched).toBe(1)
      expect(localRepo.objects.has(newCommit)).toBe(true)

      // Verify: want/have negotiation happened
      const fetchRequest = http.requests.find(r => r.url.includes('git-upload-pack'))
      expect(fetchRequest).toBeDefined()
      // Request should include "have" lines for existing objects
    })

    it('should handle deleted remote branch with --prune', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'

      // Local has refs/remotes/origin/feature that no longer exists on remote
      localRepo.refs.set('refs/remotes/origin/feature', 'featurecommit123456789012345678901')

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', 'maincommit12345678901234567890123456'],
          ['refs/heads/main', 'maincommit12345678901234567890123456'],
          // Note: no refs/heads/feature
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([]))

      const result = await fetch({
        remote: 'origin',
        prune: true,
        http,
        localRepo,
      })

      // Verify: stale remote-tracking ref deleted
      expect(result.exitCode).toBe(0)
      expect(localRepo.refs.has('refs/remotes/origin/feature')).toBe(false)
      expect(result.prunedRefs).toContain('refs/remotes/origin/feature')
    })

    it('should handle already up-to-date', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const currentCommit = 'localcommit1234567890123456789012345'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', currentCommit],
          ['refs/heads/main', currentCommit],
        ]),
        capabilities: [],
      })

      // No pack data needed - already have everything
      http.packData.set(remoteUrl, createMockPackData([]))

      const result = await fetch({
        remote: 'origin',
        http,
        localRepo,
      })

      // Verify: no new objects, successful
      expect(result.exitCode).toBe(0)
      expect(result.objectsFetched).toBe(0)
      expect(result.stdout).toContain('Already up to date')
    })
  })

  describe('fetch specific refspecs', () => {
    it('should fetch only specified branch', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', 'maincommit12345678901234567890123456'],
          ['refs/heads/main', 'maincommit12345678901234567890123456'],
          ['refs/heads/develop', 'devcommit123456789012345678901234'],
          ['refs/heads/feature/x', 'featurexcommit12345678901234567'],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: 'devcommit123456789012345678901234', type: 'commit', data: new TextEncoder().encode('dev') },
      ]))

      const result = await fetch({
        remote: 'origin',
        refspecs: ['refs/heads/develop:refs/remotes/origin/develop'],
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(0)
      expect(localRepo.refs.get('refs/remotes/origin/develop')).toBe('devcommit123456789012345678901234')
      // Other branches not updated
      expect(localRepo.refs.has('refs/remotes/origin/feature/x')).toBe(false)
    })

    it('should fetch tags with --tags', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', 'maincommit12345678901234567890123456'],
          ['refs/heads/main', 'maincommit12345678901234567890123456'],
          ['refs/tags/v1.0.0', 'tagv1commit1234567890123456789012'],
          ['refs/tags/v2.0.0', 'tagv2commit1234567890123456789012'],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: 'tagv1commit1234567890123456789012', type: 'tag', data: new TextEncoder().encode('tag v1') },
        { sha: 'tagv2commit1234567890123456789012', type: 'tag', data: new TextEncoder().encode('tag v2') },
      ]))

      const result = await fetch({
        remote: 'origin',
        tags: true,
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(0)
      expect(localRepo.refs.get('refs/tags/v1.0.0')).toBe('tagv1commit1234567890123456789012')
      expect(localRepo.refs.get('refs/tags/v2.0.0')).toBe('tagv2commit1234567890123456789012')
    })
  })

  describe('fetch error handling', () => {
    it('should fail when remote does not exist', async () => {
      const result = await fetch({
        remote: 'nonexistent',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(128)
      expect(result.stderr).toContain("Remote 'nonexistent' not found")
    })

    it('should fail when remote URL is unreachable', async () => {
      // No infoRefs configured for this URL - simulates network failure

      const result = await fetch({
        remote: 'origin',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(128)
      expect(result.stderr).toContain('Could not connect')
    })
  })
})

// ============================================================================
// PUSH TESTS
// ============================================================================

describe('push', () => {
  let http: MockHttpClient
  let localRepo: MockRepo

  beforeEach(() => {
    http = createMockHttpClient()
    localRepo = createMockRepo()

    // Setup: local repo with commits
    const localCommit = 'localpushcommit123456789012345678901'
    localRepo.remotes.set('origin', {
      url: 'https://github.com/example/repo.git',
      fetch: '+refs/heads/*:refs/remotes/origin/*',
    })
    localRepo.refs.set('refs/heads/main', localCommit)
    localRepo.refs.set('refs/remotes/origin/main', 'oldremotecommit12345678901234567890')
    localRepo.objects.set(localCommit, {
      type: 'commit',
      data: new TextEncoder().encode('local commit to push'),
    })
    localRepo.head = { symbolic: true, target: 'refs/heads/main' }
  })

  describe('basic push operations', () => {
    it('should push commits to remote', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      // localCommit = 'localpushcommit123456789012345678901'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', 'oldremotecommit12345678901234567890'],
          ['refs/heads/main', 'oldremotecommit12345678901234567890'],
        ]),
        capabilities: ['report-status', 'delete-refs', 'side-band-64k'],
      })

      http.receivePack.set(remoteUrl, { ok: true })

      const result = await push({
        remote: 'origin',
        http,
        localRepo,
      })

      // Verify: push successful
      expect(result.exitCode).toBe(0)
      expect(result.pushedRefs).toContain('refs/heads/main')

      // Verify: receive-pack request was made
      const pushRequest = http.requests.find(r => r.url.includes('git-receive-pack'))
      expect(pushRequest).toBeDefined()
    })

    it('should update remote ref', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const localCommit = 'localpushcommit123456789012345678901'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', 'oldremotecommit12345678901234567890'],
          ['refs/heads/main', 'oldremotecommit12345678901234567890'],
        ]),
        capabilities: ['report-status'],
      })

      http.receivePack.set(remoteUrl, { ok: true })

      const result = await push({
        remote: 'origin',
        http,
        localRepo,
      })

      // Verify: remote-tracking ref updated locally
      expect(result.exitCode).toBe(0)
      expect(localRepo.refs.get('refs/remotes/origin/main')).toBe(localCommit)
    })

    it('should send only missing objects', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'

      // Add additional commits locally
      const commit1 = 'existingcommit123456789012345678901'
      const commit2 = 'newcommit12345678901234567890123456'
      localRepo.objects.set(commit1, { type: 'commit', data: new TextEncoder().encode('existing') })
      localRepo.objects.set(commit2, { type: 'commit', data: new TextEncoder().encode('new') })
      localRepo.refs.set('refs/heads/main', commit2)

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', commit1],
          ['refs/heads/main', commit1],
        ]),
        capabilities: ['report-status'],
      })

      http.receivePack.set(remoteUrl, { ok: true })

      const result = await push({
        remote: 'origin',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(0)
      expect(result.objectsSent).toBe(1) // Only the new commit
    })

    it('should push specific branch', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const featureCommit = 'featurecommit123456789012345678901'

      localRepo.refs.set('refs/heads/feature/awesome', featureCommit)
      localRepo.objects.set(featureCommit, {
        type: 'commit',
        data: new TextEncoder().encode('feature commit'),
      })

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', 'maincommit12345678901234567890123456'],
          ['refs/heads/main', 'maincommit12345678901234567890123456'],
        ]),
        capabilities: ['report-status'],
      })

      http.receivePack.set(remoteUrl, { ok: true })

      const result = await push({
        remote: 'origin',
        refspecs: ['refs/heads/feature/awesome:refs/heads/feature/awesome'],
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(0)
      expect(result.pushedRefs).toContain('refs/heads/feature/awesome')
    })

    it('should create new remote branch', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const newBranchCommit = 'newbranchcommit1234567890123456789'

      localRepo.refs.set('refs/heads/new-feature', newBranchCommit)
      localRepo.objects.set(newBranchCommit, {
        type: 'commit',
        data: new TextEncoder().encode('new branch commit'),
      })

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', 'maincommit12345678901234567890123456'],
          ['refs/heads/main', 'maincommit12345678901234567890123456'],
          // Note: no refs/heads/new-feature exists on remote
        ]),
        capabilities: ['report-status'],
      })

      http.receivePack.set(remoteUrl, { ok: true })

      const result = await push({
        remote: 'origin',
        refspecs: ['refs/heads/new-feature:refs/heads/new-feature'],
        setUpstream: true,
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(0)
      expect(result.createdRefs).toContain('refs/heads/new-feature')

      // Verify: upstream tracking set
      expect(localRepo.config.get('branch.new-feature.remote')).toBe('origin')
      expect(localRepo.config.get('branch.new-feature.merge')).toBe('refs/heads/new-feature')
    })

    it('should delete remote branch', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', 'maincommit12345678901234567890123456'],
          ['refs/heads/main', 'maincommit12345678901234567890123456'],
          ['refs/heads/old-feature', 'oldfeaturecommit1234567890123456'],
        ]),
        capabilities: ['report-status', 'delete-refs'],
      })

      http.receivePack.set(remoteUrl, { ok: true })

      const result = await push({
        remote: 'origin',
        refspecs: [':refs/heads/old-feature'], // Delete refspec
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(0)
      expect(result.deletedRefs).toContain('refs/heads/old-feature')
    })
  })

  describe('push rejection handling', () => {
    it('should reject non-fast-forward (without --force)', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'

      // Remote has diverged - has a commit not in local history
      const remoteCommit = 'divergedremote12345678901234567890'
      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', remoteCommit],
          ['refs/heads/main', remoteCommit],
        ]),
        capabilities: ['report-status'],
      })

      // Local commit is NOT a descendant of remote commit
      const localCommit = 'localpushcommit123456789012345678901'
      localRepo.refs.set('refs/heads/main', localCommit)
      // Not adding remoteCommit to localRepo.objects - simulating divergence

      const result = await push({
        remote: 'origin',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('non-fast-forward')
      expect(result.stderr).toContain('rejected')
    })

    it('should allow --force push', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'

      // Remote has diverged
      const remoteCommit = 'divergedremote12345678901234567890'
      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', remoteCommit],
          ['refs/heads/main', remoteCommit],
        ]),
        capabilities: ['report-status'],
      })

      http.receivePack.set(remoteUrl, { ok: true })

      const result = await push({
        remote: 'origin',
        force: true,
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(0)
      expect(result.forcePushed).toContain('refs/heads/main')
    })

    it('should handle protected branch rejection', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', 'oldmaincommit1234567890123456789012'],
          ['refs/heads/main', 'oldmaincommit1234567890123456789012'],
        ]),
        capabilities: ['report-status'],
      })

      // Configure protected branch
      http.protectedBranches.set(remoteUrl, new Set(['refs/heads/main']))
      http.receivePack.set(remoteUrl, {
        ok: false,
        error: 'protected branch hook declined',
      })

      const result = await push({
        remote: 'origin',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('protected')
      expect(result.stderr).toContain('declined')
    })
  })

  describe('push with tags', () => {
    it('should push tags with --tags', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const tagCommit = 'taggedcommit12345678901234567890123'

      localRepo.refs.set('refs/tags/v1.0.0', tagCommit)
      localRepo.objects.set(tagCommit, {
        type: 'tag',
        data: new TextEncoder().encode('tag object'),
      })

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', 'maincommit12345678901234567890123456'],
          ['refs/heads/main', 'maincommit12345678901234567890123456'],
        ]),
        capabilities: ['report-status'],
      })

      http.receivePack.set(remoteUrl, { ok: true })

      const result = await push({
        remote: 'origin',
        tags: true,
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(0)
      expect(result.pushedRefs).toContain('refs/tags/v1.0.0')
    })
  })

  describe('push error handling', () => {
    it('should fail when no upstream configured and no refspec', async () => {
      // Remove tracking config
      localRepo.remotes.clear()

      const result = await push({
        remote: 'origin',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(128)
      expect(result.stderr).toContain("Remote 'origin' not found")
    })

    it('should fail when local branch does not exist', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([['HEAD', 'maincommit']]),
        capabilities: [],
      })

      const result = await push({
        remote: 'origin',
        refspecs: ['refs/heads/nonexistent:refs/heads/nonexistent'],
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(128)
      expect(result.stderr).toContain('does not match any')
    })
  })
})

// ============================================================================
// PULL TESTS
// ============================================================================

describe('pull', () => {
  let http: MockHttpClient
  let localRepo: MockRepo

  beforeEach(() => {
    http = createMockHttpClient()
    localRepo = createMockRepo()

    // Setup: local repo with tracking branch
    const localCommit = 'localpullcommit12345678901234567890'
    localRepo.remotes.set('origin', {
      url: 'https://github.com/example/repo.git',
      fetch: '+refs/heads/*:refs/remotes/origin/*',
    })
    localRepo.refs.set('refs/heads/main', localCommit)
    localRepo.refs.set('refs/remotes/origin/main', localCommit)
    localRepo.objects.set(localCommit, {
      type: 'commit',
      data: new TextEncoder().encode('local commit'),
    })
    localRepo.head = { symbolic: true, target: 'refs/heads/main' }
    localRepo.config.set('branch.main.remote', 'origin')
    localRepo.config.set('branch.main.merge', 'refs/heads/main')
  })

  describe('fast-forward pull', () => {
    it('should fast-forward when possible', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      // localCommit = 'localpullcommit12345678901234567890'
      const newCommit = 'newremotepullcommit12345678901234567'

      // New remote commit has local commit as parent (fast-forward possible)
      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', newCommit],
          ['refs/heads/main', newCommit],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: newCommit, type: 'commit', data: new TextEncoder().encode('new remote commit') },
      ]))

      const result = await pull({
        remote: 'origin',
        http,
        localRepo,
      })

      // Verify: fast-forward merge
      expect(result.exitCode).toBe(0)
      expect(result.type).toBe('fast-forward')
      expect(localRepo.refs.get('refs/heads/main')).toBe(newCommit)
    })

    it('should update working tree', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const newCommit = 'worktreetestcommit12345678901234567'
      const newTreeSha = 'newtreeshacommit1234567890123456789'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', newCommit],
          ['refs/heads/main', newCommit],
        ]),
        capabilities: [],
      })

      // Pack includes commit and tree with new file
      http.packData.set(remoteUrl, createMockPackData([
        { sha: newCommit, type: 'commit', data: new TextEncoder().encode(`tree ${newTreeSha}\n...`) },
        { sha: newTreeSha, type: 'tree', data: new TextEncoder().encode('100644 newfile.txt\x00...') },
        { sha: 'newfileblobsha123456789012345678901', type: 'blob', data: new TextEncoder().encode('new content') },
      ]))

      // Initial working tree state
      localRepo.workingTree.set('/workspace/oldfile.txt', new TextEncoder().encode('old content'))

      const result = await pull({
        remote: 'origin',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(0)
      // Working tree should be updated with new files
      expect(localRepo.workingTree.has('/workspace/newfile.txt')).toBe(true)
    })
  })

  describe('merge pull', () => {
    it('should create merge commit when diverged', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const baseCommit = 'basecommit1234567890123456789012345'
      const localCommit = 'localdivergent123456789012345678901'
      const remoteCommit = 'remotedivergent12345678901234567890'

      // Setup: local has diverged from base
      localRepo.refs.set('refs/heads/main', localCommit)
      localRepo.refs.set('refs/remotes/origin/main', baseCommit)
      localRepo.objects.set(baseCommit, {
        type: 'commit',
        data: new TextEncoder().encode('base commit'),
      })
      localRepo.objects.set(localCommit, {
        type: 'commit',
        data: new TextEncoder().encode(`tree abc\nparent ${baseCommit}\n\nlocal change`),
      })

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', remoteCommit],
          ['refs/heads/main', remoteCommit],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: remoteCommit, type: 'commit', data: new TextEncoder().encode(`tree def\nparent ${baseCommit}\n\nremote change`) },
      ]))

      const result = await pull({
        remote: 'origin',
        http,
        localRepo,
      })

      // Verify: merge commit created
      expect(result.exitCode).toBe(0)
      expect(result.type).toBe('merge')
      expect(result.mergeCommit).toBeDefined()

      // Verify: merge commit has both parents
      const mergeCommitData = localRepo.objects.get(result.mergeCommit!)
      expect(mergeCommitData).toBeDefined()
      const mergeContent = new TextDecoder().decode(mergeCommitData!.data)
      expect(mergeContent).toContain(`parent ${localCommit}`)
      expect(mergeContent).toContain(`parent ${remoteCommit}`)
    })

    it('should detect conflicts', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const baseCommit = 'basecommit1234567890123456789012345'
      const localCommit = 'localconflict1234567890123456789012'
      const remoteCommit = 'remoteconflict12345678901234567890'
      const baseTree = 'basetree12345678901234567890123456789'
      const conflictFile = 'conflict.txt'

      // Setup: both modified the same file differently
      localRepo.refs.set('refs/heads/main', localCommit)
      localRepo.refs.set('refs/remotes/origin/main', baseCommit)

      // Base has conflict.txt with "original content"
      localRepo.objects.set(baseCommit, {
        type: 'commit',
        data: new TextEncoder().encode(`tree ${baseTree}`),
      })

      // Local changed to "local change"
      localRepo.objects.set(localCommit, {
        type: 'commit',
        data: new TextEncoder().encode(`tree localtree\nparent ${baseCommit}`),
      })
      localRepo.workingTree.set(`/workspace/${conflictFile}`, new TextEncoder().encode('local change'))

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', remoteCommit],
          ['refs/heads/main', remoteCommit],
        ]),
        capabilities: [],
      })

      // Remote changed to "remote change"
      http.packData.set(remoteUrl, createMockPackData([
        { sha: remoteCommit, type: 'commit', data: new TextEncoder().encode(`tree remotetree\nparent ${baseCommit}`) },
        { sha: 'remotetree', type: 'tree', data: new TextEncoder().encode('tree with conflict.txt') },
        { sha: 'remoteblobconflict', type: 'blob', data: new TextEncoder().encode('remote change') },
      ]))

      const result = await pull({
        remote: 'origin',
        http,
        localRepo,
      })

      // Verify: conflict detected
      expect(result.exitCode).toBe(1)
      expect(result.type).toBe('conflict')
      expect(result.conflicts).toContain(conflictFile)

      // Verify: working tree has conflict markers
      const conflictContent = localRepo.workingTree.get(`/workspace/${conflictFile}`)
      expect(conflictContent).toBeDefined()
      const content = new TextDecoder().decode(conflictContent!)
      expect(content).toContain('<<<<<<< HEAD')
      expect(content).toContain('=======')
      expect(content).toContain('>>>>>>>')
    })
  })

  describe('rebase pull', () => {
    it('should support --rebase mode', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const baseCommit = 'basecommit1234567890123456789012345'
      const localCommit = 'localrebase12345678901234567890123'
      const remoteCommit = 'remoterebase1234567890123456789012'

      localRepo.refs.set('refs/heads/main', localCommit)
      localRepo.refs.set('refs/remotes/origin/main', baseCommit)
      localRepo.objects.set(baseCommit, {
        type: 'commit',
        data: new TextEncoder().encode('base'),
      })
      localRepo.objects.set(localCommit, {
        type: 'commit',
        data: new TextEncoder().encode(`tree abc\nparent ${baseCommit}\n\nlocal work`),
      })

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', remoteCommit],
          ['refs/heads/main', remoteCommit],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: remoteCommit, type: 'commit', data: new TextEncoder().encode(`tree def\nparent ${baseCommit}\n\nremote work`) },
      ]))

      const result = await pull({
        remote: 'origin',
        rebase: true,
        http,
        localRepo,
      })

      // Verify: rebase performed
      expect(result.exitCode).toBe(0)
      expect(result.type).toBe('rebase')

      // Verify: local commit rebased on top of remote
      const newMain = localRepo.refs.get('refs/heads/main')
      expect(newMain).toBeDefined()
      expect(newMain).not.toBe(localCommit) // New commit SHA after rebase

      // The rebased commit should have remote as parent
      const rebasedCommit = localRepo.objects.get(newMain!)
      expect(rebasedCommit).toBeDefined()
      const commitContent = new TextDecoder().decode(rebasedCommit!.data)
      expect(commitContent).toContain(`parent ${remoteCommit}`)
    })
  })

  describe('dirty working tree', () => {
    it('should handle dirty working tree', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const newCommit = 'newpullcommit123456789012345678901'

      // Setup: uncommitted changes in working tree
      localRepo.workingTree.set('/workspace/modified.txt', new TextEncoder().encode('uncommitted changes'))
      localRepo.index.set('modified.txt', {
        sha: 'originalsha12345678901234567890123456',
        mode: 0o100644,
      })

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', newCommit],
          ['refs/heads/main', newCommit],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: newCommit, type: 'commit', data: new TextEncoder().encode('new commit') },
      ]))

      const result = await pull({
        remote: 'origin',
        http,
        localRepo,
      })

      // Verify: pull refused due to dirty tree
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('uncommitted changes')
      expect(result.stderr).toContain('Please commit or stash')
    })

    it('should allow pull with --autostash', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const newCommit = 'autostashcommit1234567890123456789'

      // Setup: uncommitted changes
      localRepo.workingTree.set('/workspace/modified.txt', new TextEncoder().encode('uncommitted'))
      localRepo.index.set('modified.txt', {
        sha: 'originalsha12345678901234567890123456',
        mode: 0o100644,
      })

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', newCommit],
          ['refs/heads/main', newCommit],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([
        { sha: newCommit, type: 'commit', data: new TextEncoder().encode('new commit') },
      ]))

      const result = await pull({
        remote: 'origin',
        autostash: true,
        http,
        localRepo,
      })

      // Verify: pull succeeded with autostash
      expect(result.exitCode).toBe(0)
      expect(result.stashed).toBe(true)
      expect(result.stashApplied).toBe(true)
    })
  })

  describe('already up-to-date', () => {
    it('should handle already up-to-date', async () => {
      const remoteUrl = 'https://github.com/example/repo.git'
      const currentCommit = 'localpullcommit12345678901234567890'

      http.infoRefs.set(remoteUrl, {
        refs: new Map([
          ['HEAD', currentCommit],
          ['refs/heads/main', currentCommit],
        ]),
        capabilities: [],
      })

      http.packData.set(remoteUrl, createMockPackData([]))

      const result = await pull({
        remote: 'origin',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(0)
      expect(result.type).toBe('already-up-to-date')
      expect(result.stdout).toContain('Already up to date')
    })
  })

  describe('pull error handling', () => {
    it('should fail when not on a branch', async () => {
      // Detached HEAD state
      localRepo.head = { symbolic: false, target: 'detachedsha1234567890123456789012' }

      const result = await pull({
        remote: 'origin',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(128)
      expect(result.stderr).toContain('not currently on a branch')
    })

    it('should fail when no tracking branch configured', async () => {
      // Remove tracking config
      localRepo.config.delete('branch.main.remote')
      localRepo.config.delete('branch.main.merge')

      const result = await pull({
        remote: 'origin',
        http,
        localRepo,
      })

      expect(result.exitCode).toBe(128)
      expect(result.stderr).toContain('no tracking information')
    })
  })
})

// ============================================================================
// TYPE DEFINITIONS FOR IMPLEMENTATION
// ============================================================================

// These types are imported from the implementation files
// but defined here for reference during RED phase

/*
interface CloneOptions {
  url: string
  directory: string
  auth?: { type: 'token'; token: string } | { type: 'basic'; username: string; password: string }
  depth?: number
  branch?: string
  recurseSubmodules?: boolean
  http: MockHttpClient
  localRepo: MockRepo
}

interface CloneResult {
  exitCode: number
  stdout: string
  stderr: string
  submodulesCloned?: string[]
}

interface FetchOptions {
  remote: string
  refspecs?: string[]
  prune?: boolean
  tags?: boolean
  http: MockHttpClient
  localRepo: MockRepo
}

interface FetchResult {
  exitCode: number
  stdout: string
  stderr: string
  updatedRefs?: string[]
  prunedRefs?: string[]
  objectsFetched: number
}

interface PushOptions {
  remote: string
  refspecs?: string[]
  force?: boolean
  setUpstream?: boolean
  tags?: boolean
  http: MockHttpClient
  localRepo: MockRepo
}

interface PushResult {
  exitCode: number
  stdout: string
  stderr: string
  pushedRefs?: string[]
  createdRefs?: string[]
  deletedRefs?: string[]
  forcePushed?: string[]
  objectsSent: number
}

interface PullOptions {
  remote: string
  rebase?: boolean
  autostash?: boolean
  http: MockHttpClient
  localRepo: MockRepo
}

interface PullResult {
  exitCode: number
  stdout: string
  stderr: string
  type: 'fast-forward' | 'merge' | 'rebase' | 'conflict' | 'already-up-to-date'
  mergeCommit?: string
  conflicts?: string[]
  stashed?: boolean
  stashApplied?: boolean
}
*/
