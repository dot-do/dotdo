/**
 * CSV Analyzer Tests
 *
 * Tests for the CSVAnalyzer class that demonstrates fsx capabilities
 * for data processing workflows:
 * - Parse CSV files
 * - Analyze columns and data types
 * - Generate statistics and reports
 * - Store results using fsx operations
 *
 * TDD Approach: RED phase - these tests should fail until implementation is complete
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// Mock Filesystem Implementation
// ============================================================================

/**
 * Mock storage for testing filesystem operations
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

  _clear(): void {
    this.data.clear()
  }

  _keys(): string[] {
    return Array.from(this.data.keys())
  }
}

const FS_STORAGE_PREFIX_FILE = 'fsx:file:'
const FS_STORAGE_PREFIX_META = 'fsx:meta:'
const FS_STORAGE_PREFIX_DIR = 'fsx:dir:'

interface FileMetadata {
  size: number
  isDirectory: boolean
  createdAt: string
  modifiedAt: string
}

/**
 * Create mock filesystem capability
 */
function createMockFs(storage: MockStorage) {
  const normalizePath = (path: string): string => {
    while (path.startsWith('//')) path = path.slice(1)
    if (!path.startsWith('/')) path = '/' + path
    if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1)
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

      const fileKeys = await storage.list<string>({ prefix: FS_STORAGE_PREFIX_FILE + prefix })
      for (const [key] of fileKeys) {
        const fullPath = key.slice(FS_STORAGE_PREFIX_FILE.length)
        const relativePath = fullPath.slice(prefix.length)
        const firstSlash = relativePath.indexOf('/')
        const name = firstSlash === -1 ? relativePath : relativePath.slice(0, firstSlash)
        if (name) entries.add(name)
      }

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

    async writeMany(files: Array<{ path: string; content: string }>): Promise<void> {
      for (const file of files) {
        await this.write(file.path, file.content)
      }
    },
  }
}

// Type for the mock fs
type MockFs = ReturnType<typeof createMockFs>

// ============================================================================
// CSVAnalyzer Import (will fail until implementation exists)
// ============================================================================

// Import the CSVAnalyzer class that we'll implement
import { CSVAnalyzer, type CSVAnalysisResult, type ColumnStats } from '../src/csv-analyzer'

// ============================================================================
// Test Suites
// ============================================================================

