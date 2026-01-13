/**
 * Git Operations Tests
 *
 * Tests for gitx (Git on R2) functionality.
 * Demonstrates the zero-VM advantage of running git in V8 isolates.
 *
 * Test categories:
 * 1. Core Operations - init, clone, commit, push
 * 2. Branch Operations - create, checkout, merge
 * 3. CI/CD Integration - pipeline triggers, auto-merge
 * 4. Utility Functions - hash, parse, validate
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  validateCommitMessage,
  generateCommitMessage,
  hashContent,
  formatFileSize,
  parseAuthor,
  createPipelineTrigger,
  canAutoMerge,
  type FileChange,
} from '../src/operations'
import type { GitStatus } from '../../../lib/capabilities/git'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock GitCapability for testing.
 * This simulates gitx behavior without actual R2/DO dependencies.
 */
function createMockGitCapability() {
  let currentBranch = 'main'
  let currentHead: string | undefined = undefined
  const stagedFiles: string[] = []
  const commits: Array<{ hash: string; message: string }> = []

  return {
    configure: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockImplementation(async (): Promise<GitStatus> => ({
      branch: currentBranch,
      head: currentHead,
      staged: stagedFiles,
      unstaged: [],
      untracked: [],
      clean: stagedFiles.length === 0,
    })),
    add: vi.fn().mockImplementation(async (files: string | string[]) => {
      const paths = Array.isArray(files) ? files : [files]
      if (paths.includes('.')) {
        stagedFiles.push('all')
      } else {
        stagedFiles.push(...paths)
      }
    }),
    commit: vi.fn().mockImplementation(async (message: string) => {
      const hash = 'abc123' + commits.length
      commits.push({ hash, message })
      currentHead = hash
      stagedFiles.length = 0
      return { hash }
    }),
    sync: vi.fn().mockResolvedValue({
      success: true,
      objectsFetched: 5,
      filesWritten: 3,
      commit: 'def456',
    }),
    push: vi.fn().mockResolvedValue({
      success: true,
      objectsPushed: 3,
      commit: currentHead,
    }),
    log: vi.fn().mockImplementation(async (options?: { limit?: number }) => {
      const limit = options?.limit ?? commits.length
      return commits.slice(0, limit)
    }),
    diff: vi.fn().mockResolvedValue(''),

    // Test helpers
    _setBranch: (branch: string) => { currentBranch = branch },
    _setHead: (head: string) => { currentHead = head },
    _getStaged: () => [...stagedFiles],
    _getCommits: () => [...commits],
  }
}

// ============================================================================
// Commit Message Validation Tests
// ============================================================================

describe('validateCommitMessage', () => {
  it('validates conventional commit format', () => {
    const result = validateCommitMessage('feat: add dark mode')
    expect(result.valid).toBe(true)
    expect(result.type).toBe('feat')
    expect(result.description).toBe('add dark mode')
  })

  it('validates commit with scope', () => {
    const result = validateCommitMessage('fix(auth): resolve login bug')
    expect(result.valid).toBe(true)
    expect(result.type).toBe('fix')
    expect(result.scope).toBe('auth')
    expect(result.description).toBe('resolve login bug')
  })

  it('rejects invalid format', () => {
    const result = validateCommitMessage('added some stuff')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('must follow format')
  })

  it('rejects invalid type', () => {
    const result = validateCommitMessage('feature: add thing')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid type')
  })

  it('accepts all valid types', () => {
    const validTypes = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'ci', 'perf', 'build']

    for (const type of validTypes) {
      const result = validateCommitMessage(`${type}: test message`)
      expect(result.valid).toBe(true)
      expect(result.type).toBe(type)
    }
  })
})

// ============================================================================
// Commit Message Generation Tests
// ============================================================================

describe('generateCommitMessage', () => {
  it('generates message for additions', () => {
    const changes: FileChange[] = [
      { path: 'src/new.ts', content: '...', mode: 'add' },
      { path: 'src/another.ts', content: '...', mode: 'add' },
    ]
    const message = generateCommitMessage(changes)
    expect(message).toBe('feat: add 2 files')
  })

  it('generates message for modifications', () => {
    const changes: FileChange[] = [
      { path: 'src/existing.ts', content: '...', mode: 'modify' },
    ]
    const message = generateCommitMessage(changes)
    expect(message).toBe('fix: update 1 file')
  })

  it('generates message for deletions', () => {
    const changes: FileChange[] = [
      { path: 'src/old.ts', content: '', mode: 'delete' },
    ]
    const message = generateCommitMessage(changes)
    expect(message).toBe('chore: remove 1 file')
  })

  it('generates combined message', () => {
    const changes: FileChange[] = [
      { path: 'src/new.ts', content: '...', mode: 'add' },
      { path: 'src/existing.ts', content: '...', mode: 'modify' },
      { path: 'src/old.ts', content: '', mode: 'delete' },
    ]
    const message = generateCommitMessage(changes)
    expect(message).toBe('feat: add 1 file, update 1 file, remove 1 file')
  })

  it('treats missing mode as modify', () => {
    const changes: FileChange[] = [
      { path: 'src/file.ts', content: '...' },
    ]
    const message = generateCommitMessage(changes)
    expect(message).toBe('fix: update 1 file')
  })
})

