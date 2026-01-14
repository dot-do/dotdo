import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Ref name validation
  isValidRefName,
  isValidBranchName,
  isValidTagName,
  isValidRemoteName,
  validateRefName,
  RefValidationError,

  // Symbolic refs
  SymbolicRef,
  parseSymbolicRef,
  serializeSymbolicRef,
  isSymbolicRef,
  getSymbolicTarget,

  // Direct refs
  DirectRef,
  parseDirectRef,
  serializeDirectRef,
  isDirectRef,

  // Ref types
  Ref,
  RefKind,
  getRefKind,
  isHeadRef,
  isBranchRef,
  isTagRef,
  isRemoteRef,
  isNotesRef,
  isStashRef,

  // Packed-refs file format
  PackedRefs,
  parsePackedRefsFile,
  serializePackedRefsFile,
  PackedRefsEntry,
  getPeeledTarget,
  hasPeeledEntry,

  // Ref resolution
  ResolvedRef,
  resolveRefChain,
  resolveToSha,
  ResolutionError,
  CircularRefError,
  MaxDepthExceededError,
  RefNotFoundError,

  // Refspec parsing
  Refspec,
  parseRefspec,
  serializeRefspec,
  RefspecDirection,
  isForceRefspec,
  getRefspecSource,
  getRefspecDestination,
  matchRefspec,
  expandRefspec,

  // Ref patterns/globs
  RefPattern,
  parseRefPattern,
  matchRefPattern,
  expandRefPattern,
  isWildcardPattern,

  // Peeled refs
  PeeledRef,
  peelRef,
  isPeeledRef,
  getPeeledSha,

  // HEAD detached state
  HeadState,
  getHeadState,
  isDetachedHead,
  getDetachedSha,
  getAttachedBranch,

  // Ref locking
  RefLock,
  RefLockError,
  acquireRefLock,
  releaseRefLock,
  isRefLocked,
  LockTimeoutError,
  StaleLockError
} from '../../../core/refs'

// ============================================================================
// Test Constants
// ============================================================================

const validSha1 = 'a'.repeat(40)
const validSha2 = 'b'.repeat(40)
const validSha3 = 'c'.repeat(40)
const validSha4 = 'd'.repeat(40)
const invalidShaShort = 'a'.repeat(39)
const invalidShaLong = 'a'.repeat(41)
const invalidShaChars = 'g'.repeat(40) // 'g' is not hex

// ============================================================================
// 1. Ref Name Validation Tests
// ============================================================================

