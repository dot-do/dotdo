/**
 * Git Object Model Tests - RED Phase
 *
 * This test file specifies the complete Git object model including:
 * - Blob objects (content storage, hashing)
 * - Tree objects (directory structure, entry sorting)
 * - Commit objects (metadata, parents, signatures)
 * - Tag objects (annotated tags)
 * - Object header format and hash calculation
 * - Loose object format (zlib compression)
 * - Object type detection
 *
 * These tests are designed to FAIL initially. The core/objects module
 * will be implemented in the GREEN phase to make them pass.
 */
import { describe, it, expect, beforeEach } from 'vitest'

// Import from the module that will be created in GREEN phase
import {
  // Core object classes
  GitBlob,
  GitTree,
  GitCommit,
  GitTag,

  // Object factory and type detection
  parseGitObject,
  detectObjectType,
  createGitObject,

  // Hash calculation
  calculateSha1,
  calculateObjectHash,

  // Loose object format (zlib)
  compressObject,
  decompressObject,
  writeLooseObject,
  readLooseObject,

  // Header utilities
  createObjectHeader,
  parseObjectHeader,

  // Tree entry utilities
  TreeEntry,
  sortTreeEntries,
  parseTreeEntries,
  serializeTreeEntries,

  // Author/identity utilities
  GitIdentity,
  parseIdentity,
  formatIdentity,

  // Signature utilities
  parseGpgSignature,
  hasGpgSignature,

  // Constants
  OBJECT_TYPES,
  VALID_MODES,

  // Types
  type ObjectType,
  type GitObjectData,
} from '../../../core/objects'

// =============================================================================
// Test Helpers
// =============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Known SHA-1 values from real Git (verified with `echo -n "content" | git hash-object --stdin`)
const KNOWN_HASHES = {
  // echo -n "" | git hash-object --stdin
  emptyBlob: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
  // echo -n "hello" | git hash-object --stdin
  helloBlob: 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0',
  // echo -n "hello world" | git hash-object --stdin
  helloWorldBlob: '95d09f2b10159347eece71399a7e2e907ea3df4f',
  // echo -n "test content\n" | git hash-object --stdin
  testContentBlob: 'd670460b4b4aece5915caf5c68d12f560a9fe3e4',
}

// Sample valid SHA for testing
const SAMPLE_SHA = 'a'.repeat(40)
const SAMPLE_SHA_2 = 'b'.repeat(40)
const SAMPLE_SHA_3 = 'c'.repeat(40)

// Sample author/committer
const sampleIdentity: GitIdentity = {
  name: 'Test User',
  email: 'test@example.com.ai',
  timestamp: 1704067200, // 2024-01-01 00:00:00 UTC
  timezone: '+0000',
}

// =============================================================================
// Blob Object Tests
// =============================================================================

describe('GitBlob', () => {
  describe('construction', () => {
    it('should create a blob from raw content', () => {
      const content = encoder.encode('hello world')
      const blob = new GitBlob(content)

      expect(blob.type).toBe('blob')
      expect(blob.content).toEqual(content)
      expect(blob.size).toBe(11)
    })

    it('should create a blob from string content', () => {
      const blob = GitBlob.fromString('hello world')

      expect(blob.type).toBe('blob')
      expect(blob.toString()).toBe('hello world')
      expect(blob.size).toBe(11)
    })

    it('should create an empty blob', () => {
      const blob = new GitBlob(new Uint8Array(0))

      expect(blob.type).toBe('blob')
      expect(blob.size).toBe(0)
      expect(blob.isEmpty()).toBe(true)
    })

    it('should handle binary content with null bytes', () => {
      const binaryContent = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00])
      const blob = new GitBlob(binaryContent)

      expect(blob.content).toEqual(binaryContent)
      expect(blob.size).toBe(6)
      expect(blob.isBinary()).toBe(true)
    })
  })

  describe('serialization', () => {
    it('should serialize to Git object format with header', () => {
      const blob = GitBlob.fromString('hello')
      const serialized = blob.serialize()

      // Format: "blob 5\0hello"
      const headerEnd = serialized.indexOf(0)
      const header = decoder.decode(serialized.slice(0, headerEnd))
      const content = decoder.decode(serialized.slice(headerEnd + 1))

      expect(header).toBe('blob 5')
      expect(content).toBe('hello')
    })

    it('should serialize empty blob correctly', () => {
      const blob = new GitBlob(new Uint8Array(0))
      const serialized = blob.serialize()

      expect(decoder.decode(serialized)).toBe('blob 0\0')
    })

    it('should serialize blob with newlines', () => {
      const blob = GitBlob.fromString('line1\nline2\nline3\n')
      const serialized = blob.serialize()

      const headerEnd = serialized.indexOf(0)
      expect(decoder.decode(serialized.slice(0, headerEnd))).toBe('blob 18')
    })
  })

  describe('hash calculation', () => {
    it('should calculate correct SHA-1 for empty blob', async () => {
      const blob = new GitBlob(new Uint8Array(0))
      const hash = await blob.hash()

      expect(hash).toBe(KNOWN_HASHES.emptyBlob)
    })

    it('should calculate correct SHA-1 for "hello"', async () => {
      const blob = GitBlob.fromString('hello')
      const hash = await blob.hash()

      expect(hash).toBe(KNOWN_HASHES.helloBlob)
    })

    it('should calculate correct SHA-1 for "hello world"', async () => {
      const blob = GitBlob.fromString('hello world')
      const hash = await blob.hash()

      expect(hash).toBe(KNOWN_HASHES.helloWorldBlob)
    })

    it('should calculate correct SHA-1 for "test content\\n"', async () => {
      const blob = GitBlob.fromString('test content\n')
      const hash = await blob.hash()

      expect(hash).toBe(KNOWN_HASHES.testContentBlob)
    })

    it('should produce consistent hash on multiple calls', async () => {
      const blob = GitBlob.fromString('consistent content')
      const hash1 = await blob.hash()
      const hash2 = await blob.hash()

      expect(hash1).toBe(hash2)
    })
  })

  describe('deserialization', () => {
    it('should parse blob from serialized format', () => {
      const data = encoder.encode('blob 11\0hello world')
      const blob = GitBlob.parse(data)

      expect(blob.type).toBe('blob')
      expect(blob.toString()).toBe('hello world')
    })

    it('should throw on invalid header', () => {
      const data = encoder.encode('invalid 11\0hello world')

      expect(() => GitBlob.parse(data)).toThrow(/invalid.*header/i)
    })

    it('should throw on missing null byte', () => {
      const data = encoder.encode('blob 11hello world')

      expect(() => GitBlob.parse(data)).toThrow(/null byte/i)
    })

    it('should handle size mismatch gracefully', () => {
      // Header says 5 bytes but content is 11
      const data = encoder.encode('blob 5\0hello world')

      // Should either throw or use actual content length
      expect(() => GitBlob.parse(data)).toThrow(/size mismatch/i)
    })
  })

  describe('round-trip', () => {
    it('should round-trip text content', () => {
      const original = 'Hello, Git!'
      const blob = GitBlob.fromString(original)
      const serialized = blob.serialize()
      const parsed = GitBlob.parse(serialized)

      expect(parsed.toString()).toBe(original)
    })

    it('should round-trip binary content', () => {
      const original = new Uint8Array([0, 1, 2, 127, 128, 255])
      const blob = new GitBlob(original)
      const serialized = blob.serialize()
      const parsed = GitBlob.parse(serialized)

      expect(parsed.content).toEqual(original)
    })

    it('should round-trip large content', () => {
      const original = 'x'.repeat(100000)
      const blob = GitBlob.fromString(original)
      const serialized = blob.serialize()
      const parsed = GitBlob.parse(serialized)

      expect(parsed.toString()).toBe(original)
    })
  })
})

