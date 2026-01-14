/**
 * Tests for SparseFS class - wrapping FSx with sparse checkout semantics
 *
 * SparseFS filters file operations based on include/exclude patterns,
 * implementing sparse-checkout like behavior for efficient partial
 * tree operations.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SparseFS, type SparseFSOptions, type WalkEntry } from './sparse-fs'
import { FSx } from '../fsx'
import { MemoryBackend } from '../backend'

describe('SparseFS', () => {
  let backend: MemoryBackend
  let fs: FSx

  beforeEach(async () => {
    backend = new MemoryBackend()
    fs = new FSx(backend)

    // Create test directory structure:
    // /project/
    //   package.json
    //   tsconfig.json
    //   src/
    //     index.ts
    //     utils/
    //       helper.ts
    //       test.ts
    //     components/
    //       Button.tsx
    //   lib/
    //     index.js
    //   node_modules/
    //     lodash/
    //       index.js
    //   dist/
    //     bundle.js
    //   test/
    //     index.test.ts

    await fs.mkdir('/project', { recursive: true })
    await fs.writeFile('/project/package.json', '{}')
    await fs.writeFile('/project/tsconfig.json', '{}')

    await fs.mkdir('/project/src/utils', { recursive: true })
    await fs.mkdir('/project/src/components', { recursive: true })
    await fs.writeFile('/project/src/index.ts', 'export {}')
    await fs.writeFile('/project/src/utils/helper.ts', 'export {}')
    await fs.writeFile('/project/src/utils/test.ts', 'export {}')
    await fs.writeFile('/project/src/components/Button.tsx', 'export {}')

    await fs.mkdir('/project/lib', { recursive: true })
    await fs.writeFile('/project/lib/index.js', 'module.exports = {}')

    await fs.mkdir('/project/node_modules/lodash', { recursive: true })
    await fs.writeFile('/project/node_modules/lodash/index.js', 'module.exports = {}')

    await fs.mkdir('/project/dist', { recursive: true })
    await fs.writeFile('/project/dist/bundle.js', 'bundle')

    await fs.mkdir('/project/test', { recursive: true })
    await fs.writeFile('/project/test/index.test.ts', 'test')
  })

  // ========================================
  // 1. Constructor and configuration
  // ========================================
  describe('constructor', () => {
    it('should create SparseFS with include patterns', () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      expect(sparse).toBeInstanceOf(SparseFS)
    })

    it('should create SparseFS with include and exclude patterns', () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**', 'package.json'],
        excludePatterns: ['**/node_modules/**'],
      })

      expect(sparse).toBeInstanceOf(SparseFS)
    })

    it('should throw if patterns array is empty', () => {
      expect(() => {
        new SparseFS(fs, {
          patterns: [],
        })
      }).toThrow()
    })

    it('should expose underlying fs instance', () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      expect(sparse.fs).toBe(fs)
    })
  })

  // ========================================
  // 2. shouldInclude method
  // ========================================
  describe('shouldInclude', () => {
    it('should include file matching pattern', () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      expect(sparse.shouldInclude('src/index.ts')).toBe(true)
      expect(sparse.shouldInclude('src/utils/helper.ts')).toBe(true)
    })

    it('should exclude file not matching pattern', () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      expect(sparse.shouldInclude('lib/index.js')).toBe(false)
      expect(sparse.shouldInclude('package.json')).toBe(false)
    })

    it('should exclude file matching exclude pattern', () => {
      const sparse = new SparseFS(fs, {
        patterns: ['**'],
        excludePatterns: ['**/node_modules/**'],
      })

      expect(sparse.shouldInclude('node_modules/lodash/index.js')).toBe(false)
    })

    it('should include multiple patterns', () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**', 'package.json', 'tsconfig.json'],
      })

      expect(sparse.shouldInclude('src/index.ts')).toBe(true)
      expect(sparse.shouldInclude('package.json')).toBe(true)
      expect(sparse.shouldInclude('tsconfig.json')).toBe(true)
    })
  })

  // ========================================
  // 3. shouldTraverseDirectory method
  // ========================================
  describe('shouldTraverseDirectory', () => {
    it('should traverse directory that could contain matches', () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      expect(sparse.shouldTraverseDirectory('src')).toBe(true)
      expect(sparse.shouldTraverseDirectory('src/utils')).toBe(true)
    })

    it('should not traverse directory that cannot contain matches', () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      expect(sparse.shouldTraverseDirectory('lib')).toBe(false)
      expect(sparse.shouldTraverseDirectory('test')).toBe(false)
    })

    it('should not traverse excluded directories', () => {
      const sparse = new SparseFS(fs, {
        patterns: ['**'],
        excludePatterns: ['**/node_modules/**'],
      })

      expect(sparse.shouldTraverseDirectory('node_modules')).toBe(false)
      expect(sparse.shouldTraverseDirectory('node_modules/lodash')).toBe(false)
    })
  })

  // ========================================
  // 4. readdir method
  // ========================================
  describe('readdir', () => {
    it('should filter readdir results by patterns', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**', 'package.json'],
        root: '/project',
      })

      const entries = await sparse.readdir('/project')

      expect(entries).toContain('src')
      expect(entries).toContain('package.json')
      expect(entries).not.toContain('lib')
      expect(entries).not.toContain('node_modules')
      expect(entries).not.toContain('dist')
    })

    it('should filter readdir results with withFileTypes', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      const entries = await sparse.readdir('/project', { withFileTypes: true })
      const names = (entries as { name: string }[]).map((e) => e.name)

      expect(names).toContain('src')
      expect(names).not.toContain('lib')
    })

    it('should filter nested directory contents', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**/*.ts'],
        excludePatterns: ['**/*test*'],
        root: '/project',
      })

      const entries = await sparse.readdir('/project/src/utils')

      expect(entries).toContain('helper.ts')
      expect(entries).not.toContain('test.ts')
    })
  })

  // ========================================
  // 5. readFile method
  // ========================================
  describe('readFile', () => {
    it('should read file matching include pattern', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      const content = await sparse.readFile('/project/src/index.ts')
      expect(content).toBe('export {}')
    })

    it('should throw when reading file not matching pattern', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      await expect(sparse.readFile('/project/lib/index.js')).rejects.toThrow()
    })

    it('should throw when reading excluded file', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['**'],
        excludePatterns: ['**/node_modules/**'],
      })

      await expect(
        sparse.readFile('/project/node_modules/lodash/index.js')
      ).rejects.toThrow()
    })
  })

  // ========================================
  // 6. stat method
  // ========================================
  describe('stat', () => {
    it('should stat file matching include pattern', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      const stats = await sparse.stat('/project/src/index.ts')
      expect(stats.isFile()).toBe(true)
    })

    it('should throw when stat file not matching pattern', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      await expect(sparse.stat('/project/lib/index.js')).rejects.toThrow()
    })

    it('should stat directory that could contain matches', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      const stats = await sparse.stat('/project/src')
      expect(stats.isDirectory()).toBe(true)
    })
  })

  // ========================================
  // 7. exists method
  // ========================================
  describe('exists', () => {
    it('should return true for file matching pattern', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      expect(await sparse.exists('/project/src/index.ts')).toBe(true)
    })

    it('should return false for file not matching pattern', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      expect(await sparse.exists('/project/lib/index.js')).toBe(false)
    })

    it('should return true for directory that could contain matches', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      expect(await sparse.exists('/project/src')).toBe(true)
    })

    it('should return false for excluded path', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['**'],
        excludePatterns: ['**/node_modules/**'],
      })

      expect(await sparse.exists('/project/node_modules/lodash/index.js')).toBe(
        false
      )
    })
  })

  // ========================================
  // 8. walk method (async generator)
  // ========================================
  describe('walk', () => {
    it('should walk and filter entries by pattern', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      const entries: WalkEntry[] = []
      for await (const entry of sparse.walk('/project')) {
        entries.push(entry)
      }

      // Should include src files
      const paths = entries.map((e) => e.path)
      expect(paths).toContain('/project/src')
      expect(paths).toContain('/project/src/index.ts')
      expect(paths).toContain('/project/src/utils')
      expect(paths).toContain('/project/src/utils/helper.ts')

      // Should not include non-matching paths
      expect(paths).not.toContain('/project/lib')
      expect(paths).not.toContain('/project/node_modules')
    })

    it('should exclude paths matching exclude patterns', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['**'],
        excludePatterns: ['**/node_modules/**', '**/dist/**'],
        root: '/project',
      })

      const entries: WalkEntry[] = []
      for await (const entry of sparse.walk('/project')) {
        entries.push(entry)
      }

      const paths = entries.map((e) => e.path)

      // Should include most files
      expect(paths).toContain('/project/src/index.ts')
      expect(paths).toContain('/project/lib/index.js')

      // Should exclude node_modules and dist
      expect(paths).not.toContain('/project/node_modules')
      expect(paths).not.toContain('/project/node_modules/lodash')
      expect(paths).not.toContain('/project/dist')
    })

    it('should provide entry type information', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      const entries: WalkEntry[] = []
      for await (const entry of sparse.walk('/project')) {
        entries.push(entry)
      }

      const srcDir = entries.find((e) => e.path === '/project/src')
      expect(srcDir?.type).toBe('directory')

      const indexFile = entries.find((e) => e.path === '/project/src/index.ts')
      expect(indexFile?.type).toBe('file')
    })

    it('should support depth limiting', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['**'],
        root: '/project',
      })

      const entries: WalkEntry[] = []
      for await (const entry of sparse.walk('/project', { maxDepth: 1 })) {
        entries.push(entry)
      }

      const paths = entries.map((e) => e.path)

      // Should include direct children
      expect(paths).toContain('/project/src')
      expect(paths).toContain('/project/package.json')

      // Should not include deep nested paths
      expect(paths).not.toContain('/project/src/index.ts')
      expect(paths).not.toContain('/project/src/utils')
    })
  })

  // ========================================
  // 9. Real-world scenarios
  // ========================================
  describe('real-world scenarios', () => {
    it('should handle TypeScript project patterns', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**/*.ts', 'src/**/*.tsx', 'package.json', 'tsconfig.json'],
        excludePatterns: ['**/*.test.ts', '**/test/**'],
        root: '/project',
      })

      expect(sparse.shouldInclude('src/index.ts')).toBe(true)
      expect(sparse.shouldInclude('src/components/Button.tsx')).toBe(true)
      expect(sparse.shouldInclude('package.json')).toBe(true)
      expect(sparse.shouldInclude('test/index.test.ts')).toBe(false)

      const content = await sparse.readFile('/project/src/index.ts')
      expect(content).toBe('export {}')
    })

    it('should handle monorepo patterns', async () => {
      // Create monorepo structure
      await fs.mkdir('/monorepo/packages/core/src', { recursive: true })
      await fs.mkdir('/monorepo/packages/shared/src', { recursive: true })
      await fs.mkdir('/monorepo/packages/other/src', { recursive: true })
      await fs.writeFile('/monorepo/packages/core/src/index.ts', 'core')
      await fs.writeFile('/monorepo/packages/shared/src/index.ts', 'shared')
      await fs.writeFile('/monorepo/packages/other/src/index.ts', 'other')
      await fs.writeFile('/monorepo/package.json', '{}')

      const sparse = new SparseFS(fs, {
        patterns: ['packages/core/**', 'packages/shared/**', 'package.json'],
        excludePatterns: ['**/node_modules/**'],
      })

      expect(sparse.shouldInclude('packages/core/src/index.ts')).toBe(true)
      expect(sparse.shouldInclude('packages/shared/src/index.ts')).toBe(true)
      expect(sparse.shouldInclude('packages/other/src/index.ts')).toBe(false)
      expect(sparse.shouldInclude('package.json')).toBe(true)
    })

    it('should efficiently skip excluded directories', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['**'],
        excludePatterns: ['**/node_modules/**'],
        root: '/project',
      })

      // Walking should skip node_modules entirely
      const entries: WalkEntry[] = []
      for await (const entry of sparse.walk('/project')) {
        entries.push(entry)
      }

      // Verify node_modules was skipped
      const nodeModulesEntries = entries.filter((e) =>
        e.path.includes('node_modules')
      )
      expect(nodeModulesEntries).toHaveLength(0)
    })
  })

  // ========================================
  // 10. Edge cases
  // ========================================
  describe('edge cases', () => {
    it('should handle root path correctly', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['**'],
      })

      const exists = await sparse.exists('/')
      expect(exists).toBe(true)
    })

    it('should handle paths with leading slash', async () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**'],
        root: '/project',
      })

      expect(sparse.shouldInclude('/src/index.ts')).toBe(true)
      expect(sparse.shouldInclude('src/index.ts')).toBe(true)
    })

    it('should handle empty directory', async () => {
      await fs.mkdir('/project/empty', { recursive: true })

      const sparse = new SparseFS(fs, {
        patterns: ['empty/**'],
      })

      const entries = await sparse.readdir('/project/empty')
      expect(entries).toHaveLength(0)
    })
  })

  // ========================================
  // 11. Configuration validation
  // ========================================
  describe('configuration validation', () => {
    it('should throw if patterns is not an array', () => {
      expect(() => {
        new SparseFS(fs, {
          // @ts-expect-error - Testing runtime validation
          patterns: 'src/**',
        })
      }).toThrow(/patterns must be an array/)
    })

    it('should throw if patterns contains non-string elements', () => {
      expect(() => {
        new SparseFS(fs, {
          // @ts-expect-error - Testing runtime validation
          patterns: ['src/**', 123, null],
        })
      }).toThrow(/pattern at index 1 must be a string/)
    })

    it('should throw if excludePatterns is not an array', () => {
      expect(() => {
        new SparseFS(fs, {
          patterns: ['src/**'],
          // @ts-expect-error - Testing runtime validation
          excludePatterns: '**/node_modules/**',
        })
      }).toThrow(/excludePatterns must be an array/)
    })

    it('should throw if excludePatterns contains non-string elements', () => {
      expect(() => {
        new SparseFS(fs, {
          patterns: ['src/**'],
          // @ts-expect-error - Testing runtime validation
          excludePatterns: ['**/node_modules/**', undefined],
        })
      }).toThrow(/excludePattern at index 1 must be a string/)
    })

    it('should throw on invalid pattern with helpful message', () => {
      expect(() => {
        new SparseFS(fs, {
          patterns: ['src/***/invalid'],
        })
      }).toThrow(/Invalid pattern at index 0/)
    })

    it('should throw on empty pattern string', () => {
      expect(() => {
        new SparseFS(fs, {
          patterns: ['src/**', ''],
        })
      }).toThrow(/pattern at index 1.*cannot be empty/)
    })

    it('should throw on whitespace-only pattern', () => {
      expect(() => {
        new SparseFS(fs, {
          patterns: ['   '],
        })
      }).toThrow(/pattern at index 0.*cannot be whitespace/)
    })

    it('should validate root path type', () => {
      expect(() => {
        new SparseFS(fs, {
          patterns: ['src/**'],
          // @ts-expect-error - Testing runtime validation
          root: 123,
        })
      }).toThrow(/root must be a string/)
    })

    it('should accept valid configuration', () => {
      const sparse = new SparseFS(fs, {
        patterns: ['src/**', 'package.json'],
        excludePatterns: ['**/node_modules/**', '**/dist/**'],
        root: '/project',
        cone: false,
      })
      expect(sparse).toBeInstanceOf(SparseFS)
    })
  })

  // ========================================
  // 12. Pattern presets
  // ========================================
  describe('pattern presets', () => {
    describe('built-in presets', () => {
      it('should have typescript preset', () => {
        expect(SparseFS.presets.typescript).toBeDefined()
        expect(SparseFS.presets.typescript).toContain('**/*.ts')
        expect(SparseFS.presets.typescript).toContain('**/*.tsx')
        expect(SparseFS.presets.typescript).toContain('package.json')
        expect(SparseFS.presets.typescript).toContain('tsconfig.json')
      })

      it('should have javascript preset', () => {
        expect(SparseFS.presets.javascript).toBeDefined()
        expect(SparseFS.presets.javascript).toContain('**/*.js')
        expect(SparseFS.presets.javascript).toContain('**/*.jsx')
        expect(SparseFS.presets.javascript).toContain('package.json')
      })

      it('should have source preset', () => {
        expect(SparseFS.presets.source).toBeDefined()
        expect(SparseFS.presets.source).toContain('src/**')
        expect(SparseFS.presets.source).toContain('lib/**')
        expect(SparseFS.presets.source).toContain('package.json')
      })

      it('should have web preset', () => {
        expect(SparseFS.presets.web).toBeDefined()
        expect(SparseFS.presets.web).toContain('**/*.html')
        expect(SparseFS.presets.web).toContain('**/*.css')
        expect(SparseFS.presets.web).toContain('**/*.js')
      })

      it('should have config preset', () => {
        expect(SparseFS.presets.config).toBeDefined()
        expect(SparseFS.presets.config).toContain('package.json')
        expect(SparseFS.presets.config).toContain('tsconfig.json')
        expect(SparseFS.presets.config).toContain('*.config.{js,ts,mjs,cjs}')
      })
    })

    describe('fromPreset factory method', () => {
      it('should create SparseFS from typescript preset', () => {
        const sparse = SparseFS.fromPreset(fs, 'typescript')
        expect(sparse).toBeInstanceOf(SparseFS)
        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('src/App.tsx')).toBe(true)
        expect(sparse.shouldInclude('package.json')).toBe(true)
      })

      it('should create SparseFS from javascript preset', () => {
        const sparse = SparseFS.fromPreset(fs, 'javascript')
        expect(sparse).toBeInstanceOf(SparseFS)
        expect(sparse.shouldInclude('src/index.js')).toBe(true)
        expect(sparse.shouldInclude('src/App.jsx')).toBe(true)
      })

      it('should allow additional exclude patterns with preset', () => {
        const sparse = SparseFS.fromPreset(fs, 'typescript', {
          exclude: ['dist', 'coverage', '**/test/**'],
        })
        expect(sparse).toBeInstanceOf(SparseFS)
        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('dist/index.js')).toBe(false)
        expect(sparse.shouldInclude('coverage/lcov.info')).toBe(false)
        expect(sparse.shouldInclude('src/test/utils.ts')).toBe(false)
      })

      it('should allow extending preset with additional patterns', () => {
        const sparse = SparseFS.fromPreset(fs, 'typescript', {
          include: ['**/*.md', 'README'],
        })
        expect(sparse.shouldInclude('docs/api.md')).toBe(true)
        expect(sparse.shouldInclude('README')).toBe(true)
      })

      it('should allow setting root with preset', () => {
        const sparse = SparseFS.fromPreset(fs, 'source', {
          root: '/project',
        })
        expect(sparse).toBeInstanceOf(SparseFS)
      })

      it('should throw on unknown preset name', () => {
        expect(() => {
          // @ts-expect-error - Testing runtime error
          SparseFS.fromPreset(fs, 'unknown-preset')
        }).toThrow(/Unknown preset.*unknown-preset/)
      })
    })

    describe('custom presets', () => {
      it('should allow registering custom presets', () => {
        SparseFS.registerPreset('my-preset', ['src/**', 'custom/**'])
        expect(SparseFS.presets['my-preset']).toEqual(['src/**', 'custom/**'])
      })

      it('should use registered custom preset with fromPreset', () => {
        SparseFS.registerPreset('custom-ts', ['**/*.ts', 'custom.json'])
        const sparse = SparseFS.fromPreset(fs, 'custom-ts')
        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('custom.json')).toBe(true)
      })

      it('should throw when registering preset with empty patterns', () => {
        expect(() => {
          SparseFS.registerPreset('empty', [])
        }).toThrow(/Preset patterns cannot be empty/)
      })

      it('should throw when registering preset with invalid patterns', () => {
        expect(() => {
          SparseFS.registerPreset('invalid', ['src/***/bad'])
        }).toThrow(/Invalid pattern/)
      })
    })

    describe('preset combinations', () => {
      it('should work with common monorepo pattern', async () => {
        const sparse = SparseFS.fromPreset(fs, 'typescript', {
          root: '/project',
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts'],
        })

        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('src/components/Button.tsx')).toBe(true)
        expect(sparse.shouldInclude('node_modules/lodash/index.js')).toBe(false)
        expect(sparse.shouldInclude('test/index.test.ts')).toBe(false)
      })
    })
  })

  // ========================================
  // 13. Cone mode (directory-based matching)
  // ========================================
  describe('cone mode', () => {
    // ----------------------------------------
    // 13.1 Cone mode includes entire directories
    // ----------------------------------------
    describe('cone mode includes entire directories', () => {
      it('should include all files under specified directory', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('src/utils/helper.ts')).toBe(true)
        expect(sparse.shouldInclude('src/components/Button.tsx')).toBe(true)
      })

      it('should include deeply nested files under cone directory', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        expect(sparse.shouldInclude('src/deep/nested/file.ts')).toBe(true)
        expect(sparse.shouldInclude('src/a/b/c/d/e/f.ts')).toBe(true)
      })

      it('should include all file types under cone directory', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        // Various file types should all be included
        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('src/styles.css')).toBe(true)
        expect(sparse.shouldInclude('src/data.json')).toBe(true)
        expect(sparse.shouldInclude('src/image.png')).toBe(true)
        expect(sparse.shouldInclude('src/.gitkeep')).toBe(true)
      })

      it('should include multiple cone directories', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/', 'lib/'],
          root: '/project',
        })

        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('lib/index.js')).toBe(true)
      })

      it('should handle cone directory without trailing slash', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src'],  // No trailing slash
          root: '/project',
        })

        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('src/utils/helper.ts')).toBe(true)
      })
    })

    // ----------------------------------------
    // 13.2 Parent directories auto-included
    // ----------------------------------------
    describe('parent directories auto-included', () => {
      it('should include toplevel files by default', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        // Toplevel files are always included in cone mode
        expect(sparse.shouldInclude('package.json')).toBe(true)
        expect(sparse.shouldInclude('tsconfig.json')).toBe(true)
        expect(sparse.shouldInclude('README.md')).toBe(true)
      })

      it('should include immediate files of ancestor directories', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['packages/core/src/'],
          root: '/project',
        })

        // Immediate files of ancestor directories are included
        expect(sparse.shouldInclude('packages/package.json')).toBe(true)
        expect(sparse.shouldInclude('packages/core/package.json')).toBe(true)
        expect(sparse.shouldInclude('packages/core/index.ts')).toBe(true)
      })

      it('should traverse parent directories to reach cone', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['packages/core/src/'],
          root: '/project',
        })

        // Parent directories should be traversable
        expect(sparse.shouldTraverseDirectory('packages')).toBe(true)
        expect(sparse.shouldTraverseDirectory('packages/core')).toBe(true)
        expect(sparse.shouldTraverseDirectory('packages/core/src')).toBe(true)
      })

      it('should handle nested cone with immediate parent file inclusion', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/components/ui/'],
          root: '/project',
        })

        // Toplevel files
        expect(sparse.shouldInclude('package.json')).toBe(true)
        // Immediate file of src/
        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        // Immediate file of src/components/
        expect(sparse.shouldInclude('src/components/index.ts')).toBe(true)
        // All files under cone
        expect(sparse.shouldInclude('src/components/ui/Button.tsx')).toBe(true)
      })
    })

    // ----------------------------------------
    // 13.3 Files outside cone excluded
    // ----------------------------------------
    describe('files outside cone excluded', () => {
      it('should exclude files in unspecified sibling directories', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        expect(sparse.shouldInclude('lib/index.js')).toBe(false)
        expect(sparse.shouldInclude('test/index.test.ts')).toBe(false)
        expect(sparse.shouldInclude('dist/bundle.js')).toBe(false)
      })

      it('should exclude files in nested unspecified directories', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/components/ui/'],
          root: '/project',
        })

        // src/utils/ is sibling to src/components/
        expect(sparse.shouldInclude('src/utils/helper.ts')).toBe(false)
        // src/components/forms/ is sibling to src/components/ui/
        expect(sparse.shouldInclude('src/components/forms/Input.tsx')).toBe(false)
      })

      it('should not traverse excluded sibling directories', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['packages/core/'],
          root: '/project',
        })

        // packages/other is sibling, should not be traversed
        expect(sparse.shouldTraverseDirectory('packages/other')).toBe(false)
        expect(sparse.shouldTraverseDirectory('lib')).toBe(false)
      })

      it('should exclude node_modules even if under cone parent', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        // node_modules is sibling of src, should be excluded
        expect(sparse.shouldInclude('node_modules/lodash/index.js')).toBe(false)
        expect(sparse.shouldTraverseDirectory('node_modules')).toBe(false)
      })

      it('should properly handle readdir filtering in cone mode', async () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        const entries = await sparse.readdir('/project')

        expect(entries).toContain('src')
        expect(entries).toContain('package.json')
        expect(entries).toContain('tsconfig.json')
        expect(entries).not.toContain('lib')
        expect(entries).not.toContain('node_modules')
        expect(entries).not.toContain('dist')
      })
    })

    // ----------------------------------------
    // 13.4 Nested cone patterns
    // ----------------------------------------
    describe('nested cone patterns', () => {
      it('should handle multiple nested cones', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['packages/core/', 'packages/shared/'],
          root: '/project',
        })

        // Both cones accessible
        expect(sparse.shouldInclude('packages/core/src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('packages/shared/utils.ts')).toBe(true)

        // Sibling package excluded
        expect(sparse.shouldInclude('packages/other/index.ts')).toBe(false)
      })

      it('should handle overlapping cone prefixes', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['packages/core/', 'packages/core-utils/'],
          root: '/project',
        })

        expect(sparse.shouldInclude('packages/core/index.ts')).toBe(true)
        expect(sparse.shouldInclude('packages/core-utils/helper.ts')).toBe(true)
        expect(sparse.shouldInclude('packages/core-extra/other.ts')).toBe(false)
      })

      it('should handle cone at different depths', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/', 'packages/core/lib/'],
          root: '/project',
        })

        // Shallow cone
        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        // Deep cone
        expect(sparse.shouldInclude('packages/core/lib/utils.ts')).toBe(true)
        // Immediate file of deep cone ancestor
        expect(sparse.shouldInclude('packages/core/index.ts')).toBe(true)
        expect(sparse.shouldInclude('packages/index.ts')).toBe(true)
        // Sibling of deep cone excluded
        expect(sparse.shouldInclude('packages/core/src/index.ts')).toBe(false)
      })

      it('should handle parent-child cone relationship', () => {
        // If both 'packages/' and 'packages/core/' are specified,
        // the broader pattern should win
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['packages/', 'packages/core/src/'],
          root: '/project',
        })

        // packages/ includes everything under packages/
        expect(sparse.shouldInclude('packages/core/src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('packages/other/index.ts')).toBe(true)
        expect(sparse.shouldInclude('packages/shared/utils.ts')).toBe(true)
      })

      it('should walk correctly with nested cone patterns', async () => {
        // Create additional test structure
        await fs.mkdir('/project/packages/core/src', { recursive: true })
        await fs.mkdir('/project/packages/other/src', { recursive: true })
        await fs.writeFile('/project/packages/core/src/index.ts', 'export {}')
        await fs.writeFile('/project/packages/core/package.json', '{}')
        await fs.writeFile('/project/packages/other/src/index.ts', 'export {}')

        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['packages/core/'],
          root: '/project',
        })

        const entries: WalkEntry[] = []
        for await (const entry of sparse.walk('/project')) {
          entries.push(entry)
        }

        const paths = entries.map((e) => e.path)

        // Should include packages/core/ content
        expect(paths).toContain('/project/packages/core/src/index.ts')
        expect(paths).toContain('/project/packages/core/package.json')

        // Should NOT include packages/other/ content
        expect(paths).not.toContain('/project/packages/other/src/index.ts')
      })
    })

    // ----------------------------------------
    // 13.5 Cone mode validation
    // ----------------------------------------
    describe('cone mode validation', () => {
      it('should reject glob patterns in cone mode', () => {
        expect(() => {
          new SparseFS(fs, {
            cone: true,
            patterns: ['src/**/*.ts'],  // Glob not allowed
            root: '/project',
          })
        }).toThrow(/cone mode/i)
      })

      it('should reject wildcard patterns in cone mode', () => {
        expect(() => {
          new SparseFS(fs, {
            cone: true,
            patterns: ['**/node_modules/**'],
            root: '/project',
          })
        }).toThrow(/cone mode/i)
      })

      it('should reject question mark wildcards in cone mode', () => {
        expect(() => {
          new SparseFS(fs, {
            cone: true,
            patterns: ['src?/'],
            root: '/project',
          })
        }).toThrow(/cone mode/i)
      })

      it('should reject brace expansion in cone mode', () => {
        expect(() => {
          new SparseFS(fs, {
            cone: true,
            patterns: ['{src,lib}/'],
            root: '/project',
          })
        }).toThrow(/cone mode/i)
      })

      it('should reject character classes in cone mode', () => {
        expect(() => {
          new SparseFS(fs, {
            cone: true,
            patterns: ['[sl]rc/'],
            root: '/project',
          })
        }).toThrow(/cone mode/i)
      })

      it('should accept plain directory names in cone mode', () => {
        // Should not throw
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/', 'lib/', 'packages/core/'],
          root: '/project',
        })
        expect(sparse).toBeInstanceOf(SparseFS)
      })

      it('should accept directory names without trailing slash', () => {
        // Should not throw
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src', 'lib', 'packages/core'],
          root: '/project',
        })
        expect(sparse).toBeInstanceOf(SparseFS)
      })
    })

    // ----------------------------------------
    // 13.6 Cone mode file system operations
    // ----------------------------------------
    describe('cone mode file system operations', () => {
      it('should allow readFile for files in cone', async () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        const content = await sparse.readFile('/project/src/index.ts')
        expect(content).toBe('export {}')
      })

      it('should allow readFile for toplevel files', async () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        const content = await sparse.readFile('/project/package.json')
        expect(content).toBe('{}')
      })

      it('should reject readFile for files outside cone', async () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        await expect(sparse.readFile('/project/lib/index.js')).rejects.toThrow()
      })

      it('should report exists=true for files in cone', async () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        expect(await sparse.exists('/project/src/index.ts')).toBe(true)
      })

      it('should report exists=false for files outside cone', async () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        expect(await sparse.exists('/project/lib/index.js')).toBe(false)
      })

      it('should stat files in cone', async () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        const stats = await sparse.stat('/project/src/index.ts')
        expect(stats.isFile()).toBe(true)
      })

      it('should reject stat for files outside cone', async () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        await expect(sparse.stat('/project/lib/index.js')).rejects.toThrow()
      })
    })

    // ----------------------------------------
    // 13.7 Cone mode edge cases
    // ----------------------------------------
    describe('cone mode edge cases', () => {
      it('should handle empty cone patterns (toplevel only)', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: [],
          root: '/project',
        })

        // Only toplevel files
        expect(sparse.shouldInclude('package.json')).toBe(true)
        expect(sparse.shouldInclude('src/index.ts')).toBe(false)
      })

      it('should handle root directory itself', async () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        expect(await sparse.exists('/project')).toBe(true)
      })

      it('should handle paths with leading slash', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        expect(sparse.shouldInclude('/src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
      })

      it('should handle cone directory itself', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        // The directory itself should be traversable
        expect(sparse.shouldTraverseDirectory('src')).toBe(true)
      })

      it('should handle dotfiles in cone', () => {
        const sparse = new SparseFS(fs, {
          cone: true,
          patterns: ['src/'],
          root: '/project',
        })

        expect(sparse.shouldInclude('.gitignore')).toBe(true)  // toplevel
        expect(sparse.shouldInclude('src/.eslintrc')).toBe(true)  // in cone
      })
    })
  })

  // ========================================
  // 13. Gitignore loading (REFACTOR phase)
  // ========================================
  describe('gitignore loading', () => {
    describe('parseGitignoreContent', () => {
      it('should parse basic patterns', () => {
        const content = `node_modules
dist
*.log`
        const patterns = SparseFS.parseGitignoreContent(content)
        expect(patterns).toEqual(['node_modules', 'dist', '*.log'])
      })

      it('should skip empty lines', () => {
        const content = `node_modules

dist

*.log`
        const patterns = SparseFS.parseGitignoreContent(content)
        expect(patterns).toEqual(['node_modules', 'dist', '*.log'])
      })

      it('should skip comment lines', () => {
        const content = `# Build artifacts
dist

# Dependencies
node_modules

# Logs
*.log`
        const patterns = SparseFS.parseGitignoreContent(content)
        expect(patterns).toEqual(['dist', 'node_modules', '*.log'])
      })

      it('should handle escaped hash patterns', () => {
        const content = `\\#important.txt
node_modules`
        const patterns = SparseFS.parseGitignoreContent(content)
        expect(patterns).toEqual(['#important.txt', 'node_modules'])
      })

      it('should handle negation patterns', () => {
        const content = `node_modules
!node_modules/@company`
        const patterns = SparseFS.parseGitignoreContent(content)
        expect(patterns).toEqual(['node_modules', '!node_modules/@company'])
      })

      it('should trim whitespace', () => {
        const content = `  node_modules
  dist  `
        const patterns = SparseFS.parseGitignoreContent(content)
        expect(patterns).toEqual(['node_modules', 'dist'])
      })

      it('should handle Windows line endings', () => {
        const content = 'node_modules\r\ndist\r\n*.log'
        const patterns = SparseFS.parseGitignoreContent(content)
        expect(patterns).toEqual(['node_modules', 'dist', '*.log'])
      })
    })

    describe('loadGitignore', () => {
      it('should load patterns from .gitignore file', async () => {
        await fs.writeFile('/project/.gitignore', `# Dependencies
node_modules

# Build
dist
*.log`)

        const result = await SparseFS.loadGitignore(fs, '/project/.gitignore')
        expect(result.exists).toBe(true)
        expect(result.path).toBe('/project/.gitignore')
        expect(result.patterns).toEqual(['node_modules', 'dist', '*.log'])
      })

      it('should return empty patterns for non-existent file', async () => {
        const result = await SparseFS.loadGitignore(fs, '/nonexistent/.gitignore')
        expect(result.exists).toBe(false)
        expect(result.path).toBe('/nonexistent/.gitignore')
        expect(result.patterns).toEqual([])
      })

      it('should handle empty .gitignore file', async () => {
        await fs.writeFile('/project/.empty-gitignore', '')

        const result = await SparseFS.loadGitignore(fs, '/project/.empty-gitignore')
        expect(result.exists).toBe(true)
        expect(result.patterns).toEqual([])
      })

      it('should handle .gitignore with only comments', async () => {
        await fs.writeFile('/project/.comments-only', `# This is a comment
# Another comment`)

        const result = await SparseFS.loadGitignore(fs, '/project/.comments-only')
        expect(result.exists).toBe(true)
        expect(result.patterns).toEqual([])
      })
    })

    describe('withGitignore factory', () => {
      it('should create SparseFS with gitignore patterns loaded', async () => {
        // Use glob patterns that match gitignore behavior
        await fs.writeFile('/project/.gitignore', `**/node_modules/**
**/dist/**`)

        const sparse = await SparseFS.withGitignore(fs, {
          patterns: ['**'],
          gitignore: '/project/.gitignore',
          root: '/project',
        })

        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('node_modules/lodash/index.js')).toBe(false)
        expect(sparse.shouldInclude('dist/bundle.js')).toBe(false)
      })

      it('should load from root when gitignore is true', async () => {
        await fs.writeFile('/project/.gitignore', `**/node_modules/**`)

        const sparse = await SparseFS.withGitignore(fs, {
          patterns: ['**'],
          gitignore: true,
          root: '/project',
        })

        // Note: when root is /project, gitignore path is /project/.gitignore
        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
      })

      it('should merge with existing excludePatterns', async () => {
        await fs.writeFile('/project/.gitignore', `**/node_modules/**`)

        const sparse = await SparseFS.withGitignore(fs, {
          patterns: ['**'],
          excludePatterns: ['**/dist/**'],  // Existing exclude
          gitignore: '/project/.gitignore',
          root: '/project',
        })

        // Both patterns should be applied
        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
        expect(sparse.shouldInclude('node_modules/lodash/index.js')).toBe(false)
        expect(sparse.shouldInclude('dist/bundle.js')).toBe(false)
      })

      it('should handle missing .gitignore file gracefully', async () => {
        const sparse = await SparseFS.withGitignore(fs, {
          patterns: ['**'],
          gitignore: '/nonexistent/.gitignore',
          root: '/project',
        })

        // Should work without errors
        expect(sparse.shouldInclude('src/index.ts')).toBe(true)
      })

      it('should support deprecated gitignorePath option', async () => {
        await fs.writeFile('/project/.gitignore', `**/node_modules/**`)

        const sparse = await SparseFS.withGitignore(fs, {
          patterns: ['**'],
          gitignorePath: '/project/.gitignore',
          root: '/project',
        })

        expect(sparse.shouldInclude('node_modules/lodash/index.js')).toBe(false)
      })

      it('should handle negation patterns in .gitignore', async () => {
        await fs.writeFile('/project/.gitignore', `# Exclude all node_modules
**/node_modules/**
# But keep company packages
!**/node_modules/@company/**`)

        const sparse = await SparseFS.withGitignore(fs, {
          patterns: ['**'],
          gitignore: '/project/.gitignore',
          root: '/project',
        })

        // Standard node_modules should be excluded
        expect(sparse.shouldInclude('node_modules/lodash/index.js')).toBe(false)
      })
    })
  })
})
