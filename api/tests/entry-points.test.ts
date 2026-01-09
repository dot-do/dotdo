/**
 * Tree-Shakeable Entry Points Tests
 *
 * These tests verify that the various dotdo entry points export DO classes
 * with the correct capabilities configured.
 *
 * Entry points tested:
 * - dotdo/tiny    - Minimal DO (no capabilities)
 * - dotdo/fs      - DO with withFs applied
 * - dotdo/git     - DO with withFs and withGit
 * - dotdo/bash    - DO with withFs and withBash
 * - dotdo/full    - DO with all capabilities
 * - dotdo         - Default export, equals dotdo/full
 *
 * These tests will fail until:
 * 1. tiny.ts, fs.ts, git.ts, bash.ts, full.ts are created
 * 2. package.json exports are updated
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// Project root is two levels up from api/tests/
const PROJECT_ROOT = join(__dirname, '../..')

describe('Tree-Shakeable Entry Points', () => {
  describe('package.json exports', () => {
    const packageJsonPath = join(PROJECT_ROOT, 'package.json')
    let pkg: Record<string, unknown>

    beforeAll(() => {
      pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
    })

    it('exports dotdo/tiny', () => {
      const exports = pkg.exports as Record<string, string>
      expect(exports['./tiny']).toBeDefined()
      expect(exports['./tiny']).toMatch(/\.ts$/)
    })

    it('exports dotdo/fs', () => {
      const exports = pkg.exports as Record<string, string>
      expect(exports['./fs']).toBeDefined()
      expect(exports['./fs']).toMatch(/\.ts$/)
    })

    it('exports dotdo/git', () => {
      const exports = pkg.exports as Record<string, string>
      expect(exports['./git']).toBeDefined()
      expect(exports['./git']).toMatch(/\.ts$/)
    })

    it('exports dotdo/bash', () => {
      const exports = pkg.exports as Record<string, string>
      expect(exports['./bash']).toBeDefined()
      expect(exports['./bash']).toMatch(/\.ts$/)
    })

    it('exports dotdo/full', () => {
      const exports = pkg.exports as Record<string, string>
      expect(exports['./full']).toBeDefined()
      expect(exports['./full']).toMatch(/\.ts$/)
    })
  })

  describe('entry point files exist', () => {
    it('tiny.ts exists', () => {
      expect(existsSync(join(PROJECT_ROOT, 'tiny.ts'))).toBe(true)
    })

    it('fs.ts exists', () => {
      expect(existsSync(join(PROJECT_ROOT, 'fs.ts'))).toBe(true)
    })

    it('git.ts exists', () => {
      expect(existsSync(join(PROJECT_ROOT, 'git.ts'))).toBe(true)
    })

    it('bash.ts exists', () => {
      expect(existsSync(join(PROJECT_ROOT, 'bash.ts'))).toBe(true)
    })

    it('full.ts exists', () => {
      expect(existsSync(join(PROJECT_ROOT, 'full.ts'))).toBe(true)
    })
  })

  describe('dotdo/tiny - Minimal DO', () => {
    it('can be imported', async () => {
      const { DO: TinyDO } = await import('../../tiny')
      expect(TinyDO).toBeDefined()
      expect(typeof TinyDO).toBe('function')
    })

    it('extends DurableObject', async () => {
      const { DO: TinyDO } = await import('../../tiny')
      // TinyDO should be a class that extends DurableObject
      expect(TinyDO.prototype).toBeDefined()
    })

    it('has no fs capability', async () => {
      const { DO: TinyDO } = await import('../../tiny')
      // TinyDO should NOT have withFs applied
      expect(TinyDO.prototype.hasCapability?.('fs')).toBeFalsy()
    })

    it('has no git capability', async () => {
      const { DO: TinyDO } = await import('../../tiny')
      expect(TinyDO.prototype.hasCapability?.('git')).toBeFalsy()
    })

    it('has no bash capability', async () => {
      const { DO: TinyDO } = await import('../../tiny')
      expect(TinyDO.prototype.hasCapability?.('bash')).toBeFalsy()
    })

    it('exports capabilities list as empty', async () => {
      const { capabilities } = await import('../../tiny')
      expect(capabilities).toEqual([])
    })
  })

  describe('dotdo/fs - DO with filesystem', () => {
    it('can be imported', async () => {
      const { DO: FsDO } = await import('../../fs')
      expect(FsDO).toBeDefined()
      expect(typeof FsDO).toBe('function')
    })

    it('has fs capability', async () => {
      const { DO: FsDO } = await import('../../fs')
      expect(FsDO.prototype.hasCapability?.('fs')).toBe(true)
    })

    it('has no git capability', async () => {
      const { DO: FsDO } = await import('../../fs')
      expect(FsDO.prototype.hasCapability?.('git')).toBeFalsy()
    })

    it('has no bash capability', async () => {
      const { DO: FsDO } = await import('../../fs')
      expect(FsDO.prototype.hasCapability?.('bash')).toBeFalsy()
    })

    it('exports capabilities list with fs', async () => {
      const { capabilities } = await import('../../fs')
      expect(capabilities).toContain('fs')
      expect(capabilities).not.toContain('git')
      expect(capabilities).not.toContain('bash')
    })

    it('exports withFs mixin', async () => {
      const { withFs } = await import('../../fs')
      expect(withFs).toBeDefined()
      expect(typeof withFs).toBe('function')
    })
  })

  describe('dotdo/git - DO with git (includes fs)', () => {
    it('can be imported', async () => {
      const { DO: GitDO } = await import('../../git')
      expect(GitDO).toBeDefined()
      expect(typeof GitDO).toBe('function')
    })

    it('has fs capability (required by git)', async () => {
      const { DO: GitDO } = await import('../../git')
      expect(GitDO.prototype.hasCapability?.('fs')).toBe(true)
    })

    it('has git capability', async () => {
      const { DO: GitDO } = await import('../../git')
      expect(GitDO.prototype.hasCapability?.('git')).toBe(true)
    })

    it('has no bash capability', async () => {
      const { DO: GitDO } = await import('../../git')
      expect(GitDO.prototype.hasCapability?.('bash')).toBeFalsy()
    })

    it('exports capabilities list with fs and git', async () => {
      const { capabilities } = await import('../../git')
      expect(capabilities).toContain('fs')
      expect(capabilities).toContain('git')
      expect(capabilities).not.toContain('bash')
    })

    it('exports withGit mixin', async () => {
      const { withGit } = await import('../../git')
      expect(withGit).toBeDefined()
      expect(typeof withGit).toBe('function')
    })
  })

  describe('dotdo/bash - DO with bash (includes fs)', () => {
    it('can be imported', async () => {
      const { DO: BashDO } = await import('../../bash')
      expect(BashDO).toBeDefined()
      expect(typeof BashDO).toBe('function')
    })

    it('has fs capability (required by bash)', async () => {
      const { DO: BashDO } = await import('../../bash')
      expect(BashDO.prototype.hasCapability?.('fs')).toBe(true)
    })

    it('has no git capability', async () => {
      const { DO: BashDO } = await import('../../bash')
      expect(BashDO.prototype.hasCapability?.('git')).toBeFalsy()
    })

    it('has bash capability', async () => {
      const { DO: BashDO } = await import('../../bash')
      expect(BashDO.prototype.hasCapability?.('bash')).toBe(true)
    })

    it('exports capabilities list with fs and bash', async () => {
      const { capabilities } = await import('../../bash')
      expect(capabilities).toContain('fs')
      expect(capabilities).toContain('bash')
      expect(capabilities).not.toContain('git')
    })

    it('exports withBash mixin', async () => {
      const { withBash } = await import('../../bash')
      expect(withBash).toBeDefined()
      expect(typeof withBash).toBe('function')
    })
  })

  describe('dotdo/full - DO with all capabilities', () => {
    it('can be imported', async () => {
      const { DO: FullDO } = await import('../../full')
      expect(FullDO).toBeDefined()
      expect(typeof FullDO).toBe('function')
    })

    it('has fs capability', async () => {
      const { DO: FullDO } = await import('../../full')
      expect(FullDO.prototype.hasCapability?.('fs')).toBe(true)
    })

    it('has git capability', async () => {
      const { DO: FullDO } = await import('../../full')
      expect(FullDO.prototype.hasCapability?.('git')).toBe(true)
    })

    it('has bash capability', async () => {
      const { DO: FullDO } = await import('../../full')
      expect(FullDO.prototype.hasCapability?.('bash')).toBe(true)
    })

    it('exports capabilities list with all capabilities', async () => {
      const { capabilities } = await import('../../full')
      expect(capabilities).toContain('fs')
      expect(capabilities).toContain('git')
      expect(capabilities).toContain('bash')
    })

    it('exports all mixins', async () => {
      const { withFs, withGit, withBash } = await import('../../full')
      expect(withFs).toBeDefined()
      expect(withGit).toBeDefined()
      expect(withBash).toBeDefined()
    })
  })

  describe('dotdo (default) - equals dotdo/full', () => {
    it('default export equals dotdo/full', async () => {
      const defaultExport = await import('../../index')
      const fullExport = await import('../../full')

      // The default DO should be the same as the full DO
      expect(defaultExport.DO).toBe(fullExport.DO)
    })

    it('default export has all capabilities', async () => {
      const { DO } = await import('../../index')
      expect(DO.prototype.hasCapability?.('fs')).toBe(true)
      expect(DO.prototype.hasCapability?.('git')).toBe(true)
      expect(DO.prototype.hasCapability?.('bash')).toBe(true)
    })
  })

  describe('capability detection', () => {
    it('hasCapability method exists on all DO classes', async () => {
      const { DO: TinyDO } = await import('../../tiny')
      const { DO: FsDO } = await import('../../fs')
      const { DO: GitDO } = await import('../../git')
      const { DO: BashDO } = await import('../../bash')
      const { DO: FullDO } = await import('../../full')

      // All DO classes should have hasCapability method
      expect(typeof TinyDO.prototype.hasCapability).toBe('function')
      expect(typeof FsDO.prototype.hasCapability).toBe('function')
      expect(typeof GitDO.prototype.hasCapability).toBe('function')
      expect(typeof BashDO.prototype.hasCapability).toBe('function')
      expect(typeof FullDO.prototype.hasCapability).toBe('function')
    })

    it('capabilities are correctly composed', async () => {
      const { DO: FullDO, withFs, withGit, withBash } = await import('../../full')
      const { DO: TinyDO } = await import('../../tiny')

      // Manually composing should yield same capabilities as FullDO
      class ManualFullDO extends withBash(withGit(withFs(TinyDO))) {}

      expect(ManualFullDO.prototype.hasCapability?.('fs')).toBe(true)
      expect(ManualFullDO.prototype.hasCapability?.('git')).toBe(true)
      expect(ManualFullDO.prototype.hasCapability?.('bash')).toBe(true)
    })
  })

  describe('tree-shaking verification', () => {
    it('tiny.ts does not import fsx', async () => {
      const tinyContent = readFileSync(join(PROJECT_ROOT, 'tiny.ts'), 'utf-8')
      expect(tinyContent).not.toMatch(/from ['"]fsx['"]/)
      expect(tinyContent).not.toMatch(/from ['"]gitx['"]/)
      expect(tinyContent).not.toMatch(/from ['"]bashx['"]/)
    })

    it('fs.ts does not import gitx or bashx', async () => {
      const fsContent = readFileSync(join(PROJECT_ROOT, 'fs.ts'), 'utf-8')
      expect(fsContent).not.toMatch(/from ['"]gitx['"]/)
      expect(fsContent).not.toMatch(/from ['"]bashx['"]/)
    })

    it('git.ts does not import bashx', async () => {
      const gitContent = readFileSync(join(PROJECT_ROOT, 'git.ts'), 'utf-8')
      expect(gitContent).not.toMatch(/from ['"]bashx['"]/)
    })

    it('bash.ts does not import gitx', async () => {
      const bashContent = readFileSync(join(PROJECT_ROOT, 'bash.ts'), 'utf-8')
      expect(bashContent).not.toMatch(/from ['"]gitx['"]/)
    })
  })
})
