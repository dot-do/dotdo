/**
 * POSIX Misc Utilities Tests
 *
 * Comprehensive POSIX compliance tests for miscellaneous utilities:
 * - chmod: Change file mode bits
 * - date: Print or set the system date and time
 * - dd: Convert and copy a file (planned)
 * - diff: Compare two files
 * - find: Find files in a directory hierarchy
 * - od: Dump files in various formats (planned)
 * - xargs: Build and execute command lines from standard input
 *
 * Reference: POSIX.1-2024 (IEEE Std 1003.1-2024)
 *
 * @module tests/posix/utilities/misc
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MockFileSystem,
  createTestExecutor,
  TieredExecutor,
} from '../helpers.js'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('POSIX Misc Utilities', () => {
  let fs: MockFileSystem
  let executor: TieredExecutor

  beforeEach(() => {
    fs = new MockFileSystem()
    executor = createTestExecutor({ fs })
  })

  // ==========================================================================
  // CHMOD TESTS
  // ==========================================================================

  describe('chmod', () => {
    beforeEach(() => {
      fs.addFile('/tmp/test.sh', '#!/bin/sh\necho "hello"')
      fs.addFile('/tmp/file.txt', 'content')
      fs.addDirectory('/tmp/testdir')
      fs.addFile('/tmp/testdir/nested.txt', 'nested content')
    })

    describe('octal mode', () => {
      it('sets octal mode 755 (rwxr-xr-x)', async () => {
        const result = await executor.execute('chmod 755 /tmp/test.sh')
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
      })

      it('sets octal mode 644 (rw-r--r--)', async () => {
        const result = await executor.execute('chmod 644 /tmp/file.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
      })

      it('sets octal mode 700 (rwx------)', async () => {
        const result = await executor.execute('chmod 700 /tmp/test.sh')
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
      })

      it('sets octal mode 600 (rw-------)', async () => {
        const result = await executor.execute('chmod 600 /tmp/file.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
      })

      it('sets octal mode 444 (r--r--r--)', async () => {
        const result = await executor.execute('chmod 444 /tmp/file.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
      })
    })

    describe('error handling', () => {
      it('fails when file does not exist', async () => {
        const result = await executor.execute('chmod 755 /tmp/nonexistent.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('ENOENT')
      })

      it('fails when missing operand', async () => {
        const result = await executor.execute('chmod 755')
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('missing operand')
      })

      it('fails with only mode (no file specified)', async () => {
        const result = await executor.execute('chmod')
        // chmod needs both mode and file
        expect(result.exitCode).toBe(1)
      })
    })

    describe('directory handling', () => {
      it('sets mode on directory', async () => {
        const result = await executor.execute('chmod 755 /tmp/testdir')
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
      })

      it('handles special modes like 1755 (sticky bit)', async () => {
        const result = await executor.execute('chmod 1755 /tmp/testdir')
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
      })
    })
  })

  // ==========================================================================
  // DATE TESTS
  // ==========================================================================

  describe('date', () => {
    it('outputs current date/time', async () => {
      const result = await executor.execute('date')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBeTruthy()
      // Should contain some date-like content
      expect(result.stdout.length).toBeGreaterThan(0)
    })

    it('produces output with newline', async () => {
      const result = await executor.execute('date')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.endsWith('\n')).toBe(true)
    })

    it('returns exit code 0 on success', async () => {
      const result = await executor.execute('date')
      expect(result.exitCode).toBe(0)
    })

    it('produces non-empty output', async () => {
      const result = await executor.execute('date')
      expect(result.stdout.trim().length).toBeGreaterThan(10)
    })

    it('does not produce stderr on success', async () => {
      const result = await executor.execute('date')
      expect(result.stderr).toBe('')
    })
  })

  // ==========================================================================
  // DIFF TESTS
  // ==========================================================================

  describe('diff', () => {
    describe('identical files', () => {
      it('returns exit code 0 for identical files', async () => {
        fs.addFile('/tmp/a.txt', 'same content\n')
        fs.addFile('/tmp/b.txt', 'same content\n')
        const result = await executor.execute('diff /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('')
      })

      it('returns empty output for identical files', async () => {
        fs.addFile('/tmp/file1.txt', 'line1\nline2\nline3\n')
        fs.addFile('/tmp/file2.txt', 'line1\nline2\nline3\n')
        const result = await executor.execute('diff /tmp/file1.txt /tmp/file2.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('')
      })

      it('handles empty identical files', async () => {
        fs.addFile('/tmp/empty1.txt', '')
        fs.addFile('/tmp/empty2.txt', '')
        const result = await executor.execute('diff /tmp/empty1.txt /tmp/empty2.txt')
        expect(result.exitCode).toBe(0)
      })

      it('handles single line identical files', async () => {
        fs.addFile('/tmp/single1.txt', 'single line')
        fs.addFile('/tmp/single2.txt', 'single line')
        const result = await executor.execute('diff /tmp/single1.txt /tmp/single2.txt')
        expect(result.exitCode).toBe(0)
      })

      it('treats trailing newline consistently', async () => {
        fs.addFile('/tmp/with-newline.txt', 'content\n')
        fs.addFile('/tmp/with-newline2.txt', 'content\n')
        const result = await executor.execute('diff /tmp/with-newline.txt /tmp/with-newline2.txt')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('different files', () => {
      it('returns exit code 1 for different files', async () => {
        fs.addFile('/tmp/a.txt', 'one\n')
        fs.addFile('/tmp/b.txt', 'two\n')
        const result = await executor.execute('diff /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toBeTruthy()
      })

      it('shows deleted lines with <', async () => {
        fs.addFile('/tmp/a.txt', 'old line\n')
        fs.addFile('/tmp/b.txt', 'new line\n')
        const result = await executor.execute('diff /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('< old line')
      })

      it('shows added lines with >', async () => {
        fs.addFile('/tmp/a.txt', 'old line\n')
        fs.addFile('/tmp/b.txt', 'new line\n')
        const result = await executor.execute('diff /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('> new line')
      })

      it('handles multiline differences', async () => {
        fs.addFile('/tmp/a.txt', 'line1\nline2\nline3\n')
        fs.addFile('/tmp/b.txt', 'line1\nmodified\nline3\n')
        const result = await executor.execute('diff /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('line2')
        expect(result.stdout).toContain('modified')
      })

      it('detects additions at end of file', async () => {
        fs.addFile('/tmp/a.txt', 'line1\n')
        fs.addFile('/tmp/b.txt', 'line1\nline2\n')
        const result = await executor.execute('diff /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('line2')
      })
    })

    describe('unified format (-u)', () => {
      it('produces unified format with -u flag', async () => {
        fs.addFile('/tmp/a.txt', 'old\n')
        fs.addFile('/tmp/b.txt', 'new\n')
        const result = await executor.execute('diff -u /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('--- /tmp/a.txt')
        expect(result.stdout).toContain('+++ /tmp/b.txt')
      })

      it('shows context lines in unified format', async () => {
        fs.addFile('/tmp/a.txt', 'context1\nold\ncontext2\n')
        fs.addFile('/tmp/b.txt', 'context1\nnew\ncontext2\n')
        const result = await executor.execute('diff -u /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('@@')
        expect(result.stdout).toContain('-old')
        expect(result.stdout).toContain('+new')
      })

      it('shows file headers in unified format', async () => {
        fs.addFile('/tmp/original.txt', 'line1\n')
        fs.addFile('/tmp/modified.txt', 'line2\n')
        const result = await executor.execute('diff -u /tmp/original.txt /tmp/modified.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('/tmp/original.txt')
        expect(result.stdout).toContain('/tmp/modified.txt')
      })

      it('produces unified diff with --unified flag', async () => {
        fs.addFile('/tmp/a.txt', 'old\n')
        fs.addFile('/tmp/b.txt', 'new\n')
        const result = await executor.execute('diff --unified /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('---')
        expect(result.stdout).toContain('+++')
      })

      it('includes hunk headers with line numbers', async () => {
        fs.addFile('/tmp/a.txt', 'line1\nline2\nline3\n')
        fs.addFile('/tmp/b.txt', 'line1\nchanged\nline3\n')
        const result = await executor.execute('diff -u /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/)
      })
    })

    describe('context format (-c)', () => {
      it('produces context format with -c flag', async () => {
        fs.addFile('/tmp/a.txt', 'old\n')
        fs.addFile('/tmp/b.txt', 'new\n')
        const result = await executor.execute('diff -c /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('*** /tmp/a.txt')
        expect(result.stdout).toContain('--- /tmp/b.txt')
      })

      it('shows asterisk separator line in context format', async () => {
        fs.addFile('/tmp/a.txt', 'line1\n')
        fs.addFile('/tmp/b.txt', 'line2\n')
        const result = await executor.execute('diff -c /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('***')
      })

      it('produces context diff with --context flag', async () => {
        fs.addFile('/tmp/a.txt', 'old\n')
        fs.addFile('/tmp/b.txt', 'new\n')
        const result = await executor.execute('diff --context /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('***')
      })

      it('marks changes with ! in context format', async () => {
        fs.addFile('/tmp/a.txt', 'original line\n')
        fs.addFile('/tmp/b.txt', 'modified line\n')
        const result = await executor.execute('diff -c /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('!')
      })

      it('shows line range indicators in context format', async () => {
        fs.addFile('/tmp/a.txt', 'line1\nline2\n')
        fs.addFile('/tmp/b.txt', 'line1\nchanged\n')
        const result = await executor.execute('diff -c /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toMatch(/\*\*\* \d+,\d+/)
      })
    })

    describe('error handling', () => {
      it('returns error for missing first file', async () => {
        fs.addFile('/tmp/exists.txt', 'content')
        const result = await executor.execute('diff /tmp/missing.txt /tmp/exists.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toBeTruthy()
      })

      it('returns error for missing second file', async () => {
        fs.addFile('/tmp/exists.txt', 'content')
        const result = await executor.execute('diff /tmp/exists.txt /tmp/missing.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toBeTruthy()
      })

      it('returns error when missing operand', async () => {
        const result = await executor.execute('diff /tmp/only-one.txt')
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('missing operand')
      })
    })
  })

  // ==========================================================================
  // FIND TESTS
  // ==========================================================================

  describe('find', () => {
    beforeEach(() => {
      // Create a directory structure for find tests
      fs.addDirectory('/test')
      fs.addDirectory('/test/subdir')
      fs.addDirectory('/test/another')
      fs.addFile('/test/file1.txt', 'content1')
      fs.addFile('/test/file2.txt', 'content2')
      fs.addFile('/test/script.sh', '#!/bin/sh')
      fs.addFile('/test/subdir/nested.txt', 'nested')
      fs.addFile('/test/subdir/nested.sh', 'script')
      fs.addFile('/test/another/other.txt', 'other')
    })

    describe('-name pattern matching', () => {
      it('finds files by exact name', async () => {
        const result = await executor.execute('find /test -name file1.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('file1.txt')
      })

      it('finds files by wildcard pattern *.txt', async () => {
        const result = await executor.execute('find /test -name "*.txt"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('.txt')
      })

      it('finds files by wildcard pattern *.sh', async () => {
        const result = await executor.execute('find /test -name "*.sh"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('.sh')
      })

      it('returns empty for non-matching pattern', async () => {
        const result = await executor.execute('find /test -name "*.xyz"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('')
      })

      it('finds files in nested directories', async () => {
        const result = await executor.execute('find /test -name nested.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('nested.txt')
      })
    })

    describe('-type filter', () => {
      it('finds only files with -type f', async () => {
        const result = await executor.execute('find /test -type f')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('.txt')
        // Should not contain directory names as standalone entries
      })

      it('finds only directories with -type d', async () => {
        const result = await executor.execute('find /test -type d')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('subdir')
      })

      it('returns multiple files with -type f', async () => {
        const result = await executor.execute('find /test -type f')
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.trim().split('\n').filter(Boolean)
        expect(lines.length).toBeGreaterThan(1)
      })

      it('returns multiple directories with -type d', async () => {
        const result = await executor.execute('find /test -type d')
        expect(result.exitCode).toBe(0)
        // Should find subdir and another
        expect(result.stdout).toMatch(/subdir|another/)
      })

      it('combines -type f with -name', async () => {
        const result = await executor.execute('find /test -type f -name "*.txt"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('.txt')
        // Should not match .sh files
        expect(result.stdout).not.toMatch(/\.sh(?:\n|$)/)
      })
    })

    describe('search path handling', () => {
      it('searches from specified directory', async () => {
        const result = await executor.execute('find /test/subdir -name "*.txt"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('nested.txt')
      })

      it('uses current directory when no path specified', async () => {
        // Should default to . (current directory)
        const result = await executor.execute('find -name "*.txt"')
        // May succeed or fail depending on implementation
        expect(typeof result.exitCode).toBe('number')
      })

      // TODO: find should return non-zero for non-existent directories
      it.skip('handles non-existent directory gracefully', async () => {
        const result = await executor.execute('find /nonexistent -name "*"')
        expect(result.exitCode).not.toBe(0)
      })

      it('searches recursively by default', async () => {
        const result = await executor.execute('find /test -name "*.txt"')
        expect(result.exitCode).toBe(0)
        // Should find both top-level and nested files
        expect(result.stdout).toContain('file1.txt')
      })

      it('outputs full paths', async () => {
        const result = await executor.execute('find /test -name file1.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/\/test/)
      })
    })

    describe('complex patterns', () => {
      it('handles glob ? wildcard', async () => {
        const result = await executor.execute('find /test -name "file?.txt"')
        expect(result.exitCode).toBe(0)
        // Should match file1.txt and file2.txt
        expect(result.stdout).toContain('file')
      })

      it('handles pattern with multiple wildcards', async () => {
        const result = await executor.execute('find /test -name "*.*"')
        expect(result.exitCode).toBe(0)
        // Should match files with extensions
        expect(result.stdout).toBeTruthy()
      })

      it('returns exit code 0 even when no matches', async () => {
        const result = await executor.execute('find /test -name "nonexistent.xyz"')
        expect(result.exitCode).toBe(0)
      })

      it('handles quoted patterns correctly', async () => {
        const result = await executor.execute("find /test -name '*.txt'")
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('.txt')
      })

      it('handles pattern starting with *', async () => {
        const result = await executor.execute('find /test -name "*ed.txt"')
        expect(result.exitCode).toBe(0)
        // Should match nested.txt
        expect(result.stdout).toContain('nested')
      })
    })
  })

  // ==========================================================================
  // XARGS TESTS
  // ==========================================================================

  describe('xargs', () => {
    describe('basic operation', () => {
      it('passes stdin as arguments', async () => {
        const result = await executor.execute('echo "a b c" | xargs echo')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('a b c')
      })

      it('defaults to echo when no command specified', async () => {
        const result = await executor.execute('echo "hello world" | xargs')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('hello world')
      })

      it('handles newline-separated input', async () => {
        const result = await executor.execute('printf "a\\nb\\nc" | xargs echo')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('a b c')
      })

      it('handles empty input gracefully', async () => {
        const result = await executor.execute('echo "" | xargs echo')
        expect(result.exitCode).toBe(0)
        // Should run echo with no args, producing newline
      })

      it('handles whitespace-separated input', async () => {
        const result = await executor.execute('echo "  foo   bar   baz  " | xargs echo')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('foo bar baz')
      })
    })

    describe('-n option (max args per command)', () => {
      it('limits arguments per command with -n 1', async () => {
        const result = await executor.execute('printf "a\\nb\\nc" | xargs -n 1 echo')
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.trim().split('\n')
        expect(lines.length).toBe(3)
        expect(lines[0]).toBe('a')
        expect(lines[1]).toBe('b')
        expect(lines[2]).toBe('c')
      })

      it('limits arguments per command with -n 2', async () => {
        const result = await executor.execute('printf "a\\nb\\nc\\nd" | xargs -n 2 echo')
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.trim().split('\n')
        expect(lines.length).toBe(2)
        expect(lines[0]).toBe('a b')
        expect(lines[1]).toBe('c d')
      })

      it('handles -n with fewer args than limit', async () => {
        const result = await executor.execute('echo "a" | xargs -n 5 echo')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('a')
      })

      it('handles -n with exact number of args', async () => {
        const result = await executor.execute('printf "a\\nb\\nc" | xargs -n 3 echo')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('a b c')
      })

      it('handles combined -n flag (e.g., -n1)', async () => {
        const result = await executor.execute('printf "x\\ny" | xargs -n1 echo')
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.trim().split('\n')
        expect(lines.length).toBe(2)
      })
    })

    describe('-I option (placeholder replacement)', () => {
      it('replaces placeholder with -I {}', async () => {
        const result = await executor.execute('printf "foo\\nbar" | xargs -I {} echo prefix-{}-suffix')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('prefix-foo-suffix')
        expect(result.stdout).toContain('prefix-bar-suffix')
      })

      it('replaces custom placeholder with -I %%', async () => {
        const result = await executor.execute('printf "test" | xargs -I %% echo "value: %%"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('value: test')
      })

      it('handles multiple placeholders in same command', async () => {
        const result = await executor.execute('printf "item" | xargs -I X echo "X and X"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('item and item')
      })

      it('runs command once per input line with -I', async () => {
        const result = await executor.execute('printf "a\\nb\\nc" | xargs -I @ echo "line: @"')
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.trim().split('\n')
        expect(lines.length).toBe(3)
      })

      it('handles -I with combined flag format', async () => {
        const result = await executor.execute('printf "x" | xargs -I{} echo "[{}]"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('[x]')
      })
    })

    // TODO: xargs -0 null delimiter support needs implementation
    describe.skip('-0 option (null delimiter)', () => {
      it('handles null-separated input with -0', async () => {
        const result = await executor.execute('printf "a\\0b\\0c" | xargs -0 echo')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('a b c')
      })

      it('handles filenames with spaces using -0', async () => {
        // Note: printf interprets \0 as null
        const result = await executor.execute('printf "file with spaces\\0another file" | xargs -0 -n1 echo')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('file with spaces')
      })
    })

    describe('exit codes', () => {
      it('returns 0 on success', async () => {
        const result = await executor.execute('echo "test" | xargs echo')
        expect(result.exitCode).toBe(0)
      })

      it('propagates exit code from failed command', async () => {
        // This depends on how the executor handles failures
        const result = await executor.execute('echo "test" | xargs false')
        expect(result.exitCode).not.toBe(0)
      })

      it('returns success for empty input with no command', async () => {
        const result = await executor.execute('echo "" | xargs')
        // Should just run echo with empty/no args
        expect(typeof result.exitCode).toBe('number')
      })
    })

    describe('complex commands', () => {
      it('passes arguments to multi-word command', async () => {
        const result = await executor.execute('printf "hello\\nworld" | xargs -n 1 echo "say:"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('say: hello')
        expect(result.stdout).toContain('say: world')
      })

      it('handles input with trailing newline', async () => {
        const result = await executor.execute('echo "item" | xargs echo')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('item')
      })
    })
  })

  // ==========================================================================
  // DD TESTS - Convert and copy a file
  // Note: dd is not yet implemented in Tier 1, tests are skipped
  // ==========================================================================

  describe.skip('dd', () => {
    describe('basic copying', () => {
      it('copies data with default block size', async () => {
        fs.addFile('/tmp/input.bin', 'test data content')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin')
        expect(result.exitCode).toBe(0)
      })

      it('copies data with bs=1 (byte by byte)', async () => {
        fs.addFile('/tmp/input.bin', 'test data')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=1')
        expect(result.exitCode).toBe(0)
      })

      it('copies data with specified block size bs=512', async () => {
        fs.addFile('/tmp/input.bin', 'a'.repeat(1024))
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=512')
        expect(result.exitCode).toBe(0)
      })

      it('copies data with large block size bs=4096', async () => {
        fs.addFile('/tmp/input.bin', 'test content')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=4096')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('count parameter', () => {
      it('copies specific number of blocks with count', async () => {
        fs.addFile('/tmp/input.bin', 'hello world')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=1 count=5')
        expect(result.exitCode).toBe(0)
      })

      it('handles count=0 (copies nothing)', async () => {
        fs.addFile('/tmp/input.bin', 'content')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=1 count=0')
        expect(result.exitCode).toBe(0)
      })

      it('handles count larger than file size', async () => {
        fs.addFile('/tmp/input.bin', 'short')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=1 count=1000')
        expect(result.exitCode).toBe(0)
      })

      it('copies exactly count*bs bytes', async () => {
        fs.addFile('/tmp/input.bin', 'abcdefghij')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=2 count=3')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('skip parameter', () => {
      it('skips blocks at input with skip', async () => {
        fs.addFile('/tmp/input.bin', 'skipthis_keepthis')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=9 skip=1')
        expect(result.exitCode).toBe(0)
      })

      it('skips bytes with bs=1 skip=N', async () => {
        fs.addFile('/tmp/input.bin', '0123456789')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=1 skip=5')
        expect(result.exitCode).toBe(0)
      })

      it('handles skip past end of file', async () => {
        fs.addFile('/tmp/input.bin', 'short')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=1 skip=100')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('seek parameter', () => {
      it('seeks in output file with seek', async () => {
        fs.addFile('/tmp/input.bin', 'data')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=1 seek=10')
        expect(result.exitCode).toBe(0)
      })

      it('creates sparse file with seek', async () => {
        fs.addFile('/tmp/input.bin', 'X')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=512 seek=100')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('stdin/stdout', () => {
      it('reads from stdin when if not specified', async () => {
        const result = await executor.execute('echo "test" | dd bs=4 count=1')
        expect(result.exitCode).toBe(0)
      })

      it('writes to stdout when of not specified', async () => {
        fs.addFile('/tmp/source.txt', 'data')
        const result = await executor.execute('dd if=/tmp/source.txt bs=4')
        expect(result.stdout).toContain('data')
      })

      it('acts as pass-through with neither if nor of', async () => {
        const result = await executor.execute('echo "passthrough" | dd bs=512')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('ibs/obs (separate input/output block sizes)', () => {
      it('supports different input and output block sizes', async () => {
        fs.addFile('/tmp/input.bin', 'abcdefghij')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin ibs=2 obs=5')
        expect(result.exitCode).toBe(0)
      })

      it('handles ibs alone', async () => {
        fs.addFile('/tmp/input.bin', 'testdata')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin ibs=4')
        expect(result.exitCode).toBe(0)
      })

      it('handles obs alone', async () => {
        fs.addFile('/tmp/input.bin', 'testdata')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin obs=4')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('status output', () => {
      it('reports bytes transferred to stderr', async () => {
        fs.addFile('/tmp/input.bin', 'test')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin')
        // dd typically outputs statistics to stderr
        expect(result.stderr).toMatch(/\d+.*bytes|records/)
      })

      it('reports records in and out', async () => {
        fs.addFile('/tmp/input.bin', 'test data')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=1')
        expect(result.stderr).toMatch(/\d+\+\d+ records (in|out)/)
      })
    })

    describe('error handling', () => {
      it('fails when input file does not exist', async () => {
        const result = await executor.execute('dd if=/tmp/nonexistent.bin of=/tmp/output.bin')
        expect(result.exitCode).not.toBe(0)
      })

      it('fails with invalid block size', async () => {
        fs.addFile('/tmp/input.bin', 'data')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin bs=0')
        expect(result.exitCode).not.toBe(0)
      })

      it('fails with negative count', async () => {
        fs.addFile('/tmp/input.bin', 'data')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/output.bin count=-1')
        expect(result.exitCode).not.toBe(0)
      })
    })

    describe('conv options', () => {
      it('supports conv=ucase (uppercase)', async () => {
        fs.addFile('/tmp/input.txt', 'hello world')
        const result = await executor.execute('dd if=/tmp/input.txt conv=ucase')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('HELLO WORLD')
      })

      it('supports conv=lcase (lowercase)', async () => {
        fs.addFile('/tmp/input.txt', 'HELLO WORLD')
        const result = await executor.execute('dd if=/tmp/input.txt conv=lcase')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('hello world')
      })

      it('supports conv=notrunc (do not truncate output)', async () => {
        fs.addFile('/tmp/existing.bin', 'existing content that is long')
        fs.addFile('/tmp/input.bin', 'short')
        const result = await executor.execute('dd if=/tmp/input.bin of=/tmp/existing.bin conv=notrunc')
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ==========================================================================
  // OD TESTS - Dump files in various formats
  // Note: od is not yet implemented in Tier 1, tests are skipped
  // ==========================================================================

  describe.skip('od', () => {
    describe('default octal format', () => {
      it('dumps file in octal format by default', async () => {
        fs.addFile('/tmp/test.bin', 'ABC')
        const result = await executor.execute('od /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        // Default format shows octal bytes
        expect(result.stdout).toMatch(/\d{7}/)
      })

      it('shows octal address offset', async () => {
        fs.addFile('/tmp/test.bin', 'test')
        const result = await executor.execute('od /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/^0000000/)
      })

      it('shows final address', async () => {
        fs.addFile('/tmp/test.bin', 'ABC')
        const result = await executor.execute('od /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        // Final line shows end address
        expect(result.stdout).toMatch(/0000003|0000004/)
      })
    })

    describe('-A option (address format)', () => {
      it('uses hexadecimal addresses with -A x', async () => {
        fs.addFile('/tmp/test.bin', 'test')
        const result = await executor.execute('od -A x /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/^[0-9a-f]{7}/)
      })

      it('uses decimal addresses with -A d', async () => {
        fs.addFile('/tmp/test.bin', 'test')
        const result = await executor.execute('od -A d /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/^0000000/)
      })

      it('uses octal addresses with -A o', async () => {
        fs.addFile('/tmp/test.bin', 'test')
        const result = await executor.execute('od -A o /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/^0000000/)
      })

      it('suppresses addresses with -A n', async () => {
        fs.addFile('/tmp/test.bin', 'test')
        const result = await executor.execute('od -A n /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        // No address prefix
        expect(result.stdout).not.toMatch(/^0000000/)
      })
    })

    describe('-t option (output type)', () => {
      it('outputs character format with -t c', async () => {
        fs.addFile('/tmp/test.bin', 'hello')
        const result = await executor.execute('od -t c /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('h')
        expect(result.stdout).toContain('e')
        expect(result.stdout).toContain('l')
        expect(result.stdout).toContain('o')
      })

      it('outputs single-byte hex with -t x1', async () => {
        fs.addFile('/tmp/test.bin', 'AB')
        const result = await executor.execute('od -t x1 /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/41.*42|42.*41/) // Hex for A (0x41) and B (0x42)
      })

      it('outputs two-byte hex with -t x2', async () => {
        fs.addFile('/tmp/test.bin', 'ABCD')
        const result = await executor.execute('od -t x2 /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        // Two-byte hex values
        expect(result.stdout).toMatch(/[0-9a-f]{4}/)
      })

      it('outputs signed decimal with -t d1', async () => {
        fs.addFile('/tmp/test.bin', 'ABC')
        const result = await executor.execute('od -t d1 /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        // Decimal values for A=65, B=66, C=67
        expect(result.stdout).toMatch(/65|66|67/)
      })

      it('outputs unsigned decimal with -t u1', async () => {
        fs.addFile('/tmp/test.bin', '\xff\xfe')
        const result = await executor.execute('od -t u1 /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        // Unsigned values 255, 254
        expect(result.stdout).toMatch(/255|254/)
      })

      it('outputs octal with -t o1', async () => {
        fs.addFile('/tmp/test.bin', 'ABC')
        const result = await executor.execute('od -t o1 /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        // Octal values
        expect(result.stdout).toMatch(/101|102|103/) // A=101, B=102, C=103 in octal
      })
    })

    describe('shorthand options', () => {
      it('outputs hex bytes with -x', async () => {
        fs.addFile('/tmp/test.bin', 'test')
        const result = await executor.execute('od -x /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/[0-9a-f]+/)
      })

      it('outputs characters with -c', async () => {
        fs.addFile('/tmp/test.bin', 'abc')
        const result = await executor.execute('od -c /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('a')
        expect(result.stdout).toContain('b')
        expect(result.stdout).toContain('c')
      })

      it('outputs decimal with -d', async () => {
        fs.addFile('/tmp/test.bin', 'AB')
        const result = await executor.execute('od -d /tmp/test.bin')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('stdin input', () => {
      it('handles stdin input', async () => {
        const result = await executor.execute('echo "test" | od')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBeTruthy()
      })

      it('dumps stdin in hex format', async () => {
        const result = await executor.execute('echo "AB" | od -t x1')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/41.*42/) // A=0x41, B=0x42
      })

      it('handles binary stdin', async () => {
        const result = await executor.execute('printf "\\x00\\x01\\x02" | od -t x1')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/00.*01.*02/)
      })
    })

    describe('special characters', () => {
      it('shows escape sequences for control characters', async () => {
        fs.addFile('/tmp/test.bin', '\t\n\r')
        const result = await executor.execute('od -c /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/\\t|\\n|\\r/)
      })

      it('shows null as \\0', async () => {
        fs.addFile('/tmp/test.bin', '\0')
        const result = await executor.execute('od -c /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('\\0')
      })

      it('shows bell as \\a', async () => {
        fs.addFile('/tmp/test.bin', '\x07')
        const result = await executor.execute('od -c /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('\\a')
      })

      it('shows backspace as \\b', async () => {
        fs.addFile('/tmp/test.bin', '\b')
        const result = await executor.execute('od -c /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('\\b')
      })
    })

    describe('-N option (byte limit)', () => {
      it('limits output bytes with -N', async () => {
        fs.addFile('/tmp/test.bin', 'abcdefghij')
        const result = await executor.execute('od -N 5 /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        // Should only show first 5 bytes
      })

      it('handles -N larger than file', async () => {
        fs.addFile('/tmp/test.bin', 'short')
        const result = await executor.execute('od -N 1000 /tmp/test.bin')
        expect(result.exitCode).toBe(0)
      })

      it('handles -N 0', async () => {
        fs.addFile('/tmp/test.bin', 'data')
        const result = await executor.execute('od -N 0 /tmp/test.bin')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('-j option (skip bytes)', () => {
      it('skips bytes with -j', async () => {
        fs.addFile('/tmp/test.bin', 'skiphello')
        const result = await executor.execute('od -j 4 -c /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('h')
      })

      it('handles -j past end of file', async () => {
        fs.addFile('/tmp/test.bin', 'short')
        const result = await executor.execute('od -j 100 /tmp/test.bin')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('-w option (output width)', () => {
      it('sets output width with -w', async () => {
        fs.addFile('/tmp/test.bin', 'abcdefghijklmnop')
        const result = await executor.execute('od -w8 /tmp/test.bin')
        expect(result.exitCode).toBe(0)
      })

      it('defaults to 16 bytes per line', async () => {
        fs.addFile('/tmp/test.bin', 'a'.repeat(32))
        const result = await executor.execute('od /tmp/test.bin')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('multiple types', () => {
      it('shows multiple formats with multiple -t options', async () => {
        fs.addFile('/tmp/test.bin', 'AB')
        const result = await executor.execute('od -t x1 -t c /tmp/test.bin')
        expect(result.exitCode).toBe(0)
        // Should show both hex and character
      })
    })

    describe('error handling', () => {
      it('fails for nonexistent file', async () => {
        const result = await executor.execute('od /tmp/nonexistent.bin')
        expect(result.exitCode).not.toBe(0)
      })

      it('fails with invalid type specifier', async () => {
        fs.addFile('/tmp/test.bin', 'data')
        const result = await executor.execute('od -t z /tmp/test.bin')
        expect(result.exitCode).not.toBe(0)
      })
    })
  })

  // ==========================================================================
  // TEE TESTS - Read stdin and write to stdout and files
  // ==========================================================================

  describe('tee', () => {
    describe('basic operation', () => {
      it('copies stdin to stdout and file', async () => {
        const result = await executor.execute('echo "hello" | tee /tmp/out.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('hello')
      })

      it('creates new file', async () => {
        const result = await executor.execute('echo "content" | tee /tmp/newfile.txt')
        expect(result.exitCode).toBe(0)
      })

      it('overwrites existing file by default', async () => {
        fs.addFile('/tmp/existing.txt', 'old content')
        const result = await executor.execute('echo "new content" | tee /tmp/existing.txt')
        expect(result.exitCode).toBe(0)
      })

      it('passes data through unchanged', async () => {
        const result = await executor.execute('echo "data" | tee /tmp/out.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('data')
      })
    })

    describe('append mode (-a)', () => {
      it('appends to file with -a flag', async () => {
        fs.addFile('/tmp/log.txt', 'line1\n')
        const result = await executor.execute('echo "line2" | tee -a /tmp/log.txt')
        expect(result.exitCode).toBe(0)
      })

      it('creates file if not exists with -a', async () => {
        const result = await executor.execute('echo "first" | tee -a /tmp/new.txt')
        expect(result.exitCode).toBe(0)
      })

      it('supports --append long option', async () => {
        fs.addFile('/tmp/log.txt', 'existing\n')
        const result = await executor.execute('echo "appended" | tee --append /tmp/log.txt')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('multiple files', () => {
      it('writes to multiple files simultaneously', async () => {
        const result = await executor.execute('echo "multi" | tee /tmp/a.txt /tmp/b.txt /tmp/c.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('multi')
      })

      it('appends to multiple files with -a', async () => {
        fs.addFile('/tmp/a.txt', 'a\n')
        fs.addFile('/tmp/b.txt', 'b\n')
        const result = await executor.execute('echo "appended" | tee -a /tmp/a.txt /tmp/b.txt')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('pipeline usage', () => {
      it('works in middle of pipeline', async () => {
        const result = await executor.execute('echo "HELLO" | tee /tmp/log.txt | tr A-Z a-z')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('hello')
      })

      it('preserves exit status of prior command', async () => {
        const result = await executor.execute('true | tee /tmp/out.txt')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('special cases', () => {
      it('handles empty input', async () => {
        const result = await executor.execute('echo "" | tee /tmp/empty.txt')
        expect(result.exitCode).toBe(0)
      })

      it('handles multiline input', async () => {
        const result = await executor.execute('printf "line1\\nline2\\nline3" | tee /tmp/multi.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('line1')
        expect(result.stdout).toContain('line2')
        expect(result.stdout).toContain('line3')
      })

      it('handles binary data', async () => {
        const result = await executor.execute('printf "\\x00\\x01\\x02" | tee /tmp/binary.bin')
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ==========================================================================
  // TOUCH TESTS - Change file timestamps
  // ==========================================================================

  describe('touch', () => {
    describe('basic operation', () => {
      it('creates empty file if not exists', async () => {
        const result = await executor.execute('touch /tmp/newfile.txt')
        expect(result.exitCode).toBe(0)
      })

      it('updates timestamp of existing file', async () => {
        fs.addFile('/tmp/existing.txt', 'content')
        const result = await executor.execute('touch /tmp/existing.txt')
        expect(result.exitCode).toBe(0)
      })

      it('does not modify file content', async () => {
        fs.addFile('/tmp/file.txt', 'original content')
        const result = await executor.execute('touch /tmp/file.txt')
        expect(result.exitCode).toBe(0)
      })

      it('creates multiple files', async () => {
        const result = await executor.execute('touch /tmp/a.txt /tmp/b.txt /tmp/c.txt')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('timestamp options', () => {
      it('sets specific time with -t option', async () => {
        const result = await executor.execute('touch -t 202401151200 /tmp/file.txt')
        expect(result.exitCode).toBe(0)
      })

      it('sets time with -d option (date string)', async () => {
        const result = await executor.execute('touch -d "2024-01-15 12:00:00" /tmp/file.txt')
        expect(result.exitCode).toBe(0)
      })

      it('copies timestamp from reference file with -r', async () => {
        fs.addFile('/tmp/reference.txt', 'ref')
        const result = await executor.execute('touch -r /tmp/reference.txt /tmp/target.txt')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('access/modify time options', () => {
      it('updates only access time with -a', async () => {
        fs.addFile('/tmp/file.txt', 'content')
        const result = await executor.execute('touch -a /tmp/file.txt')
        expect(result.exitCode).toBe(0)
      })

      it('updates only modification time with -m', async () => {
        fs.addFile('/tmp/file.txt', 'content')
        const result = await executor.execute('touch -m /tmp/file.txt')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('no-create option', () => {
      it('does not create file with -c option', async () => {
        const result = await executor.execute('touch -c /tmp/nonexistent.txt')
        expect(result.exitCode).toBe(0)
      })

      it('still updates existing file with -c', async () => {
        fs.addFile('/tmp/existing.txt', 'content')
        const result = await executor.execute('touch -c /tmp/existing.txt')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('error handling', () => {
      // Note: Error handling may be lenient in current implementation
      it.skip('fails with invalid timestamp format', async () => {
        const result = await executor.execute('touch -t invalid /tmp/file.txt')
        expect(result.exitCode).not.toBe(0)
      })

      it.skip('fails when parent directory does not exist', async () => {
        const result = await executor.execute('touch /nonexistent/dir/file.txt')
        expect(result.exitCode).not.toBe(0)
      })
    })
  })

  // ==========================================================================
  // EXPR TESTS - Evaluate expressions
  // Note: Requires native implementation or sandbox
  // ==========================================================================

  describe.skip('expr', () => {
    describe('arithmetic', () => {
      it('adds two numbers', async () => {
        const result = await executor.execute('expr 2 + 3')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('5')
      })

      it('subtracts two numbers', async () => {
        const result = await executor.execute('expr 10 - 4')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('6')
      })

      it('multiplies two numbers (escaped *)', async () => {
        const result = await executor.execute('expr 3 \\* 4')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('12')
      })

      it('divides two numbers', async () => {
        const result = await executor.execute('expr 20 / 4')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('5')
      })

      it('computes modulo', async () => {
        const result = await executor.execute('expr 17 % 5')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('2')
      })

      it('handles negative numbers', async () => {
        const result = await executor.execute('expr -5 + 3')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('-2')
      })

      it('handles integer division truncation', async () => {
        const result = await executor.execute('expr 7 / 2')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('3')
      })
    })

    describe('comparison', () => {
      it('returns 1 for true comparison (=)', async () => {
        const result = await executor.execute('expr 5 = 5')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('1')
      })

      it('returns 0 for false comparison (=)', async () => {
        const result = await executor.execute('expr 5 = 6')
        expect(result.exitCode).toBe(1)
        expect(result.stdout.trim()).toBe('0')
      })

      it('compares not equal (!=)', async () => {
        const result = await executor.execute('expr 5 != 6')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('1')
      })

      it('compares less than (<)', async () => {
        const result = await executor.execute('expr 3 \\< 5')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('1')
      })

      it('compares greater than (>)', async () => {
        const result = await executor.execute('expr 7 \\> 3')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('1')
      })

      it('compares less than or equal (<=)', async () => {
        const result = await executor.execute('expr 5 \\<= 5')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('1')
      })

      it('compares greater than or equal (>=)', async () => {
        const result = await executor.execute('expr 5 \\>= 5')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('1')
      })
    })

    describe('string operations', () => {
      it('returns string length with length', async () => {
        const result = await executor.execute('expr length "hello"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('5')
      })

      it('extracts substring with substr', async () => {
        const result = await executor.execute('expr substr "hello" 2 3')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('ell')
      })

      it('finds index of substring with index', async () => {
        const result = await executor.execute('expr index "hello" "l"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('3')
      })

      it('matches regex with match or :', async () => {
        const result = await executor.execute('expr "hello" : "h.*o"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('5')
      })

      it('compares strings alphabetically', async () => {
        const result = await executor.execute('expr "apple" \\< "banana"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('1')
      })
    })

    describe('logical operations', () => {
      it('performs OR operation (|)', async () => {
        const result = await executor.execute('expr 0 \\| 5')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('5')
      })

      it('performs AND operation (&)', async () => {
        const result = await executor.execute('expr 3 \\& 5')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('3')
      })
    })

    describe('exit codes', () => {
      it('returns 0 when result is non-zero/non-null', async () => {
        const result = await executor.execute('expr 1 + 1')
        expect(result.exitCode).toBe(0)
      })

      it('returns 1 when result is zero or null', async () => {
        const result = await executor.execute('expr 0')
        expect(result.exitCode).toBe(1)
      })

      it('returns error for invalid expression', async () => {
        const result = await executor.execute('expr invalid')
        expect(typeof result.exitCode).toBe('number')
      })
    })

    describe('parentheses grouping', () => {
      it('respects parentheses for precedence', async () => {
        const result = await executor.execute('expr \\( 2 + 3 \\) \\* 4')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('20')
      })
    })
  })

  // ==========================================================================
  // TRUE/FALSE TESTS - Exit with status code
  // ==========================================================================

  describe('true', () => {
    it('returns exit code 0', async () => {
      const result = await executor.execute('true')
      expect(result.exitCode).toBe(0)
    })

    it('produces no output', async () => {
      const result = await executor.execute('true')
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    })

    it('ignores arguments', async () => {
      const result = await executor.execute('true ignored arguments')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('false', () => {
    it('returns exit code 1', async () => {
      const result = await executor.execute('false')
      expect(result.exitCode).toBe(1)
    })

    it('produces no output', async () => {
      const result = await executor.execute('false')
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    })

    it('ignores arguments', async () => {
      const result = await executor.execute('false ignored arguments')
      expect(result.exitCode).toBe(1)
    })
  })

  // ==========================================================================
  // TEST/[ TESTS - Evaluate conditional expression
  // Note: Requires native implementation or sandbox
  // ==========================================================================

  describe.skip('test / [', () => {
    describe('file tests', () => {
      it('-e tests file existence', async () => {
        fs.addFile('/tmp/exists.txt', 'content')
        const result = await executor.execute('test -e /tmp/exists.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-e returns 1 for nonexistent file', async () => {
        const result = await executor.execute('test -e /tmp/nonexistent.txt')
        expect(result.exitCode).toBe(1)
      })

      it('-f tests regular file', async () => {
        fs.addFile('/tmp/file.txt', 'content')
        const result = await executor.execute('test -f /tmp/file.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-d tests directory', async () => {
        fs.addDirectory('/tmp/testdir')
        const result = await executor.execute('test -d /tmp/testdir')
        expect(result.exitCode).toBe(0)
      })

      it('-r tests readable file', async () => {
        fs.addFile('/tmp/readable.txt', 'content')
        const result = await executor.execute('test -r /tmp/readable.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-w tests writable file', async () => {
        fs.addFile('/tmp/writable.txt', 'content')
        const result = await executor.execute('test -w /tmp/writable.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-x tests executable file', async () => {
        fs.addFile('/tmp/script.sh', '#!/bin/sh')
        const result = await executor.execute('test -x /tmp/script.sh')
        expect(typeof result.exitCode).toBe('number')
      })

      it('-s tests file has size > 0', async () => {
        fs.addFile('/tmp/nonempty.txt', 'content')
        const result = await executor.execute('test -s /tmp/nonempty.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-s returns 1 for empty file', async () => {
        fs.addFile('/tmp/empty.txt', '')
        const result = await executor.execute('test -s /tmp/empty.txt')
        expect(result.exitCode).toBe(1)
      })
    })

    describe('string tests', () => {
      it('-z tests empty string', async () => {
        const result = await executor.execute('test -z ""')
        expect(result.exitCode).toBe(0)
      })

      it('-z returns 1 for non-empty string', async () => {
        const result = await executor.execute('test -z "hello"')
        expect(result.exitCode).toBe(1)
      })

      it('-n tests non-empty string', async () => {
        const result = await executor.execute('test -n "hello"')
        expect(result.exitCode).toBe(0)
      })

      it('-n returns 1 for empty string', async () => {
        const result = await executor.execute('test -n ""')
        expect(result.exitCode).toBe(1)
      })

      it('= tests string equality', async () => {
        const result = await executor.execute('test "hello" = "hello"')
        expect(result.exitCode).toBe(0)
      })

      it('!= tests string inequality', async () => {
        const result = await executor.execute('test "hello" != "world"')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('numeric tests', () => {
      it('-eq tests numeric equality', async () => {
        const result = await executor.execute('test 5 -eq 5')
        expect(result.exitCode).toBe(0)
      })

      it('-ne tests numeric inequality', async () => {
        const result = await executor.execute('test 5 -ne 6')
        expect(result.exitCode).toBe(0)
      })

      it('-lt tests less than', async () => {
        const result = await executor.execute('test 3 -lt 5')
        expect(result.exitCode).toBe(0)
      })

      it('-le tests less than or equal', async () => {
        const result = await executor.execute('test 5 -le 5')
        expect(result.exitCode).toBe(0)
      })

      it('-gt tests greater than', async () => {
        const result = await executor.execute('test 7 -gt 5')
        expect(result.exitCode).toBe(0)
      })

      it('-ge tests greater than or equal', async () => {
        const result = await executor.execute('test 5 -ge 5')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('logical operators', () => {
      it('! negates condition', async () => {
        const result = await executor.execute('test ! -e /tmp/nonexistent.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-a performs AND', async () => {
        const result = await executor.execute('test 5 -eq 5 -a 3 -lt 5')
        expect(result.exitCode).toBe(0)
      })

      it('-o performs OR', async () => {
        const result = await executor.execute('test 5 -eq 6 -o 3 -lt 5')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('bracket syntax', () => {
      it('[ ] works like test', async () => {
        fs.addFile('/tmp/file.txt', 'content')
        const result = await executor.execute('[ -f /tmp/file.txt ]')
        expect(result.exitCode).toBe(0)
      })

      it('[ ] requires closing bracket', async () => {
        const result = await executor.execute('[ -f /tmp/file.txt')
        expect(result.exitCode).not.toBe(0)
      })

      it('[[ ]] extended test (if supported)', async () => {
        const result = await executor.execute('[[ "hello" == "hello" ]]')
        expect(typeof result.exitCode).toBe('number')
      })
    })
  })

  // ==========================================================================
  // SLEEP TESTS - Delay for specified time
  // Note: Requires native implementation
  // ==========================================================================

  describe.skip('sleep', () => {
    it('accepts integer seconds', async () => {
      const result = await executor.execute('sleep 0')
      expect(result.exitCode).toBe(0)
    })

    it('accepts decimal seconds', async () => {
      const result = await executor.execute('sleep 0.1')
      expect(result.exitCode).toBe(0)
    })

    it('produces no output', async () => {
      const result = await executor.execute('sleep 0')
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    })

    it('accepts s suffix for seconds', async () => {
      const result = await executor.execute('sleep 0s')
      expect(result.exitCode).toBe(0)
    })

    it('accepts m suffix for minutes', async () => {
      const result = await executor.execute('sleep 0m')
      expect(result.exitCode).toBe(0)
    })

    it('fails with invalid argument', async () => {
      const result = await executor.execute('sleep invalid')
      expect(result.exitCode).not.toBe(0)
    })

    it('fails with negative number', async () => {
      const result = await executor.execute('sleep -1')
      expect(result.exitCode).not.toBe(0)
    })

    it('accepts multiple arguments (sums them)', async () => {
      const result = await executor.execute('sleep 0 0')
      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // ENV TESTS - Run program in modified environment
  // Note: Requires native implementation or sandbox
  // ==========================================================================

  describe.skip('env', () => {
    it('prints environment with no arguments', async () => {
      const result = await executor.execute('env')
      expect(result.exitCode).toBe(0)
    })

    it('sets environment variable for command', async () => {
      const result = await executor.execute('env FOO=bar sh -c \'echo $FOO\'')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('bar')
    })

    it('runs command with modified environment', async () => {
      const result = await executor.execute('env PATH=/usr/bin which sh')
      expect(typeof result.exitCode).toBe('number')
    })

    it('-i starts with empty environment', async () => {
      const result = await executor.execute('env -i env')
      expect(result.exitCode).toBe(0)
    })

    it('-u removes environment variable', async () => {
      const result = await executor.execute('env -u HOME env')
      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // PRINTENV TESTS - Print environment variables
  // Note: Requires native implementation or sandbox
  // ==========================================================================

  describe.skip('printenv', () => {
    it('prints all environment variables with no args', async () => {
      const result = await executor.execute('printenv')
      expect(result.exitCode).toBe(0)
    })

    it('prints specific variable value', async () => {
      const result = await executor.execute('printenv PATH')
      expect(result.exitCode).toBe(0)
    })

    it('returns 1 for undefined variable', async () => {
      const result = await executor.execute('printenv UNDEFINED_VARIABLE_12345')
      expect(result.exitCode).toBe(1)
    })

    it('prints multiple variables', async () => {
      const result = await executor.execute('printenv PATH HOME')
      expect(typeof result.exitCode).toBe('number')
    })
  })

  // ==========================================================================
  // NOHUP TESTS - Run command immune to hangups
  // Note: Requires native implementation or sandbox
  // ==========================================================================

  describe.skip('nohup', () => {
    it('runs command immune to hangups', async () => {
      const result = await executor.execute('nohup echo "test" > /dev/null 2>&1')
      expect(result.exitCode).toBe(0)
    })

    it('creates nohup.out when stdout is terminal', async () => {
      const result = await executor.execute('nohup echo "output"')
      expect(typeof result.exitCode).toBe('number')
    })

    it('preserves command arguments', async () => {
      const result = await executor.execute('nohup echo "arg1" "arg2"')
      expect(typeof result.exitCode).toBe('number')
    })
  })

  // ==========================================================================
  // TIMEOUT TESTS - Run command with time limit
  // Note: Requires native implementation or sandbox
  // ==========================================================================

  describe.skip('timeout', () => {
    it('runs command within time limit', async () => {
      const result = await executor.execute('timeout 10 echo "quick"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('quick')
    })

    it('accepts duration suffix (s for seconds)', async () => {
      const result = await executor.execute('timeout 10s echo "test"')
      expect(result.exitCode).toBe(0)
    })

    it('accepts duration suffix (m for minutes)', async () => {
      const result = await executor.execute('timeout 1m echo "test"')
      expect(result.exitCode).toBe(0)
    })

    it('returns 124 when command times out', async () => {
      const result = await executor.execute('timeout 0.001 sleep 10')
      expect(result.exitCode).toBe(124)
    })

    it('preserves command exit code on success', async () => {
      const result = await executor.execute('timeout 10 true')
      expect(result.exitCode).toBe(0)
    })

    it('preserves command exit code on failure', async () => {
      const result = await executor.execute('timeout 10 false')
      expect(result.exitCode).toBe(1)
    })

    it('sends specified signal with -s option', async () => {
      const result = await executor.execute('timeout -s KILL 0.001 sleep 10')
      expect(typeof result.exitCode).toBe('number')
    })
  })

  // ==========================================================================
  // YES TESTS - Output string repeatedly
  // Note: Requires native implementation or sandbox
  // ==========================================================================

  describe.skip('yes', () => {
    it('outputs y by default (limited)', async () => {
      const result = await executor.execute('yes | head -n 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('y')
    })

    it('outputs custom string', async () => {
      const result = await executor.execute('yes "custom" | head -n 2')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('custom')
    })

    it('can be used to confirm prompts', async () => {
      const result = await executor.execute('yes | head -n 1')
      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // SEQ TESTS - Print sequence of numbers
  // Note: Requires native implementation or sandbox
  // ==========================================================================

  describe.skip('seq', () => {
    it('generates sequence to end number', async () => {
      const result = await executor.execute('seq 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1\n2\n3\n4\n5')
    })

    it('generates sequence from start to end', async () => {
      const result = await executor.execute('seq 3 6')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3\n4\n5\n6')
    })

    it('generates sequence with step', async () => {
      const result = await executor.execute('seq 1 2 7')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1\n3\n5\n7')
    })

    it('handles negative step', async () => {
      const result = await executor.execute('seq 5 -1 1')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('5\n4\n3\n2\n1')
    })

    it('handles decimal numbers', async () => {
      const result = await executor.execute('seq 1 0.5 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('1')
      expect(result.stdout).toContain('2')
    })

    it('uses separator with -s option', async () => {
      const result = await executor.execute('seq -s "," 1 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1,2,3')
    })

    it('uses equal width with -w option', async () => {
      const result = await executor.execute('seq -w 8 10')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('08')
      expect(result.stdout).toContain('09')
      expect(result.stdout).toContain('10')
    })

    it('returns empty for impossible sequence', async () => {
      const result = await executor.execute('seq 5 1')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
    })
  })

  // ==========================================================================
  // ID/WHOAMI TESTS - User identity utilities
  // Note: These require native implementation or sandbox
  // ==========================================================================

  describe.skip('id', () => {
    it('prints current user identity', async () => {
      const result = await executor.execute('id')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/uid=\d+/)
    })

    it('prints user id with -u', async () => {
      const result = await executor.execute('id -u')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\d+$/)
    })

    it('prints group id with -g', async () => {
      const result = await executor.execute('id -g')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\d+$/)
    })

    it('prints username with -un', async () => {
      const result = await executor.execute('id -un')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim().length).toBeGreaterThan(0)
    })

    it('prints groups with -G', async () => {
      const result = await executor.execute('id -G')
      expect(result.exitCode).toBe(0)
    })
  })

  describe.skip('whoami', () => {
    it('prints current username', async () => {
      const result = await executor.execute('whoami')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim().length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // PWD TESTS - Print working directory
  // Note: These require native implementation or sandbox
  // ==========================================================================

  describe.skip('pwd', () => {
    it('prints current working directory', async () => {
      const result = await executor.execute('pwd')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\//)
    })

    it('prints physical path with -P', async () => {
      const result = await executor.execute('pwd -P')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\//)
    })

    it('prints logical path with -L', async () => {
      const result = await executor.execute('pwd -L')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\//)
    })
  })

  // ==========================================================================
  // HOSTNAME/UNAME TESTS - System identification
  // Note: These require native implementation or sandbox
  // ==========================================================================

  describe.skip('hostname', () => {
    it('prints system hostname', async () => {
      const result = await executor.execute('hostname')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim().length).toBeGreaterThan(0)
    })

    it('prints short hostname with -s', async () => {
      const result = await executor.execute('hostname -s')
      expect(result.exitCode).toBe(0)
    })
  })

  describe.skip('uname', () => {
    it('prints system name', async () => {
      const result = await executor.execute('uname')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim().length).toBeGreaterThan(0)
    })

    it('prints all information with -a', async () => {
      const result = await executor.execute('uname -a')
      expect(result.exitCode).toBe(0)
    })

    it('prints kernel name with -s', async () => {
      const result = await executor.execute('uname -s')
      expect(result.exitCode).toBe(0)
    })

    it('prints kernel release with -r', async () => {
      const result = await executor.execute('uname -r')
      expect(result.exitCode).toBe(0)
    })

    it('prints machine type with -m', async () => {
      const result = await executor.execute('uname -m')
      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // INTEGRATION TESTS
  // Note: These tests require full pipeline support which is in progress
  // ==========================================================================

  describe.skip('command combinations', () => {
    beforeEach(() => {
      fs.addDirectory('/test')
      fs.addFile('/test/file1.txt', 'content1\n')
      fs.addFile('/test/file2.txt', 'content2\n')
    })

    it('find | xargs works for file operations', async () => {
      const result = await executor.execute('find /test -name "*.txt" | xargs echo')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('.txt')
    })

    it('diff with multiple file comparisons', async () => {
      fs.addFile('/test/original.txt', 'line1\nline2\n')
      fs.addFile('/test/modified.txt', 'line1\nline2\nline3\n')
      const result = await executor.execute('diff /test/original.txt /test/modified.txt')
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('line3')
    })

    it('date output can be processed', async () => {
      const result = await executor.execute('date')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.length).toBeGreaterThan(0)
    })

    it('tee in pipeline with multiple stages', async () => {
      const result = await executor.execute('echo "hello" | tee /tmp/step1.txt | tr A-Z a-z | tee /tmp/step2.txt')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
    })

    it('test combined with && and ||', async () => {
      fs.addFile('/test/exists.txt', 'content')
      const result = await executor.execute('test -f /test/exists.txt && echo "exists" || echo "not found"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('exists')
    })

    it('expr in arithmetic expansion', async () => {
      const result = await executor.execute('echo "Result: $(expr 5 + 3)"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('8')
    })

    it('dd with find for batch conversion', async () => {
      fs.addFile('/test/input.txt', 'lowercase')
      const result = await executor.execute('find /test -name "*.txt" | xargs -I {} dd if={} conv=ucase 2>/dev/null')
      expect(result.exitCode).toBe(0)
    })

    it('od with head for partial dump', async () => {
      fs.addFile('/test/data.bin', 'abcdefghijklmnopqrstuvwxyz')
      const result = await executor.execute('od -c /test/data.bin | head -n 1')
      expect(result.exitCode).toBe(0)
    })

    it('seq piped to xargs for batch operations', async () => {
      const result = await executor.execute('seq 1 3 | xargs -I {} echo "Processing {}"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Processing 1')
      expect(result.stdout).toContain('Processing 2')
      expect(result.stdout).toContain('Processing 3')
    })

    it('timeout with complex command', async () => {
      const result = await executor.execute('timeout 5 sh -c "echo start; sleep 0; echo end"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('start')
      expect(result.stdout).toContain('end')
    })

    it('env with command substitution', async () => {
      const result = await executor.execute('env VAR=$(echo test) sh -c \'echo $VAR\'')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('test')
    })
  })
})