describe('Ref Name Validation', () => {
  describe('isValidRefName', () => {
    describe('Valid ref names', () => {
      it('should accept HEAD', () => {
        expect(isValidRefName('HEAD')).toBe(true)
      })

      it('should accept FETCH_HEAD', () => {
        expect(isValidRefName('FETCH_HEAD')).toBe(true)
      })

      it('should accept ORIG_HEAD', () => {
        expect(isValidRefName('ORIG_HEAD')).toBe(true)
      })

      it('should accept MERGE_HEAD', () => {
        expect(isValidRefName('MERGE_HEAD')).toBe(true)
      })

      it('should accept CHERRY_PICK_HEAD', () => {
        expect(isValidRefName('CHERRY_PICK_HEAD')).toBe(true)
      })

      it('should accept simple branch names', () => {
        expect(isValidRefName('refs/heads/main')).toBe(true)
        expect(isValidRefName('refs/heads/master')).toBe(true)
        expect(isValidRefName('refs/heads/develop')).toBe(true)
      })

      it('should accept branch names with slashes', () => {
        expect(isValidRefName('refs/heads/feature/login')).toBe(true)
        expect(isValidRefName('refs/heads/feature/user/signup')).toBe(true)
        expect(isValidRefName('refs/heads/bugfix/issue-123')).toBe(true)
      })

      it('should accept branch names with hyphens', () => {
        expect(isValidRefName('refs/heads/my-feature-branch')).toBe(true)
      })

      it('should accept branch names with underscores', () => {
        expect(isValidRefName('refs/heads/my_feature_branch')).toBe(true)
      })

      it('should accept branch names with numbers', () => {
        expect(isValidRefName('refs/heads/feature-123')).toBe(true)
        expect(isValidRefName('refs/heads/v2')).toBe(true)
      })

      it('should accept tag names', () => {
        expect(isValidRefName('refs/tags/v1.0.0')).toBe(true)
        expect(isValidRefName('refs/tags/release-1.0')).toBe(true)
      })

      it('should accept tag names with dots', () => {
        expect(isValidRefName('refs/tags/v1.0.0-beta.1')).toBe(true)
      })

      it('should accept remote tracking refs', () => {
        expect(isValidRefName('refs/remotes/origin/main')).toBe(true)
        expect(isValidRefName('refs/remotes/upstream/feature/test')).toBe(true)
      })

      it('should accept notes refs', () => {
        expect(isValidRefName('refs/notes/commits')).toBe(true)
      })

      it('should accept stash refs', () => {
        expect(isValidRefName('refs/stash')).toBe(true)
      })

      it('should accept bisect refs', () => {
        expect(isValidRefName('refs/bisect/good')).toBe(true)
        expect(isValidRefName('refs/bisect/bad')).toBe(true)
      })
    })

    describe('Invalid ref names - double dots', () => {
      it('should reject names with consecutive dots (..)', () => {
        expect(isValidRefName('refs/heads/foo..bar')).toBe(false)
        expect(isValidRefName('refs/heads/..hidden')).toBe(false)
        expect(isValidRefName('refs/heads/test..')).toBe(false)
      })

      it('should reject names with triple dots (...)', () => {
        expect(isValidRefName('refs/heads/foo...bar')).toBe(false)
      })
    })

    describe('Invalid ref names - control characters', () => {
      it('should reject names with null byte', () => {
        expect(isValidRefName('refs/heads/foo\x00bar')).toBe(false)
      })

      it('should reject names with control characters (0x00-0x1F)', () => {
        expect(isValidRefName('refs/heads/foo\x01bar')).toBe(false)
        expect(isValidRefName('refs/heads/foo\x1Fbar')).toBe(false)
        expect(isValidRefName('refs/heads/foo\tbar')).toBe(false) // tab
        expect(isValidRefName('refs/heads/foo\nbar')).toBe(false) // newline
        expect(isValidRefName('refs/heads/foo\rbar')).toBe(false) // carriage return
      })

      it('should reject names with DEL character (0x7F)', () => {
        expect(isValidRefName('refs/heads/foo\x7Fbar')).toBe(false)
      })
    })

    describe('Invalid ref names - special characters', () => {
      it('should reject names with space', () => {
        expect(isValidRefName('refs/heads/my branch')).toBe(false)
        expect(isValidRefName('refs/heads/ leadingspace')).toBe(false)
        expect(isValidRefName('refs/heads/trailingspace ')).toBe(false)
      })

      it('should reject names with tilde (~)', () => {
        expect(isValidRefName('refs/heads/foo~bar')).toBe(false)
        expect(isValidRefName('refs/heads/foo~1')).toBe(false)
      })

      it('should reject names with caret (^)', () => {
        expect(isValidRefName('refs/heads/foo^bar')).toBe(false)
        expect(isValidRefName('refs/heads/foo^2')).toBe(false)
        expect(isValidRefName('refs/heads/foo^{}')).toBe(false)
      })

      it('should reject names with colon (:)', () => {
        expect(isValidRefName('refs/heads/foo:bar')).toBe(false)
      })

      it('should reject names with question mark (?)', () => {
        expect(isValidRefName('refs/heads/foo?bar')).toBe(false)
      })

      it('should reject names with asterisk (*)', () => {
        expect(isValidRefName('refs/heads/foo*bar')).toBe(false)
      })

      it('should reject names with open bracket ([)', () => {
        expect(isValidRefName('refs/heads/foo[bar')).toBe(false)
      })

      it('should reject names with backslash (\\)', () => {
        expect(isValidRefName('refs/heads/foo\\bar')).toBe(false)
      })
    })

    describe('Invalid ref names - @{ sequence', () => {
      it('should reject names containing @{', () => {
        expect(isValidRefName('refs/heads/@{foo}')).toBe(false)
        expect(isValidRefName('refs/heads/foo@{bar}')).toBe(false)
        expect(isValidRefName('refs/heads/foo@{1}')).toBe(false)
        expect(isValidRefName('refs/heads/@{-1}')).toBe(false)
      })
    })

    describe('Invalid ref names - bare @ sign', () => {
      it('should reject single @ as ref name', () => {
        expect(isValidRefName('@')).toBe(false)
      })

      it('should accept @ within a valid name', () => {
        // Git allows @ in names when not followed by {
        expect(isValidRefName('refs/heads/user@example')).toBe(true)
      })
    })

    describe('Invalid ref names - .lock suffix', () => {
      it('should reject names ending with .lock', () => {
        expect(isValidRefName('refs/heads/branch.lock')).toBe(false)
        expect(isValidRefName('refs/heads/feature.lock')).toBe(false)
      })

      it('should reject component ending with .lock', () => {
        expect(isValidRefName('refs/heads/branch.lock/test')).toBe(false)
      })

      it('should accept .lock in middle of name', () => {
        expect(isValidRefName('refs/heads/branch.locked')).toBe(true)
        expect(isValidRefName('refs/heads/file.lock.backup')).toBe(true)
      })
    })

    describe('Invalid ref names - dots at boundaries', () => {
      it('should reject names starting with dot', () => {
        expect(isValidRefName('refs/heads/.hidden')).toBe(false)
      })

      it('should reject component starting with dot', () => {
        expect(isValidRefName('refs/heads/feature/.hidden')).toBe(false)
      })

      it('should reject names ending with dot', () => {
        expect(isValidRefName('refs/heads/branch.')).toBe(false)
      })

      it('should reject component ending with dot', () => {
        expect(isValidRefName('refs/heads/branch./test')).toBe(false)
      })
    })

    describe('Invalid ref names - empty components', () => {
      it('should reject names with consecutive slashes', () => {
        expect(isValidRefName('refs/heads//branch')).toBe(false)
        expect(isValidRefName('refs//heads/branch')).toBe(false)
        expect(isValidRefName('refs/heads///branch')).toBe(false)
      })

      it('should reject names starting with slash', () => {
        expect(isValidRefName('/refs/heads/branch')).toBe(false)
      })

      it('should reject names ending with slash', () => {
        expect(isValidRefName('refs/heads/branch/')).toBe(false)
      })
    })

    describe('Invalid ref names - empty string', () => {
      it('should reject empty string', () => {
        expect(isValidRefName('')).toBe(false)
      })
    })
  })

  describe('validateRefName (throws on invalid)', () => {
    it('should return true for valid ref names', () => {
      expect(validateRefName('refs/heads/main')).toBe(true)
    })

    it('should throw RefValidationError for invalid ref names', () => {
      expect(() => validateRefName('refs/heads/foo..bar')).toThrow(RefValidationError)
    })

    it('should include reason in error message', () => {
      try {
        validateRefName('refs/heads/foo..bar')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(RefValidationError)
        expect((e as RefValidationError).message).toContain('..')
      }
    })
  })

  describe('isValidBranchName', () => {
    it('should accept valid branch names', () => {
      expect(isValidBranchName('main')).toBe(true)
      expect(isValidBranchName('feature/login')).toBe(true)
      expect(isValidBranchName('bugfix-123')).toBe(true)
    })

    it('should reject names that look like full refs', () => {
      expect(isValidBranchName('refs/heads/main')).toBe(false)
    })

    it('should reject HEAD', () => {
      expect(isValidBranchName('HEAD')).toBe(false)
    })

    it('should reject names starting with dash', () => {
      expect(isValidBranchName('-branch')).toBe(false)
    })
  })

  describe('isValidTagName', () => {
    it('should accept valid tag names', () => {
      expect(isValidTagName('v1.0.0')).toBe(true)
      expect(isValidTagName('release-1.0')).toBe(true)
      expect(isValidTagName('v1.0.0-beta.1')).toBe(true)
    })

    it('should reject names that look like full refs', () => {
      expect(isValidTagName('refs/tags/v1.0.0')).toBe(false)
    })
  })

  describe('isValidRemoteName', () => {
    it('should accept valid remote names', () => {
      expect(isValidRemoteName('origin')).toBe(true)
      expect(isValidRemoteName('upstream')).toBe(true)
      expect(isValidRemoteName('my-remote')).toBe(true)
    })

    it('should reject names with slashes', () => {
      expect(isValidRemoteName('origin/extra')).toBe(false)
    })
  })
})

// ============================================================================
// 2. Symbolic Refs Tests
// ============================================================================