describe('CSVAnalyzer', () => {
  let storage: MockStorage
  let fs: MockFs

  beforeEach(() => {
    storage = new MockStorage()
    fs = createMockFs(storage)
  })

  describe('parse()', () => {
    it('parses CSV content into records', () => {
      const csv = `id,name,email
1,Alice,alice@example.com
2,Bob,bob@example.com`

      const analyzer = new CSVAnalyzer(csv)
      const records = analyzer.parse()

      expect(records).toHaveLength(2)
      expect(records[0]).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' })
      expect(records[1]).toEqual({ id: '2', name: 'Bob', email: 'bob@example.com' })
    })

    it('handles quoted values with commas', () => {
      const csv = `name,address,city
"Smith, John","123 Main St","New York"
"Doe, Jane","456 Oak Ave","Los Angeles"`

      const analyzer = new CSVAnalyzer(csv)
      const records = analyzer.parse()

      expect(records).toHaveLength(2)
      expect(records[0].name).toBe('Smith, John')
      expect(records[0].address).toBe('123 Main St')
    })

    it('handles empty values', () => {
      const csv = `id,name,email
1,,alice@example.com
2,Bob,`

      const analyzer = new CSVAnalyzer(csv)
      const records = analyzer.parse()

      expect(records[0].name).toBe('')
      expect(records[1].email).toBe('')
    })

    it('handles Windows line endings (CRLF)', () => {
      const csv = "id,name\r\n1,Alice\r\n2,Bob"

      const analyzer = new CSVAnalyzer(csv)
      const records = analyzer.parse()

      expect(records).toHaveLength(2)
      expect(records[0].name).toBe('Alice')
    })

    it('returns empty array for header-only CSV', () => {
      const csv = 'id,name,email'

      const analyzer = new CSVAnalyzer(csv)
      const records = analyzer.parse()

      expect(records).toHaveLength(0)
    })

    it('returns empty array for empty content', () => {
      const analyzer = new CSVAnalyzer('')
      const records = analyzer.parse()

      expect(records).toHaveLength(0)
    })

    it('trims whitespace from headers and values', () => {
      const csv = `  id  ,  name  ,  email
  1  ,  Alice  ,  alice@example.com  `

      const analyzer = new CSVAnalyzer(csv)
      const records = analyzer.parse()

      expect(records[0]).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' })
    })
  })

  describe('getHeaders()', () => {
    it('returns the column headers', () => {
      const csv = `id,name,email,department
1,Alice,alice@example.com,Engineering`

      const analyzer = new CSVAnalyzer(csv)
      const headers = analyzer.getHeaders()

      expect(headers).toEqual(['id', 'name', 'email', 'department'])
    })

    it('returns empty array for empty CSV', () => {
      const analyzer = new CSVAnalyzer('')
      const headers = analyzer.getHeaders()

      expect(headers).toEqual([])
    })
  })

  describe('getRowCount()', () => {
    it('returns the number of data rows', () => {
      const csv = `id,name
1,Alice
2,Bob
3,Charlie`

      const analyzer = new CSVAnalyzer(csv)
      expect(analyzer.getRowCount()).toBe(3)
    })

    it('returns 0 for header-only CSV', () => {
      const csv = 'id,name'
      const analyzer = new CSVAnalyzer(csv)
      expect(analyzer.getRowCount()).toBe(0)
    })
  })

  describe('analyze()', () => {
    it('returns comprehensive analysis of CSV data', () => {
      const csv = `id,name,email,age,salary
1,Alice,alice@example.com,30,75000
2,Bob,bob@example.com,25,65000
3,Charlie,charlie@example.com,35,85000`

      const analyzer = new CSVAnalyzer(csv)
      const analysis = analyzer.analyze()

      expect(analysis.rowCount).toBe(3)
      expect(analysis.columnCount).toBe(5)
      expect(analysis.headers).toEqual(['id', 'name', 'email', 'age', 'salary'])
      expect(analysis.columns).toHaveProperty('id')
      expect(analysis.columns).toHaveProperty('name')
      expect(analysis.columns).toHaveProperty('email')
    })

    it('detects numeric columns', () => {
      const csv = `id,name,age,salary
1,Alice,30,75000
2,Bob,25,65000`

      const analyzer = new CSVAnalyzer(csv)
      const analysis = analyzer.analyze()

      expect(analysis.columns.id.type).toBe('numeric')
      expect(analysis.columns.age.type).toBe('numeric')
      expect(analysis.columns.salary.type).toBe('numeric')
      expect(analysis.columns.name.type).toBe('string')
    })

    it('calculates numeric statistics', () => {
      const csv = `value
10
20
30
40
50`

      const analyzer = new CSVAnalyzer(csv)
      const analysis = analyzer.analyze()

      expect(analysis.columns.value.min).toBe(10)
      expect(analysis.columns.value.max).toBe(50)
      expect(analysis.columns.value.sum).toBe(150)
      expect(analysis.columns.value.avg).toBe(30)
    })

    it('calculates unique value counts', () => {
      const csv = `category
A
B
A
C
B
A`

      const analyzer = new CSVAnalyzer(csv)
      const analysis = analyzer.analyze()

      expect(analysis.columns.category.uniqueCount).toBe(3)
    })

    it('identifies email columns', () => {
      const csv = `contact,support
alice@example.com,help@company.com
bob@test.org,info@company.com`

      const analyzer = new CSVAnalyzer(csv)
      const analysis = analyzer.analyze()

      expect(analysis.columns.contact.hasEmails).toBe(true)
      expect(analysis.columns.support.hasEmails).toBe(true)
    })

    it('handles mixed type columns', () => {
      const csv = `mixed
123
hello
456
world`

      const analyzer = new CSVAnalyzer(csv)
      const analysis = analyzer.analyze()

      // Mixed columns should be classified as string
      expect(analysis.columns.mixed.type).toBe('mixed')
    })
  })

  describe('getColumnStats()', () => {
    it('returns stats for a specific column', () => {
      const csv = `name,age
Alice,30
Bob,25
Charlie,35`

      const analyzer = new CSVAnalyzer(csv)
      const stats = analyzer.getColumnStats('age')

      expect(stats.name).toBe('age')
      expect(stats.type).toBe('numeric')
      expect(stats.min).toBe(25)
      expect(stats.max).toBe(35)
      expect(stats.avg).toBe(30)
    })

    it('throws for non-existent column', () => {
      const csv = `id,name
1,Alice`

      const analyzer = new CSVAnalyzer(csv)
      expect(() => analyzer.getColumnStats('missing')).toThrow('Column not found: missing')
    })
  })

  describe('filter()', () => {
    it('filters records by predicate', () => {
      const csv = `id,name,age
1,Alice,30
2,Bob,25
3,Charlie,35
4,Diana,28`

      const analyzer = new CSVAnalyzer(csv)
      const filtered = analyzer.filter(record => parseInt(record.age) >= 30)

      expect(filtered).toHaveLength(2)
      expect(filtered.map(r => r.name)).toEqual(['Alice', 'Charlie'])
    })

    it('returns empty array when no records match', () => {
      const csv = `id,name,age
1,Alice,30
2,Bob,25`

      const analyzer = new CSVAnalyzer(csv)
      const filtered = analyzer.filter(record => parseInt(record.age) > 100)

      expect(filtered).toHaveLength(0)
    })
  })

  describe('groupBy()', () => {
    it('groups records by column value', () => {
      const csv = `id,name,department
1,Alice,Engineering
2,Bob,Marketing
3,Charlie,Engineering
4,Diana,Marketing
5,Eve,Engineering`

      const analyzer = new CSVAnalyzer(csv)
      const grouped = analyzer.groupBy('department')

      expect(Object.keys(grouped)).toEqual(['Engineering', 'Marketing'])
      expect(grouped['Engineering']).toHaveLength(3)
      expect(grouped['Marketing']).toHaveLength(2)
    })

    it('handles empty values in group column', () => {
      const csv = `id,category
1,A
2,
3,A
4,B`

      const analyzer = new CSVAnalyzer(csv)
      const grouped = analyzer.groupBy('category')

      expect(grouped['A']).toHaveLength(2)
      expect(grouped['B']).toHaveLength(1)
      expect(grouped['']).toHaveLength(1)
    })
  })

  describe('toJSON()', () => {
    it('converts parsed records to JSON string', () => {
      const csv = `id,name
1,Alice
2,Bob`

      const analyzer = new CSVAnalyzer(csv)
      const json = analyzer.toJSON()
      const parsed = JSON.parse(json)

      expect(parsed).toHaveLength(2)
      expect(parsed[0]).toEqual({ id: '1', name: 'Alice' })
    })

    it('supports pretty printing', () => {
      const csv = `id,name
1,Alice`

      const analyzer = new CSVAnalyzer(csv)
      const json = analyzer.toJSON({ pretty: true })

      expect(json).toContain('\n')
      expect(json).toContain('  ')
    })
  })

  describe('generateReport()', () => {
    it('generates markdown report', () => {
      const csv = `id,name,age,salary
1,Alice,30,75000
2,Bob,25,65000
3,Charlie,35,85000`

      const analyzer = new CSVAnalyzer(csv)
      const report = analyzer.generateReport()

      expect(report).toContain('# CSV Analysis Report')
      expect(report).toContain('## Summary')
      expect(report).toContain('**Rows**: 3')
      expect(report).toContain('**Columns**: 4')
      expect(report).toContain('## Column Details')
      expect(report).toContain('### id')
      expect(report).toContain('### name')
    })

    it('includes numeric statistics in report', () => {
      const csv = `value
10
20
30`

      const analyzer = new CSVAnalyzer(csv)
      const report = analyzer.generateReport()

      expect(report).toContain('**Min**:')
      expect(report).toContain('**Max**:')
      expect(report).toContain('**Average**:')
      expect(report).toContain('**Sum**:')
    })
  })
})