// =============================================================================
// Tree Object Tests
// =============================================================================

describe('GitTree', () => {
  describe('construction', () => {
    it('should create a tree with entries', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: SAMPLE_SHA },
      ]
      const tree = new GitTree(entries)

      expect(tree.type).toBe('tree')
      expect(tree.entries).toHaveLength(1)
      expect(tree.entries[0].name).toBe('file.txt')
    })

    it('should create an empty tree', () => {
      const tree = new GitTree([])

      expect(tree.type).toBe('tree')
      expect(tree.entries).toHaveLength(0)
      expect(tree.isEmpty()).toBe(true)
    })

    it('should accept all valid file modes', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'regular.txt', sha: SAMPLE_SHA },
        { mode: '100755', name: 'executable.sh', sha: SAMPLE_SHA },
        { mode: '040000', name: 'directory', sha: SAMPLE_SHA },
        { mode: '120000', name: 'symlink', sha: SAMPLE_SHA },
        { mode: '160000', name: 'submodule', sha: SAMPLE_SHA },
      ]
      const tree = new GitTree(entries)

      expect(tree.entries).toHaveLength(5)
    })

    it('should reject invalid file modes', () => {
      const entries: TreeEntry[] = [{ mode: '999999', name: 'bad.txt', sha: SAMPLE_SHA }]

      expect(() => new GitTree(entries)).toThrow(/invalid mode/i)
    })

    it('should reject entries with invalid SHA', () => {
      const entries: TreeEntry[] = [{ mode: '100644', name: 'file.txt', sha: 'invalid' }]

      expect(() => new GitTree(entries)).toThrow(/invalid sha/i)
    })

    it('should reject entries with path separator in name', () => {
      const entries: TreeEntry[] = [{ mode: '100644', name: 'path/file.txt', sha: SAMPLE_SHA }]

      expect(() => new GitTree(entries)).toThrow(/path separator/i)
    })

    it('should reject entries with null byte in name', () => {
      const entries: TreeEntry[] = [{ mode: '100644', name: 'file\0.txt', sha: SAMPLE_SHA }]

      expect(() => new GitTree(entries)).toThrow(/null.*byte/i)
    })
  })

  describe('entry sorting', () => {
    it('should sort entries alphabetically by name', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'zebra.txt', sha: SAMPLE_SHA },
        { mode: '100644', name: 'alpha.txt', sha: SAMPLE_SHA },
        { mode: '100644', name: 'middle.txt', sha: SAMPLE_SHA },
      ]
      const tree = new GitTree(entries)

      expect(tree.entries[0].name).toBe('alpha.txt')
      expect(tree.entries[1].name).toBe('middle.txt')
      expect(tree.entries[2].name).toBe('zebra.txt')
    })

    it('should sort directories as if they have trailing slash', () => {
      // Git sorts directories by appending '/' for comparison
      // "ab" < "ab-file" but "ab/" > "ab-file"
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'ab-file', sha: SAMPLE_SHA },
        { mode: '040000', name: 'ab', sha: SAMPLE_SHA },
        { mode: '100644', name: 'aa', sha: SAMPLE_SHA },
      ]
      const tree = new GitTree(entries)

      // Expected order: aa, ab-file, ab (directory)
      expect(tree.entries[0].name).toBe('aa')
      expect(tree.entries[1].name).toBe('ab-file')
      expect(tree.entries[2].name).toBe('ab')
    })

    it('should use sortTreeEntries helper correctly', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'b.txt', sha: SAMPLE_SHA },
        { mode: '040000', name: 'a', sha: SAMPLE_SHA },
        { mode: '100644', name: 'a.txt', sha: SAMPLE_SHA },
      ]
      const sorted = sortTreeEntries(entries)

      expect(sorted[0].name).toBe('a.txt')
      expect(sorted[1].name).toBe('a') // directory sorted as 'a/'
      expect(sorted[2].name).toBe('b.txt')
    })
  })

  describe('serialization', () => {
    it('should serialize tree with header', () => {
      const entries: TreeEntry[] = [{ mode: '100644', name: 'file.txt', sha: SAMPLE_SHA }]
      const tree = new GitTree(entries)
      const serialized = tree.serialize()

      // Should start with "tree <size>\0"
      const headerEnd = serialized.indexOf(0)
      const header = decoder.decode(serialized.slice(0, headerEnd))
      expect(header).toMatch(/^tree \d+$/)
    })

    it('should serialize empty tree', () => {
      const tree = new GitTree([])
      const serialized = tree.serialize()

      expect(decoder.decode(serialized)).toBe('tree 0\0')
    })

    it('should serialize entries in format: mode name\\0sha20', () => {
      const entries: TreeEntry[] = [{ mode: '100644', name: 'file.txt', sha: SAMPLE_SHA }]
      const tree = new GitTree(entries)
      const serialized = tree.serialize()

      const headerEnd = serialized.indexOf(0)
      const content = serialized.slice(headerEnd + 1)

      // Entry format: "<mode> <name>\0<20-byte-sha>"
      const entryNullIdx = content.indexOf(0)
      const modeAndName = decoder.decode(content.slice(0, entryNullIdx))
      expect(modeAndName).toBe('100644 file.txt')

      // SHA should be 20 bytes binary
      const sha20 = content.slice(entryNullIdx + 1, entryNullIdx + 21)
      expect(sha20).toHaveLength(20)
      expect(bytesToHex(sha20)).toBe(SAMPLE_SHA)
    })

    it('should serialize multiple entries correctly', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'a.txt', sha: SAMPLE_SHA },
        { mode: '040000', name: 'dir', sha: SAMPLE_SHA_2 },
        { mode: '100755', name: 'run.sh', sha: SAMPLE_SHA_3 },
      ]
      const tree = new GitTree(entries)
      const serialized = tree.serialize()

      // Parse back to verify
      const parsed = GitTree.parse(serialized)
      expect(parsed.entries).toHaveLength(3)
    })
  })

  describe('deserialization', () => {
    it('should parse tree from serialized format', () => {
      // Build tree binary: "tree <size>\0<mode> <name>\0<20-byte-sha>"
      const mode = '100644'
      const name = 'test.txt'
      const sha20 = hexToBytes(SAMPLE_SHA)

      const entryPart = encoder.encode(`${mode} ${name}\0`)
      const entryContent = new Uint8Array(entryPart.length + 20)
      entryContent.set(entryPart)
      entryContent.set(sha20, entryPart.length)

      const header = encoder.encode(`tree ${entryContent.length}\0`)
      const data = new Uint8Array(header.length + entryContent.length)
      data.set(header)
      data.set(entryContent, header.length)

      const tree = GitTree.parse(data)

      expect(tree.type).toBe('tree')
      expect(tree.entries).toHaveLength(1)
      expect(tree.entries[0].mode).toBe('100644')
      expect(tree.entries[0].name).toBe('test.txt')
      expect(tree.entries[0].sha).toBe(SAMPLE_SHA)
    })

    it('should parse empty tree', () => {
      const data = encoder.encode('tree 0\0')
      const tree = GitTree.parse(data)

      expect(tree.entries).toHaveLength(0)
    })

    it('should throw on invalid header', () => {
      const data = encoder.encode('blob 0\0')

      expect(() => GitTree.parse(data)).toThrow(/invalid.*header/i)
    })

    it('should use parseTreeEntries helper correctly', () => {
      const mode = '100644'
      const name = 'file.txt'
      const sha20 = hexToBytes(SAMPLE_SHA)

      const entryPart = encoder.encode(`${mode} ${name}\0`)
      const content = new Uint8Array(entryPart.length + 20)
      content.set(entryPart)
      content.set(sha20, entryPart.length)

      const entries = parseTreeEntries(content)

      expect(entries).toHaveLength(1)
      expect(entries[0].mode).toBe('100644')
      expect(entries[0].name).toBe('file.txt')
      expect(entries[0].sha).toBe(SAMPLE_SHA)
    })
  })

  describe('hash calculation', () => {
    it('should calculate SHA-1 for empty tree', async () => {
      const tree = new GitTree([])
      const hash = await tree.hash()

      // Empty tree has a known SHA
      // git mktree </dev/null
      expect(hash).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
    })

    it('should produce consistent hash for same entries', async () => {
      const entries: TreeEntry[] = [{ mode: '100644', name: 'file.txt', sha: SAMPLE_SHA }]
      const tree1 = new GitTree(entries)
      const tree2 = new GitTree(entries)

      const hash1 = await tree1.hash()
      const hash2 = await tree2.hash()

      expect(hash1).toBe(hash2)
    })
  })

  describe('tree operations', () => {
    it('should find entry by name', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: SAMPLE_SHA },
        { mode: '040000', name: 'src', sha: SAMPLE_SHA_2 },
      ]
      const tree = new GitTree(entries)

      const entry = tree.getEntry('file.txt')
      expect(entry).toBeDefined()
      expect(entry?.sha).toBe(SAMPLE_SHA)
    })

    it('should return undefined for non-existent entry', () => {
      const tree = new GitTree([{ mode: '100644', name: 'exists.txt', sha: SAMPLE_SHA }])

      expect(tree.getEntry('missing.txt')).toBeUndefined()
    })

    it('should check if entry is directory', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: SAMPLE_SHA },
        { mode: '040000', name: 'dir', sha: SAMPLE_SHA_2 },
      ]
      const tree = new GitTree(entries)

      expect(tree.isDirectory('file.txt')).toBe(false)
      expect(tree.isDirectory('dir')).toBe(true)
    })

    it('should check if entry is executable', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'script.js', sha: SAMPLE_SHA },
        { mode: '100755', name: 'script.sh', sha: SAMPLE_SHA_2 },
      ]
      const tree = new GitTree(entries)

      expect(tree.isExecutable('script.js')).toBe(false)
      expect(tree.isExecutable('script.sh')).toBe(true)
    })

    it('should check if entry is symlink', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: SAMPLE_SHA },
        { mode: '120000', name: 'link', sha: SAMPLE_SHA_2 },
      ]
      const tree = new GitTree(entries)

      expect(tree.isSymlink('file.txt')).toBe(false)
      expect(tree.isSymlink('link')).toBe(true)
    })

    it('should check if entry is submodule', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: SAMPLE_SHA },
        { mode: '160000', name: 'vendor/lib', sha: SAMPLE_SHA_2 },
      ]
      const tree = new GitTree(entries)

      expect(tree.isSubmodule('file.txt')).toBe(false)
      expect(tree.isSubmodule('vendor/lib')).toBe(true)
    })
  })

  describe('round-trip', () => {
    it('should round-trip tree with various entry types', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: SAMPLE_SHA },
        { mode: '100755', name: 'run.sh', sha: SAMPLE_SHA_2 },
        { mode: '040000', name: 'src', sha: SAMPLE_SHA_3 },
      ]
      const tree = new GitTree(entries)
      const serialized = tree.serialize()
      const parsed = GitTree.parse(serialized)

      expect(parsed.entries).toHaveLength(3)
      expect(parsed.getEntry('file.txt')?.mode).toBe('100644')
      expect(parsed.getEntry('run.sh')?.mode).toBe('100755')
      expect(parsed.getEntry('src')?.mode).toBe('040000')
    })

    it('should round-trip tree with special characters in names', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file with spaces.txt', sha: SAMPLE_SHA },
        { mode: '100644', name: 'file-with-dashes.txt', sha: SAMPLE_SHA_2 },
        { mode: '100644', name: 'file.multiple.dots.txt', sha: SAMPLE_SHA_3 },
      ]
      const tree = new GitTree(entries)
      const serialized = tree.serialize()
      const parsed = GitTree.parse(serialized)

      expect(parsed.getEntry('file with spaces.txt')).toBeDefined()
      expect(parsed.getEntry('file-with-dashes.txt')).toBeDefined()
      expect(parsed.getEntry('file.multiple.dots.txt')).toBeDefined()
    })
  })
})

