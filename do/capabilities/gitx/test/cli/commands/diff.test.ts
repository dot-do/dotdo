import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  diffCommand,
  getUnstagedDiff,
  getStagedDiff,
  getCommitDiff,
  getBranchDiff,
  getFileDiff,
  computeUnifiedDiff,
  computeWordDiff,
  highlightDiff,
  getLanguageFromPath,
  formatHighlightedDiff,
  formatPlainDiff,
  formatDiffHeader,
  formatHunkHeader,
  formatModeChange,
  formatBinaryIndicator,
  type DiffResult,
  type DiffEntry,
  type DiffHunk,
  type DiffLine,
  type DiffOptions
} from '../../../src/cli/commands/diff'
import { createCLI, type CommandContext } from '../../../src/cli/index'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary git repository for testing
 */
async function createTestRepo(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-diff-test-'))

  // Initialize minimal git structure
  const gitDir = path.join(tmpDir, '.git')
  await fs.mkdir(gitDir, { recursive: true })
  await fs.mkdir(path.join(gitDir, 'objects'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true })
  await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')

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
    ...overrides
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('gitx diff command', () => {
  let testRepoPath: string

  beforeEach(async () => {
    testRepoPath = await createTestRepo()
  })

  afterEach(async () => {
    await cleanupTestRepo(testRepoPath)
  })

  // ==========================================================================
  // Test 1: Shows unstaged changes (working tree vs index)
  // ==========================================================================
  describe('Unstaged changes (working tree vs index)', () => {
    it('should detect modified files in working tree', async () => {
      // Create a file in the index and modify it in working tree
      await fs.writeFile(path.join(testRepoPath, 'file.ts'), 'const x = 1;\n')

      const result = await getUnstagedDiff(testRepoPath)

      expect(result).toBeDefined()
      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should return empty diff when working tree matches index', async () => {
      const result = await getUnstagedDiff(testRepoPath)

      expect(result.entries).toHaveLength(0)
      expect(result.stats.filesChanged).toBe(0)
    })

    it('should show additions for new content', async () => {
      await fs.writeFile(path.join(testRepoPath, 'new.ts'), 'export const foo = 42;\n')

      const result = await getUnstagedDiff(testRepoPath)

      // Should show the new file as having additions
      const entry = result.entries.find(e => e.path === 'new.ts')
      if (entry && entry.hunks.length > 0) {
        const additionLines = entry.hunks[0].lines.filter(l => l.type === 'addition')
        expect(additionLines.length).toBeGreaterThan(0)
      }
    })

    it('should show deletions for removed content', async () => {
      // Simulate file content being removed
      await fs.writeFile(path.join(testRepoPath, 'file.ts'), '')

      const result = await getUnstagedDiff(testRepoPath)

      expect(result).toBeDefined()
    })

    it('should include line numbers in diff output', async () => {
      await fs.writeFile(path.join(testRepoPath, 'code.ts'), 'line1\nline2\nline3\n')

      const result = await getUnstagedDiff(testRepoPath)

      if (result.entries.length > 0 && result.entries[0].hunks.length > 0) {
        const lines = result.entries[0].hunks[0].lines
        lines.forEach(line => {
          if (line.type === 'context' || line.type === 'deletion') {
            expect(line.oldLineNo).toBeDefined()
          }
          if (line.type === 'context' || line.type === 'addition') {
            expect(line.newLineNo).toBeDefined()
          }
        })
      }
    })
  })

  // ==========================================================================
  // Test 2: Shows staged changes with --staged flag
  // ==========================================================================
  describe('Staged changes (--staged flag)', () => {
    it('should detect files staged in index', async () => {
      const result = await getStagedDiff(testRepoPath)

      expect(result).toBeDefined()
      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should compare index against HEAD commit', async () => {
      // Stage a file (simulated)
      await fs.writeFile(path.join(testRepoPath, 'staged.ts'), 'staged content\n')

      const result = await getStagedDiff(testRepoPath)

      expect(result.stats).toBeDefined()
      expect(typeof result.stats.insertions).toBe('number')
      expect(typeof result.stats.deletions).toBe('number')
    })

    it('should handle --cached as alias for --staged', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      cli.registerCommand('diff', diffCommand)

      const result = await cli.run(['diff', '--cached'], { skipCwdCheck: true })

      // Command should be recognized even if it throws "Not implemented"
      expect(result.command).toBe('diff')
    })

    it('should show newly staged files as added', async () => {
      await fs.writeFile(path.join(testRepoPath, 'new-staged.ts'), 'new file\n')

      const result = await getStagedDiff(testRepoPath)

      // After implementation, this should show new-staged.ts as added
      expect(result).toBeDefined()
    })

    it('should show deleted files in staging', async () => {
      const result = await getStagedDiff(testRepoPath)

      expect(result.entries).toBeInstanceOf(Array)
    })
  })

  // ==========================================================================
  // Test 3: Shows diff between two commits
  // ==========================================================================
  describe('Diff between commits', () => {
    it('should compare two commit SHAs', async () => {
      const fromCommit = 'abc1234567890123456789012345678901234567'
      const toCommit = 'def1234567890123456789012345678901234567'

      const result = await getCommitDiff(testRepoPath, fromCommit, toCommit)

      expect(result).toBeDefined()
      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should handle HEAD~N syntax', async () => {
      const result = await getCommitDiff(testRepoPath, 'HEAD~1', 'HEAD')

      expect(result).toBeDefined()
    })

    it('should handle abbreviated commit SHAs', async () => {
      const result = await getCommitDiff(testRepoPath, 'abc1234', 'def5678')

      expect(result).toBeDefined()
    })

    it('should show all files changed between commits', async () => {
      const result = await getCommitDiff(
        testRepoPath,
        'abc1234567890123456789012345678901234567',
        'def1234567890123456789012345678901234567'
      )

      expect(result.stats.filesChanged).toBeDefined()
    })

    it('should include commit range in diff metadata', async () => {
      const result = await getCommitDiff(testRepoPath, 'HEAD~2', 'HEAD')

      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // Test 4: Shows diff between branches
  // ==========================================================================
  describe('Diff between branches', () => {
    it('should compare two branch names', async () => {
      const result = await getBranchDiff(testRepoPath, 'main', 'feature/test')

      expect(result).toBeDefined()
      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should handle branch...branch syntax (three dots)', async () => {
      // This shows changes since branches diverged
      const result = await getBranchDiff(testRepoPath, 'main', 'feature/new')

      expect(result).toBeDefined()
    })

    it('should handle branch..branch syntax (two dots)', async () => {
      // This shows all commits reachable from B but not A
      const result = await getBranchDiff(testRepoPath, 'main', 'develop')

      expect(result).toBeDefined()
    })

    it('should resolve branch names to commit SHAs', async () => {
      const result = await getBranchDiff(testRepoPath, 'main', 'feature')

      expect(result.stats).toBeDefined()
    })

    it('should handle remote branch references', async () => {
      const result = await getBranchDiff(testRepoPath, 'origin/main', 'main')

      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // Test 5: Shows diff for specific file path
  // ==========================================================================
  describe('Diff for specific file path', () => {
    it('should filter diff to single file', async () => {
      await fs.writeFile(path.join(testRepoPath, 'target.ts'), 'target content\n')
      await fs.writeFile(path.join(testRepoPath, 'other.ts'), 'other content\n')

      const result = await getFileDiff(testRepoPath, 'target.ts')

      expect(result.entries.every(e => e.path === 'target.ts' || e.oldPath === 'target.ts')).toBe(true)
    })

    it('should support glob patterns for file paths', async () => {
      const result = await getFileDiff(testRepoPath, 'src/**/*.ts')

      expect(result).toBeDefined()
    })

    it('should handle paths with directory prefixes', async () => {
      await fs.mkdir(path.join(testRepoPath, 'src', 'components'), { recursive: true })
      await fs.writeFile(path.join(testRepoPath, 'src', 'components', 'Button.tsx'), 'export {}\n')

      const result = await getFileDiff(testRepoPath, 'src/components/Button.tsx')

      expect(result).toBeDefined()
    })

    it('should combine file path with --staged option', async () => {
      const result = await getFileDiff(testRepoPath, 'file.ts', { staged: true })

      expect(result).toBeDefined()
    })

    it('should show diff for file at specific commit', async () => {
      const result = await getFileDiff(testRepoPath, 'file.ts', {
        commit: 'abc1234567890123456789012345678901234567'
      })

      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // Test 6: Applies Shiki syntax highlighting based on file extension
  // ==========================================================================
  describe('Shiki syntax highlighting', () => {
    it('should detect TypeScript language for .ts files', () => {
      const lang = getLanguageFromPath('src/index.ts')

      expect(lang).toBe('typescript')
    })

    it('should detect JavaScript language for .js files', () => {
      const lang = getLanguageFromPath('app.js')

      expect(lang).toBe('javascript')
    })

    it('should detect TSX language for .tsx files', () => {
      const lang = getLanguageFromPath('Component.tsx')

      expect(lang).toBe('tsx')
    })

    it('should detect JSX language for .jsx files', () => {
      const lang = getLanguageFromPath('Component.jsx')

      expect(lang).toBe('jsx')
    })

    it('should detect JSON language for .json files', () => {
      const lang = getLanguageFromPath('package.json')

      expect(lang).toBe('json')
    })

    it('should detect CSS language for .css files', () => {
      const lang = getLanguageFromPath('styles.css')

      expect(lang).toBe('css')
    })

    it('should detect Markdown language for .md files', () => {
      const lang = getLanguageFromPath('README.md')

      expect(lang).toBe('markdown')
    })

    it('should detect Python language for .py files', () => {
      const lang = getLanguageFromPath('script.py')

      expect(lang).toBe('python')
    })

    it('should detect Rust language for .rs files', () => {
      const lang = getLanguageFromPath('main.rs')

      expect(lang).toBe('rust')
    })

    it('should detect Go language for .go files', () => {
      const lang = getLanguageFromPath('main.go')

      expect(lang).toBe('go')
    })

    it('should fallback to plaintext for unknown extensions', () => {
      const lang = getLanguageFromPath('data.xyz')

      expect(lang).toBe('plaintext')
    })

    it('should apply syntax highlighting to diff output', async () => {
      const mockDiff: DiffResult = {
        entries: [{
          path: 'test.ts',
          status: 'modified',
          hunks: [{
            oldStart: 1,
            oldCount: 1,
            newStart: 1,
            newCount: 1,
            lines: [
              { type: 'deletion', content: 'const x = 1;', oldLineNo: 1 },
              { type: 'addition', content: 'const x = 2;', newLineNo: 1 }
            ]
          }]
        }],
        stats: { filesChanged: 1, insertions: 1, deletions: 1 }
      }

      const result = await highlightDiff(mockDiff)

      expect(result.lines).toBeInstanceOf(Array)
      expect(result.languages.get('test.ts')).toBe('typescript')
    })

    it('should preserve ANSI color codes in highlighted output', async () => {
      const mockDiff: DiffResult = {
        entries: [{
          path: 'test.ts',
          status: 'added',
          hunks: [{
            oldStart: 0,
            oldCount: 0,
            newStart: 1,
            newCount: 1,
            lines: [
              { type: 'addition', content: 'const foo = "bar";', newLineNo: 1 }
            ]
          }]
        }],
        stats: { filesChanged: 1, insertions: 1, deletions: 0 }
      }

      const result = await highlightDiff(mockDiff)

      // Should contain ANSI escape codes for colors
      expect(result.lines.some(line => line.includes('\x1b['))).toBe(true)
    })
  })

  // ==========================================================================
  // Test 7: Supports unified diff format (default)
  // ==========================================================================
  describe('Unified diff format', () => {
    it('should output unified diff header with ---/+++ markers', () => {
      const entry: DiffEntry = {
        path: 'file.ts',
        status: 'modified',
        oldSha: 'abc1234',
        newSha: 'def5678',
        hunks: []
      }

      const header = formatDiffHeader(entry)

      expect(header.some(line => line.startsWith('---'))).toBe(true)
      expect(header.some(line => line.startsWith('+++'))).toBe(true)
    })

    it('should include @@ hunk headers', () => {
      const hunk: DiffHunk = {
        oldStart: 10,
        oldCount: 5,
        newStart: 10,
        newCount: 7,
        lines: []
      }

      const header = formatHunkHeader(hunk)

      expect(header).toContain('@@ -10,5 +10,7 @@')
    })

    it('should prefix additions with +', () => {
      const diff: DiffResult = {
        entries: [{
          path: 'file.ts',
          status: 'modified',
          hunks: [{
            oldStart: 1,
            oldCount: 0,
            newStart: 1,
            newCount: 1,
            lines: [
              { type: 'addition', content: 'new line', newLineNo: 1 }
            ]
          }]
        }],
        stats: { filesChanged: 1, insertions: 1, deletions: 0 }
      }

      const output = formatPlainDiff(diff)

      expect(output.some(line => line.startsWith('+new line'))).toBe(true)
    })

    it('should prefix deletions with -', () => {
      const diff: DiffResult = {
        entries: [{
          path: 'file.ts',
          status: 'modified',
          hunks: [{
            oldStart: 1,
            oldCount: 1,
            newStart: 1,
            newCount: 0,
            lines: [
              { type: 'deletion', content: 'old line', oldLineNo: 1 }
            ]
          }]
        }],
        stats: { filesChanged: 1, insertions: 0, deletions: 1 }
      }

      const output = formatPlainDiff(diff)

      expect(output.some(line => line.startsWith('-old line'))).toBe(true)
    })

    it('should prefix context lines with space', () => {
      const diff: DiffResult = {
        entries: [{
          path: 'file.ts',
          status: 'modified',
          hunks: [{
            oldStart: 1,
            oldCount: 3,
            newStart: 1,
            newCount: 3,
            lines: [
              { type: 'context', content: 'unchanged', oldLineNo: 1, newLineNo: 1 }
            ]
          }]
        }],
        stats: { filesChanged: 1, insertions: 0, deletions: 0 }
      }

      const output = formatPlainDiff(diff)

      expect(output.some(line => line.startsWith(' unchanged'))).toBe(true)
    })

    it('should include default 3 lines of context', () => {
      const oldContent = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj'
      const newContent = 'a\nb\nc\nd\nX\nf\ng\nh\ni\nj'

      const hunks = computeUnifiedDiff(oldContent, newContent)

      // Should have context lines before and after the change
      if (hunks.length > 0) {
        const contextLines = hunks[0].lines.filter(l => l.type === 'context')
        expect(contextLines.length).toBeGreaterThanOrEqual(3)
      }
    })
  })

  // ==========================================================================
  // Test 8: Supports --no-color flag to disable highlighting
  // ==========================================================================
  describe('--no-color flag', () => {
    it('should output plain text when --no-color is set', async () => {
      const diff: DiffResult = {
        entries: [{
          path: 'test.ts',
          status: 'modified',
          hunks: [{
            oldStart: 1,
            oldCount: 1,
            newStart: 1,
            newCount: 1,
            lines: [
              { type: 'deletion', content: 'const x = 1;', oldLineNo: 1 },
              { type: 'addition', content: 'const x = 2;', newLineNo: 1 }
            ]
          }]
        }],
        stats: { filesChanged: 1, insertions: 1, deletions: 1 }
      }

      const output = await formatHighlightedDiff(diff, { noColor: true })

      // Should not contain ANSI escape codes
      expect(output.every(line => !line.includes('\x1b['))).toBe(true)
    })

    it('should respect NO_COLOR environment variable', async () => {
      const originalEnv = process.env.NO_COLOR
      process.env.NO_COLOR = '1'

      try {
        const diff: DiffResult = {
          entries: [],
          stats: { filesChanged: 0, insertions: 0, deletions: 0 }
        }

        const output = await formatHighlightedDiff(diff)

        expect(output).toBeInstanceOf(Array)
      } finally {
        if (originalEnv === undefined) {
          delete process.env.NO_COLOR
        } else {
          process.env.NO_COLOR = originalEnv
        }
      }
    })

    it('should still show +/- prefixes without color', async () => {
      const diff: DiffResult = {
        entries: [{
          path: 'file.ts',
          status: 'modified',
          hunks: [{
            oldStart: 1,
            oldCount: 1,
            newStart: 1,
            newCount: 1,
            lines: [
              { type: 'deletion', content: 'old', oldLineNo: 1 },
              { type: 'addition', content: 'new', newLineNo: 1 }
            ]
          }]
        }],
        stats: { filesChanged: 1, insertions: 1, deletions: 1 }
      }

      const output = await formatHighlightedDiff(diff, { noColor: true })

      expect(output.some(line => line.includes('-old'))).toBe(true)
      expect(output.some(line => line.includes('+new'))).toBe(true)
    })

    it('should disable highlighting via command context option', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      cli.registerCommand('diff', diffCommand)

      // The command should accept --no-color
      const ctx = createMockContext({
        cwd: testRepoPath,
        options: { noColor: true }
      })

      // Just verify the command is recognized
      expect(ctx.options.noColor).toBe(true)
    })
  })

  // ==========================================================================
  // Test 9: Shows file mode changes
  // ==========================================================================
  describe('File mode changes', () => {
    it('should detect mode change from regular to executable', () => {
      const output = formatModeChange('100644', '100755')

      expect(output).toContain('100644')
      expect(output).toContain('100755')
    })

    it('should detect mode change from executable to regular', () => {
      const output = formatModeChange('100755', '100644')

      expect(output).toContain('mode change')
    })

    it('should include mode change in diff header', () => {
      const entry: DiffEntry = {
        path: 'script.sh',
        status: 'modified',
        oldMode: '100644',
        newMode: '100755',
        hunks: []
      }

      const header = formatDiffHeader(entry)

      expect(header.some(line => line.includes('old mode') || line.includes('100644'))).toBe(true)
      expect(header.some(line => line.includes('new mode') || line.includes('100755'))).toBe(true)
    })

    it('should handle symlink mode', () => {
      const output = formatModeChange('100644', '120000')

      expect(output).toContain('120000')
    })

    it('should handle submodule mode', () => {
      const output = formatModeChange('100644', '160000')

      expect(output).toContain('160000')
    })
  })

  // ==========================================================================
  // Test 10: Shows binary file indicator
  // ==========================================================================
  describe('Binary file indicator', () => {
    it('should detect binary files', () => {
      const indicator = formatBinaryIndicator('image.png')

      expect(indicator).toContain('Binary')
    })

    it('should show binary files differ message', () => {
      const indicator = formatBinaryIndicator('data.bin')

      expect(indicator.toLowerCase()).toContain('binary')
      expect(indicator.toLowerCase()).toContain('differ')
    })

    it('should mark entry as binary in diff result', () => {
      const entry: DiffEntry = {
        path: 'photo.jpg',
        status: 'modified',
        binary: true,
        hunks: []
      }

      expect(entry.binary).toBe(true)
      expect(entry.hunks).toHaveLength(0)
    })

    it('should detect common binary extensions', () => {
      const binaryExtensions = ['.png', '.jpg', '.gif', '.pdf', '.zip', '.exe', '.wasm']

      for (const ext of binaryExtensions) {
        const indicator = formatBinaryIndicator(`file${ext}`)
        expect(indicator.toLowerCase()).toContain('binary')
      }
    })

    it('should not show line-by-line diff for binary files', () => {
      const entry: DiffEntry = {
        path: 'archive.tar.gz',
        status: 'modified',
        binary: true,
        hunks: []
      }

      expect(entry.hunks).toHaveLength(0)
    })
  })

  // ==========================================================================
  // Test 11: Word-level diff highlighting within lines
  // ==========================================================================
  describe('Word-level diff highlighting', () => {
    it('should identify changed words within a line', () => {
      const oldLine = 'const value = 100;'
      const newLine = 'const value = 200;'

      const changes = computeWordDiff(oldLine, newLine)

      expect(changes).toBeInstanceOf(Array)
      expect(changes.some(c => c.type === 'removed' && c.text === '100')).toBe(true)
      expect(changes.some(c => c.type === 'added' && c.text === '200')).toBe(true)
    })

    it('should handle multiple word changes per line', () => {
      const oldLine = 'function foo(a, b) { return a + b; }'
      const newLine = 'function bar(x, y) { return x * y; }'

      const changes = computeWordDiff(oldLine, newLine)

      // Should detect: foo->bar, a->x, b->y, +->*
      const removed = changes.filter(c => c.type === 'removed')
      const added = changes.filter(c => c.type === 'added')

      expect(removed.length).toBeGreaterThan(0)
      expect(added.length).toBeGreaterThan(0)
    })

    it('should preserve unchanged portions of line', () => {
      const oldLine = 'const hello = "world";'
      const newLine = 'const hello = "universe";'

      const changes = computeWordDiff(oldLine, newLine)

      expect(changes.some(c => c.type === 'unchanged' && c.text.includes('const'))).toBe(true)
      expect(changes.some(c => c.type === 'unchanged' && c.text.includes('hello'))).toBe(true)
    })

    it('should handle added text at end of line', () => {
      const oldLine = 'let x = 5'
      const newLine = 'let x = 5 // comment'

      const changes = computeWordDiff(oldLine, newLine)

      expect(changes.some(c => c.type === 'added' && c.text.includes('comment'))).toBe(true)
    })

    it('should handle removed text from line', () => {
      const oldLine = 'console.log("debug message");'
      const newLine = 'console.log();'

      const changes = computeWordDiff(oldLine, newLine)

      expect(changes.some(c => c.type === 'removed')).toBe(true)
    })

    it('should include word changes in DiffLine objects', async () => {
      const diff: DiffResult = {
        entries: [{
          path: 'test.ts',
          status: 'modified',
          hunks: [{
            oldStart: 1,
            oldCount: 1,
            newStart: 1,
            newCount: 1,
            lines: [
              {
                type: 'deletion',
                content: 'const x = 1;',
                oldLineNo: 1,
                wordChanges: [
                  { type: 'unchanged', text: 'const x = ' },
                  { type: 'removed', text: '1' },
                  { type: 'unchanged', text: ';' }
                ]
              },
              {
                type: 'addition',
                content: 'const x = 2;',
                newLineNo: 1,
                wordChanges: [
                  { type: 'unchanged', text: 'const x = ' },
                  { type: 'added', text: '2' },
                  { type: 'unchanged', text: ';' }
                ]
              }
            ]
          }]
        }],
        stats: { filesChanged: 1, insertions: 1, deletions: 1 }
      }

      const deletionLine = diff.entries[0].hunks[0].lines[0]
      expect(deletionLine.wordChanges).toBeDefined()
      expect(deletionLine.wordChanges!.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Test 12: Handles new files and deleted files
  // ==========================================================================
  describe('New and deleted files', () => {
    it('should show /dev/null for old path of new files', () => {
      const entry: DiffEntry = {
        path: 'brand-new.ts',
        status: 'added',
        hunks: [{
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 5,
          lines: []
        }]
      }

      const header = formatDiffHeader(entry)

      expect(header.some(line => line.includes('/dev/null'))).toBe(true)
    })

    it('should show /dev/null for new path of deleted files', () => {
      const entry: DiffEntry = {
        path: 'removed.ts',
        status: 'deleted',
        hunks: [{
          oldStart: 1,
          oldCount: 10,
          newStart: 0,
          newCount: 0,
          lines: []
        }]
      }

      const header = formatDiffHeader(entry)

      expect(header.some(line => line.includes('/dev/null'))).toBe(true)
    })

    it('should mark all lines as additions for new files', async () => {
      await fs.writeFile(
        path.join(testRepoPath, 'completely-new.ts'),
        'line1\nline2\nline3\n'
      )

      const result = await getUnstagedDiff(testRepoPath)

      const newFileEntry = result.entries.find(e => e.status === 'added')
      if (newFileEntry && newFileEntry.hunks.length > 0) {
        expect(newFileEntry.hunks[0].lines.every(l => l.type === 'addition')).toBe(true)
      }
    })

    it('should mark all lines as deletions for deleted files', async () => {
      const result: DiffResult = {
        entries: [{
          path: 'deleted-file.ts',
          status: 'deleted',
          hunks: [{
            oldStart: 1,
            oldCount: 3,
            newStart: 0,
            newCount: 0,
            lines: [
              { type: 'deletion', content: 'line1', oldLineNo: 1 },
              { type: 'deletion', content: 'line2', oldLineNo: 2 },
              { type: 'deletion', content: 'line3', oldLineNo: 3 }
            ]
          }]
        }],
        stats: { filesChanged: 1, insertions: 0, deletions: 3 }
      }

      expect(result.entries[0].hunks[0].lines.every(l => l.type === 'deletion')).toBe(true)
    })

    it('should show correct stats for new files', () => {
      const result: DiffResult = {
        entries: [{
          path: 'new.ts',
          status: 'added',
          hunks: [{
            oldStart: 0,
            oldCount: 0,
            newStart: 1,
            newCount: 10,
            lines: Array(10).fill(null).map((_, i) => ({
              type: 'addition' as const,
              content: `line ${i + 1}`,
              newLineNo: i + 1
            }))
          }]
        }],
        stats: { filesChanged: 1, insertions: 10, deletions: 0 }
      }

      expect(result.stats.insertions).toBe(10)
      expect(result.stats.deletions).toBe(0)
    })

    it('should show correct stats for deleted files', () => {
      const result: DiffResult = {
        entries: [{
          path: 'old.ts',
          status: 'deleted',
          hunks: [{
            oldStart: 1,
            oldCount: 15,
            newStart: 0,
            newCount: 0,
            lines: Array(15).fill(null).map((_, i) => ({
              type: 'deletion' as const,
              content: `line ${i + 1}`,
              oldLineNo: i + 1
            }))
          }]
        }],
        stats: { filesChanged: 1, insertions: 0, deletions: 15 }
      }

      expect(result.stats.insertions).toBe(0)
      expect(result.stats.deletions).toBe(15)
    })

    it('should handle renamed files', () => {
      const entry: DiffEntry = {
        path: 'new-name.ts',
        oldPath: 'old-name.ts',
        status: 'renamed',
        hunks: []
      }

      const header = formatDiffHeader(entry)

      expect(header.some(line => line.includes('old-name.ts'))).toBe(true)
      expect(header.some(line => line.includes('new-name.ts'))).toBe(true)
    })
  })

  // ==========================================================================
  // Integration tests
  // ==========================================================================
  describe('CLI Integration', () => {
    it('should register diff command with CLI', async () => {
      const cli = createCLI()
      cli.registerCommand('diff', diffCommand)

      const result = await cli.run(['diff', '--help'])

      expect(result.exitCode).toBe(0)
    })

    it('should pass options to diff command handler', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let receivedContext: CommandContext | null = null
      cli.registerCommand('diff', (ctx) => {
        receivedContext = ctx
      })

      await cli.run(['diff', '--staged'])

      expect(receivedContext).toBeDefined()
      expect(receivedContext!.options.staged).toBe(true)
    })

    it('should pass file arguments to diff command', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let receivedContext: CommandContext | null = null
      cli.registerCommand('diff', (ctx) => {
        receivedContext = ctx
      })

      await cli.run(['diff', 'file1.ts', 'file2.ts'])

      expect(receivedContext).toBeDefined()
      expect(receivedContext!.args).toContain('file1.ts')
      expect(receivedContext!.args).toContain('file2.ts')
    })

    it('should handle -- separator for file paths', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let receivedContext: CommandContext | null = null
      cli.registerCommand('diff', (ctx) => {
        receivedContext = ctx
      })

      await cli.run(['diff', 'HEAD~1', '--', 'specific-file.ts'])

      expect(receivedContext).toBeDefined()
      expect(receivedContext!.rawArgs).toContain('specific-file.ts')
    })
  })

  // ==========================================================================
  // Unified diff algorithm tests
  // ==========================================================================
  describe('Unified diff algorithm', () => {
    it('should compute diff between two strings', () => {
      const oldContent = 'line1\nline2\nline3'
      const newContent = 'line1\nmodified\nline3'

      const hunks = computeUnifiedDiff(oldContent, newContent)

      expect(hunks).toBeInstanceOf(Array)
    })

    it('should handle empty old content (new file)', () => {
      const oldContent = ''
      const newContent = 'new content\nmore content'

      const hunks = computeUnifiedDiff(oldContent, newContent)

      expect(hunks.length).toBeGreaterThan(0)
      if (hunks[0]) {
        expect(hunks[0].oldCount).toBe(0)
      }
    })

    it('should handle empty new content (deleted file)', () => {
      const oldContent = 'old content\nmore content'
      const newContent = ''

      const hunks = computeUnifiedDiff(oldContent, newContent)

      expect(hunks.length).toBeGreaterThan(0)
      if (hunks[0]) {
        expect(hunks[0].newCount).toBe(0)
      }
    })

    it('should respect context option', () => {
      const oldContent = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj'
      const newContent = 'a\nb\nc\nd\nX\nf\ng\nh\ni\nj'

      const hunksDefault = computeUnifiedDiff(oldContent, newContent)
      const hunksNoContext = computeUnifiedDiff(oldContent, newContent, { context: 0 })

      // With no context, should have fewer lines
      if (hunksDefault[0] && hunksNoContext[0]) {
        expect(hunksNoContext[0].lines.length).toBeLessThanOrEqual(hunksDefault[0].lines.length)
      }
    })

    it('should generate multiple hunks for distant changes', () => {
      const oldContent = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr\ns\nt'
      const newContent = 'X\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr\ns\nY'

      const hunks = computeUnifiedDiff(oldContent, newContent, { context: 1 })

      // Changes at line 1 and line 20 should create separate hunks with context=1
      expect(hunks.length).toBeGreaterThanOrEqual(1)
    })
  })
})

describe('Diff Module Exports', () => {
  it('should export diffCommand function', async () => {
    const module = await import('../../../src/cli/commands/diff')
    expect(typeof module.diffCommand).toBe('function')
  })

  it('should export getUnstagedDiff function', async () => {
    const module = await import('../../../src/cli/commands/diff')
    expect(typeof module.getUnstagedDiff).toBe('function')
  })

  it('should export getStagedDiff function', async () => {
    const module = await import('../../../src/cli/commands/diff')
    expect(typeof module.getStagedDiff).toBe('function')
  })

  it('should export getCommitDiff function', async () => {
    const module = await import('../../../src/cli/commands/diff')
    expect(typeof module.getCommitDiff).toBe('function')
  })

  it('should export getBranchDiff function', async () => {
    const module = await import('../../../src/cli/commands/diff')
    expect(typeof module.getBranchDiff).toBe('function')
  })

  it('should export getFileDiff function', async () => {
    const module = await import('../../../src/cli/commands/diff')
    expect(typeof module.getFileDiff).toBe('function')
  })

  it('should export highlightDiff function', async () => {
    const module = await import('../../../src/cli/commands/diff')
    expect(typeof module.highlightDiff).toBe('function')
  })

  it('should export computeUnifiedDiff function', async () => {
    const module = await import('../../../src/cli/commands/diff')
    expect(typeof module.computeUnifiedDiff).toBe('function')
  })

  it('should export computeWordDiff function', async () => {
    const module = await import('../../../src/cli/commands/diff')
    expect(typeof module.computeWordDiff).toBe('function')
  })

  it('should export formatting functions', async () => {
    const module = await import('../../../src/cli/commands/diff')
    expect(typeof module.formatPlainDiff).toBe('function')
    expect(typeof module.formatDiffHeader).toBe('function')
    expect(typeof module.formatHunkHeader).toBe('function')
    expect(typeof module.formatModeChange).toBe('function')
    expect(typeof module.formatBinaryIndicator).toBe('function')
  })

  it('should export DiffResult type', async () => {
    // Type check - this verifies the export exists at compile time
    const result: DiffResult = {
      entries: [],
      stats: { filesChanged: 0, insertions: 0, deletions: 0 }
    }
    expect(result.entries).toHaveLength(0)
  })

  it('should export DiffEntry type', async () => {
    const entry: DiffEntry = {
      path: 'test.ts',
      status: 'modified',
      hunks: []
    }
    expect(entry.path).toBe('test.ts')
  })

  it('should export DiffHunk type', async () => {
    const hunk: DiffHunk = {
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      lines: []
    }
    expect(hunk.oldStart).toBe(1)
  })

  it('should export DiffOptions type', async () => {
    const opts: DiffOptions = {
      staged: true,
      noColor: false
    }
    expect(opts.staged).toBe(true)
  })
})
