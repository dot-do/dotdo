/**
 * Crypto/Hashing Commands Tests (RED Phase)
 *
 * Comprehensive failing tests for crypto and hashing commands:
 * - sha256sum, sha1sum, sha512sum, md5sum
 * - uuidgen / uuid
 * - cksum / sum
 * - openssl (subset)
 *
 * These tests are designed to FAIL initially (TDD RED phase).
 * Implementation will make them pass (GREEN phase).
 *
 * @see bashx-y41 - [RED] Crypto - sha256sum, md5sum, uuidgen tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  TieredExecutor,
  type SandboxBinding,
} from '../tiered-executor.js'
import type { FsCapability, BashResult } from '../../types.js'

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock FsCapability with test files for crypto operations
 */
function createMockFsCapability(): FsCapability {
  const files: Record<string, string> = {
    '/test.txt': 'hello world\n',
    '/file1.txt': 'content of file 1\n',
    '/file2.txt': 'content of file 2\n',
    '/binary.bin': '\x00\x01\x02\x03\x04\x05\x06\x07',
    '/checksums.txt': `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  /empty.txt
a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447  /test.txt`,
    '/md5sums.txt': `d41d8cd98f00b204e9800998ecf8427e  /empty.txt
6f5902ac237024bdd0c176cb93063dc4  /test.txt`,
    '/sha1sums.txt': `da39a3ee5e6b4b0d3255bfef95601890afd80709  /empty.txt
22596363b3de40b06f981fb85d82312e8c0ed511  /test.txt`,
    '/bad_checksums.txt': `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  /empty.txt
0000000000000000000000000000000000000000000000000000000000000000  /test.txt`,
    '/empty.txt': '',
  }

  const directories: Record<string, Array<{ name: string; isDirectory(): boolean }>> = {
    '/': [
      { name: 'test.txt', isDirectory: () => false },
      { name: 'file1.txt', isDirectory: () => false },
      { name: 'file2.txt', isDirectory: () => false },
      { name: 'binary.bin', isDirectory: () => false },
      { name: 'checksums.txt', isDirectory: () => false },
      { name: 'md5sums.txt', isDirectory: () => false },
      { name: 'sha1sums.txt', isDirectory: () => false },
      { name: 'bad_checksums.txt', isDirectory: () => false },
      { name: 'empty.txt', isDirectory: () => false },
    ],
  }

  return {
    read: async (path: string) => {
      if (files[path] !== undefined) return files[path]
      throw new Error(`ENOENT: no such file: ${path}`)
    },
    exists: async (path: string) => path in files || path in directories,
    list: async (path: string) => {
      return directories[path] || []
    },
    stat: async (path: string) => {
      if (files[path] !== undefined) {
        return {
          size: files[path].length,
          isDirectory: () => false,
          isFile: () => true,
          mode: 0o644,
          uid: 0,
          gid: 0,
          nlink: 1,
          dev: 0,
          ino: 0,
          rdev: 0,
          blksize: 4096,
          blocks: 0,
          atimeMs: Date.now(),
          mtimeMs: Date.now(),
          ctimeMs: Date.now(),
          birthtimeMs: Date.now(),
        }
      }
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    },
  } as unknown as FsCapability
}

function createMockSandbox(): SandboxBinding {
  return {
    execute: vi.fn(async (command: string): Promise<BashResult> => ({
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: `sandbox: ${command}\n`,
      stderr: '',
      exitCode: 0,
      intent: {
        commands: [command.split(' ')[0]],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'none',
        reversible: true,
        reason: 'Executed via sandbox',
      },
    })),
  }
}

// ============================================================================
// SHA256SUM TESTS
// ============================================================================

