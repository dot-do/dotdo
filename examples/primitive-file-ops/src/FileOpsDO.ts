/**
 * FileOpsDO - Demonstrates fsx (filesystem on SQLite)
 *
 * This Durable Object shows how to use the $.fs capability for
 * real file operations without servers, containers, or VMs.
 *
 * Key capabilities demonstrated:
 * - $.fs.write() - Write files (string or binary)
 * - $.fs.read() - Read files with encoding options
 * - $.fs.list() - List directory contents
 * - $.fs.mkdir() - Create directories
 * - $.fs.stat() - Get file metadata
 * - $.fs.createReadStream() - Stream large files
 * - CSV/JSON processing workflows
 */

import { DO } from 'dotdo'
import { withFs } from 'fsx.do'

// Apply the fs capability mixin to get $.fs
const DOWithFs = withFs(DO)

/**
 * Parse CSV content into records
 * Simple implementation for demonstration - production code would use a library
 */
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n')
  if (lines.length === 0) return []

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const records: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const record: Record<string, string> = {}
    headers.forEach((header, j) => {
      record[header] = values[j] ?? ''
    })
    records.push(record)
  }

  return records
}

/**
 * Generate a markdown report from processed results
 */
function generateReport(
  results: ProcessResult[],
  startTime: number
): string {
  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length
  const duration = Date.now() - startTime

  return `# Data Import Report

## Summary
- **Total Records**: ${results.length}
- **Successful**: ${successCount}
- **Failed**: ${failCount}
- **Processing Time**: ${duration}ms

## Results

${results.slice(0, 10).map((r, i) => `
### Record ${i + 1}
- **Status**: ${r.success ? 'Success' : 'Failed'}
- **ID**: ${r.id}
${r.error ? `- **Error**: ${r.error}` : ''}
`).join('\n')}

${results.length > 10 ? `\n*...and ${results.length - 10} more records*\n` : ''}

---
Generated at ${new Date().toISOString()}
`
}

interface ProcessResult {
  id: string
  success: boolean
  error?: string
}

export class FileOpsDO extends DOWithFs {
  static readonly $type = 'FileOpsDO'

