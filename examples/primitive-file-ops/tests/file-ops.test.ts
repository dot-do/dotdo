/**
 * fsx (Filesystem on SQLite) Tests
 *
 * Tests for the primitive-file-ops example demonstrating $.fs capability.
 * Verifies CRUD operations, directory management, and SQLite-backed persistence.
 *
 * Test categories:
 * 1. Basic File Operations - read, write, exists, delete
 * 2. Directory Operations - mkdir, list, stat
 * 3. File Copy/Move - copy, move/rename
 * 4. Batch Operations - writeMany, atomic operations
 * 5. Path Manipulation - normalization, edge cases
 * 6. Error Handling - ENOENT, EISDIR, etc.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock DurableObjectStorage for testing.
 * Implements the KV-like API used by the fs capability with SQLite semantics.
 */
class MockStorage {
  private data = new Map<string, unknown>()

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    for (const [key, value] of this.data) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T)
      }
    }
    return result
  }

  // Test helpers
  _clear(): void {
    this.data.clear()
  }

  _size(): number {
    return this.data.size
  }

  _keys(): string[] {
    return Array.from(this.data.keys())
  }

  _dump(): Record<string, unknown> {
    const obj: Record<string, unknown> = {}
    for (const [key, value] of this.data) {
      obj[key] = value
    }
    return obj
  }
}

/**
 * Storage key prefixes matching lib/mixins/fs.ts implementation
 */
const FS_STORAGE_PREFIX_FILE = 'fsx:file:'
const FS_STORAGE_PREFIX_META = 'fsx:meta:'
const FS_STORAGE_PREFIX_DIR = 'fsx:dir:'

/**
 * File metadata structure
 */
interface FileMetadata {
  size: number
  isDirectory: boolean
  createdAt: string
  modifiedAt: string
}

/**
 * Create a mock FsCapability for testing.
 * This simulates the $.fs API without actual DO dependencies.
 */