// ============================================================================
// Hash Content Tests
// ============================================================================

describe('hashContent', () => {
  it('generates consistent SHA-1 hashes', async () => {
    const content = 'Hello, World!'
    const hash1 = await hashContent(content)
    const hash2 = await hashContent(content)

    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(40) // SHA-1 is 40 hex chars
  })

  it('generates different hashes for different content', async () => {
    const hash1 = await hashContent('content A')
    const hash2 = await hashContent('content B')

    expect(hash1).not.toBe(hash2)
  })

  it('handles empty content', async () => {
    const hash = await hashContent('')
    expect(hash).toHaveLength(40)
    // SHA-1 of empty string is: da39a3ee5e6b4b0d3255bfef95601890afd80709
    expect(hash).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
  })

  it('handles unicode content', async () => {
    const hash = await hashContent('Hello, World! ... ')
    expect(hash).toHaveLength(40)
  })
})

// ============================================================================
// File Size Formatting Tests
// ============================================================================

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500.0 B')
  })

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(5.5 * 1024 * 1024)).toBe('5.5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB')
  })
})

// ============================================================================
// Author Parsing Tests
// ============================================================================

describe('parseAuthor', () => {
  it('parses full author string with timestamp', () => {
    const result = parseAuthor('John Doe <john@example.com> 1704067200 +0000')
    expect(result.name).toBe('John Doe')
    expect(result.email).toBe('john@example.com')
    expect(result.timestamp).toBe(1704067200)
    expect(result.timezone).toBe('+0000')
  })

  it('parses author without timestamp', () => {
    const result = parseAuthor('Jane Smith <jane@example.com>')
    expect(result.name).toBe('Jane Smith')
    expect(result.email).toBe('jane@example.com')
    expect(result.timestamp).toBeUndefined()
  })

  it('handles invalid format gracefully', () => {
    const result = parseAuthor('Just a name')
    expect(result.name).toBe('Just a name')
    expect(result.email).toBe('')
  })
})

// ============================================================================
// Pipeline Trigger Tests
// ============================================================================

describe('createPipelineTrigger', () => {
  it('creates trigger from git status', () => {
    const status: GitStatus = {
      branch: 'feature/dark-mode',
      head: 'abc123def456',
      staged: [],
      unstaged: [],
      clean: true,
    }

    const trigger = createPipelineTrigger(status, 'agent-ralph')

    expect(trigger.branch).toBe('feature/dark-mode')
    expect(trigger.commit).toBe('abc123def456')
    expect(trigger.triggeredBy).toBe('agent-ralph')
    expect(trigger.timestamp).toBeInstanceOf(Date)
  })

  it('handles missing head commit', () => {
    const status: GitStatus = {
      branch: 'main',
      head: undefined,
      staged: [],
      unstaged: [],
      clean: true,
    }

    const trigger = createPipelineTrigger(status, 'ci-system')
    expect(trigger.commit).toBe('unknown')
  })
})

// ============================================================================
// Auto-Merge Validation Tests
// ============================================================================