// =============================================================================
// Commit Object Tests
// =============================================================================

describe('GitCommit', () => {
  describe('construction', () => {
    it('should create a commit with required fields', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Initial commit',
      })

      expect(commit.type).toBe('commit')
      expect(commit.tree).toBe(SAMPLE_SHA)
      expect(commit.parents).toHaveLength(0)
      expect(commit.message).toBe('Initial commit')
    })

    it('should create a commit with one parent', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        parents: [SAMPLE_SHA_2],
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Second commit',
      })

      expect(commit.parents).toHaveLength(1)
      expect(commit.parents[0]).toBe(SAMPLE_SHA_2)
    })

    it('should create a merge commit with multiple parents', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        parents: [SAMPLE_SHA_2, SAMPLE_SHA_3],
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Merge branch',
      })

      expect(commit.parents).toHaveLength(2)
      expect(commit.isMergeCommit()).toBe(true)
    })

    it('should support different author and committer', () => {
      const author: GitIdentity = { ...sampleIdentity, name: 'Author' }
      const committer: GitIdentity = { ...sampleIdentity, name: 'Committer' }

      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author,
        committer,
        message: 'Cherry-pick',
      })

      expect(commit.author.name).toBe('Author')
      expect(commit.committer.name).toBe('Committer')
    })

    it('should reject invalid tree SHA', () => {
      expect(
        () =>
          new GitCommit({
            tree: 'invalid',
            author: sampleIdentity,
            committer: sampleIdentity,
            message: 'test',
          })
      ).toThrow(/invalid.*sha/i)
    })

    it('should reject invalid parent SHA', () => {
      expect(
        () =>
          new GitCommit({
            tree: SAMPLE_SHA,
            parents: ['invalid'],
            author: sampleIdentity,
            committer: sampleIdentity,
            message: 'test',
          })
      ).toThrow(/invalid.*sha/i)
    })
  })

  describe('GPG signatures', () => {
    const signedCommitContent = `tree ${SAMPLE_SHA}
parent ${SAMPLE_SHA_2}
author Test User <test@example.com.ai> 1704067200 +0000
committer Test User <test@example.com.ai> 1704067200 +0000
gpgsig -----BEGIN PGP SIGNATURE-----

 iQEzBAABCAAdFiEE...signature...
 =abcd
 -----END PGP SIGNATURE-----

Signed commit message`

    it('should detect GPG signature in commit', () => {
      const commit = GitCommit.fromContent(signedCommitContent)

      expect(hasGpgSignature(commit)).toBe(true)
      expect(commit.hasSignature()).toBe(true)
    })

    it('should parse GPG signature from commit', () => {
      const commit = GitCommit.fromContent(signedCommitContent)
      const signature = parseGpgSignature(commit)

      expect(signature).toBeDefined()
      expect(signature).toContain('BEGIN PGP SIGNATURE')
      expect(signature).toContain('END PGP SIGNATURE')
    })

    it('should handle commit without signature', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Unsigned commit',
      })

      expect(hasGpgSignature(commit)).toBe(false)
      expect(parseGpgSignature(commit)).toBeUndefined()
    })

    it('should preserve signature in round-trip', () => {
      const commit = GitCommit.fromContent(signedCommitContent)
      const serialized = commit.serialize()
      const parsed = GitCommit.parse(serialized)

      expect(parsed.hasSignature()).toBe(true)
      expect(parseGpgSignature(parsed)).toContain('BEGIN PGP SIGNATURE')
    })
  })

  describe('serialization', () => {
    it('should serialize commit with header', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Test',
      })
      const serialized = commit.serialize()

      const headerEnd = serialized.indexOf(0)
      const header = decoder.decode(serialized.slice(0, headerEnd))
      expect(header).toMatch(/^commit \d+$/)
    })

    it('should serialize tree line first', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Test',
      })
      const serialized = commit.serialize()

      const headerEnd = serialized.indexOf(0)
      const content = decoder.decode(serialized.slice(headerEnd + 1))
      const lines = content.split('\n')

      expect(lines[0]).toBe(`tree ${SAMPLE_SHA}`)
    })

    it('should serialize parent lines after tree', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        parents: [SAMPLE_SHA_2, SAMPLE_SHA_3],
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Merge',
      })
      const serialized = commit.serialize()

      const headerEnd = serialized.indexOf(0)
      const content = decoder.decode(serialized.slice(headerEnd + 1))
      const lines = content.split('\n')

      expect(lines[1]).toBe(`parent ${SAMPLE_SHA_2}`)
      expect(lines[2]).toBe(`parent ${SAMPLE_SHA_3}`)
    })

    it('should serialize author line correctly', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Test',
      })
      const serialized = commit.serialize()

      const content = decoder.decode(serialized)
      expect(content).toContain('author Test User <test@example.com.ai> 1704067200 +0000')
    })

    it('should serialize committer line correctly', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Test',
      })
      const serialized = commit.serialize()

      const content = decoder.decode(serialized)
      expect(content).toContain('committer Test User <test@example.com.ai> 1704067200 +0000')
    })

    it('should separate message with blank line', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Commit message',
      })
      const serialized = commit.serialize()

      const headerEnd = serialized.indexOf(0)
      const content = decoder.decode(serialized.slice(headerEnd + 1))

      // Should have: headers, blank line, message
      expect(content).toMatch(/committer.*\n\nCommit message/)
    })

    it('should handle multiline commit message', () => {
      const message = 'First line\n\nThis is a longer description\nspanning multiple lines.'
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message,
      })
      const serialized = commit.serialize()

      const parsed = GitCommit.parse(serialized)
      expect(parsed.message).toBe(message)
    })
  })

  describe('deserialization', () => {
    it('should parse simple commit', () => {
      const commitContent = [
        `tree ${SAMPLE_SHA}`,
        `author Test User <test@example.com.ai> 1704067200 +0000`,
        `committer Test User <test@example.com.ai> 1704067200 +0000`,
        '',
        'Initial commit',
      ].join('\n')
      const data = encoder.encode(`commit ${commitContent.length}\0${commitContent}`)

      const commit = GitCommit.parse(data)

      expect(commit.type).toBe('commit')
      expect(commit.tree).toBe(SAMPLE_SHA)
      expect(commit.parents).toHaveLength(0)
      expect(commit.message).toBe('Initial commit')
    })

    it('should parse commit with parents', () => {
      const commitContent = [
        `tree ${SAMPLE_SHA}`,
        `parent ${SAMPLE_SHA_2}`,
        `parent ${SAMPLE_SHA_3}`,
        `author Test User <test@example.com.ai> 1704067200 +0000`,
        `committer Test User <test@example.com.ai> 1704067200 +0000`,
        '',
        'Merge commit',
      ].join('\n')
      const data = encoder.encode(`commit ${commitContent.length}\0${commitContent}`)

      const commit = GitCommit.parse(data)

      expect(commit.parents).toEqual([SAMPLE_SHA_2, SAMPLE_SHA_3])
    })

    it('should throw on missing tree', () => {
      const commitContent = [
        `author Test User <test@example.com.ai> 1704067200 +0000`,
        `committer Test User <test@example.com.ai> 1704067200 +0000`,
        '',
        'No tree',
      ].join('\n')
      const data = encoder.encode(`commit ${commitContent.length}\0${commitContent}`)

      expect(() => GitCommit.parse(data)).toThrow(/missing.*tree/i)
    })

    it('should throw on missing author', () => {
      const commitContent = [
        `tree ${SAMPLE_SHA}`,
        `committer Test User <test@example.com.ai> 1704067200 +0000`,
        '',
        'No author',
      ].join('\n')
      const data = encoder.encode(`commit ${commitContent.length}\0${commitContent}`)

      expect(() => GitCommit.parse(data)).toThrow(/missing.*author/i)
    })

    it('should throw on missing committer', () => {
      const commitContent = [
        `tree ${SAMPLE_SHA}`,
        `author Test User <test@example.com.ai> 1704067200 +0000`,
        '',
        'No committer',
      ].join('\n')
      const data = encoder.encode(`commit ${commitContent.length}\0${commitContent}`)

      expect(() => GitCommit.parse(data)).toThrow(/missing.*committer/i)
    })
  })

  describe('identity parsing', () => {
    it('should parse identity with parseIdentity helper', () => {
      const line = 'author John Doe <john@example.com.ai> 1704067200 +0530'
      const identity = parseIdentity(line)

      expect(identity.name).toBe('John Doe')
      expect(identity.email).toBe('john@example.com.ai')
      expect(identity.timestamp).toBe(1704067200)
      expect(identity.timezone).toBe('+0530')
    })

    it('should format identity with formatIdentity helper', () => {
      const identity: GitIdentity = {
        name: 'Jane Doe',
        email: 'jane@example.com.ai',
        timestamp: 1704153600,
        timezone: '-0800',
      }
      const formatted = formatIdentity('author', identity)

      expect(formatted).toBe('author Jane Doe <jane@example.com.ai> 1704153600 -0800')
    })

    it('should handle complex names with spaces', () => {
      const line = 'author Dr. John Q. Public III <john@example.com.ai> 1704067200 +0000'
      const identity = parseIdentity(line)

      expect(identity.name).toBe('Dr. John Q. Public III')
    })

    it('should handle negative timezone', () => {
      const line = 'committer Test <test@test.com> 1704067200 -1200'
      const identity = parseIdentity(line)

      expect(identity.timezone).toBe('-1200')
    })
  })

  describe('commit operations', () => {
    it('should check if commit is initial commit', () => {
      const initial = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Initial',
      })

      const regular = new GitCommit({
        tree: SAMPLE_SHA,
        parents: [SAMPLE_SHA_2],
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Regular',
      })

      expect(initial.isInitialCommit()).toBe(true)
      expect(regular.isInitialCommit()).toBe(false)
    })

    it('should get subject line from message', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Subject line\n\nBody text here',
      })

      expect(commit.getSubject()).toBe('Subject line')
    })

    it('should get body from message', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Subject line\n\nBody text here\nMore body',
      })

      expect(commit.getBody()).toBe('Body text here\nMore body')
    })

    it('should return empty body for subject-only message', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Just a subject',
      })

      expect(commit.getBody()).toBe('')
    })
  })

  describe('octopus merge', () => {
    it('should support octopus merge with many parents', () => {
      const parents = Array.from({ length: 8 }, (_, i) => String.fromCharCode(97 + i).repeat(40))

      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        parents,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Octopus merge',
      })

      expect(commit.parents).toHaveLength(8)
      expect(commit.isMergeCommit()).toBe(true)
    })

    it('should round-trip octopus merge', () => {
      const parents = Array.from({ length: 5 }, (_, i) => String.fromCharCode(97 + i).repeat(40))

      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        parents,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Octopus',
      })

      const serialized = commit.serialize()
      const parsed = GitCommit.parse(serialized)

      expect(parsed.parents).toEqual(parents)
    })
  })
})

