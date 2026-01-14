/**
 * Compression Commands Tests - RED Phase
 *
 * Comprehensive failing tests for compression commands:
 * - gzip / gunzip / zcat
 * - tar (archive)
 * - zip / unzip
 *
 * These tests define the expected behavior for Tier 1 native compression
 * implementations in bashx.do.
 *
 * @module bashx/do/commands/compression.test
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import the compression handlers (to be implemented)
// These imports will fail until implementation exists
import {
  gzip,
  gunzip,
  zcat,
  tar,
  zip,
  unzip,
} from './compression.js'

// Mock filesystem interface for testing
interface MockFs {
  files: Map<string, { content: Uint8Array | string; mode?: number; mtime?: Date }>
  directories: Set<string>
  symlinks: Map<string, string>
  read(path: string): Promise<Uint8Array | string>
  write(path: string, content: Uint8Array | string): Promise<void>
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<{ size: number; mode: number; mtime: Date; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }>
  readdir(path: string): Promise<string[]>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string): Promise<void>
  readlink(path: string): Promise<string>
  symlink(target: string, path: string): Promise<void>
}

function createMockFs(): MockFs {
  const files = new Map<string, { content: Uint8Array | string; mode?: number; mtime?: Date }>()
  const directories = new Set<string>(['/'])
  const symlinks = new Map<string, string>()

  return {
    files,
    directories,
    symlinks,
    async read(path: string) {
      const file = files.get(path)
      if (!file) throw new Error(`ENOENT: no such file or directory, open '${path}'`)
      return file.content
    },
    async write(path: string, content: Uint8Array | string) {
      files.set(path, { content, mode: 0o644, mtime: new Date() })
    },
    async exists(path: string) {
      return files.has(path) || directories.has(path) || symlinks.has(path)
    },
    async stat(path: string) {
      const file = files.get(path)
      if (file) {
        return {
          size: typeof file.content === 'string' ? file.content.length : file.content.byteLength,
          mode: file.mode ?? 0o644,
          mtime: file.mtime ?? new Date(),
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
        }
      }
      if (directories.has(path)) {
        return {
          size: 4096,
          mode: 0o755,
          mtime: new Date(),
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false,
        }
      }
      if (symlinks.has(path)) {
        return {
          size: 0,
          mode: 0o777,
          mtime: new Date(),
          isFile: () => false,
          isDirectory: () => false,
          isSymbolicLink: () => true,
        }
      }
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`)
    },
    async readdir(path: string) {
      if (!directories.has(path)) {
        throw new Error(`ENOENT: no such file or directory, scandir '${path}'`)
      }
      const entries: string[] = []
      const prefix = path.endsWith('/') ? path : path + '/'
      for (const filePath of files.keys()) {
        if (filePath.startsWith(prefix)) {
          const relative = filePath.slice(prefix.length)
          const firstPart = relative.split('/')[0]
          if (!entries.includes(firstPart)) {
            entries.push(firstPart)
          }
        }
      }
      for (const dirPath of directories) {
        if (dirPath.startsWith(prefix) && dirPath !== path) {
          const relative = dirPath.slice(prefix.length)
          const firstPart = relative.split('/')[0]
          if (firstPart && !entries.includes(firstPart)) {
            entries.push(firstPart)
          }
        }
      }
      return entries
    },
    async mkdir(path: string, options?: { recursive?: boolean }) {
      if (options?.recursive) {
        const parts = path.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current += '/' + part
          directories.add(current)
        }
      } else {
        directories.add(path)
      }
    },
    async rm(path: string) {
      if (!files.delete(path) && !directories.delete(path) && !symlinks.delete(path)) {
        throw new Error(`ENOENT: no such file or directory, unlink '${path}'`)
      }
    },
    async readlink(path: string) {
      const target = symlinks.get(path)
      if (!target) throw new Error(`EINVAL: invalid argument, readlink '${path}'`)
      return target
    },
    async symlink(target: string, path: string) {
      symlinks.set(path, target)
    },
  }
}

// ============================================================================
// GZIP / GUNZIP / ZCAT TESTS
// ============================================================================

describe('gzip', () => {
  let fs: MockFs

  beforeEach(() => {
    fs = createMockFs()
  })

  describe('basic compression', () => {
    it('should compress a file and create .gz extension', async () => {
      // Setup: create a text file
      await fs.write('/test.txt', 'Hello, World!')

      // Execute: gzip file
      const result = await gzip({ args: ['test.txt'], cwd: '/', fs })

      // Verify: original file removed, .gz file created
      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/test.txt')).toBe(false)
      expect(await fs.exists('/test.txt.gz')).toBe(true)

      // Verify: compressed content is smaller or equal for small files
      const compressed = await fs.read('/test.txt.gz')
      expect(compressed).toBeInstanceOf(Uint8Array)
    })

    it('should compress multiple files', async () => {
      await fs.write('/file1.txt', 'Content 1')
      await fs.write('/file2.txt', 'Content 2')
      await fs.write('/file3.txt', 'Content 3')

      const result = await gzip({ args: ['file1.txt', 'file2.txt', 'file3.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/file1.txt.gz')).toBe(true)
      expect(await fs.exists('/file2.txt.gz')).toBe(true)
      expect(await fs.exists('/file3.txt.gz')).toBe(true)
      expect(await fs.exists('/file1.txt')).toBe(false)
      expect(await fs.exists('/file2.txt')).toBe(false)
      expect(await fs.exists('/file3.txt')).toBe(false)
    })

    it('should fail if file does not exist', async () => {
      const result = await gzip({ args: ['nonexistent.txt'], cwd: '/', fs })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('nonexistent.txt')
    })

    it('should skip directories by default', async () => {
      await fs.mkdir('/mydir')

      const result = await gzip({ args: ['mydir'], cwd: '/', fs })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('directory')
    })
  })

  describe('-k (keep original)', () => {
    it('should keep original file when -k flag is used', async () => {
      await fs.write('/test.txt', 'Hello, World!')

      const result = await gzip({ args: ['-k', 'test.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/test.txt')).toBe(true)
      expect(await fs.exists('/test.txt.gz')).toBe(true)
    })

    it('should keep original file with --keep flag', async () => {
      await fs.write('/test.txt', 'Hello, World!')

      const result = await gzip({ args: ['--keep', 'test.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/test.txt')).toBe(true)
      expect(await fs.exists('/test.txt.gz')).toBe(true)
    })
  })

  describe('-c (stdout)', () => {
    it('should output compressed data to stdout', async () => {
      await fs.write('/test.txt', 'Hello, World!')

      const result = await gzip({ args: ['-c', 'test.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      // Original file should still exist
      expect(await fs.exists('/test.txt')).toBe(true)
      // No .gz file should be created
      expect(await fs.exists('/test.txt.gz')).toBe(false)
      // stdout should contain compressed data
      expect(result.stdout).toBeDefined()
      expect(typeof result.stdout === 'string' || (result.stdout as unknown) instanceof Uint8Array).toBe(true)
    })
  })

  describe('-d (decompress)', () => {
    it('should decompress a .gz file', async () => {
      // First compress
      await fs.write('/test.txt', 'Hello, World!')
      await gzip({ args: ['test.txt'], cwd: '/', fs })

      // Then decompress
      const result = await gzip({ args: ['-d', 'test.txt.gz'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/test.txt.gz')).toBe(false)
      expect(await fs.exists('/test.txt')).toBe(true)

      const content = await fs.read('/test.txt')
      expect(content).toBe('Hello, World!')
    })

    it('should decompress with --decompress flag', async () => {
      await fs.write('/test.txt', 'Hello, World!')
      await gzip({ args: ['test.txt'], cwd: '/', fs })

      const result = await gzip({ args: ['--decompress', 'test.txt.gz'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/test.txt')).toBe(true)
    })
  })

  describe('-l (list)', () => {
    it('should list compression info for .gz file', async () => {
      await fs.write('/test.txt', 'Hello, World! This is some content to compress.')
      await gzip({ args: ['test.txt'], cwd: '/', fs })

      const result = await gzip({ args: ['-l', 'test.txt.gz'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      // Output should contain compression ratio info
      expect(result.stdout).toContain('compressed')
      expect(result.stdout).toContain('uncompressed')
      expect(result.stdout).toMatch(/ratio|%/)
    })
  })

  describe('compression levels', () => {
    it('should use maximum compression with -9', async () => {
      const largeContent = 'x'.repeat(10000)
      await fs.write('/test.txt', largeContent)

      const result = await gzip({ args: ['-9', 'test.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/test.txt.gz')).toBe(true)
    })

    it('should use fast compression with -1', async () => {
      const largeContent = 'x'.repeat(10000)
      await fs.write('/test.txt', largeContent)

      const result = await gzip({ args: ['-1', 'test.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/test.txt.gz')).toBe(true)
    })

    it('should use --best as alias for -9', async () => {
      await fs.write('/test.txt', 'x'.repeat(1000))

      const result = await gzip({ args: ['--best', 'test.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
    })

    it('should use --fast as alias for -1', async () => {
      await fs.write('/test.txt', 'x'.repeat(1000))

      const result = await gzip({ args: ['--fast', 'test.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
    })
  })

  describe('force overwrite', () => {
    it('should overwrite existing .gz file with -f', async () => {
      await fs.write('/test.txt', 'New content')
      await fs.write('/test.txt.gz', new Uint8Array([1, 2, 3])) // existing gz file

      const result = await gzip({ args: ['-f', 'test.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      // Should have overwritten the existing .gz file
      const compressed = await fs.read('/test.txt.gz')
      expect(compressed).not.toEqual(new Uint8Array([1, 2, 3]))
    })
  })
})

describe('gunzip', () => {
  let fs: MockFs

  beforeEach(() => {
    fs = createMockFs()
  })

  it('should decompress a .gz file', async () => {
    await fs.write('/test.txt', 'Hello, World!')
    await gzip({ args: ['test.txt'], cwd: '/', fs })

    const result = await gunzip({ args: ['test.txt.gz'], cwd: '/', fs })

    expect(result.exitCode).toBe(0)
    expect(await fs.exists('/test.txt')).toBe(true)
    expect(await fs.exists('/test.txt.gz')).toBe(false)

    const content = await fs.read('/test.txt')
    expect(content).toBe('Hello, World!')
  })

  it('should keep original with -k', async () => {
    await fs.write('/test.txt', 'Hello!')
    await gzip({ args: ['test.txt'], cwd: '/', fs })

    const result = await gunzip({ args: ['-k', 'test.txt.gz'], cwd: '/', fs })

    expect(result.exitCode).toBe(0)
    expect(await fs.exists('/test.txt')).toBe(true)
    expect(await fs.exists('/test.txt.gz')).toBe(true)
  })

  it('should output to stdout with -c', async () => {
    await fs.write('/test.txt', 'Hello!')
    await gzip({ args: ['test.txt'], cwd: '/', fs })

    const result = await gunzip({ args: ['-c', 'test.txt.gz'], cwd: '/', fs })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Hello!')
    expect(await fs.exists('/test.txt.gz')).toBe(true)
  })

  it('should fail on invalid gzip data', async () => {
    await fs.write('/bad.gz', new Uint8Array([1, 2, 3, 4, 5])) // not valid gzip

    const result = await gunzip({ args: ['bad.gz'], cwd: '/', fs })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('invalid')
  })
})

describe('zcat', () => {
  let fs: MockFs

  beforeEach(() => {
    fs = createMockFs()
  })

  it('should output decompressed content to stdout', async () => {
    await fs.write('/test.txt', 'Hello, World!')
    await gzip({ args: ['test.txt'], cwd: '/', fs })

    const result = await zcat({ args: ['test.txt.gz'], cwd: '/', fs })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Hello, World!')
    // Original .gz file should remain
    expect(await fs.exists('/test.txt.gz')).toBe(true)
  })

  it('should handle multiple files', async () => {
    await fs.write('/file1.txt', 'Content 1\n')
    await fs.write('/file2.txt', 'Content 2\n')
    await gzip({ args: ['file1.txt', 'file2.txt'], cwd: '/', fs })

    const result = await zcat({ args: ['file1.txt.gz', 'file2.txt.gz'], cwd: '/', fs })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Content 1')
    expect(result.stdout).toContain('Content 2')
  })

  it('should fail on nonexistent file', async () => {
    const result = await zcat({ args: ['nonexistent.gz'], cwd: '/', fs })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('nonexistent.gz')
  })
})

// ============================================================================
// TAR TESTS
// ============================================================================

describe('tar', () => {
  let fs: MockFs

  beforeEach(() => {
    fs = createMockFs()
  })

  describe('create archive (-cvf)', () => {
    it('should create a tar archive from files', async () => {
      await fs.write('/file1.txt', 'Content 1')
      await fs.write('/file2.txt', 'Content 2')

      const result = await tar({ args: ['-cvf', 'archive.tar', 'file1.txt', 'file2.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/archive.tar')).toBe(true)
      // Verbose output should list files
      expect(result.stdout).toContain('file1.txt')
      expect(result.stdout).toContain('file2.txt')
    })

    it('should create archive from directory', async () => {
      await fs.mkdir('/mydir')
      await fs.write('/mydir/file1.txt', 'Content 1')
      await fs.write('/mydir/file2.txt', 'Content 2')

      const result = await tar({ args: ['-cvf', 'archive.tar', 'mydir'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/archive.tar')).toBe(true)
    })

    it('should preserve file permissions', async () => {
      await fs.write('/script.sh', '#!/bin/bash\necho hello')
      fs.files.get('/script.sh')!.mode = 0o755

      await tar({ args: ['-cvf', 'archive.tar', 'script.sh'], cwd: '/', fs })

      // Extract and verify permissions
      await fs.rm('/script.sh')
      await tar({ args: ['-xvf', 'archive.tar'], cwd: '/', fs })

      const stat = await fs.stat('/script.sh')
      expect(stat.mode & 0o777).toBe(0o755)
    })

    it('should preserve timestamps', async () => {
      const mtime = new Date('2023-06-15T12:00:00Z')
      await fs.write('/file.txt', 'content')
      fs.files.get('/file.txt')!.mtime = mtime

      await tar({ args: ['-cvf', 'archive.tar', 'file.txt'], cwd: '/', fs })

      await fs.rm('/file.txt')
      await tar({ args: ['-xvf', 'archive.tar'], cwd: '/', fs })

      const stat = await fs.stat('/file.txt')
      expect(stat.mtime.getTime()).toBe(mtime.getTime())
    })

    it('should preserve symlinks', async () => {
      await fs.write('/target.txt', 'target content')
      await fs.symlink('target.txt', '/link.txt')

      await tar({ args: ['-cvf', 'archive.tar', 'target.txt', 'link.txt'], cwd: '/', fs })

      await fs.rm('/link.txt')
      await tar({ args: ['-xvf', 'archive.tar'], cwd: '/', fs })

      expect(await fs.stat('/link.txt').then(s => s.isSymbolicLink())).toBe(true)
      expect(await fs.readlink('/link.txt')).toBe('target.txt')
    })
  })

  describe('extract archive (-xvf)', () => {
    it('should extract tar archive', async () => {
      await fs.write('/file1.txt', 'Content 1')
      await fs.write('/file2.txt', 'Content 2')
      await tar({ args: ['-cvf', 'archive.tar', 'file1.txt', 'file2.txt'], cwd: '/', fs })

      // Remove original files
      await fs.rm('/file1.txt')
      await fs.rm('/file2.txt')

      const result = await tar({ args: ['-xvf', 'archive.tar'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/file1.txt')).toBe(true)
      expect(await fs.exists('/file2.txt')).toBe(true)
      expect(await fs.read('/file1.txt')).toBe('Content 1')
      expect(await fs.read('/file2.txt')).toBe('Content 2')
    })

    it('should extract to specific directory with -C', async () => {
      await fs.write('/file.txt', 'Content')
      await tar({ args: ['-cvf', 'archive.tar', 'file.txt'], cwd: '/', fs })
      await fs.rm('/file.txt')
      await fs.mkdir('/output')

      const result = await tar({ args: ['-C', '/output', '-xf', 'archive.tar'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/output/file.txt')).toBe(true)
    })
  })

  describe('list contents (-tvf)', () => {
    it('should list archive contents', async () => {
      await fs.write('/file1.txt', 'Content 1')
      await fs.write('/file2.txt', 'Content 2 longer')
      await tar({ args: ['-cvf', 'archive.tar', 'file1.txt', 'file2.txt'], cwd: '/', fs })

      const result = await tar({ args: ['-tvf', 'archive.tar'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('file1.txt')
      expect(result.stdout).toContain('file2.txt')
      // Should include file sizes
      expect(result.stdout).toMatch(/\d+/)
    })
  })

  describe('compressed archives', () => {
    it('should create gzip-compressed archive with -z', async () => {
      await fs.write('/file.txt', 'x'.repeat(1000))

      const result = await tar({ args: ['-czvf', 'archive.tar.gz', 'file.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/archive.tar.gz')).toBe(true)
    })

    it('should extract gzip-compressed archive with -z', async () => {
      await fs.write('/file.txt', 'Content')
      await tar({ args: ['-czvf', 'archive.tar.gz', 'file.txt'], cwd: '/', fs })
      await fs.rm('/file.txt')

      const result = await tar({ args: ['-xzvf', 'archive.tar.gz'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/file.txt')).toBe(true)
      expect(await fs.read('/file.txt')).toBe('Content')
    })

    it('should auto-detect .tar.gz extension', async () => {
      await fs.write('/file.txt', 'Content')
      await tar({ args: ['-cvf', 'archive.tar.gz', 'file.txt'], cwd: '/', fs })
      await fs.rm('/file.txt')

      // Should auto-detect gzip from extension
      const result = await tar({ args: ['-xvf', 'archive.tar.gz'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/file.txt')).toBe(true)
    })

    it('should handle .tgz extension', async () => {
      await fs.write('/file.txt', 'Content')
      await tar({ args: ['-czvf', 'archive.tgz', 'file.txt'], cwd: '/', fs })
      await fs.rm('/file.txt')

      const result = await tar({ args: ['-xvf', 'archive.tgz'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/file.txt')).toBe(true)
    })
  })

  describe('exclusions', () => {
    it('should exclude files matching pattern', async () => {
      await fs.mkdir('/project')
      await fs.write('/project/file.txt', 'Content')
      await fs.write('/project/debug.log', 'Log content')
      await fs.write('/project/error.log', 'Error content')

      const result = await tar({
        args: ['--exclude=*.log', '-cvf', 'archive.tar', 'project'],
        cwd: '/',
        fs,
      })

      expect(result.exitCode).toBe(0)

      // Extract and verify
      await fs.rm('/project/file.txt')
      await fs.rm('/project/debug.log')
      await fs.rm('/project/error.log')
      await tar({ args: ['-xvf', 'archive.tar'], cwd: '/', fs })

      expect(await fs.exists('/project/file.txt')).toBe(true)
      expect(await fs.exists('/project/debug.log')).toBe(false)
      expect(await fs.exists('/project/error.log')).toBe(false)
    })

    it('should support multiple exclusion patterns', async () => {
      await fs.mkdir('/project')
      await fs.write('/project/file.txt', 'Content')
      await fs.write('/project/test.log', 'Log')
      await fs.write('/project/cache.tmp', 'Temp')

      const result = await tar({
        args: ['--exclude=*.log', '--exclude=*.tmp', '-cvf', 'archive.tar', 'project'],
        cwd: '/',
        fs,
      })

      expect(result.exitCode).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should fail on nonexistent file', async () => {
      const result = await tar({ args: ['-cvf', 'archive.tar', 'nonexistent.txt'], cwd: '/', fs })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('nonexistent.txt')
    })

    it('should fail on invalid archive', async () => {
      await fs.write('/bad.tar', 'not a tar file')

      const result = await tar({ args: ['-xvf', 'bad.tar'], cwd: '/', fs })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('invalid')
    })
  })
})

// ============================================================================
// ZIP / UNZIP TESTS
// ============================================================================

describe('zip', () => {
  let fs: MockFs

  beforeEach(() => {
    fs = createMockFs()
  })

  describe('basic zip creation', () => {
    it('should create a zip archive from files', async () => {
      await fs.write('/file1.txt', 'Content 1')
      await fs.write('/file2.txt', 'Content 2')

      const result = await zip({ args: ['archive.zip', 'file1.txt', 'file2.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/archive.zip')).toBe(true)
      // Output should show files added
      expect(result.stdout).toContain('adding')
    })

    it('should update existing zip with new files', async () => {
      await fs.write('/file1.txt', 'Content 1')
      await zip({ args: ['archive.zip', 'file1.txt'], cwd: '/', fs })

      await fs.write('/file2.txt', 'Content 2')
      const result = await zip({ args: ['archive.zip', 'file2.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)

      // Extract and verify both files exist
      await fs.rm('/file1.txt')
      await fs.rm('/file2.txt')
      await unzip({ args: ['archive.zip'], cwd: '/', fs })

      expect(await fs.exists('/file1.txt')).toBe(true)
      expect(await fs.exists('/file2.txt')).toBe(true)
    })
  })

  describe('-r (recursive)', () => {
    it('should recursively add directory contents', async () => {
      await fs.mkdir('/project')
      await fs.mkdir('/project/src')
      await fs.write('/project/file.txt', 'Root file')
      await fs.write('/project/src/main.ts', 'export const x = 1')

      const result = await zip({ args: ['-r', 'archive.zip', 'project'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)

      // Verify contents
      await fs.rm('/project/file.txt')
      await fs.rm('/project/src/main.ts')
      await unzip({ args: ['archive.zip'], cwd: '/', fs })

      expect(await fs.exists('/project/file.txt')).toBe(true)
      expect(await fs.exists('/project/src/main.ts')).toBe(true)
    })
  })

  describe('compression level', () => {
    it('should support compression level 0-9', async () => {
      await fs.write('/file.txt', 'x'.repeat(1000))

      const result = await zip({ args: ['-9', 'archive.zip', 'file.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
    })

    it('should store without compression with -0', async () => {
      await fs.write('/file.txt', 'Content')

      const result = await zip({ args: ['-0', 'archive.zip', 'file.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should fail on nonexistent file', async () => {
      const result = await zip({ args: ['archive.zip', 'nonexistent.txt'], cwd: '/', fs })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('nonexistent.txt')
    })
  })
})

describe('unzip', () => {
  let fs: MockFs

  beforeEach(() => {
    fs = createMockFs()
  })

  describe('basic extraction', () => {
    it('should extract zip archive', async () => {
      await fs.write('/file1.txt', 'Content 1')
      await fs.write('/file2.txt', 'Content 2')
      await zip({ args: ['archive.zip', 'file1.txt', 'file2.txt'], cwd: '/', fs })
      await fs.rm('/file1.txt')
      await fs.rm('/file2.txt')

      const result = await unzip({ args: ['archive.zip'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/file1.txt')).toBe(true)
      expect(await fs.exists('/file2.txt')).toBe(true)
      expect(await fs.read('/file1.txt')).toBe('Content 1')
      expect(await fs.read('/file2.txt')).toBe('Content 2')
    })
  })

  describe('-l (list contents)', () => {
    it('should list archive contents without extracting', async () => {
      await fs.write('/file1.txt', 'Content 1')
      await fs.write('/file2.txt', 'Longer content 2')
      await zip({ args: ['archive.zip', 'file1.txt', 'file2.txt'], cwd: '/', fs })
      await fs.rm('/file1.txt')
      await fs.rm('/file2.txt')

      const result = await unzip({ args: ['-l', 'archive.zip'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('file1.txt')
      expect(result.stdout).toContain('file2.txt')
      // Should show sizes
      expect(result.stdout).toMatch(/\d+/)
      // Files should NOT be extracted
      expect(await fs.exists('/file1.txt')).toBe(false)
      expect(await fs.exists('/file2.txt')).toBe(false)
    })
  })

  describe('-d (destination directory)', () => {
    it('should extract to specified directory', async () => {
      await fs.write('/file.txt', 'Content')
      await zip({ args: ['archive.zip', 'file.txt'], cwd: '/', fs })
      await fs.rm('/file.txt')
      await fs.mkdir('/output')

      const result = await unzip({ args: ['-d', '/output', 'archive.zip'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/output/file.txt')).toBe(true)
      expect(await fs.exists('/file.txt')).toBe(false)
    })

    it('should create destination directory if it does not exist', async () => {
      await fs.write('/file.txt', 'Content')
      await zip({ args: ['archive.zip', 'file.txt'], cwd: '/', fs })
      await fs.rm('/file.txt')

      const result = await unzip({ args: ['-d', '/newdir', 'archive.zip'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/newdir/file.txt')).toBe(true)
    })
  })

  describe('-p (pipe to stdout)', () => {
    it('should extract file content to stdout', async () => {
      await fs.write('/file.txt', 'Hello, World!')
      await zip({ args: ['archive.zip', 'file.txt'], cwd: '/', fs })
      await fs.rm('/file.txt')

      const result = await unzip({ args: ['-p', 'archive.zip', 'file.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello, World!')
      // File should NOT be extracted to disk
      expect(await fs.exists('/file.txt')).toBe(false)
    })

    it('should extract all files to stdout without filename argument', async () => {
      await fs.write('/file1.txt', 'Content 1\n')
      await fs.write('/file2.txt', 'Content 2\n')
      await zip({ args: ['archive.zip', 'file1.txt', 'file2.txt'], cwd: '/', fs })
      await fs.rm('/file1.txt')
      await fs.rm('/file2.txt')

      const result = await unzip({ args: ['-p', 'archive.zip'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Content 1')
      expect(result.stdout).toContain('Content 2')
    })
  })

  describe('-o (overwrite)', () => {
    it('should overwrite existing files without prompting', async () => {
      await fs.write('/file.txt', 'Original')
      await zip({ args: ['archive.zip', 'file.txt'], cwd: '/', fs })

      // Modify the file
      await fs.write('/file.txt', 'Modified')

      const result = await unzip({ args: ['-o', 'archive.zip'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.read('/file.txt')).toBe('Original')
    })
  })

  describe('selective extraction', () => {
    it('should extract specific files by name', async () => {
      await fs.write('/file1.txt', 'Content 1')
      await fs.write('/file2.txt', 'Content 2')
      await fs.write('/file3.txt', 'Content 3')
      await zip({ args: ['archive.zip', 'file1.txt', 'file2.txt', 'file3.txt'], cwd: '/', fs })
      await fs.rm('/file1.txt')
      await fs.rm('/file2.txt')
      await fs.rm('/file3.txt')

      const result = await unzip({ args: ['archive.zip', 'file1.txt', 'file3.txt'], cwd: '/', fs })

      expect(result.exitCode).toBe(0)
      expect(await fs.exists('/file1.txt')).toBe(true)
      expect(await fs.exists('/file2.txt')).toBe(false)
      expect(await fs.exists('/file3.txt')).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should fail on nonexistent archive', async () => {
      const result = await unzip({ args: ['nonexistent.zip'], cwd: '/', fs })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('nonexistent.zip')
    })

    it('should fail on invalid zip data', async () => {
      await fs.write('/bad.zip', 'not a zip file')

      const result = await unzip({ args: ['bad.zip'], cwd: '/', fs })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('invalid')
    })

    it('should handle file not found in archive', async () => {
      await fs.write('/file.txt', 'Content')
      await zip({ args: ['archive.zip', 'file.txt'], cwd: '/', fs })
      await fs.rm('/file.txt')

      const result = await unzip({ args: ['archive.zip', 'nonexistent.txt'], cwd: '/', fs })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('nonexistent.txt')
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('compression integration', () => {
  let fs: MockFs

  beforeEach(() => {
    fs = createMockFs()
  })

  describe('round-trip verification', () => {
    it('should preserve data through gzip round-trip', async () => {
      const originalContent = 'Hello, World! 123 special chars: @#$%^&*()'
      await fs.write('/test.txt', originalContent)

      await gzip({ args: ['test.txt'], cwd: '/', fs })
      await gunzip({ args: ['test.txt.gz'], cwd: '/', fs })

      const recovered = await fs.read('/test.txt')
      expect(recovered).toBe(originalContent)
    })

    it('should preserve data through tar round-trip', async () => {
      const content1 = 'File 1 content'
      const content2 = 'File 2 content with more data'
      await fs.write('/file1.txt', content1)
      await fs.write('/file2.txt', content2)

      await tar({ args: ['-cvf', 'archive.tar', 'file1.txt', 'file2.txt'], cwd: '/', fs })
      await fs.rm('/file1.txt')
      await fs.rm('/file2.txt')
      await tar({ args: ['-xvf', 'archive.tar'], cwd: '/', fs })

      expect(await fs.read('/file1.txt')).toBe(content1)
      expect(await fs.read('/file2.txt')).toBe(content2)
    })

    it('should preserve data through zip round-trip', async () => {
      const content = 'ZIP test content!'
      await fs.write('/test.txt', content)

      await zip({ args: ['archive.zip', 'test.txt'], cwd: '/', fs })
      await fs.rm('/test.txt')
      await unzip({ args: ['archive.zip'], cwd: '/', fs })

      expect(await fs.read('/test.txt')).toBe(content)
    })

    it('should preserve data through tar.gz round-trip', async () => {
      const content = 'TAR.GZ test content with lots of data '.repeat(100)
      await fs.write('/test.txt', content)

      await tar({ args: ['-czvf', 'archive.tar.gz', 'test.txt'], cwd: '/', fs })
      await fs.rm('/test.txt')
      await tar({ args: ['-xzvf', 'archive.tar.gz'], cwd: '/', fs })

      expect(await fs.read('/test.txt')).toBe(content)
    })
  })

  describe('binary data handling', () => {
    it('should handle binary data in gzip', async () => {
      const binaryData = new Uint8Array([0, 1, 2, 255, 254, 253, 128, 127])
      await fs.write('/binary.dat', binaryData)

      await gzip({ args: ['binary.dat'], cwd: '/', fs })
      await gunzip({ args: ['binary.dat.gz'], cwd: '/', fs })

      const recovered = await fs.read('/binary.dat')
      expect(recovered).toEqual(binaryData)
    })

    it('should handle binary data in tar', async () => {
      const binaryData = new Uint8Array([0, 1, 2, 255, 254, 253, 128, 127])
      await fs.write('/binary.dat', binaryData)

      await tar({ args: ['-cvf', 'archive.tar', 'binary.dat'], cwd: '/', fs })
      await fs.rm('/binary.dat')
      await tar({ args: ['-xvf', 'archive.tar'], cwd: '/', fs })

      const recovered = await fs.read('/binary.dat')
      expect(recovered).toEqual(binaryData)
    })

    it('should handle binary data in zip', async () => {
      const binaryData = new Uint8Array([0, 1, 2, 255, 254, 253, 128, 127])
      await fs.write('/binary.dat', binaryData)

      await zip({ args: ['archive.zip', 'binary.dat'], cwd: '/', fs })
      await fs.rm('/binary.dat')
      await unzip({ args: ['archive.zip'], cwd: '/', fs })

      const recovered = await fs.read('/binary.dat')
      expect(recovered).toEqual(binaryData)
    })
  })

  describe('large file handling', () => {
    it('should handle large files in gzip', async () => {
      const largeContent = 'x'.repeat(100000)
      await fs.write('/large.txt', largeContent)

      await gzip({ args: ['large.txt'], cwd: '/', fs })
      await gunzip({ args: ['large.txt.gz'], cwd: '/', fs })

      const recovered = await fs.read('/large.txt')
      expect(recovered).toBe(largeContent)
    })
  })

  describe('special characters in filenames', () => {
    it('should handle spaces in filenames', async () => {
      await fs.write('/file with spaces.txt', 'Content')

      await tar({ args: ['-cvf', 'archive.tar', 'file with spaces.txt'], cwd: '/', fs })
      await fs.rm('/file with spaces.txt')
      await tar({ args: ['-xvf', 'archive.tar'], cwd: '/', fs })

      expect(await fs.exists('/file with spaces.txt')).toBe(true)
    })

    it('should handle unicode in filenames', async () => {
      await fs.write('/file-unicode.txt', 'Content')

      await zip({ args: ['archive.zip', 'file-unicode.txt'], cwd: '/', fs })
      await fs.rm('/file-unicode.txt')
      await unzip({ args: ['archive.zip'], cwd: '/', fs })

      expect(await fs.exists('/file-unicode.txt')).toBe(true)
    })
  })
})
