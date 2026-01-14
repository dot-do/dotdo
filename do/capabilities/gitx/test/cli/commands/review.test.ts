import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  reviewCommand,
  getReviewDiff,
  listChangedFiles,
  getCommitRange,
  calculateSummary,
  createReviewUIState,
  handleArrowNavigation,
  toggleFileCollapse,
  handleVimNavigation,
  handleQuit,
  getKeyboardShortcuts,
  renderSplitView,
  renderUnifiedView,
  toggleViewMode,
  formatSummary,
  formatFileStats,
  handleNoChanges,
  hasChanges,
  type ReviewResult,
  type ReviewFile,
  type ReviewSummary,
  type CommitRange,
  type ReviewUIState,
  type KeyboardShortcut,
  type ReviewOptions
} from '../../../src/cli/commands/review'
import { createCLI, type CommandContext } from '../../../src/cli/index'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary git repository for testing
 */
async function createTestRepo(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-review-test-'))

  // Initialize minimal git structure
  const gitDir = path.join(tmpDir, '.git')
  await fs.mkdir(gitDir, { recursive: true })
  await fs.mkdir(path.join(gitDir, 'objects'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true })
  await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')

  // Create branch refs
  await fs.writeFile(
    path.join(gitDir, 'refs', 'heads', 'main'),
    'abc1234567890123456789012345678901234567\n'
  )
  await fs.writeFile(
    path.join(gitDir, 'refs', 'heads', 'feature'),
    'def1234567890123456789012345678901234567\n'
  )

  return tmpDir
}

/**
 * Clean up test repository
 */
async function cleanupTestRepo(repoPath: string): Promise<void> {
  await fs.rm(repoPath, { recursive: true, force: true })
}

/**
 * Create output capture for CLI tests
 */
function createOutputCapture() {
  const output: { stdout: string[]; stderr: string[] } = {
    stdout: [],
    stderr: []
  }

  return {
    output,
    stdout: (msg: string) => output.stdout.push(msg),
    stderr: (msg: string) => output.stderr.push(msg)
  }
}

/**
 * Create a mock command context
 */
function createMockContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    cwd: process.cwd(),
    args: [],
    options: {},
    rawArgs: [],
    stdout: () => {},
    stderr: () => {},
    ...overrides
  }
}

/**
 * Create mock review files for testing
 */
function createMockReviewFiles(): ReviewFile[] {
  return [
    {
      path: 'src/index.ts',
      status: 'modified',
      additions: 10,
      deletions: 5,
      collapsed: false,
      diff: '@@ -1,5 +1,10 @@\n-old line\n+new line'
    },
    {
      path: 'src/utils/helper.ts',
      status: 'added',
      additions: 25,
      deletions: 0,
      collapsed: false,
      diff: '@@ -0,0 +1,25 @@\n+export function helper() {}'
    },
    {
      path: 'src/old-file.ts',
      status: 'deleted',
      additions: 0,
      deletions: 50,
      collapsed: false,
      diff: '@@ -1,50 +0,0 @@\n-// deleted content'
    }
  ]
}

// ============================================================================
// Test Suites
// ============================================================================