// =============================================================================
// Tag Object Tests
// =============================================================================

describe('GitTag', () => {
  describe('construction', () => {
    it('should create an annotated tag', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v1.0.0',
        tagger: sampleIdentity,
        message: 'Version 1.0.0 release',
      })

      expect(tag.type).toBe('tag')
      expect(tag.object).toBe(SAMPLE_SHA)
      expect(tag.objectType).toBe('commit')
      expect(tag.name).toBe('v1.0.0')
      expect(tag.message).toBe('Version 1.0.0 release')
    })

    it('should create tag without tagger (lightweight-style annotated)', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v0.1.0',
        message: 'Early version',
      })

      expect(tag.tagger).toBeUndefined()
    })

    it('should tag different object types', () => {
      const tagCommit = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'release',
        message: 'Tag a commit',
      })

      const tagTree = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'tree',
        name: 'snapshot',
        message: 'Tag a tree',
      })

      const tagBlob = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'blob',
        name: 'artifact',
        message: 'Tag a blob',
      })

      const tagTag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'tag',
        name: 'meta-tag',
        message: 'Tag a tag',
      })

      expect(tagCommit.objectType).toBe('commit')
      expect(tagTree.objectType).toBe('tree')
      expect(tagBlob.objectType).toBe('blob')
      expect(tagTag.objectType).toBe('tag')
    })

    it('should reject invalid object SHA', () => {
      expect(
        () =>
          new GitTag({
            object: 'invalid',
            objectType: 'commit',
            name: 'v1.0.0',
            message: 'test',
          })
      ).toThrow(/invalid.*sha/i)
    })

    it('should reject invalid object type', () => {
      expect(
        () =>
          new GitTag({
            object: SAMPLE_SHA,
            objectType: 'invalid' as ObjectType,
            name: 'v1.0.0',
            message: 'test',
          })
      ).toThrow(/invalid.*type/i)
    })
  })

  describe('serialization', () => {
    it('should serialize tag with header', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v1.0.0',
        tagger: sampleIdentity,
        message: 'Release',
      })
      const serialized = tag.serialize()

      const headerEnd = serialized.indexOf(0)
      const header = decoder.decode(serialized.slice(0, headerEnd))
      expect(header).toMatch(/^tag \d+$/)
    })

    it('should serialize object line first', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v1.0.0',
        message: 'Release',
      })
      const serialized = tag.serialize()

      const headerEnd = serialized.indexOf(0)
      const content = decoder.decode(serialized.slice(headerEnd + 1))
      const lines = content.split('\n')

      expect(lines[0]).toBe(`object ${SAMPLE_SHA}`)
    })

    it('should serialize type line second', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v1.0.0',
        message: 'Release',
      })
      const serialized = tag.serialize()

      const headerEnd = serialized.indexOf(0)
      const content = decoder.decode(serialized.slice(headerEnd + 1))
      const lines = content.split('\n')

      expect(lines[1]).toBe('type commit')
    })

    it('should serialize tag name line third', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v1.0.0',
        message: 'Release',
      })
      const serialized = tag.serialize()

      const headerEnd = serialized.indexOf(0)
      const content = decoder.decode(serialized.slice(headerEnd + 1))
      const lines = content.split('\n')

      expect(lines[2]).toBe('tag v1.0.0')
    })

    it('should serialize tagger line if present', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v1.0.0',
        tagger: sampleIdentity,
        message: 'Release',
      })
      const serialized = tag.serialize()

      const content = decoder.decode(serialized)
      expect(content).toContain('tagger Test User <test@example.com.ai> 1704067200 +0000')
    })

    it('should omit tagger line if not present', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v1.0.0',
        message: 'Release',
      })
      const serialized = tag.serialize()

      const content = decoder.decode(serialized)
      expect(content).not.toContain('tagger')
    })

    it('should separate message with blank line', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v1.0.0',
        tagger: sampleIdentity,
        message: 'Release notes',
      })
      const serialized = tag.serialize()

      const headerEnd = serialized.indexOf(0)
      const content = decoder.decode(serialized.slice(headerEnd + 1))

      expect(content).toMatch(/tagger.*\n\nRelease notes/)
    })
  })

  describe('deserialization', () => {
    it('should parse annotated tag', () => {
      const tagContent = [
        `object ${SAMPLE_SHA}`,
        'type commit',
        'tag v1.0.0',
        `tagger Test User <test@example.com.ai> 1704067200 +0000`,
        '',
        'Release v1.0.0',
      ].join('\n')
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)

      const tag = GitTag.parse(data)

      expect(tag.type).toBe('tag')
      expect(tag.object).toBe(SAMPLE_SHA)
      expect(tag.objectType).toBe('commit')
      expect(tag.name).toBe('v1.0.0')
      expect(tag.tagger?.name).toBe('Test User')
      expect(tag.message).toBe('Release v1.0.0')
    })

    it('should parse tag without tagger', () => {
      const tagContent = [
        `object ${SAMPLE_SHA}`,
        'type commit',
        'tag v0.1.0',
        '',
        'Early release',
      ].join('\n')
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)

      const tag = GitTag.parse(data)

      expect(tag.tagger).toBeUndefined()
      expect(tag.message).toBe('Early release')
    })

    it('should parse tag pointing to tree', () => {
      const tagContent = [
        `object ${SAMPLE_SHA}`,
        'type tree',
        'tag tree-snapshot',
        '',
        'Snapshot of tree state',
      ].join('\n')
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)

      const tag = GitTag.parse(data)

      expect(tag.objectType).toBe('tree')
    })

    it('should throw on missing object', () => {
      const tagContent = ['type commit', 'tag v1.0.0', '', 'No object'].join('\n')
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)

      expect(() => GitTag.parse(data)).toThrow(/missing.*object/i)
    })

    it('should throw on missing type', () => {
      const tagContent = [`object ${SAMPLE_SHA}`, 'tag v1.0.0', '', 'No type'].join('\n')
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)

      expect(() => GitTag.parse(data)).toThrow(/missing.*type/i)
    })

    it('should throw on missing tag name', () => {
      const tagContent = [`object ${SAMPLE_SHA}`, 'type commit', '', 'No name'].join('\n')
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)

      expect(() => GitTag.parse(data)).toThrow(/missing.*tag.*name/i)
    })
  })

  describe('GPG signed tags', () => {
    const signedTagContent = `object ${SAMPLE_SHA}
type commit
tag v1.0.0
tagger Test User <test@example.com.ai> 1704067200 +0000

Release v1.0.0
-----BEGIN PGP SIGNATURE-----

iQEzBAABCAAdFiEE...signature...
=abcd
-----END PGP SIGNATURE-----`

    it('should detect GPG signature in tag', () => {
      const tag = GitTag.fromContent(signedTagContent)

      expect(tag.hasSignature()).toBe(true)
    })

    it('should preserve signature in round-trip', () => {
      const tag = GitTag.fromContent(signedTagContent)
      const serialized = tag.serialize()
      const parsed = GitTag.parse(serialized)

      expect(parsed.hasSignature()).toBe(true)
    })
  })

  describe('round-trip', () => {
    it('should round-trip annotated tag with tagger', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v2.0.0',
        tagger: sampleIdentity,
        message: 'Major release',
      })
      const serialized = tag.serialize()
      const parsed = GitTag.parse(serialized)

      expect(parsed.object).toBe(SAMPLE_SHA)
      expect(parsed.objectType).toBe('commit')
      expect(parsed.name).toBe('v2.0.0')
      expect(parsed.tagger?.name).toBe('Test User')
      expect(parsed.message).toBe('Major release')
    })

    it('should round-trip tag without tagger', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v0.0.1',
        message: 'Alpha',
      })
      const serialized = tag.serialize()
      const parsed = GitTag.parse(serialized)

      expect(parsed.tagger).toBeUndefined()
      expect(parsed.message).toBe('Alpha')
    })

    it('should round-trip tag with multiline message', () => {
      const message = 'Release notes\n\n- Feature 1\n- Feature 2\n- Bug fixes'
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v3.0.0',
        tagger: sampleIdentity,
        message,
      })
      const serialized = tag.serialize()
      const parsed = GitTag.parse(serialized)

      expect(parsed.message).toBe(message)
    })
  })
})