describe('Symbolic Refs', () => {
  describe('parseSymbolicRef', () => {
    it('should parse HEAD pointing to branch', () => {
      const content = 'ref: refs/heads/main\n'
      const result = parseSymbolicRef(content)

      expect(result.type).toBe('symbolic')
      expect(result.target).toBe('refs/heads/main')
    })

    it('should parse symbolic ref without trailing newline', () => {
      const content = 'ref: refs/heads/main'
      const result = parseSymbolicRef(content)

      expect(result.target).toBe('refs/heads/main')
    })

    it('should handle extra whitespace', () => {
      const content = 'ref:   refs/heads/main  \n'
      const result = parseSymbolicRef(content)

      expect(result.target).toBe('refs/heads/main')
    })

    it('should handle Windows line endings', () => {
      const content = 'ref: refs/heads/main\r\n'
      const result = parseSymbolicRef(content)

      expect(result.target).toBe('refs/heads/main')
    })

    it('should throw on invalid format', () => {
      const content = 'refs/heads/main\n' // Missing 'ref: '
      expect(() => parseSymbolicRef(content)).toThrow()
    })

    it('should throw on empty content', () => {
      expect(() => parseSymbolicRef('')).toThrow()
    })

    it('should parse symbolic ref with nested path', () => {
      const content = 'ref: refs/heads/feature/deep/nested/branch\n'
      const result = parseSymbolicRef(content)

      expect(result.target).toBe('refs/heads/feature/deep/nested/branch')
    })
  })

  describe('serializeSymbolicRef', () => {
    it('should serialize symbolic ref to standard format', () => {
      const ref: SymbolicRef = {
        type: 'symbolic',
        target: 'refs/heads/main'
      }
      const result = serializeSymbolicRef(ref)

      expect(result).toBe('ref: refs/heads/main\n')
    })

    it('should round-trip through parse and serialize', () => {
      const original = 'ref: refs/heads/feature/test\n'
      const parsed = parseSymbolicRef(original)
      const serialized = serializeSymbolicRef(parsed)

      expect(serialized).toBe(original)
    })
  })

  describe('isSymbolicRef', () => {
    it('should return true for symbolic refs', () => {
      const ref: SymbolicRef = { type: 'symbolic', target: 'refs/heads/main' }
      expect(isSymbolicRef(ref)).toBe(true)
    })

    it('should return false for direct refs', () => {
      const ref: DirectRef = { type: 'direct', sha: validSha1 }
      expect(isSymbolicRef(ref)).toBe(false)
    })
  })

  describe('getSymbolicTarget', () => {
    it('should return target for symbolic ref', () => {
      const ref: SymbolicRef = { type: 'symbolic', target: 'refs/heads/main' }
      expect(getSymbolicTarget(ref)).toBe('refs/heads/main')
    })

    it('should return null for direct ref', () => {
      const ref: DirectRef = { type: 'direct', sha: validSha1 }
      expect(getSymbolicTarget(ref)).toBeNull()
    })
  })
})

// ============================================================================
// 3. Direct Refs Tests
// ============================================================================

describe('Direct Refs', () => {
  describe('parseDirectRef', () => {
    it('should parse SHA-1 hash with newline', () => {
      const content = `${validSha1}\n`
      const result = parseDirectRef(content)

      expect(result.type).toBe('direct')
      expect(result.sha).toBe(validSha1)
    })

    it('should parse SHA-1 without trailing newline', () => {
      const content = validSha1
      const result = parseDirectRef(content)

      expect(result.sha).toBe(validSha1)
    })

    it('should handle leading/trailing whitespace', () => {
      const content = `  ${validSha1}  \n`
      const result = parseDirectRef(content)

      expect(result.sha).toBe(validSha1)
    })

    it('should accept uppercase hex characters', () => {
      const upperSha = validSha1.toUpperCase()
      const result = parseDirectRef(upperSha)

      expect(result.sha.toLowerCase()).toBe(validSha1)
    })

    it('should normalize to lowercase', () => {
      const upperSha = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'
      const result = parseDirectRef(upperSha)

      expect(result.sha).toBe(upperSha.toLowerCase())
    })

    it('should throw on invalid SHA-1 (too short)', () => {
      expect(() => parseDirectRef(invalidShaShort)).toThrow()
    })

    it('should throw on invalid SHA-1 (too long)', () => {
      expect(() => parseDirectRef(invalidShaLong)).toThrow()
    })

    it('should throw on invalid SHA-1 (non-hex chars)', () => {
      expect(() => parseDirectRef(invalidShaChars)).toThrow()
    })

    it('should throw on empty content', () => {
      expect(() => parseDirectRef('')).toThrow()
    })

    it('should throw on symbolic ref content', () => {
      expect(() => parseDirectRef('ref: refs/heads/main')).toThrow()
    })
  })

  describe('serializeDirectRef', () => {
    it('should serialize direct ref with newline', () => {
      const ref: DirectRef = { type: 'direct', sha: validSha1 }
      const result = serializeDirectRef(ref)

      expect(result).toBe(`${validSha1}\n`)
    })

    it('should serialize lowercase SHA', () => {
      const ref: DirectRef = { type: 'direct', sha: validSha1.toUpperCase() }
      const result = serializeDirectRef(ref)

      expect(result).toBe(`${validSha1}\n`)
    })
  })

  describe('isDirectRef', () => {
    it('should return true for direct refs', () => {
      const ref: DirectRef = { type: 'direct', sha: validSha1 }
      expect(isDirectRef(ref)).toBe(true)
    })

    it('should return false for symbolic refs', () => {
      const ref: SymbolicRef = { type: 'symbolic', target: 'refs/heads/main' }
      expect(isDirectRef(ref)).toBe(false)
    })
  })
})

// ============================================================================
// 4. Ref Type Classification Tests
// ============================================================================

describe('Ref Type Classification', () => {
  describe('getRefKind', () => {
    it('should identify HEAD ref', () => {
      expect(getRefKind('HEAD')).toBe(RefKind.Head)
    })

    it('should identify branch refs', () => {
      expect(getRefKind('refs/heads/main')).toBe(RefKind.Branch)
      expect(getRefKind('refs/heads/feature/test')).toBe(RefKind.Branch)
    })

    it('should identify tag refs', () => {
      expect(getRefKind('refs/tags/v1.0.0')).toBe(RefKind.Tag)
    })

    it('should identify remote refs', () => {
      expect(getRefKind('refs/remotes/origin/main')).toBe(RefKind.Remote)
    })

    it('should identify notes refs', () => {
      expect(getRefKind('refs/notes/commits')).toBe(RefKind.Notes)
    })

    it('should identify stash ref', () => {
      expect(getRefKind('refs/stash')).toBe(RefKind.Stash)
    })

    it('should return Other for unknown ref types', () => {
      expect(getRefKind('refs/custom/something')).toBe(RefKind.Other)
    })

    it('should identify special HEAD refs', () => {
      expect(getRefKind('FETCH_HEAD')).toBe(RefKind.Head)
      expect(getRefKind('ORIG_HEAD')).toBe(RefKind.Head)
      expect(getRefKind('MERGE_HEAD')).toBe(RefKind.Head)
    })
  })

  describe('isHeadRef', () => {
    it('should return true for HEAD', () => {
      expect(isHeadRef('HEAD')).toBe(true)
    })

    it('should return true for FETCH_HEAD', () => {
      expect(isHeadRef('FETCH_HEAD')).toBe(true)
    })

    it('should return false for branch refs', () => {
      expect(isHeadRef('refs/heads/main')).toBe(false)
    })
  })

  describe('isBranchRef', () => {
    it('should return true for branch refs', () => {
      expect(isBranchRef('refs/heads/main')).toBe(true)
    })

    it('should return false for tag refs', () => {
      expect(isBranchRef('refs/tags/v1.0.0')).toBe(false)
    })
  })

  describe('isTagRef', () => {
    it('should return true for tag refs', () => {
      expect(isTagRef('refs/tags/v1.0.0')).toBe(true)
    })

    it('should return false for branch refs', () => {
      expect(isTagRef('refs/heads/main')).toBe(false)
    })
  })

  describe('isRemoteRef', () => {
    it('should return true for remote refs', () => {
      expect(isRemoteRef('refs/remotes/origin/main')).toBe(true)
    })

    it('should return false for local branch refs', () => {
      expect(isRemoteRef('refs/heads/main')).toBe(false)
    })
  })

  describe('isNotesRef', () => {
    it('should return true for notes refs', () => {
      expect(isNotesRef('refs/notes/commits')).toBe(true)
    })
  })

  describe('isStashRef', () => {
    it('should return true for stash ref', () => {
      expect(isStashRef('refs/stash')).toBe(true)
    })
  })
})

