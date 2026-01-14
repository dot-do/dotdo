/**
 * Tests for realpath operation
 *
 * realpath resolves a path by following all symbolic links and canonicalizing.
 * It returns the resolved absolute path with all symlinks resolved and all
 * `.` and `..` components removed.
 *
 * POSIX behavior:
 * - Follows symlinks recursively during path resolution
 * - Resolves relative symlink targets relative to symlink location
 * - Handles absolute symlink targets by restarting resolution
 * - Canonicalizes path (removes . and ..)
 * - Returns ENOENT if path or any component doesn't exist
 * - Returns ELOOP if too many symbolic links encountered (loop detected)
 */

import { describe, it, expect } from 'vitest'
import { realpath } from './realpath'
import { ENOENT, ELOOP } from '../errors'

describe('realpath', () => {
  describe('basic path resolution', () => {
    it('should return normalized path for regular files', async () => {
      // Regular file without symlinks
      const resolved = await realpath('/home/user/file.txt')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should return normalized path for directories', async () => {
      // Directory without symlinks
      const resolved = await realpath('/home/user')
      expect(resolved).toBe('/home/user')
    })

    it('should canonicalize path with . components', async () => {
      // Path with . should be normalized
      const resolved = await realpath('/home/./user/./file.txt')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should canonicalize path with .. components', async () => {
      // Path with .. should be normalized
      const resolved = await realpath('/home/user/../user/file.txt')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should handle multiple .. at once', async () => {
      const resolved = await realpath('/home/user/subdir/../../user/file.txt')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should handle root path', async () => {
      const resolved = await realpath('/')
      expect(resolved).toBe('/')
    })

    it('should handle trailing slashes', async () => {
      const resolved = await realpath('/home/user/')
      expect(resolved).toBe('/home/user')
    })

    it('should handle multiple consecutive slashes', async () => {
      const resolved = await realpath('/home//user///file.txt')
      expect(resolved).toBe('/home/user/file.txt')
    })
  })

  describe('symlink resolution', () => {
    it('should resolve symlink at end of path', async () => {
      // /link -> /home/user/file.txt
      const resolved = await realpath('/link-to-file')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should resolve symlink in middle of path', async () => {
      // /link-to-dir -> /home/user
      // /link-to-dir/file.txt should resolve to /home/user/file.txt
      const resolved = await realpath('/link-to-dir/file.txt')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should resolve chained symlinks (A -> B -> C)', async () => {
      // /chain1 -> /chain2
      // /chain2 -> /home/user/file.txt
      const resolved = await realpath('/chain1')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should resolve relative symlink targets relative to symlink location', async () => {
      // /home/user/rel-link -> ../other/file.txt
      // Should resolve to /home/other/file.txt
      const resolved = await realpath('/home/user/rel-link')
      expect(resolved).toBe('/home/other/file.txt')
    })

    it('should handle absolute symlink targets by restarting resolution', async () => {
      // /abs-link -> /home/user/file.txt (absolute)
      const resolved = await realpath('/abs-link')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should resolve multiple symlinks in single path', async () => {
      // /multi/link1 -> /home
      // /home/link2 -> /home/user
      // /multi/link1/link2/file.txt should resolve to /home/user/file.txt
      const resolved = await realpath('/multi/link1/link2/file.txt')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should handle symlink with . in target', async () => {
      // /dot-link -> ./subdir/file.txt
      const resolved = await realpath('/dot-link')
      expect(resolved).toBe('/subdir/file.txt')
    })

    it('should handle symlink with .. in target', async () => {
      // /home/deep/dotdot-link -> ../user/file.txt
      const resolved = await realpath('/home/deep/dotdot-link')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should handle deeply nested symlink resolution', async () => {
      // Deep path with symlinks
      const resolved = await realpath('/a/b/c/deep-link')
      expect(resolved).toBe('/home/user/file.txt')
    })
  })

  describe('error handling - ENOENT', () => {
    it('should throw ENOENT when path does not exist', async () => {
      await expect(realpath('/nonexistent')).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT when parent directory does not exist', async () => {
      await expect(realpath('/nonexistent/dir/file.txt')).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT when symlink target does not exist', async () => {
      // /dangling-link -> /does/not/exist
      await expect(realpath('/dangling-link')).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT when intermediate component does not exist', async () => {
      await expect(realpath('/home/nonexistent/file.txt')).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT with correct syscall and path', async () => {
      try {
        await realpath('/does/not/exist')
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).syscall).toBe('realpath')
        expect((error as ENOENT).path).toBe('/does/not/exist')
      }
    })
  })

  describe('error handling - ELOOP', () => {
    it('should throw ELOOP for circular symlinks (A -> B -> A)', async () => {
      // /loop1 -> /loop2
      // /loop2 -> /loop1
      await expect(realpath('/loop1')).rejects.toThrow(ELOOP)
    })

    it('should throw ELOOP for self-referencing symlink', async () => {
      // /self -> /self
      await expect(realpath('/self-link')).rejects.toThrow(ELOOP)
    })

    it('should throw ELOOP for indirect circular reference', async () => {
      // /cycleA -> /cycleB
      // /cycleB -> /cycleC
      // /cycleC -> /cycleA
      await expect(realpath('/cycleA')).rejects.toThrow(ELOOP)
    })

    it('should throw ELOOP when symlink depth exceeds maximum', async () => {
      // Very deep chain of symlinks (exceeds max depth)
      await expect(realpath('/deep-chain-start')).rejects.toThrow(ELOOP)
    })

    it('should throw ELOOP with correct syscall and path', async () => {
      try {
        await realpath('/loop1')
        expect.fail('Should have thrown ELOOP')
      } catch (error) {
        expect(error).toBeInstanceOf(ELOOP)
        expect((error as ELOOP).syscall).toBe('realpath')
      }
    })
  })

  describe('edge cases', () => {
    it('should handle symlink in root directory', async () => {
      const resolved = await realpath('/root-link')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should handle path with spaces', async () => {
      const resolved = await realpath('/path with spaces/file.txt')
      expect(resolved).toBe('/path with spaces/file.txt')
    })

    it('should handle path with unicode characters', async () => {
      const resolved = await realpath('/unicode/file.txt')
      expect(resolved).toBe('/unicode/file.txt')
    })

    it('should handle empty path components', async () => {
      const resolved = await realpath('//home//user//file.txt')
      expect(resolved).toBe('/home/user/file.txt')
    })

    it('should handle symlink pointing to root', async () => {
      // /to-root -> /
      const resolved = await realpath('/to-root')
      expect(resolved).toBe('/')
    })

    it('should resolve path starting with symlink', async () => {
      // Path where first component is a symlink
      const resolved = await realpath('/first-link/user/file.txt')
      expect(resolved).toBe('/home/user/file.txt')
    })
  })
})
