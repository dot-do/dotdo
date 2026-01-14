import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CommitOptions,
  CommitAuthor,
  AmendOptions,
  FormatOptions,
  SigningOptions,
  CommitResult,
  ObjectStore,
  createCommit,
  buildCommitObject,
  amendCommit,
  formatCommitMessage,
  parseCommitMessage,
  validateCommitMessage,
  createAuthor,
  formatTimestamp,
  parseTimestamp,
  getCurrentTimezone,
  addSignatureToCommit,
  extractCommitSignature,
  isCommitSigned,
  isEmptyCommit
} from '../../src/ops/commit'
import { Author, CommitObject } from '../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()

const sampleTreeSha = 'a'.repeat(40)
const sampleParentSha = 'b'.repeat(40)
const sampleParentSha2 = 'c'.repeat(40)

const sampleAuthor: CommitAuthor = {
  name: 'Test User',
  email: 'test@example.com.ai',
  timestamp: 1704067200, // 2024-01-01 00:00:00 UTC
  timezone: '+0000'
}

const sampleCommitter: CommitAuthor = {
  name: 'Another User',
  email: 'another@example.com.ai',
  timestamp: 1704153600, // 2024-01-02 00:00:00 UTC
  timezone: '-0500'
}

/**
 * Create a mock object store for testing
 */
function createMockStore(objects: Map<string, { type: string; data: Uint8Array }> = new Map()): ObjectStore {
  const storedObjects = new Map(objects)
  let nextSha = 1

  return {
    async getObject(sha: string) {
      return storedObjects.get(sha) ?? null
    },
    async storeObject(type: string, data: Uint8Array) {
      // Generate a deterministic SHA for testing
      const sha = `mock${String(nextSha++).padStart(36, '0')}`
      storedObjects.set(sha, { type, data })
      return sha
    },
    async hasObject(sha: string) {
      return storedObjects.has(sha)
    }
  }
}

/**
 * Create a sample commit object for testing amendments
 */