// ============================================================================
// 5. Packed-refs File Format Tests
// ============================================================================

describe('Packed-refs File Format', () => {
  describe('parsePackedRefsFile', () => {
    it('should parse simple packed-refs content', () => {
      const content = [
        '# pack-refs with: peeled fully-peeled sorted',
        `${validSha1} refs/heads/main`,
        `${validSha2} refs/heads/develop`,
        `${validSha3} refs/tags/v1.0.0`
      ].join('\n')

      const result = parsePackedRefsFile(content)

      expect(result.entries.size).toBe(3)
      expect(result.entries.get('refs/heads/main')).toBe(validSha1)
      expect(result.entries.get('refs/heads/develop')).toBe(validSha2)
      expect(result.entries.get('refs/tags/v1.0.0')).toBe(validSha3)
    })

    it('should skip comment lines', () => {
      const content = [
        '# This is a comment',
        `${validSha1} refs/heads/main`,
        '# Another comment',
        `${validSha2} refs/heads/develop`
      ].join('\n')

      const result = parsePackedRefsFile(content)

      expect(result.entries.size).toBe(2)
    })

    it('should skip empty lines', () => {
      const content = [
        `${validSha1} refs/heads/main`,
        '',
        `${validSha2} refs/heads/develop`,
        '',
        ''
      ].join('\n')

      const result = parsePackedRefsFile(content)

      expect(result.entries.size).toBe(2)
    })

    it('should handle empty content', () => {
      const result = parsePackedRefsFile('')

      expect(result.entries.size).toBe(0)
    })

    it('should handle only comments', () => {
      const content = [
        '# pack-refs with: peeled fully-peeled sorted',
        '# nothing here'
      ].join('\n')

      const result = parsePackedRefsFile(content)

      expect(result.entries.size).toBe(0)
    })

    it('should parse peeled tag entries (^SHA lines)', () => {
      const content = [
        '# pack-refs with: peeled fully-peeled sorted',
        `${validSha1} refs/tags/v1.0.0`,
        `^${validSha2}`,
        `${validSha3} refs/heads/main`
      ].join('\n')

      const result = parsePackedRefsFile(content)

      expect(result.entries.get('refs/tags/v1.0.0')).toBe(validSha1)
      expect(result.peeledEntries.get('refs/tags/v1.0.0')).toBe(validSha2)
      expect(result.entries.get('refs/heads/main')).toBe(validSha3)
    })

    it('should handle multiple peeled tags', () => {
      const content = [
        `${validSha1} refs/tags/v1.0.0`,
        `^${validSha2}`,
        `${validSha3} refs/tags/v2.0.0`,
        `^${validSha4}`
      ].join('\n')

      const result = parsePackedRefsFile(content)

      expect(result.peeledEntries.get('refs/tags/v1.0.0')).toBe(validSha2)
      expect(result.peeledEntries.get('refs/tags/v2.0.0')).toBe(validSha4)
    })

    it('should handle Windows line endings (CRLF)', () => {
      const content = `${validSha1} refs/heads/main\r\n${validSha2} refs/heads/develop\r\n`

      const result = parsePackedRefsFile(content)

      expect(result.entries.size).toBe(2)
      expect(result.entries.get('refs/heads/main')).toBe(validSha1)
    })

    it('should handle trailing newline', () => {
      const content = `${validSha1} refs/heads/main\n`

      const result = parsePackedRefsFile(content)

      expect(result.entries.size).toBe(1)
    })

    it('should preserve header traits', () => {
      const content = '# pack-refs with: peeled fully-peeled sorted\n'

      const result = parsePackedRefsFile(content)

      expect(result.traits).toContain('peeled')
      expect(result.traits).toContain('fully-peeled')
      expect(result.traits).toContain('sorted')
    })

    it('should throw on malformed entry', () => {
      const content = 'invalid-sha refs/heads/main\n'

      expect(() => parsePackedRefsFile(content)).toThrow()
    })

    it('should throw on orphaned peeled line', () => {
      const content = [
        `^${validSha1}`,
        `${validSha2} refs/heads/main`
      ].join('\n')

      expect(() => parsePackedRefsFile(content)).toThrow()
    })
  })

  describe('serializePackedRefsFile', () => {
    it('should serialize packed refs with header', () => {
      const refs: PackedRefs = {
        entries: new Map([
          ['refs/heads/main', validSha1],
          ['refs/tags/v1.0.0', validSha2]
        ]),
        peeledEntries: new Map(),
        traits: ['peeled', 'fully-peeled', 'sorted']
      }

      const result = serializePackedRefsFile(refs)

      expect(result).toContain('# pack-refs with:')
      expect(result).toContain(`${validSha1} refs/heads/main`)
      expect(result).toContain(`${validSha2} refs/tags/v1.0.0`)
    })

    it('should sort refs alphabetically', () => {
      const refs: PackedRefs = {
        entries: new Map([
          ['refs/heads/zebra', validSha1],
          ['refs/heads/alpha', validSha2]
        ]),
        peeledEntries: new Map(),
        traits: ['sorted']
      }

      const result = serializePackedRefsFile(refs)
      const lines = result.split('\n').filter(l => !l.startsWith('#') && l.length > 0)

      expect(lines[0]).toContain('alpha')
      expect(lines[1]).toContain('zebra')
    })

    it('should include peeled entries', () => {
      const refs: PackedRefs = {
        entries: new Map([
          ['refs/tags/v1.0.0', validSha1]
        ]),
        peeledEntries: new Map([
          ['refs/tags/v1.0.0', validSha2]
        ]),
        traits: ['peeled']
      }

      const result = serializePackedRefsFile(refs)

      expect(result).toContain(`${validSha1} refs/tags/v1.0.0`)
      expect(result).toContain(`^${validSha2}`)
    })

    it('should round-trip through parse and serialize', () => {
      const original = [
        '# pack-refs with: peeled fully-peeled sorted',
        `${validSha1} refs/heads/main`,
        `${validSha2} refs/tags/v1.0.0`,
        `^${validSha3}`,
        ''
      ].join('\n')

      const parsed = parsePackedRefsFile(original)
      const serialized = serializePackedRefsFile(parsed)
      const reparsed = parsePackedRefsFile(serialized)

      expect(reparsed.entries.get('refs/heads/main')).toBe(validSha1)
      expect(reparsed.entries.get('refs/tags/v1.0.0')).toBe(validSha2)
      expect(reparsed.peeledEntries.get('refs/tags/v1.0.0')).toBe(validSha3)
    })
  })

  describe('getPeeledTarget', () => {
    it('should return peeled SHA for annotated tag', () => {
      const refs: PackedRefs = {
        entries: new Map([['refs/tags/v1.0.0', validSha1]]),
        peeledEntries: new Map([['refs/tags/v1.0.0', validSha2]]),
        traits: []
      }

      expect(getPeeledTarget(refs, 'refs/tags/v1.0.0')).toBe(validSha2)
    })

    it('should return null for non-peeled ref', () => {
      const refs: PackedRefs = {
        entries: new Map([['refs/heads/main', validSha1]]),
        peeledEntries: new Map(),
        traits: []
      }

      expect(getPeeledTarget(refs, 'refs/heads/main')).toBeNull()
    })
  })

  describe('hasPeeledEntry', () => {
    it('should return true if peeled entry exists', () => {
      const refs: PackedRefs = {
        entries: new Map([['refs/tags/v1.0.0', validSha1]]),
        peeledEntries: new Map([['refs/tags/v1.0.0', validSha2]]),
        traits: []
      }

      expect(hasPeeledEntry(refs, 'refs/tags/v1.0.0')).toBe(true)
    })

    it('should return false if no peeled entry', () => {
      const refs: PackedRefs = {
        entries: new Map([['refs/heads/main', validSha1]]),
        peeledEntries: new Map(),
        traits: []
      }

      expect(hasPeeledEntry(refs, 'refs/heads/main')).toBe(false)
    })
  })
})

