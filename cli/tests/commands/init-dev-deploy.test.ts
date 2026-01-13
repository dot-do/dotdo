/**
 * CLI Commands Tests - Comprehensive Coverage for init, dev, deploy
 *
 * This file provides additional test coverage for the three core CLI commands:
 * - init: Project scaffolding and initialization
 * - dev: Local development server
 * - deploy: Production deployment
 *
 * Tests use the shared helpers from helpers.ts and follow existing patterns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// ============================================================================
// Test Helpers
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dotdo-cli-test-'))
}

function cleanupTempDir(dir: string): void {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

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
    all: () => [...logs, ...errors],
  }
}

interface SpawnOptions {
  env?: Record<string, string | undefined>
  stdio?: ['inherit' | 'pipe', 'inherit' | 'pipe', 'inherit' | 'pipe'] | 'inherit'
  cwd?: string
}

interface SpawnedProcess {
  pid: number
  exited: Promise<number>
  kill: (signal?: number) => void
  stdout?: ReadableStream<Uint8Array>
  stderr?: ReadableStream<Uint8Array>
}

function createSpawnMock() {
  const calls: Array<{ command: string[]; options?: SpawnOptions }> = []
  let exitCode = 0
  let shouldReject = false

  const mock = vi.fn((command: string[], options?: SpawnOptions): SpawnedProcess => {
    calls.push({ command, options })
    return {
      pid: 12345,
      exited: shouldReject
        ? Promise.reject(new Error('Process failed'))
        : Promise.resolve(exitCode),
      kill: vi.fn(),
    }
  })

  return {
    mock,
    calls,
    setExitCode: (code: number) => {
      exitCode = code
    },
    setReject: (reject: boolean) => {
      shouldReject = reject
    },
    reset: () => {
      calls.length = 0
      exitCode = 0
      shouldReject = false
      mock.mockClear()
    },
  }
}

// ============================================================================
// INIT COMMAND - Additional Tests
// ============================================================================

describe('init command - Module Tests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  describe('CLI Module Interface', () => {
    it('exports run function from init module', async () => {
      const initModule = await import('../../commands/init')
      expect(initModule.run).toBeDefined()
      expect(typeof initModule.run).toBe('function')
    })

    it('exports name constant', async () => {
      const initModule = await import('../../commands/init')
      expect(initModule.name).toBe('init')
    })

    it('exports description constant', async () => {
      const initModule = await import('../../commands/init')
      expect(initModule.description).toBeDefined()
      expect(typeof initModule.description).toBe('string')
    })

    it('run function returns a Promise', async () => {
      const initModule = await import('../../commands/init')
      const result = initModule.run(['test-project'], { cwd: tempDir })
      expect(result).toBeInstanceOf(Promise)
      await result
    })
  })

  describe('Project Name Validation', () => {
    it('accepts valid lowercase project name', async () => {
      const initModule = await import('../../commands/init')
      await expect(initModule.run(['my-project'], { cwd: tempDir })).resolves.not.toThrow()
    })

    it('accepts project name with numbers', async () => {
      const initModule = await import('../../commands/init')
      await expect(initModule.run(['project123'], { cwd: tempDir })).resolves.not.toThrow()
    })

    it('accepts project name with hyphens', async () => {
      const initModule = await import('../../commands/init')
      await expect(initModule.run(['my-cool-project'], { cwd: tempDir })).resolves.not.toThrow()
    })

    it('rejects project name starting with number', async () => {
      const initModule = await import('../../commands/init')
      await expect(initModule.run(['123project'], { cwd: tempDir })).rejects.toThrow(/invalid/i)
    })

    it('rejects project name with uppercase letters', async () => {
      const initModule = await import('../../commands/init')
      await expect(initModule.run(['MyProject'], { cwd: tempDir })).rejects.toThrow(/invalid/i)
    })

    it('rejects project name with special characters', async () => {
      const initModule = await import('../../commands/init')
      await expect(initModule.run(['my@project'], { cwd: tempDir })).rejects.toThrow(/invalid/i)
    })

    it('rejects project name with spaces', async () => {
      const initModule = await import('../../commands/init')
      await expect(initModule.run(['my project'], { cwd: tempDir })).rejects.toThrow(/invalid/i)
    })

    it('requires project name to be provided', async () => {
      const initModule = await import('../../commands/init')
      await expect(initModule.run([], { cwd: tempDir })).rejects.toThrow(/project name/i)
    })
  })

  describe('Class Name Derivation', () => {
    it('converts kebab-case to PascalCase', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-cool-project'], { cwd: tempDir })

      const indexPath = path.join(tempDir, 'my-cool-project', 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')
      expect(content).toContain('MyCoolProject')
    })

    it('handles single word project name', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['startup'], { cwd: tempDir })

      const indexPath = path.join(tempDir, 'startup', 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')
      expect(content).toContain('Startup')
    })

    it('handles multiple hyphens correctly', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-super-cool-app'], { cwd: tempDir })

      const indexPath = path.join(tempDir, 'my-super-cool-app', 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')
      expect(content).toContain('MySuperCoolApp')
    })
  })

  describe('Directory Creation', () => {
    it('creates project directory', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['new-project'], { cwd: tempDir })

      const projectDir = path.join(tempDir, 'new-project')
      expect(fs.existsSync(projectDir)).toBe(true)
      expect(fs.statSync(projectDir).isDirectory()).toBe(true)
    })

    it('creates src subdirectory', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['new-project'], { cwd: tempDir })

      const srcDir = path.join(tempDir, 'new-project', 'src')
      expect(fs.existsSync(srcDir)).toBe(true)
      expect(fs.statSync(srcDir).isDirectory()).toBe(true)
    })

    it('fails if directory already exists', async () => {
      const projectDir = path.join(tempDir, 'existing-project')
      fs.mkdirSync(projectDir)

      const initModule = await import('../../commands/init')
      await expect(initModule.run(['existing-project'], { cwd: tempDir })).rejects.toThrow(
        /already exists/i
      )
    })
  })

  describe('File Generation', () => {
    it('generates src/index.ts with DO import', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['test-app'], { cwd: tempDir })

      const indexPath = path.join(tempDir, 'test-app', 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')
      expect(content).toContain('import')
      expect(content).toContain('dotdo')
    })

    it('generates src/index.ts with class extending DO', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['test-app'], { cwd: tempDir })

      const indexPath = path.join(tempDir, 'test-app', 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')
      expect(content).toMatch(/class\s+\w+\s+extends\s+DO/)
    })

    it('generates wrangler.jsonc with correct name', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-worker'], { cwd: tempDir })

      const wranglerPath = path.join(tempDir, 'my-worker', 'wrangler.jsonc')
      const content = fs.readFileSync(wranglerPath, 'utf-8')
      expect(content).toContain('"name": "my-worker"')
    })

    it('generates wrangler.jsonc with durable_objects section', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-worker'], { cwd: tempDir })

      const wranglerPath = path.join(tempDir, 'my-worker', 'wrangler.jsonc')
      const content = fs.readFileSync(wranglerPath, 'utf-8')
      expect(content).toContain('"durable_objects"')
    })

    it('generates wrangler.jsonc with migrations', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-worker'], { cwd: tempDir })

      const wranglerPath = path.join(tempDir, 'my-worker', 'wrangler.jsonc')
      const content = fs.readFileSync(wranglerPath, 'utf-8')
      expect(content).toContain('"migrations"')
      expect(content).toContain('new_sqlite_classes')
    })

    it('generates package.json with correct name', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-app'], { cwd: tempDir })

      const pkgPath = path.join(tempDir, 'my-app', 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.name).toBe('my-app')
    })

    it('generates package.json with dotdo dependency', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-app'], { cwd: tempDir })

      const pkgPath = path.join(tempDir, 'my-app', 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.dependencies.dotdo).toBeDefined()
    })

    it('generates package.json with wrangler devDependency', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-app'], { cwd: tempDir })

      const pkgPath = path.join(tempDir, 'my-app', 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.devDependencies.wrangler).toBeDefined()
    })

    it('generates package.json with TypeScript devDependency', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-app'], { cwd: tempDir })

      const pkgPath = path.join(tempDir, 'my-app', 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.devDependencies.typescript).toBeDefined()
    })

    it('generates package.json with dev script', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-app'], { cwd: tempDir })

      const pkgPath = path.join(tempDir, 'my-app', 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.scripts.dev).toBeDefined()
    })

    it('generates package.json with deploy script', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-app'], { cwd: tempDir })

      const pkgPath = path.join(tempDir, 'my-app', 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.scripts.deploy).toBeDefined()
    })

    it('generates tsconfig.json with strict mode', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-app'], { cwd: tempDir })

      const tsconfigPath = path.join(tempDir, 'my-app', 'tsconfig.json')
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'))
      expect(tsconfig.compilerOptions.strict).toBe(true)
    })

    it('generates tsconfig.json with bundler moduleResolution', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-app'], { cwd: tempDir })

      const tsconfigPath = path.join(tempDir, 'my-app', 'tsconfig.json')
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'))
      expect(tsconfig.compilerOptions.moduleResolution).toBe('bundler')
    })

    it('generates tsconfig.json with workers types', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['my-app'], { cwd: tempDir })

      const tsconfigPath = path.join(tempDir, 'my-app', 'tsconfig.json')
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'))
      expect(tsconfig.compilerOptions.types).toContain('@cloudflare/workers-types')
    })
  })

  describe('Current Directory Initialization', () => {
    it('initializes in current directory with "." argument', async () => {
      const projectDir = path.join(tempDir, 'existing-empty-dir')
      fs.mkdirSync(projectDir)

      const initModule = await import('../../commands/init')
      await initModule.run(['.'], { cwd: projectDir })

      expect(fs.existsSync(path.join(projectDir, 'src', 'index.ts'))).toBe(true)
    })

    it('uses directory name for class when initializing with "."', async () => {
      const projectDir = path.join(tempDir, 'my-existing-app')
      fs.mkdirSync(projectDir)

      const initModule = await import('../../commands/init')
      await initModule.run(['.'], { cwd: projectDir })

      const indexPath = path.join(projectDir, 'src', 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')
      expect(content).toContain('MyExistingApp')
    })

    it('uses directory name for package.json name with "."', async () => {
      const projectDir = path.join(tempDir, 'my-existing-app')
      fs.mkdirSync(projectDir)

      const initModule = await import('../../commands/init')
      await initModule.run(['.'], { cwd: projectDir })

      const pkgPath = path.join(projectDir, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.name).toBe('my-existing-app')
    })
  })

  describe('Console Output', () => {
    it('prints success message', async () => {
      const output = captureConsole()

      try {
        const initModule = await import('../../commands/init')
        await initModule.run(['success-test'], { cwd: tempDir })

        expect(
          output.logs.some(
            (log) =>
              log.toLowerCase().includes('success') || log.toLowerCase().includes('created')
          )
        ).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints cd command for new directories', async () => {
      const output = captureConsole()

      try {
        const initModule = await import('../../commands/init')
        await initModule.run(['my-new-app'], { cwd: tempDir })

        expect(output.logs.some((log) => log.includes('cd my-new-app'))).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints npm install instruction', async () => {
      const output = captureConsole()

      try {
        const initModule = await import('../../commands/init')
        await initModule.run(['install-test'], { cwd: tempDir })

        expect(output.logs.some((log) => log.includes('npm install'))).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints npm run dev instruction', async () => {
      const output = captureConsole()

      try {
        const initModule = await import('../../commands/init')
        await initModule.run(['dev-test'], { cwd: tempDir })

        expect(output.logs.some((log) => log.includes('npm run dev'))).toBe(true)
      } finally {
        output.restore()
      }
    })
  })
})

// ============================================================================
// DEV COMMAND - Additional Tests
// ============================================================================

describe('dev command - Module Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Mock oauth.do/node for dev command tests
  vi.mock('oauth.do/node', () => ({
    ensureLoggedIn: vi.fn().mockResolvedValue({
      token: 'test-token',
      isNewLogin: false,
    }),
    getToken: vi.fn().mockResolvedValue('test-token'),
  }))

  describe('CLI Module Interface', () => {
    it('exports run function from dev module', async () => {
      const devModule = await import('../../commands/dev/dev')
      expect(devModule.run).toBeDefined()
      expect(typeof devModule.run).toBe('function')
    })

    it('exports name constant', async () => {
      const devModule = await import('../../commands/dev/dev')
      expect(devModule.name).toBe('dev')
    })

    it('exports description constant', async () => {
      const devModule = await import('../../commands/dev/dev')
      expect(devModule.description).toBeDefined()
      expect(typeof devModule.description).toBe('string')
    })

    it('run function returns a Promise', async () => {
      const devModule = await import('../../commands/dev/dev')
      const spawnMock = createSpawnMock()

      const result = devModule.run([], { spawn: spawnMock.mock })
      expect(result).toBeInstanceOf(Promise)
      await result.catch(() => {}) // Ignore errors
    })
  })

  describe('Wrangler Command Construction', () => {
    it('constructs bunx wrangler dev command', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const devModule = await import('../../commands/dev/dev')
      const spawnMock = createSpawnMock()

      await devModule.run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls.length).toBe(1)
      expect(spawnMock.calls[0].command[0]).toBe('bunx')
      expect(spawnMock.calls[0].command[1]).toBe('wrangler')
      expect(spawnMock.calls[0].command[2]).toBe('dev')
    })

    it('appends user arguments to command', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const devModule = await import('../../commands/dev/dev')
      const spawnMock = createSpawnMock()

      await devModule.run(['--port', '3000', '--local'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('--port')
      expect(spawnMock.calls[0].command).toContain('3000')
      expect(spawnMock.calls[0].command).toContain('--local')
    })
  })

  describe('Environment Configuration', () => {
    it('passes DO_TOKEN to spawned process', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'my-secret-token', isNewLogin: false })

      const devModule = await import('../../commands/dev/dev')
      const spawnMock = createSpawnMock()

      await devModule.run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].options?.env?.DO_TOKEN).toBe('my-secret-token')
    })

    it('passes DO_API_URL when provided', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const devModule = await import('../../commands/dev/dev')
      const spawnMock = createSpawnMock()

      await devModule.run([], { spawn: spawnMock.mock, apiUrl: 'https://custom.api.do' })

      expect(spawnMock.calls[0].options?.env?.DO_API_URL).toBe('https://custom.api.do')
    })

    it('uses inherited stdio for interactive terminal', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const devModule = await import('../../commands/dev/dev')
      const spawnMock = createSpawnMock()

      await devModule.run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].options?.stdio).toEqual(['inherit', 'inherit', 'inherit'])
    })
  })

  describe('Exit Code Handling', () => {
    it('returns exit code from wrangler process', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const devModule = await import('../../commands/dev/dev')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(0)

      const result = await devModule.run([], { spawn: spawnMock.mock })

      expect(result.exitCode).toBe(0)
    })

    it('returns non-zero exit code on failure', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const devModule = await import('../../commands/dev/dev')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(1)

      const result = await devModule.run([], { spawn: spawnMock.mock })

      expect(result.exitCode).toBe(1)
    })
  })

  describe('Console Output', () => {
    it('prints starting message', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const output = captureConsole()

      try {
        const devModule = await import('../../commands/dev/dev')
        const spawnMock = createSpawnMock()

        await devModule.run([], { spawn: spawnMock.mock })

        expect(output.logs.some((log) => log.toLowerCase().includes('starting'))).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints login success message for new logins', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: true })

      const output = captureConsole()

      try {
        const devModule = await import('../../commands/dev/dev')
        const spawnMock = createSpawnMock()

        await devModule.run([], { spawn: spawnMock.mock })

        expect(output.logs.some((log) => log.toLowerCase().includes('logged in'))).toBe(true)
      } finally {
        output.restore()
      }
    })
  })
})

// ============================================================================
// DEPLOY COMMAND - Additional Tests
// ============================================================================

describe('deploy command - Module Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('CLI Module Interface', () => {
    it('exports run function from deploy module', async () => {
      const deployModule = await import('../../commands/dev/deploy')
      expect(deployModule.run).toBeDefined()
      expect(typeof deployModule.run).toBe('function')
    })

    it('exports name constant', async () => {
      const deployModule = await import('../../commands/dev/deploy')
      expect(deployModule.name).toBe('deploy')
    })

    it('exports description constant', async () => {
      const deployModule = await import('../../commands/dev/deploy')
      expect(deployModule.description).toBeDefined()
      expect(typeof deployModule.description).toBe('string')
    })

    it('run function returns a Promise', async () => {
      const deployModule = await import('../../commands/dev/deploy')
      const spawnMock = createSpawnMock()

      const result = deployModule.run([], { spawn: spawnMock.mock })
      expect(result).toBeInstanceOf(Promise)
      await result.catch(() => {}) // Ignore errors
    })
  })

  describe('Wrangler Command Construction', () => {
    it('constructs bunx wrangler deploy command', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const deployModule = await import('../../commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await deployModule.run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls.length).toBe(1)
      expect(spawnMock.calls[0].command[0]).toBe('bunx')
      expect(spawnMock.calls[0].command[1]).toBe('wrangler')
      expect(spawnMock.calls[0].command[2]).toBe('deploy')
    })

    it('appends user arguments to deploy command', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const deployModule = await import('../../commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await deployModule.run(['--env', 'production', '--minify'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('--env')
      expect(spawnMock.calls[0].command).toContain('production')
      expect(spawnMock.calls[0].command).toContain('--minify')
    })
  })

  describe('Result Object', () => {
    it('returns success: true on exit code 0', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const deployModule = await import('../../commands/dev/deploy')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(0)

      const result = await deployModule.run([], { spawn: spawnMock.mock })

      expect(result.success).toBe(true)
      expect(result.exitCode).toBe(0)
    })

    it('returns success: false on non-zero exit code', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const deployModule = await import('../../commands/dev/deploy')
      const spawnMock = createSpawnMock()
      spawnMock.setExitCode(1)

      const result = await deployModule.run([], { spawn: spawnMock.mock })

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('Console Output', () => {
    it('prints deploying message', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const output = captureConsole()

      try {
        const deployModule = await import('../../commands/dev/deploy')
        const spawnMock = createSpawnMock()

        await deployModule.run([], { spawn: spawnMock.mock })

        expect(output.logs.some((log) => log.toLowerCase().includes('deploying'))).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints success message on successful deploy', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const output = captureConsole()

      try {
        const deployModule = await import('../../commands/dev/deploy')
        const spawnMock = createSpawnMock()
        spawnMock.setExitCode(0)

        await deployModule.run([], { spawn: spawnMock.mock })

        expect(
          output.logs.some(
            (log) =>
              log.toLowerCase().includes('success') || log.toLowerCase().includes('completed')
          )
        ).toBe(true)
      } finally {
        output.restore()
      }
    })

    it('prints failure message on failed deploy', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const output = captureConsole()

      try {
        const deployModule = await import('../../commands/dev/deploy')
        const spawnMock = createSpawnMock()
        spawnMock.setExitCode(1)

        await deployModule.run([], { spawn: spawnMock.mock })

        expect(
          output.errors.some(
            (log) => log.toLowerCase().includes('failed') || log.toLowerCase().includes('error')
          )
        ).toBe(true)
      } finally {
        output.restore()
      }
    })
  })

  describe('Environment Configuration', () => {
    it('passes DO_TOKEN to deploy process', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({
        token: 'deploy-secret-token',
        isNewLogin: false,
      })

      const deployModule = await import('../../commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await deployModule.run([], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].options?.env?.DO_TOKEN).toBe('deploy-secret-token')
    })

    it('passes DO_API_URL when provided', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const deployModule = await import('../../commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await deployModule.run([], { spawn: spawnMock.mock, apiUrl: 'https://prod.api.do' })

      expect(spawnMock.calls[0].options?.env?.DO_API_URL).toBe('https://prod.api.do')
    })
  })

  describe('Argument Forwarding', () => {
    it('forwards --dry-run flag', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const deployModule = await import('../../commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await deployModule.run(['--dry-run'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('--dry-run')
    })

    it('forwards --name argument', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const deployModule = await import('../../commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await deployModule.run(['--name', 'my-production-worker'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('--name')
      expect(spawnMock.calls[0].command).toContain('my-production-worker')
    })

    it('forwards --config argument', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const deployModule = await import('../../commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await deployModule.run(['--config', 'wrangler.production.jsonc'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('--config')
      expect(spawnMock.calls[0].command).toContain('wrangler.production.jsonc')
    })

    it('forwards positional script argument', async () => {
      const { ensureLoggedIn } = await import('oauth.do/node')
      vi.mocked(ensureLoggedIn).mockResolvedValue({ token: 'test-token', isNewLogin: false })

      const deployModule = await import('../../commands/dev/deploy')
      const spawnMock = createSpawnMock()

      await deployModule.run(['src/production.ts'], { spawn: spawnMock.mock })

      expect(spawnMock.calls[0].command).toContain('src/production.ts')
    })
  })
})

// ============================================================================
// Cross-Command Integration Tests
// ============================================================================

describe('CLI Command Integration', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
    vi.restoreAllMocks()
  })

  describe('Init then Dev workflow', () => {
    it('init creates files that dev command expects', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['workflow-test'], { cwd: tempDir })

      const projectDir = path.join(tempDir, 'workflow-test')

      // Check all files that wrangler dev would need
      expect(fs.existsSync(path.join(projectDir, 'src', 'index.ts'))).toBe(true)
      expect(fs.existsSync(path.join(projectDir, 'wrangler.jsonc'))).toBe(true)
      expect(fs.existsSync(path.join(projectDir, 'package.json'))).toBe(true)
    })

    it('init creates valid wrangler configuration', async () => {
      const initModule = await import('../../commands/init')
      await initModule.run(['config-test'], { cwd: tempDir })

      const wranglerPath = path.join(tempDir, 'config-test', 'wrangler.jsonc')
      const content = fs.readFileSync(wranglerPath, 'utf-8')

      // Should be valid JSONC (JSONC allows comments)
      // Check key required fields
      expect(content).toContain('"main"')
      expect(content).toContain('"compatibility_date"')
      expect(content).toContain('"compatibility_flags"')
    })
  })

  describe('Module consistency', () => {
    it('all command modules export consistent interface', async () => {
      const initModule = await import('../../commands/init')
      const devModule = await import('../../commands/dev/dev')
      const deployModule = await import('../../commands/dev/deploy')

      // All should export run, name, description
      expect(typeof initModule.run).toBe('function')
      expect(typeof initModule.name).toBe('string')
      expect(typeof initModule.description).toBe('string')

      expect(typeof devModule.run).toBe('function')
      expect(typeof devModule.name).toBe('string')
      expect(typeof devModule.description).toBe('string')

      expect(typeof deployModule.run).toBe('function')
      expect(typeof deployModule.name).toBe('string')
      expect(typeof deployModule.description).toBe('string')
    })
  })
})