// =============================================================================
// Object Header Format Tests
// =============================================================================

describe('Object Header Format', () => {
  describe('createObjectHeader', () => {
    it('should create blob header', () => {
      const header = createObjectHeader('blob', 100)
      expect(decoder.decode(header)).toBe('blob 100\0')
    })

    it('should create tree header', () => {
      const header = createObjectHeader('tree', 50)
      expect(decoder.decode(header)).toBe('tree 50\0')
    })

    it('should create commit header', () => {
      const header = createObjectHeader('commit', 200)
      expect(decoder.decode(header)).toBe('commit 200\0')
    })

    it('should create tag header', () => {
      const header = createObjectHeader('tag', 75)
      expect(decoder.decode(header)).toBe('tag 75\0')
    })

    it('should handle zero size', () => {
      const header = createObjectHeader('blob', 0)
      expect(decoder.decode(header)).toBe('blob 0\0')
    })

    it('should handle large sizes', () => {
      const header = createObjectHeader('blob', 1000000000)
      expect(decoder.decode(header)).toBe('blob 1000000000\0')
    })
  })

  describe('parseObjectHeader', () => {
    it('should parse blob header', () => {
      const data = encoder.encode('blob 100\0content')
      const { type, size, headerLength } = parseObjectHeader(data)

      expect(type).toBe('blob')
      expect(size).toBe(100)
      expect(headerLength).toBe(9) // "blob 100\0".length
    })

    it('should parse tree header', () => {
      const data = encoder.encode('tree 50\0entries')
      const { type, size, headerLength } = parseObjectHeader(data)

      expect(type).toBe('tree')
      expect(size).toBe(50)
    })

    it('should parse commit header', () => {
      const data = encoder.encode('commit 200\0content')
      const { type, size, headerLength } = parseObjectHeader(data)

      expect(type).toBe('commit')
      expect(size).toBe(200)
    })

    it('should parse tag header', () => {
      const data = encoder.encode('tag 75\0content')
      const { type, size, headerLength } = parseObjectHeader(data)

      expect(type).toBe('tag')
      expect(size).toBe(75)
    })

    it('should throw on invalid type', () => {
      const data = encoder.encode('invalid 100\0content')

      expect(() => parseObjectHeader(data)).toThrow(/invalid.*type/i)
    })

    it('should throw on missing null byte', () => {
      const data = encoder.encode('blob 100content')

      expect(() => parseObjectHeader(data)).toThrow(/null byte/i)
    })

    it('should throw on invalid size', () => {
      const data = encoder.encode('blob abc\0content')

      expect(() => parseObjectHeader(data)).toThrow(/invalid.*size/i)
    })

    it('should throw on negative size', () => {
      const data = encoder.encode('blob -5\0content')

      expect(() => parseObjectHeader(data)).toThrow(/invalid.*size/i)
    })
  })
})