// ============================================================================
// 6. Ref Resolution Tests
// ============================================================================

describe('Ref Resolution', () => {
  describe('resolveRefChain', () => {
    it('should resolve direct ref immediately', async () => {
      const getRef = async (name: string): Promise<Ref | null> => {
        if (name === 'refs/heads/main') {
          return { type: 'direct', sha: validSha1 }
        }
        return null
      }

      const result = await resolveRefChain('refs/heads/main', getRef)

      expect(result.finalSha).toBe(validSha1)
      expect(result.chain).toHaveLength(1)
      expect(result.chain[0]).toBe('refs/heads/main')
    })

    it('should resolve symbolic ref through one level', async () => {
      const getRef = async (name: string): Promise<Ref | null> => {
        if (name === 'HEAD') {
          return { type: 'symbolic', target: 'refs/heads/main' }
        }
        if (name === 'refs/heads/main') {
          return { type: 'direct', sha: validSha1 }
        }
        return null
      }

      const result = await resolveRefChain('HEAD', getRef)

      expect(result.finalSha).toBe(validSha1)
      expect(result.chain).toHaveLength(2)
      expect(result.chain[0]).toBe('HEAD')
      expect(result.chain[1]).toBe('refs/heads/main')
    })

    it('should resolve through multiple symbolic refs', async () => {
      const getRef = async (name: string): Promise<Ref | null> => {
        if (name === 'refs/level1') {
          return { type: 'symbolic', target: 'refs/level2' }
        }
        if (name === 'refs/level2') {
          return { type: 'symbolic', target: 'refs/level3' }
        }
        if (name === 'refs/level3') {
          return { type: 'symbolic', target: 'refs/heads/main' }
        }
        if (name === 'refs/heads/main') {
          return { type: 'direct', sha: validSha1 }
        }
        return null
      }

      const result = await resolveRefChain('refs/level1', getRef)

      expect(result.finalSha).toBe(validSha1)
      expect(result.chain).toHaveLength(4)
    })

    it('should track intermediate refs in chain', async () => {
      const getRef = async (name: string): Promise<Ref | null> => {
        if (name === 'HEAD') {
          return { type: 'symbolic', target: 'refs/heads/feature' }
        }
        if (name === 'refs/heads/feature') {
          return { type: 'symbolic', target: 'refs/heads/main' }
        }
        if (name === 'refs/heads/main') {
          return { type: 'direct', sha: validSha1 }
        }
        return null
      }

      const result = await resolveRefChain('HEAD', getRef)

      expect(result.chain).toEqual(['HEAD', 'refs/heads/feature', 'refs/heads/main'])
    })
  })

  describe('resolveToSha', () => {
    it('should return SHA for direct ref', async () => {
      const getRef = async (name: string): Promise<Ref | null> => {
        if (name === 'refs/heads/main') {
          return { type: 'direct', sha: validSha1 }
        }
        return null
      }

      const sha = await resolveToSha('refs/heads/main', getRef)

      expect(sha).toBe(validSha1)
    })

    it('should return SHA for symbolic ref', async () => {
      const getRef = async (name: string): Promise<Ref | null> => {
        if (name === 'HEAD') {
          return { type: 'symbolic', target: 'refs/heads/main' }
        }
        if (name === 'refs/heads/main') {
          return { type: 'direct', sha: validSha1 }
        }
        return null
      }

      const sha = await resolveToSha('HEAD', getRef)

      expect(sha).toBe(validSha1)
    })
  })

  describe('Error handling', () => {
    it('should throw RefNotFoundError for non-existent ref', async () => {
      const getRef = async (): Promise<Ref | null> => null

      await expect(resolveRefChain('refs/heads/nonexistent', getRef))
        .rejects.toThrow(RefNotFoundError)
    })

    it('should throw CircularRefError for circular refs', async () => {
      const getRef = async (name: string): Promise<Ref | null> => {
        if (name === 'refs/a') {
          return { type: 'symbolic', target: 'refs/b' }
        }
        if (name === 'refs/b') {
          return { type: 'symbolic', target: 'refs/c' }
        }
        if (name === 'refs/c') {
          return { type: 'symbolic', target: 'refs/a' }
        }
        return null
      }

      await expect(resolveRefChain('refs/a', getRef))
        .rejects.toThrow(CircularRefError)
    })

    it('should throw MaxDepthExceededError when max depth exceeded', async () => {
      let counter = 0
      const getRef = async (name: string): Promise<Ref | null> => {
        counter++
        return { type: 'symbolic', target: `refs/level${counter}` }
      }

      await expect(resolveRefChain('refs/start', getRef, { maxDepth: 10 }))
        .rejects.toThrow(MaxDepthExceededError)
    })

    it('should include partial chain in error', async () => {
      const getRef = async (name: string): Promise<Ref | null> => {
        if (name === 'HEAD') {
          return { type: 'symbolic', target: 'refs/heads/missing' }
        }
        return null
      }

      try {
        await resolveRefChain('HEAD', getRef)
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(RefNotFoundError)
        expect((e as RefNotFoundError).partialChain).toContain('HEAD')
      }
    })
  })
})

// ============================================================================
// 7. Refspec Parsing Tests
// ============================================================================

