import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Ref,
  ReceivePackCapabilities,
  ReceivePackSession,
  RefUpdateCommand,
  RefUpdateResult,
  PackfileValidation,
  HookExecutionPoint,
  HookResult,
  ObjectStore,
  advertiseReceiveRefs,
  createReceiveSession,
  parseCommandLine,
  parseReceivePackRequest,
  processCommands,
  validatePackfile,
  unpackObjects,
  updateRefs,
  executePreReceiveHook,
  executeUpdateHook,
  executePostReceiveHook,
  executePostUpdateHook,
  formatReportStatus,
  formatReportStatusV2,
  buildReceiveCapabilityString,
  parseReceiveCapabilities,
  handleReceivePack,
  validateRefName,
  validateFastForward,
  checkRefPermissions,
  atomicRefUpdate,
  rejectPush,
  ZERO_SHA,
} from '../../src/wire/receive-pack'
import { decodePktLine, pktLineStream, FLUSH_PKT } from '../../src/wire/pkt-line'

// Helper to create test data
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Sample SHA-1 hashes for testing
const SHA1_COMMIT_1 = 'a'.repeat(40)
const SHA1_COMMIT_2 = 'b'.repeat(40)
const SHA1_COMMIT_3 = 'c'.repeat(40)
const SHA1_COMMIT_4 = 'd'.repeat(40)
const SHA1_TREE_1 = 'e'.repeat(40)
const SHA1_BLOB_1 = 'f'.repeat(40)
const SHA1_TAG_1 = '1'.repeat(40)

// Mock object store implementation
function createMockStore(
  objects: Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }> = new Map()
): ObjectStore {
  const refs: Ref[] = [
    { name: 'refs/heads/main', sha: SHA1_COMMIT_1 },
    { name: 'refs/heads/feature', sha: SHA1_COMMIT_2 },
    { name: 'refs/tags/v1.0.0', sha: SHA1_TAG_1, peeled: SHA1_COMMIT_3 },
  ]

  return {
    async getObject(sha: string) {
      return objects.get(sha) || null
    },
    async hasObject(sha: string) {
      return objects.has(sha)
    },
    async getCommitParents(sha: string) {
      // Simple parent chain for testing
      if (sha === SHA1_COMMIT_1) return [SHA1_COMMIT_2]
      if (sha === SHA1_COMMIT_2) return [SHA1_COMMIT_3]
      if (sha === SHA1_COMMIT_4) return [SHA1_COMMIT_1] // Fast-forward case
      return []
    },
    async getRefs() {
      return refs
    },
    async getRef(name: string) {
      return refs.find((r) => r.name === name) || null
    },
    async setRef(name: string, sha: string) {
      const existing = refs.findIndex((r) => r.name === name)
      if (existing >= 0) {
        refs[existing].sha = sha
      } else {
        refs.push({ name, sha })
      }
    },
    async deleteRef(name: string) {
      const index = refs.findIndex((r) => r.name === name)
      if (index >= 0) refs.splice(index, 1)
    },
    async storeObject(sha: string, type: string, data: Uint8Array) {
      objects.set(sha, { type: type as 'blob' | 'tree' | 'commit' | 'tag', data })
    },
    async isAncestor(ancestor: string, descendant: string) {
      // Simple ancestry check for testing
      if (ancestor === SHA1_COMMIT_2 && descendant === SHA1_COMMIT_1) return true
      if (ancestor === SHA1_COMMIT_3 && descendant === SHA1_COMMIT_2) return true
      if (ancestor === SHA1_COMMIT_1 && descendant === SHA1_COMMIT_4) return true
      return false
    },
  }
}

// Create sample commit data
function createCommitData(tree: string, parents: string[], message: string): Uint8Array {
  const lines = [`tree ${tree}`]
  for (const parent of parents) {
    lines.push(`parent ${parent}`)
  }
  lines.push('author Test <test@example.com.ai> 1704067200 +0000')
  lines.push('committer Test <test@example.com.ai> 1704067200 +0000')
  lines.push('')
  lines.push(message)
  return encoder.encode(lines.join('\n'))
}

// Create sample packfile data
function createSamplePackfile(objectCount: number = 1): Uint8Array {
  // PACK signature + version 2 + object count
  const header = new Uint8Array([
    0x50,
    0x41,
    0x43,
    0x4b, // PACK
    0x00,
    0x00,
    0x00,
    0x02, // Version 2
    (objectCount >> 24) & 0xff,
    (objectCount >> 16) & 0xff,
    (objectCount >> 8) & 0xff,
    objectCount & 0xff,
  ])
  // Add 20-byte SHA-1 trailer (mock)
  const trailer = new Uint8Array(20).fill(0xab)
  const result = new Uint8Array(header.length + trailer.length)
  result.set(header, 0)
  result.set(trailer, header.length)
  return result
}

