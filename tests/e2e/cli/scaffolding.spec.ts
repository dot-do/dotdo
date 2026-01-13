/**
 * E2E Tests: CLI Scaffolding
 *
 * Tests that the CLI correctly scaffolds new projects
 * when running in empty directories.
 */

import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  startServer,
  createTempDir,
  cleanupTempDir,
  killProcessOnPort,
  runCommand,
  type ServerInstance,
} from './utils/server'

test.describe('CLI Scaffolding', () => {
  let tempDir: string
  let server: ServerInstance | null = null

  test.beforeEach(() => {
    // Create a fresh temp directory for each test
    tempDir = createTempDir(`scaffold-test-${Date.now()}`)
  })

  test.afterEach(async () => {
    // Stop server if running
    if (server) {
      await server.stop()
      server = null
    }

    // Clean up temp directory
    cleanupTempDir(tempDir)
  })

  test.describe('init command', () => {
    test('should create project structure with init command', () => {
      const result = runCommand('init', {
        cwd: tempDir,
        timeout: 30000,
      })

      expect(result.exitCode).toBe(0)

      // Verify files were created
      expect(existsSync(join(tempDir, 'dotdo.config.ts'))).toBe(true)
      expect(existsSync(join(tempDir, 'index.ts'))).toBe(true)
      expect(existsSync(join(tempDir, 'objects', 'Counter.ts'))).toBe(true)
      expect(existsSync(join(tempDir, '.dotdo'))).toBe(true)
    })

    test('should create Counter.ts with correct structure', () => {
      runCommand('init', { cwd: tempDir })

      const counterPath = join(tempDir, 'objects', 'Counter.ts')
      expect(existsSync(counterPath)).toBe(true)

      const content = readFileSync(counterPath, 'utf-8')
      expect(content).toContain('class Counter')
      expect(content).toContain('DurableObject')
      expect(content).toContain('increment')
      expect(content).toContain('decrement')
    })

    test('should create dotdo.config.ts with correct structure', () => {
      runCommand('init', { cwd: tempDir })

      const configPath = join(tempDir, 'dotdo.config.ts')
      expect(existsSync(configPath)).toBe(true)

      const content = readFileSync(configPath, 'utf-8')
      expect(content).toContain('DotdoConfig')
      expect(content).toContain('port')
      expect(content).toContain('compatibilityDate')
    })

    test('should create index.ts with worker entry point', () => {
      runCommand('init', { cwd: tempDir })

      const indexPath = join(tempDir, 'index.ts')
      expect(existsSync(indexPath)).toBe(true)

      const content = readFileSync(indexPath, 'utf-8')
      expect(content).toContain('fetch')
      expect(content).toContain('Counter')
      expect(content).toContain('/counter')
    })

    test('should not overwrite existing files', () => {
      // First init
      runCommand('init', { cwd: tempDir })

      // Modify a file
      const configPath = join(tempDir, 'dotdo.config.ts')
      const originalContent = readFileSync(configPath, 'utf-8')

      // Run init again
      runCommand('init', { cwd: tempDir })

      // File should be unchanged
      const newContent = readFileSync(configPath, 'utf-8')
      expect(newContent).toBe(originalContent)
    })
  })

  test.describe('start with scaffolding', () => {
    test.beforeEach(async () => {
      await killProcessOnPort(4010)
    })

    test('should scaffold and start server in empty directory', async () => {
      // Start server in empty directory - should scaffold automatically
      server = await startServer({
        cwd: tempDir,
        port: 4010,
        timeout: 60000, // Longer timeout for scaffolding
      })

      expect(server.port).toBe(4010)

      // Verify scaffolding happened
      expect(existsSync(join(tempDir, '.do'))).toBe(true)

      // Server should respond
      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })

    test('should create .do directory with state folder', async () => {
      server = await startServer({
        cwd: tempDir,
        port: 4011,
        timeout: 60000,
      })

      // .do directory should exist with expected structure
      const dotDoDir = join(tempDir, '.do')
      expect(existsSync(dotDoDir)).toBe(true)
      expect(existsSync(join(dotDoDir, 'state'))).toBe(true)
    })
  })

  test.describe('start --reset', () => {
    test.beforeEach(async () => {
      await killProcessOnPort(4012)
    })

    test('should clear state directory with --reset flag', async () => {
      // First, start and create some state
      server = await startServer({
        cwd: tempDir,
        port: 4012,
        timeout: 60000,
      })

      // Make a request to potentially create state
      await fetch(server.url)

      await server.stop()
      server = null

      // Wait a bit for cleanup
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Now start with --reset
      server = await startServer({
        cwd: tempDir,
        port: 4012,
        args: ['--reset'],
        timeout: 60000,
      })

      // Server should work
      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })
  })
})
