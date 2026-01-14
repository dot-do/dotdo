/**
 * Input Validation Security Tests (RED phase)
 *
 * These tests verify that the filesystem properly rejects malicious or invalid inputs.
 * All tests should FAIL initially until input validation is implemented.
 *
 * Attack vectors tested:
 * - Null bytes in paths (path truncation attacks)
 * - Excessively long paths (buffer overflow, DoS)
 * - Invalid/control characters (command injection, encoding issues)
 * - Empty/whitespace-only paths (logic errors)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryStorage,
  createTestFilesystem,
  MockDurableObjectStub,
} from '../../tests/test-utils'

describe('Input Validation Security', () => {
  let storage: InMemoryStorage
  let stub: MockDurableObjectStub

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  describe('Null Byte Injection', () => {
    /**
     * Null bytes can truncate strings in C-based systems, leading to
     * path traversal or file access vulnerabilities.
     * Example: "/tmp/safe.txt\x00.evil" might be interpreted as "/tmp/safe.txt"
     */

    it('should reject paths containing null bytes (\\x00)', () => {
      const maliciousPath = '/home/user/file.txt\x00.evil'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|null/i)
    })

    it('should reject paths with URL-encoded null bytes (%00)', () => {
      const maliciousPath = '/home/user/file.txt%00.evil'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|null/i)
    })

    it('should reject paths with null byte in directory component', () => {
      const maliciousPath = '/home/user\x00evil/file.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|null/i)
    })

    it('should reject null byte at path start', () => {
      const maliciousPath = '\x00/home/user/file.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|null/i)
    })

    it('should reject null byte in readFileAsString', () => {
      const maliciousPath = '/home/user/hello.txt\x00'

      expect(() => storage.readFileAsString(maliciousPath)).toThrow(/invalid|null/i)
    })

    it('should reject null byte via RPC writeFile', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'writeFile',
          params: {
            path: '/home/user/file.txt\x00.evil',
            data: btoa('content'),
            encoding: 'base64',
          },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })

    it('should reject null byte via RPC readFile', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/home/user/hello.txt\x00' },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })
  })

  describe('Path Length Limits', () => {
    /**
     * Extremely long paths can cause:
     * - Buffer overflows in unsafe languages
     * - Denial of Service (memory exhaustion)
     * - Stack overflow in recursive processing
     * Maximum reasonable path length: 4096 characters (Linux PATH_MAX)
     */

    it('should reject paths exceeding 4096 characters', () => {
      const longPath = '/home/user/' + 'a'.repeat(4100)

      expect(() => storage.addFile(longPath, 'content')).toThrow(/too long|length|limit/i)
    })

    it('should reject paths with exactly 4097 characters', () => {
      const longPath = '/' + 'a'.repeat(4096)

      expect(() => storage.addFile(longPath, 'content')).toThrow(/too long|length|limit/i)
    })

    it('should accept paths with exactly 4096 characters', () => {
      const maxPath = '/' + 'a'.repeat(4095) // 4096 total with leading slash

      // This should NOT throw - it's at the limit
      expect(() => storage.addFile(maxPath, 'content')).not.toThrow()
    })

    it('should reject deeply nested paths exceeding limit', () => {
      // Create a path with many short segments that exceed total limit
      const segments = Array(2000).fill('dir').join('/')
      const longPath = '/' + segments

      expect(() => storage.addFile(longPath, 'content')).toThrow(/too long|length|limit/i)
    })

    it('should reject path with very long single component', () => {
      // Single filename component > 255 chars (NAME_MAX)
      const longFilename = 'a'.repeat(300) + '.txt'
      const path = '/home/user/' + longFilename

      expect(() => storage.addFile(path, 'content')).toThrow(/too long|name|limit/i)
    })

    it('should reject long path via RPC', async () => {
      const longPath = '/home/user/' + 'a'.repeat(4100)

      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'writeFile',
          params: {
            path: longPath,
            data: btoa('content'),
            encoding: 'base64',
          },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENAMETOOLONG')
    })
  })

  describe('Invalid Characters', () => {
    /**
     * Control characters and certain unicode can cause:
     * - Terminal injection attacks
     * - Log injection/spoofing
     * - Encoding confusion attacks
     * - Command injection when paths are used in shell commands
     */

    it('should reject paths with ASCII control characters (0x01-0x1F)', () => {
      const controlChars = [
        '\x01', '\x02', '\x03', '\x04', '\x05', '\x06', '\x07', // 0x01-0x07
        '\x08', '\x0B', '\x0C', '\x0E', '\x0F',                 // 0x08, 0x0B, 0x0C, 0x0E, 0x0F
        '\x10', '\x11', '\x12', '\x13', '\x14', '\x15', '\x16', '\x17', // 0x10-0x17
        '\x18', '\x19', '\x1A', '\x1B', '\x1C', '\x1D', '\x1E', '\x1F', // 0x18-0x1F
      ]

      for (const char of controlChars) {
        const path = `/home/user/file${char}name.txt`
        expect(() => storage.addFile(path, 'content')).toThrow(/invalid|control|character/i)
      }
    })

    it('should reject paths with newline characters (\\n)', () => {
      const maliciousPath = '/home/user/file\nname.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|newline|character/i)
    })

    it('should reject paths with carriage return (\\r)', () => {
      const maliciousPath = '/home/user/file\rname.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|carriage|character/i)
    })

    it('should reject paths with tab characters (\\t)', () => {
      const maliciousPath = '/home/user/file\tname.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|tab|character/i)
    })

    it('should reject paths with bell character (\\x07)', () => {
      const maliciousPath = '/home/user/file\x07name.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|control|character/i)
    })

    it('should reject paths with escape sequences (\\x1B)', () => {
      // ANSI escape sequences can manipulate terminal output
      const maliciousPath = '/home/user/file\x1B[31mname.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|escape|character/i)
    })

    it('should reject paths with DEL character (\\x7F)', () => {
      const maliciousPath = '/home/user/file\x7Fname.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|control|character/i)
    })

    it('should reject paths with Unicode replacement character (U+FFFD)', () => {
      const maliciousPath = '/home/user/file\uFFFDname.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|unicode|character/i)
    })

    it('should reject paths with Unicode null (U+0000)', () => {
      const maliciousPath = '/home/user/file\u0000name.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|null/i)
    })

    it('should reject paths with Unicode line separator (U+2028)', () => {
      const maliciousPath = '/home/user/file\u2028name.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|line|separator/i)
    })

    it('should reject paths with Unicode paragraph separator (U+2029)', () => {
      const maliciousPath = '/home/user/file\u2029name.txt'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|paragraph|separator/i)
    })

    it('should reject paths with right-to-left override (U+202E)', () => {
      // RTL override can be used to visually disguise file extensions
      // "file\u202Etxt.exe" displays as "fileexe.txt" but is actually "file<RTL>txt.exe"
      const maliciousPath = '/home/user/file\u202Etxt.exe'

      expect(() => storage.addFile(maliciousPath, 'content')).toThrow(/invalid|bidi|override/i)
    })

    it('should reject invalid characters via RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'writeFile',
          params: {
            path: '/home/user/file\x07name.txt',
            data: btoa('content'),
            encoding: 'base64',
          },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })
  })

  describe('Empty and Whitespace Paths', () => {
    /**
     * Empty or whitespace-only paths can cause:
     * - Logic errors (operations on root or undefined paths)
     * - Access control bypasses
     * - Confusion in path joining operations
     */

    it('should reject empty string path', () => {
      expect(() => storage.addFile('', 'content')).toThrow(/invalid|empty|path/i)
    })

    it('should reject whitespace-only path (spaces)', () => {
      expect(() => storage.addFile('   ', 'content')).toThrow(/invalid|empty|whitespace/i)
    })

    it('should reject whitespace-only path (tabs)', () => {
      expect(() => storage.addFile('\t\t\t', 'content')).toThrow(/invalid|empty|whitespace/i)
    })

    it('should reject whitespace-only path (mixed)', () => {
      expect(() => storage.addFile('  \t  \t  ', 'content')).toThrow(/invalid|empty|whitespace/i)
    })

    it('should reject path with only dots', () => {
      // "." is current dir, ".." is parent - neither should be valid file paths
      expect(() => storage.addFile('.', 'content')).toThrow(/invalid|path/i)
      expect(() => storage.addFile('..', 'content')).toThrow(/invalid|path/i)
    })

    it('should reject path ending in whitespace', () => {
      const path = '/home/user/file.txt   '

      expect(() => storage.addFile(path, 'content')).toThrow(/invalid|whitespace|trailing/i)
    })

    it('should reject path starting with whitespace after slash', () => {
      const path = '/home/user/   file.txt'

      expect(() => storage.addFile(path, 'content')).toThrow(/invalid|whitespace/i)
    })

    it('should reject empty path via RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'writeFile',
          params: {
            path: '',
            data: btoa('content'),
            encoding: 'base64',
          },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })

    it('should reject whitespace path via RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '   ' },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })
  })

  describe('Path Normalization Edge Cases', () => {
    /**
     * Path normalization must be applied before validation to catch
     * attempts to bypass checks using path manipulation.
     */

    it('should reject null byte after path normalization', () => {
      // Try to sneak null byte via path that gets normalized
      const path = '/home/user/../user/file.txt\x00'

      expect(() => storage.addFile(path, 'content')).toThrow(/invalid|null/i)
    })

    it('should reject paths that resolve to root with invalid chars', () => {
      const path = '/home/../\x00'

      expect(() => storage.addFile(path, 'content')).toThrow(/invalid|null/i)
    })

    it('should validate path components individually', () => {
      // Each path component should be validated
      const path = '/valid/also\x00valid/file.txt'

      expect(() => storage.addFile(path, 'content')).toThrow(/invalid|null/i)
    })
  })

  describe('Directory Operations Input Validation', () => {
    /**
     * Directory operations should have the same input validation as file operations.
     */

    it('should reject null byte in mkdir path', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mkdir',
          params: { path: '/home/user/new\x00dir', recursive: true },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })

    it('should reject invalid characters in readdir path', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readdir',
          params: { path: '/home/user\x07' },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })

    it('should reject empty path in rmdir', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rmdir',
          params: { path: '' },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })
  })

  describe('Symlink and Link Input Validation', () => {
    /**
     * Symlink operations need validation on both the link path and target.
     */

    it('should reject null byte in symlink target', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'symlink',
          params: {
            target: '/home/user/file.txt\x00',
            path: '/home/user/link',
          },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })

    it('should reject null byte in symlink path', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'symlink',
          params: {
            target: '/home/user/file.txt',
            path: '/home/user/link\x00',
          },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })

    it('should reject invalid characters in hard link paths', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'link',
          params: {
            existingPath: '/home/user/hello.txt',
            newPath: '/home/user/link\nname',
          },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })
  })

  describe('Rename and Copy Input Validation', () => {
    /**
     * Rename and copy operations need validation on both source and destination.
     */

    it('should reject null byte in rename oldPath', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rename',
          params: {
            oldPath: '/home/user/file.txt\x00',
            newPath: '/home/user/renamed.txt',
          },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })

    it('should reject null byte in rename newPath', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rename',
          params: {
            oldPath: '/home/user/hello.txt',
            newPath: '/home/user/renamed\x00.txt',
          },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })

    it('should reject invalid characters in copyFile', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'copyFile',
          params: {
            src: '/home/user/hello.txt',
            dest: '/home/user/copy\x1Bname.txt',
          },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })
  })
})