// =============================================================================
// Hash Calculation Tests
// =============================================================================

describe('Hash Calculation', () => {
  describe('calculateSha1', () => {
    it('should calculate SHA-1 of raw data', async () => {
      const data = encoder.encode('test')
      const hash = await calculateSha1(data)

      // SHA-1 of "test" is a94a8fe5ccb19ba61c4c0873d391e987982fbbd3
      expect(hash).toBe('a94a8fe5ccb19ba61c4c0873d391e987982fbbd3')
    })

    it('should calculate SHA-1 of empty data', async () => {
      const hash = await calculateSha1(new Uint8Array(0))

      // SHA-1 of empty string
      expect(hash).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    })

    it('should return 40-character lowercase hex string', async () => {
      const hash = await calculateSha1(encoder.encode('anything'))

      expect(hash).toMatch(/^[0-9a-f]{40}$/)
    })
  })

  describe('calculateObjectHash', () => {
    it('should calculate hash including object header', async () => {
      // Hash of blob with content "hello" should match git hash-object
      const hash = await calculateObjectHash('blob', encoder.encode('hello'))

      expect(hash).toBe(KNOWN_HASHES.helloBlob)
    })

    it('should calculate empty blob hash', async () => {
      const hash = await calculateObjectHash('blob', new Uint8Array(0))

      expect(hash).toBe(KNOWN_HASHES.emptyBlob)
    })

    it('should produce different hashes for different content', async () => {
      const hash1 = await calculateObjectHash('blob', encoder.encode('content1'))
      const hash2 = await calculateObjectHash('blob', encoder.encode('content2'))

      expect(hash1).not.toBe(hash2)
    })

    it('should produce different hashes for same content, different types', async () => {
      const content = encoder.encode('same content')
      const blobHash = await calculateObjectHash('blob', content)
      const treeHash = await calculateObjectHash('tree', content)

      expect(blobHash).not.toBe(treeHash)
    })
  })
})

