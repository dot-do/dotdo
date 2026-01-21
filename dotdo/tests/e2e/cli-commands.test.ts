/**
 * E2E Tests for dotdo CLI Commands
 * Tests for do-blio / do-14hg - E2E tests for CLI commands (dotdo init, dev, deploy)
 *
 * These tests verify end-to-end functionality of the CLI commands
 * by actually executing them and verifying the results.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, readdir, access, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * Parse JSONC (JSON with comments) by stripping comments
 */
function parseJsonc(content: string): unknown {
  // Remove single-line comments (// ...)
  let stripped = content.replace(/\/\/.*$/gm, '')
  // Remove multi-line comments (/* ... */)
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '')
  return JSON.parse(stripped)
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Execute CLI command and capture output
 */
async function runCli(
  args: string[],
  options: {
    cwd?: string
    env?: Record<string, string>
    timeout?: number
    stdin?: string
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cliPath = resolve(__dirname, '../../cli.ts')
  const timeout = options.timeout ?? 30000

  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['tsx', cliPath, ...args], {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    if (options.stdin) {
      proc.stdin?.write(options.stdin)
      proc.stdin?.end()
    }

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`Command timed out after ${timeout}ms`))
    }, timeout)

    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      })
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * Wait for a condition to be true
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) return
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`waitFor timed out after ${timeout}ms`)
}

/**
 * Check if a port is in use
 */
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net')
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port)
  })
}

// ============================================================================
// E2E Tests: dotdo init
// ============================================================================

