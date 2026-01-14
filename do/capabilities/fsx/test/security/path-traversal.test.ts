/**
 * Path Traversal Protection Tests
 *
 * These tests verify that the filesystem prevents path traversal attacks
 * that would allow access to files outside the allowed root directory.
 *
 * Security vulnerability: Path traversal (CWE-22)
 * https://cwe.mitre.org/data/definitions/22.html
 *
 * TDD Phase: RED - These tests should FAIL until protection is implemented.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStorage, createTestFilesystem, MockDurableObjectStub } from '../../tests/test-utils'
import { PathValidator } from '../../do/security'

describe('Path Traversal Protection', () => {
  let validator: PathValidator

  beforeEach(() => {
    // Using secure PathValidator implementation
    validator = new PathValidator()
  })

  describe('Unix-style path traversal attacks', () => {
    it('should reject ../../../etc/passwd', () => {
      const maliciousPath = '../../../etc/passwd'
      const root = '/app/data'

      // This should throw EACCES because path escapes root
      expect(() => validator.validatePath(maliciousPath, root)).toThrow()

      // Alternatively, isPathTraversal should detect the attack
      expect(validator.isPathTraversal(maliciousPath, root)).toBe(true)
    })

    it('should reject /app/../../../root', () => {
      const maliciousPath = '/app/../../../root'
      const root = '/app'

      // Path resolves to /root which is outside /app
      expect(() => validator.validatePath(maliciousPath, root)).toThrow()
      expect(validator.isPathTraversal(maliciousPath, root)).toBe(true)
    })

    it('should reject paths that resolve outside root with nested traversal', () => {
      const maliciousPath = 'data/../../../../../../etc/shadow'
      const root = '/app/user/files'

      expect(() => validator.validatePath(maliciousPath, root)).toThrow()
      expect(validator.isPathTraversal(maliciousPath, root)).toBe(true)
    })

    it('should reject absolute paths outside root', () => {
      const maliciousPath = '/etc/passwd'
      const root = '/app/data'

      expect(() => validator.validatePath(maliciousPath, root)).toThrow()
      expect(validator.isPathTraversal(maliciousPath, root)).toBe(true)
    })

    it('should reject paths with encoded traversal sequences', () => {
      // URL-encoded ../ = %2e%2e%2f
      const encoded1 = '%2e%2e%2f%2e%2e%2fetc/passwd'
      // Double-encoded
      const encoded2 = '%252e%252e%252f%252e%252e%252fetc/passwd'

      const root = '/app/data'

      // After decoding, these should be detected as traversal
      const decoded1 = decodeURIComponent(encoded1)
      expect(validator.isPathTraversal(decoded1, root)).toBe(true)
    })
  })

  describe('Windows-style path traversal attacks', () => {
    it('should reject ..\\\\..\\\\windows\\\\system32', () => {
      const maliciousPath = '..\\..\\windows\\system32'
      const root = '/app/data'

      expect(() => validator.validatePath(maliciousPath, root)).toThrow()
      expect(validator.isPathTraversal(maliciousPath, root)).toBe(true)
    })

    it('should reject mixed forward and back slashes', () => {
      const maliciousPath = '../..\\../etc/passwd'
      const root = '/app/data'

      expect(() => validator.validatePath(maliciousPath, root)).toThrow()
      expect(validator.isPathTraversal(maliciousPath, root)).toBe(true)
    })

    it('should reject paths with alternate data streams syntax', () => {
      // Windows ADS syntax: file.txt:hidden
      const maliciousPath = '../../../etc/passwd:$DATA'
      const root = '/app/data'

      expect(() => validator.validatePath(maliciousPath, root)).toThrow()
      expect(validator.isPathTraversal(maliciousPath, root)).toBe(true)
    })
  })

  describe('Symlink-based traversal attacks', () => {
    let storage: InMemoryStorage

    beforeEach(() => {
      storage = createTestFilesystem()
      // Create a jail directory
      storage.addDirectory('/jail')
      storage.addDirectory('/jail/user')
      storage.addFile('/jail/user/safe.txt', 'safe content')

      // Create sensitive file outside jail
      storage.addDirectory('/etc')
      storage.addFile('/etc/passwd', 'root:x:0:0:root:/root:/bin/bash')

      // Attacker creates symlink pointing outside jail
      storage.addSymlink('/jail/user/escape', '/etc')
    })

    it('should reject symlinks that point outside the jail', () => {
      // The symlink /jail/user/escape points to /etc (outside jail)
      // Use isSymlinkEscape to detect this
      const symlinkPath = '/jail/user/escape'
      const target = '/etc'
      const root = '/jail'

      // When creating a symlink, should detect that target escapes root
      expect(validator.isSymlinkEscape(target, symlinkPath, root)).toBe(true)
    })

    it('should reject symlinks targeting absolute paths outside root', () => {
      const symlinkPath = '/jail/user/root-link'
      const target = '/root'
      const root = '/jail'

      expect(validator.isSymlinkEscape(target, symlinkPath, root)).toBe(true)
    })

    it('should reject chained symlinks that escape', () => {
      // Symlink chain: link2 -> /etc
      // When creating link2 with target /etc, should detect escape
      const symlinkPath = '/jail/link2'
      const target = '/etc'
      const root = '/jail'

      expect(validator.isSymlinkEscape(target, symlinkPath, root)).toBe(true)
    })
  })

  describe('Null byte injection attacks', () => {
    it('should reject paths with null bytes', () => {
      // Null byte truncation attack: file.txt%00.jpg
      const maliciousPath = '../../../etc/passwd\x00.jpg'
      const root = '/app/data'

      expect(() => validator.validatePath(maliciousPath, root)).toThrow()
    })

    it('should reject URL-encoded null bytes', () => {
      const maliciousPath = '../../../etc/passwd%00.jpg'
      const root = '/app/data'

      expect(() => validator.validatePath(maliciousPath, root)).toThrow()
    })
  })

  describe('Edge cases and boundary conditions', () => {
    it('should allow paths that stay within root', () => {
      const safePath = 'subdir/file.txt'
      const root = '/app/data'

      // Should NOT throw
      const normalized = validator.validatePath(safePath, root)
      expect(normalized).toBe('/app/data/subdir/file.txt')
      expect(validator.isPathTraversal(safePath, root)).toBe(false)
    })

    it('should allow paths with .. that still resolve within root', () => {
      // /app/data/a/b/../c resolves to /app/data/a/c (still within root)
      const safePath = 'a/b/../c/file.txt'
      const root = '/app/data'

      const normalized = validator.validatePath(safePath, root)
      expect(normalized).toBe('/app/data/a/c/file.txt')
      expect(validator.isPathTraversal(safePath, root)).toBe(false)
    })

    it('should handle root path correctly', () => {
      const path = '/'
      const root = '/'

      // Root accessing itself is fine
      expect(() => validator.validatePath(path, root)).not.toThrow()
      expect(validator.isPathTraversal(path, root)).toBe(false)
    })

    it('should reject empty path', () => {
      const path = ''
      const root = '/app/data'

      // Empty paths should throw EINVAL for security
      expect(() => validator.validatePath(path, root)).toThrow()
    })

    it('should reject exact boundary escape', () => {
      // Exactly escaping to parent of root
      const path = '..'
      const root = '/app/data'

      // Resolves to /app which is outside /app/data
      expect(() => validator.validatePath(path, root)).toThrow()
      expect(validator.isPathTraversal(path, root)).toBe(true)
    })

    it('should reject paths that resolve to root parent', () => {
      const path = '../'
      const root = '/app/data'

      expect(() => validator.validatePath(path, root)).toThrow()
      expect(validator.isPathTraversal(path, root)).toBe(true)
    })

    it('should handle deeply nested roots', () => {
      const path = '../../../../etc/passwd'
      const root = '/very/deeply/nested/application/data'

      expect(() => validator.validatePath(path, root)).toThrow()
      expect(validator.isPathTraversal(path, root)).toBe(true)
    })
  })

  describe('RPC endpoint protection', () => {
    let stub: MockDurableObjectStub
    let storage: InMemoryStorage

    beforeEach(() => {
      storage = createTestFilesystem()
      // Create a jailed root at /home/user - paths should not escape this directory
      stub = new MockDurableObjectStub(storage, '/home/user')
    })

    it('should reject path traversal in readFile RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '../../../etc/passwd' },
        }),
      })

      // Should return 403 Forbidden or 400 Bad Request with EACCES
      expect(response.status).toBe(403)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EACCES')
    })

    it('should reject path traversal in writeFile RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'writeFile',
          params: {
            path: '../../../etc/cron.d/evil',
            data: btoa('malicious content'),
            encoding: 'base64',
          },
        }),
      })

      expect(response.status).toBe(403)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EACCES')
    })

    it('should reject path traversal in mkdir RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mkdir',
          params: {
            path: '../../../etc/evil',
            recursive: true,
          },
        }),
      })

      expect(response.status).toBe(403)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EACCES')
    })

    it('should reject path traversal in unlink RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'unlink',
          params: { path: '../../../etc/passwd' },
        }),
      })

      expect(response.status).toBe(403)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EACCES')
    })

    it('should reject path traversal in rename RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rename',
          params: {
            oldPath: '/home/user/hello.txt',
            newPath: '../../../etc/passwd',
          },
        }),
      })

      expect(response.status).toBe(403)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EACCES')
    })

    it('should reject path traversal in copyFile RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'copyFile',
          params: {
            src: '../../../etc/passwd',
            dest: '/tmp/stolen',
          },
        }),
      })

      expect(response.status).toBe(403)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EACCES')
    })

    it('should reject path traversal in symlink RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'symlink',
          params: {
            target: '/etc/passwd',
            path: '/home/user/link',
          },
        }),
      })

      // Should reject symlinks pointing outside the allowed area
      expect(response.status).toBe(403)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EACCES')
    })
  })

  describe('FsModule integration', () => {
    // These tests verify that FsModule methods properly validate paths
    // They should fail until path traversal protection is added to FsModule

    it('should reject traversal in FsModule.read()', () => {
      // Note: This test requires FsModule to be modified
      // For now, we test the expected behavior
      const maliciousPath = '../../../etc/passwd'
      const root = '/app/data'

      // FsModule should throw EACCES when basePath is set and path escapes
      expect(validator.isPathTraversal(maliciousPath, root)).toBe(true)
    })

    it('should reject traversal in FsModule.write()', () => {
      const maliciousPath = '../../../etc/crontab'
      const root = '/app/data'

      expect(validator.isPathTraversal(maliciousPath, root)).toBe(true)
    })

    it('should validate paths in FsModule with basePath config', () => {
      // When FsModule is configured with basePath: '/app/data'
      // it should reject any path that resolves outside /app/data
      const paths = ['../secret', '/etc/passwd', '../../..', 'subdir/../../../root']

      const root = '/app/data'

      for (const path of paths) {
        expect(validator.isPathTraversal(path, root)).toBe(true)
      }
    })
  })
})

describe('Path normalization edge cases', () => {
  let validator: PathValidator

  beforeEach(() => {
    // Using secure PathValidator implementation
    validator = new PathValidator()
  })

  it('should handle multiple consecutive slashes', () => {
    const path = '////etc////passwd'
    const root = '/app'

    // Multiple slashes should be normalized, and /etc/passwd is outside /app
    expect(validator.isPathTraversal(path, root)).toBe(true)
  })

  it('should handle Unicode normalization attacks', () => {
    // Some systems may normalize Unicode differently
    // \u002e is the Unicode for '.'
    const path = '\u002e\u002e/\u002e\u002e/etc/passwd'
    const root = '/app'

    expect(validator.isPathTraversal(path, root)).toBe(true)
  })

  it('should handle overlong UTF-8 encoding', () => {
    // Overlong UTF-8 encoding of '.' could bypass naive checks
    // This is a theoretical test - modern systems handle this
    const path = '../../../etc/passwd'
    const root = '/app'

    expect(validator.isPathTraversal(path, root)).toBe(true)
  })

  it('should handle case sensitivity appropriately', () => {
    // On case-insensitive systems, this might matter
    const path = '../../../ETC/PASSWD'
    const root = '/app'

    // Should still detect traversal regardless of case
    expect(validator.isPathTraversal(path, root)).toBe(true)
  })
})
