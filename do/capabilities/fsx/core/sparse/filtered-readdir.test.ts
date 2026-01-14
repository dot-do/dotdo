/**
 * Tests for filtered readdir returning only matched entries
 *
 * RED phase - Tests for filtered readdir functionality on SparseFS.
 * These tests verify that readdir can filter results based on:
 * - Glob patterns (e.g., *.ts, *.{js,jsx})
 * - Entry type (files only, directories only)
 * - Combined pattern and type filters
 * - Hidden file exclusion
 *
 * Expected API:
 * ```typescript
 * const sparse = new SparseFS(fs, { patterns: ['**'] })
 *
 * // Filter by glob pattern
 * const tsFiles = await sparse.readdir('/src', { filter: '*.ts' })
 *
 * // Filter by type
 * const filesOnly = await sparse.readdir('/src', { type: 'file' })
 * const dirsOnly = await sparse.readdir('/src', { type: 'directory' })
 *
 * // Combined filters
 * const tsFilesOnly = await sparse.readdir('/src', { filter: '*.ts', type: 'file' })
 *
 * // Exclude hidden files
 * const noHidden = await sparse.readdir('/src', { includeHidden: false })
 * ```
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SparseFS, type SparseFSOptions } from './sparse-fs'
import { FSx } from '../fsx'
import { MemoryBackend } from '../backend'

describe('filtered readdir', () => {
  let backend: MemoryBackend
  let fs: FSx

  beforeEach(async () => {
    backend = new MemoryBackend()
    fs = new FSx(backend)

    // Create test directory structure:
    // /project/
    //   src/
    //     index.ts
    //     utils.ts
    //     App.tsx
    //     components/
    //       Button.tsx
    //       Input.tsx
    //     styles/
    //       main.css
    //       theme.scss
    //     .hidden-file.ts
    //     .config/
    //       settings.json
    //   lib/
    //     index.js
    //     helpers.js
    //   assets/
    //     logo.png
    //     icon.svg
    //   .gitignore
    //   .env
    //   package.json
    //   README.md

    await fs.mkdir('/project/src/components', { recursive: true })
    await fs.mkdir('/project/src/styles', { recursive: true })
    await fs.mkdir('/project/src/.config', { recursive: true })
    await fs.mkdir('/project/lib', { recursive: true })
    await fs.mkdir('/project/assets', { recursive: true })

    // src/ files
    await fs.writeFile('/project/src/index.ts', 'export {}')
    await fs.writeFile('/project/src/utils.ts', 'export {}')
    await fs.writeFile('/project/src/App.tsx', 'export {}')
    await fs.writeFile('/project/src/.hidden-file.ts', 'hidden')
    await fs.writeFile('/project/src/.config/settings.json', '{}')

    // src/components/ files
    await fs.writeFile('/project/src/components/Button.tsx', 'export {}')
    await fs.writeFile('/project/src/components/Input.tsx', 'export {}')

    // src/styles/ files
    await fs.writeFile('/project/src/styles/main.css', 'body {}')
    await fs.writeFile('/project/src/styles/theme.scss', '$primary: blue;')

    // lib/ files
    await fs.writeFile('/project/lib/index.js', 'module.exports = {}')
    await fs.writeFile('/project/lib/helpers.js', 'module.exports = {}')

    // assets/ files
    await fs.writeFile('/project/assets/logo.png', 'PNG')
    await fs.writeFile('/project/assets/icon.svg', '<svg></svg>')

    // root files
    await fs.writeFile('/project/.gitignore', 'node_modules')
    await fs.writeFile('/project/.env', 'SECRET=value')
    await fs.writeFile('/project/package.json', '{}')
    await fs.writeFile('/project/README.md', '# Project')
  })

  // ========================================
  // 1. Glob pattern filtering (7 tests)
  // ========================================
  describe('readdir with glob pattern filter', () => {
    it('should filter by simple extension pattern (*.ts)', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { filter: '*.ts' })

      expect(entries).toContain('index.ts')
      expect(entries).toContain('utils.ts')
      expect(entries).not.toContain('App.tsx')
      expect(entries).not.toContain('components')
    })

    it('should filter by multiple extension pattern (*.{ts,tsx})', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { filter: '*.{ts,tsx}' })

      expect(entries).toContain('index.ts')
      expect(entries).toContain('utils.ts')
      expect(entries).toContain('App.tsx')
      expect(entries).not.toContain('components')
      expect(entries).not.toContain('styles')
    })

    it('should filter by prefix pattern (Button*)', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src/components', { filter: 'Button*' })

      expect(entries).toContain('Button.tsx')
      expect(entries).not.toContain('Input.tsx')
    })

    it('should filter by wildcard in middle (*.test.*)', async () => {
      // Add test files for this test
      await fs.writeFile('/project/src/index.test.ts', 'test')
      await fs.writeFile('/project/src/utils.test.ts', 'test')

      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { filter: '*.test.*' })

      expect(entries).toContain('index.test.ts')
      expect(entries).toContain('utils.test.ts')
      expect(entries).not.toContain('index.ts')
      expect(entries).not.toContain('utils.ts')
    })

    it('should return empty array when no entries match filter', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { filter: '*.py' })

      expect(entries).toEqual([])
    })

    it('should work with filter and withFileTypes option', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', {
        filter: '*.ts',
        withFileTypes: true
      })

      const names = entries.map(e => (e as { name: string }).name)
      expect(names).toContain('index.ts')
      expect(names).toContain('utils.ts')
      expect(names).not.toContain('App.tsx')
    })

    it('should filter directories by pattern when they match', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { filter: 'comp*' })

      expect(entries).toContain('components')
      expect(entries).not.toContain('styles')
      expect(entries).not.toContain('index.ts')
    })
  })

  // ========================================
  // 2. Type filtering (6 tests)
  // ========================================
  describe('readdir with type filter (files only, dirs only)', () => {
    it('should return only files when type is "file"', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { type: 'file' })

      expect(entries).toContain('index.ts')
      expect(entries).toContain('utils.ts')
      expect(entries).toContain('App.tsx')
      expect(entries).not.toContain('components')
      expect(entries).not.toContain('styles')
    })

    it('should return only directories when type is "directory"', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { type: 'directory' })

      expect(entries).toContain('components')
      expect(entries).toContain('styles')
      expect(entries).not.toContain('index.ts')
      expect(entries).not.toContain('utils.ts')
    })

    it('should return empty array when no files exist in directory (type: file)', async () => {
      await fs.mkdir('/project/empty-with-dirs/subdir', { recursive: true })

      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/empty-with-dirs', { type: 'file' })

      expect(entries).toEqual([])
    })

    it('should return empty array when no directories exist (type: directory)', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/lib', { type: 'directory' })

      expect(entries).toEqual([])
    })

    it('should work with type filter and withFileTypes option', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', {
        type: 'directory',
        withFileTypes: true
      })

      expect(entries.length).toBeGreaterThan(0)
      expect(entries.every(e => (e as { isDirectory: () => boolean }).isDirectory())).toBe(true)
    })

    it('should handle symlink type filter', async () => {
      // Create a symlink for this test (if backend supports it)
      // For now, just test that the type option accepts 'symlink'
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { type: 'symlink' })

      // Should return empty since we have no symlinks
      expect(entries).toEqual([])
    })
  })

  // ========================================
  // 3. Combined pattern and type filters (5 tests)
  // ========================================
  describe('combined pattern and type filters', () => {
    it('should filter by both pattern and type (*.ts files only)', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', {
        filter: '*.ts',
        type: 'file'
      })

      expect(entries).toContain('index.ts')
      expect(entries).toContain('utils.ts')
      expect(entries).not.toContain('App.tsx')
      expect(entries).not.toContain('components')
    })

    it('should return directories matching pattern when type is directory', async () => {
      await fs.mkdir('/project/src/components-v2', { recursive: true })
      await fs.mkdir('/project/src/components-old', { recursive: true })

      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', {
        filter: 'components*',
        type: 'directory'
      })

      expect(entries).toContain('components')
      expect(entries).toContain('components-v2')
      expect(entries).toContain('components-old')
      expect(entries).not.toContain('styles')
    })

    it('should return empty when pattern matches files but type is directory', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', {
        filter: '*.ts',
        type: 'directory'
      })

      expect(entries).toEqual([])
    })

    it('should return empty when pattern matches directories but type is file', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', {
        filter: 'comp*',
        type: 'file'
      })

      expect(entries).toEqual([])
    })

    it('should work with combined filters and withFileTypes', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', {
        filter: '*.{ts,tsx}',
        type: 'file',
        withFileTypes: true
      })

      expect(entries.length).toBeGreaterThan(0)
      expect(entries.every(e => (e as { isFile: () => boolean }).isFile())).toBe(true)

      const names = entries.map(e => (e as { name: string }).name)
      expect(names.every(n => n.endsWith('.ts') || n.endsWith('.tsx'))).toBe(true)
    })
  })

  // ========================================
  // 4. Hidden file filtering (6 tests)
  // ========================================
  describe('hidden file filtering', () => {
    it('should include hidden files by default', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src')

      expect(entries).toContain('.hidden-file.ts')
      expect(entries).toContain('.config')
    })

    it('should exclude hidden files when includeHidden is false', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { includeHidden: false })

      expect(entries).not.toContain('.hidden-file.ts')
      expect(entries).not.toContain('.config')
      expect(entries).toContain('index.ts')
      expect(entries).toContain('components')
    })

    it('should include hidden files when includeHidden is true', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { includeHidden: true })

      expect(entries).toContain('.hidden-file.ts')
      expect(entries).toContain('.config')
    })

    it('should exclude hidden files at root level', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project', { includeHidden: false })

      expect(entries).not.toContain('.gitignore')
      expect(entries).not.toContain('.env')
      expect(entries).toContain('package.json')
      expect(entries).toContain('README.md')
    })

    it('should work with hidden filter and type filter combined', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', {
        includeHidden: false,
        type: 'directory'
      })

      expect(entries).toContain('components')
      expect(entries).toContain('styles')
      expect(entries).not.toContain('.config')
    })

    it('should work with hidden filter and pattern filter combined', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', {
        includeHidden: false,
        filter: '*.ts'
      })

      expect(entries).toContain('index.ts')
      expect(entries).toContain('utils.ts')
      expect(entries).not.toContain('.hidden-file.ts')
    })
  })

  // ========================================
  // 5. Edge cases (6 tests)
  // ========================================
  describe('edge cases', () => {
    it('should handle filter with no wildcard (exact match)', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { filter: 'index.ts' })

      expect(entries).toContain('index.ts')
      expect(entries).toHaveLength(1)
    })

    it('should handle filter with only wildcard (*)', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { filter: '*' })

      // Should match all entries
      expect(entries).toContain('index.ts')
      expect(entries).toContain('components')
    })

    it('should handle empty directory with filters', async () => {
      await fs.mkdir('/project/empty', { recursive: true })

      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/empty', { filter: '*.ts' })

      expect(entries).toEqual([])
    })

    it('should handle filter with case sensitivity', async () => {
      await fs.writeFile('/project/src/Index.TS', 'export {}')

      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', { filter: '*.ts' })

      // Assuming case-sensitive matching (lowercase .ts only)
      expect(entries).toContain('index.ts')
      expect(entries).not.toContain('Index.TS')
    })

    it('should combine all filter options together', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const entries = await sparse.readdir('/project/src', {
        filter: '*.ts',
        type: 'file',
        includeHidden: false,
        withFileTypes: true
      })

      expect(entries.length).toBe(2) // index.ts, utils.ts (not .hidden-file.ts)
      const names = entries.map(e => (e as { name: string }).name)
      expect(names).toContain('index.ts')
      expect(names).toContain('utils.ts')
      expect(names).not.toContain('.hidden-file.ts')
    })

    it('should preserve sparse patterns while applying filters', async () => {
      // SparseFS should first apply its own patterns, then apply readdir filters
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project'
      })

      // lib/ is excluded by sparse patterns
      const projectEntries = await sparse.readdir('/project', { type: 'directory' })

      expect(projectEntries).toContain('src')
      expect(projectEntries).not.toContain('lib')
      expect(projectEntries).not.toContain('assets')
    })
  })

  // ========================================
  // 6. Performance and integration (4 tests)
  // ========================================
  describe('performance and integration', () => {
    it('should filter entries without additional stat calls for type filter', async () => {
      // This test verifies the optimization where withFileTypes is used internally
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      // Should efficiently filter by type using Dirent information
      const files = await sparse.readdir('/project/src', { type: 'file' })
      const dirs = await sparse.readdir('/project/src', { type: 'directory' })

      expect(files.length + dirs.length).toBeGreaterThan(0)
      expect(files.some(f => dirs.includes(f))).toBe(false)
    })

    it('should apply pattern filter before type filter for efficiency', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      // Pattern filter should narrow down results before type check
      const entries = await sparse.readdir('/project/src', {
        filter: 'index*',
        type: 'file'
      })

      expect(entries).toContain('index.ts')
      expect(entries.length).toBe(1)
    })

    it('should work with walk method and filters', async () => {
      const sparse = new SparseFS(fs, { patterns: ['**'] })

      // The walk method should respect the same filter options
      const entries: Array<{ path: string }> = []
      for await (const entry of sparse.walk('/project/src', {
        maxDepth: 1,
        includeDotFiles: false
      })) {
        entries.push(entry)
      }

      const paths = entries.map(e => e.path)
      expect(paths.some(p => p.includes('.hidden'))).toBe(false)
      expect(paths.some(p => p.includes('.config'))).toBe(false)
    })

    it('should handle large directories with filters efficiently', async () => {
      // Create many files for performance test
      for (let i = 0; i < 100; i++) {
        await fs.writeFile(`/project/src/file${i}.ts`, `// file ${i}`)
        await fs.writeFile(`/project/src/file${i}.js`, `// file ${i}`)
      }

      const sparse = new SparseFS(fs, { patterns: ['**'] })

      const start = Date.now()
      const entries = await sparse.readdir('/project/src', { filter: '*.ts' })
      const elapsed = Date.now() - start

      // Should complete quickly (under 100ms for 200 files)
      expect(elapsed).toBeLessThan(100)
      expect(entries.length).toBeGreaterThan(100)
    })
  })
})