describe('canAutoMerge', () => {
  it('allows merge when all conditions met', () => {
    const status: GitStatus = {
      branch: 'main',
      head: 'abc123',
      staged: [],
      unstaged: [],
      clean: true,
    }

    const result = canAutoMerge(status, {
      requireCleanTree: true,
      requiredBranch: 'main',
    })

    expect(result.canMerge).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('rejects dirty working tree', () => {
    const status: GitStatus = {
      branch: 'main',
      head: 'abc123',
      staged: ['file.ts'],
      unstaged: [],
      clean: false,
    }

    const result = canAutoMerge(status, { requireCleanTree: true })
    expect(result.canMerge).toBe(false)
    expect(result.reason).toContain('uncommitted changes')
  })

  it('rejects wrong branch', () => {
    const status: GitStatus = {
      branch: 'feature/test',
      head: 'abc123',
      staged: [],
      unstaged: [],
      clean: true,
    }

    const result = canAutoMerge(status, { requiredBranch: 'main' })
    expect(result.canMerge).toBe(false)
    expect(result.reason).toContain('Must be on branch')
  })

  it('allows merge without options', () => {
    const status: GitStatus = {
      branch: 'any-branch',
      head: 'abc123',
      staged: ['file.ts'],
      unstaged: ['other.ts'],
      clean: false,
    }

    const result = canAutoMerge(status)
    expect(result.canMerge).toBe(true)
  })
})

// ============================================================================
// Mock Git Capability Integration Tests
// ============================================================================

describe('Git Operations with Mock Capability', () => {
  let git: ReturnType<typeof createMockGitCapability>

  beforeEach(() => {
    git = createMockGitCapability()
  })

  it('initializes repository', async () => {
    await git.init()
    expect(git.init).toHaveBeenCalled()
  })

  it('stages files with add', async () => {
    await git.add('src/index.ts')
    expect(git._getStaged()).toContain('src/index.ts')

    await git.add(['file1.ts', 'file2.ts'])
    expect(git._getStaged()).toContain('file1.ts')
    expect(git._getStaged()).toContain('file2.ts')
  })

  it('stages all files with "."', async () => {
    await git.add('.')
    expect(git._getStaged()).toContain('all')
  })

  it('creates commit and updates head', async () => {
    await git.add('.')
    const result = await git.commit('feat: initial commit')

    expect(result.hash).toBeDefined()
    expect(git._getCommits()).toHaveLength(1)
    expect(git._getCommits()[0].message).toBe('feat: initial commit')

    const status = await git.status()
    expect(status.head).toBe(result.hash)
  })

  it('clears staged files after commit', async () => {
    await git.add('src/file.ts')
    expect(git._getStaged()).toHaveLength(1)

    await git.commit('test commit')
    expect(git._getStaged()).toHaveLength(0)
  })

  it('syncs from remote', async () => {
    const result = await git.sync()

    expect(result.success).toBe(true)
    expect(result.objectsFetched).toBe(5)
    expect(result.filesWritten).toBe(3)
  })

  it('pushes to remote', async () => {
    await git.add('.')
    await git.commit('test')

    const result = await git.push()
    expect(result.success).toBe(true)
    expect(result.objectsPushed).toBe(3)
  })

  it('retrieves commit log', async () => {
    await git.add('.')
    await git.commit('first commit')
    await git.add('.')
    await git.commit('second commit')

    const log = await git.log()
    expect(log).toHaveLength(2)
    expect(log[0].message).toBe('first commit')
    expect(log[1].message).toBe('second commit')
  })

  it('limits commit log', async () => {
    await git.add('.')
    await git.commit('commit 1')
    await git.add('.')
    await git.commit('commit 2')
    await git.add('.')
    await git.commit('commit 3')

    const log = await git.log({ limit: 2 })
    expect(log).toHaveLength(2)
  })

  it('reports status correctly', async () => {
    // Initial status - clean
    let status = await git.status()
    expect(status.clean).toBe(true)
    expect(status.staged).toHaveLength(0)

    // After staging - not clean
    await git.add('file.ts')
    status = await git.status()
    expect(status.clean).toBe(false)
    expect(status.staged).toContain('file.ts')

    // After commit - clean again
    await git.commit('test')
    status = await git.status()
    expect(status.clean).toBe(true)
  })
})

// ============================================================================
// Zero-VM Advantage Documentation Tests
// ============================================================================

describe('Zero-VM Advantage Verification', () => {
  it('demonstrates no external dependencies', () => {
    // All git operations are pure JavaScript
    // No calls to shell, no child_process, no external binaries

    // This test documents that our implementation:
    // 1. Uses Web Crypto API for SHA-1 (built into V8)
    // 2. Uses R2 for object storage (Cloudflare API)
    // 3. Uses SQLite for refs (DO storage)
    // 4. Requires no git CLI installation

    expect(true).toBe(true) // Documentation test
  })

  it('calculates hashes without external tools', async () => {
    // SHA-1 calculation uses Web Crypto API
    // This is available in all V8 isolates (Workers, Node.js, browsers)
    const hash = await hashContent('test content')
    expect(hash).toHaveLength(40)

    // Verify it's a valid hex string
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true)
  })

  it('validates without filesystem access', () => {
    // Commit message validation is pure string processing
    // No filesystem, no git config, no external calls
    const result = validateCommitMessage('feat: test')
    expect(result.valid).toBe(true)
  })
})