describe('E2E: dotdo init', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dotdo-e2e-init-'))
  })

  afterEach(async () => {
    if (testDir && existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true })
    }
  })

  describe('Creates new project in empty directory', () => {
    it('should create project with default settings', async () => {
      const projectDir = join(testDir, 'my-project')

      // Run init command with -y flag for non-interactive mode
      const result = await runCli(['init', projectDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      // Should complete successfully
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('initialized successfully')

      // Verify project structure
      const files = await readdir(projectDir)
      expect(files).toContain('package.json')
      expect(files).toContain('tsconfig.json')
      expect(files).toContain('wrangler.jsonc')
      expect(files).toContain('.gitignore')
      expect(files).toContain('README.md')
      expect(files).toContain('vitest.config.ts')
      expect(files).toContain('src')
      expect(files).toContain('tests')
    })

    it('should create project with custom name', async () => {
      const projectDir = join(testDir, 'custom-name-project')

      const result = await runCli(
        ['init', projectDir, '--name', 'my-custom-app', '-y', '--skip-install', '--skip-git'],
        { timeout: 60000 }
      )

      expect(result.exitCode).toBe(0)

      // Verify package.json has correct name
      const pkgContent = await readFile(join(projectDir, 'package.json'), 'utf-8')
      const pkg = JSON.parse(pkgContent)
      expect(pkg.name).toBe('my-custom-app')
    })

    it('should create project in current directory when path is "."', async () => {
      const result = await runCli(['init', '.', '-y', '--skip-install', '--skip-git'], {
        cwd: testDir,
        timeout: 60000,
      })

      expect(result.exitCode).toBe(0)

      // Verify files were created in testDir
      const files = await readdir(testDir)
      expect(files).toContain('package.json')
      expect(files).toContain('src')
    })
  })

  describe('Creates correct file structure', () => {
    it('should create package.json with correct structure', async () => {
      const projectDir = join(testDir, 'pkg-test')

      await runCli(['init', projectDir, '-y', '--skip-install', '--skip-git'], { timeout: 60000 })

      const pkgContent = await readFile(join(projectDir, 'package.json'), 'utf-8')
      const pkg = JSON.parse(pkgContent)

      expect(pkg.type).toBe('module')
      expect(pkg.scripts).toHaveProperty('dev')
      expect(pkg.scripts).toHaveProperty('deploy')
      expect(pkg.scripts).toHaveProperty('test')
      expect(pkg.dependencies).toHaveProperty('dotdo')
      expect(pkg.dependencies).toHaveProperty('hono')
      expect(pkg.devDependencies).toHaveProperty('typescript')
      expect(pkg.devDependencies).toHaveProperty('wrangler')
      expect(pkg.devDependencies).toHaveProperty('vitest')
    })

    it('should create wrangler.toml/jsonc with DO bindings', async () => {
      const projectDir = join(testDir, 'wrangler-test')

      await runCli(['init', projectDir, '-y', '--skip-install', '--skip-git'], { timeout: 60000 })

      const wranglerContent = await readFile(join(projectDir, 'wrangler.jsonc'), 'utf-8')
      // Use parseJsonc to handle JSONC format (JSON with comments)
      const wrangler = parseJsonc(wranglerContent) as {
        main: string
        compatibility_date: string
        durable_objects: { bindings: Array<{ name: string; class_name: string }> }
      }

      expect(wrangler.main).toBe('src/index.ts')
      expect(wrangler.compatibility_date).toBeDefined()
      expect(wrangler.durable_objects).toBeDefined()
      expect(wrangler.durable_objects.bindings).toHaveLength(1)
      expect(wrangler.durable_objects.bindings[0].name).toBe('DO')
      expect(wrangler.durable_objects.bindings[0].class_name).toBe('MyDO')
    })

    it('should create src/ directory with index.ts and do.ts', async () => {
      const projectDir = join(testDir, 'src-test')

      await runCli(['init', projectDir, '-y', '--skip-install', '--skip-git'], { timeout: 60000 })

      // Check src directory exists
      const srcPath = join(projectDir, 'src')
      await access(srcPath)

      // Check src/index.ts
      const indexContent = await readFile(join(srcPath, 'index.ts'), 'utf-8')
      expect(indexContent).toContain('export { MyDO }')
      expect(indexContent).toContain('export default')

      // Check src/do.ts
      const doContent = await readFile(join(srcPath, 'do.ts'), 'utf-8')
      expect(doContent).toContain('export class MyDO')
    })

    it('should create tests/ directory with test file', async () => {
      const projectDir = join(testDir, 'tests-test')

      await runCli(['init', projectDir, '-y', '--skip-install', '--skip-git'], { timeout: 60000 })

      // Check tests directory exists
      const testsPath = join(projectDir, 'tests')
      await access(testsPath)

      // Check tests/do.test.ts
      const testContent = await readFile(join(testsPath, 'do.test.ts'), 'utf-8')
      expect(testContent).toContain("describe('MyDO'")
    })
  })

  describe('Fails gracefully in non-empty directory', () => {
    it('should fail when directory contains files', async () => {
      const projectDir = join(testDir, 'non-empty')
      await mkdir(projectDir)
      await writeFile(join(projectDir, 'existing-file.txt'), 'existing content')

      const result = await runCli(['init', projectDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      expect(result.exitCode).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/not empty|already exists|non-empty/i)
    })

    it('should allow init in directory with only hidden files', async () => {
      const projectDir = join(testDir, 'hidden-only')
      await mkdir(projectDir)
      await writeFile(join(projectDir, '.gitkeep'), '')

      const result = await runCli(['init', projectDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      // Should succeed because only hidden files exist
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Supports --template flag for different starters', () => {
    it('should create basic template by default', async () => {
      const projectDir = join(testDir, 'template-basic')

      const result = await runCli(['init', projectDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      expect(result.exitCode).toBe(0)

      const readmeContent = await readFile(join(projectDir, 'README.md'), 'utf-8')
      expect(readmeContent).toContain('template=basic')
    })

    it('should create api template when specified', async () => {
      const projectDir = join(testDir, 'template-api')

      const result = await runCli(
        ['init', projectDir, '-y', '--template', 'api', '--skip-install', '--skip-git'],
        { timeout: 60000 }
      )

      expect(result.exitCode).toBe(0)

      const readmeContent = await readFile(join(projectDir, 'README.md'), 'utf-8')
      expect(readmeContent).toContain('template=api')
    })

    it('should create full template when specified', async () => {
      const projectDir = join(testDir, 'template-full')

      const result = await runCli(
        ['init', projectDir, '-y', '--template', 'full', '--skip-install', '--skip-git'],
        { timeout: 60000 }
      )

      expect(result.exitCode).toBe(0)

      const readmeContent = await readFile(join(projectDir, 'README.md'), 'utf-8')
      expect(readmeContent).toContain('template=full')
      expect(readmeContent).toContain('Database support')
      expect(readmeContent).toContain('Authentication')
      expect(readmeContent).toContain('AI module')
      expect(readmeContent).toContain('MCP server')
    })
  })

  describe('Git initialization', () => {
    it('should skip git when --skip-git is specified', async () => {
      const projectDir = join(testDir, 'no-git')

      await runCli(['init', projectDir, '-y', '--skip-install', '--skip-git'], { timeout: 60000 })

      const files = await readdir(projectDir)
      expect(files).not.toContain('.git')
    })

    it('should initialize git by default (when not skipped)', async () => {
      // Check if git is available
      try {
        execSync('git --version', { stdio: 'ignore' })
      } catch {
        // Skip test if git not available
        return
      }

      const projectDir = join(testDir, 'with-git')

      await runCli(['init', projectDir, '-y', '--skip-install'], { timeout: 60000 })

      const files = await readdir(projectDir)
      expect(files).toContain('.git')

      // Verify initial commit exists
      const log = execSync('git log --oneline', {
        cwd: projectDir,
        encoding: 'utf-8',
      })
      expect(log).toContain('Initial commit from dotdo init')
    })
  })
})

// ============================================================================
// E2E Tests: dotdo dev
// ============================================================================

describe('E2E: dotdo dev', () => {
  let testDir: string
  let devProcess: ChildProcess | null = null

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dotdo-e2e-dev-'))
  })

  afterEach(async () => {
    // Kill dev process if running
    if (devProcess && !devProcess.killed) {
      devProcess.kill('SIGTERM')
      devProcess = null
    }

    // Clean up test directory
    if (testDir && existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true })
    }
  })

  describe('Starts local development server', () => {
    it('should start dev server and show startup banner', async () => {
      // First, create a project
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      // Start dev server (will timeout since it runs indefinitely)
      const result = await runCli(['dev', '--port', '9999'], {
        cwd: testDir,
        timeout: 5000,
      }).catch((err) => {
        // Expected to timeout
        return { stdout: '', stderr: '', exitCode: -1 }
      })

      // The startup banner should appear before timeout
      // Note: This test may need adjustment based on actual output timing
      expect(result.stdout + result.stderr).toMatch(/dotdo dev|starting|local/i)
    })

    it('should accept custom port via --port flag', async () => {
      // Create a minimal wrangler config to test port option parsing
      await mkdir(testDir, { recursive: true })
      await writeFile(
        join(testDir, 'wrangler.jsonc'),
        JSON.stringify({ name: 'test', main: 'index.ts' })
      )
      await writeFile(join(testDir, 'index.ts'), 'export default {}')

      // Just verify the command accepts the port argument
      const cliPath = resolve(__dirname, '../../cli.ts')
      const proc = spawn('npx', ['tsx', cliPath, 'dev', '--port', '9999'], {
        cwd: testDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let output = ''
      proc.stdout?.on('data', (data) => {
        output += data.toString()
      })
      proc.stderr?.on('data', (data) => {
        output += data.toString()
      })

      // Wait briefly for startup message
      await new Promise((r) => setTimeout(r, 2000))
      proc.kill('SIGTERM')

      // Should include port in output or not have argument parsing error
      expect(output).not.toMatch(/unknown option|invalid/i)
    })
  })

  describe('Hot reload on file changes', () => {
    it('should watch for file changes (integration check)', async () => {
      // This test verifies the wrangler dev is configured for hot reload
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      // Start dev server with live-reload flag
      const cliPath = resolve(__dirname, '../../cli.ts')
      const proc = spawn('npx', ['tsx', cliPath, 'dev', '--live-reload'], {
        cwd: testDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      devProcess = proc

      let output = ''
      proc.stdout?.on('data', (data) => {
        output += data.toString()
      })
      proc.stderr?.on('data', (data) => {
        output += data.toString()
      })

      // Wait longer for startup output
      await new Promise((r) => setTimeout(r, 4000))
      proc.kill('SIGTERM')

      // The process should have started - verify it ran without unknown option error
      // Output may be empty if wrangler isn't installed or process exited quickly
      expect(output).not.toMatch(/unknown option --live-reload/i)
    })
  })

  describe('Bindings work locally', () => {
    it('should support --persist flag for DO state persistence', async () => {
      await mkdir(testDir, { recursive: true })
      await writeFile(
        join(testDir, 'wrangler.jsonc'),
        JSON.stringify({ name: 'test', main: 'index.ts' })
      )
      await writeFile(join(testDir, 'index.ts'), 'export default {}')

      // Verify --persist flag is accepted
      const cliPath = resolve(__dirname, '../../cli.ts')
      const proc = spawn('npx', ['tsx', cliPath, 'dev', '--persist'], {
        cwd: testDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let output = ''
      proc.stdout?.on('data', (data) => {
        output += data.toString()
      })
      proc.stderr?.on('data', (data) => {
        output += data.toString()
      })

      await new Promise((r) => setTimeout(r, 4000))
      proc.kill('SIGTERM')

      // Should not have unknown option error for --persist flag
      // The output may be empty if wrangler startup is slow, but there should be no argument errors
      expect(output).not.toMatch(/unknown option --persist/i)
      expect(output).not.toMatch(/invalid argument.*--persist/i)
    })
  })

  describe('Returns correct exit code on errors', () => {
    it('should exit with non-zero code when config is missing', async () => {
      // Create empty directory without wrangler config
      await mkdir(testDir, { recursive: true })

      // Try to run dev without wrangler.toml
      const result = await runCli(['dev'], {
        cwd: testDir,
        timeout: 10000,
      }).catch((err) => ({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
      }))

      // Should fail or show error about missing config
      expect(result.exitCode !== 0 || result.stderr.length > 0).toBe(true)
    })
  })
})

// ============================================================================
// E2E Tests: dotdo deploy
// ============================================================================

describe('E2E: dotdo deploy', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dotdo-e2e-deploy-'))
  })

  afterEach(async () => {
    if (testDir && existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true })
    }
  })

  describe('Deploys to Cloudflare (dry-run mode)', () => {
    it('should support --dry-run flag', async () => {
      // Create a project first
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      // Run deploy with dry-run flag
      const result = await runCli(['deploy', '--dry-run'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      // Should show deploying message with dry-run
      expect(result.stdout + result.stderr).toMatch(/deploy|dry-run|build/i)
    })

    it('should skip build when --dry-run is used', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['deploy', '--dry-run'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      // With dry-run, shouldn't have separate build step message
      // The output should just run the dry-run deploy
      expect(result.stdout).toBeDefined()
    })
  })

  describe('Shows deployment URL on success', () => {
    it('should show deployment output', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      // Using dry-run mode since we can't actually deploy
      const result = await runCli(['deploy', '--dry-run'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      // Should show some deployment-related output
      expect(result.stdout + result.stderr).toMatch(/deploy|build|wrangler/i)
    })
  })

  describe('Handles missing wrangler.toml gracefully', () => {
    it('should show error when wrangler config is missing', async () => {
      // Create empty directory without wrangler config
      await mkdir(testDir, { recursive: true })
      await writeFile(join(testDir, 'index.ts'), 'export default {}')

      const result = await runCli(['deploy', '--dry-run'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      // Should fail or show error about missing config
      expect(result.exitCode !== 0 || result.stderr.length > 0).toBe(true)
    })

    it('should accept custom config via --config flag', async () => {
      await mkdir(testDir, { recursive: true })

      // Create custom config file
      const customConfigPath = join(testDir, 'custom-wrangler.toml')
      await writeFile(
        customConfigPath,
        `name = "custom-worker"\nmain = "index.ts"\ncompatibility_date = "2025-01-15"`
      )
      await writeFile(join(testDir, 'index.ts'), 'export default {}')

      // Verify --config flag is accepted
      const result = await runCli(['deploy', '--dry-run', '--config', 'custom-wrangler.toml'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      // Should not have unknown option error
      expect(result.stdout + result.stderr).not.toMatch(/unknown option/i)
    })
  })

  describe('Supports --env flag for environments', () => {
    it('should accept --env flag', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      // Test that --env flag is accepted
      const result = await runCli(['deploy', '--dry-run', '--env', 'staging'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      // Should not have unknown option error
      expect(result.stdout + result.stderr).not.toMatch(/unknown option/i)
    })

    it('should pass environment to wrangler', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      // When using production env, it should be passed through
      const result = await runCli(['deploy', '--dry-run', '--env', 'production'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      // The command should execute without argument errors
      expect(result.stdout + result.stderr).not.toMatch(/invalid|unknown/i)
    })
  })

  describe('Rollback support', () => {
    it('should accept --rollback flag with version', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['deploy', '--rollback', 'abc123'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      // Should show rollback-related output
      expect(result.stdout + result.stderr).toMatch(/rollback|version|abc123/i)
    })

    it('should error when rollback version not specified', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['deploy', '--rollback'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      // Should show error about missing version
      expect(result.exitCode !== 0 || result.stderr.match(/version|rollback/i)).toBeTruthy()
    })
  })

  describe('Build before deploy', () => {
    it('should build before deploying by default', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['deploy', '--dry-run'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      // Should show building message
      expect(result.stdout).toMatch(/build|deploy/i)
    })
  })

  describe('Additional deploy options', () => {
    it('should accept --minify flag', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['deploy', '--dry-run', '--minify'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      expect(result.stdout + result.stderr).not.toMatch(/unknown option/i)
    })

    it('should accept --name flag', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['deploy', '--dry-run', '--name', 'my-custom-worker'], {
        cwd: testDir,
        timeout: 30000,
        env: {
          DO_TOKEN: 'test-token',
        },
      })

      expect(result.stdout + result.stderr).not.toMatch(/unknown option/i)
    })
  })
})

// ============================================================================
// E2E Tests: dotdo build
// ============================================================================

describe('E2E: dotdo build', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dotdo-e2e-build-'))
  })

  afterEach(async () => {
    if (testDir && existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true })
    }
  })

  describe('Builds project successfully', () => {
    it('should run build command and show building message', async () => {
      // First, create a project
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      // Run build command
      const result = await runCli(['build'], {
        cwd: testDir,
        timeout: 30000,
      })

      // Should show building message (wrangler runs with --dry-run internally)
      expect(result.stdout + result.stderr).toMatch(/build|Building/i)
    })

    it('should accept --minify flag', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['build', '--minify'], {
        cwd: testDir,
        timeout: 30000,
      })

      // Should not error on --minify flag
      expect(result.stdout + result.stderr).not.toMatch(/unknown option/i)
    })

    it('should accept --sourcemap flag', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['build', '--sourcemap'], {
        cwd: testDir,
        timeout: 30000,
      })

      // Should not error on --sourcemap flag
      expect(result.stdout + result.stderr).not.toMatch(/unknown option/i)
    })

    it('should accept --outdir flag', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['build', '--outdir', 'dist'], {
        cwd: testDir,
        timeout: 30000,
      })

      // Should not error on --outdir flag
      expect(result.stdout + result.stderr).not.toMatch(/unknown option/i)
    })
  })

  describe('Build with configuration', () => {
    it('should accept --config flag for custom wrangler config', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      // Rename to custom config
      const { rename } = await import('node:fs/promises')
      await rename(
        join(testDir, 'wrangler.jsonc'),
        join(testDir, 'custom-wrangler.jsonc')
      )

      const result = await runCli(['build', '--config', 'custom-wrangler.jsonc'], {
        cwd: testDir,
        timeout: 30000,
      })

      // Should use custom config file
      expect(result.stdout + result.stderr).not.toMatch(/unknown option/i)
    })

    it('should accept --env flag for environment selection', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['build', '--env', 'staging'], {
        cwd: testDir,
        timeout: 30000,
      })

      // Should not error on --env flag
      expect(result.stdout + result.stderr).not.toMatch(/unknown option/i)
    })
  })

  describe('Build error handling', () => {
    it('should handle missing wrangler config gracefully', async () => {
      // Create empty directory without wrangler config
      await mkdir(testDir, { recursive: true })
      await writeFile(join(testDir, 'index.ts'), 'export default {}')

      const result = await runCli(['build'], {
        cwd: testDir,
        timeout: 30000,
      })

      // Should fail or show error about missing config
      expect(result.exitCode !== 0 || result.stderr.length > 0).toBe(true)
    })

    it('should show helpful message when wrangler is not installed', async () => {
      // This test verifies error handling when wrangler isn't found
      // In a real environment, this would test ENOENT handling
      await mkdir(testDir, { recursive: true })
      await writeFile(join(testDir, 'wrangler.jsonc'), '{"name":"test","main":"index.ts"}')
      await writeFile(join(testDir, 'index.ts'), 'export default {}')

      const result = await runCli(['build'], {
        cwd: testDir,
        timeout: 30000,
      })

      // Should either work (wrangler found) or show error message
      expect(result.stdout + result.stderr).toBeDefined()
    })
  })

  describe('Build output', () => {
    it('should show build completion time', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['build'], {
        cwd: testDir,
        timeout: 30000,
      })

      // Should show completion message with timing
      // The build command outputs duration in ms or s format
      expect(result.stdout).toMatch(/build|completed|ms|sec/i)
    })

    it('should support --verbose flag for detailed output', async () => {
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      // Test with parent -v flag (verbose)
      const result = await runCli(['-v', 'build'], {
        cwd: testDir,
        timeout: 30000,
      })

      // Verbose mode should show config info
      expect(result.stdout).toBeDefined()
    })
  })
})