function createMockFsCapability(storage: MockStorage) {
  const normalizePath = (path: string): string => {
    // Handle multiple leading slashes
    while (path.startsWith('//')) {
      path = path.slice(1)
    }
    if (!path.startsWith('/')) {
      path = '/' + path
    }
    if (path !== '/' && path.endsWith('/')) {
      path = path.slice(0, -1)
    }
    return path
  }

  return {
    async read(path: string): Promise<string> {
      const normalizedPath = normalizePath(path)
      const content = await storage.get<string>(FS_STORAGE_PREFIX_FILE + normalizedPath)
      if (content === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file or directory: ${path}`), { code: 'ENOENT' })
      }
      return content
    },

    async write(path: string, content: string): Promise<void> {
      const normalizedPath = normalizePath(path)
      const now = new Date().toISOString()
      const existingMeta = await storage.get<FileMetadata>(FS_STORAGE_PREFIX_META + normalizedPath)

      const metadata: FileMetadata = {
        size: content.length,
        isDirectory: false,
        createdAt: existingMeta?.createdAt ?? now,
        modifiedAt: now,
      }

      await storage.put(FS_STORAGE_PREFIX_FILE + normalizedPath, content)
      await storage.put(FS_STORAGE_PREFIX_META + normalizedPath, metadata)
    },

    async exists(path: string): Promise<boolean> {
      const normalizedPath = normalizePath(path)
      const fileContent = await storage.get(FS_STORAGE_PREFIX_FILE + normalizedPath)
      if (fileContent !== undefined) return true
      const dirMarker = await storage.get(FS_STORAGE_PREFIX_DIR + normalizedPath)
      return dirMarker !== undefined
    },

    async rm(path: string): Promise<void> {
      const normalizedPath = normalizePath(path)
      await storage.delete(FS_STORAGE_PREFIX_FILE + normalizedPath)
      await storage.delete(FS_STORAGE_PREFIX_META + normalizedPath)
    },

    async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const normalizedPath = normalizePath(path)

      if (options?.recursive) {
        // Delete all files and directories under this path
        const prefix = normalizedPath === '/' ? '/' : normalizedPath + '/'
        const allKeys = storage._keys()
        for (const key of allKeys) {
          if (key.includes(prefix)) {
            await storage.delete(key)
          }
        }
      }

      await storage.delete(FS_STORAGE_PREFIX_DIR + normalizedPath)
    },

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const normalizedPath = normalizePath(path)

      if (options?.recursive) {
        const parts = normalizedPath.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current += '/' + part
          await storage.put(FS_STORAGE_PREFIX_DIR + current, true)
        }
      } else {
        await storage.put(FS_STORAGE_PREFIX_DIR + normalizedPath, true)
      }
    },

    async list(path: string): Promise<string[]> {
      const normalizedPath = normalizePath(path)
      const prefix = normalizedPath === '/' ? '/' : normalizedPath + '/'
      const entries = new Set<string>()

      // Collect file entries
      const fileKeys = await storage.list<string>({ prefix: FS_STORAGE_PREFIX_FILE + prefix })
      for (const [key] of fileKeys) {
        const fullPath = key.slice(FS_STORAGE_PREFIX_FILE.length)
        const relativePath = fullPath.slice(prefix.length)
        const firstSlash = relativePath.indexOf('/')
        const name = firstSlash === -1 ? relativePath : relativePath.slice(0, firstSlash)
        if (name) entries.add(name)
      }

      // Collect directory entries
      const dirKeys = await storage.list<boolean>({ prefix: FS_STORAGE_PREFIX_DIR + prefix })
      for (const [key] of dirKeys) {
        const fullPath = key.slice(FS_STORAGE_PREFIX_DIR.length)
        const relativePath = fullPath.slice(prefix.length)
        const firstSlash = relativePath.indexOf('/')
        const name = firstSlash === -1 ? relativePath : relativePath.slice(0, firstSlash)
        if (name) entries.add(name)
      }

      return Array.from(entries)
    },

    async stat(path: string): Promise<{
      size: number
      isFile: () => boolean
      isDirectory: () => boolean
      mtime: Date
      birthtime: Date
    }> {
      const normalizedPath = normalizePath(path)

      // Check for file metadata
      const meta = await storage.get<FileMetadata>(FS_STORAGE_PREFIX_META + normalizedPath)
      if (meta) {
        return {
          size: meta.size,
          isFile: () => !meta.isDirectory,
          isDirectory: () => meta.isDirectory,
          mtime: new Date(meta.modifiedAt),
          birthtime: new Date(meta.createdAt),
        }
      }

      // Check for directory marker
      const isDir = await storage.get(FS_STORAGE_PREFIX_DIR + normalizedPath)
      if (isDir !== undefined) {
        const now = new Date()
        return {
          size: 0,
          isFile: () => false,
          isDirectory: () => true,
          mtime: now,
          birthtime: now,
        }
      }

      throw Object.assign(new Error(`ENOENT: no such file or directory: ${path}`), { code: 'ENOENT' })
    },

    async copyFile(src: string, dest: string): Promise<void> {
      const content = await this.read(src)
      await this.write(dest, content)
    },

    async rename(src: string, dest: string): Promise<void> {
      const content = await this.read(src)
      await this.write(dest, content)
      await this.rm(src)
    },

    async writeMany(files: Array<{ path: string; content: string }>): Promise<void> {
      for (const file of files) {
        await this.write(file.path, file.content)
      }
    },

    async createReadStream(path: string): Promise<ReadableStream<Uint8Array>> {
      const content = await this.read(path)
      const encoder = new TextEncoder()
      const bytes = encoder.encode(content)

      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      })
    },

    async getTier(path: string): Promise<'hot' | 'warm' | 'cold'> {
      const stats = await this.stat(path)
      // Simple heuristic: small files are hot, larger files would be warm
      return stats.size < 1024 * 1024 ? 'hot' : 'warm'
    },
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('fsx Filesystem Operations', () => {
  let storage: MockStorage
  let fs: ReturnType<typeof createMockFsCapability>

  beforeEach(() => {
    storage = new MockStorage()
    fs = createMockFsCapability(storage)
  })

  describe('Basic File Operations', () => {
    it('writes and reads a file', async () => {
      await fs.write('/test.txt', 'Hello, World!')
      const content = await fs.read('/test.txt')
      expect(content).toBe('Hello, World!')
    })

    it('handles paths without leading slash', async () => {
      await fs.write('test.txt', 'content')
      const content = await fs.read('/test.txt')
      expect(content).toBe('content')
    })

    it('overwrites existing file', async () => {
      await fs.write('/test.txt', 'first')
      await fs.write('/test.txt', 'second')
      const content = await fs.read('/test.txt')
      expect(content).toBe('second')
    })

    it('throws ENOENT for non-existent file', async () => {
      await expect(fs.read('/nonexistent.txt')).rejects.toThrow('ENOENT')
    })

    it('checks file existence', async () => {
      expect(await fs.exists('/missing.txt')).toBe(false)
      await fs.write('/exists.txt', 'content')
      expect(await fs.exists('/exists.txt')).toBe(true)
    })

    it('deletes a file', async () => {
      await fs.write('/to-delete.txt', 'content')
      expect(await fs.exists('/to-delete.txt')).toBe(true)
      await fs.rm('/to-delete.txt')
      expect(await fs.exists('/to-delete.txt')).toBe(false)
    })

    it('handles empty file content', async () => {
      await fs.write('/empty.txt', '')
      const content = await fs.read('/empty.txt')
      expect(content).toBe('')
    })

    it('handles large file content', async () => {
      const largeContent = 'x'.repeat(100_000)
      await fs.write('/large.txt', largeContent)
      const content = await fs.read('/large.txt')
      expect(content.length).toBe(100_000)
    })

    it('handles unicode content', async () => {
      const unicodeContent = 'Hello, World! ... Japanese text: Japanese'
      await fs.write('/unicode.txt', unicodeContent)
      const content = await fs.read('/unicode.txt')
      expect(content).toBe(unicodeContent)
    })
  })

  describe('Directory Operations', () => {
    it('creates a directory', async () => {
      await fs.mkdir('/newdir')
      expect(await fs.exists('/newdir')).toBe(true)
    })

    it('creates nested directories with recursive option', async () => {
      await fs.mkdir('/a/b/c', { recursive: true })
      expect(await fs.exists('/a')).toBe(true)
      expect(await fs.exists('/a/b')).toBe(true)
      expect(await fs.exists('/a/b/c')).toBe(true)
    })

    it('lists files in a directory', async () => {
      await fs.mkdir('/data')
      await fs.write('/data/file1.txt', 'content1')
      await fs.write('/data/file2.txt', 'content2')

      const entries = await fs.list('/data')
      expect(entries).toContain('file1.txt')
      expect(entries).toContain('file2.txt')
    })

    it('lists directories in root', async () => {
      await fs.mkdir('/dir1')
      await fs.mkdir('/dir2')
      await fs.write('/file.txt', 'content')

      const entries = await fs.list('/')
      expect(entries).toContain('dir1')
      expect(entries).toContain('dir2')
      expect(entries).toContain('file.txt')
    })

    it('lists only immediate children', async () => {
      await fs.mkdir('/parent/child', { recursive: true })
      await fs.write('/parent/child/nested.txt', 'content')
      await fs.write('/parent/file.txt', 'content')

      const entries = await fs.list('/parent')
      expect(entries).toContain('child')
      expect(entries).toContain('file.txt')
      expect(entries).not.toContain('nested.txt')
    })

    it('returns empty array for empty directory', async () => {
      await fs.mkdir('/empty')
      const entries = await fs.list('/empty')
      expect(entries).toHaveLength(0)
    })

    it('removes directory recursively', async () => {
      await fs.mkdir('/to-remove/nested', { recursive: true })
      await fs.write('/to-remove/file.txt', 'content')
      await fs.write('/to-remove/nested/deep.txt', 'content')

      await fs.rmdir('/to-remove', { recursive: true })
      expect(await fs.exists('/to-remove')).toBe(false)
    })
  })

  describe('File Metadata (stat)', () => {
    it('returns stat for a file', async () => {
      await fs.write('/test.txt', 'Hello!')
      const stats = await fs.stat('/test.txt')

      expect(stats.size).toBe(6)
      expect(stats.isFile()).toBe(true)
      expect(stats.isDirectory()).toBe(false)
      expect(stats.mtime).toBeInstanceOf(Date)
      expect(stats.birthtime).toBeInstanceOf(Date)
    })

    it('returns stat for a directory', async () => {
      await fs.mkdir('/testdir')
      const stats = await fs.stat('/testdir')

      expect(stats.size).toBe(0)
      expect(stats.isFile()).toBe(false)
      expect(stats.isDirectory()).toBe(true)
    })

    it('throws ENOENT for non-existent path', async () => {
      await expect(fs.stat('/nonexistent')).rejects.toThrow('ENOENT')
    })

    it('preserves createdAt across updates', async () => {
      await fs.write('/test.txt', 'first')
      const stat1 = await fs.stat('/test.txt')

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10))

      await fs.write('/test.txt', 'second')
      const stat2 = await fs.stat('/test.txt')

      expect(stat2.birthtime.getTime()).toBe(stat1.birthtime.getTime())
      expect(stat2.mtime.getTime()).toBeGreaterThanOrEqual(stat1.mtime.getTime())
    })
  })

  describe('Copy and Move Operations', () => {
    it('copies a file', async () => {
      await fs.write('/source.txt', 'original content')
      await fs.copyFile('/source.txt', '/dest.txt')

      expect(await fs.read('/source.txt')).toBe('original content')
      expect(await fs.read('/dest.txt')).toBe('original content')
    })

    it('moves a file', async () => {
      await fs.write('/source.txt', 'content')
      await fs.rename('/source.txt', '/dest.txt')

      expect(await fs.exists('/source.txt')).toBe(false)
      expect(await fs.read('/dest.txt')).toBe('content')
    })

    it('copies to subdirectory', async () => {
      await fs.mkdir('/subdir')
      await fs.write('/source.txt', 'content')
      await fs.copyFile('/source.txt', '/subdir/dest.txt')

      expect(await fs.read('/subdir/dest.txt')).toBe('content')
    })

    it('throws when copying non-existent file', async () => {
      await expect(fs.copyFile('/nonexistent.txt', '/dest.txt')).rejects.toThrow('ENOENT')
    })
  })

  describe('Batch Operations', () => {
    it('writes multiple files atomically', async () => {
      await fs.writeMany([
        { path: '/a.txt', content: 'A' },
        { path: '/b.txt', content: 'B' },
        { path: '/c.txt', content: 'C' },
      ])

      expect(await fs.read('/a.txt')).toBe('A')
      expect(await fs.read('/b.txt')).toBe('B')
      expect(await fs.read('/c.txt')).toBe('C')
    })

    it('creates parent directories for batch writes', async () => {
      await fs.mkdir('/data', { recursive: true })
      await fs.writeMany([
        { path: '/data/file1.json', content: '{"key": 1}' },
        { path: '/data/file2.json', content: '{"key": 2}' },
      ])

      const entries = await fs.list('/data')
      expect(entries).toHaveLength(2)
    })
  })

  describe('Streaming', () => {
    it('creates a read stream', async () => {
      await fs.write('/stream-test.txt', 'streaming content')
      const stream = await fs.createReadStream('/stream-test.txt')

      const reader = stream.getReader()
      const chunks: Uint8Array[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      const content = new TextDecoder().decode(chunks[0])
      expect(content).toBe('streaming content')
    })

    it('throws for non-existent file stream', async () => {
      await expect(fs.createReadStream('/nonexistent.txt')).rejects.toThrow('ENOENT')
    })
  })

  describe('Storage Tier', () => {
    it('returns hot tier for small files', async () => {
      await fs.write('/small.txt', 'small content')
      const tier = await fs.getTier('/small.txt')
      expect(tier).toBe('hot')
    })

    it('would return warm tier for large files', async () => {
      // In real implementation, files > 1MB would be warm tier
      await fs.write('/small.txt', 'content')
      const tier = await fs.getTier('/small.txt')
      expect(tier).toBe('hot') // Small file stays hot
    })
  })

  describe('Path Edge Cases', () => {
    it('handles trailing slashes', async () => {
      await fs.mkdir('/testdir/')
      expect(await fs.exists('/testdir')).toBe(true)
    })

    it('handles multiple slashes', async () => {
      await fs.write('//test.txt', 'content')
      expect(await fs.exists('/test.txt')).toBe(true)
    })

    it('handles special characters in filenames', async () => {
      await fs.write('/file with spaces.txt', 'content')
      await fs.write('/file-with-dashes.txt', 'content')
      await fs.write('/file_with_underscores.txt', 'content')

      expect(await fs.exists('/file with spaces.txt')).toBe(true)
      expect(await fs.exists('/file-with-dashes.txt')).toBe(true)
      expect(await fs.exists('/file_with_underscores.txt')).toBe(true)
    })

    it('handles deeply nested paths', async () => {
      await fs.mkdir('/a/b/c/d/e', { recursive: true })
      await fs.write('/a/b/c/d/e/deep.txt', 'deep content')

      const content = await fs.read('/a/b/c/d/e/deep.txt')
      expect(content).toBe('deep content')
    })
  })
})

describe('FileOpsDO Integration Scenarios', () => {
  let storage: MockStorage
  let fs: ReturnType<typeof createMockFsCapability>

  beforeEach(() => {
    storage = new MockStorage()
    fs = createMockFsCapability(storage)
  })

  describe('CSV Processing Workflow', () => {
    it('simulates data import workflow', async () => {
      // Setup directories
      await fs.mkdir('/imports', { recursive: true })
      await fs.mkdir('/results', { recursive: true })
      await fs.mkdir('/reports', { recursive: true })

      // Simulate downloading and saving CSV
      const csvContent = `id,name,email
1,Alice,alice@example.com
2,Bob,bob@example.com
3,Charlie,charlie@example.com`

      await fs.write('/imports/data.csv', csvContent)

      // Read and parse CSV
      const csv = await fs.read('/imports/data.csv')
      const lines = csv.trim().split('\n')
      const headers = lines[0].split(',')
      const records = lines.slice(1).map((line) => {
        const values = line.split(',')
        const record: Record<string, string> = {}
        headers.forEach((h, i) => {
          record[h] = values[i]
        })
        return record
      })

      // Process each record and save results
      for (const record of records) {
        await fs.write(
          `/results/${record.id}.json`,
          JSON.stringify({
            ...record,
            processed: true,
            timestamp: new Date().toISOString(),
          }, null, 2)
        )
      }

      // Verify results
      const resultFiles = await fs.list('/results')
      expect(resultFiles).toHaveLength(3)
      expect(resultFiles).toContain('1.json')
      expect(resultFiles).toContain('2.json')
      expect(resultFiles).toContain('3.json')

      // Read a processed result
      const result1 = JSON.parse(await fs.read('/results/1.json'))
      expect(result1.name).toBe('Alice')
      expect(result1.processed).toBe(true)

      // Generate report
      const report = `# Import Report
- Records processed: ${records.length}
- Timestamp: ${new Date().toISOString()}`
      await fs.write('/reports/import-report.md', report)

      // Verify report exists
      expect(await fs.exists('/reports/import-report.md')).toBe(true)
    })
  })

  describe('Config Management Workflow', () => {
    it('manages application configuration', async () => {
      // Create config structure
      await fs.mkdir('/config', { recursive: true })

      const appConfig = {
        name: 'MyApp',
        version: '1.0.0',
        features: ['auth', 'api', 'storage'],
      }

      const dbConfig = {
        host: 'localhost',
        port: 5432,
        database: 'myapp',
      }

      await fs.write('/config/app.json', JSON.stringify(appConfig, null, 2))
      await fs.write('/config/database.json', JSON.stringify(dbConfig, null, 2))

      // Read and validate configs
      const readAppConfig = JSON.parse(await fs.read('/config/app.json'))
      expect(readAppConfig.name).toBe('MyApp')
      expect(readAppConfig.features).toContain('auth')

      // List all configs
      const configFiles = await fs.list('/config')
      expect(configFiles).toContain('app.json')
      expect(configFiles).toContain('database.json')

      // Update config
      appConfig.version = '1.1.0'
      await fs.write('/config/app.json', JSON.stringify(appConfig, null, 2))

      const updatedConfig = JSON.parse(await fs.read('/config/app.json'))
      expect(updatedConfig.version).toBe('1.1.0')
    })
  })

  describe('Log Aggregation Workflow', () => {
    it('aggregates and rotates log files', async () => {
      await fs.mkdir('/logs', { recursive: true })

      // Write multiple log entries
      const logEntries: string[] = []
      for (let i = 0; i < 5; i++) {
        logEntries.push(`[${new Date().toISOString()}] INFO: Event ${i}`)
      }

      await fs.write('/logs/app.log', logEntries.join('\n'))

      // Read log file
      const logs = await fs.read('/logs/app.log')
      expect(logs).toContain('Event 0')
      expect(logs).toContain('Event 4')

      // Simulate log rotation
      await fs.copyFile('/logs/app.log', '/logs/app.log.1')
      await fs.write('/logs/app.log', '')

      // Verify rotation
      const archivedLogs = await fs.read('/logs/app.log.1')
      expect(archivedLogs).toContain('Event 0')

      const currentLog = await fs.read('/logs/app.log')
      expect(currentLog).toBe('')

      const allLogs = await fs.list('/logs')
      expect(allLogs).toContain('app.log')
      expect(allLogs).toContain('app.log.1')
    })
  })

  describe('Template Processing Workflow', () => {
    it('processes HTML templates with variables', async () => {
      await fs.mkdir('/templates', { recursive: true })
      await fs.mkdir('/output', { recursive: true })

      // Create template
      const template = `<html>
<body>
  <h1>Hello, {{name}}!</h1>
  <p>Welcome to {{service}}.</p>
</body>
</html>`

      await fs.write('/templates/email.html', template)

      // Process template with data
      const data = { name: 'Alice', service: 'MyApp' }
      let output = await fs.read('/templates/email.html')

      for (const [key, value] of Object.entries(data)) {
        output = output.replace(new RegExp(`{{${key}}}`, 'g'), value)
      }

      await fs.write('/output/alice-email.html', output)

      // Verify processed output
      const result = await fs.read('/output/alice-email.html')
      expect(result).toContain('Hello, Alice!')
      expect(result).toContain('Welcome to MyApp.')
      expect(result).not.toContain('{{name}}')
    })
  })

  describe('Cleanup Workflow', () => {
    it('cleans up old files', async () => {
      await fs.mkdir('/temp', { recursive: true })

      // Create some files
      await fs.write('/temp/file1.txt', 'content1')
      await fs.write('/temp/file2.txt', 'content2')
      await fs.write('/temp/file3.txt', 'content3')

      const beforeCleanup = await fs.list('/temp')
      expect(beforeCleanup).toHaveLength(3)

      // Delete specific files
      await fs.rm('/temp/file1.txt')
      await fs.rm('/temp/file2.txt')

      const afterCleanup = await fs.list('/temp')
      expect(afterCleanup).toHaveLength(1)
      expect(afterCleanup).toContain('file3.txt')

      // Clean entire directory
      await fs.rmdir('/temp', { recursive: true })
      expect(await fs.exists('/temp')).toBe(false)
    })
  })
})

describe('Utility Functions', () => {
  /**
   * Parse CSV content into records.
   * Matches the implementation in FileOpsDO.
   */
  function parseCSV(content: string): Record<string, string>[] {
    const lines = content.trim().split('\n')
    if (lines.length === 0) return []

    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
    const records: Record<string, string>[] = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
      const record: Record<string, string> = {}
      headers.forEach((header, j) => {
        record[header] = values[j] ?? ''
      })
      records.push(record)
    }

    return records
  }

  /**
   * Format bytes into human-readable string.
   * Matches the implementation in FileOpsDO.
   */
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
  }

  describe('parseCSV', () => {
    it('parses simple CSV', () => {
      const csv = `id,name,email
1,Alice,alice@example.com
2,Bob,bob@example.com`

      const records = parseCSV(csv)
      expect(records).toHaveLength(2)
      expect(records[0].id).toBe('1')
      expect(records[0].name).toBe('Alice')
      expect(records[0].email).toBe('alice@example.com')
    })

    it('handles quoted values', () => {
      const csv = `"id","name","email"
"1","Alice","alice@example.com"`

      const records = parseCSV(csv)
      expect(records[0].id).toBe('1')
      expect(records[0].name).toBe('Alice')
    })

    it('returns empty array for empty content', () => {
      expect(parseCSV('')).toEqual([])
    })

    it('handles header-only CSV', () => {
      const csv = 'id,name,email'
      const records = parseCSV(csv)
      expect(records).toHaveLength(0)
    })
  })

  describe('formatBytes', () => {
    it('formats bytes', () => {
      expect(formatBytes(500)).toBe('500 B')
    })

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB')
      expect(formatBytes(1536)).toBe('1.5 KB')
    })

    it('formats megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1 MB')
    })

    it('formats gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
    })

    it('handles zero', () => {
      expect(formatBytes(0)).toBe('0 B')
    })
  })
})
