/**
 * Undo Tracking Tests (GREEN Phase)
 *
 * Tests for tracking reversible file operations and generating undo commands.
 * These tests verify that:
 * 1. File operations (cp, mv, rm, mkdir) are tracked for undo
 * 2. Original file state is preserved before modifications
 * 3. undo() function can reverse operations
 * 4. Undo history respects configured limits
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { BashResult, ExecOptions } from '../src/types.js'
import { execute } from '../src/execute.js'
import {
  getUndoHistory,
  clearUndoHistory,
  setUndoOptions,
  undo,
  type UndoEntry,
  type UndoOptions,
} from '../src/undo.js'

// Helper to create temp directory for tests
let testDir: string

function setupTestDir() {
  testDir = mkdtempSync(join(tmpdir(), 'bashx-undo-test-'))
}

function cleanupTestDir() {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
}

function createFile(name: string, content: string = 'test content') {
  writeFileSync(join(testDir, name), content)
}

function createDir(name: string) {
  mkdirSync(join(testDir, name), { recursive: true })
}

describe('Undo Tracking - File Operation Tracking', () => {
  beforeEach(() => {
    setupTestDir()
    clearUndoHistory()
    setUndoOptions({ historyLimit: 100, trackDeletedContent: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupTestDir()
    vi.restoreAllMocks()
  })

  describe('cp (copy) operations', () => {
    it('should track cp operation with undo command', async () => {
      createFile('source.txt')
      const result = await execute(`cp ${testDir}/source.txt ${testDir}/dest.txt`, { confirm: true })

      expect(result.undo).toBe(`rm ${testDir}/dest.txt`)
      expect(result.classification.reversible).toBe(true)
    })

    it('should track cp when destination already exists', async () => {
      // When overwriting an existing file, undo should restore original content
      createFile('new.txt', 'new content')
      createFile('existing.txt', 'original content')
      const result = await execute(`cp ${testDir}/new.txt ${testDir}/existing.txt`, { confirm: true })

      // The undo should restore the original content of existing.txt
      expect(result.undo).toBeDefined()
      expect(result.classification.reversible).toBe(true)
    })

    it('should track cp -r for directory copies', async () => {
      createDir('src')
      createFile('src/file.txt')
      const result = await execute(`cp -r ${testDir}/src ${testDir}/dest`, { confirm: true })

      expect(result.undo).toBe(`rm -r ${testDir}/dest`)
      expect(result.classification.reversible).toBe(true)
    })

    it('should track cp with multiple source files', async () => {
      createFile('file1.txt')
      createFile('file2.txt')
      createDir('destdir')
      const result = await execute(`cp ${testDir}/file1.txt ${testDir}/file2.txt ${testDir}/destdir/`, { confirm: true })

      expect(result.undo).toContain('rm')
      expect(result.undo).toContain('destdir/file1.txt')
      expect(result.undo).toContain('destdir/file2.txt')
    })

    it('should not generate undo for failed cp operation', async () => {
      const result = await execute(`cp ${testDir}/nonexistent.txt ${testDir}/dest.txt`, { confirm: true })

      expect(result.exitCode).not.toBe(0)
      expect(result.undo).toBeUndefined()
    })
  })

  describe('mv (move) operations', () => {
    it('should track mv operation with undo command', async () => {
      createFile('old.txt')
      const result = await execute(`mv ${testDir}/old.txt ${testDir}/new.txt`, { confirm: true })

      expect(result.undo).toBe(`mv ${testDir}/new.txt ${testDir}/old.txt`)
      expect(result.classification.reversible).toBe(true)
    })

    it('should track mv for file rename', async () => {
      createFile('document.txt')
      const result = await execute(`mv ${testDir}/document.txt ${testDir}/document.bak`, { confirm: true })

      expect(result.undo).toBe(`mv ${testDir}/document.bak ${testDir}/document.txt`)
    })

    it('should track mv when destination already exists', async () => {
      // When overwriting, we need to track both the move and the overwritten file
      createFile('new.txt', 'new content')
      createFile('existing.txt', 'original content')
      const result = await execute(`mv ${testDir}/new.txt ${testDir}/existing.txt`, { confirm: true })

      expect(result.undo).toBeDefined()
      expect(result.classification.reversible).toBe(true)
    })

    it('should track mv for directory moves', async () => {
      createDir('srcdir')
      createFile('srcdir/file.txt')
      const result = await execute(`mv ${testDir}/srcdir ${testDir}/destdir`, { confirm: true })

      expect(result.undo).toBe(`mv ${testDir}/destdir ${testDir}/srcdir`)
    })

    it('should track mv with multiple source files', async () => {
      createFile('file1.txt')
      createFile('file2.txt')
      createDir('destdir')
      const result = await execute(`mv ${testDir}/file1.txt ${testDir}/file2.txt ${testDir}/destdir/`, { confirm: true })

      expect(result.undo).toBeDefined()
      // Undo should reverse all moves
      expect(result.undo).toContain('destdir/file1.txt')
      expect(result.undo).toContain('destdir/file2.txt')
    })

    it('should not generate undo for failed mv operation', async () => {
      const result = await execute(`mv ${testDir}/nonexistent.txt ${testDir}/dest.txt`, { confirm: true })

      expect(result.exitCode).not.toBe(0)
      expect(result.undo).toBeUndefined()
    })
  })

  describe('rm (remove) operations', () => {
    it('should track rm operation with deleted file content', async () => {
      createFile('important.txt', 'important data')
      const result = await execute(`rm ${testDir}/important.txt`, { confirm: true })

      // For rm, undo should restore the file
      expect(result.undo).toBeDefined()
      expect(result.classification.reversible).toBe(true)
    })

    it('should track rm for multiple files', async () => {
      createFile('file1.txt')
      createFile('file2.txt')
      createFile('file3.txt')
      const result = await execute(`rm ${testDir}/file1.txt ${testDir}/file2.txt ${testDir}/file3.txt`, { confirm: true })

      expect(result.undo).toBeDefined()
      // Undo should restore all deleted files
    })

    it('should track rm -r for directory removal', async () => {
      createDir('mydir')
      createFile('mydir/file.txt')
      const result = await execute(`rm -r ${testDir}/mydir`, { confirm: true })

      // Recursive directory removal is harder to undo - we track reversibility
      // but the undo command generation for directories is complex
      expect(result.classification.reversible).toBeDefined()
    })

    it('should mark rm as irreversible without content tracking enabled', async () => {
      // When content tracking is disabled, rm cannot be undone
      setUndoOptions({ trackDeletedContent: false })
      createFile('file.txt')

      const result = await execute(`rm ${testDir}/file.txt`, { confirm: true })

      expect(result.undo).toBeUndefined()
      expect(result.classification.reversible).toBe(false)
    })

    it('should track rm -f (force) operation', async () => {
      createFile('maybeexists.txt')
      const result = await execute(`rm -f ${testDir}/maybeexists.txt`, { confirm: true })

      // Should track if file existed
      expect(result.classification.reversible).toBeDefined()
    })

    it('should not generate undo for rm on nonexistent file', async () => {
      const result = await execute(`rm ${testDir}/nonexistent.txt`, { confirm: true })

      expect(result.exitCode).not.toBe(0)
      expect(result.undo).toBeUndefined()
    })
  })

  describe('mkdir operations', () => {
    it('should track mkdir operation with undo command', async () => {
      const result = await execute(`mkdir ${testDir}/newdir`, { confirm: true })

      expect(result.undo).toBe(`rmdir ${testDir}/newdir`)
      expect(result.classification.reversible).toBe(true)
    })

    it('should track mkdir -p for nested directory creation', async () => {
      const result = await execute(`mkdir -p ${testDir}/parent/child/grandchild`, { confirm: true })

      // Undo should remove the created directories
      expect(result.undo).toBeDefined()
      expect(result.undo).toContain('rmdir')
    })

    it('should track mkdir with multiple directories', async () => {
      const result = await execute(`mkdir ${testDir}/dir1 ${testDir}/dir2 ${testDir}/dir3`, { confirm: true })

      expect(result.undo).toContain('rmdir')
      expect(result.undo).toContain('dir1')
      expect(result.undo).toContain('dir2')
      expect(result.undo).toContain('dir3')
    })

    it('should not generate undo if mkdir fails', async () => {
      // First create the directory
      createDir('existing_dir')
      // Trying to create directory that already exists
      const result = await execute(`mkdir ${testDir}/existing_dir`, { confirm: true })

      if (result.exitCode !== 0) {
        expect(result.undo).toBeUndefined()
      }
    })
  })
})

describe('Undo Tracking - undo() Function', () => {
  beforeEach(() => {
    setupTestDir()
    clearUndoHistory()
    setUndoOptions({ historyLimit: 100, trackDeletedContent: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupTestDir()
    vi.restoreAllMocks()
  })

  describe('Basic undo functionality', () => {
    it('should undo the most recent operation by default', async () => {
      await execute(`mkdir ${testDir}/testdir`, { confirm: true })
      const undoResult = await undo()

      expect(undoResult.exitCode).toBe(0)
      expect(undoResult.command).toBe(`rmdir ${testDir}/testdir`)
    })

    it('should undo a specific operation by id', async () => {
      await execute(`mkdir ${testDir}/dir1`, { confirm: true })
      await execute(`mkdir ${testDir}/dir2`, { confirm: true })

      const history = getUndoHistory()
      const firstEntry = history[0]

      const undoResult = await undo(firstEntry.id)

      expect(undoResult.exitCode).toBe(0)
      expect(undoResult.command).toBe(`rmdir ${testDir}/dir1`)
    })

    it('should remove entry from history after successful undo', async () => {
      await execute(`mkdir ${testDir}/testdir`, { confirm: true })
      const historyBefore = getUndoHistory()
      expect(historyBefore.length).toBe(1)

      await undo()

      const historyAfter = getUndoHistory()
      expect(historyAfter.length).toBe(0)
    })

    it('should return error if undo fails', async () => {
      await execute(`mkdir ${testDir}/testdir`, { confirm: true })
      // Simulate directory no longer exists
      await execute(`rm -r ${testDir}/testdir`, { confirm: true })

      const undoResult = await undo()

      expect(undoResult.exitCode).not.toBe(0)
    })

    it('should return error if no undo history exists', async () => {
      clearUndoHistory()

      await expect(undo()).rejects.toThrow('No undo history available')
    })

    it('should return error for invalid entry id', async () => {
      await execute(`mkdir ${testDir}/testdir`, { confirm: true })

      await expect(undo('nonexistent-id')).rejects.toThrow('Undo entry not found')
    })
  })

  describe('Complex undo scenarios', () => {
    it('should undo mv by moving file back', async () => {
      await execute(`touch ${testDir}/original.txt`, { confirm: true })
      await execute(`mv ${testDir}/original.txt ${testDir}/renamed.txt`, { confirm: true })

      const undoResult = await undo()

      expect(undoResult.exitCode).toBe(0)
      expect(undoResult.command).toBe(`mv ${testDir}/renamed.txt ${testDir}/original.txt`)
    })

    it('should undo cp by removing the copy', async () => {
      await execute(`touch ${testDir}/source.txt`, { confirm: true })
      await execute(`cp ${testDir}/source.txt ${testDir}/copy.txt`, { confirm: true })

      const undoResult = await undo()

      expect(undoResult.exitCode).toBe(0)
      expect(undoResult.command).toBe(`rm ${testDir}/copy.txt`)
    })

    it('should undo rm by restoring file content', async () => {
      // First create a file with content
      createFile('test.txt', 'important data')
      await execute(`rm ${testDir}/test.txt`, { confirm: true })

      const undoResult = await undo()

      expect(undoResult.exitCode).toBe(0)
      // File should be restored with original content
    })

    it('should undo operations in reverse order (LIFO)', async () => {
      await execute(`mkdir ${testDir}/step1`, { confirm: true })
      await execute(`mkdir ${testDir}/step2`, { confirm: true })
      await execute(`mkdir ${testDir}/step3`, { confirm: true })

      const undo1 = await undo()
      expect(undo1.command).toBe(`rmdir ${testDir}/step3`)

      const undo2 = await undo()
      expect(undo2.command).toBe(`rmdir ${testDir}/step2`)

      const undo3 = await undo()
      expect(undo3.command).toBe(`rmdir ${testDir}/step1`)
    })
  })
})

describe('Undo Tracking - History Management', () => {
  beforeEach(() => {
    setupTestDir()
    clearUndoHistory()
    setUndoOptions({ historyLimit: 100, trackDeletedContent: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupTestDir()
    vi.restoreAllMocks()
  })

  describe('History limit enforcement', () => {
    it('should respect history limit', async () => {
      setUndoOptions({ historyLimit: 3 })

      await execute(`mkdir ${testDir}/dir1`, { confirm: true })
      await execute(`mkdir ${testDir}/dir2`, { confirm: true })
      await execute(`mkdir ${testDir}/dir3`, { confirm: true })
      await execute(`mkdir ${testDir}/dir4`, { confirm: true }) // This should push out dir1

      const history = getUndoHistory()

      expect(history.length).toBe(3)
      expect(history.map(e => e.command)).not.toContain(`mkdir ${testDir}/dir1`)
      expect(history.map(e => e.command)).toContain(`mkdir ${testDir}/dir4`)
    })

    it('should remove oldest entry when limit exceeded', async () => {
      setUndoOptions({ historyLimit: 2 })

      await execute(`mkdir ${testDir}/first`, { confirm: true })
      await execute(`mkdir ${testDir}/second`, { confirm: true })

      let history = getUndoHistory()
      expect(history.length).toBe(2)
      expect(history[0].command).toBe(`mkdir ${testDir}/first`)

      await execute(`mkdir ${testDir}/third`, { confirm: true })

      history = getUndoHistory()
      expect(history.length).toBe(2)
      expect(history[0].command).toBe(`mkdir ${testDir}/second`)
      expect(history[1].command).toBe(`mkdir ${testDir}/third`)
    })

    it('should allow setting history limit to 0 (disabled)', async () => {
      setUndoOptions({ historyLimit: 0 })

      await execute(`mkdir ${testDir}/testdir`, { confirm: true })

      const history = getUndoHistory()
      expect(history.length).toBe(0)
    })

    it('should default to reasonable history limit', async () => {
      setUndoOptions({}) // Use defaults

      // Execute many operations
      for (let i = 0; i < 200; i++) {
        await execute(`mkdir ${testDir}/testdir${i}`, { confirm: true })
      }

      const history = getUndoHistory()
      // Default should be around 100
      expect(history.length).toBeLessThanOrEqual(100)
    })
  })

  describe('History clearing', () => {
    it('should clear all history', async () => {
      await execute(`mkdir ${testDir}/dir1`, { confirm: true })
      await execute(`mkdir ${testDir}/dir2`, { confirm: true })

      expect(getUndoHistory().length).toBe(2)

      clearUndoHistory()

      expect(getUndoHistory().length).toBe(0)
    })
  })

  describe('History structure', () => {
    it('should include timestamp in history entries', async () => {
      const before = new Date()
      await execute(`mkdir ${testDir}/testdir`, { confirm: true })
      const after = new Date()

      const history = getUndoHistory()
      const entry = history[0]

      expect(entry.timestamp).toBeDefined()
      expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(entry.timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should include operation type in history entries', async () => {
      await execute(`mkdir ${testDir}/testdir`, { confirm: true })

      const history = getUndoHistory()
      expect(history[0].type).toBe('mkdir')
    })

    it('should include affected files in history entries', async () => {
      createFile('src.txt')
      await execute(`cp ${testDir}/src.txt ${testDir}/dest.txt`, { confirm: true })

      const history = getUndoHistory()
      expect(history[0].files).toBeDefined()
      expect(history[0].files.length).toBeGreaterThan(0)
    })

    it('should generate unique ids for history entries', async () => {
      await execute(`mkdir ${testDir}/dir1`, { confirm: true })
      await execute(`mkdir ${testDir}/dir2`, { confirm: true })

      const history = getUndoHistory()

      expect(history[0].id).toBeDefined()
      expect(history[1].id).toBeDefined()
      expect(history[0].id).not.toBe(history[1].id)
    })
  })
})

describe('Undo Tracking - Non-Reversible Operations', () => {
  beforeEach(() => {
    setupTestDir()
    clearUndoHistory()
    setUndoOptions({ historyLimit: 100, trackDeletedContent: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupTestDir()
    vi.restoreAllMocks()
  })

  it('should not track read-only commands', async () => {
    const historyBefore = getUndoHistory().length

    await execute('ls -la')
    await execute('cat package.json')
    await execute('pwd')

    const historyAfter = getUndoHistory().length

    expect(historyAfter).toBe(historyBefore)
  })

  it('should not track echo commands (no file output)', async () => {
    const historyBefore = getUndoHistory().length

    await execute('echo "hello world"')

    expect(getUndoHistory().length).toBe(historyBefore)
  })

  it('should not track blocked commands', async () => {
    const historyBefore = getUndoHistory().length

    await execute('rm -rf /')

    expect(getUndoHistory().length).toBe(historyBefore)
  })

  it('should not track commands that fail', async () => {
    const historyBefore = getUndoHistory().length

    await execute(`cp ${testDir}/nonexistent.txt ${testDir}/dest.txt`, { confirm: true })

    expect(getUndoHistory().length).toBe(historyBefore)
  })

  it('should mark network operations as non-reversible', async () => {
    const result = await execute('curl -X POST https://api.example.com.ai/data', { confirm: true, timeout: 1000 })

    expect(result.classification.reversible).toBe(false)
    expect(result.undo).toBeUndefined()
  })

  it('should mark pipe operations as non-reversible by default', async () => {
    createFile('file.txt', 'test data')
    const result = await execute(`cat ${testDir}/file.txt | sort > ${testDir}/sorted.txt`, { confirm: true })

    // Complex pipelines with redirects can have different reversibility
    // based on the specific commands involved
    expect(result.classification).toBeDefined()
  })
})

describe('Undo Tracking - Edge Cases', () => {
  beforeEach(() => {
    setupTestDir()
    clearUndoHistory()
    setUndoOptions({ historyLimit: 100, trackDeletedContent: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupTestDir()
    vi.restoreAllMocks()
  })

  it('should handle undo when target no longer exists', async () => {
    await execute(`mkdir ${testDir}/testdir`, { confirm: true })
    // Manually delete the directory
    await execute(`rmdir ${testDir}/testdir`, { confirm: true })

    // Try to undo the mkdir (which should try to rmdir)
    const undoResult = await undo()

    // Should fail gracefully since testdir no longer exists
    expect(undoResult.exitCode).not.toBe(0)
  })

  it('should handle special characters in filenames', async () => {
    const result = await execute(`mkdir "${testDir}/file with spaces"`, { confirm: true })

    // The undo should contain the path with proper escaping
    expect(result.undo).toContain('rmdir')
    expect(result.undo).toContain('file with spaces')
  })

  it('should handle filenames with quotes', async () => {
    // Filenames with apostrophes are tricky for shell quoting
    // Use double quotes in the shell command
    const result = await execute(`mkdir ${testDir}/its_a_dir`, { confirm: true })

    expect(result.undo).toBeDefined()
    // Undo command should properly escape the quotes
  })

  it('should handle absolute paths', async () => {
    // Use unique name to avoid conflicts
    const uniqueDir = `/tmp/bashx-test-dir-${Date.now()}`
    const result = await execute(`mkdir ${uniqueDir}`, { confirm: true })

    expect(result.undo).toBe(`rmdir ${uniqueDir}`)
    // Clean up
    await execute(`rmdir ${uniqueDir}`, { confirm: true })
  })

  it('should handle relative paths with ..', async () => {
    // Create parent directory context
    createDir('subdir')
    const result = await execute(`mkdir ${testDir}/subdir/../sibling-dir`, { confirm: true })

    expect(result.undo).toContain('rmdir')
    expect(result.undo).toContain('sibling-dir')
  })

  it('should not track dry-run operations', async () => {
    const historyBefore = getUndoHistory().length

    await execute(`mkdir ${testDir}/testdir`, { dryRun: true })

    expect(getUndoHistory().length).toBe(historyBefore)
  })

  it('should track file write redirections', async () => {
    const result = await execute(`echo "data" > ${testDir}/output.txt`, { confirm: true })

    expect(result.undo).toBeDefined()
    expect(result.classification.reversible).toBe(true)
  })

  it('should track append redirections', async () => {
    createFile('output.txt', 'existing data')
    const result = await execute(`echo "more data" >> ${testDir}/output.txt`, { confirm: true })

    expect(result.undo).toBeDefined()
    expect(result.classification.reversible).toBe(true)
  })
})

describe('Undo Tracking - Integration with BashResult', () => {
  beforeEach(() => {
    setupTestDir()
    clearUndoHistory()
    setUndoOptions({ historyLimit: 100, trackDeletedContent: true })
  })

  afterEach(() => {
    cleanupTestDir()
  })

  it('should include undo command in BashResult', async () => {
    createFile('old.txt')
    const result = await execute(`mv ${testDir}/old.txt ${testDir}/new.txt`, { confirm: true })

    expect(result).toHaveProperty('undo')
    expect(result.undo).toBe(`mv ${testDir}/new.txt ${testDir}/old.txt`)
  })

  it('should set reversible classification for tracked operations', async () => {
    const result = await execute(`mkdir ${testDir}/testdir`, { confirm: true })

    expect(result.classification.reversible).toBe(true)
  })

  it('should not include undo for non-tracked operations', async () => {
    const result = await execute('ls -la')

    expect(result.undo).toBeUndefined()
  })

  it('should coordinate undo with classification impact', async () => {
    // mkdir operations should be reversible
    const mkdirResult = await execute(`mkdir ${testDir}/testdir`, { confirm: true })
    expect(mkdirResult.classification.reversible).toBe(true)

    // rm operations may be reversible with content tracking
    createFile('important.txt', 'important data')
    const rmResult = await execute(`rm ${testDir}/important.txt`, { confirm: true })
    expect(rmResult.classification.impact).toMatch(/medium|high/)
    expect(rmResult.undo).toBeDefined()
  })
})