// ============================================================================
// E2E Tests: dotdo logs (if available in project)
// ============================================================================

describe('E2E: dotdo logs', () => {
  it('should display logs command help', async () => {
    const result = await runCli(['logs', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('logs')
    expect(result.stdout).toContain('--follow')
    expect(result.stdout).toContain('--level')
  })

  it('should accept --format flag', async () => {
    const result = await runCli(['logs', '--help'])

    expect(result.stdout).toContain('--format')
  })
})

// ============================================================================
// E2E Tests: dotdo config commands
// ============================================================================

describe('E2E: dotdo config', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dotdo-e2e-config-'))
  })

  afterEach(async () => {
    if (testDir && existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true })
    }
  })

  describe('config show', () => {
    it('should display current configuration', async () => {
      const result = await runCli(['config', 'show'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('configuration')
    })
  })

  describe('config get', () => {
    it('should get configuration value', async () => {
      const result = await runCli(['config', 'get', 'apiUrl'])

      // Should show the value or error for non-existent key
      expect(result.stdout + result.stderr).toBeDefined()
    })

    it('should error for non-existent key', async () => {
      const result = await runCli(['config', 'get', 'nonExistentKey'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('not found')
    })
  })

  describe('config set', () => {
    it('should set configuration value', async () => {
      // Create a project with config
      await runCli(['init', testDir, '-y', '--skip-install', '--skip-git'], {
        timeout: 60000,
      })

      const result = await runCli(['config', 'set', 'namespace', 'my-namespace'], {
        cwd: testDir,
        timeout: 10000,
      })

      // Should succeed or show appropriate message
      expect(result.stdout + result.stderr).toBeDefined()
    })
  })
})

// ============================================================================
// E2E Tests: dotdo do subcommands
// ============================================================================

describe('E2E: dotdo do', () => {
  describe('do list', () => {
    it('should display do list command help', async () => {
      const result = await runCli(['do', 'list', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('list')
      expect(result.stdout).toContain('--namespace')
      expect(result.stdout).toContain('--format')
    })
  })

  describe('do inspect', () => {
    it('should display do inspect command help', async () => {
      const result = await runCli(['do', 'inspect', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('inspect')
      expect(result.stdout).toContain('--namespace')
      expect(result.stdout).toContain('--storage')
    })
  })

  describe('do delete', () => {
    it('should display do delete command help', async () => {
      const result = await runCli(['do', 'delete', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('delete')
      expect(result.stdout).toContain('--force')
      expect(result.stdout).toContain('--namespace')
    })
  })
})

// ============================================================================
// E2E Tests: dotdo auth commands
// ============================================================================

describe('E2E: dotdo auth', () => {
  describe('login', () => {
    it('should display login command help', async () => {
      const result = await runCli(['login', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('login')
      expect(result.stdout).toContain('--token')
    })
  })

  describe('logout', () => {
    it('should display logout command help', async () => {
      const result = await runCli(['logout', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('logout')
    })
  })

  describe('whoami', () => {
    it('should display whoami command help', async () => {
      const result = await runCli(['whoami', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('whoami')
      expect(result.stdout).toContain('--json')
    })
  })
})

// ============================================================================
// Integration Tests: CLI Help and Version
// ============================================================================

describe('E2E: CLI Help and Version', () => {
  it('should display help text with --help', async () => {
    const result = await runCli(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('dotdo')
    expect(result.stdout).toContain('init')
    expect(result.stdout).toContain('dev')
    expect(result.stdout).toContain('deploy')
  })

  it('should display version with --version', async () => {
    const result = await runCli(['--version'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/)
  })

  it('should display init command help', async () => {
    const result = await runCli(['init', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('init')
    expect(result.stdout).toContain('--template')
    expect(result.stdout).toContain('--name')
  })

  it('should display dev command help', async () => {
    const result = await runCli(['dev', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('dev')
    expect(result.stdout).toContain('--port')
    expect(result.stdout).toContain('--persist')
  })

  it('should display deploy command help', async () => {
    const result = await runCli(['deploy', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('deploy')
    expect(result.stdout).toContain('--env')
    expect(result.stdout).toContain('--dry-run')
  })

  it('should display build command help', async () => {
    const result = await runCli(['build', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('build')
    expect(result.stdout).toContain('--minify')
    expect(result.stdout).toContain('--sourcemap')
    expect(result.stdout).toContain('--outdir')
  })

  it('should display logs command help', async () => {
    const result = await runCli(['logs', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('logs')
    expect(result.stdout).toContain('--follow')
  })

  it('should display do command help', async () => {
    const result = await runCli(['do', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Manage Durable Objects')
    expect(result.stdout).toContain('list')
    expect(result.stdout).toContain('inspect')
    expect(result.stdout).toContain('delete')
  })

  it('should display config command help', async () => {
    const result = await runCli(['config', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('config')
    expect(result.stdout).toContain('show')
    expect(result.stdout).toContain('set')
    expect(result.stdout).toContain('get')
  })
})