// =============================================================================
// Loose Object Format Tests (Zlib Compression)
// =============================================================================

describe('Loose Object Format', () => {
  describe('compressObject', () => {
    it('should compress blob object with zlib', async () => {
      const blob = GitBlob.fromString('hello world')
      const serialized = blob.serialize()
      const compressed = await compressObject(serialized)

      // Compressed should be different from original
      expect(compressed).not.toEqual(serialized)

      // Should start with zlib magic bytes (78 01 for low compression, 78 9c for default, 78 da for best)
      expect([0x78]).toContain(compressed[0])
    })

    it('should produce valid zlib format', async () => {
      const blob = GitBlob.fromString('test content')
      const serialized = blob.serialize()
      const compressed = await compressObject(serialized)

      // Should decompress back to original
      const decompressed = await decompressObject(compressed)
      expect(decompressed).toEqual(serialized)
    })

    it('should handle large content', async () => {
      const largeContent = 'x'.repeat(100000)
      const blob = GitBlob.fromString(largeContent)
      const serialized = blob.serialize()
      const compressed = await compressObject(serialized)

      // Compressed should be smaller for repetitive content
      expect(compressed.length).toBeLessThan(serialized.length)
    })

    it('should handle binary content', async () => {
      const binaryContent = new Uint8Array(256)
      for (let i = 0; i < 256; i++) binaryContent[i] = i
      const blob = new GitBlob(binaryContent)
      const serialized = blob.serialize()
      const compressed = await compressObject(serialized)

      const decompressed = await decompressObject(compressed)
      expect(decompressed).toEqual(serialized)
    })
  })

  describe('decompressObject', () => {
    it('should decompress zlib-compressed data', async () => {
      const original = encoder.encode('blob 5\0hello')
      const compressed = await compressObject(original)
      const decompressed = await decompressObject(compressed)

      expect(decompressed).toEqual(original)
    })

    it('should throw on invalid zlib data', async () => {
      const invalidData = new Uint8Array([0x00, 0x01, 0x02, 0x03])

      await expect(decompressObject(invalidData)).rejects.toThrow()
    })

    it('should throw on truncated data', async () => {
      const original = encoder.encode('blob 100\0' + 'x'.repeat(100))
      const compressed = await compressObject(original)
      const truncated = compressed.slice(0, compressed.length / 2)

      await expect(decompressObject(truncated)).rejects.toThrow()
    })
  })

  describe('writeLooseObject', () => {
    it('should return compressed data with correct path', async () => {
      const blob = GitBlob.fromString('test content\n')
      const hash = await blob.hash()
      const { path, data } = await writeLooseObject(blob)

      // Path should be objects/<first-2-chars>/<remaining-38-chars>
      expect(path).toBe(`objects/${hash.slice(0, 2)}/${hash.slice(2)}`)

      // Data should be compressed
      const decompressed = await decompressObject(data)
      expect(decompressed).toEqual(blob.serialize())
    })

    it('should produce correct path structure', async () => {
      const blob = GitBlob.fromString('hello')
      const { path } = await writeLooseObject(blob)

      // Path components
      const parts = path.split('/')
      expect(parts).toHaveLength(3)
      expect(parts[0]).toBe('objects')
      expect(parts[1]).toHaveLength(2)
      expect(parts[2]).toHaveLength(38)
    })
  })

  describe('readLooseObject', () => {
    it('should read and decompress loose object', async () => {
      const blob = GitBlob.fromString('loose object content')
      const { data } = await writeLooseObject(blob)

      const parsed = await readLooseObject(data)

      expect(parsed.type).toBe('blob')
      expect((parsed as GitBlob).toString()).toBe('loose object content')
    })

    it('should detect object type from content', async () => {
      const tree = new GitTree([{ mode: '100644', name: 'file.txt', sha: SAMPLE_SHA }])
      const { data } = await writeLooseObject(tree)

      const parsed = await readLooseObject(data)

      expect(parsed.type).toBe('tree')
    })

    it('should handle commit objects', async () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Test commit',
      })
      const { data } = await writeLooseObject(commit)

      const parsed = await readLooseObject(data)

      expect(parsed.type).toBe('commit')
      expect((parsed as GitCommit).message).toBe('Test commit')
    })

    it('should handle tag objects', async () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v1.0.0',
        message: 'Release',
      })
      const { data } = await writeLooseObject(tag)

      const parsed = await readLooseObject(data)

      expect(parsed.type).toBe('tag')
      expect((parsed as GitTag).name).toBe('v1.0.0')
    })
  })
})

// =============================================================================
// Object Type Detection Tests
// =============================================================================

describe('Object Type Detection', () => {
  describe('detectObjectType', () => {
    it('should detect blob from serialized data', () => {
      const data = encoder.encode('blob 5\0hello')
      const type = detectObjectType(data)

      expect(type).toBe('blob')
    })

    it('should detect tree from serialized data', () => {
      const data = encoder.encode('tree 0\0')
      const type = detectObjectType(data)

      expect(type).toBe('tree')
    })

    it('should detect commit from serialized data', () => {
      const commitContent = `tree ${SAMPLE_SHA}\nauthor x <x@x> 0 +0000\ncommitter x <x@x> 0 +0000\n\nmsg`
      const data = encoder.encode(`commit ${commitContent.length}\0${commitContent}`)
      const type = detectObjectType(data)

      expect(type).toBe('commit')
    })

    it('should detect tag from serialized data', () => {
      const tagContent = `object ${SAMPLE_SHA}\ntype commit\ntag v1\n\nmsg`
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)
      const type = detectObjectType(data)

      expect(type).toBe('tag')
    })

    it('should throw on invalid type', () => {
      const data = encoder.encode('invalid 0\0')

      expect(() => detectObjectType(data)).toThrow(/invalid.*type/i)
    })

    it('should throw on malformed data', () => {
      const data = encoder.encode('no header here')

      expect(() => detectObjectType(data)).toThrow()
    })
  })

  describe('parseGitObject', () => {
    it('should parse blob object', () => {
      const data = encoder.encode('blob 5\0hello')
      const obj = parseGitObject(data)

      expect(obj.type).toBe('blob')
      expect(obj).toBeInstanceOf(GitBlob)
    })

    it('should parse tree object', () => {
      const mode = '100644'
      const name = 'file.txt'
      const sha20 = hexToBytes(SAMPLE_SHA)
      const entryPart = encoder.encode(`${mode} ${name}\0`)
      const entryContent = new Uint8Array(entryPart.length + 20)
      entryContent.set(entryPart)
      entryContent.set(sha20, entryPart.length)
      const header = encoder.encode(`tree ${entryContent.length}\0`)
      const data = new Uint8Array(header.length + entryContent.length)
      data.set(header)
      data.set(entryContent, header.length)

      const obj = parseGitObject(data)

      expect(obj.type).toBe('tree')
      expect(obj).toBeInstanceOf(GitTree)
    })

    it('should parse commit object', () => {
      const commitContent = [
        `tree ${SAMPLE_SHA}`,
        `author Test <test@test.com> 0 +0000`,
        `committer Test <test@test.com> 0 +0000`,
        '',
        'msg',
      ].join('\n')
      const data = encoder.encode(`commit ${commitContent.length}\0${commitContent}`)

      const obj = parseGitObject(data)

      expect(obj.type).toBe('commit')
      expect(obj).toBeInstanceOf(GitCommit)
    })

    it('should parse tag object', () => {
      const tagContent = [`object ${SAMPLE_SHA}`, 'type commit', 'tag v1', '', 'msg'].join('\n')
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)

      const obj = parseGitObject(data)

      expect(obj.type).toBe('tag')
      expect(obj).toBeInstanceOf(GitTag)
    })
  })

  describe('createGitObject', () => {
    it('should create blob from data', () => {
      const obj = createGitObject('blob', { content: encoder.encode('hello') })

      expect(obj.type).toBe('blob')
      expect(obj).toBeInstanceOf(GitBlob)
    })

    it('should create tree from entries', () => {
      const obj = createGitObject('tree', {
        entries: [{ mode: '100644', name: 'file.txt', sha: SAMPLE_SHA }],
      })

      expect(obj.type).toBe('tree')
      expect(obj).toBeInstanceOf(GitTree)
    })

    it('should create commit from data', () => {
      const obj = createGitObject('commit', {
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'test',
      })

      expect(obj.type).toBe('commit')
      expect(obj).toBeInstanceOf(GitCommit)
    })

    it('should create tag from data', () => {
      const obj = createGitObject('tag', {
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v1',
        message: 'test',
      })

      expect(obj.type).toBe('tag')
      expect(obj).toBeInstanceOf(GitTag)
    })
  })
})

