/**
 * Scaffold Utility Tests - TDD Red-Green-Refactor
 *
 * Tests for `cli/utils/scaffold.ts` which generates default files for new projects.
 *
 * Files to scaffold:
 * - `.do/.gitignore` (ignores state/, *.db, *.db-wal, *.db-shm)
 * - `.do/state/` (directory)
 * - `.do/tsconfig.json` (MDX/TSX intellisense)
 * - `.do/mdx.d.ts` (MDXUI component types)
 * - `App.tsx` (in root by default, simple starter template)
 * - `do.config.ts` (optional, with defineConfig)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Import the module under test
import { scaffold, ScaffoldOptions, ScaffoldResult } from '../utils/scaffold'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dotdo-scaffold-test-'))
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

// ============================================================================
// Scaffold Tests
// ============================================================================

describe('scaffold', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  // ==========================================================================
  // Basic Scaffolding
  // ==========================================================================

  describe('Basic Scaffolding', () => {
    it('creates .do directory', async () => {
      await scaffold({ targetDir: tempDir })

      const dotDoPath = path.join(tempDir, '.do')
      expect(fs.existsSync(dotDoPath)).toBe(true)
      expect(fs.statSync(dotDoPath).isDirectory()).toBe(true)
    })

    it('creates .do/state directory', async () => {
      await scaffold({ targetDir: tempDir })

      const statePath = path.join(tempDir, '.do', 'state')
      expect(fs.existsSync(statePath)).toBe(true)
      expect(fs.statSync(statePath).isDirectory()).toBe(true)
    })

    it('creates .do/.gitignore with correct patterns', async () => {
      await scaffold({ targetDir: tempDir })

      const gitignorePath = path.join(tempDir, '.do', '.gitignore')
      expect(fs.existsSync(gitignorePath)).toBe(true)

      const content = fs.readFileSync(gitignorePath, 'utf-8')
      expect(content).toContain('state/')
      expect(content).toContain('*.db')
      expect(content).toContain('*.db-wal')
      expect(content).toContain('*.db-shm')
    })

    it('creates .do/tsconfig.json for MDX/TSX intellisense', async () => {
      await scaffold({ targetDir: tempDir })

      const tsconfigPath = path.join(tempDir, '.do', 'tsconfig.json')
      expect(fs.existsSync(tsconfigPath)).toBe(true)

      const content = fs.readFileSync(tsconfigPath, 'utf-8')
      const tsconfig = JSON.parse(content)

      expect(tsconfig.compilerOptions).toBeDefined()
      expect(tsconfig.compilerOptions.jsx).toBe('react-jsx')
      expect(tsconfig.compilerOptions.jsxImportSource).toBe('react')
    })

    it('creates .do/mdx.d.ts with MDXUI component types', async () => {
      await scaffold({ targetDir: tempDir })

      const mdxDtsPath = path.join(tempDir, '.do', 'mdx.d.ts')
      expect(fs.existsSync(mdxDtsPath)).toBe(true)

      const content = fs.readFileSync(mdxDtsPath, 'utf-8')
      expect(content).toContain('declare module')
      expect(content).toContain('.mdx')
    })

    it('creates App.tsx in root with starter template', async () => {
      await scaffold({ targetDir: tempDir })

      const appPath = path.join(tempDir, 'App.tsx')
      expect(fs.existsSync(appPath)).toBe(true)

      const content = fs.readFileSync(appPath, 'utf-8')
      expect(content).toContain('export default')
      expect(content).toContain('function App')
    })

    it('creates do.config.ts with defineConfig', async () => {
      await scaffold({ targetDir: tempDir })

      const configPath = path.join(tempDir, 'do.config.ts')
      expect(fs.existsSync(configPath)).toBe(true)

      const content = fs.readFileSync(configPath, 'utf-8')
      expect(content).toContain('defineConfig')
      expect(content).toContain('export default')
    })
  })

  // ==========================================================================
  // Non-Destructive Behavior
  // ==========================================================================

  describe('Non-Destructive Behavior', () => {
    it('never overwrites existing .do/.gitignore', async () => {
      // Create existing file with custom content
      const dotDoPath = path.join(tempDir, '.do')
      fs.mkdirSync(dotDoPath, { recursive: true })
      const gitignorePath = path.join(dotDoPath, '.gitignore')
      const existingContent = '# Custom content\nmy-custom-ignore/'
      fs.writeFileSync(gitignorePath, existingContent)

      await scaffold({ targetDir: tempDir })

      const content = fs.readFileSync(gitignorePath, 'utf-8')
      expect(content).toBe(existingContent)
    })

    it('never overwrites existing .do/tsconfig.json', async () => {
      const dotDoPath = path.join(tempDir, '.do')
      fs.mkdirSync(dotDoPath, { recursive: true })
      const tsconfigPath = path.join(dotDoPath, 'tsconfig.json')
      const existingContent = '{"compilerOptions": {"custom": true}}'
      fs.writeFileSync(tsconfigPath, existingContent)

      await scaffold({ targetDir: tempDir })

      const content = fs.readFileSync(tsconfigPath, 'utf-8')
      expect(content).toBe(existingContent)
    })

    it('never overwrites existing .do/mdx.d.ts', async () => {
      const dotDoPath = path.join(tempDir, '.do')
      fs.mkdirSync(dotDoPath, { recursive: true })
      const mdxDtsPath = path.join(dotDoPath, 'mdx.d.ts')
      const existingContent = '// Custom MDX types'
      fs.writeFileSync(mdxDtsPath, existingContent)

      await scaffold({ targetDir: tempDir })

      const content = fs.readFileSync(mdxDtsPath, 'utf-8')
      expect(content).toBe(existingContent)
    })

    it('never overwrites existing App.tsx', async () => {
      const appPath = path.join(tempDir, 'App.tsx')
      const existingContent = 'export default function MyCustomApp() { return <div>Custom</div> }'
      fs.writeFileSync(appPath, existingContent)

      await scaffold({ targetDir: tempDir })

      const content = fs.readFileSync(appPath, 'utf-8')
      expect(content).toBe(existingContent)
    })

    it('never overwrites existing do.config.ts', async () => {
      const configPath = path.join(tempDir, 'do.config.ts')
      const existingContent = 'export default { custom: true }'
      fs.writeFileSync(configPath, existingContent)

      await scaffold({ targetDir: tempDir })

      const content = fs.readFileSync(configPath, 'utf-8')
      expect(content).toBe(existingContent)
    })

    it('reports which files were skipped', async () => {
      // Create some existing files
      const appPath = path.join(tempDir, 'App.tsx')
      fs.writeFileSync(appPath, 'existing')
      const configPath = path.join(tempDir, 'do.config.ts')
      fs.writeFileSync(configPath, 'existing')

      const result = await scaffold({ targetDir: tempDir })

      expect(result.skipped).toContain('App.tsx')
      expect(result.skipped).toContain('do.config.ts')
    })

    it('reports which files were created', async () => {
      const result = await scaffold({ targetDir: tempDir })

      expect(result.created).toContain('.do/.gitignore')
      expect(result.created).toContain('.do/tsconfig.json')
      expect(result.created).toContain('.do/mdx.d.ts')
      expect(result.created).toContain('App.tsx')
      expect(result.created).toContain('do.config.ts')
    })
  })

  // ==========================================================================
  // Options
  // ==========================================================================

  describe('Options', () => {
    it('accepts custom target directory', async () => {
      const customDir = path.join(tempDir, 'custom-project')
      fs.mkdirSync(customDir)

      await scaffold({ targetDir: customDir })

      expect(fs.existsSync(path.join(customDir, '.do'))).toBe(true)
      expect(fs.existsSync(path.join(customDir, 'App.tsx'))).toBe(true)
    })

    it('allows skipping App.tsx creation', async () => {
      await scaffold({ targetDir: tempDir, skipApp: true })

      expect(fs.existsSync(path.join(tempDir, 'App.tsx'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, '.do'))).toBe(true)
    })

    it('allows skipping do.config.ts creation', async () => {
      await scaffold({ targetDir: tempDir, skipConfig: true })

      expect(fs.existsSync(path.join(tempDir, 'do.config.ts'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, '.do'))).toBe(true)
    })

    it('uses custom app file path when specified', async () => {
      await scaffold({ targetDir: tempDir, appPath: 'src/App.tsx' })

      const srcDir = path.join(tempDir, 'src')
      expect(fs.existsSync(path.join(srcDir, 'App.tsx'))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, 'App.tsx'))).toBe(false)
    })
  })

  // ==========================================================================
  // Template Content Validation
  // ==========================================================================

  describe('Template Content Validation', () => {
    it('.gitignore ignores SQLite WAL files', async () => {
      await scaffold({ targetDir: tempDir })

      const content = fs.readFileSync(path.join(tempDir, '.do', '.gitignore'), 'utf-8')
      expect(content).toContain('*.db-wal')
      expect(content).toContain('*.db-shm')
    })

    it('tsconfig.json has correct module settings', async () => {
      await scaffold({ targetDir: tempDir })

      const content = fs.readFileSync(path.join(tempDir, '.do', 'tsconfig.json'), 'utf-8')
      const tsconfig = JSON.parse(content)

      expect(tsconfig.compilerOptions.module).toBeDefined()
      expect(tsconfig.compilerOptions.moduleResolution).toBeDefined()
    })

    it('App.tsx is valid TSX syntax', async () => {
      await scaffold({ targetDir: tempDir })

      const content = fs.readFileSync(path.join(tempDir, 'App.tsx'), 'utf-8')

      // Check for balanced braces
      const openBraces = (content.match(/{/g) || []).length
      const closeBraces = (content.match(/}/g) || []).length
      expect(openBraces).toBe(closeBraces)

      // Check for balanced parentheses
      const openParens = (content.match(/\(/g) || []).length
      const closeParens = (content.match(/\)/g) || []).length
      expect(openParens).toBe(closeParens)
    })

    it('do.config.ts imports defineConfig correctly', async () => {
      await scaffold({ targetDir: tempDir })

      const content = fs.readFileSync(path.join(tempDir, 'do.config.ts'), 'utf-8')
      expect(content).toContain('import')
      expect(content).toContain('defineConfig')
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('creates parent directories if they do not exist', async () => {
      const nestedDir = path.join(tempDir, 'a', 'b', 'c')

      await scaffold({ targetDir: nestedDir })

      expect(fs.existsSync(nestedDir)).toBe(true)
      expect(fs.existsSync(path.join(nestedDir, '.do'))).toBe(true)
    })

    it('handles .do directory already existing', async () => {
      const dotDoPath = path.join(tempDir, '.do')
      fs.mkdirSync(dotDoPath)

      // Should not throw
      await expect(scaffold({ targetDir: tempDir })).resolves.not.toThrow()
    })

    it('handles .do/state directory already existing', async () => {
      const statePath = path.join(tempDir, '.do', 'state')
      fs.mkdirSync(statePath, { recursive: true })

      // Should not throw
      await expect(scaffold({ targetDir: tempDir })).resolves.not.toThrow()
    })
  })
})

// ============================================================================
// Module Export Tests
// ============================================================================

describe('Scaffold Module', () => {
  it('exports a scaffold function', async () => {
    expect(scaffold).toBeDefined()
    expect(typeof scaffold).toBe('function')
  })

  it('scaffold function is async', async () => {
    const tempDir = createTempDir()

    try {
      const result = scaffold({ targetDir: tempDir })
      expect(result).toBeInstanceOf(Promise)
      await result
    } finally {
      cleanupTempDir(tempDir)
    }
  })
})