describe('Refspec Parsing', () => {
  describe('parseRefspec', () => {
    it('should parse simple refspec (src:dst)', () => {
      const result = parseRefspec('refs/heads/main:refs/heads/main')

      expect(result.source).toBe('refs/heads/main')
      expect(result.destination).toBe('refs/heads/main')
      expect(result.force).toBe(false)
    })

    it('should parse forced refspec (+src:dst)', () => {
      const result = parseRefspec('+refs/heads/main:refs/heads/main')

      expect(result.source).toBe('refs/heads/main')
      expect(result.destination).toBe('refs/heads/main')
      expect(result.force).toBe(true)
    })

    it('should parse refspec with wildcard', () => {
      const result = parseRefspec('refs/heads/*:refs/remotes/origin/*')

      expect(result.source).toBe('refs/heads/*')
      expect(result.destination).toBe('refs/remotes/origin/*')
      expect(result.hasWildcard).toBe(true)
    })

    it('should parse forced refspec with wildcard', () => {
      const result = parseRefspec('+refs/heads/*:refs/remotes/origin/*')

      expect(result.force).toBe(true)
      expect(result.hasWildcard).toBe(true)
    })

    it('should parse refspec with only source (fetch)', () => {
      const result = parseRefspec('refs/heads/main')

      expect(result.source).toBe('refs/heads/main')
      expect(result.destination).toBe('')
    })

    it('should parse refspec with only destination (push delete)', () => {
      const result = parseRefspec(':refs/heads/to-delete')

      expect(result.source).toBe('')
      expect(result.destination).toBe('refs/heads/to-delete')
    })

    it('should parse abbreviated branch refspec', () => {
      const result = parseRefspec('main:main')

      expect(result.source).toBe('main')
      expect(result.destination).toBe('main')
    })

    it('should parse tag refspec', () => {
      const result = parseRefspec('refs/tags/v1.0.0:refs/tags/v1.0.0')

      expect(result.source).toBe('refs/tags/v1.0.0')
      expect(result.destination).toBe('refs/tags/v1.0.0')
    })

    it('should handle complex wildcard patterns', () => {
      const result = parseRefspec('+refs/heads/feature/*:refs/remotes/origin/feature/*')

      expect(result.source).toBe('refs/heads/feature/*')
      expect(result.destination).toBe('refs/remotes/origin/feature/*')
    })

    it('should throw on invalid refspec (multiple colons)', () => {
      expect(() => parseRefspec('src:dst:extra')).toThrow()
    })

    it('should throw on mismatched wildcards', () => {
      expect(() => parseRefspec('refs/heads/*:refs/remotes/origin/main')).toThrow()
    })

    it('should throw on multiple wildcards in pattern', () => {
      expect(() => parseRefspec('refs/*/heads/*:refs/*/remotes/*')).toThrow()
    })
  })

  describe('serializeRefspec', () => {
    it('should serialize normal refspec', () => {
      const refspec: Refspec = {
        source: 'refs/heads/main',
        destination: 'refs/heads/main',
        force: false,
        hasWildcard: false
      }

      expect(serializeRefspec(refspec)).toBe('refs/heads/main:refs/heads/main')
    })

    it('should serialize forced refspec', () => {
      const refspec: Refspec = {
        source: 'refs/heads/main',
        destination: 'refs/heads/main',
        force: true,
        hasWildcard: false
      }

      expect(serializeRefspec(refspec)).toBe('+refs/heads/main:refs/heads/main')
    })

    it('should serialize wildcard refspec', () => {
      const refspec: Refspec = {
        source: 'refs/heads/*',
        destination: 'refs/remotes/origin/*',
        force: true,
        hasWildcard: true
      }

      expect(serializeRefspec(refspec)).toBe('+refs/heads/*:refs/remotes/origin/*')
    })

    it('should round-trip through parse and serialize', () => {
      const original = '+refs/heads/*:refs/remotes/origin/*'
      const parsed = parseRefspec(original)
      const serialized = serializeRefspec(parsed)

      expect(serialized).toBe(original)
    })
  })

  describe('isForceRefspec', () => {
    it('should return true for forced refspec', () => {
      const refspec = parseRefspec('+refs/heads/main:refs/heads/main')
      expect(isForceRefspec(refspec)).toBe(true)
    })

    it('should return false for normal refspec', () => {
      const refspec = parseRefspec('refs/heads/main:refs/heads/main')
      expect(isForceRefspec(refspec)).toBe(false)
    })
  })

  describe('getRefspecSource', () => {
    it('should return source of refspec', () => {
      const refspec = parseRefspec('refs/heads/main:refs/heads/backup')
      expect(getRefspecSource(refspec)).toBe('refs/heads/main')
    })
  })

  describe('getRefspecDestination', () => {
    it('should return destination of refspec', () => {
      const refspec = parseRefspec('refs/heads/main:refs/heads/backup')
      expect(getRefspecDestination(refspec)).toBe('refs/heads/backup')
    })
  })

  describe('matchRefspec', () => {
    it('should match exact refspec', () => {
      const refspec = parseRefspec('refs/heads/main:refs/remotes/origin/main')

      expect(matchRefspec(refspec, 'refs/heads/main')).toBe(true)
      expect(matchRefspec(refspec, 'refs/heads/develop')).toBe(false)
    })

    it('should match wildcard refspec', () => {
      const refspec = parseRefspec('refs/heads/*:refs/remotes/origin/*')

      expect(matchRefspec(refspec, 'refs/heads/main')).toBe(true)
      expect(matchRefspec(refspec, 'refs/heads/feature/login')).toBe(true)
      expect(matchRefspec(refspec, 'refs/tags/v1.0.0')).toBe(false)
    })
  })

  describe('expandRefspec', () => {
    it('should expand wildcard refspec for specific ref', () => {
      const refspec = parseRefspec('refs/heads/*:refs/remotes/origin/*')
      const expanded = expandRefspec(refspec, 'refs/heads/main')

      expect(expanded.source).toBe('refs/heads/main')
      expect(expanded.destination).toBe('refs/remotes/origin/main')
    })

    it('should expand nested path in wildcard', () => {
      const refspec = parseRefspec('refs/heads/*:refs/remotes/origin/*')
      const expanded = expandRefspec(refspec, 'refs/heads/feature/login')

      expect(expanded.destination).toBe('refs/remotes/origin/feature/login')
    })

    it('should throw if ref does not match refspec', () => {
      const refspec = parseRefspec('refs/heads/*:refs/remotes/origin/*')

      expect(() => expandRefspec(refspec, 'refs/tags/v1.0.0')).toThrow()
    })
  })
})

// ============================================================================
// 8. Ref Patterns/Globs Tests
// ============================================================================

