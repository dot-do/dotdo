/**
 * E2E Tests: CLI Start Command
 *
 * Tests that `dotdo start` correctly starts a development server
 * in various example directories.
 */

import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import {
  startServer,
  EXAMPLES_DIR,
  killProcessOnPort,
  type ServerInstance,
} from './utils/server'

test.describe('CLI Start Command', () => {
  let server: ServerInstance | null = null

  test.afterEach(async () => {
    // Clean up server after each test
    if (server) {
      await server.stop()
      server = null
    }
  })

  test.describe('simple-api example', () => {
    const exampleDir = join(EXAMPLES_DIR, 'simple-api')

    test.beforeEach(async () => {
      await killProcessOnPort(4001)
    })

    test('should start server on specified port', async ({ request }) => {
      server = await startServer({
        cwd: exampleDir,
        port: 4001,
        timeout: 45000,
      })

      expect(server.port).toBe(4001)
      expect(server.url).toBe('http://localhost:4001')
    })

    test('should respond to root request', async ({ request }) => {
      server = await startServer({
        cwd: exampleDir,
        port: 4002,
        timeout: 45000,
      })

      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })
  })

  test.describe('jsonapi example', () => {
    const exampleDir = join(EXAMPLES_DIR, 'jsonapi')

    test.beforeEach(async () => {
      await killProcessOnPort(4003)
    })

    test('should start JSON:API server', async () => {
      server = await startServer({
        cwd: exampleDir,
        port: 4003,
        timeout: 45000,
      })

      expect(server.port).toBe(4003)

      // The server should respond
      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })
  })

  test.describe('hateoas-api example', () => {
    const exampleDir = join(EXAMPLES_DIR, 'hateoas-api')

    test.beforeEach(async () => {
      await killProcessOnPort(4004)
    })

    test('should start HATEOAS API server', async () => {
      server = await startServer({
        cwd: exampleDir,
        port: 4004,
        timeout: 45000,
      })

      expect(server.port).toBe(4004)

      // The server should respond
      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })
  })

  test.describe('custom-do example', () => {
    const exampleDir = join(EXAMPLES_DIR, 'custom-do')

    test.beforeEach(async () => {
      await killProcessOnPort(4005)
    })

    test('should start custom DO server', async () => {
      server = await startServer({
        cwd: exampleDir,
        port: 4005,
        timeout: 45000,
      })

      expect(server.port).toBe(4005)

      // Health endpoint should work
      const response = await fetch(`${server.url}/health`)
      // Could be 200 or 404 depending on routing, but not 500
      expect(response.status).toBeLessThan(500)
    })
  })
})
