/**
 * POSIX File Operations Tests
 *
 * Comprehensive POSIX compliance tests for file operation utilities.
 * Tests cover basic operations, common flags per POSIX spec, error cases, and exit codes.
 *
 * Reference: POSIX.1-2024 (IEEE Std 1003.1-2024)
 * https://pubs.opengroup.org/onlinepubs/9799919799/
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestContext, type TestContext } from '../helpers/index'

describe('POSIX File Operations', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  // ============================================================================
  // cat - Concatenate and print files
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/cat.html
  // ============================================================================
  describe('cat', () => {
    it('reads from stdin when no file specified', async () => {
      const result = await ctx.exec('echo hello | cat')
      expect(result.stdout).toBe('hello\n')
      expect(result.exitCode).toBe(0)
    })

    it('reads from a single file', async () => {
      await ctx.createFile('test.txt', 'test content\n')
      const result = await ctx.exec('cat test.txt')
      expect(result.stdout).toBe('test content\n')
      expect(result.exitCode).toBe(0)
    })

    it('concatenates multiple files in order', async () => {
      await ctx.createFile('file1.txt', 'first\n')
      await ctx.createFile('file2.txt', 'second\n')
      await ctx.createFile('file3.txt', 'third\n')
      const result = await ctx.exec('cat file1.txt file2.txt file3.txt')
      expect(result.stdout).toBe('first\nsecond\nthird\n')
      expect(result.exitCode).toBe(0)
    })

    it('returns exit code 1 for nonexistent file', async () => {
      const result = await ctx.exec('cat nonexistent.txt')
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('nonexistent.txt')
    })

    it('reads binary files without modification', async () => {
      // Create a file with null bytes
      await ctx.exec('printf "\\x00\\x01\\x02" > binary.bin')
      const result = await ctx.exec('cat binary.bin | od -An -tx1')
      expect(result.stdout.trim()).toMatch(/00\s+01\s+02/)
      expect(result.exitCode).toBe(0)
    })

    it('reads from stdin when - is specified', async () => {
      const result = await ctx.exec('echo "from stdin" | cat -')
      expect(result.stdout).toBe('from stdin\n')
      expect(result.exitCode).toBe(0)
    })

    it('mixes file and stdin input with -', async () => {
      await ctx.createFile('before.txt', 'before\n')
      await ctx.createFile('after.txt', 'after\n')
      const result = await ctx.exec('echo "middle" | cat before.txt - after.txt')
      expect(result.stdout).toBe('before\nmiddle\nafter\n')
      expect(result.exitCode).toBe(0)
    })

    it('handles empty files', async () => {
      await ctx.createFile('empty.txt', '')
      const result = await ctx.exec('cat empty.txt')
      expect(result.stdout).toBe('')
      expect(result.exitCode).toBe(0)
    })

    it('preserves trailing newlines', async () => {
      await ctx.createFile('newlines.txt', 'line1\nline2\n')
      const result = await ctx.exec('cat newlines.txt')
      expect(result.stdout).toBe('line1\nline2\n')
    })

    it('handles files without trailing newlines', async () => {
      await ctx.exec('printf "no newline" > no-nl.txt')
      const result = await ctx.exec('cat no-nl.txt')
      expect(result.stdout).toBe('no newline')
      expect(result.exitCode).toBe(0)
    })
  })

  // ============================================================================
  // cp - Copy files and directories
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/cp.html
  // ============================================================================
  describe('cp', () => {
    it('copies file to new name', async () => {
      await ctx.createFile('source.txt', 'original content\n')
      const result = await ctx.exec('cp source.txt dest.txt')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('dest.txt')).toBe(true)
      expect(await ctx.readFile('dest.txt')).toBe('original content\n')
    })

    it('copies file to directory', async () => {
      await ctx.createFile('source.txt', 'content\n')
      await ctx.createDir('destdir')
      const result = await ctx.exec('cp source.txt destdir/')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('destdir/source.txt')).toBe(true)
      expect(await ctx.readFile('destdir/source.txt')).toBe('content\n')
    })

    it('-R copies directory recursively', async () => {
      await ctx.createDir('srcdir/subdir')
      await ctx.createFile('srcdir/file1.txt', 'file1\n')
      await ctx.createFile('srcdir/subdir/file2.txt', 'file2\n')
      const result = await ctx.exec('cp -R srcdir dstdir')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('dstdir/file1.txt')).toBe(true)
      expect(await ctx.exists('dstdir/subdir/file2.txt')).toBe(true)
      expect(await ctx.readFile('dstdir/subdir/file2.txt')).toBe('file2\n')
    })

    it('-p preserves timestamps and permissions', async () => {
      await ctx.createFile('source.txt', 'content\n')
      // Set specific modification time
      await ctx.exec('touch -t 202001011200 source.txt')
      const result = await ctx.exec('cp -p source.txt preserved.txt')
      expect(result.exitCode).toBe(0)

      // Compare modification times
      const srcStat = await ctx.stat('source.txt')
      const dstStat = await ctx.stat('preserved.txt')
      expect(dstStat.mtime.getTime()).toBe(srcStat.mtime.getTime())
    })

    it('-f forces overwrite of existing file', async () => {
      await ctx.createFile('source.txt', 'new content\n')
      await ctx.createFile('dest.txt', 'old content\n')
      // Make dest read-only
      await ctx.exec('chmod 444 dest.txt')
      const result = await ctx.exec('cp -f source.txt dest.txt')
      expect(result.exitCode).toBe(0)
      expect(await ctx.readFile('dest.txt')).toBe('new content\n')
    })

    it('fails when source file does not exist', async () => {
      const result = await ctx.exec('cp nonexistent.txt dest.txt')
      expect(result.exitCode).not.toBe(0)
    })

    it('fails when copying file to non-existent directory', async () => {
      await ctx.createFile('source.txt', 'content\n')
      const result = await ctx.exec('cp source.txt nonexistent/dest.txt')
      expect(result.exitCode).not.toBe(0)
    })

    it('copies multiple files to directory', async () => {
      await ctx.createFile('file1.txt', 'one\n')
      await ctx.createFile('file2.txt', 'two\n')
      await ctx.createDir('target')
      const result = await ctx.exec('cp file1.txt file2.txt target/')
      expect(result.exitCode).toBe(0)
      expect(await ctx.readFile('target/file1.txt')).toBe('one\n')
      expect(await ctx.readFile('target/file2.txt')).toBe('two\n')
    })

    it('preserves source file after copy', async () => {
      await ctx.createFile('source.txt', 'content\n')
      await ctx.exec('cp source.txt dest.txt')
      expect(await ctx.exists('source.txt')).toBe(true)
      expect(await ctx.readFile('source.txt')).toBe('content\n')
    })

    it('-r works like -R for directory copy', async () => {
      await ctx.createDir('srcdir')
      await ctx.createFile('srcdir/file.txt', 'content\n')
      const result = await ctx.exec('cp -r srcdir copydir')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('copydir/file.txt')).toBe(true)
    })
  })

  // ============================================================================
  // ln - Create links
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/ln.html
  // ============================================================================
  describe('ln', () => {
    it('creates hard link by default', async () => {
      await ctx.createFile('original.txt', 'content\n')
      const result = await ctx.exec('ln original.txt hardlink.txt')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('hardlink.txt')).toBe(true)

      // Verify same inode (hard link)
      const origStat = await ctx.stat('original.txt')
      const linkStat = await ctx.stat('hardlink.txt')
      expect(linkStat.ino).toBe(origStat.ino)
    })

    it('-s creates symbolic link', async () => {
      await ctx.createFile('target.txt', 'target content\n')
      const result = await ctx.exec('ln -s target.txt symlink.txt')
      expect(result.exitCode).toBe(0)

      // Verify it's a symlink
      const linkStat = await ctx.lstat('symlink.txt')
      expect(linkStat.isSymbolicLink()).toBe(true)

      // Verify content accessible through symlink
      expect(await ctx.readFile('symlink.txt')).toBe('target content\n')
    })

    it('-f forces overwrite of existing link', async () => {
      await ctx.createFile('target1.txt', 'first\n')
      await ctx.createFile('target2.txt', 'second\n')
      await ctx.exec('ln -s target1.txt link.txt')

      const result = await ctx.exec('ln -sf target2.txt link.txt')
      expect(result.exitCode).toBe(0)

      // Verify link now points to target2
      const linkTarget = await ctx.readlink('link.txt')
      expect(linkTarget).toBe('target2.txt')
    })

    it('symbolic link points to correct target', async () => {
      await ctx.createFile('real-file.txt', 'real content\n')
      await ctx.exec('ln -s real-file.txt my-link')
      const linkTarget = await ctx.readlink('my-link')
      expect(linkTarget).toBe('real-file.txt')
    })

    it('fails when link target does not exist for hard link', async () => {
      const result = await ctx.exec('ln nonexistent.txt link.txt')
      expect(result.exitCode).not.toBe(0)
    })

    it('allows symbolic link to non-existent target (dangling link)', async () => {
      const result = await ctx.exec('ln -s nonexistent.txt dangling.txt')
      expect(result.exitCode).toBe(0)

      // Verify symlink exists but target doesn't
      const linkStat = await ctx.lstat('dangling.txt')
      expect(linkStat.isSymbolicLink()).toBe(true)
      expect(await ctx.exists('nonexistent.txt')).toBe(false)
    })

    it('hard link shares content with original', async () => {
      await ctx.createFile('original.txt', 'original\n')
      await ctx.exec('ln original.txt hardlink.txt')

      // Modify through hard link
      await ctx.exec('echo "modified" > hardlink.txt')

      // Original should also be modified
      expect(await ctx.readFile('original.txt')).toBe('modified\n')
    })

    it('creates relative symbolic link', async () => {
      await ctx.createDir('subdir')
      await ctx.createFile('subdir/target.txt', 'content\n')
      const result = await ctx.exec('ln -s subdir/target.txt link-to-subdir')
      expect(result.exitCode).toBe(0)
      expect(await ctx.readFile('link-to-subdir')).toBe('content\n')
    })

    it('fails without -f when link already exists', async () => {
      await ctx.createFile('target.txt', 'content\n')
      await ctx.createFile('existing.txt', 'existing\n')
      const result = await ctx.exec('ln -s target.txt existing.txt')
      expect(result.exitCode).not.toBe(0)
    })

    it('cannot create hard link to directory', async () => {
      await ctx.createDir('mydir')
      const result = await ctx.exec('ln mydir dirlink')
      expect(result.exitCode).not.toBe(0)
    })
  })

  // ============================================================================
  // ls - List directory contents
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/ls.html
  // ============================================================================
  describe('ls', () => {
    it('lists current directory by default', async () => {
      await ctx.createFile('file1.txt', '')
      await ctx.createFile('file2.txt', '')
      const result = await ctx.exec('ls')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('file1.txt')
      expect(result.stdout).toContain('file2.txt')
    })

    it('-a shows hidden files', async () => {
      await ctx.createFile('.hidden', '')
      await ctx.createFile('visible.txt', '')
      const result = await ctx.exec('ls -a')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('.hidden')
      expect(result.stdout).toContain('visible.txt')
    })

    it('-l shows long format', async () => {
      await ctx.createFile('testfile.txt', 'content')
      const result = await ctx.exec('ls -l')
      expect(result.exitCode).toBe(0)
      // Long format includes permissions, links, owner, group, size, date
      expect(result.stdout).toMatch(/-rw/)
      expect(result.stdout).toContain('testfile.txt')
    })

    it('-R lists recursively', async () => {
      await ctx.createDir('subdir')
      await ctx.createFile('top.txt', '')
      await ctx.createFile('subdir/nested.txt', '')
      const result = await ctx.exec('ls -R')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('top.txt')
      expect(result.stdout).toContain('subdir')
      expect(result.stdout).toContain('nested.txt')
    })

    it('-d shows directory itself, not contents', async () => {
      await ctx.createDir('mydir')
      await ctx.createFile('mydir/file.txt', '')
      const result = await ctx.exec('ls -d mydir')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('mydir')
      expect(result.stdout).not.toContain('file.txt')
    })

    it('lists files in specified directory', async () => {
      await ctx.createDir('targetdir')
      await ctx.createFile('targetdir/file.txt', '')
      const result = await ctx.exec('ls targetdir')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('file.txt')
    })

    it('-1 lists one file per line', async () => {
      await ctx.createFile('a.txt', '')
      await ctx.createFile('b.txt', '')
      await ctx.createFile('c.txt', '')
      const result = await ctx.exec('ls -1')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines.length).toBe(3)
    })

    it('returns non-zero for nonexistent directory', async () => {
      const result = await ctx.exec('ls nonexistent')
      expect(result.exitCode).not.toBe(0)
    })

    it('-la combines hidden files and long format', async () => {
      await ctx.createFile('.hidden', 'secret')
      await ctx.createFile('visible.txt', 'public')
      const result = await ctx.exec('ls -la')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('.hidden')
      expect(result.stdout).toContain('visible.txt')
      expect(result.stdout).toMatch(/-rw/)
    })

    it('handles empty directory', async () => {
      await ctx.createDir('emptydir')
      const result = await ctx.exec('ls emptydir')
      expect(result.exitCode).toBe(0)
      // Output may be empty or contain only whitespace
      expect(result.stdout.trim()).toBe('')
    })
  })

  // ============================================================================
  // mkdir - Make directories
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/mkdir.html
  // ============================================================================
  describe('mkdir', () => {
    it('creates directory', async () => {
      const result = await ctx.exec('mkdir newdir')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('newdir')).toBe(true)
      const stat = await ctx.stat('newdir')
      expect(stat.isDirectory()).toBe(true)
    })

    it('-p creates parent directories', async () => {
      const result = await ctx.exec('mkdir -p deep/nested/path')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('deep/nested/path')).toBe(true)
      const stat = await ctx.stat('deep/nested/path')
      expect(stat.isDirectory()).toBe(true)
    })

    it('-m sets mode/permissions', async () => {
      const result = await ctx.exec('mkdir -m 700 restricted')
      expect(result.exitCode).toBe(0)
      const stat = await ctx.stat('restricted')
      // Check mode (permissions) - 700 = owner rwx only
      const mode = stat.mode & 0o777
      expect(mode).toBe(0o700)
    })

    it('fails if directory already exists', async () => {
      await ctx.createDir('existing')
      const result = await ctx.exec('mkdir existing')
      expect(result.exitCode).not.toBe(0)
    })

    it('-p succeeds if directory already exists', async () => {
      await ctx.createDir('existing')
      const result = await ctx.exec('mkdir -p existing')
      expect(result.exitCode).toBe(0)
    })

    it('fails if parent directory does not exist without -p', async () => {
      const result = await ctx.exec('mkdir nonexistent/child')
      expect(result.exitCode).not.toBe(0)
    })

    it('creates multiple directories at once', async () => {
      const result = await ctx.exec('mkdir dir1 dir2 dir3')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('dir1')).toBe(true)
      expect(await ctx.exists('dir2')).toBe(true)
      expect(await ctx.exists('dir3')).toBe(true)
    })

    it('-p creates intermediate directories with default permissions', async () => {
      await ctx.exec('mkdir -p a/b/c')
      expect(await ctx.exists('a')).toBe(true)
      expect(await ctx.exists('a/b')).toBe(true)
      expect(await ctx.exists('a/b/c')).toBe(true)
    })

    it('fails when path is a file', async () => {
      await ctx.createFile('existing-file', '')
      const result = await ctx.exec('mkdir existing-file')
      expect(result.exitCode).not.toBe(0)
    })

    it('handles mixed existing and new directories with -p', async () => {
      await ctx.createDir('existing')
      const result = await ctx.exec('mkdir -p existing/new/deep')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('existing/new/deep')).toBe(true)
    })
  })

  // ============================================================================
  // mv - Move (rename) files
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/mv.html
  // ============================================================================
  describe('mv', () => {
    it('renames file', async () => {
      await ctx.createFile('old.txt', 'content\n')
      const result = await ctx.exec('mv old.txt new.txt')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('old.txt')).toBe(false)
      expect(await ctx.exists('new.txt')).toBe(true)
      expect(await ctx.readFile('new.txt')).toBe('content\n')
    })

    it('moves file to directory', async () => {
      await ctx.createFile('source.txt', 'content\n')
      await ctx.createDir('targetdir')
      const result = await ctx.exec('mv source.txt targetdir/')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('source.txt')).toBe(false)
      expect(await ctx.exists('targetdir/source.txt')).toBe(true)
    })

    it('-f forces overwrite without prompt', async () => {
      await ctx.createFile('source.txt', 'new content\n')
      await ctx.createFile('dest.txt', 'old content\n')
      const result = await ctx.exec('mv -f source.txt dest.txt')
      expect(result.exitCode).toBe(0)
      expect(await ctx.readFile('dest.txt')).toBe('new content\n')
    })

    it('moves directory', async () => {
      await ctx.createDir('srcdir')
      await ctx.createFile('srcdir/file.txt', 'content\n')
      const result = await ctx.exec('mv srcdir dstdir')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('srcdir')).toBe(false)
      expect(await ctx.exists('dstdir')).toBe(true)
      expect(await ctx.exists('dstdir/file.txt')).toBe(true)
    })

    it('fails when source does not exist', async () => {
      const result = await ctx.exec('mv nonexistent.txt dest.txt')
      expect(result.exitCode).not.toBe(0)
    })

    it('moves multiple files to directory', async () => {
      await ctx.createFile('file1.txt', 'one\n')
      await ctx.createFile('file2.txt', 'two\n')
      await ctx.createDir('target')
      const result = await ctx.exec('mv file1.txt file2.txt target/')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('file1.txt')).toBe(false)
      expect(await ctx.exists('file2.txt')).toBe(false)
      expect(await ctx.exists('target/file1.txt')).toBe(true)
      expect(await ctx.exists('target/file2.txt')).toBe(true)
    })

    it('preserves file content during move', async () => {
      const content = 'test content with special chars: \t\n'
      await ctx.createFile('source.txt', content)
      await ctx.exec('mv source.txt moved.txt')
      expect(await ctx.readFile('moved.txt')).toBe(content)
    })

    it('fails when moving multiple files to non-directory', async () => {
      await ctx.createFile('file1.txt', '')
      await ctx.createFile('file2.txt', '')
      await ctx.createFile('notadir', '')
      const result = await ctx.exec('mv file1.txt file2.txt notadir')
      expect(result.exitCode).not.toBe(0)
    })

    it('renames directory', async () => {
      await ctx.createDir('oldname')
      await ctx.createFile('oldname/file.txt', '')
      const result = await ctx.exec('mv oldname newname')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('oldname')).toBe(false)
      expect(await ctx.exists('newname/file.txt')).toBe(true)
    })

    it('moves file to directory with different name', async () => {
      await ctx.createFile('original.txt', 'content\n')
      await ctx.createDir('dest')
      const result = await ctx.exec('mv original.txt dest/renamed.txt')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('original.txt')).toBe(false)
      expect(await ctx.exists('dest/renamed.txt')).toBe(true)
    })
  })

  // ============================================================================
  // rm - Remove files or directories
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/rm.html
  // ============================================================================
  describe('rm', () => {
    it('removes file', async () => {
      await ctx.createFile('deleteme.txt', 'content\n')
      const result = await ctx.exec('rm deleteme.txt')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('deleteme.txt')).toBe(false)
    })

    it('-r removes directory recursively', async () => {
      await ctx.createDir('deldir/subdir')
      await ctx.createFile('deldir/file.txt', '')
      await ctx.createFile('deldir/subdir/nested.txt', '')
      const result = await ctx.exec('rm -r deldir')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('deldir')).toBe(false)
    })

    it('-f forces removal, no error on nonexistent', async () => {
      const result = await ctx.exec('rm -f nonexistent.txt')
      expect(result.exitCode).toBe(0)
    })

    it('fails on nonexistent file without -f', async () => {
      const result = await ctx.exec('rm nonexistent.txt')
      expect(result.exitCode).not.toBe(0)
    })

    it('-rf combines recursive and force', async () => {
      await ctx.createDir('dir')
      await ctx.createFile('dir/file.txt', '')
      const result = await ctx.exec('rm -rf dir')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('dir')).toBe(false)
    })

    it('removes multiple files', async () => {
      await ctx.createFile('file1.txt', '')
      await ctx.createFile('file2.txt', '')
      await ctx.createFile('file3.txt', '')
      const result = await ctx.exec('rm file1.txt file2.txt file3.txt')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('file1.txt')).toBe(false)
      expect(await ctx.exists('file2.txt')).toBe(false)
      expect(await ctx.exists('file3.txt')).toBe(false)
    })

    it('fails to remove directory without -r', async () => {
      await ctx.createDir('mydir')
      const result = await ctx.exec('rm mydir')
      expect(result.exitCode).not.toBe(0)
      expect(await ctx.exists('mydir')).toBe(true)
    })

    it('removes read-only file with -f', async () => {
      await ctx.createFile('readonly.txt', '')
      await ctx.exec('chmod 444 readonly.txt')
      const result = await ctx.exec('rm -f readonly.txt')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('readonly.txt')).toBe(false)
    })

    it('-R is equivalent to -r', async () => {
      await ctx.createDir('testdir')
      await ctx.createFile('testdir/file.txt', '')
      const result = await ctx.exec('rm -R testdir')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('testdir')).toBe(false)
    })

    it('removes symlink without following', async () => {
      await ctx.createFile('target.txt', 'content\n')
      await ctx.exec('ln -s target.txt link.txt')
      const result = await ctx.exec('rm link.txt')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('link.txt')).toBe(false)
      expect(await ctx.exists('target.txt')).toBe(true)
    })
  })

  // ============================================================================
  // rmdir - Remove directories
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/rmdir.html
  // ============================================================================
  describe('rmdir', () => {
    it('removes empty directory', async () => {
      await ctx.createDir('emptydir')
      const result = await ctx.exec('rmdir emptydir')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('emptydir')).toBe(false)
    })

    it('fails on non-empty directory', async () => {
      await ctx.createDir('nonempty')
      await ctx.createFile('nonempty/file.txt', '')
      const result = await ctx.exec('rmdir nonempty')
      expect(result.exitCode).not.toBe(0)
      expect(await ctx.exists('nonempty')).toBe(true)
    })

    it('-p removes parent directories', async () => {
      await ctx.createDir('a/b/c')
      const result = await ctx.exec('rmdir -p a/b/c')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('a')).toBe(false)
      expect(await ctx.exists('a/b')).toBe(false)
      expect(await ctx.exists('a/b/c')).toBe(false)
    })

    it('fails on nonexistent directory', async () => {
      const result = await ctx.exec('rmdir nonexistent')
      expect(result.exitCode).not.toBe(0)
    })

    it('removes multiple empty directories', async () => {
      await ctx.createDir('dir1')
      await ctx.createDir('dir2')
      await ctx.createDir('dir3')
      const result = await ctx.exec('rmdir dir1 dir2 dir3')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('dir1')).toBe(false)
      expect(await ctx.exists('dir2')).toBe(false)
      expect(await ctx.exists('dir3')).toBe(false)
    })

    it('-p stops at non-empty parent', async () => {
      await ctx.createDir('parent/child')
      await ctx.createFile('parent/sibling.txt', '')
      const result = await ctx.exec('rmdir -p parent/child')
      // child should be removed but parent should remain
      expect(await ctx.exists('parent/child')).toBe(false)
      expect(await ctx.exists('parent')).toBe(true)
      // exit code may be non-zero since parent couldn't be removed
    })

    it('fails on file', async () => {
      await ctx.createFile('notadir.txt', '')
      const result = await ctx.exec('rmdir notadir.txt')
      expect(result.exitCode).not.toBe(0)
    })

    it('removes directories with special characters in name', async () => {
      await ctx.createDir('dir with spaces')
      const result = await ctx.exec('rmdir "dir with spaces"')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('dir with spaces')).toBe(false)
    })

    it('handles . and .. in path', async () => {
      await ctx.createDir('parent/child')
      const result = await ctx.exec('rmdir parent/child/../child')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('parent/child')).toBe(false)
    })

    it('preserves parent when only leaf removed without -p', async () => {
      await ctx.createDir('outer/inner')
      const result = await ctx.exec('rmdir outer/inner')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('outer/inner')).toBe(false)
      expect(await ctx.exists('outer')).toBe(true)
    })
  })
})