describe('CSVAnalyzer with Filesystem Integration', () => {
  let storage: MockStorage
  let fs: MockFs

  beforeEach(() => {
    storage = new MockStorage()
    fs = createMockFs(storage)
  })

  describe('fromFile()', () => {
    it('creates analyzer from file path', async () => {
      const csv = `id,name
1,Alice
2,Bob`
      await fs.write('/data/input.csv', csv)

      const analyzer = await CSVAnalyzer.fromFile('/data/input.csv', fs as any)
      const records = analyzer.parse()

      expect(records).toHaveLength(2)
    })

    it('throws for non-existent file', async () => {
      await expect(
        CSVAnalyzer.fromFile('/missing.csv', fs as any)
      ).rejects.toThrow('ENOENT')
    })
  })

  describe('saveResults()', () => {
    it('saves parsed records to JSON files', async () => {
      const csv = `id,name,email
1,Alice,alice@example.com
2,Bob,bob@example.com`

      await fs.mkdir('/output', { recursive: true })

      const analyzer = new CSVAnalyzer(csv)
      await analyzer.saveResults('/output', fs as any)

      expect(await fs.exists('/output/records.json')).toBe(true)
      const content = await fs.read('/output/records.json')
      const records = JSON.parse(content)
      expect(records).toHaveLength(2)
    })

    it('saves individual record files when specified', async () => {
      const csv = `id,name
1,Alice
2,Bob`

      await fs.mkdir('/output', { recursive: true })

      const analyzer = new CSVAnalyzer(csv)
      await analyzer.saveResults('/output', fs as any, { splitRecords: true, idColumn: 'id' })

      expect(await fs.exists('/output/1.json')).toBe(true)
      expect(await fs.exists('/output/2.json')).toBe(true)

      const record1 = JSON.parse(await fs.read('/output/1.json'))
      expect(record1.name).toBe('Alice')
    })

    it('saves analysis report when includeReport is true', async () => {
      const csv = `id,name,age
1,Alice,30
2,Bob,25`

      await fs.mkdir('/output', { recursive: true })

      const analyzer = new CSVAnalyzer(csv)
      await analyzer.saveResults('/output', fs as any, { includeReport: true })

      expect(await fs.exists('/output/report.md')).toBe(true)
      const report = await fs.read('/output/report.md')
      expect(report).toContain('# CSV Analysis Report')
    })
  })

  describe('processDirectory()', () => {
    it('processes all CSV files in a directory', async () => {
      await fs.mkdir('/input', { recursive: true })
      await fs.mkdir('/output', { recursive: true })

      await fs.write('/input/file1.csv', `id,name
1,Alice`)
      await fs.write('/input/file2.csv', `id,name
2,Bob`)

      const results = await CSVAnalyzer.processDirectory('/input', '/output', fs as any)

      expect(results.processed).toBe(2)
      expect(await fs.exists('/output/file1/records.json')).toBe(true)
      expect(await fs.exists('/output/file2/records.json')).toBe(true)
    })

    it('skips non-CSV files', async () => {
      await fs.mkdir('/input', { recursive: true })
      await fs.mkdir('/output', { recursive: true })

      await fs.write('/input/data.csv', `id,name
1,Alice`)
      await fs.write('/input/readme.txt', 'Not a CSV file')
      await fs.write('/input/config.json', '{}')

      const results = await CSVAnalyzer.processDirectory('/input', '/output', fs as any)

      expect(results.processed).toBe(1)
      expect(results.skipped).toBe(2)
    })
  })
})

