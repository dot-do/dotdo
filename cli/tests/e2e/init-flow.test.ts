/**
 * E2E Tests: CLI Init Command Flow
 *
 * Tests the init command using real command execution.
 * Uses bun:test to match the existing cli/tests/commands.test.ts pattern.
 *
 * Verifies:
 * 1. Project scaffolding with various names
 * 2. Directory structure creation
 * 3. File content generation
 * 4. Error handling for invalid inputs
 * 5. Current directory initialization
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// ============================================================================
// Configuration
// ============================================================================

const CLI_PATH = path.join(import.meta.dir, '../../main.ts')

// ============================================================================
// Helpers
// ============================================================================

interface CLIResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Execute CLI command and capture output using spawn
 */
async function runCLI(
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {}
): Promise<CLIResult> {
  const { cwd = import.meta.dir, env = {} } = options

  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, ...env, CI: '1', NO_COLOR: '1' },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('exit', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 })
    })
  })
}

/**
 * Create a temporary directory for testing
 */
function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dotdo-e2e-${prefix}-`))
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(dir: string): void {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================================
// Init Command Help Tests
// ============================================================================

describe('E2E: Init Command', () => {
  describe('--help', () => {
    it('displays init help with --help flag', async () => {
      const result = await runCLI(['init', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('init')
      expect(result.stdout.toLowerCase()).toMatch(/project|initialize/)
    })

    it('shows available options', async () => {
      const result = await runCLI(['init', '--help'])

      expect(result.exitCode).toBe(0)
      // Should show template and git options based on main.ts
      expect(result.stdout).toContain('template')
    })
  })

  describe('project creation', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = createTempDir('init')
    })

    afterEach(() => {
      cleanupTempDir(tempDir)
    })

    it('creates a new project directory', async () => {
      const result = await runCLI(['init', 'test-project'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const projectDir = path.join(tempDir, 'test-project')
      expect(fs.existsSync(projectDir)).toBe(true)
    })

    it('creates src directory with index.ts', async () => {
      const result = await runCLI(['init', 'src-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const indexPath = path.join(tempDir, 'src-test', 'src', 'index.ts')
      expect(fs.existsSync(indexPath)).toBe(true)
    })

    it('creates package.json with correct name', async () => {
      const result = await runCLI(['init', 'pkg-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const pkgPath = path.join(tempDir, 'pkg-test', 'package.json')
      expect(fs.existsSync(pkgPath)).toBe(true)

      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.name).toBe('pkg-test')
    })

    it('creates wrangler.jsonc configuration', async () => {
      const result = await runCLI(['init', 'wrangler-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const wranglerPath = path.join(tempDir, 'wrangler-test', 'wrangler.jsonc')
      expect(fs.existsSync(wranglerPath)).toBe(true)

      const content = fs.readFileSync(wranglerPath, 'utf-8')
      expect(content).toContain('"name"')
      expect(content).toContain('wrangler-test')
    })

    it('creates tsconfig.json', async () => {
      const result = await runCLI(['init', 'ts-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const tsconfigPath = path.join(tempDir, 'ts-test', 'tsconfig.json')
      expect(fs.existsSync(tsconfigPath)).toBe(true)

      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'))
      expect(tsconfig.compilerOptions).toBeDefined()
    })

    it('prints success message after creation', async () => {
      const result = await runCLI(['init', 'success-msg-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toMatch(/success|created/)
    })

    it('prints next steps instructions', async () => {
      const result = await runCLI(['init', 'next-steps-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toLowerCase()).toContain('next')
      expect(result.stdout).toContain('npm')
    })
  })

  describe('project names', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = createTempDir('init-names')
    })

    afterEach(() => {
      cleanupTempDir(tempDir)
    })

    it('accepts kebab-case project names', async () => {
      const result = await runCLI(['init', 'my-cool-project'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)
      expect(fs.existsSync(path.join(tempDir, 'my-cool-project'))).toBe(true)
    })

    it('accepts project names with numbers', async () => {
      const result = await runCLI(['init', 'project123'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)
      expect(fs.existsSync(path.join(tempDir, 'project123'))).toBe(true)
    })

    it('accepts single word project names', async () => {
      const result = await runCLI(['init', 'startup'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)
      expect(fs.existsSync(path.join(tempDir, 'startup'))).toBe(true)
    })

    it('rejects project names starting with numbers', async () => {
      const result = await runCLI(['init', '123project'], { cwd: tempDir })

      expect(result.exitCode).not.toBe(0)
      expect((result.stdout + result.stderr).toLowerCase()).toMatch(/invalid|error/)
    })

    it('rejects project names with uppercase letters', async () => {
      const result = await runCLI(['init', 'MyProject'], { cwd: tempDir })

      expect(result.exitCode).not.toBe(0)
      expect((result.stdout + result.stderr).toLowerCase()).toMatch(/invalid|error/)
    })

    it('rejects project names with special characters', async () => {
      const result = await runCLI(['init', 'my@project'], { cwd: tempDir })

      expect(result.exitCode).not.toBe(0)
      expect((result.stdout + result.stderr).toLowerCase()).toMatch(/invalid|error/)
    })
  })

  describe('class name derivation', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = createTempDir('init-class')
    })

    afterEach(() => {
      cleanupTempDir(tempDir)
    })

    it('converts kebab-case to PascalCase in generated files', async () => {
      const result = await runCLI(['init', 'my-cool-app'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const indexPath = path.join(tempDir, 'my-cool-app', 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')

      // Should contain PascalCase class name
      expect(content).toContain('MyCoolApp')
    })

    it('capitalizes single word project names', async () => {
      const result = await runCLI(['init', 'startup'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const indexPath = path.join(tempDir, 'startup', 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')

      expect(content).toContain('Startup')
    })

    it('handles multiple hyphens correctly', async () => {
      const result = await runCLI(['init', 'my-super-cool-app'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const indexPath = path.join(tempDir, 'my-super-cool-app', 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')

      expect(content).toContain('MySuperCoolApp')
    })
  })

  describe('file content', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = createTempDir('init-content')
    })

    afterEach(() => {
      cleanupTempDir(tempDir)
    })

    it('generates index.ts with DO import', async () => {
      const result = await runCLI(['init', 'content-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const indexPath = path.join(tempDir, 'content-test', 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')

      expect(content).toContain('dotdo')
      expect(content).toContain('import')
    })

    it('generates index.ts with class extending DO', async () => {
      const result = await runCLI(['init', 'class-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const indexPath = path.join(tempDir, 'class-test', 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')

      expect(content).toMatch(/class\s+\w+\s+extends\s+DO/)
    })

    it('generates package.json with dotdo dependency', async () => {
      const result = await runCLI(['init', 'dep-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const pkgPath = path.join(tempDir, 'dep-test', 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

      expect(pkg.dependencies.dotdo).toBeDefined()
    })

    it('generates package.json with wrangler devDependency', async () => {
      const result = await runCLI(['init', 'wrangler-dep-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const pkgPath = path.join(tempDir, 'wrangler-dep-test', 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

      expect(pkg.devDependencies.wrangler).toBeDefined()
    })

    it('generates tsconfig.json with strict mode enabled', async () => {
      const result = await runCLI(['init', 'strict-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const tsconfigPath = path.join(tempDir, 'strict-test', 'tsconfig.json')
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'))

      expect(tsconfig.compilerOptions.strict).toBe(true)
    })

    it('generates wrangler.jsonc with durable_objects configuration', async () => {
      const result = await runCLI(['init', 'do-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const wranglerPath = path.join(tempDir, 'do-test', 'wrangler.jsonc')
      const content = fs.readFileSync(wranglerPath, 'utf-8')

      expect(content).toContain('durable_objects')
    })

    it('generates wrangler.jsonc with migrations', async () => {
      const result = await runCLI(['init', 'migrations-test'], { cwd: tempDir })

      expect(result.exitCode).toBe(0)

      const wranglerPath = path.join(tempDir, 'migrations-test', 'wrangler.jsonc')
      const content = fs.readFileSync(wranglerPath, 'utf-8')

      expect(content).toContain('migrations')
      expect(content).toContain('new_sqlite_classes')
    })
  })

  describe('error handling', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = createTempDir('init-errors')
    })

    afterEach(() => {
      cleanupTempDir(tempDir)
    })

    it('fails if directory already exists', async () => {
      // Create the directory first
      const existingDir = path.join(tempDir, 'existing-project')
      fs.mkdirSync(existingDir)

      const result = await runCLI(['init', 'existing-project'], { cwd: tempDir })

      expect(result.exitCode).not.toBe(0)
      expect((result.stdout + result.stderr).toLowerCase()).toMatch(/exists|already/)
    })

    it('shows helpful error for invalid options', async () => {
      const result = await runCLI(['init', 'test', '--invalid-option-xyz'], { cwd: tempDir })

      const output = result.stdout + result.stderr
      expect(output.toLowerCase()).toMatch(/unknown|error|option/)
    })
  })

  describe('current directory initialization', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = createTempDir('init-cwd')
    })

    afterEach(() => {
      cleanupTempDir(tempDir)
    })

    it('initializes in current directory with "." argument', async () => {
      // Create an empty directory
      const projectDir = path.join(tempDir, 'my-existing-dir')
      fs.mkdirSync(projectDir)

      const result = await runCLI(['init', '.'], { cwd: projectDir })

      expect(result.exitCode).toBe(0)
      expect(fs.existsSync(path.join(projectDir, 'src', 'index.ts'))).toBe(true)
    })

    it('uses directory name for class when initializing with "."', async () => {
      // Create an empty directory with kebab-case name
      const projectDir = path.join(tempDir, 'my-app-name')
      fs.mkdirSync(projectDir)

      const result = await runCLI(['init', '.'], { cwd: projectDir })

      expect(result.exitCode).toBe(0)

      const indexPath = path.join(projectDir, 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')

      // Should derive PascalCase from directory name
      expect(content).toContain('MyAppName')
    })

    it('uses directory name in package.json when initializing with "."', async () => {
      const projectDir = path.join(tempDir, 'dir-name-test')
      fs.mkdirSync(projectDir)

      const result = await runCLI(['init', '.'], { cwd: projectDir })

      expect(result.exitCode).toBe(0)

      const pkgPath = path.join(projectDir, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

      expect(pkg.name).toBe('dir-name-test')
    })
  })
})