// =============================================================================
// Constants and Validation Tests
// =============================================================================

describe('Constants', () => {
  describe('OBJECT_TYPES', () => {
    it('should contain all four object types', () => {
      expect(OBJECT_TYPES).toContain('blob')
      expect(OBJECT_TYPES).toContain('tree')
      expect(OBJECT_TYPES).toContain('commit')
      expect(OBJECT_TYPES).toContain('tag')
      expect(OBJECT_TYPES).toHaveLength(4)
    })
  })

  describe('VALID_MODES', () => {
    it('should contain all valid file modes', () => {
      expect(VALID_MODES).toContain('100644') // regular file
      expect(VALID_MODES).toContain('100755') // executable
      expect(VALID_MODES).toContain('040000') // directory
      expect(VALID_MODES).toContain('120000') // symlink
      expect(VALID_MODES).toContain('160000') // submodule
    })

    it('should have exactly 5 valid modes', () => {
      expect(VALID_MODES.size || VALID_MODES.length).toBe(5)
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Edge Cases', () => {
  describe('Empty and minimal objects', () => {
    it('should handle empty blob', async () => {
      const blob = new GitBlob(new Uint8Array(0))
      const hash = await blob.hash()
      const serialized = blob.serialize()
      const parsed = GitBlob.parse(serialized)

      expect(parsed.size).toBe(0)
      expect(hash).toBe(KNOWN_HASHES.emptyBlob)
    })

    it('should handle empty tree', async () => {
      const tree = new GitTree([])
      const hash = await tree.hash()
      const serialized = tree.serialize()
      const parsed = GitTree.parse(serialized)

      expect(parsed.entries).toHaveLength(0)
      expect(hash).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
    })

    it('should handle commit with empty message', () => {
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: '',
      })
      const serialized = commit.serialize()
      const parsed = GitCommit.parse(serialized)

      expect(parsed.message).toBe('')
    })

    it('should handle tag with empty message', () => {
      const tag = new GitTag({
        object: SAMPLE_SHA,
        objectType: 'commit',
        name: 'v1',
        message: '',
      })
      const serialized = tag.serialize()
      const parsed = GitTag.parse(serialized)

      expect(parsed.message).toBe('')
    })
  })

  describe('Unicode handling', () => {
    it('should handle unicode in blob content', () => {
      const content = 'Hello World!'
      const blob = GitBlob.fromString(content)
      const serialized = blob.serialize()
      const parsed = GitBlob.parse(serialized)

      expect(parsed.toString()).toBe(content)
    })

    it('should handle unicode in commit message', () => {
      const message = 'Fix bug for international users'
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author: sampleIdentity,
        committer: sampleIdentity,
        message,
      })
      const serialized = commit.serialize()
      const parsed = GitCommit.parse(serialized)

      expect(parsed.message).toBe(message)
    })

    it('should handle unicode in author name', () => {
      const author: GitIdentity = {
        ...sampleIdentity,
        name: 'Tester',
      }
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        author,
        committer: author,
        message: 'test',
      })
      const serialized = commit.serialize()
      const parsed = GitCommit.parse(serialized)

      expect(parsed.author.name).toBe(author.name)
    })
  })

  describe('Large objects', () => {
    it('should handle large blob content', async () => {
      const largeContent = 'x'.repeat(10000000) // 10MB
      const blob = GitBlob.fromString(largeContent)

      expect(blob.size).toBe(10000000)
      const hash = await blob.hash()
      expect(hash).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should handle tree with many entries', () => {
      const entries: TreeEntry[] = Array.from({ length: 1000 }, (_, i) => ({
        mode: '100644',
        name: `file${i.toString().padStart(4, '0')}.txt`,
        sha: SAMPLE_SHA,
      }))
      const tree = new GitTree(entries)

      expect(tree.entries).toHaveLength(1000)

      const serialized = tree.serialize()
      const parsed = GitTree.parse(serialized)
      expect(parsed.entries).toHaveLength(1000)
    })

    it('should handle commit with many parents (octopus)', () => {
      const parents = Array.from({ length: 100 }, () => SAMPLE_SHA)
      const commit = new GitCommit({
        tree: SAMPLE_SHA,
        parents,
        author: sampleIdentity,
        committer: sampleIdentity,
        message: 'Mega octopus merge',
      })

      expect(commit.parents).toHaveLength(100)

      const serialized = commit.serialize()
      const parsed = GitCommit.parse(serialized)
      expect(parsed.parents).toHaveLength(100)
    })
  })

  describe('Special filenames', () => {
    it('should handle dotfiles', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: '.gitignore', sha: SAMPLE_SHA },
        { mode: '100644', name: '.env', sha: SAMPLE_SHA_2 },
      ]
      const tree = new GitTree(entries)
      const serialized = tree.serialize()
      const parsed = GitTree.parse(serialized)

      expect(parsed.getEntry('.gitignore')).toBeDefined()
      expect(parsed.getEntry('.env')).toBeDefined()
    })

    it('should handle names with dots', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.test.spec.ts', sha: SAMPLE_SHA },
      ]
      const tree = new GitTree(entries)
      const serialized = tree.serialize()
      const parsed = GitTree.parse(serialized)

      expect(parsed.getEntry('file.test.spec.ts')).toBeDefined()
    })

    it('should handle names starting with hyphen', () => {
      const entries: TreeEntry[] = [{ mode: '100644', name: '-weird-name', sha: SAMPLE_SHA }]
      const tree = new GitTree(entries)
      const serialized = tree.serialize()
      const parsed = GitTree.parse(serialized)

      expect(parsed.getEntry('-weird-name')).toBeDefined()
    })
  })
})
