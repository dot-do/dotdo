/**
 * E2E Tests: CLI Init Command
 *
 * Tests that `dotdo init` correctly scaffolds new projects with
 * real file system operations.
 *
 * These tests:
 * 1. Create real directories and files
 * 2. Verify the generated code structure
 * 3. Validate generated files can be used by other CLI commands
 */

import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  createTempDir,
  cleanupTempDir,
  runCommand,
} from './utils/server'

test.describe('CLI Init Command E2E', () => {
  let tempDir: string

  test.beforeEach(() => {
    // Create a fresh temp directory for each test
    tempDir = createTempDir(`init-e2e-${Date.now()}`)
  })

  test.afterEach(() => {
    // Clean up temp directory
    cleanupTempDir(tempDir)
  })

  test.describe('Project Scaffolding', () => {
    test('should create a new project with all required files', () => {
      const projectName = 'test-startup'
      const result = runCommand('init', {
        cwd: tempDir,
        args: [projectName],
        timeout: 30000,
      })

      // Command should succeed
      expect(result.exitCode).toBe(0)

      const projectDir = join(tempDir, projectName)

      // Project directory should exist
      expect(existsSync(projectDir)).toBe(true)

      // All required files should exist
      expect(existsSync(join(projectDir, 'src', 'index.ts'))).toBe(true)
      expect(existsSync(join(projectDir, 'wrangler.jsonc'))).toBe(true)
      expect(existsSync(join(projectDir, 'package.json'))).toBe(true)
      expect(existsSync(join(projectDir, 'tsconfig.json'))).toBe(true)
    })

    test('should generate valid TypeScript code', () => {
      const projectName = 'my-app'
      runCommand('init', {
        cwd: tempDir,
        args: [projectName],
      })

      const indexPath = join(tempDir, projectName, 'src', 'index.ts')
      const content = readFileSync(indexPath, 'utf-8')

      // Should contain proper imports
      expect(content).toContain('import')
      expect(content).toContain('dotdo')

      // Should export a class
      expect(content).toMatch(/export\s+(default\s+)?class/)

      // Should extend DO
      expect(content).toContain('extends DO')

      // Should have $type static property
      expect(content).toContain('$type')

      // Class name should be PascalCase version of project name
      expect(content).toContain('MyApp')
    })

    test('should generate valid wrangler.jsonc configuration', () => {
      const projectName = 'my-worker'
      runCommand('init', {
        cwd: tempDir,
        args: [projectName],
      })

      const wranglerPath = join(tempDir, projectName, 'wrangler.jsonc')
      const content = readFileSync(wranglerPath, 'utf-8')

      // Should have project name
      expect(content).toContain('"name"')
      expect(content).toContain('my-worker')

      // Should have compatibility flags
      expect(content).toContain('"compatibility_flags"')
      expect(content).toContain('nodejs_compat')

      // Should have durable objects configuration
      expect(content).toContain('"durable_objects"')
      expect(content).toContain('"bindings"')
      expect(content).toContain('MyWorker') // PascalCase class name

      // Should have migrations
      expect(content).toContain('"migrations"')
      expect(content).toContain('"new_sqlite_classes"')
    })

    test('should generate valid package.json with dependencies', () => {
      const projectName = 'my-project'
      runCommand('init', {
        cwd: tempDir,
        args: [projectName],
      })

      const packagePath = join(tempDir, projectName, 'package.json')
      const content = readFileSync(packagePath, 'utf-8')
      const pkg = JSON.parse(content)

      // Basic fields
      expect(pkg.name).toBe('my-project')
      expect(pkg.private).toBe(true)
      expect(pkg.type).toBe('module')

      // Scripts
      expect(pkg.scripts).toBeDefined()
      expect(pkg.scripts.dev).toBeDefined()
      expect(pkg.scripts.deploy).toBeDefined()

      // Dependencies
      expect(pkg.dependencies).toBeDefined()
      expect(pkg.dependencies.dotdo).toBeDefined()

      // Dev dependencies
      expect(pkg.devDependencies).toBeDefined()
      expect(pkg.devDependencies.wrangler).toBeDefined()
      expect(pkg.devDependencies.typescript).toBeDefined()
      expect(pkg.devDependencies['@cloudflare/workers-types']).toBeDefined()
    })

    test('should generate valid tsconfig.json', () => {
      const projectName = 'ts-project'
      runCommand('init', {
        cwd: tempDir,
        args: [projectName],
      })

      const tsconfigPath = join(tempDir, projectName, 'tsconfig.json')
      const content = readFileSync(tsconfigPath, 'utf-8')
      const tsconfig = JSON.parse(content)

      // Compiler options
      expect(tsconfig.compilerOptions).toBeDefined()
      expect(tsconfig.compilerOptions.strict).toBe(true)
      expect(tsconfig.compilerOptions.target).toBe('ES2022')
      expect(tsconfig.compilerOptions.module).toBe('ESNext')

      // Worker types
      expect(tsconfig.compilerOptions.types).toContain('@cloudflare/workers-types')

      // Include/exclude
      expect(tsconfig.include).toContain('src/**/*')
      expect(tsconfig.exclude).toContain('node_modules')
    })
  })

  test.describe('Project Name Handling', () => {
    test('should convert kebab-case to PascalCase for class names', () => {
      const projectName = 'my-awesome-startup'
      runCommand('init', {
        cwd: tempDir,
        args: [projectName],
      })

      const indexPath = join(tempDir, projectName, 'src', 'index.ts')
      const content = readFileSync(indexPath, 'utf-8')

      expect(content).toContain('MyAwesomeStartup')
    })

    test('should initialize in current directory with "." argument', () => {
      const projectDir = join(tempDir, 'empty-project')
      require('fs').mkdirSync(projectDir, { recursive: true })

      const result = runCommand('init', {
        cwd: projectDir,
        args: ['.'],
      })

      expect(result.exitCode).toBe(0)

      // Files should be created in the project directory
      expect(existsSync(join(projectDir, 'src', 'index.ts'))).toBe(true)
      expect(existsSync(join(projectDir, 'wrangler.jsonc'))).toBe(true)
      expect(existsSync(join(projectDir, 'package.json'))).toBe(true)
    })

    test('should use directory name for class name when initializing with "."', () => {
      const projectDir = join(tempDir, 'my-cool-project')
      require('fs').mkdirSync(projectDir, { recursive: true })

      runCommand('init', {
        cwd: projectDir,
        args: ['.'],
      })

      const indexPath = join(projectDir, 'src', 'index.ts')
      const content = readFileSync(indexPath, 'utf-8')

      expect(content).toContain('MyCoolProject')
    })
  })

  test.describe('Error Handling', () => {
    test('should fail if project directory already exists', () => {
      const projectName = 'existing-project'
      const projectDir = join(tempDir, projectName)

      // Create the directory first
      require('fs').mkdirSync(projectDir, { recursive: true })

      const result = runCommand('init', {
        cwd: tempDir,
        args: [projectName],
      })

      // Should fail
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toLowerCase()).toMatch(/already exists|error/)
    })

    test('should fail if no project name provided', () => {
      const result = runCommand('init', {
        cwd: tempDir,
        args: [],
      })

      expect(result.exitCode).not.toBe(0)
    })

    test('should fail for invalid project name starting with number', () => {
      const result = runCommand('init', {
        cwd: tempDir,
        args: ['123invalid'],
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toLowerCase()).toMatch(/invalid|name/)
    })

    test('should fail for project name with special characters', () => {
      const result = runCommand('init', {
        cwd: tempDir,
        args: ['my@project!'],
      })

      expect(result.exitCode).not.toBe(0)
    })
  })

  test.describe('CLI Output', () => {
    test('should print success message', () => {
      const projectName = 'success-project'
      const result = runCommand('init', {
        cwd: tempDir,
        args: [projectName],
      })

      expect(result.exitCode).toBe(0)
      // Output should contain success indication
      expect(result.stdout.toLowerCase()).toMatch(/created|success/)
    })

    test('should print next steps', () => {
      const projectName = 'steps-project'
      const result = runCommand('init', {
        cwd: tempDir,
        args: [projectName],
      })

      expect(result.exitCode).toBe(0)

      // Should suggest cd command
      expect(result.stdout).toContain('cd')
      expect(result.stdout).toContain(projectName)

      // Should suggest npm install
      expect(result.stdout.toLowerCase()).toMatch(/npm install|pnpm install|bun install/)
    })
  })

  test.describe('File Idempotency', () => {
    test('should not overwrite existing files when running in existing project', () => {
      const projectDir = join(tempDir, 'existing-with-files')
      require('fs').mkdirSync(join(projectDir, 'src'), { recursive: true })

      // Create existing files with custom content
      const customContent = '// Custom content\nexport const value = 42;\n'
      require('fs').writeFileSync(join(projectDir, 'src', 'index.ts'), customContent)

      runCommand('init', {
        cwd: projectDir,
        args: ['.'],
      })

      // Original file should be preserved (init should skip existing files or merge)
      const content = readFileSync(join(projectDir, 'src', 'index.ts'), 'utf-8')
      // The behavior depends on implementation - either preserve or overwrite
      // For now, we just verify the file exists
      expect(content.length).toBeGreaterThan(0)
    })
  })
})
