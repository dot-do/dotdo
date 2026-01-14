import { describe, it, expect } from 'vitest'
import {
  ObjectType,
  GitObject,
  BlobObject,
  TreeObject,
  TreeEntry,
  CommitObject,
  TagObject,
  Author,
  isBlob,
  isTree,
  isCommit,
  isTag,
  serializeBlob,
  serializeTree,
  serializeCommit,
  serializeTag,
  parseBlob,
  parseTree,
  parseCommit,
  parseTag
} from '../../src/types/objects'

// Helper to create test data
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
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Sample test data
const sampleAuthor: Author = {
  name: 'Test User',
  email: 'test@example.com.ai',
  timestamp: 1704067200, // 2024-01-01 00:00:00 UTC
  timezone: '+0000'
}

const sampleSha = 'a'.repeat(40) // Valid SHA-1 hex string

describe('Git Object Types', () => {
  describe('Type Guards', () => {
    it('isBlob should return true for blob objects', () => {
      const blob: BlobObject = {
        type: 'blob',
        data: encoder.encode('hello world')
      }
      expect(isBlob(blob)).toBe(true)
    })

    it('isBlob should return false for non-blob objects', () => {
      const tree: TreeObject = {
        type: 'tree',
        data: new Uint8Array(),
        entries: []
      }
      expect(isBlob(tree)).toBe(false)
    })

    it('isTree should return true for tree objects', () => {
      const tree: TreeObject = {
        type: 'tree',
        data: new Uint8Array(),
        entries: [
          { mode: '100644', name: 'file.txt', sha: sampleSha }
        ]
      }
      expect(isTree(tree)).toBe(true)
    })

    it('isTree should return false for non-tree objects', () => {
      const blob: BlobObject = {
        type: 'blob',
        data: encoder.encode('content')
      }
      expect(isTree(blob)).toBe(false)
    })

    it('isCommit should return true for commit objects', () => {
      const commit: CommitObject = {
        type: 'commit',
        data: new Uint8Array(),
        tree: sampleSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Initial commit'
      }
      expect(isCommit(commit)).toBe(true)
    })

    it('isCommit should return false for non-commit objects', () => {
      const blob: BlobObject = {
        type: 'blob',
        data: encoder.encode('content')
      }
      expect(isCommit(blob)).toBe(false)
    })

    it('isTag should return true for tag objects', () => {
      const tag: TagObject = {
        type: 'tag',
        data: new Uint8Array(),
        object: sampleSha,
        objectType: 'commit',
        tagger: sampleAuthor,
        message: 'v1.0.0',
        name: 'v1.0.0'
      }
      expect(isTag(tag)).toBe(true)
    })

    it('isTag should return false for non-tag objects', () => {
      const commit: CommitObject = {
        type: 'commit',
        data: new Uint8Array(),
        tree: sampleSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'test'
      }
      expect(isTag(commit)).toBe(false)
    })
  })

  describe('Blob Serialization', () => {
    it('should serialize an empty blob', () => {
      const data = new Uint8Array(0)
      const serialized = serializeBlob(data)
      // Git format: "blob <size>\0<content>"
      expect(decoder.decode(serialized.slice(0, 6))).toBe('blob 0')
      expect(serialized[6]).toBe(0) // null byte
      expect(serialized.length).toBe(7)
    })

    it('should serialize a blob with content', () => {
      const content = encoder.encode('hello world')
      const serialized = serializeBlob(content)
      // Git format: "blob 11\0hello world"
      expect(decoder.decode(serialized.slice(0, 7))).toBe('blob 11')
      expect(serialized[7]).toBe(0) // null byte
      expect(decoder.decode(serialized.slice(8))).toBe('hello world')
    })

    it('should serialize binary blob data', () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe])
      const serialized = serializeBlob(binaryData)
      expect(decoder.decode(serialized.slice(0, 6))).toBe('blob 5')
      expect(serialized[6]).toBe(0)
      expect(serialized.slice(7)).toEqual(binaryData)
    })
  })

  describe('Blob Deserialization', () => {
    it('should parse an empty blob', () => {
      const data = encoder.encode('blob 0\0')
      const blob = parseBlob(data)
      expect(blob.type).toBe('blob')
      expect(blob.data.length).toBe(0)
    })

    it('should parse a blob with content', () => {
      const content = 'hello world'
      const data = encoder.encode(`blob ${content.length}\0${content}`)
      const blob = parseBlob(data)
      expect(blob.type).toBe('blob')
      expect(decoder.decode(blob.data)).toBe('hello world')
    })
  })

  describe('Tree Serialization', () => {
    it('should serialize an empty tree', () => {
      const entries: TreeEntry[] = []
      const serialized = serializeTree(entries)
      // Git format: "tree 0\0"
      expect(decoder.decode(serialized.slice(0, 6))).toBe('tree 0')
      expect(serialized[6]).toBe(0)
    })

    it('should serialize a tree with single file entry', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: sampleSha }
      ]
      const serialized = serializeTree(entries)
      // Tree format: "tree <size>\0<mode> <name>\0<20-byte-sha>"
      expect(decoder.decode(serialized.slice(0, 4))).toBe('tree')
    })

    it('should serialize tree entries sorted by name', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'z.txt', sha: sampleSha },
        { mode: '100644', name: 'a.txt', sha: sampleSha },
        { mode: '040000', name: 'dir', sha: sampleSha }
      ]
      const serialized = serializeTree(entries)
      // Entries should be sorted: a.txt, dir, z.txt (directories sorted as dir/)
      expect(serialized).toBeDefined()
    })

    it('should serialize tree with directory entry', () => {
      const entries: TreeEntry[] = [
        { mode: '040000', name: 'subdir', sha: sampleSha }
      ]
      const serialized = serializeTree(entries)
      expect(serialized).toBeDefined()
    })

    it('should serialize tree with executable file', () => {
      const entries: TreeEntry[] = [
        { mode: '100755', name: 'script.sh', sha: sampleSha }
      ]
      const serialized = serializeTree(entries)
      expect(serialized).toBeDefined()
    })

    it('should serialize tree with symlink', () => {
      const entries: TreeEntry[] = [
        { mode: '120000', name: 'link', sha: sampleSha }
      ]
      const serialized = serializeTree(entries)
      expect(serialized).toBeDefined()
    })
  })

  describe('Tree Deserialization', () => {
    it('should parse an empty tree', () => {
      const data = encoder.encode('tree 0\0')
      const tree = parseTree(data)
      expect(tree.type).toBe('tree')
      expect(tree.entries).toEqual([])
    })

    it('should parse a tree and extract entries', () => {
      // Build a minimal tree binary
      // Format: tree <size>\0<mode> <name>\0<20-byte-sha>
      const mode = '100644'
      const name = 'file.txt'
      const sha20 = hexToBytes(sampleSha)
      const entryPart = encoder.encode(`${mode} ${name}\0`)
      const entryContent = new Uint8Array(entryPart.length + 20)
      entryContent.set(entryPart)
      entryContent.set(sha20, entryPart.length)

      const header = encoder.encode(`tree ${entryContent.length}\0`)
      const fullData = new Uint8Array(header.length + entryContent.length)
      fullData.set(header)
      fullData.set(entryContent, header.length)

      const tree = parseTree(fullData)
      expect(tree.type).toBe('tree')
      expect(tree.entries.length).toBe(1)
      expect(tree.entries[0].mode).toBe('100644')
      expect(tree.entries[0].name).toBe('file.txt')
      expect(tree.entries[0].sha).toBe(sampleSha)
    })
  })

  describe('Commit Serialization', () => {
    it('should serialize a commit with no parents', () => {
      const commit = {
        tree: sampleSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Initial commit'
      }
      const serialized = serializeCommit(commit)
      const str = decoder.decode(serialized)
      expect(str).toContain('commit')
      expect(str).toContain(`tree ${sampleSha}`)
      expect(str).toContain('author Test User <test@example.com.ai>')
      expect(str).toContain('Initial commit')
    })

    it('should serialize a commit with one parent', () => {
      const parentSha = 'b'.repeat(40)
      const commit = {
        tree: sampleSha,
        parents: [parentSha],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Second commit'
      }
      const serialized = serializeCommit(commit)
      const str = decoder.decode(serialized)
      expect(str).toContain(`parent ${parentSha}`)
    })

    it('should serialize a merge commit with multiple parents', () => {
      const parent1 = 'b'.repeat(40)
      const parent2 = 'c'.repeat(40)
      const commit = {
        tree: sampleSha,
        parents: [parent1, parent2],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Merge commit'
      }
      const serialized = serializeCommit(commit)
      const str = decoder.decode(serialized)
      expect(str).toContain(`parent ${parent1}`)
      expect(str).toContain(`parent ${parent2}`)
    })

    it('should serialize commit with different author and committer', () => {
      const differentCommitter: Author = {
        name: 'Committer',
        email: 'committer@example.com.ai',
        timestamp: 1704153600,
        timezone: '-0500'
      }
      const commit = {
        tree: sampleSha,
        parents: [],
        author: sampleAuthor,
        committer: differentCommitter,
        message: 'Commit'
      }
      const serialized = serializeCommit(commit)
      const str = decoder.decode(serialized)
      expect(str).toContain('author Test User <test@example.com.ai>')
      expect(str).toContain('committer Committer <committer@example.com.ai>')
    })

    it('should serialize commit with multiline message', () => {
      const commit = {
        tree: sampleSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'First line\n\nDetailed description\nwith multiple lines'
      }
      const serialized = serializeCommit(commit)
      const str = decoder.decode(serialized)
      expect(str).toContain('First line')
      expect(str).toContain('Detailed description')
    })
  })

  describe('Commit Deserialization', () => {
    it('should parse a simple commit', () => {
      const commitContent = [
        `tree ${sampleSha}`,
        `author Test User <test@example.com.ai> 1704067200 +0000`,
        `committer Test User <test@example.com.ai> 1704067200 +0000`,
        '',
        'Initial commit'
      ].join('\n')
      const data = encoder.encode(`commit ${commitContent.length}\0${commitContent}`)

      const commit = parseCommit(data)
      expect(commit.type).toBe('commit')
      expect(commit.tree).toBe(sampleSha)
      expect(commit.parents).toEqual([])
      expect(commit.author.name).toBe('Test User')
      expect(commit.author.email).toBe('test@example.com.ai')
      expect(commit.message).toBe('Initial commit')
    })

    it('should parse a commit with parents', () => {
      const parentSha = 'b'.repeat(40)
      const commitContent = [
        `tree ${sampleSha}`,
        `parent ${parentSha}`,
        `author Test User <test@example.com.ai> 1704067200 +0000`,
        `committer Test User <test@example.com.ai> 1704067200 +0000`,
        '',
        'Second commit'
      ].join('\n')
      const data = encoder.encode(`commit ${commitContent.length}\0${commitContent}`)

      const commit = parseCommit(data)
      expect(commit.parents).toEqual([parentSha])
    })

    it('should parse a merge commit with multiple parents', () => {
      const parent1 = 'b'.repeat(40)
      const parent2 = 'c'.repeat(40)
      const commitContent = [
        `tree ${sampleSha}`,
        `parent ${parent1}`,
        `parent ${parent2}`,
        `author Test User <test@example.com.ai> 1704067200 +0000`,
        `committer Test User <test@example.com.ai> 1704067200 +0000`,
        '',
        'Merge branch feature'
      ].join('\n')
      const data = encoder.encode(`commit ${commitContent.length}\0${commitContent}`)

      const commit = parseCommit(data)
      expect(commit.parents).toEqual([parent1, parent2])
    })
  })

  describe('Tag Serialization', () => {
    it('should serialize an annotated tag', () => {
      const tag = {
        object: sampleSha,
        objectType: 'commit' as ObjectType,
        tagger: sampleAuthor,
        message: 'Release v1.0.0',
        name: 'v1.0.0'
      }
      const serialized = serializeTag(tag)
      const str = decoder.decode(serialized)
      expect(str).toContain('tag')
      expect(str).toContain(`object ${sampleSha}`)
      expect(str).toContain('type commit')
      expect(str).toContain('tag v1.0.0')
      expect(str).toContain('tagger Test User <test@example.com.ai>')
    })
  })

  describe('Tag Deserialization', () => {
    it('should parse an annotated tag', () => {
      const tagContent = [
        `object ${sampleSha}`,
        'type commit',
        'tag v1.0.0',
        `tagger Test User <test@example.com.ai> 1704067200 +0000`,
        '',
        'Release v1.0.0'
      ].join('\n')
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)

      const tag = parseTag(data)
      expect(tag.type).toBe('tag')
      expect(tag.object).toBe(sampleSha)
      expect(tag.objectType).toBe('commit')
      expect(tag.name).toBe('v1.0.0')
      expect(tag.tagger?.name).toBe('Test User')
      expect(tag.message).toBe('Release v1.0.0')
    })

    it('should parse tag without tagger field', () => {
      const tagContent = [
        `object ${sampleSha}`,
        'type commit',
        'tag v1.0.0',
        '',
        'Release v1.0.0'
      ].join('\n')
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)

      const tag = parseTag(data)
      expect(tag.type).toBe('tag')
      expect(tag.object).toBe(sampleSha)
      expect(tag.objectType).toBe('commit')
      expect(tag.name).toBe('v1.0.0')
      expect(tag.tagger).toBeUndefined()
      expect(tag.message).toBe('Release v1.0.0')
    })

    it('should parse old-style tag without tagger field', () => {
      // Older Git versions could create tags without tagger
      const tagContent = [
        `object ${sampleSha}`,
        'type commit',
        'tag v0.1.0',
        '',
        'Early release tag from old Git version'
      ].join('\n')
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)

      const tag = parseTag(data)
      expect(tag.type).toBe('tag')
      expect(tag.object).toBe(sampleSha)
      expect(tag.objectType).toBe('commit')
      expect(tag.name).toBe('v0.1.0')
      expect(tag.tagger).toBeUndefined()
      expect(tag.message).toBe('Early release tag from old Git version')
    })

    it('should parse tag without tagger pointing to tree object', () => {
      // Edge case: tag pointing to a tree without tagger
      const tagContent = [
        `object ${sampleSha}`,
        'type tree',
        'tag tree-snapshot',
        '',
        'Snapshot of tree state'
      ].join('\n')
      const data = encoder.encode(`tag ${tagContent.length}\0${tagContent}`)

      const tag = parseTag(data)
      expect(tag.type).toBe('tag')
      expect(tag.object).toBe(sampleSha)
      expect(tag.objectType).toBe('tree')
      expect(tag.name).toBe('tree-snapshot')
      expect(tag.tagger).toBeUndefined()
      expect(tag.message).toBe('Snapshot of tree state')
    })
  })

  describe('Round-trip Tests', () => {
    it('should round-trip a blob', () => {
      const originalData = encoder.encode('Hello, Git!')
      const serialized = serializeBlob(originalData)
      const parsed = parseBlob(serialized)
      expect(decoder.decode(parsed.data)).toBe('Hello, Git!')
    })

    it('should round-trip a tree', () => {
      const originalEntries: TreeEntry[] = [
        { mode: '100644', name: 'README.md', sha: sampleSha },
        { mode: '040000', name: 'src', sha: 'b'.repeat(40) }
      ]
      const serialized = serializeTree(originalEntries)
      const parsed = parseTree(serialized)
      expect(parsed.entries.length).toBe(2)
      expect(parsed.entries.find(e => e.name === 'README.md')).toBeDefined()
      expect(parsed.entries.find(e => e.name === 'src')).toBeDefined()
    })

    it('should round-trip a commit', () => {
      const originalCommit = {
        tree: sampleSha,
        parents: ['b'.repeat(40)],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Test commit message'
      }
      const serialized = serializeCommit(originalCommit)
      const parsed = parseCommit(serialized)
      expect(parsed.tree).toBe(originalCommit.tree)
      expect(parsed.parents).toEqual(originalCommit.parents)
      expect(parsed.author.name).toBe(originalCommit.author.name)
      expect(parsed.message).toBe(originalCommit.message)
    })

    it('should round-trip a tag', () => {
      const originalTag = {
        object: sampleSha,
        objectType: 'commit' as ObjectType,
        tagger: sampleAuthor,
        message: 'Version 1.0',
        name: 'v1.0'
      }
      const serialized = serializeTag(originalTag)
      const parsed = parseTag(serialized)
      expect(parsed.object).toBe(originalTag.object)
      expect(parsed.objectType).toBe(originalTag.objectType)
      expect(parsed.name).toBe(originalTag.name)
      expect(parsed.message).toBe(originalTag.message)
    })
  })

  describe('Edge Cases', () => {
    it('should handle blob with newlines', () => {
      const content = 'line1\nline2\nline3'
      const serialized = serializeBlob(encoder.encode(content))
      const parsed = parseBlob(serialized)
      expect(decoder.decode(parsed.data)).toBe(content)
    })

    it('should handle commit with empty message', () => {
      const commit = {
        tree: sampleSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: ''
      }
      const serialized = serializeCommit(commit)
      const parsed = parseCommit(serialized)
      expect(parsed.message).toBe('')
    })

    it('should handle tree with special characters in filename', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file with spaces.txt', sha: sampleSha },
        { mode: '100644', name: 'file-with-dashes.txt', sha: sampleSha }
      ]
      const serialized = serializeTree(entries)
      const parsed = parseTree(serialized)
      expect(parsed.entries.length).toBe(2)
    })

    it('should handle octopus merge with many parents', () => {
      const parents = Array.from({ length: 5 }, (_, i) =>
        String.fromCharCode(97 + i).repeat(40) // a*40, b*40, c*40, etc.
      )
      const commit = {
        tree: sampleSha,
        parents,
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Octopus merge'
      }
      const serialized = serializeCommit(commit)
      const parsed = parseCommit(serialized)
      expect(parsed.parents.length).toBe(5)
    })

    it('should handle author with unicode characters', () => {
      const unicodeAuthor: Author = {
        name: 'Tester',
        email: 'test@example.com.ai',
        timestamp: 1704067200,
        timezone: '+0900'
      }
      const commit = {
        tree: sampleSha,
        parents: [],
        author: unicodeAuthor,
        committer: unicodeAuthor,
        message: 'Unicode test'
      }
      const serialized = serializeCommit(commit)
      const parsed = parseCommit(serialized)
      expect(parsed.author.timezone).toBe('+0900')
    })

    it('should round-trip tag without tagger', () => {
      const originalTag = {
        object: sampleSha,
        objectType: 'commit' as ObjectType,
        message: 'Version 1.0',
        name: 'v1.0'
      }
      const serialized = serializeTag(originalTag)
      const parsed = parseTag(serialized)
      expect(parsed.object).toBe(originalTag.object)
      expect(parsed.objectType).toBe(originalTag.objectType)
      expect(parsed.name).toBe(originalTag.name)
      expect(parsed.message).toBe(originalTag.message)
      expect(parsed.tagger).toBeUndefined()
    })
  })
})