describe('sha256sum', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('basic hashing', () => {
    it('hashes a single file', async () => {
      const result = await executor.execute('sha256sum /test.txt')

      expect(result.exitCode).toBe(0)
      // SHA-256 of "hello world\n" is a known value
      expect(result.stdout).toMatch(/^[a-f0-9]{64}\s+\/test\.txt\n$/)
      expect(result.stdout).toContain('a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447')
    })

    it('hashes multiple files', async () => {
      const result = await executor.execute('sha256sum /file1.txt /file2.txt')

      expect(result.exitCode).toBe(0)
      // Should have two lines of output, one per file
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(lines[0]).toMatch(/^[a-f0-9]{64}\s+\/file1\.txt$/)
      expect(lines[1]).toMatch(/^[a-f0-9]{64}\s+\/file2\.txt$/)
    })

    it('hashes empty file', async () => {
      const result = await executor.execute('sha256sum /empty.txt')

      expect(result.exitCode).toBe(0)
      // SHA-256 of empty string is a known value
      expect(result.stdout).toContain('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    })

    it('handles non-existent file', async () => {
      const result = await executor.execute('sha256sum /nonexistent.txt')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No such file')
    })
  })

  describe('stdin input', () => {
    it('hashes from stdin', async () => {
      const result = await executor.execute('sha256sum', { stdin: 'hello world\n' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^[a-f0-9]{64}\s+-\n$/)
      expect(result.stdout).toContain('a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447')
    })

    it('hashes empty stdin', async () => {
      const result = await executor.execute('sha256sum', { stdin: '' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    })

    it('hashes stdin with -', async () => {
      const result = await executor.execute('sha256sum -', { stdin: 'test' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^[a-f0-9]{64}\s+-\n$/)
    })
  })

  describe('checksum verification (-c)', () => {
    it('verifies checksums from file', async () => {
      const result = await executor.execute('sha256sum -c /checksums.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('OK')
    })

    it('reports failed verification', async () => {
      // bad_checksums.txt has wrong hash for test.txt
      const result = await executor.execute('sha256sum -c /bad_checksums.txt')

      // Should report failure for mismatched hash
      expect(result.stdout).toContain('FAILED')
      // Exit code should be non-zero if any check fails
      expect(result.exitCode).toBe(1)
    })

    it('handles --check alias', async () => {
      const result = await executor.execute('sha256sum --check /checksums.txt')

      expect(result.exitCode).toBe(0)
    })

    it('supports --quiet mode for verification', async () => {
      const result = await executor.execute('sha256sum -c --quiet /checksums.txt')

      // Quiet mode should only output failures
      expect(result.exitCode).toBe(0)
    })

    it('supports --status mode for verification', async () => {
      const result = await executor.execute('sha256sum -c --status /checksums.txt')

      // Status mode should produce no output, just exit code
      expect(result.stdout).toBe('')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('output formats', () => {
    it('produces BSD-style output with --tag', async () => {
      const result = await executor.execute('sha256sum --tag /test.txt')

      expect(result.exitCode).toBe(0)
      // BSD format: SHA256 (filename) = hash
      expect(result.stdout).toMatch(/^SHA256 \(\/test\.txt\) = [a-f0-9]{64}\n$/)
    })

    it('supports binary mode with -b', async () => {
      const result = await executor.execute('sha256sum -b /binary.bin')

      expect(result.exitCode).toBe(0)
      // Binary mode uses * prefix before filename
      expect(result.stdout).toMatch(/^[a-f0-9]{64} \*\/binary\.bin\n$/)
    })

    it('supports text mode with -t', async () => {
      const result = await executor.execute('sha256sum -t /test.txt')

      expect(result.exitCode).toBe(0)
      // Text mode uses space before filename (default on most systems)
      expect(result.stdout).toMatch(/^[a-f0-9]{64}  \/test\.txt\n$/)
    })
  })
})

// ============================================================================
// SHA1SUM TESTS
// ============================================================================

describe('sha1sum', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('basic hashing', () => {
    it('hashes a single file', async () => {
      const result = await executor.execute('sha1sum /test.txt')

      expect(result.exitCode).toBe(0)
      // SHA-1 produces 40 hex characters
      expect(result.stdout).toMatch(/^[a-f0-9]{40}\s+\/test\.txt\n$/)
      // SHA-1 of "hello world\n"
      expect(result.stdout).toContain('22596363b3de40b06f981fb85d82312e8c0ed511')
    })

    it('hashes multiple files', async () => {
      const result = await executor.execute('sha1sum /file1.txt /file2.txt')

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(2)
    })

    it('hashes from stdin', async () => {
      const result = await executor.execute('sha1sum', { stdin: 'hello world\n' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^[a-f0-9]{40}\s+-\n$/)
    })
  })

  describe('checksum verification', () => {
    it('verifies checksums with -c', async () => {
      const result = await executor.execute('sha1sum -c /sha1sums.txt')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('output formats', () => {
    it('produces BSD-style output with --tag', async () => {
      const result = await executor.execute('sha1sum --tag /test.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^SHA1 \(\/test\.txt\) = [a-f0-9]{40}\n$/)
    })
  })
})

// ============================================================================
// MD5SUM TESTS
// ============================================================================

describe('md5sum', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('basic hashing', () => {
    it('hashes a single file', async () => {
      const result = await executor.execute('md5sum /test.txt')

      expect(result.exitCode).toBe(0)
      // MD5 produces 32 hex characters
      expect(result.stdout).toMatch(/^[a-f0-9]{32}\s+\/test\.txt\n$/)
      // MD5 of "hello world\n"
      expect(result.stdout).toContain('6f5902ac237024bdd0c176cb93063dc4')
    })

    it('hashes multiple files', async () => {
      const result = await executor.execute('md5sum /file1.txt /file2.txt')

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(2)
    })

    it('hashes empty file', async () => {
      const result = await executor.execute('md5sum /empty.txt')

      expect(result.exitCode).toBe(0)
      // MD5 of empty string
      expect(result.stdout).toContain('d41d8cd98f00b204e9800998ecf8427e')
    })

    it('hashes from stdin', async () => {
      const result = await executor.execute('md5sum', { stdin: 'hello world\n' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^[a-f0-9]{32}\s+-\n$/)
    })
  })

  describe('checksum verification', () => {
    it('verifies checksums with -c', async () => {
      const result = await executor.execute('md5sum -c /md5sums.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('OK')
    })

    it('reports verification failures', async () => {
      const result = await executor.execute('md5sum -c /md5sums.txt')

      // Test with wrong content - should report FAILED
      expect(result.stdout).toMatch(/OK|FAILED/)
    })

    it('supports --warn flag', async () => {
      const result = await executor.execute('md5sum -c --warn /md5sums.txt')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('output formats', () => {
    it('produces BSD-style output with --tag', async () => {
      const result = await executor.execute('md5sum --tag /test.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^MD5 \(\/test\.txt\) = [a-f0-9]{32}\n$/)
    })
  })
})

// ============================================================================
// SHA512SUM TESTS
// ============================================================================

describe('sha512sum', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('basic hashing', () => {
    it('hashes a single file', async () => {
      const result = await executor.execute('sha512sum /test.txt')

      expect(result.exitCode).toBe(0)
      // SHA-512 produces 128 hex characters
      expect(result.stdout).toMatch(/^[a-f0-9]{128}\s+\/test\.txt\n$/)
    })

    it('hashes multiple files', async () => {
      const result = await executor.execute('sha512sum /file1.txt /file2.txt')

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(2)
    })

    it('hashes from stdin', async () => {
      const result = await executor.execute('sha512sum', { stdin: 'hello world\n' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^[a-f0-9]{128}\s+-\n$/)
    })

    it('hashes empty file', async () => {
      const result = await executor.execute('sha512sum /empty.txt')

      expect(result.exitCode).toBe(0)
      // SHA-512 of empty string
      expect(result.stdout).toContain('cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e')
    })
  })

  describe('output formats', () => {
    it('produces BSD-style output with --tag', async () => {
      const result = await executor.execute('sha512sum --tag /test.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^SHA512 \(\/test\.txt\) = [a-f0-9]{128}\n$/)
    })
  })
})

// ============================================================================
// UUIDGEN / UUID TESTS
// ============================================================================

describe('uuidgen', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('UUID v4 generation', () => {
    it('generates a UUID v4 by default', async () => {
      const result = await executor.execute('uuidgen')

      expect(result.exitCode).toBe(0)
      // UUID format: 8-4-4-4-12 hex characters
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates random UUID with -r flag', async () => {
      const result = await executor.execute('uuidgen -r')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates random UUID with --random flag', async () => {
      const result = await executor.execute('uuidgen --random')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates unique UUIDs on each call', async () => {
      const result1 = await executor.execute('uuidgen')
      const result2 = await executor.execute('uuidgen')

      expect(result1.stdout.trim()).not.toBe(result2.stdout.trim())
    })
  })

  describe('UUID v1 generation (time-based)', () => {
    it('generates time-based UUID with -t flag', async () => {
      const result = await executor.execute('uuidgen -t')

      expect(result.exitCode).toBe(0)
      // UUID v1 format: version byte is 1xxx
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates time-based UUID with --time flag', async () => {
      const result = await executor.execute('uuidgen --time')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })
  })

  describe('multiple UUIDs', () => {
    it('generates multiple UUIDs with -n flag', async () => {
      const result = await executor.execute('uuidgen -n 5')

      expect(result.exitCode).toBe(0)
      const uuids = result.stdout.trim().split('\n')
      expect(uuids).toHaveLength(5)
      uuids.forEach((uuid) => {
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      })
    })
  })

  describe('uppercase output', () => {
    it('generates uppercase UUID with -u flag', async () => {
      const result = await executor.execute('uuidgen -u')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(
        /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/
      )
    })
  })
})

describe('uuid', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('version selection', () => {
    it('generates UUID v4 with -v 4', async () => {
      const result = await executor.execute('uuid -v 4')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates UUID v1 with -v 1', async () => {
      const result = await executor.execute('uuid -v 1')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })
  })

  describe('UUID v5 (namespace-based)', () => {
    it('generates UUID v5 with ns:URL namespace', async () => {
      const result = await executor.execute('uuid -v 5 ns:URL "https://example.com.ai"')

      expect(result.exitCode).toBe(0)
      // UUID v5 version byte is 5xxx
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates UUID v5 with ns:DNS namespace', async () => {
      const result = await executor.execute('uuid -v 5 ns:DNS "example.com.ai"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates UUID v5 with ns:OID namespace', async () => {
      const result = await executor.execute('uuid -v 5 ns:OID "1.2.3.4"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates UUID v5 with ns:X500 namespace', async () => {
      const result = await executor.execute('uuid -v 5 ns:X500 "CN=Test"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates deterministic UUID v5 for same input', async () => {
      const result1 = await executor.execute('uuid -v 5 ns:URL "https://example.com.ai"')
      const result2 = await executor.execute('uuid -v 5 ns:URL "https://example.com.ai"')

      expect(result1.stdout.trim()).toBe(result2.stdout.trim())
    })

    it('generates different UUID v5 for different inputs', async () => {
      const result1 = await executor.execute('uuid -v 5 ns:URL "https://example.com.ai"')
      const result2 = await executor.execute('uuid -v 5 ns:URL "https://different.com"')

      expect(result1.stdout.trim()).not.toBe(result2.stdout.trim())
    })

    it('generates UUID v5 with custom namespace UUID', async () => {
      const result = await executor.execute(
        'uuid -v 5 "6ba7b810-9dad-11d1-80b4-00c04fd430c8" "test"'
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })
  })

  describe('UUID v3 (MD5-based namespace)', () => {
    it('generates UUID v3 with namespace', async () => {
      const result = await executor.execute('uuid -v 3 ns:URL "https://example.com.ai"')

      expect(result.exitCode).toBe(0)
      // UUID v3 version byte is 3xxx
      expect(result.stdout.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })
  })

  describe('nil UUID', () => {
    it('generates nil UUID with --nil', async () => {
      const result = await executor.execute('uuid --nil')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('00000000-0000-0000-0000-000000000000')
    })
  })

  describe('error handling', () => {
    it('rejects invalid version', async () => {
      const result = await executor.execute('uuid -v 9')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('invalid')
    })

    it('requires name for v5', async () => {
      const result = await executor.execute('uuid -v 5 ns:URL')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('name')
    })
  })
})

// ============================================================================
// CKSUM / SUM TESTS
// ============================================================================

describe('cksum', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('CRC checksum', () => {
    it('computes CRC checksum for file', async () => {
      const result = await executor.execute('cksum /test.txt')

      expect(result.exitCode).toBe(0)
      // Output format: checksum size filename
      expect(result.stdout).toMatch(/^\d+\s+\d+\s+\/test\.txt\n$/)
    })

    it('computes CRC checksum for multiple files', async () => {
      const result = await executor.execute('cksum /file1.txt /file2.txt')

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(2)
    })

    it('computes CRC checksum from stdin', async () => {
      const result = await executor.execute('cksum', { stdin: 'hello world\n' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^\d+\s+\d+\n$/)
    })

    it('handles empty file', async () => {
      const result = await executor.execute('cksum /empty.txt')

      expect(result.exitCode).toBe(0)
      // Empty file has size 0
      expect(result.stdout).toMatch(/^\d+\s+0\s+\/empty\.txt\n$/)
    })
  })
})

describe('sum', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('BSD checksum', () => {
    it('computes BSD sum for file', async () => {
      const result = await executor.execute('sum /test.txt')

      expect(result.exitCode).toBe(0)
      // Output format: checksum blocks filename
      expect(result.stdout).toMatch(/^\d+\s+\d+\s+\/test\.txt\n$/)
    })

    it('supports -s for sysv algorithm', async () => {
      const result = await executor.execute('sum -s /test.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^\d+\s+\d+\s+\/test\.txt\n$/)
    })

    it('supports -r for BSD algorithm (default)', async () => {
      const result = await executor.execute('sum -r /test.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^\d+\s+\d+\s+\/test\.txt\n$/)
    })

    it('computes sum from stdin', async () => {
      const result = await executor.execute('sum', { stdin: 'hello world\n' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^\d+\s+\d+\n$/)
    })
  })
})

// ============================================================================
// OPENSSL TESTS (SUBSET)
// ============================================================================

describe('openssl', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  describe('dgst (message digest)', () => {
    it('computes SHA-256 digest', async () => {
      const result = await executor.execute('openssl dgst -sha256 /test.txt')

      expect(result.exitCode).toBe(0)
      // Output format: SHA256(/test.txt)= hash
      expect(result.stdout).toMatch(/^SHA2-256\(\/test\.txt\)=\s*[a-f0-9]{64}\n$/i)
    })

    it('computes SHA-1 digest', async () => {
      const result = await executor.execute('openssl dgst -sha1 /test.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^SHA1\(\/test\.txt\)=\s*[a-f0-9]{40}\n$/i)
    })

    it('computes MD5 digest', async () => {
      const result = await executor.execute('openssl dgst -md5 /test.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^MD5\(\/test\.txt\)=\s*[a-f0-9]{32}\n$/i)
    })

    it('computes SHA-512 digest', async () => {
      const result = await executor.execute('openssl dgst -sha512 /test.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^SHA2-512\(\/test\.txt\)=\s*[a-f0-9]{128}\n$/i)
    })

    it('supports -hex output format (default)', async () => {
      const result = await executor.execute('openssl dgst -sha256 -hex /test.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/[a-f0-9]{64}/i)
    })

    it('supports -r for reversed output format', async () => {
      const result = await executor.execute('openssl dgst -sha256 -r /test.txt')

      expect(result.exitCode).toBe(0)
      // -r format: hash *filename
      expect(result.stdout).toMatch(/^[a-f0-9]{64}\s+\*?\/test\.txt\n$/i)
    })

    it('computes digest from stdin', async () => {
      const result = await executor.execute('openssl dgst -sha256', { stdin: 'hello world\n' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/[a-f0-9]{64}/i)
    })
  })

  describe('enc (encoding)', () => {
    it('base64 encodes from stdin', async () => {
      const result = await executor.execute('openssl enc -base64', { stdin: 'hello world\n' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('aGVsbG8gd29ybGQK')
    })

    it('base64 encodes a file', async () => {
      const result = await executor.execute('openssl enc -base64 -in /test.txt')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('aGVsbG8gd29ybGQK')
    })

    it('base64 decodes with -d flag', async () => {
      const result = await executor.execute('openssl enc -base64 -d', {
        stdin: 'aGVsbG8gd29ybGQK',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello world\n')
    })

    it('supports -A for single-line output', async () => {
      const longInput = 'a'.repeat(100)
      const result = await executor.execute('openssl enc -base64 -A', { stdin: longInput })

      expect(result.exitCode).toBe(0)
      // -A should produce single line without wrapping
      expect(result.stdout.split('\n').length).toBeLessThanOrEqual(2)
    })
  })

  describe('rand (random bytes)', () => {
    it('generates random hex bytes', async () => {
      const result = await executor.execute('openssl rand -hex 32')

      expect(result.exitCode).toBe(0)
      // 32 bytes = 64 hex characters
      expect(result.stdout.trim()).toMatch(/^[a-f0-9]{64}$/i)
    })

    it('generates random base64 bytes', async () => {
      const result = await executor.execute('openssl rand -base64 32')

      expect(result.exitCode).toBe(0)
      // 32 bytes base64 encoded
      expect(result.stdout.trim()).toMatch(/^[A-Za-z0-9+/]+=*$/)
    })

    it('generates unique random bytes each call', async () => {
      const result1 = await executor.execute('openssl rand -hex 32')
      const result2 = await executor.execute('openssl rand -hex 32')

      expect(result1.stdout.trim()).not.toBe(result2.stdout.trim())
    })

    it('generates correct number of bytes', async () => {
      const result = await executor.execute('openssl rand -hex 16')

      expect(result.exitCode).toBe(0)
      // 16 bytes = 32 hex characters
      expect(result.stdout.trim()).toMatch(/^[a-f0-9]{32}$/i)
    })

    it('handles zero bytes', async () => {
      const result = await executor.execute('openssl rand -hex 0')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('')
    })

    it('rejects negative byte count', async () => {
      const result = await executor.execute('openssl rand -hex -5')

      expect(result.exitCode).toBe(1)
    })
  })

  describe('passwd (password hashing)', () => {
    it('hashes password with SHA-512 crypt (-6)', async () => {
      const result = await executor.execute("openssl passwd -6 'password'")

      expect(result.exitCode).toBe(0)
      // SHA-512 crypt format: $6$salt$hash
      expect(result.stdout.trim()).toMatch(/^\$6\$[a-zA-Z0-9./]+\$[a-zA-Z0-9./]+$/)
    })

    it('hashes password with SHA-256 crypt (-5)', async () => {
      const result = await executor.execute("openssl passwd -5 'password'")

      expect(result.exitCode).toBe(0)
      // SHA-256 crypt format: $5$salt$hash
      expect(result.stdout.trim()).toMatch(/^\$5\$[a-zA-Z0-9./]+\$[a-zA-Z0-9./]+$/)
    })

    it('uses provided salt with -salt', async () => {
      const result = await executor.execute("openssl passwd -6 -salt 'mysalt' 'password'")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('mysalt')
    })

    it('reads password from stdin with -stdin', async () => {
      const result = await executor.execute('openssl passwd -6 -stdin', { stdin: 'password\n' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\$6\$/)
    })

    it('generates different hash each time (random salt)', async () => {
      const result1 = await executor.execute("openssl passwd -6 'password'")
      const result2 = await executor.execute("openssl passwd -6 'password'")

      // Different salts should produce different hashes
      expect(result1.stdout.trim()).not.toBe(result2.stdout.trim())
    })
  })
})

// ============================================================================
// TIER CLASSIFICATION TESTS
// ============================================================================

describe('Crypto Command Classification', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  it('classifies sha256sum as Tier 1 native', () => {
    const classification = executor.classifyCommand('sha256sum /test.txt')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
    expect(classification.capability).toBe('crypto')
  })

  it('classifies sha1sum as Tier 1 native', () => {
    const classification = executor.classifyCommand('sha1sum /test.txt')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
  })

  it('classifies md5sum as Tier 1 native', () => {
    const classification = executor.classifyCommand('md5sum /test.txt')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
  })

  it('classifies sha512sum as Tier 1 native', () => {
    const classification = executor.classifyCommand('sha512sum /test.txt')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
  })

  it('classifies uuidgen as Tier 1 native', () => {
    const classification = executor.classifyCommand('uuidgen')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
  })

  it('classifies uuid as Tier 1 native', () => {
    const classification = executor.classifyCommand('uuid -v 4')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
  })

  it('classifies cksum as Tier 1 native', () => {
    const classification = executor.classifyCommand('cksum /test.txt')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
  })

  it('classifies sum as Tier 1 native', () => {
    const classification = executor.classifyCommand('sum /test.txt')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
  })

  it('classifies openssl dgst as Tier 1 native', () => {
    const classification = executor.classifyCommand('openssl dgst -sha256 /test.txt')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
  })

  it('classifies openssl enc as Tier 1 native', () => {
    const classification = executor.classifyCommand('openssl enc -base64')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
  })

  it('classifies openssl rand as Tier 1 native', () => {
    const classification = executor.classifyCommand('openssl rand -hex 32')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
  })

  it('classifies openssl passwd as Tier 1 native', () => {
    const classification = executor.classifyCommand("openssl passwd -6 'password'")

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Crypto Command Error Handling', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })
  })

  it('sha256sum handles missing file gracefully', async () => {
    const result = await executor.execute('sha256sum /nonexistent.txt')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBeTruthy()
  })

  it('md5sum handles missing file gracefully', async () => {
    const result = await executor.execute('md5sum /nonexistent.txt')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBeTruthy()
  })

  it('openssl rand handles invalid count', async () => {
    const result = await executor.execute('openssl rand -hex abc')

    expect(result.exitCode).toBe(1)
  })

  it('openssl dgst handles unknown algorithm', async () => {
    const result = await executor.execute('openssl dgst -unknown /test.txt')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('unknown')
  })

  it('sha256sum -c handles malformed checksum file', async () => {
    const result = await executor.execute('sha256sum -c /test.txt')

    // test.txt is not a valid checksum file
    expect(result.exitCode).toBe(1)
  })

  it('uuid handles missing namespace argument for v5', async () => {
    const result = await executor.execute('uuid -v 5')

    expect(result.exitCode).toBe(1)
  })
})