describe('gitx review command', () => {
  let testRepoPath: string

  beforeEach(async () => {
    testRepoPath = await createTestRepo()
  })

  afterEach(async () => {
    await cleanupTestRepo(testRepoPath)
  })

  // ==========================================================================
  // Test 1: Shows diff between two branches (main..feature)
  // ==========================================================================
  describe('Diff between two branches (main..feature)', () => {
    it('should show diff between main and feature branch', async () => {
      const result = await getReviewDiff(testRepoPath, 'main', 'feature')

      expect(result).toBeDefined()
      expect(result.files).toBeInstanceOf(Array)
      expect(result.summary).toBeDefined()
      expect(result.commitRange).toBeDefined()
    })

    it('should parse branch..branch syntax correctly', async () => {
      const result = await getReviewDiff(testRepoPath, 'main', 'feature/new-ui')

      expect(result.commitRange.baseBranch).toBe('main')
      expect(result.commitRange.headBranch).toBe('feature/new-ui')
    })

    it('should resolve branch names to commit SHAs', async () => {
      const result = await getReviewDiff(testRepoPath, 'main', 'feature')

      expect(result.commitRange.baseCommit).toMatch(/^[a-f0-9]{40}$/)
      expect(result.commitRange.headCommit).toMatch(/^[a-f0-9]{40}$/)
    })

    it('should handle feature branches with slashes', async () => {
      const result = await getReviewDiff(testRepoPath, 'main', 'feature/user/auth')

      expect(result).toBeDefined()
      expect(result.commitRange.headBranch).toBe('feature/user/auth')
    })

    it('should work with remote branch references', async () => {
      const result = await getReviewDiff(testRepoPath, 'origin/main', 'feature')

      expect(result).toBeDefined()
      expect(result.commitRange.baseBranch).toBe('origin/main')
    })
  })

  // ==========================================================================
  // Test 2: Lists changed files with stats
  // ==========================================================================
  describe('Lists changed files with stats', () => {
    it('should list all changed files', async () => {
      const files = await listChangedFiles(testRepoPath, 'main', 'feature')

      expect(files).toBeInstanceOf(Array)
      expect(files.length).toBeGreaterThanOrEqual(0)
    })

    it('should include file path for each changed file', async () => {
      const files = await listChangedFiles(testRepoPath, 'main', 'feature')

      files.forEach(file => {
        expect(file.path).toBeDefined()
        expect(typeof file.path).toBe('string')
      })
    })

    it('should include addition count for each file', async () => {
      const files = await listChangedFiles(testRepoPath, 'main', 'feature')

      files.forEach(file => {
        expect(typeof file.additions).toBe('number')
        expect(file.additions).toBeGreaterThanOrEqual(0)
      })
    })

    it('should include deletion count for each file', async () => {
      const files = await listChangedFiles(testRepoPath, 'main', 'feature')

      files.forEach(file => {
        expect(typeof file.deletions).toBe('number')
        expect(file.deletions).toBeGreaterThanOrEqual(0)
      })
    })

    it('should include change status (added/modified/deleted/renamed)', async () => {
      const files = await listChangedFiles(testRepoPath, 'main', 'feature')

      const validStatuses = ['added', 'modified', 'deleted', 'renamed']
      files.forEach(file => {
        expect(validStatuses).toContain(file.status)
      })
    })

    it('should sort files by path', async () => {
      const files = await listChangedFiles(testRepoPath, 'main', 'feature')

      for (let i = 1; i < files.length; i++) {
        expect(files[i].path >= files[i - 1].path).toBe(true)
      }
    })

    it('should format file stats correctly', () => {
      const file: ReviewFile = {
        path: 'src/index.ts',
        status: 'modified',
        additions: 15,
        deletions: 8,
        collapsed: false,
        diff: ''
      }

      const formatted = formatFileStats(file)

      expect(formatted).toContain('src/index.ts')
      expect(formatted).toContain('+15')
      expect(formatted).toContain('-8')
    })
  })

  // ==========================================================================
  // Test 3: Interactive file navigation with arrow keys
  // ==========================================================================
  describe('Interactive file navigation with arrow keys', () => {
    it('should create initial UI state with first file selected', () => {
      const files = createMockReviewFiles()
      const state = createReviewUIState(files)

      expect(state.selectedIndex).toBe(0)
    })

    it('should move selection down with down arrow', () => {
      const files = createMockReviewFiles()
      let state = createReviewUIState(files)

      state = handleArrowNavigation(state, 'down', files.length)

      expect(state.selectedIndex).toBe(1)
    })

    it('should move selection up with up arrow', () => {
      const files = createMockReviewFiles()
      let state = createReviewUIState(files)
      state = { ...state, selectedIndex: 2 }

      state = handleArrowNavigation(state, 'up', files.length)

      expect(state.selectedIndex).toBe(1)
    })

    it('should not go below 0 when at first file', () => {
      const files = createMockReviewFiles()
      let state = createReviewUIState(files)

      state = handleArrowNavigation(state, 'up', files.length)

      expect(state.selectedIndex).toBe(0)
    })

    it('should not exceed file count when at last file', () => {
      const files = createMockReviewFiles()
      let state = createReviewUIState(files)
      state = { ...state, selectedIndex: files.length - 1 }

      state = handleArrowNavigation(state, 'down', files.length)

      expect(state.selectedIndex).toBe(files.length - 1)
    })

    it('should handle empty file list', () => {
      const state = createReviewUIState([])

      expect(state.selectedIndex).toBe(0)
    })
  })

  // ==========================================================================
  // Test 4: Collapse/expand file diffs with Enter
  // ==========================================================================
  describe('Collapse/expand file diffs with Enter', () => {
    it('should expand collapsed file on Enter', () => {
      const files = createMockReviewFiles()
      let state = createReviewUIState(files)
      state = { ...state, collapsedFiles: new Set([0]) }

      state = toggleFileCollapse(state, 0)

      expect(state.collapsedFiles.has(0)).toBe(false)
    })

    it('should collapse expanded file on Enter', () => {
      const files = createMockReviewFiles()
      let state = createReviewUIState(files)

      state = toggleFileCollapse(state, 0)

      expect(state.collapsedFiles.has(0)).toBe(true)
    })

    it('should toggle only the specified file', () => {
      const files = createMockReviewFiles()
      let state = createReviewUIState(files)
      state = { ...state, collapsedFiles: new Set([1]) }

      state = toggleFileCollapse(state, 0)

      expect(state.collapsedFiles.has(0)).toBe(true)
      expect(state.collapsedFiles.has(1)).toBe(true)
    })

    it('should preserve other UI state when toggling', () => {
      const files = createMockReviewFiles()
      let state = createReviewUIState(files)
      state = { ...state, selectedIndex: 2, scrollPosition: 100 }

      state = toggleFileCollapse(state, 0)

      expect(state.selectedIndex).toBe(2)
      expect(state.scrollPosition).toBe(100)
    })

    it('should start with all files expanded by default', () => {
      const files = createMockReviewFiles()
      const state = createReviewUIState(files)

      expect(state.collapsedFiles.size).toBe(0)
    })
  })

  // ==========================================================================
  // Test 5: Summary showing files changed, insertions, deletions
  // ==========================================================================
  describe('Summary showing files changed, insertions, deletions', () => {
    it('should calculate total files changed', () => {
      const files = createMockReviewFiles()
      const summary = calculateSummary(files)

      expect(summary.filesChanged).toBe(3)
    })

    it('should calculate total insertions', () => {
      const files = createMockReviewFiles()
      const summary = calculateSummary(files)

      expect(summary.insertions).toBe(35) // 10 + 25 + 0
    })

    it('should calculate total deletions', () => {
      const files = createMockReviewFiles()
      const summary = calculateSummary(files)

      expect(summary.deletions).toBe(55) // 5 + 0 + 50
    })

    it('should format summary display', () => {
      const summary: ReviewSummary = {
        filesChanged: 5,
        insertions: 100,
        deletions: 50
      }

      const formatted = formatSummary(summary)

      expect(formatted).toContain('5')
      expect(formatted).toContain('files')
      expect(formatted).toContain('+100')
      expect(formatted).toContain('-50')
    })

    it('should handle empty file list', () => {
      const summary = calculateSummary([])

      expect(summary.filesChanged).toBe(0)
      expect(summary.insertions).toBe(0)
      expect(summary.deletions).toBe(0)
    })

    it('should format singular file correctly', () => {
      const summary: ReviewSummary = {
        filesChanged: 1,
        insertions: 10,
        deletions: 5
      }

      const formatted = formatSummary(summary)

      expect(formatted).toContain('1')
      expect(formatted).toMatch(/file[^s]|file$/)
    })
  })

  // ==========================================================================
  // Test 6: Keyboard shortcuts (j/k for nav, q to quit)
  // ==========================================================================
  describe('Keyboard shortcuts (j/k for nav, q to quit)', () => {
    it('should move down with j key (vim navigation)', () => {
      const files = createMockReviewFiles()
      let state = createReviewUIState(files)

      state = handleVimNavigation(state, 'j', files.length)

      expect(state.selectedIndex).toBe(1)
    })

    it('should move up with k key (vim navigation)', () => {
      const files = createMockReviewFiles()
      let state = createReviewUIState(files)
      state = { ...state, selectedIndex: 2 }

      state = handleVimNavigation(state, 'k', files.length)

      expect(state.selectedIndex).toBe(1)
    })

    it('should handle q key to quit', () => {
      expect(() => handleQuit()).not.toThrow()
    })

    it('should provide list of keyboard shortcuts', () => {
      const shortcuts = getKeyboardShortcuts()

      expect(shortcuts).toBeInstanceOf(Array)
      expect(shortcuts.length).toBeGreaterThan(0)

      const shortcutKeys = shortcuts.map(s => s.key)
      expect(shortcutKeys).toContain('j')
      expect(shortcutKeys).toContain('k')
      expect(shortcutKeys).toContain('q')
    })

    it('should include arrow keys in shortcuts', () => {
      const shortcuts = getKeyboardShortcuts()
      const shortcutKeys = shortcuts.map(s => s.key)

      expect(shortcutKeys).toContain('up')
      expect(shortcutKeys).toContain('down')
    })

    it('should include Enter key in shortcuts', () => {
      const shortcuts = getKeyboardShortcuts()
      const shortcutKeys = shortcuts.map(s => s.key)

      expect(shortcutKeys).toContain('enter')
    })

    it('should have action descriptions for all shortcuts', () => {
      const shortcuts = getKeyboardShortcuts()

      shortcuts.forEach(shortcut => {
        expect(shortcut.action).toBeDefined()
        expect(typeof shortcut.action).toBe('string')
        expect(shortcut.action.length).toBeGreaterThan(0)
      })
    })
  })

  // ==========================================================================
  // Test 7: Split view for side-by-side comparison
  // ==========================================================================
  describe('Split view for side-by-side comparison', () => {
    it('should render split view with two columns', () => {
      const file: ReviewFile = {
        path: 'test.ts',
        status: 'modified',
        additions: 5,
        deletions: 3,
        collapsed: false,
        diff: '@@ -1,3 +1,5 @@\n-old line 1\n-old line 2\n context\n+new line 1\n+new line 2'
      }

      const output = renderSplitView(file, 120)

      expect(output).toBeInstanceOf(Array)
      expect(output.length).toBeGreaterThan(0)
    })

    it('should show old content on left side', () => {
      const file: ReviewFile = {
        path: 'test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        collapsed: false,
        diff: '@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;'
      }

      const output = renderSplitView(file, 120)
      const combinedOutput = output.join('\n')

      expect(combinedOutput).toContain('const x = 1')
    })

    it('should show new content on right side', () => {
      const file: ReviewFile = {
        path: 'test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        collapsed: false,
        diff: '@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;'
      }

      const output = renderSplitView(file, 120)
      const combinedOutput = output.join('\n')

      expect(combinedOutput).toContain('const x = 2')
    })

    it('should adapt column width to terminal size', () => {
      const file: ReviewFile = {
        path: 'test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        collapsed: false,
        diff: '@@ -1,1 +1,1 @@\n-old\n+new'
      }

      const narrowOutput = renderSplitView(file, 80)
      const wideOutput = renderSplitView(file, 160)

      // Wide output should have longer lines
      const narrowMaxLen = Math.max(...narrowOutput.map(l => l.length))
      const wideMaxLen = Math.max(...wideOutput.map(l => l.length))

      expect(wideMaxLen).toBeGreaterThan(narrowMaxLen)
    })

    it('should toggle between split and unified view', () => {
      let state: ReviewUIState = {
        selectedIndex: 0,
        collapsedFiles: new Set(),
        viewMode: 'unified',
        scrollPosition: 0
      }

      state = toggleViewMode(state)

      expect(state.viewMode).toBe('split')

      state = toggleViewMode(state)

      expect(state.viewMode).toBe('unified')
    })

    it('should render unified view correctly', () => {
      const file: ReviewFile = {
        path: 'test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        collapsed: false,
        diff: '@@ -1,1 +1,1 @@\n-old line\n+new line'
      }

      const output = renderUnifiedView(file)

      expect(output).toBeInstanceOf(Array)
      expect(output.some(line => line.includes('-old line') || line.includes('old line'))).toBe(true)
      expect(output.some(line => line.includes('+new line') || line.includes('new line'))).toBe(true)
    })
  })

  // ==========================================================================
  // Test 8: Shows commit range information
  // ==========================================================================
  describe('Shows commit range information', () => {
    it('should include base commit SHA', async () => {
      const range = await getCommitRange(testRepoPath, 'main', 'feature')

      expect(range.baseCommit).toBeDefined()
      expect(range.baseCommit).toMatch(/^[a-f0-9]{7,40}$/)
    })

    it('should include head commit SHA', async () => {
      const range = await getCommitRange(testRepoPath, 'main', 'feature')

      expect(range.headCommit).toBeDefined()
      expect(range.headCommit).toMatch(/^[a-f0-9]{7,40}$/)
    })

    it('should include branch names if applicable', async () => {
      const range = await getCommitRange(testRepoPath, 'main', 'feature')

      expect(range.baseBranch).toBe('main')
      expect(range.headBranch).toBe('feature')
    })

    it('should include commit count in range', async () => {
      const range = await getCommitRange(testRepoPath, 'main', 'feature')

      expect(typeof range.commitCount).toBe('number')
      expect(range.commitCount).toBeGreaterThanOrEqual(0)
    })

    it('should handle direct commit SHA references', async () => {
      const baseSha = 'abc1234567890123456789012345678901234567'
      const headSha = 'def1234567890123456789012345678901234567'

      const range = await getCommitRange(testRepoPath, baseSha, headSha)

      expect(range.baseCommit).toBe(baseSha)
      expect(range.headCommit).toBe(headSha)
    })

    it('should handle abbreviated SHAs', async () => {
      const range = await getCommitRange(testRepoPath, 'abc1234', 'def5678')

      expect(range).toBeDefined()
    })
  })

  // ==========================================================================
  // Test 9: Handles no changes between branches
  // ==========================================================================
  describe('Handles no changes between branches', () => {
    it('should detect when there are no changes', async () => {
      const hasChange = await hasChanges(testRepoPath, 'main', 'main')

      expect(hasChange).toBe(false)
    })

    it('should return appropriate message for no changes', () => {
      const message = handleNoChanges('main', 'feature')

      expect(message).toContain('main')
      expect(message).toContain('feature')
      expect(message.toLowerCase()).toContain('no')
    })

    it('should return empty file list when no changes', async () => {
      const result = await getReviewDiff(testRepoPath, 'main', 'main')

      expect(result.files).toHaveLength(0)
    })

    it('should return zero stats when no changes', async () => {
      const result = await getReviewDiff(testRepoPath, 'main', 'main')

      expect(result.summary.filesChanged).toBe(0)
      expect(result.summary.insertions).toBe(0)
      expect(result.summary.deletions).toBe(0)
    })

    it('should still show commit range for identical branches', async () => {
      const result = await getReviewDiff(testRepoPath, 'main', 'main')

      expect(result.commitRange).toBeDefined()
      expect(result.commitRange.baseCommit).toBe(result.commitRange.headCommit)
    })
  })

  // ==========================================================================
  // CLI Integration Tests
  // ==========================================================================
  describe('CLI Integration', () => {
    it('should register review command with CLI', async () => {
      const cli = createCLI()
      cli.registerCommand('review', reviewCommand)

      const result = await cli.run(['review', '--help'])

      expect(result.exitCode).toBe(0)
    })

    it('should accept base..head argument syntax', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let receivedContext: CommandContext | null = null
      cli.registerCommand('review', (ctx) => {
        receivedContext = ctx
      })

      await cli.run(['review', 'main..feature'])

      expect(receivedContext).toBeDefined()
      expect(receivedContext!.args).toContain('main..feature')
    })

    it('should accept --interactive flag', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let receivedContext: CommandContext | null = null
      cli.registerCommand('review', (ctx) => {
        receivedContext = ctx
      })

      await cli.run(['review', '--interactive'])

      expect(receivedContext).toBeDefined()
      expect(receivedContext!.options.interactive).toBe(true)
    })

    it('should throw Not implemented when executed', async () => {
      const ctx = createMockContext({ cwd: testRepoPath })

      await expect(reviewCommand(ctx)).rejects.toThrow('Not implemented')
    })
  })
})

