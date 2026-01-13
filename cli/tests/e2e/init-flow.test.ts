/**
 * E2E Tests: CLI Init Command Flow
 *
 * Tests the init command using real command execution.
 * Verifies:
 * 1. Project scaffolding with various names
 * 2. Directory structure creation
 * 3. File content generation
 * 4. Error handling for invalid inputs
 * 5. Current directory initialization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// ============================================================================
// Configuration
// ============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '../../..')
const CLI_BIN = join(PROJECT_ROOT, 'cli/bin.ts')

// ============================================================================
// Helpers
// ============================================================================

interface CLIResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Execute CLI command and capture output
 */
function execCLI(
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}
): CLIResult {
  const { cwd = PROJECT_ROOT, env = {}, timeout = 30000 } = options

  try {
    const fullCommand = `bun run ${CLI_BIN} ${args.join(' ')}`
    const stdout = execSync(fullCommand, {
      cwd,
      env: { ...process.env, ...env, CI: '1', NO_COLOR: '1' },
      timeout,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return { stdout, stderr: '', exitCode: 0 }
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || '',
      exitCode: execError.status || 1,
    }
  }
}

/**
 * Create a temporary directory for testing
 */
function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `dotdo-e2e-${prefix}-`))
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(dir: string): void {
  if (dir && existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================================
// Init Command Help Tests
// ============================================================================

describe('E2E: Init Command Help', () => {
  it('displays init help with --help flag', () => {
    const result = execCLI(['init', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('init')
    expect(result.stdout.toLowerCase()).toMatch(/project|initialize/)
  })

  it('shows available options', () => {
    const result = execCLI(['init', '--help'])

    expect(result.exitCode).toBe(0)
    // Should show template and git options based on main.ts
    expect(result.stdout).toContain('template')
  })
})

// ============================================================================
// Init Command Project Creation Tests
// ============================================================================

describe('E2E: Init Command Project Creation', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir('init')
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it('creates a new project directory', () => {
    const result = execCLI(['init', 'test-project'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const projectDir = join(tempDir, 'test-project')
    expect(existsSync(projectDir)).toBe(true)
  })

  it('creates src directory with index.ts', () => {
    const result = execCLI(['init', 'src-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const indexPath = join(tempDir, 'src-test', 'src', 'index.ts')
    expect(existsSync(indexPath)).toBe(true)
  })

  it('creates package.json with correct name', () => {
    const result = execCLI(['init', 'pkg-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const pkgPath = join(tempDir, 'pkg-test', 'package.json')
    expect(existsSync(pkgPath)).toBe(true)

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    expect(pkg.name).toBe('pkg-test')
  })

  it('creates wrangler.jsonc configuration', () => {
    const result = execCLI(['init', 'wrangler-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const wranglerPath = join(tempDir, 'wrangler-test', 'wrangler.jsonc')
    expect(existsSync(wranglerPath)).toBe(true)

    const content = readFileSync(wranglerPath, 'utf-8')
    expect(content).toContain('"name"')
    expect(content).toContain('wrangler-test')
  })

  it('creates tsconfig.json', () => {
    const result = execCLI(['init', 'ts-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const tsconfigPath = join(tempDir, 'ts-test', 'tsconfig.json')
    expect(existsSync(tsconfigPath)).toBe(true)

    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))
    expect(tsconfig.compilerOptions).toBeDefined()
  })

  it('prints success message after creation', () => {
    const result = execCLI(['init', 'success-msg-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toMatch(/success|created/)
  })

  it('prints next steps instructions', () => {
    const result = execCLI(['init', 'next-steps-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('next')
    expect(result.stdout).toContain('npm')
  })
})

// ============================================================================
// Init Command Project Name Tests
// ============================================================================

describe('E2E: Init Command Project Names', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir('init-names')
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it('accepts kebab-case project names', () => {
    const result = execCLI(['init', 'my-cool-project'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(tempDir, 'my-cool-project'))).toBe(true)
  })

  it('accepts project names with numbers', () => {
    const result = execCLI(['init', 'project123'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(tempDir, 'project123'))).toBe(true)
  })

  it('accepts single word project names', () => {
    const result = execCLI(['init', 'startup'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(tempDir, 'startup'))).toBe(true)
  })

  it('rejects project names starting with numbers', () => {
    const result = execCLI(['init', '123project'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect((result.stdout + result.stderr).toLowerCase()).toMatch(/invalid|error/)
  })

  it('rejects project names with uppercase letters', () => {
    const result = execCLI(['init', 'MyProject'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect((result.stdout + result.stderr).toLowerCase()).toMatch(/invalid|error/)
  })

  it('rejects project names with special characters', () => {
    const result = execCLI(['init', 'my@project'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect((result.stdout + result.stderr).toLowerCase()).toMatch(/invalid|error/)
  })

  it('requires project name argument', () => {
    const result = execCLI(['init'], { cwd: tempDir })

    // Should fail or show help when no project name provided
    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toMatch(/name|usage|error|argument/)
  })
})

// ============================================================================
// Init Command Class Name Derivation Tests
// ============================================================================

describe('E2E: Init Command Class Name Derivation', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir('init-class')
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it('converts kebab-case to PascalCase in generated files', () => {
    const result = execCLI(['init', 'my-cool-app'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const indexPath = join(tempDir, 'my-cool-app', 'src', 'index.ts')
    const content = readFileSync(indexPath, 'utf-8')

    // Should contain PascalCase class name
    expect(content).toContain('MyCoolApp')
  })

  it('capitalizes single word project names', () => {
    const result = execCLI(['init', 'startup'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const indexPath = join(tempDir, 'startup', 'src', 'index.ts')
    const content = readFileSync(indexPath, 'utf-8')

    expect(content).toContain('Startup')
  })

  it('handles multiple hyphens correctly', () => {
    const result = execCLI(['init', 'my-super-cool-app'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const indexPath = join(tempDir, 'my-super-cool-app', 'src', 'index.ts')
    const content = readFileSync(indexPath, 'utf-8')

    expect(content).toContain('MySuperCoolApp')
  })
})

// ============================================================================
// Init Command File Content Tests
// ============================================================================

describe('E2E: Init Command File Content', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir('init-content')
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it('generates index.ts with DO import', () => {
    const result = execCLI(['init', 'content-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const indexPath = join(tempDir, 'content-test', 'src', 'index.ts')
    const content = readFileSync(indexPath, 'utf-8')

    expect(content).toContain('dotdo')
    expect(content).toContain('import')
  })

  it('generates index.ts with class extending DO', () => {
    const result = execCLI(['init', 'class-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const indexPath = join(tempDir, 'class-test', 'src', 'index.ts')
    const content = readFileSync(indexPath, 'utf-8')

    expect(content).toMatch(/class\s+\w+\s+extends\s+DO/)
  })

  it('generates package.json with dotdo dependency', () => {
    const result = execCLI(['init', 'dep-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const pkgPath = join(tempDir, 'dep-test', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

    expect(pkg.dependencies.dotdo).toBeDefined()
  })

  it('generates package.json with wrangler devDependency', () => {
    const result = execCLI(['init', 'wrangler-dep-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const pkgPath = join(tempDir, 'wrangler-dep-test', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

    expect(pkg.devDependencies.wrangler).toBeDefined()
  })

  it('generates package.json with dev and deploy scripts', () => {
    const result = execCLI(['init', 'scripts-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const pkgPath = join(tempDir, 'scripts-test', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

    expect(pkg.scripts.dev).toBeDefined()
    expect(pkg.scripts.deploy).toBeDefined()
  })

  it('generates tsconfig.json with strict mode enabled', () => {
    const result = execCLI(['init', 'strict-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const tsconfigPath = join(tempDir, 'strict-test', 'tsconfig.json')
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))

    expect(tsconfig.compilerOptions.strict).toBe(true)
  })

  it('generates wrangler.jsonc with durable_objects configuration', () => {
    const result = execCLI(['init', 'do-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const wranglerPath = join(tempDir, 'do-test', 'wrangler.jsonc')
    const content = readFileSync(wranglerPath, 'utf-8')

    expect(content).toContain('durable_objects')
  })

  it('generates wrangler.jsonc with migrations', () => {
    const result = execCLI(['init', 'migrations-test'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)

    const wranglerPath = join(tempDir, 'migrations-test', 'wrangler.jsonc')
    const content = readFileSync(wranglerPath, 'utf-8')

    expect(content).toContain('migrations')
    expect(content).toContain('new_sqlite_classes')
  })
})

// ============================================================================
// Init Command Error Handling Tests
// ============================================================================

describe('E2E: Init Command Error Handling', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir('init-errors')
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it('fails if directory already exists', () => {
    // Create the directory first
    const existingDir = join(tempDir, 'existing-project')
    mkdirSync(existingDir)

    const result = execCLI(['init', 'existing-project'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect((result.stdout + result.stderr).toLowerCase()).toMatch(/exists|already/)
  })

  it('shows helpful error for invalid options', () => {
    const result = execCLI(['init', 'test', '--invalid-option-xyz'], { cwd: tempDir })

    const output = result.stdout + result.stderr
    expect(output.toLowerCase()).toMatch(/unknown|error|option/)
  })
})

// ============================================================================
// Init Command Current Directory Tests
// ============================================================================

describe('E2E: Init Command Current Directory', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir('init-cwd')
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it('initializes in current directory with "." argument', () => {
    // Create an empty directory
    const projectDir = join(tempDir, 'my-existing-dir')
    mkdirSync(projectDir)

    const result = execCLI(['init', '.'], { cwd: projectDir })

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(projectDir, 'src', 'index.ts'))).toBe(true)
  })

  it('uses directory name for class when initializing with "."', () => {
    // Create an empty directory with kebab-case name
    const projectDir = join(tempDir, 'my-app-name')
    mkdirSync(projectDir)

    const result = execCLI(['init', '.'], { cwd: projectDir })

    expect(result.exitCode).toBe(0)

    const indexPath = join(projectDir, 'src', 'index.ts')
    const content = readFileSync(indexPath, 'utf-8')

    // Should derive PascalCase from directory name
    expect(content).toContain('MyAppName')
  })

  it('uses directory name in package.json when initializing with "."', () => {
    const projectDir = join(tempDir, 'dir-name-test')
    mkdirSync(projectDir)

    const result = execCLI(['init', '.'], { cwd: projectDir })

    expect(result.exitCode).toBe(0)

    const pkgPath = join(projectDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

    expect(pkg.name).toBe('dir-name-test')
  })
})
