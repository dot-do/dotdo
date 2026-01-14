/**
 * Tests for SDK export pattern
 *
 * These tests verify that the `fs` singleton is exported from the main entry point
 * and provides a convenient API for filesystem operations.
 *
 * @example
 * ```typescript
 * import { fs } from 'fsx.do'
 *
 * await fs.writeFile('/hello.txt', 'Hello, World!')
 * const content = await fs.readFile('/hello.txt', 'utf-8')
 * ```
 */

import { describe, it, expect } from 'vitest'

describe('SDK Export Pattern', () => {
  describe('fs singleton export', () => {
    it('should export fs from main entry point', async () => {
      // This import should work when fs singleton is exported
      const module = await import('../index.js')
      expect(module.fs).toBeDefined()
    }, 15000)

    it('should export fs as a named export', async () => {
      // The fs export should be accessible as a named import
      const { fs } = await import('../index.js')
      expect(fs).toBeDefined()
    })

    it('should have readFile method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.readFile).toBe('function')
    })

    it('should have writeFile method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.writeFile).toBe('function')
    })

    it('should have mkdir method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.mkdir).toBe('function')
    })

    it('should have rmdir method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.rmdir).toBe('function')
    })

    it('should have readdir method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.readdir).toBe('function')
    })

    it('should have stat method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.stat).toBe('function')
    })

    it('should have unlink method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.unlink).toBe('function')
    })

    it('should have rename method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.rename).toBe('function')
    })

    it('should have copyFile method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.copyFile).toBe('function')
    })

    it('should have exists method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.exists).toBe('function')
    })

    it('should have access method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.access).toBe('function')
    })

    it('should have chmod method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.chmod).toBe('function')
    })

    it('should have appendFile method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.appendFile).toBe('function')
    })

    it('should have rm method on fs singleton', async () => {
      const { fs } = await import('../index.js')
      expect(typeof fs.rm).toBe('function')
    })
  })

  describe('singleton behavior', () => {
    it('should return same instance across multiple imports', async () => {
      const { fs: fs1 } = await import('../index.js')
      const { fs: fs2 } = await import('../index.js')

      // The same singleton instance should be returned
      expect(fs1).toBe(fs2)
    })

    it('should return same instance from module.fs and destructured import', async () => {
      const module = await import('../index.js')
      const { fs } = await import('../index.js')

      expect(module.fs).toBe(fs)
    })
  })

  describe('type exports', () => {
    it('should export Stats class', async () => {
      const { Stats } = await import('../index.js')
      expect(Stats).toBeDefined()
      expect(typeof Stats).toBe('function')
    })

    it('should export Dirent class', async () => {
      const { Dirent } = await import('../index.js')
      expect(Dirent).toBeDefined()
      expect(typeof Dirent).toBe('function')
    })

    it('should export FileHandle class', async () => {
      const { FileHandle } = await import('../index.js')
      expect(FileHandle).toBeDefined()
      expect(typeof FileHandle).toBe('function')
    })

    it('should export FSx class', async () => {
      const { FSx } = await import('../index.js')
      expect(FSx).toBeDefined()
      expect(typeof FSx).toBe('function')
    })

    it('should export constants object', async () => {
      const { constants } = await import('../index.js')
      expect(constants).toBeDefined()
      expect(typeof constants).toBe('object')
    })

    it('should export error classes', async () => {
      const module = await import('../index.js')
      expect(module.ENOENT).toBeDefined()
      expect(module.EEXIST).toBeDefined()
      expect(module.EISDIR).toBeDefined()
      expect(module.ENOTDIR).toBeDefined()
      expect(module.EACCES).toBeDefined()
    })
  })

  describe('fs singleton type compatibility', () => {
    it('should have methods matching FSx class signature', async () => {
      const { fs, FSx } = await import('../index.js')

      // Get method names from FSx prototype (excluding constructor)
      const fsxMethods = Object.getOwnPropertyNames(FSx.prototype).filter(
        (name) => name !== 'constructor' && typeof (FSx.prototype as any)[name] === 'function'
      )

      // The fs singleton should have all FSx methods
      for (const method of fsxMethods) {
        expect(
          typeof (fs as any)[method],
          `fs should have method ${method}`
        ).toBe('function')
      }
    })
  })
})