// ============================================================================
// Module Export Tests
// ============================================================================

describe('Review Module Exports', () => {
  it('should export reviewCommand function', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.reviewCommand).toBe('function')
  })

  it('should export getReviewDiff function', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.getReviewDiff).toBe('function')
  })

  it('should export listChangedFiles function', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.listChangedFiles).toBe('function')
  })

  it('should export getCommitRange function', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.getCommitRange).toBe('function')
  })

  it('should export calculateSummary function', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.calculateSummary).toBe('function')
  })

  it('should export createReviewUIState function', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.createReviewUIState).toBe('function')
  })

  it('should export handleArrowNavigation function', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.handleArrowNavigation).toBe('function')
  })

  it('should export toggleFileCollapse function', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.toggleFileCollapse).toBe('function')
  })

  it('should export handleVimNavigation function', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.handleVimNavigation).toBe('function')
  })

  it('should export keyboard shortcut functions', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.handleQuit).toBe('function')
    expect(typeof module.getKeyboardShortcuts).toBe('function')
  })

  it('should export view rendering functions', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.renderSplitView).toBe('function')
    expect(typeof module.renderUnifiedView).toBe('function')
    expect(typeof module.toggleViewMode).toBe('function')
  })

  it('should export formatting functions', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.formatSummary).toBe('function')
    expect(typeof module.formatFileStats).toBe('function')
  })

  it('should export edge case handlers', async () => {
    const module = await import('../../../src/cli/commands/review')
    expect(typeof module.handleNoChanges).toBe('function')
    expect(typeof module.hasChanges).toBe('function')
  })

  it('should export ReviewResult type', async () => {
    const result: ReviewResult = {
      files: [],
      summary: { filesChanged: 0, insertions: 0, deletions: 0 },
      commitRange: {
        baseCommit: 'abc',
        headCommit: 'def',
        commitCount: 0
      }
    }
    expect(result.files).toHaveLength(0)
  })

  it('should export ReviewFile type', async () => {
    const file: ReviewFile = {
      path: 'test.ts',
      status: 'modified',
      additions: 10,
      deletions: 5,
      collapsed: false,
      diff: ''
    }
    expect(file.path).toBe('test.ts')
  })

  it('should export ReviewSummary type', async () => {
    const summary: ReviewSummary = {
      filesChanged: 1,
      insertions: 10,
      deletions: 5
    }
    expect(summary.filesChanged).toBe(1)
  })

  it('should export CommitRange type', async () => {
    const range: CommitRange = {
      baseCommit: 'abc123',
      headCommit: 'def456',
      commitCount: 5
    }
    expect(range.commitCount).toBe(5)
  })

  it('should export ReviewUIState type', async () => {
    const state: ReviewUIState = {
      selectedIndex: 0,
      collapsedFiles: new Set(),
      viewMode: 'unified',
      scrollPosition: 0
    }
    expect(state.viewMode).toBe('unified')
  })

  it('should export KeyboardShortcut type', async () => {
    const shortcut: KeyboardShortcut = {
      key: 'j',
      action: 'Move down',
      handler: () => {}
    }
    expect(shortcut.key).toBe('j')
  })
})