describe('CSVAnalyzer Advanced Features', () => {
  describe('transform()', () => {
    it('transforms records using a mapper function', () => {
      const csv = `firstName,lastName,age
Alice,Smith,30
Bob,Johnson,25`

      const analyzer = new CSVAnalyzer(csv)
      const transformed = analyzer.transform(record => ({
        fullName: `${record.firstName} ${record.lastName}`,
        ageInMonths: parseInt(record.age) * 12,
      }))

      expect(transformed).toHaveLength(2)
      expect(transformed[0].fullName).toBe('Alice Smith')
      expect(transformed[0].ageInMonths).toBe(360)
    })
  })

  describe('sort()', () => {
    it('sorts records by column ascending', () => {
      const csv = `id,name,age
3,Charlie,35
1,Alice,30
2,Bob,25`

      const analyzer = new CSVAnalyzer(csv)
      const sorted = analyzer.sort('age')

      expect(sorted.map(r => r.name)).toEqual(['Bob', 'Alice', 'Charlie'])
    })

    it('sorts records by column descending', () => {
      const csv = `id,name,age
1,Alice,30
2,Bob,25
3,Charlie,35`

      const analyzer = new CSVAnalyzer(csv)
      const sorted = analyzer.sort('age', 'desc')

      expect(sorted.map(r => r.name)).toEqual(['Charlie', 'Alice', 'Bob'])
    })

    it('sorts string columns alphabetically', () => {
      const csv = `id,name
1,Charlie
2,Alice
3,Bob`

      const analyzer = new CSVAnalyzer(csv)
      const sorted = analyzer.sort('name')

      expect(sorted.map(r => r.name)).toEqual(['Alice', 'Bob', 'Charlie'])
    })
  })

  describe('aggregate()', () => {
    it('calculates aggregates across columns', () => {
      const csv = `department,salary
Engineering,100000
Engineering,120000
Marketing,80000
Marketing,90000`

      const analyzer = new CSVAnalyzer(csv)
      const aggregates = analyzer.aggregate('department', 'salary', ['sum', 'avg', 'count'])

      expect(aggregates['Engineering'].sum).toBe(220000)
      expect(aggregates['Engineering'].avg).toBe(110000)
      expect(aggregates['Engineering'].count).toBe(2)
      expect(aggregates['Marketing'].sum).toBe(170000)
    })
  })

  describe('validate()', () => {
    it('validates records against a schema', () => {
      const csv = `id,name,email,age
1,Alice,alice@example.com,30
2,,invalid-email,25
3,Charlie,charlie@example.com,-5`

      const analyzer = new CSVAnalyzer(csv)
      const validation = analyzer.validate({
        name: { required: true },
        email: { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
        age: { min: 0, max: 150 },
      })

      expect(validation.valid).toBe(false)
      expect(validation.errors).toHaveLength(3) // empty name, invalid email, negative age
      expect(validation.errors[0].row).toBe(2)
      expect(validation.errors[0].column).toBe('name')
    })

    it('returns valid when all records pass', () => {
      const csv = `id,name,email
1,Alice,alice@example.com
2,Bob,bob@example.com`

      const analyzer = new CSVAnalyzer(csv)
      const validation = analyzer.validate({
        name: { required: true },
        email: { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      })

      expect(validation.valid).toBe(true)
      expect(validation.errors).toHaveLength(0)
    })
  })

  describe('deduplicate()', () => {
    it('removes duplicate records based on key column', () => {
      const csv = `id,name,email
1,Alice,alice@example.com
2,Bob,bob@example.com
1,Alice Updated,alice.new@example.com
3,Charlie,charlie@example.com`

      const analyzer = new CSVAnalyzer(csv)
      const deduped = analyzer.deduplicate('id')

      expect(deduped).toHaveLength(3)
      expect(deduped.map(r => r.id)).toEqual(['1', '2', '3'])
    })

    it('keeps first occurrence by default', () => {
      const csv = `id,name
1,First
1,Second
1,Third`

      const analyzer = new CSVAnalyzer(csv)
      const deduped = analyzer.deduplicate('id')

      expect(deduped).toHaveLength(1)
      expect(deduped[0].name).toBe('First')
    })

    it('keeps last occurrence when specified', () => {
      const csv = `id,name
1,First
1,Second
1,Third`

      const analyzer = new CSVAnalyzer(csv)
      const deduped = analyzer.deduplicate('id', 'last')

      expect(deduped).toHaveLength(1)
      expect(deduped[0].name).toBe('Third')
    })
  })
})