function createSampleCommitObject(): CommitObject {
  return {
    type: 'commit',
    data: new Uint8Array(),
    tree: sampleTreeSha,
    parents: [sampleParentSha],
    author: {
      name: 'Original Author',
      email: 'original@example.com.ai',
      timestamp: 1704000000,
      timezone: '+0000'
    },
    committer: {
      name: 'Original Committer',
      email: 'original@example.com.ai',
      timestamp: 1704000000,
      timezone: '+0000'
    },
    message: 'Original commit message'
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Commit Creation', () => {
  let store: ObjectStore

  beforeEach(() => {
    store = createMockStore()
  })

  describe('createCommit', () => {
    describe('Creating a commit with message', () => {
      it('should create a commit with a simple message', async () => {
        const options: CommitOptions = {
          message: 'Initial commit',
          tree: sampleTreeSha,
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result).toBeDefined()
        expect(result.sha).toBeDefined()
        expect(result.sha).toMatch(/^[0-9a-f]{40}$|^mock/)
        expect(result.commit.message).toBe('Initial commit')
        expect(result.created).toBe(true)
      })

      it('should create a commit with a multiline message', async () => {
        const message = 'Subject line\n\nBody paragraph 1.\n\nBody paragraph 2.'
        const options: CommitOptions = {
          message,
          tree: sampleTreeSha,
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.message).toBe(message)
      })

      it('should create a commit with a message containing special characters', async () => {
        const message = 'Fix bug with <script> tags & special "chars"'
        const options: CommitOptions = {
          message,
          tree: sampleTreeSha,
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.message).toBe(message)
      })

      it('should create a commit with unicode in message', async () => {
        const message = 'Fix: Handle emoji in code'
        const options: CommitOptions = {
          message,
          tree: sampleTreeSha,
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.message).toBe(message)
      })

      it('should throw error when message is empty', async () => {
        const options: CommitOptions = {
          message: '',
          tree: sampleTreeSha,
          author: sampleAuthor
        }

        await expect(createCommit(store, options)).rejects.toThrow()
      })

      it('should throw error when message is only whitespace', async () => {
        const options: CommitOptions = {
          message: '   \n\n   ',
          tree: sampleTreeSha,
          author: sampleAuthor
        }

        await expect(createCommit(store, options)).rejects.toThrow()
      })
    })

    describe('Creating a commit with author/committer info', () => {
      it('should create a commit with author information', async () => {
        const options: CommitOptions = {
          message: 'Test commit',
          tree: sampleTreeSha,
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.author.name).toBe(sampleAuthor.name)
        expect(result.commit.author.email).toBe(sampleAuthor.email)
        expect(result.commit.author.timestamp).toBe(sampleAuthor.timestamp)
        expect(result.commit.author.timezone).toBe(sampleAuthor.timezone)
      })

      it('should use author as committer when committer not specified', async () => {
        const options: CommitOptions = {
          message: 'Test commit',
          tree: sampleTreeSha,
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.committer.name).toBe(sampleAuthor.name)
        expect(result.commit.committer.email).toBe(sampleAuthor.email)
      })

      it('should create a commit with different author and committer', async () => {
        const options: CommitOptions = {
          message: 'Test commit',
          tree: sampleTreeSha,
          author: sampleAuthor,
          committer: sampleCommitter
        }

        const result = await createCommit(store, options)

        expect(result.commit.author.name).toBe(sampleAuthor.name)
        expect(result.commit.committer.name).toBe(sampleCommitter.name)
        expect(result.commit.author.email).not.toBe(result.commit.committer.email)
      })

      it('should handle author with unicode name', async () => {
        const unicodeAuthor: CommitAuthor = {
          name: 'Tester',
          email: 'test@example.jp',
          timestamp: 1704067200,
          timezone: '+0900'
        }
        const options: CommitOptions = {
          message: 'Test commit',
          tree: sampleTreeSha,
          author: unicodeAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.author.name).toBe(unicodeAuthor.name)
      })

      it('should use current timestamp when not specified', async () => {
        const nowBefore = Math.floor(Date.now() / 1000)
        const options: CommitOptions = {
          message: 'Test commit',
          tree: sampleTreeSha,
          author: {
            name: 'Test User',
            email: 'test@example.com.ai'
            // timestamp not specified
          }
        }

        const result = await createCommit(store, options)
        const nowAfter = Math.floor(Date.now() / 1000)

        expect(result.commit.author.timestamp).toBeGreaterThanOrEqual(nowBefore)
        expect(result.commit.author.timestamp).toBeLessThanOrEqual(nowAfter)
      })

      it('should use local timezone when not specified', async () => {
        const options: CommitOptions = {
          message: 'Test commit',
          tree: sampleTreeSha,
          author: {
            name: 'Test User',
            email: 'test@example.com.ai'
            // timezone not specified
          }
        }

        const result = await createCommit(store, options)

        expect(result.commit.author.timezone).toMatch(/^[+-]\d{4}$/)
      })
    })

    describe('Creating a commit with parent(s)', () => {
      it('should create a commit with a single parent', async () => {
        const options: CommitOptions = {
          message: 'Second commit',
          tree: sampleTreeSha,
          parents: [sampleParentSha],
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.parents).toEqual([sampleParentSha])
        expect(result.commit.parents.length).toBe(1)
      })

      it('should validate parent SHA format', async () => {
        const options: CommitOptions = {
          message: 'Test commit',
          tree: sampleTreeSha,
          parents: ['invalid-sha'],
          author: sampleAuthor
        }

        await expect(createCommit(store, options)).rejects.toThrow()
      })

      it('should create a commit with no parents (initial commit)', async () => {
        const options: CommitOptions = {
          message: 'Initial commit',
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.parents).toEqual([])
        expect(result.commit.parents.length).toBe(0)
      })

      it('should default to empty parents array when not specified', async () => {
        const options: CommitOptions = {
          message: 'Initial commit',
          tree: sampleTreeSha,
          author: sampleAuthor
          // parents not specified
        }

        const result = await createCommit(store, options)

        expect(result.commit.parents).toEqual([])
      })
    })

    describe('Creating merge commits (multiple parents)', () => {
      it('should create a merge commit with two parents', async () => {
        const options: CommitOptions = {
          message: 'Merge branch feature into main',
          tree: sampleTreeSha,
          parents: [sampleParentSha, sampleParentSha2],
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.parents).toEqual([sampleParentSha, sampleParentSha2])
        expect(result.commit.parents.length).toBe(2)
      })

      it('should create an octopus merge with multiple parents', async () => {
        const parents = [
          sampleParentSha,
          sampleParentSha2,
          'd'.repeat(40),
          'e'.repeat(40),
          'f'.repeat(40)
        ]
        const options: CommitOptions = {
          message: 'Merge branches a, b, c, d, e',
          tree: sampleTreeSha,
          parents,
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.parents).toEqual(parents)
        expect(result.commit.parents.length).toBe(5)
      })

      it('should preserve parent order', async () => {
        const parents = [sampleParentSha2, sampleParentSha] // reversed order
        const options: CommitOptions = {
          message: 'Merge commit',
          tree: sampleTreeSha,
          parents,
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.parents[0]).toBe(sampleParentSha2)
        expect(result.commit.parents[1]).toBe(sampleParentSha)
      })
    })

    describe('Creating initial commit (no parent)', () => {
      it('should create an initial commit with empty parents', async () => {
        const options: CommitOptions = {
          message: 'Initial commit',
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        expect(result.commit.parents).toEqual([])
        expect(result.created).toBe(true)
      })

      it('should properly format initial commit without parent line', async () => {
        const options: CommitOptions = {
          message: 'Initial commit',
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor
        }

        const result = await createCommit(store, options)

        // The commit data should not contain any "parent" lines
        expect(result.commit.parents.length).toBe(0)
      })
    })
  })

  describe('buildCommitObject', () => {
    it('should build a commit object without storing', () => {
      const options: CommitOptions = {
        message: 'Test commit',
        tree: sampleTreeSha,
        parents: [sampleParentSha],
        author: sampleAuthor
      }

      const commit = buildCommitObject(options)

      expect(commit.type).toBe('commit')
      expect(commit.tree).toBe(sampleTreeSha)
      expect(commit.parents).toEqual([sampleParentSha])
      expect(commit.message).toBe('Test commit')
    })

    it('should not require store access', () => {
      const options: CommitOptions = {
        message: 'Test commit',
        tree: sampleTreeSha,
        author: sampleAuthor
      }

      // This should work without any store
      expect(() => buildCommitObject(options)).not.toThrow()
    })
  })
})

describe('Commit Message Formatting', () => {
  describe('formatCommitMessage', () => {
    it('should strip leading and trailing whitespace by default', () => {
      const message = '  Subject line  \n\n  Body text  '
      const formatted = formatCommitMessage(message)

      expect(formatted).toBe('Subject line\n\nBody text')
    })

    it('should preserve message verbatim when cleanup is verbatim', () => {
      const message = '  Subject line  \n\n  Body text  '
      const formatted = formatCommitMessage(message, { cleanup: 'verbatim' })

      expect(formatted).toBe(message)
    })

    it('should strip comment lines when cleanup is strip', () => {
      const message = 'Subject\n\n# This is a comment\nBody text'
      const formatted = formatCommitMessage(message, { cleanup: 'strip' })

      expect(formatted).not.toContain('# This is a comment')
      expect(formatted).toContain('Subject')
      expect(formatted).toContain('Body text')
    })

    it('should use custom comment character', () => {
      const message = 'Subject\n\n; This is a comment\nBody text'
      const formatted = formatCommitMessage(message, {
        cleanup: 'strip',
        commentChar: ';'
      })

      expect(formatted).not.toContain('; This is a comment')
    })

    it('should handle scissors cleanup mode', () => {
      const message = 'Subject\n\nBody\n# ------------------------ >8 ------------------------\nThis should be removed'
      const formatted = formatCommitMessage(message, { cleanup: 'scissors' })

      expect(formatted).toContain('Subject')
      expect(formatted).not.toContain('This should be removed')
    })

    it('should wrap message body at specified column', () => {
      const longLine = 'This is a very long line that should be wrapped because it exceeds the column limit'
      const message = `Subject\n\n${longLine}`
      const formatted = formatCommitMessage(message, { wrapColumn: 40 })

      const lines = formatted.split('\n')
      // Body lines should not exceed 40 characters
      const bodyLines = lines.slice(2) // Skip subject and blank line
      bodyLines.forEach(line => {
        expect(line.length).toBeLessThanOrEqual(40)
      })
    })

    it('should not wrap subject line', () => {
      const longSubject = 'This is a very long subject line that exceeds normal limits'
      const message = longSubject
      const formatted = formatCommitMessage(message, { wrapColumn: 40 })

      // Subject line should remain intact
      expect(formatted.split('\n')[0]).toBe(longSubject)
    })

    it('should collapse multiple blank lines into one', () => {
      const message = 'Subject\n\n\n\n\nBody text'
      const formatted = formatCommitMessage(message, { cleanup: 'default' })

      expect(formatted).toBe('Subject\n\nBody text')
    })

    it('should handle empty message', () => {
      const formatted = formatCommitMessage('')

      expect(formatted).toBe('')
    })

    it('should handle whitespace-only message', () => {
      const formatted = formatCommitMessage('   \n\n   ', { cleanup: 'whitespace' })

      expect(formatted).toBe('')
    })
  })

  describe('parseCommitMessage', () => {
    it('should parse subject and body from message', () => {
      const message = 'Subject line\n\nBody paragraph.'
      const { subject, body } = parseCommitMessage(message)

      expect(subject).toBe('Subject line')
      expect(body).toBe('Body paragraph.')
    })

    it('should handle message with only subject', () => {
      const message = 'Subject line only'
      const { subject, body } = parseCommitMessage(message)

      expect(subject).toBe('Subject line only')
      expect(body).toBe('')
    })

    it('should handle message with multiple body paragraphs', () => {
      const message = 'Subject\n\nParagraph 1.\n\nParagraph 2.'
      const { subject, body } = parseCommitMessage(message)

      expect(subject).toBe('Subject')
      expect(body).toBe('Paragraph 1.\n\nParagraph 2.')
    })

    it('should handle message with no blank line after subject', () => {
      const message = 'Subject\nContinued on next line'
      const { subject, body } = parseCommitMessage(message)

      // Git conventionally treats first line as subject
      expect(subject).toBe('Subject')
    })

    it('should handle empty message', () => {
      const { subject, body } = parseCommitMessage('')

      expect(subject).toBe('')
      expect(body).toBe('')
    })
  })

  describe('validateCommitMessage', () => {
    it('should validate a proper commit message', () => {
      const message = 'Fix: Resolve login bug\n\nThis commit fixes the issue with login.'
      const result = validateCommitMessage(message)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should warn about long subject line', () => {
      const longSubject = 'A'.repeat(100)
      const result = validateCommitMessage(longSubject)

      expect(result.warnings.some(w => w.includes('subject') || w.includes('line'))).toBe(true)
    })

    it('should error on empty message', () => {
      const result = validateCommitMessage('')

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should warn about missing blank line between subject and body', () => {
      const message = 'Subject\nBody without blank line'
      const result = validateCommitMessage(message)

      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it('should warn about subject ending with period', () => {
      const message = 'Subject line ending with period.'
      const result = validateCommitMessage(message)

      expect(result.warnings.some(w => w.includes('period'))).toBe(true)
    })

    it('should accept message without body', () => {
      const message = 'Simple one-line commit message'
      const result = validateCommitMessage(message)

      expect(result.valid).toBe(true)
    })
  })
})

describe('Commit Timestamp Handling', () => {
  describe('createAuthor', () => {
    it('should create an author with current timestamp', () => {
      const nowBefore = Math.floor(Date.now() / 1000)
      const author = createAuthor('Test User', 'test@example.com.ai')
      const nowAfter = Math.floor(Date.now() / 1000)

      expect(author.name).toBe('Test User')
      expect(author.email).toBe('test@example.com.ai')
      expect(author.timestamp).toBeGreaterThanOrEqual(nowBefore)
      expect(author.timestamp).toBeLessThanOrEqual(nowAfter)
    })

    it('should use specified timezone', () => {
      const author = createAuthor('Test User', 'test@example.com.ai', '+0900')

      expect(author.timezone).toBe('+0900')
    })

    it('should use local timezone when not specified', () => {
      const author = createAuthor('Test User', 'test@example.com.ai')

      expect(author.timezone).toMatch(/^[+-]\d{4}$/)
    })
  })

  describe('formatTimestamp', () => {
    it('should format timestamp and timezone', () => {
      const formatted = formatTimestamp(1704067200, '+0000')

      expect(formatted).toBe('1704067200 +0000')
    })

    it('should handle negative timezone', () => {
      const formatted = formatTimestamp(1704067200, '-0500')

      expect(formatted).toBe('1704067200 -0500')
    })

    it('should handle non-hour-aligned timezone', () => {
      const formatted = formatTimestamp(1704067200, '+0530')

      expect(formatted).toBe('1704067200 +0530')
    })
  })

  describe('parseTimestamp', () => {
    it('should parse timestamp string', () => {
      const { timestamp, timezone } = parseTimestamp('1704067200 +0000')

      expect(timestamp).toBe(1704067200)
      expect(timezone).toBe('+0000')
    })

    it('should parse negative timezone', () => {
      const { timestamp, timezone } = parseTimestamp('1704067200 -0500')

      expect(timestamp).toBe(1704067200)
      expect(timezone).toBe('-0500')
    })

    it('should throw on invalid format', () => {
      expect(() => parseTimestamp('invalid')).toThrow()
    })
  })

  describe('getCurrentTimezone', () => {
    it('should return timezone in correct format', () => {
      const tz = getCurrentTimezone()

      expect(tz).toMatch(/^[+-]\d{4}$/)
    })

    it('should return valid timezone offset', () => {
      const tz = getCurrentTimezone()
      const hours = parseInt(tz.slice(1, 3), 10)
      const minutes = parseInt(tz.slice(3, 5), 10)

      expect(hours).toBeLessThanOrEqual(14)
      expect(minutes).toBeLessThan(60)
    })
  })
})

describe('Commit Signature (GPG Signing)', () => {
  const sampleSignature = `-----BEGIN PGP SIGNATURE-----

iQEzBAABCgAdFiEETest...
-----END PGP SIGNATURE-----`

  describe('addSignatureToCommit', () => {
    it('should add GPG signature to commit', () => {
      const commit = createSampleCommitObject()
      const signedCommit = addSignatureToCommit(commit, sampleSignature)

      expect(isCommitSigned(signedCommit)).toBe(true)
    })

    it('should preserve all other commit fields', () => {
      const commit = createSampleCommitObject()
      const signedCommit = addSignatureToCommit(commit, sampleSignature)

      expect(signedCommit.tree).toBe(commit.tree)
      expect(signedCommit.parents).toEqual(commit.parents)
      expect(signedCommit.author).toEqual(commit.author)
      expect(signedCommit.message).toBe(commit.message)
    })

    it('should properly format signature in commit data', () => {
      const commit = createSampleCommitObject()
      const signedCommit = addSignatureToCommit(commit, sampleSignature)
      const signature = extractCommitSignature(signedCommit)

      expect(signature).toBe(sampleSignature)
    })
  })

  describe('extractCommitSignature', () => {
    it('should return null for unsigned commit', () => {
      const commit = createSampleCommitObject()
      const signature = extractCommitSignature(commit)

      expect(signature).toBeNull()
    })

    it('should extract signature from signed commit', () => {
      const commit = createSampleCommitObject()
      const signedCommit = addSignatureToCommit(commit, sampleSignature)
      const extracted = extractCommitSignature(signedCommit)

      expect(extracted).toBe(sampleSignature)
    })
  })

  describe('isCommitSigned', () => {
    it('should return false for unsigned commit', () => {
      const commit = createSampleCommitObject()

      expect(isCommitSigned(commit)).toBe(false)
    })

    it('should return true for signed commit', () => {
      const commit = createSampleCommitObject()
      const signedCommit = addSignatureToCommit(commit, sampleSignature)

      expect(isCommitSigned(signedCommit)).toBe(true)
    })
  })

  describe('createCommit with signing', () => {
    let store: ObjectStore

    beforeEach(() => {
      store = createMockStore()
    })

    it('should create a signed commit when signing is enabled', async () => {
      const mockSigner = vi.fn().mockResolvedValue(sampleSignature)
      const options: CommitOptions = {
        message: 'Signed commit',
        tree: sampleTreeSha,
        author: sampleAuthor,
        signing: {
          sign: true,
          signer: mockSigner
        }
      }

      const result = await createCommit(store, options)

      expect(mockSigner).toHaveBeenCalled()
      expect(isCommitSigned(result.commit)).toBe(true)
    })

    it('should not sign when signing.sign is false', async () => {
      const mockSigner = vi.fn()
      const options: CommitOptions = {
        message: 'Unsigned commit',
        tree: sampleTreeSha,
        author: sampleAuthor,
        signing: {
          sign: false,
          signer: mockSigner
        }
      }

      const result = await createCommit(store, options)

      expect(mockSigner).not.toHaveBeenCalled()
      expect(isCommitSigned(result.commit)).toBe(false)
    })

    it('should pass key ID to signer', async () => {
      const mockSigner = vi.fn().mockResolvedValue(sampleSignature)
      const options: CommitOptions = {
        message: 'Signed commit',
        tree: sampleTreeSha,
        author: sampleAuthor,
        signing: {
          sign: true,
          keyId: 'ABCD1234',
          signer: mockSigner
        }
      }

      await createCommit(store, options)

      // The signer should receive the commit data for signing
      expect(mockSigner).toHaveBeenCalled()
    })
  })
})

describe('Empty Commits (No Changes)', () => {
  let store: ObjectStore

  beforeEach(() => {
    // Create a store with a parent commit that has the same tree
    const parentCommitData = {
      type: 'commit',
      data: new TextEncoder().encode(`tree ${sampleTreeSha}\nauthor Test <t@t.com> 1234567890 +0000\ncommitter Test <t@t.com> 1234567890 +0000\n\nParent commit`)
    }
    store = createMockStore(new Map([
      [sampleParentSha, parentCommitData]
    ]))
  })

  describe('isEmptyCommit', () => {
    it('should return false for initial commit', async () => {
      const isEmpty = await isEmptyCommit(store, sampleTreeSha, null)

      expect(isEmpty).toBe(false)
    })

    it('should return true when tree matches parent tree', async () => {
      const isEmpty = await isEmptyCommit(store, sampleTreeSha, sampleParentSha)

      expect(isEmpty).toBe(true)
    })

    it('should return false when tree differs from parent', async () => {
      const differentTree = 'f'.repeat(40)
      const isEmpty = await isEmptyCommit(store, differentTree, sampleParentSha)

      expect(isEmpty).toBe(false)
    })
  })

  describe('createCommit with allowEmpty', () => {
    it('should throw when creating empty commit without allowEmpty', async () => {
      const options: CommitOptions = {
        message: 'Empty commit',
        tree: sampleTreeSha,
        parents: [sampleParentSha],
        author: sampleAuthor,
        allowEmpty: false
      }

      await expect(createCommit(store, options)).rejects.toThrow()
    })

    it('should create empty commit when allowEmpty is true', async () => {
      const options: CommitOptions = {
        message: 'Empty commit',
        tree: sampleTreeSha,
        parents: [sampleParentSha],
        author: sampleAuthor,
        allowEmpty: true
      }

      const result = await createCommit(store, options)

      expect(result.created).toBe(true)
    })

    it('should create commit when there are actual changes', async () => {
      const differentTree = 'f'.repeat(40)
      const options: CommitOptions = {
        message: 'Commit with changes',
        tree: differentTree,
        parents: [sampleParentSha],
        author: sampleAuthor,
        allowEmpty: false
      }

      const result = await createCommit(store, options)

      expect(result.created).toBe(true)
    })

    it('should allow empty initial commit', async () => {
      const options: CommitOptions = {
        message: 'Initial commit',
        tree: sampleTreeSha,
        parents: [],
        author: sampleAuthor,
        allowEmpty: false // Initial commits are never "empty" in the no-changes sense
      }

      const result = await createCommit(store, options)

      expect(result.created).toBe(true)
    })
  })
})

describe('Amending Commits', () => {
  let store: ObjectStore
  const originalCommitSha = 'original0'.padEnd(40, '0')

  beforeEach(() => {
    const originalCommit = createSampleCommitObject()
    const commitData = new TextEncoder().encode(JSON.stringify(originalCommit))
    store = createMockStore(new Map([
      [originalCommitSha, { type: 'commit', data: commitData }]
    ]))
  })

  describe('amendCommit', () => {
    it('should amend commit message', async () => {
      const options: AmendOptions = {
        message: 'Updated commit message'
      }

      const result = await amendCommit(store, originalCommitSha, options)

      expect(result.commit.message).toBe('Updated commit message')
      expect(result.sha).not.toBe(originalCommitSha)
    })

    it('should keep original message when not specified', async () => {
      const options: AmendOptions = {
        tree: 'f'.repeat(40) // Only change tree
      }

      const result = await amendCommit(store, originalCommitSha, options)

      expect(result.commit.message).toBe('Original commit message')
    })

    it('should amend tree SHA', async () => {
      const newTree = 'f'.repeat(40)
      const options: AmendOptions = {
        tree: newTree
      }

      const result = await amendCommit(store, originalCommitSha, options)

      expect(result.commit.tree).toBe(newTree)
    })

    it('should amend author information', async () => {
      const newAuthor: CommitAuthor = {
        name: 'New Author',
        email: 'new@example.com.ai',
        timestamp: 1705000000,
        timezone: '+0100'
      }
      const options: AmendOptions = {
        author: newAuthor
      }

      const result = await amendCommit(store, originalCommitSha, options)

      expect(result.commit.author.name).toBe('New Author')
      expect(result.commit.author.email).toBe('new@example.com.ai')
    })

    it('should update committer to current user/time by default', async () => {
      const nowBefore = Math.floor(Date.now() / 1000)
      const options: AmendOptions = {
        message: 'Amended'
      }

      const result = await amendCommit(store, originalCommitSha, options)
      const nowAfter = Math.floor(Date.now() / 1000)

      expect(result.commit.committer.timestamp).toBeGreaterThanOrEqual(nowBefore)
      expect(result.commit.committer.timestamp).toBeLessThanOrEqual(nowAfter)
    })

    it('should use specified committer when provided', async () => {
      const newCommitter: CommitAuthor = {
        name: 'New Committer',
        email: 'committer@example.com.ai',
        timestamp: 1705000000,
        timezone: '-0800'
      }
      const options: AmendOptions = {
        committer: newCommitter
      }

      const result = await amendCommit(store, originalCommitSha, options)

      expect(result.commit.committer.name).toBe('New Committer')
    })

    it('should reset author date when resetAuthorDate is true', async () => {
      const nowBefore = Math.floor(Date.now() / 1000)
      const options: AmendOptions = {
        resetAuthorDate: true
      }

      const result = await amendCommit(store, originalCommitSha, options)
      const nowAfter = Math.floor(Date.now() / 1000)

      expect(result.commit.author.timestamp).toBeGreaterThanOrEqual(nowBefore)
      expect(result.commit.author.timestamp).toBeLessThanOrEqual(nowAfter)
    })

    it('should preserve parents from original commit', async () => {
      const options: AmendOptions = {
        message: 'Amended'
      }

      const result = await amendCommit(store, originalCommitSha, options)

      expect(result.commit.parents).toEqual([sampleParentSha])
    })

    it('should throw when commit does not exist', async () => {
      const options: AmendOptions = {
        message: 'Amended'
      }

      await expect(amendCommit(store, 'nonexistent'.padEnd(40, '0'), options)).rejects.toThrow()
    })

    it('should return new SHA different from original', async () => {
      const options: AmendOptions = {
        message: 'Amended message'
      }

      const result = await amendCommit(store, originalCommitSha, options)

      expect(result.sha).not.toBe(originalCommitSha)
    })

    it('should support signing amended commit', async () => {
      const sampleSignature = '-----BEGIN PGP SIGNATURE-----\ntest\n-----END PGP SIGNATURE-----'
      const mockSigner = vi.fn().mockResolvedValue(sampleSignature)
      const options: AmendOptions = {
        message: 'Amended and signed',
        signing: {
          sign: true,
          signer: mockSigner
        }
      }

      const result = await amendCommit(store, originalCommitSha, options)

      expect(isCommitSigned(result.commit)).toBe(true)
    })
  })
})

describe('Edge Cases and Error Handling', () => {
  let store: ObjectStore

  beforeEach(() => {
    store = createMockStore()
  })

  describe('Invalid inputs', () => {
    it('should throw on missing tree SHA', async () => {
      const options = {
        message: 'Test',
        author: sampleAuthor
      } as CommitOptions

      await expect(createCommit(store, options)).rejects.toThrow()
    })

    it('should throw on invalid tree SHA format', async () => {
      const options: CommitOptions = {
        message: 'Test',
        tree: 'invalid',
        author: sampleAuthor
      }

      await expect(createCommit(store, options)).rejects.toThrow()
    })

    it('should throw on missing author', async () => {
      const options = {
        message: 'Test',
        tree: sampleTreeSha
      } as CommitOptions

      await expect(createCommit(store, options)).rejects.toThrow()
    })

    it('should throw on invalid author email format', async () => {
      const options: CommitOptions = {
        message: 'Test',
        tree: sampleTreeSha,
        author: {
          name: 'Test',
          email: 'not-an-email'
        }
      }

      await expect(createCommit(store, options)).rejects.toThrow()
    })
  })

  describe('Special characters in fields', () => {
    it('should handle angle brackets in author name', async () => {
      const options: CommitOptions = {
        message: 'Test',
        tree: sampleTreeSha,
        author: {
          name: 'Test <User>',
          email: 'test@example.com.ai',
          timestamp: 1704067200,
          timezone: '+0000'
        }
      }

      // Git escapes or rejects angle brackets in names
      // Implementation should handle this appropriately
      await expect(createCommit(store, options)).rejects.toThrow()
    })

    it('should handle newlines in author name', async () => {
      const options: CommitOptions = {
        message: 'Test',
        tree: sampleTreeSha,
        author: {
          name: 'Test\nUser',
          email: 'test@example.com.ai',
          timestamp: 1704067200,
          timezone: '+0000'
        }
      }

      await expect(createCommit(store, options)).rejects.toThrow()
    })

    it('should handle very long message', async () => {
      const longMessage = 'A'.repeat(100000)
      const options: CommitOptions = {
        message: longMessage,
        tree: sampleTreeSha,
        author: sampleAuthor
      }

      const result = await createCommit(store, options)

      expect(result.commit.message).toBe(longMessage)
    })
  })

  describe('Timestamp edge cases', () => {
    it('should handle epoch timestamp (0)', async () => {
      const options: CommitOptions = {
        message: 'Epoch commit',
        tree: sampleTreeSha,
        author: {
          ...sampleAuthor,
          timestamp: 0
        }
      }

      const result = await createCommit(store, options)

      expect(result.commit.author.timestamp).toBe(0)
    })

    it('should handle far future timestamp', async () => {
      const options: CommitOptions = {
        message: 'Future commit',
        tree: sampleTreeSha,
        author: {
          ...sampleAuthor,
          timestamp: 4102444800 // Year 2100
        }
      }

      const result = await createCommit(store, options)

      expect(result.commit.author.timestamp).toBe(4102444800)
    })

    it('should handle negative timestamp (before epoch)', async () => {
      const options: CommitOptions = {
        message: 'Past commit',
        tree: sampleTreeSha,
        author: {
          ...sampleAuthor,
          timestamp: -1
        }
      }

      // Negative timestamps may or may not be allowed
      // This documents expected behavior
      await expect(createCommit(store, options)).rejects.toThrow()
    })
  })

  describe('Concurrent operations', () => {
    it('should handle multiple concurrent commits', async () => {
      const commits = await Promise.all([
        createCommit(store, {
          message: 'Commit 1',
          tree: sampleTreeSha,
          author: sampleAuthor
        }),
        createCommit(store, {
          message: 'Commit 2',
          tree: sampleTreeSha,
          author: sampleAuthor
        }),
        createCommit(store, {
          message: 'Commit 3',
          tree: sampleTreeSha,
          author: sampleAuthor
        })
      ])

      expect(commits).toHaveLength(3)
      // All SHAs should be unique
      const shas = commits.map(c => c.sha)
      expect(new Set(shas).size).toBe(3)
    })
  })
})