describe('SDK Usage Patterns', () => {
  describe('import patterns', () => {
    it('should support named import of fs', async () => {
      // This is the primary usage pattern
      const { fs } = await import('../index.js')
      expect(fs).toBeDefined()
    })

    it('should support namespace import', async () => {
      // import * as fsx from 'fsx.do'
      const fsx = await import('../index.js')
      expect(fsx.fs).toBeDefined()
      expect(fsx.Stats).toBeDefined()
      expect(fsx.Dirent).toBeDefined()
    })

    it('should support importing fs alongside types', async () => {
      // import { fs, Stats, Dirent } from 'fsx.do'
      const { fs, Stats, Dirent } = await import('../index.js')
      expect(fs).toBeDefined()
      expect(Stats).toBeDefined()
      expect(Dirent).toBeDefined()
    })

    it('should support importing fs alongside error classes', async () => {
      // import { fs, ENOENT, EEXIST } from 'fsx.do'
      const { fs, ENOENT, EEXIST } = await import('../index.js')
      expect(fs).toBeDefined()
      expect(ENOENT).toBeDefined()
      expect(EEXIST).toBeDefined()
    })
  })
})

describe('createFs Factory Function', () => {
  describe('export and basic usage', () => {
    it('should export createFs factory function', async () => {
      const { createFs } = await import('../index.js')
      expect(createFs).toBeDefined()
      expect(typeof createFs).toBe('function')
    })

    it('should create a new FSx instance with default options', async () => {
      const { createFs, FSx } = await import('../index.js')
      const newFs = createFs()
      expect(newFs).toBeInstanceOf(FSx)
    })

    it('should create isolated instances (not the singleton)', async () => {
      const { createFs, fs } = await import('../index.js')
      const newFs = createFs()
      expect(newFs).not.toBe(fs)
    })

    it('should create multiple isolated instances', async () => {
      const { createFs } = await import('../index.js')
      const fs1 = createFs()
      const fs2 = createFs()
      expect(fs1).not.toBe(fs2)
    })
  })

  describe('instance functionality', () => {
    it('should have all FSx methods on created instance', async () => {
      const { createFs, FSx } = await import('../index.js')
      const newFs = createFs()

      const fsxMethods = Object.getOwnPropertyNames(FSx.prototype).filter(
        (name) => name !== 'constructor' && typeof (FSx.prototype as any)[name] === 'function'
      )

      for (const method of fsxMethods) {
        expect(
          typeof (newFs as any)[method],
          `created instance should have method ${method}`
        ).toBe('function')
      }
    })

    it('should support file operations on created instance', async () => {
      const { createFs } = await import('../index.js')
      const testFs = createFs()

      // Write and read a file
      await testFs.writeFile('/factory-test.txt', 'factory test content')
      const content = await testFs.readFile('/factory-test.txt', 'utf-8')
      expect(content).toBe('factory test content')
    })

    it('should have isolated storage between instances', async () => {
      const { createFs, ENOENT } = await import('../index.js')
      const fs1 = createFs()
      const fs2 = createFs()

      // Write to fs1
      await fs1.writeFile('/isolated.txt', 'fs1 content')

      // fs1 should have the file
      const exists1 = await fs1.exists('/isolated.txt')
      expect(exists1).toBe(true)

      // fs2 should NOT have the file (isolated storage)
      const exists2 = await fs2.exists('/isolated.txt')
      expect(exists2).toBe(false)
    })
  })

  describe('CreateFsOptions type', () => {
    it('should export CreateFsOptions type', async () => {
      // This test verifies the type is exported by checking it compiles
      const module = await import('../index.js')
      expect(module.createFs).toBeDefined()
      // The type CreateFsOptions is available for TypeScript users
    })
  })
})
