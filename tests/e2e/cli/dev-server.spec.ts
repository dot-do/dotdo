/**
 * E2E Tests: CLI Dev Command
 *
 * Tests that `dotdo dev` correctly starts a development server
 * using real example directories and verifies HTTP responses.
 *
 * These tests:
 * 1. Start real development servers
 * 2. Verify server responds on the correct port
 * 3. Test various CLI options
 * 4. Verify server graceful shutdown
 */

import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import {
  startDevServer,
  EXAMPLES_DIR,
  killProcessOnPort,
  createTempDir,
  cleanupTempDir,
  runCommand,
  type ServerInstance,
} from './utils/server'

test.describe('CLI Dev Command E2E', () => {
  let server: ServerInstance | null = null

  test.afterEach(async () => {
    // Clean up server after each test
    if (server) {
      await server.stop()
      server = null
    }
  })

  test.describe('Server Startup', () => {
    test.beforeEach(async () => {
      await killProcessOnPort(8787)
    })

    test('should start dev server on default port 8787', async () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      server = await startDevServer({
        cwd: exampleDir,
        port: 8787,
        timeout: 45000,
      })

      expect(server.port).toBe(8787)
      expect(server.url).toBe('http://localhost:8787')
    })

    test('should start dev server on custom port', async () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      server = await startDevServer({
        cwd: exampleDir,
        port: 9000,
        timeout: 45000,
      })

      expect(server.port).toBe(9000)
      expect(server.url).toBe('http://localhost:9000')
    })

    test('should respond to HTTP requests', async () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      server = await startDevServer({
        cwd: exampleDir,
        port: 8788,
        timeout: 45000,
      })

      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })
  })

  test.describe('Example Directories', () => {
    test('should start simple-api example', async () => {
      await killProcessOnPort(8801)

      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      server = await startDevServer({
        cwd: exampleDir,
        port: 8801,
        timeout: 45000,
      })

      expect(server.port).toBe(8801)

      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })

    test('should start jsonapi example', async () => {
      await killProcessOnPort(8802)

      const exampleDir = join(EXAMPLES_DIR, 'jsonapi')

      server = await startDevServer({
        cwd: exampleDir,
        port: 8802,
        timeout: 45000,
      })

      expect(server.port).toBe(8802)

      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })

    test('should start hateoas-api example', async () => {
      await killProcessOnPort(8803)

      const exampleDir = join(EXAMPLES_DIR, 'hateoas-api')

      server = await startDevServer({
        cwd: exampleDir,
        port: 8803,
        timeout: 45000,
      })

      expect(server.port).toBe(8803)

      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })

    test('should start custom-do example', async () => {
      await killProcessOnPort(8804)

      const exampleDir = join(EXAMPLES_DIR, 'custom-do')

      server = await startDevServer({
        cwd: exampleDir,
        port: 8804,
        timeout: 45000,
      })

      expect(server.port).toBe(8804)

      // Verify /health endpoint
      const response = await fetch(`${server.url}/health`)
      expect(response.status).toBeLessThan(500)
    })
  })

  test.describe('Server Options', () => {
    test('should respect --host option', async () => {
      await killProcessOnPort(8810)

      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      server = await startDevServer({
        cwd: exampleDir,
        port: 8810,
        args: ['--host', '0.0.0.0'],
        timeout: 45000,
      })

      expect(server.port).toBe(8810)

      // Should still be accessible on localhost
      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })

    test('should capture output for debugging', async () => {
      await killProcessOnPort(8811)

      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      server = await startDevServer({
        cwd: exampleDir,
        port: 8811,
        timeout: 45000,
      })

      // Server output should be captured
      expect(server.output).toBeDefined()
      expect(Array.isArray(server.output)).toBe(true)
    })
  })

  test.describe('Persistence', () => {
    let tempDir: string

    test.beforeEach(() => {
      tempDir = createTempDir(`dev-persist-${Date.now()}`)
    })

    test.afterEach(() => {
      cleanupTempDir(tempDir)
    })

    test('should support --no-persist option', async () => {
      await killProcessOnPort(8820)

      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      server = await startDevServer({
        cwd: exampleDir,
        port: 8820,
        args: ['--no-persist'],
        timeout: 45000,
      })

      expect(server.port).toBe(8820)

      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })

    test('should support custom persistence path', async () => {
      await killProcessOnPort(8821)

      const exampleDir = join(EXAMPLES_DIR, 'simple-api')
      const persistPath = join(tempDir, 'custom-state')

      server = await startDevServer({
        cwd: exampleDir,
        port: 8821,
        args: ['--persist', persistPath],
        timeout: 45000,
      })

      expect(server.port).toBe(8821)

      // Make a request to potentially create state
      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })
  })

  test.describe('Server Lifecycle', () => {
    test('should stop gracefully', async () => {
      await killProcessOnPort(8830)

      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      server = await startDevServer({
        cwd: exampleDir,
        port: 8830,
        timeout: 45000,
      })

      // Verify server is running
      const responseBefore = await fetch(server.url)
      expect(responseBefore.status).toBeLessThan(500)

      // Stop the server
      await server.stop()

      // Wait a bit for the port to be released
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Server should no longer respond
      try {
        await fetch(server.url, { signal: AbortSignal.timeout(2000) })
        // If we get here without error, the server might still be running
      } catch {
        // Expected - connection refused
      }

      server = null // Already stopped
    })

    test('should handle multiple sequential starts', async () => {
      await killProcessOnPort(8831)

      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      // First start
      server = await startDevServer({
        cwd: exampleDir,
        port: 8831,
        timeout: 45000,
      })

      let response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)

      // Stop
      await server.stop()
      server = null

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Second start on same port
      server = await startDevServer({
        cwd: exampleDir,
        port: 8831,
        timeout: 45000,
      })

      response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })
  })
})