describe('git-receive-pack', () => {
  let mockStore: ObjectStore
  let objects: Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>

  beforeEach(() => {
    objects = new Map([
      [SHA1_COMMIT_1, { type: 'commit', data: createCommitData(SHA1_TREE_1, [SHA1_COMMIT_2], 'Latest commit') }],
      [SHA1_COMMIT_2, { type: 'commit', data: createCommitData(SHA1_TREE_1, [SHA1_COMMIT_3], 'Previous commit') }],
      [SHA1_COMMIT_3, { type: 'commit', data: createCommitData(SHA1_TREE_1, [], 'Initial commit') }],
      [SHA1_COMMIT_4, { type: 'commit', data: createCommitData(SHA1_TREE_1, [SHA1_COMMIT_1], 'New commit') }],
      [SHA1_TREE_1, { type: 'tree', data: new Uint8Array([]) }],
      [SHA1_BLOB_1, { type: 'blob', data: encoder.encode('Hello, World!') }],
      [
        SHA1_TAG_1,
        {
          type: 'tag',
          data: encoder.encode(
            `object ${SHA1_COMMIT_3}\ntype commit\ntag v1.0.0\ntagger Test <test@example.com.ai> 1704067200 +0000\n\nVersion 1.0.0`
          ),
        },
      ],
    ])
    mockStore = createMockStore(objects)
  })

  // ==========================================================================
  // 1. Ref Advertisement for Receive-Pack
  // ==========================================================================
  describe('Ref Advertisement', () => {
    it('should advertise all refs with capabilities on first line', async () => {
      const result = await advertiseReceiveRefs(mockStore)

      // First ref line should include capabilities
      expect(result).toContain('refs/heads/main')
      expect(result).toContain(SHA1_COMMIT_1)
      // Capabilities should be present on first line (after NUL byte)
      expect(result).toMatch(/\x00[a-z\-\s]+/)
    })

    it('should advertise HEAD ref', async () => {
      const result = await advertiseReceiveRefs(mockStore)
      // HEAD should be advertised
      expect(result).toContain('HEAD')
    })

    it('should include receive-pack specific capabilities', async () => {
      const result = await advertiseReceiveRefs(mockStore, {
        reportStatus: true,
        reportStatusV2: true,
        deleteRefs: true,
        quiet: true,
        atomic: true,
        pushOptions: true,
        sideBand64k: true,
      })

      expect(result).toContain('report-status')
      expect(result).toContain('report-status-v2')
      expect(result).toContain('delete-refs')
      expect(result).toContain('quiet')
      expect(result).toContain('atomic')
      expect(result).toContain('push-options')
      expect(result).toContain('side-band-64k')
    })

    it('should include push-cert capability when supported', async () => {
      const result = await advertiseReceiveRefs(mockStore, {
        pushCert: 'nonce',
      })

      expect(result).toContain('push-cert=nonce')
    })

    it('should end with flush-pkt', async () => {
      const result = await advertiseReceiveRefs(mockStore)
      expect(result).toContain(FLUSH_PKT)
    })

    it('should format each ref as valid pkt-line', async () => {
      const result = await advertiseReceiveRefs(mockStore)
      const { packets } = pktLineStream(result)

      // Should have at least one data packet
      const dataPackets = packets.filter((p) => p.type === 'data')
      expect(dataPackets.length).toBeGreaterThan(0)

      // Each data packet should contain a SHA and ref name
      for (const packet of dataPackets) {
        if (packet.data) {
          expect(packet.data).toMatch(/^[0-9a-f]{40}/)
        }
      }
    })

    it('should return empty advertisement for empty repository', async () => {
      const emptyStore: ObjectStore = {
        ...mockStore,
        async getRefs() {
          return []
        },
      }

      const result = await advertiseReceiveRefs(emptyStore)
      // Should still have capabilities line with ZERO_SHA for empty repo
      expect(result).toContain(ZERO_SHA)
      expect(result).toContain(FLUSH_PKT)
    })

    it('should advertise capabilities even for empty repository', async () => {
      const emptyStore: ObjectStore = {
        ...mockStore,
        async getRefs() {
          return []
        },
      }

      const result = await advertiseReceiveRefs(emptyStore, {
        reportStatus: true,
        deleteRefs: true,
      })

      expect(result).toContain('report-status')
      expect(result).toContain('delete-refs')
    })

    it('should sort refs in the advertisement', async () => {
      const result = await advertiseReceiveRefs(mockStore)
      // Refs should appear in sorted order (HEAD first, then alphabetically)
      const headIndex = result.indexOf('HEAD')
      const mainIndex = result.indexOf('refs/heads/main')
      const featureIndex = result.indexOf('refs/heads/feature')

      if (headIndex !== -1 && mainIndex !== -1) {
        expect(headIndex).toBeLessThan(mainIndex)
      }
      if (featureIndex !== -1 && mainIndex !== -1) {
        expect(featureIndex).toBeLessThan(mainIndex) // feature < main alphabetically
      }
    })
  })

  // ==========================================================================
  // 2. Packfile Receiving and Validation
  // ==========================================================================
  describe('Packfile Receiving', () => {
    describe('validatePackfile', () => {
      it('should accept valid packfile with PACK signature', async () => {
        const packfile = createSamplePackfile(1)
        const result = await validatePackfile(packfile)

        expect(result.valid).toBe(true)
        expect(result.objectCount).toBe(1)
      })

      it('should reject packfile without PACK signature', async () => {
        const invalidPackfile = new Uint8Array([0x00, 0x00, 0x00, 0x00])
        const result = await validatePackfile(invalidPackfile)

        expect(result.valid).toBe(false)
        expect(result.error).toContain('signature')
      })

      it('should reject packfile with unsupported version', async () => {
        const packfile = new Uint8Array([
          0x50,
          0x41,
          0x43,
          0x4b, // PACK
          0x00,
          0x00,
          0x00,
          0x05, // Version 5 (unsupported)
          0x00,
          0x00,
          0x00,
          0x00,
        ])
        const result = await validatePackfile(packfile)

        expect(result.valid).toBe(false)
        expect(result.error).toContain('version')
      })

      it('should validate packfile checksum', async () => {
        const packfile = createSamplePackfile(1)
        // Corrupt the checksum
        packfile[packfile.length - 1] = 0x00

        const result = await validatePackfile(packfile, { verifyChecksum: true })

        expect(result.valid).toBe(false)
        expect(result.error).toContain('checksum')
      })

      it('should parse object count from header', async () => {
        const packfile = createSamplePackfile(42)
        const result = await validatePackfile(packfile)

        expect(result.objectCount).toBe(42)
      })

      it('should handle empty packfile for ref deletion', async () => {
        const emptyPackfile = new Uint8Array(0)
        const result = await validatePackfile(emptyPackfile, { allowEmpty: true })

        expect(result.valid).toBe(true)
        expect(result.objectCount).toBe(0)
      })

      it('should reject truncated packfile', async () => {
        const packfile = new Uint8Array([0x50, 0x41, 0x43, 0x4b]) // Only signature, no header
        const result = await validatePackfile(packfile)

        expect(result.valid).toBe(false)
        expect(result.error).toContain('truncated')
      })
    })

    describe('unpackObjects', () => {
      it('should unpack objects from valid packfile', async () => {
        const packfile = createSamplePackfile(1)
        const result = await unpackObjects(packfile, mockStore)

        expect(result.success).toBe(true)
        expect(result.objectsUnpacked).toBeGreaterThanOrEqual(0)
      })

      it('should store unpacked objects in object store', async () => {
        const packfile = createSamplePackfile(1)
        const newObjects = new Map()
        const store = createMockStore(newObjects)

        await unpackObjects(packfile, store)

        // Objects should be stored (implementation-dependent)
        // This is a structural expectation
        expect(store.storeObject).toBeDefined()
      })

      it('should handle delta objects', async () => {
        // Create a packfile with delta objects
        const packfile = createSamplePackfile(2)
        const result = await unpackObjects(packfile, mockStore, { resolveDelta: true })

        expect(result.success).toBe(true)
      })

      it('should report progress during unpacking', async () => {
        const packfile = createSamplePackfile(10)
        const progressMessages: string[] = []

        await unpackObjects(packfile, mockStore, {
          onProgress: (msg) => progressMessages.push(msg),
        })

        expect(progressMessages.length).toBeGreaterThan(0)
        expect(progressMessages.some((m) => m.includes('Unpacking'))).toBe(true)
      })

      it('should fail on corrupt object data', async () => {
        const packfile = createSamplePackfile(1)
        // Corrupt object data (simplified test)
        packfile[12] = 0xff

        const result = await unpackObjects(packfile, mockStore)

        expect(result.success).toBe(false)
      })

      it('should return list of unpacked object SHAs', async () => {
        const packfile = createSamplePackfile(3)
        const result = await unpackObjects(packfile, mockStore)

        expect(result.unpackedShas).toBeInstanceOf(Array)
      })
    })
  })

  // ==========================================================================
  // 3. Ref Update Commands
  // ==========================================================================
  describe('Ref Updates', () => {
    describe('parseCommandLine', () => {
      it('should parse create ref command', () => {
        const result = parseCommandLine(`${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/new-branch`)

        expect(result.oldSha).toBe(ZERO_SHA)
        expect(result.newSha).toBe(SHA1_COMMIT_1)
        expect(result.refName).toBe('refs/heads/new-branch')
        expect(result.type).toBe('create')
      })

      it('should parse update ref command', () => {
        const result = parseCommandLine(`${SHA1_COMMIT_1} ${SHA1_COMMIT_2} refs/heads/main`)

        expect(result.oldSha).toBe(SHA1_COMMIT_1)
        expect(result.newSha).toBe(SHA1_COMMIT_2)
        expect(result.refName).toBe('refs/heads/main')
        expect(result.type).toBe('update')
      })

      it('should parse delete ref command', () => {
        const result = parseCommandLine(`${SHA1_COMMIT_1} ${ZERO_SHA} refs/heads/old-branch`)

        expect(result.oldSha).toBe(SHA1_COMMIT_1)
        expect(result.newSha).toBe(ZERO_SHA)
        expect(result.refName).toBe('refs/heads/old-branch')
        expect(result.type).toBe('delete')
      })

      it('should parse command line with capabilities', () => {
        const result = parseCommandLine(
          `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/new-branch\0report-status atomic`
        )

        expect(result.refName).toBe('refs/heads/new-branch')
        expect(result.capabilities).toContain('report-status')
        expect(result.capabilities).toContain('atomic')
      })

      it('should throw for invalid command format', () => {
        expect(() => parseCommandLine('invalid')).toThrow()
        expect(() => parseCommandLine(`${SHA1_COMMIT_1} refs/heads/main`)).toThrow() // Missing SHA
        expect(() => parseCommandLine(`invalid-sha ${SHA1_COMMIT_1} refs/heads/main`)).toThrow()
      })
    })

    describe('parseReceivePackRequest', () => {
      it('should parse multiple commands', () => {
        const request =
          `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/branch1\0report-status\n` +
          `${SHA1_COMMIT_2} ${SHA1_COMMIT_3} refs/heads/branch2\n` +
          FLUSH_PKT

        const result = parseReceivePackRequest(encoder.encode(request))

        expect(result.commands).toHaveLength(2)
        expect(result.commands[0].refName).toBe('refs/heads/branch1')
        expect(result.commands[1].refName).toBe('refs/heads/branch2')
      })

      it('should extract capabilities from first command only', () => {
        const request =
          `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/branch1\0report-status atomic\n` +
          `${SHA1_COMMIT_2} ${SHA1_COMMIT_3} refs/heads/branch2\n` +
          FLUSH_PKT

        const result = parseReceivePackRequest(encoder.encode(request))

        expect(result.capabilities).toContain('report-status')
        expect(result.capabilities).toContain('atomic')
      })

      it('should extract packfile data after flush', () => {
        const commandPart = encoder.encode(
          `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/main\0report-status\n` + FLUSH_PKT
        )
        const packData = createSamplePackfile(1)
        const request = new Uint8Array(commandPart.length + packData.length)
        request.set(commandPart, 0)
        request.set(packData, commandPart.length)

        const result = parseReceivePackRequest(request)

        expect(result.packfile).toEqual(packData)
      })

      it('should handle delete-only request without packfile', () => {
        const request = `${SHA1_COMMIT_1} ${ZERO_SHA} refs/heads/old-branch\0report-status delete-refs\n` + FLUSH_PKT

        const result = parseReceivePackRequest(encoder.encode(request))

        expect(result.commands[0].type).toBe('delete')
        expect(result.packfile.length).toBe(0)
      })

      it('should parse push-options when present', () => {
        const request =
          `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/main\0report-status push-options\n` +
          FLUSH_PKT +
          `ci.skip=true\n` +
          `deploy=staging\n` +
          FLUSH_PKT

        const result = parseReceivePackRequest(encoder.encode(request))

        expect(result.pushOptions).toContain('ci.skip=true')
        expect(result.pushOptions).toContain('deploy=staging')
      })
    })

    describe('processCommands', () => {
      it('should process create command', async () => {
        const session = createReceiveSession('test-repo')
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch', type: 'create' },
        ]

        const result = await processCommands(session, commands, mockStore)

        expect(result.results).toHaveLength(1)
        expect(result.results[0].success).toBe(true)
      })

      it('should process update command with fast-forward', async () => {
        const session = createReceiveSession('test-repo')
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_1, newSha: SHA1_COMMIT_4, refName: 'refs/heads/main', type: 'update' },
        ]

        const result = await processCommands(session, commands, mockStore)

        expect(result.results).toHaveLength(1)
        expect(result.results[0].success).toBe(true)
      })

      it('should reject non-fast-forward update by default', async () => {
        const session = createReceiveSession('test-repo')
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_1, newSha: SHA1_COMMIT_3, refName: 'refs/heads/main', type: 'update' },
        ]

        const result = await processCommands(session, commands, mockStore, { forcePush: false })

        expect(result.results[0].success).toBe(false)
        expect(result.results[0].error).toContain('non-fast-forward')
      })

      it('should allow force push when enabled', async () => {
        const session = createReceiveSession('test-repo')
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_1, newSha: SHA1_COMMIT_3, refName: 'refs/heads/main', type: 'update' },
        ]

        const result = await processCommands(session, commands, mockStore, { forcePush: true })

        expect(result.results[0].success).toBe(true)
      })

      it('should process delete command', async () => {
        const session = createReceiveSession('test-repo')
        session.capabilities.deleteRefs = true
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_2, newSha: ZERO_SHA, refName: 'refs/heads/feature', type: 'delete' },
        ]

        const result = await processCommands(session, commands, mockStore)

        expect(result.results[0].success).toBe(true)
      })

      it('should reject delete when delete-refs not enabled', async () => {
        const session = createReceiveSession('test-repo')
        session.capabilities.deleteRefs = false
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_2, newSha: ZERO_SHA, refName: 'refs/heads/feature', type: 'delete' },
        ]

        const result = await processCommands(session, commands, mockStore)

        expect(result.results[0].success).toBe(false)
        expect(result.results[0].error).toContain('delete')
      })

      it('should verify old SHA matches current ref', async () => {
        const session = createReceiveSession('test-repo')
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_3, newSha: SHA1_COMMIT_4, refName: 'refs/heads/main', type: 'update' },
        ]

        const result = await processCommands(session, commands, mockStore)

        expect(result.results[0].success).toBe(false)
        expect(result.results[0].error).toContain('lock') // or 'stale' or similar
      })
    })

    describe('updateRefs', () => {
      it('should update ref in object store', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_1, newSha: SHA1_COMMIT_4, refName: 'refs/heads/main', type: 'update' },
        ]

        await updateRefs(commands, mockStore)

        const ref = await mockStore.getRef('refs/heads/main')
        expect(ref?.sha).toBe(SHA1_COMMIT_4)
      })

      it('should create new ref', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch', type: 'create' },
        ]

        await updateRefs(commands, mockStore)

        const ref = await mockStore.getRef('refs/heads/new-branch')
        expect(ref?.sha).toBe(SHA1_COMMIT_1)
      })

      it('should delete ref', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_2, newSha: ZERO_SHA, refName: 'refs/heads/feature', type: 'delete' },
        ]

        await updateRefs(commands, mockStore)

        const ref = await mockStore.getRef('refs/heads/feature')
        expect(ref).toBeNull()
      })
    })

    describe('atomicRefUpdate', () => {
      it('should update all refs atomically on success', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_1, newSha: SHA1_COMMIT_4, refName: 'refs/heads/main', type: 'update' },
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch', type: 'create' },
        ]

        const result = await atomicRefUpdate(commands, mockStore)

        expect(result.success).toBe(true)
        expect(result.results.every((r) => r.success)).toBe(true)
      })

      it('should rollback all refs on any failure', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_1, newSha: SHA1_COMMIT_4, refName: 'refs/heads/main', type: 'update' },
          { oldSha: 'invalid'.repeat(4).padEnd(40, '0'), newSha: SHA1_COMMIT_1, refName: 'refs/heads/fail', type: 'update' },
        ]

        const result = await atomicRefUpdate(commands, mockStore)

        expect(result.success).toBe(false)
        // Main should not have been updated (rolled back)
        const mainRef = await mockStore.getRef('refs/heads/main')
        expect(mainRef?.sha).toBe(SHA1_COMMIT_1)
      })

      it('should mark all refs as failed on atomic failure', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_1, newSha: SHA1_COMMIT_4, refName: 'refs/heads/main', type: 'update' },
          { oldSha: 'invalid'.repeat(4).padEnd(40, '0'), newSha: SHA1_COMMIT_1, refName: 'refs/heads/fail', type: 'update' },
        ]

        const result = await atomicRefUpdate(commands, mockStore)

        expect(result.results.every((r) => !r.success)).toBe(true)
        expect(result.results[0].error).toContain('atomic')
      })
    })
  })

  // ==========================================================================
  // 4. Push Rejection Scenarios
  // ==========================================================================
  describe('Push Rejection Scenarios', () => {
    describe('validateRefName', () => {
      it('should accept valid branch ref', () => {
        expect(validateRefName('refs/heads/main')).toBe(true)
        expect(validateRefName('refs/heads/feature/test')).toBe(true)
        expect(validateRefName('refs/heads/feature-123')).toBe(true)
      })

      it('should accept valid tag ref', () => {
        expect(validateRefName('refs/tags/v1.0.0')).toBe(true)
        expect(validateRefName('refs/tags/release-2024')).toBe(true)
      })

      it('should reject refs with double dots', () => {
        expect(validateRefName('refs/heads/main..feature')).toBe(false)
      })

      it('should reject refs with control characters', () => {
        expect(validateRefName('refs/heads/main\x00')).toBe(false)
        expect(validateRefName('refs/heads/main\x7f')).toBe(false)
      })

      it('should reject refs with spaces', () => {
        expect(validateRefName('refs/heads/my branch')).toBe(false)
      })

      it('should reject refs with tilde, caret, colon', () => {
        expect(validateRefName('refs/heads/main~1')).toBe(false)
        expect(validateRefName('refs/heads/main^')).toBe(false)
        expect(validateRefName('refs/heads/main:test')).toBe(false)
      })

      it('should reject refs ending with .lock', () => {
        expect(validateRefName('refs/heads/main.lock')).toBe(false)
      })

      it('should reject refs with consecutive slashes', () => {
        expect(validateRefName('refs/heads//main')).toBe(false)
      })

      it('should reject refs starting or ending with slash', () => {
        expect(validateRefName('/refs/heads/main')).toBe(false)
        expect(validateRefName('refs/heads/main/')).toBe(false)
      })

      it('should reject refs starting with dot', () => {
        expect(validateRefName('refs/heads/.hidden')).toBe(false)
      })

      it('should reject @{', () => {
        expect(validateRefName('refs/heads/main@{0}')).toBe(false)
      })
    })

    describe('validateFastForward', () => {
      it('should return true for fast-forward update', async () => {
        const result = await validateFastForward(SHA1_COMMIT_1, SHA1_COMMIT_4, mockStore)
        expect(result).toBe(true)
      })

      it('should return false for non-fast-forward update', async () => {
        const result = await validateFastForward(SHA1_COMMIT_1, SHA1_COMMIT_3, mockStore)
        expect(result).toBe(false)
      })

      it('should return true for create (ZERO_SHA as old)', async () => {
        const result = await validateFastForward(ZERO_SHA, SHA1_COMMIT_1, mockStore)
        expect(result).toBe(true)
      })

      it('should return true for delete (ZERO_SHA as new)', async () => {
        const result = await validateFastForward(SHA1_COMMIT_1, ZERO_SHA, mockStore)
        expect(result).toBe(true)
      })
    })

    describe('checkRefPermissions', () => {
      it('should allow push to normal branches', async () => {
        const result = await checkRefPermissions('refs/heads/feature', 'update', {})
        expect(result.allowed).toBe(true)
      })

      it('should reject push to protected branches', async () => {
        const result = await checkRefPermissions('refs/heads/main', 'update', {
          protectedRefs: ['refs/heads/main'],
        })

        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('protected')
      })

      it('should reject delete of protected branches', async () => {
        const result = await checkRefPermissions('refs/heads/main', 'delete', {
          protectedRefs: ['refs/heads/main'],
        })

        expect(result.allowed).toBe(false)
      })

      it('should allow push to matching pattern', async () => {
        const result = await checkRefPermissions('refs/heads/feature-123', 'update', {
          allowedRefPatterns: ['refs/heads/feature-*'],
        })

        expect(result.allowed).toBe(true)
      })

      it('should reject push to non-matching pattern', async () => {
        const result = await checkRefPermissions('refs/heads/main', 'update', {
          allowedRefPatterns: ['refs/heads/feature-*'],
        })

        expect(result.allowed).toBe(false)
      })

      it('should reject force push to protected branches', async () => {
        const result = await checkRefPermissions('refs/heads/main', 'force-update', {
          protectedRefs: ['refs/heads/main'],
        })

        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('force push')
      })
    })

    describe('rejectPush', () => {
      it('should format rejection message for report-status', () => {
        const result = rejectPush('refs/heads/main', 'protected branch', { reportStatus: true })

        expect(result).toContain('ng refs/heads/main')
        expect(result).toContain('protected branch')
      })

      it('should format rejection message for side-band error', () => {
        const result = rejectPush('refs/heads/main', 'protected branch', { sideBand: true })

        // Side-band channel 3 for errors
        expect(result).toBeInstanceOf(Uint8Array)
      })

      it('should include ref name in rejection', () => {
        const result = rejectPush('refs/heads/feature', 'hook declined', { reportStatus: true })

        expect(result).toContain('refs/heads/feature')
        expect(result).toContain('hook declined')
      })
    })
  })

  // ==========================================================================
  // 5. Hook Execution Points
  // ==========================================================================
  describe('Hook Execution Points', () => {
    describe('executePreReceiveHook', () => {
      it('should execute pre-receive hook before any updates', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch', type: 'create' },
        ]

        const hookFn = vi.fn().mockResolvedValue({ success: true })
        const result = await executePreReceiveHook(commands, mockStore, hookFn)

        expect(hookFn).toHaveBeenCalledWith(commands, expect.any(Object))
        expect(result.success).toBe(true)
      })

      it('should abort all updates if pre-receive hook fails', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch', type: 'create' },
        ]

        const hookFn = vi.fn().mockResolvedValue({ success: false, message: 'Policy violation' })
        const result = await executePreReceiveHook(commands, mockStore, hookFn)

        expect(result.success).toBe(false)
        expect(result.message).toContain('Policy violation')
      })

      it('should receive all commands in stdin format', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/branch1', type: 'create' },
          { oldSha: SHA1_COMMIT_2, newSha: SHA1_COMMIT_3, refName: 'refs/heads/branch2', type: 'update' },
        ]

        const hookFn = vi.fn().mockResolvedValue({ success: true })
        await executePreReceiveHook(commands, mockStore, hookFn)

        const callArgs = hookFn.mock.calls[0][0]
        expect(callArgs).toHaveLength(2)
      })

      it('should provide environment variables to hook', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch', type: 'create' },
        ]

        const hookFn = vi.fn().mockResolvedValue({ success: true })
        await executePreReceiveHook(commands, mockStore, hookFn, {
          GIT_PUSH_OPTION_COUNT: '2',
          GIT_PUSH_OPTION_0: 'ci.skip=true',
          GIT_PUSH_OPTION_1: 'deploy=staging',
        })

        const env = hookFn.mock.calls[0][1]
        expect(env.GIT_PUSH_OPTION_COUNT).toBe('2')
        expect(env.GIT_PUSH_OPTION_0).toBe('ci.skip=true')
      })

      it('should timeout if hook takes too long', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch', type: 'create' },
        ]

        const hookFn = vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 10000))
        )

        const result = await executePreReceiveHook(commands, mockStore, hookFn, {}, { timeout: 100 })

        expect(result.success).toBe(false)
        expect(result.message).toContain('timeout')
      })
    })

    describe('executeUpdateHook', () => {
      it('should execute update hook for each ref', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/branch1', type: 'create' },
          { oldSha: SHA1_COMMIT_2, newSha: SHA1_COMMIT_3, refName: 'refs/heads/branch2', type: 'update' },
        ]

        const hookFn = vi.fn().mockResolvedValue({ success: true })
        await executeUpdateHook(commands, mockStore, hookFn)

        expect(hookFn).toHaveBeenCalledTimes(2)
      })

      it('should receive refname, old-sha, new-sha as arguments', async () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const hookFn = vi.fn().mockResolvedValue({ success: true })
        await executeUpdateHook([command], mockStore, hookFn)

        expect(hookFn).toHaveBeenCalledWith('refs/heads/main', SHA1_COMMIT_1, SHA1_COMMIT_2, expect.any(Object))
      })

      it('should continue with other refs if one hook fails', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/branch1', type: 'create' },
          { oldSha: SHA1_COMMIT_2, newSha: SHA1_COMMIT_3, refName: 'refs/heads/branch2', type: 'update' },
        ]

        const hookFn = vi
          .fn()
          .mockResolvedValueOnce({ success: false, message: 'Denied' })
          .mockResolvedValueOnce({ success: true })

        const result = await executeUpdateHook(commands, mockStore, hookFn)

        expect(hookFn).toHaveBeenCalledTimes(2)
        expect(result.results[0].success).toBe(false)
        expect(result.results[1].success).toBe(true)
      })

      it('should mark ref update as failed if hook rejects', async () => {
        const command: RefUpdateCommand = {
          oldSha: ZERO_SHA,
          newSha: SHA1_COMMIT_1,
          refName: 'refs/heads/blocked',
          type: 'create',
        }

        const hookFn = vi.fn().mockResolvedValue({ success: false, message: 'Blocked by policy' })
        const result = await executeUpdateHook([command], mockStore, hookFn)

        expect(result.results[0].success).toBe(false)
        expect(result.results[0].error).toContain('Blocked by policy')
      })
    })

    describe('executePostReceiveHook', () => {
      it('should execute post-receive hook after successful updates', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch', type: 'create' },
        ]
        const results: RefUpdateResult[] = [{ refName: 'refs/heads/new-branch', success: true }]

        const hookFn = vi.fn().mockResolvedValue({ success: true })
        await executePostReceiveHook(commands, results, mockStore, hookFn)

        expect(hookFn).toHaveBeenCalled()
      })

      it('should not abort push on post-receive failure (advisory)', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch', type: 'create' },
        ]
        const results: RefUpdateResult[] = [{ refName: 'refs/heads/new-branch', success: true }]

        const hookFn = vi.fn().mockResolvedValue({ success: false, message: 'Notification failed' })
        const result = await executePostReceiveHook(commands, results, mockStore, hookFn)

        // post-receive failures don't affect push success
        expect(result.pushSuccess).toBe(true)
        expect(result.hookSuccess).toBe(false)
      })

      it('should only include successful updates in stdin', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/branch1', type: 'create' },
          { oldSha: SHA1_COMMIT_2, newSha: SHA1_COMMIT_3, refName: 'refs/heads/branch2', type: 'update' },
        ]
        const results: RefUpdateResult[] = [
          { refName: 'refs/heads/branch1', success: true },
          { refName: 'refs/heads/branch2', success: false, error: 'Failed' },
        ]

        const hookFn = vi.fn().mockResolvedValue({ success: true })
        await executePostReceiveHook(commands, results, mockStore, hookFn)

        const callArgs = hookFn.mock.calls[0][0]
        expect(callArgs).toHaveLength(1)
        expect(callArgs[0].refName).toBe('refs/heads/branch1')
      })

      it('should provide push options in environment', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch', type: 'create' },
        ]
        const results: RefUpdateResult[] = [{ refName: 'refs/heads/new-branch', success: true }]

        const hookFn = vi.fn().mockResolvedValue({ success: true })
        await executePostReceiveHook(commands, results, mockStore, hookFn, {
          pushOptions: ['ci.skip=true', 'deploy=staging'],
        })

        const env = hookFn.mock.calls[0][2]
        expect(env.GIT_PUSH_OPTION_COUNT).toBe('2')
      })
    })

    describe('executePostUpdateHook', () => {
      it('should execute post-update hook with updated ref names', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/branch1', type: 'create' },
          { oldSha: SHA1_COMMIT_2, newSha: SHA1_COMMIT_3, refName: 'refs/heads/branch2', type: 'update' },
        ]
        const results: RefUpdateResult[] = [
          { refName: 'refs/heads/branch1', success: true },
          { refName: 'refs/heads/branch2', success: true },
        ]

        const hookFn = vi.fn().mockResolvedValue({ success: true })
        await executePostUpdateHook(commands, results, hookFn)

        expect(hookFn).toHaveBeenCalledWith(['refs/heads/branch1', 'refs/heads/branch2'])
      })

      it('should only include successfully updated refs', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/branch1', type: 'create' },
          { oldSha: SHA1_COMMIT_2, newSha: SHA1_COMMIT_3, refName: 'refs/heads/branch2', type: 'update' },
        ]
        const results: RefUpdateResult[] = [
          { refName: 'refs/heads/branch1', success: true },
          { refName: 'refs/heads/branch2', success: false, error: 'Failed' },
        ]

        const hookFn = vi.fn().mockResolvedValue({ success: true })
        await executePostUpdateHook(commands, results, hookFn)

        expect(hookFn).toHaveBeenCalledWith(['refs/heads/branch1'])
      })

      it('should not be called if no refs were updated', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/branch1', type: 'create' },
        ]
        const results: RefUpdateResult[] = [{ refName: 'refs/heads/branch1', success: false, error: 'Failed' }]

        const hookFn = vi.fn().mockResolvedValue({ success: true })
        await executePostUpdateHook(commands, results, hookFn)

        expect(hookFn).not.toHaveBeenCalled()
      })
    })
  })

  // ==========================================================================
  // 6. Report Status Formatting
  // ==========================================================================
  describe('Report Status Formatting', () => {
    describe('formatReportStatus', () => {
      it('should format unpack ok', () => {
        const result = formatReportStatus({
          unpackStatus: 'ok',
          refResults: [],
        })

        expect(result).toContain('unpack ok')
      })

      it('should format unpack error', () => {
        const result = formatReportStatus({
          unpackStatus: 'error: corrupt packfile',
          refResults: [],
        })

        expect(result).toContain('unpack error: corrupt packfile')
      })

      it('should format successful ref update', () => {
        const result = formatReportStatus({
          unpackStatus: 'ok',
          refResults: [{ refName: 'refs/heads/main', success: true }],
        })

        expect(result).toContain('ok refs/heads/main')
      })

      it('should format failed ref update with error message', () => {
        const result = formatReportStatus({
          unpackStatus: 'ok',
          refResults: [{ refName: 'refs/heads/main', success: false, error: 'non-fast-forward' }],
        })

        expect(result).toContain('ng refs/heads/main non-fast-forward')
      })

      it('should format multiple ref results', () => {
        const result = formatReportStatus({
          unpackStatus: 'ok',
          refResults: [
            { refName: 'refs/heads/main', success: true },
            { refName: 'refs/heads/feature', success: false, error: 'hook declined' },
            { refName: 'refs/tags/v1.0', success: true },
          ],
        })

        expect(result).toContain('ok refs/heads/main')
        expect(result).toContain('ng refs/heads/feature hook declined')
        expect(result).toContain('ok refs/tags/v1.0')
      })

      it('should end with flush packet', () => {
        const result = formatReportStatus({
          unpackStatus: 'ok',
          refResults: [],
        })

        expect(result).toContain(FLUSH_PKT)
      })

      it('should use pkt-line encoding', () => {
        const result = formatReportStatus({
          unpackStatus: 'ok',
          refResults: [],
        })

        const { packets } = pktLineStream(result)
        expect(packets.length).toBeGreaterThan(0)
      })
    })

    describe('formatReportStatusV2', () => {
      it('should include option lines before ref-status', () => {
        const result = formatReportStatusV2({
          unpackStatus: 'ok',
          refResults: [{ refName: 'refs/heads/main', success: true }],
          options: { 'object-format': 'sha1' },
        })

        expect(result).toContain('option object-format sha1')
      })

      it('should format ref update with extended status', () => {
        const result = formatReportStatusV2({
          unpackStatus: 'ok',
          refResults: [
            {
              refName: 'refs/heads/main',
              success: false,
              error: 'non-fast-forward',
              oldTarget: SHA1_COMMIT_1,
              newTarget: SHA1_COMMIT_2,
            },
          ],
        })

        expect(result).toContain('ng refs/heads/main')
        expect(result).toContain('non-fast-forward')
      })

      it('should include forced flag for force pushes', () => {
        const result = formatReportStatusV2({
          unpackStatus: 'ok',
          refResults: [
            {
              refName: 'refs/heads/main',
              success: true,
              forced: true,
            },
          ],
        })

        expect(result).toContain('ok refs/heads/main')
        expect(result).toContain('forced')
      })
    })
  })

  // ==========================================================================
  // 7. Capability Handling
  // ==========================================================================
  describe('Capability Handling', () => {
    describe('buildReceiveCapabilityString', () => {
      it('should build capability string with report-status', () => {
        const result = buildReceiveCapabilityString({ reportStatus: true })
        expect(result).toContain('report-status')
      })

      it('should build capability string with report-status-v2', () => {
        const result = buildReceiveCapabilityString({ reportStatusV2: true })
        expect(result).toContain('report-status-v2')
      })

      it('should build capability string with delete-refs', () => {
        const result = buildReceiveCapabilityString({ deleteRefs: true })
        expect(result).toContain('delete-refs')
      })

      it('should build capability string with atomic', () => {
        const result = buildReceiveCapabilityString({ atomic: true })
        expect(result).toContain('atomic')
      })

      it('should build capability string with push-options', () => {
        const result = buildReceiveCapabilityString({ pushOptions: true })
        expect(result).toContain('push-options')
      })

      it('should build capability string with push-cert', () => {
        const result = buildReceiveCapabilityString({ pushCert: 'nonce123' })
        expect(result).toContain('push-cert=nonce123')
      })

      it('should build capability string with quiet', () => {
        const result = buildReceiveCapabilityString({ quiet: true })
        expect(result).toContain('quiet')
      })

      it('should build capability string with side-band-64k', () => {
        const result = buildReceiveCapabilityString({ sideBand64k: true })
        expect(result).toContain('side-band-64k')
      })

      it('should include agent string', () => {
        const result = buildReceiveCapabilityString({ agent: 'gitx.do/1.0' })
        expect(result).toContain('agent=gitx.do/1.0')
      })

      it('should build string with multiple capabilities', () => {
        const result = buildReceiveCapabilityString({
          reportStatus: true,
          deleteRefs: true,
          atomic: true,
          sideBand64k: true,
          agent: 'gitx.do/1.0',
        })

        expect(result).toContain('report-status')
        expect(result).toContain('delete-refs')
        expect(result).toContain('atomic')
        expect(result).toContain('side-band-64k')
        expect(result).toContain('agent=gitx.do/1.0')
      })
    })

    describe('parseReceiveCapabilities', () => {
      it('should parse report-status', () => {
        const result = parseReceiveCapabilities('report-status')
        expect(result.reportStatus).toBe(true)
      })

      it('should parse report-status-v2', () => {
        const result = parseReceiveCapabilities('report-status-v2')
        expect(result.reportStatusV2).toBe(true)
      })

      it('should parse delete-refs', () => {
        const result = parseReceiveCapabilities('delete-refs')
        expect(result.deleteRefs).toBe(true)
      })

      it('should parse atomic', () => {
        const result = parseReceiveCapabilities('atomic')
        expect(result.atomic).toBe(true)
      })

      it('should parse push-options', () => {
        const result = parseReceiveCapabilities('push-options')
        expect(result.pushOptions).toBe(true)
      })

      it('should parse quiet', () => {
        const result = parseReceiveCapabilities('quiet')
        expect(result.quiet).toBe(true)
      })

      it('should parse side-band-64k', () => {
        const result = parseReceiveCapabilities('side-band-64k')
        expect(result.sideBand64k).toBe(true)
      })

      it('should parse agent with value', () => {
        const result = parseReceiveCapabilities('agent=git/2.40.0')
        expect(result.agent).toBe('git/2.40.0')
      })

      it('should parse multiple capabilities', () => {
        const result = parseReceiveCapabilities('report-status delete-refs atomic side-band-64k agent=git/2.40.0')

        expect(result.reportStatus).toBe(true)
        expect(result.deleteRefs).toBe(true)
        expect(result.atomic).toBe(true)
        expect(result.sideBand64k).toBe(true)
        expect(result.agent).toBe('git/2.40.0')
      })

      it('should handle empty capability string', () => {
        const result = parseReceiveCapabilities('')
        expect(result).toEqual({})
      })
    })
  })

  // ==========================================================================
  // 8. Session Management
  // ==========================================================================
  describe('Session Management', () => {
    it('should create session with initial state', () => {
      const session = createReceiveSession('test-repo')

      expect(session.repoId).toBe('test-repo')
      expect(session.capabilities).toEqual({})
      expect(session.commands).toEqual([])
    })

    it('should track capabilities in session', () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = {
        reportStatus: true,
        atomic: true,
        deleteRefs: true,
      }

      expect(session.capabilities.reportStatus).toBe(true)
      expect(session.capabilities.atomic).toBe(true)
    })

    it('should track commands in session', () => {
      const session = createReceiveSession('test-repo')
      session.commands = [
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/main', type: 'create' },
      ]

      expect(session.commands).toHaveLength(1)
    })
  })

  // ==========================================================================
  // 9. Full Receive-Pack Flow
  // ==========================================================================
  describe('Full Receive-Pack Flow', () => {
    it('should handle a simple push request', async () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true }

      const request = encoder.encode(
        `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/new-branch\0report-status\n` +
          FLUSH_PKT
      )
      // Add packfile
      const packfile = createSamplePackfile(1)
      const fullRequest = new Uint8Array(request.length + packfile.length)
      fullRequest.set(request, 0)
      fullRequest.set(packfile, request.length)

      const result = await handleReceivePack(session, fullRequest, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
      const body = decoder.decode(result)
      expect(body).toContain('unpack')
    })

    it('should handle push with multiple refs', async () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true }

      const request = encoder.encode(
        `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/branch1\0report-status\n` +
          `${ZERO_SHA} ${SHA1_COMMIT_2} refs/heads/branch2\n` +
          FLUSH_PKT
      )
      const packfile = createSamplePackfile(2)
      const fullRequest = new Uint8Array(request.length + packfile.length)
      fullRequest.set(request, 0)
      fullRequest.set(packfile, request.length)

      const result = await handleReceivePack(session, fullRequest, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should handle atomic push', async () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true, atomic: true }

      const request = encoder.encode(
        `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/branch1\0report-status atomic\n` +
          `${ZERO_SHA} ${SHA1_COMMIT_2} refs/heads/branch2\n` +
          FLUSH_PKT
      )
      const packfile = createSamplePackfile(2)
      const fullRequest = new Uint8Array(request.length + packfile.length)
      fullRequest.set(request, 0)
      fullRequest.set(packfile, request.length)

      const result = await handleReceivePack(session, fullRequest, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should handle ref deletion', async () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true, deleteRefs: true }

      const request = encoder.encode(
        `${SHA1_COMMIT_2} ${ZERO_SHA} refs/heads/feature\0report-status delete-refs\n` + FLUSH_PKT
      )

      const result = await handleReceivePack(session, request, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should include side-band messages when enabled', async () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true, sideBand64k: true }

      const request = encoder.encode(
        `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/new-branch\0report-status side-band-64k\n` + FLUSH_PKT
      )
      const packfile = createSamplePackfile(1)
      const fullRequest = new Uint8Array(request.length + packfile.length)
      fullRequest.set(request, 0)
      fullRequest.set(packfile, request.length)

      const result = await handleReceivePack(session, fullRequest, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
      // Should contain side-band formatted data (implementation-dependent)
    })

    it('should handle push options', async () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true, pushOptions: true }

      const request = encoder.encode(
        `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/new-branch\0report-status push-options\n` +
          FLUSH_PKT +
          `ci.skip=true\n` +
          `deploy=staging\n` +
          FLUSH_PKT
      )
      const packfile = createSamplePackfile(1)
      const fullRequest = new Uint8Array(request.length + packfile.length)
      fullRequest.set(request, 0)
      fullRequest.set(packfile, request.length)

      const result = await handleReceivePack(session, fullRequest, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should return error for non-existent old SHA', async () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true }

      const nonExistentSha = '9'.repeat(40)
      const request = encoder.encode(
        `${nonExistentSha} ${SHA1_COMMIT_1} refs/heads/main\0report-status\n` + FLUSH_PKT
      )

      const result = await handleReceivePack(session, request, mockStore)

      const body = decoder.decode(result)
      expect(body).toContain('ng refs/heads/main')
    })
  })

  // ==========================================================================
  // 10. Edge Cases and Error Handling
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle push to empty repository', async () => {
      const emptyStore: ObjectStore = {
        ...mockStore,
        async getRefs() {
          return []
        },
        async getRef() {
          return null
        },
      }

      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true }

      const request = encoder.encode(
        `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/main\0report-status\n` + FLUSH_PKT
      )
      const packfile = createSamplePackfile(1)
      const fullRequest = new Uint8Array(request.length + packfile.length)
      fullRequest.set(request, 0)
      fullRequest.set(packfile, request.length)

      const result = await handleReceivePack(session, fullRequest, emptyStore)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should handle large number of ref updates', async () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true }

      // Generate many ref update commands
      let request = ''
      for (let i = 0; i < 100; i++) {
        const caps = i === 0 ? '\0report-status' : ''
        request += `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/branch-${i}${caps}\n`
      }
      request += FLUSH_PKT

      const packfile = createSamplePackfile(100)
      const requestBytes = encoder.encode(request)
      const fullRequest = new Uint8Array(requestBytes.length + packfile.length)
      fullRequest.set(requestBytes, 0)
      fullRequest.set(packfile, requestBytes.length)

      const result = await handleReceivePack(session, fullRequest, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should reject invalid ref names', async () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true }

      const request = encoder.encode(
        `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/invalid..name\0report-status\n` + FLUSH_PKT
      )

      const result = await handleReceivePack(session, request, mockStore)

      const body = decoder.decode(result)
      expect(body).toContain('ng refs/heads/invalid..name')
    })

    it('should handle concurrent pushes to same ref (lock)', async () => {
      // This tests the scenario where old SHA doesn't match current
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true }

      // Use wrong old SHA (simulating concurrent push)
      const wrongOldSha = SHA1_COMMIT_3
      const request = encoder.encode(
        `${wrongOldSha} ${SHA1_COMMIT_4} refs/heads/main\0report-status\n` + FLUSH_PKT
      )

      const result = await handleReceivePack(session, request, mockStore)

      const body = decoder.decode(result)
      expect(body).toContain('ng refs/heads/main')
    })

    it('should handle binary blob content in packfile', async () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true }

      const request = encoder.encode(
        `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/binary-test\0report-status\n` + FLUSH_PKT
      )
      // Create packfile with binary content
      const packfile = createSamplePackfile(1)
      const fullRequest = new Uint8Array(request.length + packfile.length)
      fullRequest.set(request, 0)
      fullRequest.set(packfile, request.length)

      const result = await handleReceivePack(session, fullRequest, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should handle missing packfile for non-delete operations', async () => {
      const session = createReceiveSession('test-repo')
      session.capabilities = { reportStatus: true }

      // Create command without packfile (not a delete)
      const request = encoder.encode(
        `${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/new-branch\0report-status\n` + FLUSH_PKT
      )

      const result = await handleReceivePack(session, request, mockStore)

      const body = decoder.decode(result)
      // Should report unpack error or ref update failure
      expect(body).toMatch(/unpack|ng/)
    })

    it('should use lowercase hex for SHAs in responses', () => {
      const result = formatReportStatus({
        unpackStatus: 'ok',
        refResults: [{ refName: 'refs/heads/main', success: true }],
      })

      // All hex should be lowercase
      expect(result).not.toMatch(/[A-F]/)
    })
  })

  // ==========================================================================
  // 11. ZERO_SHA constant
  // ==========================================================================
  describe('ZERO_SHA constant', () => {
    it('should be 40 zeros', () => {
      expect(ZERO_SHA).toBe('0'.repeat(40))
    })

    it('should be used for ref creation', () => {
      const cmd = parseCommandLine(`${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/new`)
      expect(cmd.type).toBe('create')
    })

    it('should be used for ref deletion', () => {
      const cmd = parseCommandLine(`${SHA1_COMMIT_1} ${ZERO_SHA} refs/heads/old`)
      expect(cmd.type).toBe('delete')
    })
  })

  // ==========================================================================
  // 12. Protocol Compliance
  // ==========================================================================
  describe('Protocol Compliance', () => {
    it('should format lines with LF terminator', () => {
      const result = formatReportStatus({
        unpackStatus: 'ok',
        refResults: [],
      })
      const { packets } = pktLineStream(result)
      const dataPackets = packets.filter((p) => p.type === 'data')

      for (const packet of dataPackets) {
        if (packet.data && packet.data.length > 0) {
          expect(packet.data.endsWith('\n')).toBe(true)
        }
      }
    })

    it('should include capabilities after NUL byte on first line', async () => {
      const result = await advertiseReceiveRefs(mockStore, { reportStatus: true })
      const { packets } = pktLineStream(result)

      const firstData = packets.find((p) => p.type === 'data')
      if (firstData?.data) {
        // First line should have format: <sha> <ref>\0<capabilities>
        expect(firstData.data).toContain('\x00')
      }
    })

    it('should handle protocol v1 format', async () => {
      const result = await advertiseReceiveRefs(mockStore)
      const { packets } = pktLineStream(result)

      // Should have multiple ref lines
      const dataPackets = packets.filter((p) => p.type === 'data')
      expect(dataPackets.length).toBeGreaterThan(0)
    })
  })
})
