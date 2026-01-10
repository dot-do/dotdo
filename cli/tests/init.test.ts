/**
 * Init Command Tests - RED Phase (TDD)
 *
 * Tests for `npx dotdo init` command that scaffolds a new project.
 * These tests are expected to FAIL until the command is implemented.
 *
 * The init command will:
 * 1. Create a new directory with the project name
 * 2. Generate a basic Startup class template (src/index.ts)
 * 3. Generate wrangler.jsonc configuration
 * 4. Generate package.json with dependencies
 * 5. Optionally initialize git repository
 *
 * Implementation will be in: cli/commands/init.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dotdo-init-test-'))
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

/**
 * Capture console output for assertions
 */
function captureConsole() {
  const logs: string[] = []
  const errors: string[] = []
  const originalLog = console.log
  const originalError = console.error

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  }

  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog
      console.error = originalError
    },
  }
}

// ============================================================================
// Init Command Tests
// ============================================================================

describe('do init', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  // ==========================================================================
  // Basic Project Scaffolding
  // ==========================================================================

  describe('Project Scaffolding', () => {
    it('creates a new project directory with the given name', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'my-startup'
      const projectPath = path.join(tempDir, projectName)

      await run([projectName], { cwd: tempDir })

      expect(fs.existsSync(projectPath)).toBe(true)
      expect(fs.statSync(projectPath).isDirectory()).toBe(true)
    })

    it('creates src directory', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'my-startup'
      const srcPath = path.join(tempDir, projectName, 'src')

      await run([projectName], { cwd: tempDir })

      expect(fs.existsSync(srcPath)).toBe(true)
      expect(fs.statSync(srcPath).isDirectory()).toBe(true)
    })

    it('creates src/index.ts with Startup class template', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'my-startup'
      const indexPath = path.join(tempDir, projectName, 'src', 'index.ts')

      await run([projectName], { cwd: tempDir })

      expect(fs.existsSync(indexPath)).toBe(true)
      const content = fs.readFileSync(indexPath, 'utf-8')

      // Should import from dotdo
      expect(content).toContain("import")
      expect(content).toContain("dotdo")

      // Should export a class extending DO or Startup
      expect(content).toMatch(/export\s+(default\s+)?class/)
      expect(content).toMatch(/extends\s+(DO|Startup)/)
    })

    it('creates wrangler.jsonc with proper configuration', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'my-startup'
      const wranglerPath = path.join(tempDir, projectName, 'wrangler.jsonc')

      await run([projectName], { cwd: tempDir })

      expect(fs.existsSync(wranglerPath)).toBe(true)
      const content = fs.readFileSync(wranglerPath, 'utf-8')

      // Should be valid JSONC (we'll check key fields)
      expect(content).toContain('"name"')
      expect(content).toContain(projectName)
      expect(content).toContain('"compatibility_flags"')
      expect(content).toContain('nodejs_compat')
      expect(content).toContain('"durable_objects"')
    })

    it('creates package.json with dotdo dependency', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'my-startup'
      const packagePath = path.join(tempDir, projectName, 'package.json')

      await run([projectName], { cwd: tempDir })

      expect(fs.existsSync(packagePath)).toBe(true)
      const content = fs.readFileSync(packagePath, 'utf-8')
      const pkg = JSON.parse(content)

      expect(pkg.name).toBe(projectName)
      expect(pkg.dependencies).toBeDefined()
      expect(pkg.dependencies.dotdo).toBeDefined()
      expect(pkg.devDependencies).toBeDefined()
      expect(pkg.devDependencies.wrangler).toBeDefined()
    })

    it('creates tsconfig.json', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'my-startup'
      const tsconfigPath = path.join(tempDir, projectName, 'tsconfig.json')

      await run([projectName], { cwd: tempDir })

      expect(fs.existsSync(tsconfigPath)).toBe(true)
      const content = fs.readFileSync(tsconfigPath, 'utf-8')
      const tsconfig = JSON.parse(content)

      expect(tsconfig.compilerOptions).toBeDefined()
      expect(tsconfig.compilerOptions.strict).toBe(true)
    })
  })

  // ==========================================================================
  // Package.json Validation
  // ==========================================================================

  describe('Package.json Validation', () => {
    it('generates valid package.json with required scripts', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'my-startup'
      const packagePath = path.join(tempDir, projectName, 'package.json')

      await run([projectName], { cwd: tempDir })

      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))

      expect(pkg.scripts).toBeDefined()
      expect(pkg.scripts.dev).toBeDefined()
      expect(pkg.scripts.deploy).toBeDefined()
    })

    it('sets package.json as private by default', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'my-startup'
      const packagePath = path.join(tempDir, projectName, 'package.json')

      await run([projectName], { cwd: tempDir })

      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))
      expect(pkg.private).toBe(true)
    })

    it('sets module type in package.json', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'my-startup'
      const packagePath = path.join(tempDir, projectName, 'package.json')

      await run([projectName], { cwd: tempDir })

      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))
      expect(pkg.type).toBe('module')
    })
  })

  // ==========================================================================
  // Generated Code Compilation
  // ==========================================================================

  describe('Generated Code Quality', () => {
    it('generates syntactically valid TypeScript in src/index.ts', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'my-startup'
      const indexPath = path.join(tempDir, projectName, 'src', 'index.ts')

      await run([projectName], { cwd: tempDir })

      const content = fs.readFileSync(indexPath, 'utf-8')

      // Basic syntax checks
      expect(content).not.toContain('undefined')
      expect(content).not.toContain('TODO')

      // Should be properly formatted
      expect(content.trim().length).toBeGreaterThan(0)

      // Should not have obvious syntax errors (balanced braces)
      const openBraces = (content.match(/{/g) || []).length
      const closeBraces = (content.match(/}/g) || []).length
      expect(openBraces).toBe(closeBraces)
    })

    it('uses proper class name derived from project name', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'my-awesome-startup'
      const indexPath = path.join(tempDir, projectName, 'src', 'index.ts')

      await run([projectName], { cwd: tempDir })

      const content = fs.readFileSync(indexPath, 'utf-8')

      // Should convert kebab-case to PascalCase
      expect(content).toContain('MyAwesomeStartup')
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('throws error if project directory already exists', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectName = 'existing-project'
      const projectPath = path.join(tempDir, projectName)

      // Create the directory first
      fs.mkdirSync(projectPath)

      await expect(run([projectName], { cwd: tempDir })).rejects.toThrow(/already exists/)
    })

    it('throws error if no project name provided', async () => {
      const { run } = await import('../../cli/commands/init')

      await expect(run([], { cwd: tempDir })).rejects.toThrow(/project name/)
    })

    it('throws error for invalid project name (starts with number)', async () => {
      const { run } = await import('../../cli/commands/init')

      await expect(run(['123invalid'], { cwd: tempDir })).rejects.toThrow(/invalid.*name/i)
    })

    it('throws error for invalid project name (contains special chars)', async () => {
      const { run } = await import('../../cli/commands/init')

      await expect(run(['my@project!'], { cwd: tempDir })).rejects.toThrow(/invalid.*name/i)
    })
  })

  // ==========================================================================
  // CLI Output
  // ==========================================================================

  describe('CLI Output', () => {
    it('prints success message after creating project', async () => {
      const output = captureConsole()

      try {
        const { run } = await import('../../cli/commands/init')
        const projectName = 'my-startup'

        await run([projectName], { cwd: tempDir })

        expect(output.logs.some(log =>
          log.toLowerCase().includes('created') ||
          log.toLowerCase().includes('success')
        )).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints next steps after creating project', async () => {
      const output = captureConsole()

      try {
        const { run } = await import('../../cli/commands/init')
        const projectName = 'my-startup'

        await run([projectName], { cwd: tempDir })

        // Should suggest cd, npm install, npm run dev
        expect(output.logs.some(log => log.includes('cd'))).toBe(true)
        expect(output.logs.some(log =>
          log.includes('npm install') ||
          log.includes('pnpm install') ||
          log.includes('bun install')
        )).toBe(true)
      } finally {
        output.restore()
      }
    })
  })

  // ==========================================================================
  // Initialize in Current Directory
  // ==========================================================================

  describe('Initialize in Current Directory', () => {
    it('initializes in current directory with "." argument', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectDir = path.join(tempDir, 'empty-project')
      fs.mkdirSync(projectDir)

      await run(['.'], { cwd: projectDir })

      expect(fs.existsSync(path.join(projectDir, 'src', 'index.ts'))).toBe(true)
      expect(fs.existsSync(path.join(projectDir, 'wrangler.jsonc'))).toBe(true)
      expect(fs.existsSync(path.join(projectDir, 'package.json'))).toBe(true)
    })

    it('uses directory name for class name when initializing with "."', async () => {
      const { run } = await import('../../cli/commands/init')
      const projectDir = path.join(tempDir, 'my-cool-project')
      fs.mkdirSync(projectDir)

      await run(['.'], { cwd: projectDir })

      const content = fs.readFileSync(path.join(projectDir, 'src', 'index.ts'), 'utf-8')
      expect(content).toContain('MyCoolProject')
    })
  })
})

// ============================================================================
// Module Export Tests
// ============================================================================

describe('Init Command Module', () => {
  it('exports a run function', async () => {
    const initModule = await import('../../cli/commands/init')

    expect(initModule.run).toBeDefined()
    expect(typeof initModule.run).toBe('function')
  })

  it('run function is async', async () => {
    const initModule = await import('../../cli/commands/init')
    const tempDir = createTempDir()

    try {
      // Check that run returns a Promise
      const result = initModule.run(['test-project'], { cwd: tempDir })
      expect(result).toBeInstanceOf(Promise)
      await result
    } finally {
      cleanupTempDir(tempDir)
    }
  })

  it('exports command metadata', async () => {
    const initModule = await import('../../cli/commands/init')

    expect(initModule.name).toBe('init')
    expect(initModule.description).toBeDefined()
    expect(typeof initModule.description).toBe('string')
  })
})
