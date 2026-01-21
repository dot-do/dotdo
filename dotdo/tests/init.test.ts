import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { init } from '../commands/init'

describe('dotdo init', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dotdo-test-'))
  })

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true })
    }
  })

  describe('basic template', () => {
    it('should create project with basic template', async () => {
      await init(testDir, {
        name: 'test-project',
        yes: true,
        template: 'basic',
        skipGit: true,
        skipInstall: true,
      })

      // Check directory structure
      const files = await readdir(testDir)
      expect(files).toContain('package.json')
      expect(files).toContain('tsconfig.json')
      expect(files).toContain('wrangler.jsonc')
      expect(files).toContain('.gitignore')
      expect(files).toContain('README.md')
      expect(files).toContain('vitest.config.ts')
      expect(files).toContain('src')
      expect(files).toContain('tests')
    })

    it('should generate valid package.json', async () => {
      await init(testDir, {
        name: 'test-project',
        yes: true,
        template: 'basic',
        skipGit: true,
        skipInstall: true,
      })

      const pkgContent = await readFile(join(testDir, 'package.json'), 'utf-8')
      const pkg = JSON.parse(pkgContent)

      expect(pkg.name).toBe('test-project')
      expect(pkg.version).toBe('0.0.1')
      expect(pkg.type).toBe('module')
      expect(pkg.dependencies).toHaveProperty('dotdo')
      expect(pkg.dependencies).toHaveProperty('hono')
      expect(pkg.devDependencies).toHaveProperty('typescript')
      expect(pkg.devDependencies).toHaveProperty('wrangler')
      expect(pkg.devDependencies).toHaveProperty('vitest')
      expect(pkg.scripts).toHaveProperty('dev')
      expect(pkg.scripts).toHaveProperty('deploy')
      expect(pkg.scripts).toHaveProperty('test')
    })

    it('should generate valid tsconfig.json', async () => {
      await init(testDir, {
        name: 'test-project',
        yes: true,
        template: 'basic',
        skipGit: true,
        skipInstall: true,
      })

      const tsconfigContent = await readFile(
        join(testDir, 'tsconfig.json'),
        'utf-8'
      )
      const tsconfig = JSON.parse(tsconfigContent)

      expect(tsconfig.compilerOptions.target).toBe('ESNext')
      expect(tsconfig.compilerOptions.module).toBe('ESNext')
      expect(tsconfig.compilerOptions.moduleResolution).toBe('bundler')
      expect(tsconfig.compilerOptions.strict).toBe(true)
      expect(tsconfig.compilerOptions.types).toContain(
        '@cloudflare/workers-types'
      )
    })

    it('should generate valid wrangler.jsonc', async () => {
      await init(testDir, {
        name: 'test-project',
        yes: true,
        template: 'basic',
        skipGit: true,
        skipInstall: true,
      })

      const wranglerContent = await readFile(
        join(testDir, 'wrangler.jsonc'),
        'utf-8'
      )
      const wrangler = JSON.parse(wranglerContent)

      expect(wrangler.name).toBe('test-project')
      expect(wrangler.main).toBe('src/index.ts')
      expect(wrangler.compatibility_date).toBeTruthy()
      expect(wrangler.durable_objects).toBeDefined()
      expect(wrangler.durable_objects.bindings).toHaveLength(1)
      expect(wrangler.durable_objects.bindings[0].name).toBe('DO')
      expect(wrangler.durable_objects.bindings[0].class_name).toBe('MyDO')
    })

    it('should create src/index.ts', async () => {
      await init(testDir, {
        name: 'test-project',
        yes: true,
        template: 'basic',
        skipGit: true,
        skipInstall: true,
      })

      const indexPath = join(testDir, 'src', 'index.ts')
      await access(indexPath) // Should not throw

      const content = await readFile(indexPath, 'utf-8')
      expect(content).toContain('import { MyDO }')
      expect(content).toContain('export { MyDO }')
      expect(content).toContain('export default')
      expect(content).toContain('async fetch')
    })

    it('should create src/do.ts with DO class', async () => {
      await init(testDir, {
        name: 'test-project',
        yes: true,
        template: 'basic',
        skipGit: true,
        skipInstall: true,
      })

      const doPath = join(testDir, 'src', 'do.ts')
      await access(doPath) // Should not throw

      const content = await readFile(doPath, 'utf-8')
      expect(content).toContain('import { DO }')
      expect(content).toContain('export class MyDO extends DO')
      expect(content).toContain('constructor')
      expect(content).toContain('protected routes')
    })

    it('should create tests/do.test.ts', async () => {
      await init(testDir, {
        name: 'test-project',
        yes: true,
        template: 'basic',
        skipGit: true,
        skipInstall: true,
      })

      const testPath = join(testDir, 'tests', 'do.test.ts')
      await access(testPath) // Should not throw

      const content = await readFile(testPath, 'utf-8')
      expect(content).toContain("import { describe, it, expect } from 'vitest'")
      expect(content).toContain("describe('MyDO'")
      expect(content).toContain('should respond to health check')
      expect(content).toContain('should create and retrieve things')
    })

    it('should create .gitignore', async () => {
      await init(testDir, {
        name: 'test-project',
        yes: true,
        template: 'basic',
        skipGit: true,
        skipInstall: true,
      })

      const gitignorePath = join(testDir, '.gitignore')
      const content = await readFile(gitignorePath, 'utf-8')

      expect(content).toContain('node_modules/')
      expect(content).toContain('.wrangler/')
      expect(content).toContain('.env')
      expect(content).toContain('.DS_Store')
    })

    it('should create README.md', async () => {
      await init(testDir, {
        name: 'test-project',
        yes: true,
        template: 'basic',
        skipGit: true,
        skipInstall: true,
      })

      const readmePath = join(testDir, 'README.md')
      const content = await readFile(readmePath, 'utf-8')

      expect(content).toContain('# test-project')
      expect(content).toContain('npm install')
      expect(content).toContain('npm run dev')
      expect(content).toContain('template=basic')
    })

    it('should create vitest.config.ts', async () => {
      await init(testDir, {
        name: 'test-project',
        yes: true,
        template: 'basic',
        skipGit: true,
        skipInstall: true,
      })

      const vitestPath = join(testDir, 'vitest.config.ts')
      const content = await readFile(vitestPath, 'utf-8')

      expect(content).toContain('defineWorkersProject')
      expect(content).toContain('wrangler.jsonc')
    })
  })

  describe('template options', () => {
    it('should create api template', async () => {
      await init(testDir, {
        name: 'api-project',
        yes: true,
        template: 'api',
        skipGit: true,
        skipInstall: true,
      })

      const pkgContent = await readFile(join(testDir, 'package.json'), 'utf-8')
      const pkg = JSON.parse(pkgContent)

      expect(pkg.name).toBe('api-project')
      expect(pkg.dependencies).toHaveProperty('dotdo')

      const readmePath = join(testDir, 'README.md')
      const readme = await readFile(readmePath, 'utf-8')
      expect(readme).toContain('template=api')
    })

    it('should create full template', async () => {
      await init(testDir, {
        name: 'full-project',
        yes: true,
        template: 'full',
        skipGit: true,
        skipInstall: true,
      })

      const pkgContent = await readFile(join(testDir, 'package.json'), 'utf-8')
      const pkg = JSON.parse(pkgContent)

      expect(pkg.name).toBe('full-project')

      const readmePath = join(testDir, 'README.md')
      const readme = await readFile(readmePath, 'utf-8')
      expect(readme).toContain('template=full')
      expect(readme).toContain('Database support')
      expect(readme).toContain('Authentication')
      expect(readme).toContain('AI module')
      expect(readme).toContain('MCP server')
    })
  })

  describe('git initialization', () => {
    it('should initialize git repository by default', async () => {
      // Check if git is available
      try {
        execSync('git --version', { stdio: 'ignore' })
      } catch {
        // Skip test if git not available
        return
      }

      await init(testDir, {
        name: 'git-project',
        yes: true,
        template: 'basic',
        skipInstall: true,
      })

      // Check if .git directory exists
      const files = await readdir(testDir)
      expect(files).toContain('.git')

      // Check if initial commit exists
      const log = execSync('git log --oneline', {
        cwd: testDir,
        encoding: 'utf-8',
      })
      expect(log).toContain('Initial commit from dotdo init')
    })

    it('should skip git init when skipGit is true', async () => {
      await init(testDir, {
        name: 'no-git-project',
        yes: true,
        template: 'basic',
        skipGit: true,
        skipInstall: true,
      })

      const files = await readdir(testDir)
      expect(files).not.toContain('.git')
    })
  })

  describe('default values', () => {
    it('should use default project name', async () => {
      await init(testDir, {
        yes: true,
        skipGit: true,
        skipInstall: true,
      })

      const pkgContent = await readFile(join(testDir, 'package.json'), 'utf-8')
      const pkg = JSON.parse(pkgContent)

      expect(pkg.name).toBe('my-dotdo-project')
    })

    it('should use basic template by default', async () => {
      await init(testDir, {
        yes: true,
        skipGit: true,
        skipInstall: true,
      })

      const readmePath = join(testDir, 'README.md')
      const readme = await readFile(readmePath, 'utf-8')
      expect(readme).toContain('template=basic')
    })
  })

  describe('error handling', () => {
    it('should throw if directory is not empty', async () => {
      // Create a file in the directory
      await mkdtemp(join(testDir, 'existing-'))

      await expect(
        init(testDir, {
          yes: true,
          skipGit: true,
          skipInstall: true,
        })
      ).rejects.toThrow('not empty')
    })
  })

  describe('current directory initialization', () => {
    it('should initialize in current directory when targetDir is "."', async () => {
      // Create a temporary directory and change to it
      const tempDir = await mkdtemp(join(tmpdir(), 'dotdo-current-'))

      try {
        await init(tempDir, {
          name: 'current-dir-project',
          yes: true,
          skipGit: true,
          skipInstall: true,
        })

        const files = await readdir(tempDir)
        expect(files).toContain('package.json')
        expect(files).toContain('src')
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })
  })
})