describe('Ref Patterns/Globs', () => {
  describe('parseRefPattern', () => {
    it('should parse simple wildcard pattern', () => {
      const pattern = parseRefPattern('refs/heads/*')

      expect(pattern.prefix).toBe('refs/heads/')
      expect(pattern.isWildcard).toBe(true)
    })

    it('should parse exact pattern (no wildcard)', () => {
      const pattern = parseRefPattern('refs/heads/main')

      expect(pattern.prefix).toBe('refs/heads/main')
      expect(pattern.isWildcard).toBe(false)
    })

    it('should parse nested wildcard pattern', () => {
      const pattern = parseRefPattern('refs/remotes/origin/*')

      expect(pattern.prefix).toBe('refs/remotes/origin/')
    })

    it('should parse pattern with wildcard in middle', () => {
      const pattern = parseRefPattern('refs/heads/feature/*')

      expect(pattern.prefix).toBe('refs/heads/feature/')
    })
  })

  describe('matchRefPattern', () => {
    it('should match refs with wildcard pattern', () => {
      const pattern = parseRefPattern('refs/heads/*')

      expect(matchRefPattern(pattern, 'refs/heads/main')).toBe(true)
      expect(matchRefPattern(pattern, 'refs/heads/feature/login')).toBe(true)
      expect(matchRefPattern(pattern, 'refs/tags/v1.0.0')).toBe(false)
    })

    it('should match exact pattern', () => {
      const pattern = parseRefPattern('refs/heads/main')

      expect(matchRefPattern(pattern, 'refs/heads/main')).toBe(true)
      expect(matchRefPattern(pattern, 'refs/heads/main2')).toBe(false)
      expect(matchRefPattern(pattern, 'refs/heads/mai')).toBe(false)
    })

    it('should match HEAD pattern', () => {
      const pattern = parseRefPattern('HEAD')

      expect(matchRefPattern(pattern, 'HEAD')).toBe(true)
      expect(matchRefPattern(pattern, 'refs/heads/main')).toBe(false)
    })

    it('should match nested paths with wildcard', () => {
      const pattern = parseRefPattern('refs/remotes/origin/*')

      expect(matchRefPattern(pattern, 'refs/remotes/origin/main')).toBe(true)
      expect(matchRefPattern(pattern, 'refs/remotes/origin/feature/test')).toBe(true)
      expect(matchRefPattern(pattern, 'refs/remotes/upstream/main')).toBe(false)
    })
  })

  describe('expandRefPattern', () => {
    it('should expand wildcard pattern to matching refs', () => {
      const refs = [
        'refs/heads/main',
        'refs/heads/develop',
        'refs/heads/feature/login',
        'refs/tags/v1.0.0'
      ]
      const pattern = parseRefPattern('refs/heads/*')

      const expanded = expandRefPattern(pattern, refs)

      expect(expanded).toContain('refs/heads/main')
      expect(expanded).toContain('refs/heads/develop')
      expect(expanded).toContain('refs/heads/feature/login')
      expect(expanded).not.toContain('refs/tags/v1.0.0')
    })

    it('should return single ref for exact pattern', () => {
      const refs = [
        'refs/heads/main',
        'refs/heads/develop'
      ]
      const pattern = parseRefPattern('refs/heads/main')

      const expanded = expandRefPattern(pattern, refs)

      expect(expanded).toEqual(['refs/heads/main'])
    })

    it('should return empty array if no matches', () => {
      const refs = ['refs/heads/main']
      const pattern = parseRefPattern('refs/tags/*')

      const expanded = expandRefPattern(pattern, refs)

      expect(expanded).toEqual([])
    })
  })

  describe('isWildcardPattern', () => {
    it('should return true for wildcard patterns', () => {
      expect(isWildcardPattern('refs/heads/*')).toBe(true)
      expect(isWildcardPattern('refs/remotes/origin/*')).toBe(true)
    })

    it('should return false for exact patterns', () => {
      expect(isWildcardPattern('refs/heads/main')).toBe(false)
      expect(isWildcardPattern('HEAD')).toBe(false)
    })
  })
})

// ============================================================================
// 9. Peeled Refs Tests
// ============================================================================

describe('Peeled Refs', () => {
  describe('peelRef', () => {
    it('should return same SHA for commit ref', async () => {
      const getObject = async (sha: string) => {
        if (sha === validSha1) {
          return { type: 'commit', sha: validSha1 }
        }
        return null
      }

      const result = await peelRef(validSha1, getObject)

      expect(result).toBe(validSha1)
    })

    it('should peel annotated tag to commit', async () => {
      const getObject = async (sha: string) => {
        if (sha === validSha1) {
          return { type: 'tag', target: validSha2 }
        }
        if (sha === validSha2) {
          return { type: 'commit', sha: validSha2 }
        }
        return null
      }

      const result = await peelRef(validSha1, getObject)

      expect(result).toBe(validSha2)
    })

    it('should peel through multiple tag layers', async () => {
      const getObject = async (sha: string) => {
        if (sha === validSha1) {
          return { type: 'tag', target: validSha2 }
        }
        if (sha === validSha2) {
          return { type: 'tag', target: validSha3 }
        }
        if (sha === validSha3) {
          return { type: 'commit', sha: validSha3 }
        }
        return null
      }

      const result = await peelRef(validSha1, getObject)

      expect(result).toBe(validSha3)
    })

    it('should return tree SHA when peeling to tree', async () => {
      const getObject = async (sha: string) => {
        if (sha === validSha1) {
          return { type: 'commit', tree: validSha2 }
        }
        if (sha === validSha2) {
          return { type: 'tree', sha: validSha2 }
        }
        return null
      }

      const result = await peelRef(validSha1, getObject, { target: 'tree' })

      expect(result).toBe(validSha2)
    })

    it('should throw if object not found', async () => {
      const getObject = async () => null

      await expect(peelRef(validSha1, getObject)).rejects.toThrow()
    })
  })

  describe('isPeeledRef', () => {
    it('should return true for refs ending with ^{}', () => {
      expect(isPeeledRef('refs/tags/v1.0.0^{}')).toBe(true)
    })

    it('should return false for normal refs', () => {
      expect(isPeeledRef('refs/tags/v1.0.0')).toBe(false)
      expect(isPeeledRef('refs/heads/main')).toBe(false)
    })
  })

  describe('getPeeledSha', () => {
    it('should return cached peeled SHA', () => {
      const cache = new Map([['refs/tags/v1.0.0', validSha1]])

      expect(getPeeledSha(cache, 'refs/tags/v1.0.0')).toBe(validSha1)
    })

    it('should return null if not in cache', () => {
      const cache = new Map<string, string>()

      expect(getPeeledSha(cache, 'refs/tags/v1.0.0')).toBeNull()
    })
  })
})

// ============================================================================
// 10. HEAD Detached State Tests
// ============================================================================