  /**
   * Process a CSV data import
   *
   * Demonstrates the full file processing workflow:
   * 1. Download from URL and save to filesystem
   * 2. Read and parse CSV content
   * 3. Process each record and write individual result files
   * 4. Generate a summary report
   */
  async processDataImport(csvUrl: string) {
    const startTime = Date.now()

    // Step 1: Create directory structure
    await this.$.fs.mkdir('/imports', { recursive: true })
    await this.$.fs.mkdir('/results', { recursive: true })
    await this.$.fs.mkdir('/reports', { recursive: true })

    // Step 2: Download and save the CSV
    const response = await fetch(csvUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch CSV: ${response.status}`)
    }
    const csvContent = await response.text()
    await this.$.fs.write('/imports/data.csv', csvContent)

    // Step 3: Read and parse the CSV
    const csv = await this.$.fs.read('/imports/data.csv', { encoding: 'utf-8' }) as string
    const records = parseCSV(csv)

    // Step 4: Process each record and save results
    const results: ProcessResult[] = await Promise.all(
      records.map(async (record, i) => {
        try {
          const result = await this.processRecord(record, i)
          await this.$.fs.write(
            `/results/${i}.json`,
            JSON.stringify(result, null, 2)
          )
          return { id: String(i), success: true }
        } catch (error) {
          return {
            id: String(i),
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      })
    )

    // Step 5: Generate and save report
    const report = generateReport(results, startTime)
    const reportPath = `/reports/import-${Date.now()}.md`
    await this.$.fs.write(reportPath, report)

    // Step 6: Save processing metadata
    await this.$.fs.write('/imports/metadata.json', JSON.stringify({
      sourceUrl: csvUrl,
      recordCount: records.length,
      processedAt: new Date().toISOString(),
      reportPath,
    }, null, 2))

    return {
      processed: records.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      report: reportPath,
    }
  }

  /**
   * Process a single record
   * Override this in subclasses for custom processing logic
   */
  async processRecord(
    record: Record<string, string>,
    index: number
  ): Promise<Record<string, unknown>> {
    // Simulate some processing
    return {
      originalIndex: index,
      processed: true,
      timestamp: new Date().toISOString(),
      data: record,
      // Add computed fields
      fieldCount: Object.keys(record).length,
      hasEmail: Object.values(record).some(v => v.includes('@')),
    }
  }

  /**
   * List all files in a directory with metadata
   */
  async listFiles(path: string = '/') {
    const exists = await this.$.fs.exists(path)
    if (!exists) {
      return { path, exists: false, files: [] }
    }

    const entries = await this.$.fs.list(path)
    const files = await Promise.all(
      entries.map(async (name) => {
        const fullPath = path === '/' ? `/${name}` : `${path}/${name}`
        try {
          const stats = await this.$.fs.stat(fullPath)
          return {
            name,
            path: fullPath,
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            modified: stats.mtime.toISOString(),
          }
        } catch {
          return { name, path: fullPath, type: 'unknown', size: 0 }
        }
      })
    )

    return { path, exists: true, files }
  }

  /**
   * Get filesystem statistics
   */
  async getStats() {
    const countFiles = async (dir: string): Promise<{ files: number; dirs: number; totalSize: number }> => {
      let files = 0
      let dirs = 0
      let totalSize = 0

      try {
        const entries = await this.$.fs.list(dir)
        for (const name of entries) {
          const fullPath = dir === '/' ? `/${name}` : `${dir}/${name}`
          try {
            const stats = await this.$.fs.stat(fullPath)
            if (stats.isDirectory()) {
              dirs++
              const subStats = await countFiles(fullPath)
              files += subStats.files
              dirs += subStats.dirs
              totalSize += subStats.totalSize
            } else {
              files++
              totalSize += stats.size
            }
          } catch {
            // Skip inaccessible files
          }
        }
      } catch {
        // Directory doesn't exist
      }

      return { files, dirs, totalSize }
    }

    const stats = await countFiles('/')

    return {
      totalFiles: stats.files,
      totalDirectories: stats.dirs,
      totalSize: stats.totalSize,
      totalSizeFormatted: formatBytes(stats.totalSize),
    }
  }

  /**
   * Read a specific file
   */
  async readFile(path: string) {
    const exists = await this.$.fs.exists(path)
    if (!exists) {
      throw new Error(`File not found: ${path}`)
    }

    const stats = await this.$.fs.stat(path)
    if (stats.isDirectory()) {
      throw new Error(`Path is a directory: ${path}`)
    }

    const content = await this.$.fs.read(path, { encoding: 'utf-8' })
    return {
      path,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      content,
    }
  }

  /**
   * Write a file
   */
  async writeFile(path: string, content: string) {
    // Ensure parent directory exists
    const parentDir = path.substring(0, path.lastIndexOf('/')) || '/'
    await this.$.fs.mkdir(parentDir, { recursive: true })

    await this.$.fs.write(path, content)

    const stats = await this.$.fs.stat(path)
    return {
      path,
      size: stats.size,
      created: stats.birthtime.toISOString(),
    }
  }

  /**
   * Delete a file or directory
   */
  async deleteFile(path: string) {
    const exists = await this.$.fs.exists(path)
    if (!exists) {
      return { path, deleted: false, reason: 'not found' }
    }

    const stats = await this.$.fs.stat(path)
    if (stats.isDirectory()) {
      await this.$.fs.rmdir(path, { recursive: true })
    } else {
      await this.$.fs.rm(path)
    }

    return { path, deleted: true }
  }

  /**
   * Stream a large file
   *
   * Returns a ReadableStream for efficient large file handling
   */
  async streamFile(path: string): Promise<ReadableStream<Uint8Array>> {
    const exists = await this.$.fs.exists(path)
    if (!exists) {
      throw new Error(`File not found: ${path}`)
    }

    return this.$.fs.createReadStream(path)
  }

  /**
   * Batch write multiple files atomically
   */
  async batchWrite(files: Array<{ path: string; content: string }>) {
    // Ensure all parent directories exist
    const dirs = new Set(
      files.map(f => f.path.substring(0, f.path.lastIndexOf('/')) || '/')
    )
    for (const dir of dirs) {
      await this.$.fs.mkdir(dir, { recursive: true })
    }

    // Write all files
    await this.$.fs.writeMany(
      files.map(f => ({ path: f.path, content: f.content }))
    )

    return {
      written: files.length,
      paths: files.map(f => f.path),
    }
  }

  /**
   * Copy a file
   */
  async copyFile(source: string, destination: string) {
    const exists = await this.$.fs.exists(source)
    if (!exists) {
      throw new Error(`Source file not found: ${source}`)
    }

    // Ensure destination directory exists
    const destDir = destination.substring(0, destination.lastIndexOf('/')) || '/'
    await this.$.fs.mkdir(destDir, { recursive: true })

    await this.$.fs.copyFile(source, destination)

    const stats = await this.$.fs.stat(destination)
    return {
      source,
      destination,
      size: stats.size,
    }
  }

  /**
   * Move/rename a file
   */
  async moveFile(source: string, destination: string) {
    const exists = await this.$.fs.exists(source)
    if (!exists) {
      throw new Error(`Source file not found: ${source}`)
    }

    // Ensure destination directory exists
    const destDir = destination.substring(0, destination.lastIndexOf('/')) || '/'
    await this.$.fs.mkdir(destDir, { recursive: true })

    await this.$.fs.rename(source, destination)

    return {
      source,
      destination,
      moved: true,
    }
  }

  /**
   * Get storage tier information for a file
   */
  async getFileTier(path: string) {
    const exists = await this.$.fs.exists(path)
    if (!exists) {
      throw new Error(`File not found: ${path}`)
    }

    const tier = await this.$.fs.getTier(path)
    const stats = await this.$.fs.stat(path)

    return {
      path,
      tier,
      size: stats.size,
      sizeFormatted: formatBytes(stats.size),
    }
  }

  /**
   * List all reports
   */
  async listReports() {
    const exists = await this.$.fs.exists('/reports')
    if (!exists) {
      return { reports: [] }
    }

    const entries = await this.$.fs.list('/reports')
    const reports = entries
      .filter(name => name.endsWith('.md'))
      .map(name => `/reports/${name}`)

    return { reports }
  }

  /**
   * Clean up old files
   */
  async cleanup(olderThanDays: number = 7) {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    const deleted: string[] = []

    const cleanDir = async (dir: string) => {
      try {
        const entries = await this.$.fs.list(dir)
        for (const name of entries) {
          const fullPath = dir === '/' ? `/${name}` : `${dir}/${name}`
          try {
            const stats = await this.$.fs.stat(fullPath)
            if (stats.isDirectory()) {
              await cleanDir(fullPath)
            } else if (stats.mtime.getTime() < cutoff) {
              await this.$.fs.rm(fullPath)
              deleted.push(fullPath)
            }
          } catch {
            // Skip inaccessible files
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    await cleanDir('/results')
    await cleanDir('/imports')

    return {
      deleted: deleted.length,
      paths: deleted,
    }
  }
}

/**
 * Format bytes into human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