describe('HEAD Detached State', () => {
  describe('getHeadState', () => {
    it('should return attached state for symbolic HEAD', async () => {
      const getRef = async (name: string): Promise<Ref | null> => {
        if (name === 'HEAD') {
          return { type: 'symbolic', target: 'refs/heads/main' }
        }
        return null
      }

      const state = await getHeadState(getRef)

      expect(state.attached).toBe(true)
      expect(state.branch).toBe('refs/heads/main')
    })

    it('should return detached state for direct HEAD', async () => {
      const getRef = async (name: string): Promise<Ref | null> => {
        if (name === 'HEAD') {
          return { type: 'direct', sha: validSha1 }
        }
        return null
      }

      const state = await getHeadState(getRef)

      expect(state.attached).toBe(false)
      expect(state.sha).toBe(validSha1)
    })

    it('should include SHA for attached state', async () => {
      const getRef = async (name: string): Promise<Ref | null> => {
        if (name === 'HEAD') {
          return { type: 'symbolic', target: 'refs/heads/main' }
        }
        if (name === 'refs/heads/main') {
          return { type: 'direct', sha: validSha1 }
        }
        return null
      }

      const state = await getHeadState(getRef)

      expect(state.sha).toBe(validSha1)
    })

    it('should handle missing HEAD', async () => {
      const getRef = async (): Promise<Ref | null> => null

      await expect(getHeadState(getRef)).rejects.toThrow()
    })
  })

  describe('isDetachedHead', () => {
    it('should return true for detached state', () => {
      const state: HeadState = { attached: false, sha: validSha1 }

      expect(isDetachedHead(state)).toBe(true)
    })

    it('should return false for attached state', () => {
      const state: HeadState = { attached: true, branch: 'refs/heads/main', sha: validSha1 }

      expect(isDetachedHead(state)).toBe(false)
    })
  })

  describe('getDetachedSha', () => {
    it('should return SHA for detached state', () => {
      const state: HeadState = { attached: false, sha: validSha1 }

      expect(getDetachedSha(state)).toBe(validSha1)
    })

    it('should return null for attached state', () => {
      const state: HeadState = { attached: true, branch: 'refs/heads/main', sha: validSha1 }

      expect(getDetachedSha(state)).toBeNull()
    })
  })

  describe('getAttachedBranch', () => {
    it('should return branch for attached state', () => {
      const state: HeadState = { attached: true, branch: 'refs/heads/main', sha: validSha1 }

      expect(getAttachedBranch(state)).toBe('refs/heads/main')
    })

    it('should return null for detached state', () => {
      const state: HeadState = { attached: false, sha: validSha1 }

      expect(getAttachedBranch(state)).toBeNull()
    })

    it('should extract branch name without refs/heads/ prefix', () => {
      const state: HeadState = { attached: true, branch: 'refs/heads/feature/login', sha: validSha1 }

      expect(getAttachedBranch(state, { stripPrefix: true })).toBe('feature/login')
    })
  })
})

// ============================================================================
// 11. Ref Locking Semantics Tests
// ============================================================================

describe('Ref Locking Semantics', () => {
  describe('acquireRefLock', () => {
    it('should acquire lock on ref', async () => {
      const locks = new Set<string>()
      const backend = {
        createLock: async (name: string) => {
          if (locks.has(name)) return false
          locks.add(name)
          return true
        },
        removeLock: async (name: string) => {
          locks.delete(name)
        }
      }

      const lock = await acquireRefLock('refs/heads/main', backend)

      expect(lock.refName).toBe('refs/heads/main')
      expect(lock.isHeld()).toBe(true)
    })

    it('should create .lock file', async () => {
      const files = new Map<string, boolean>()
      const backend = {
        createLock: async (name: string) => {
          const lockFile = `${name}.lock`
          if (files.has(lockFile)) return false
          files.set(lockFile, true)
          return true
        },
        removeLock: async (name: string) => {
          files.delete(`${name}.lock`)
        }
      }

      await acquireRefLock('refs/heads/main', backend)

      expect(files.has('refs/heads/main.lock')).toBe(true)
    })

    it('should throw RefLockError if already locked', async () => {
      const locks = new Set<string>(['refs/heads/main'])
      const backend = {
        createLock: async (name: string) => !locks.has(name),
        removeLock: async () => {}
      }

      await expect(acquireRefLock('refs/heads/main', backend))
        .rejects.toThrow(RefLockError)
    })

    it('should retry acquiring lock with timeout', async () => {
      let attempts = 0
      const backend = {
        createLock: async () => {
          attempts++
          return attempts >= 3
        },
        removeLock: async () => {}
      }

      const lock = await acquireRefLock('refs/heads/main', backend, {
        timeout: 1000,
        retryInterval: 100
      })

      expect(lock.isHeld()).toBe(true)
      expect(attempts).toBe(3)
    })

    it('should throw LockTimeoutError after timeout', async () => {
      const backend = {
        createLock: async () => false,
        removeLock: async () => {}
      }

      await expect(acquireRefLock('refs/heads/main', backend, {
        timeout: 100,
        retryInterval: 50
      })).rejects.toThrow(LockTimeoutError)
    })
  })

  describe('releaseRefLock', () => {
    it('should release held lock', async () => {
      const locks = new Set<string>()
      const backend = {
        createLock: async (name: string) => {
          locks.add(name)
          return true
        },
        removeLock: async (name: string) => {
          locks.delete(name)
        }
      }

      const lock = await acquireRefLock('refs/heads/main', backend)
      await releaseRefLock(lock)

      expect(lock.isHeld()).toBe(false)
      expect(locks.has('refs/heads/main')).toBe(false)
    })

    it('should be idempotent (safe to call multiple times)', async () => {
      const locks = new Set<string>()
      const backend = {
        createLock: async (name: string) => {
          locks.add(name)
          return true
        },
        removeLock: async (name: string) => {
          locks.delete(name)
        }
      }

      const lock = await acquireRefLock('refs/heads/main', backend)
      await releaseRefLock(lock)
      await releaseRefLock(lock) // Should not throw

      expect(lock.isHeld()).toBe(false)
    })
  })

  describe('isRefLocked', () => {
    it('should return true for locked ref', async () => {
      const locks = new Set<string>(['refs/heads/main'])
      const backend = {
        checkLock: async (name: string) => locks.has(name)
      }

      const locked = await isRefLocked('refs/heads/main', backend)

      expect(locked).toBe(true)
    })

    it('should return false for unlocked ref', async () => {
      const locks = new Set<string>()
      const backend = {
        checkLock: async (name: string) => locks.has(name)
      }

      const locked = await isRefLocked('refs/heads/main', backend)

      expect(locked).toBe(false)
    })
  })

  describe('Stale lock detection', () => {
    it('should detect stale lock by age', async () => {
      const backend = {
        createLock: async () => false,
        getLockAge: async () => 3600 * 1000, // 1 hour old
        removeLock: async () => {}
      }

      await expect(acquireRefLock('refs/heads/main', backend, {
        staleThreshold: 60 * 1000 // 1 minute
      })).rejects.toThrow(StaleLockError)
    })

    it('should allow breaking stale lock', async () => {
      let lockBroken = false
      const backend = {
        createLock: async () => !lockBroken,
        getLockAge: async () => 3600 * 1000,
        removeLock: async () => { lockBroken = true },
        breakLock: async () => { lockBroken = true; return true }
      }

      const lock = await acquireRefLock('refs/heads/main', backend, {
        staleThreshold: 60 * 1000,
        breakStale: true
      })

      expect(lock.isHeld()).toBe(true)
    })
  })

  describe('Lock ownership', () => {
    it('should track lock owner', async () => {
      const locks = new Map<string, string>()
      const backend = {
        createLock: async (name: string, owner: string) => {
          if (locks.has(name)) return false
          locks.set(name, owner)
          return true
        },
        removeLock: async (name: string) => {
          locks.delete(name)
        }
      }

      const lock = await acquireRefLock('refs/heads/main', backend, {
        owner: 'process-123'
      })

      expect(lock.owner).toBe('process-123')
    })
  })
})
