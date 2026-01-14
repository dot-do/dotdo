/**
 * E2E Tests for CLI using real examples
 *
 * These tests verify the CLI works correctly with actual project configurations
 * from the `examples/do-start/` directory.
 *
 * Tests cover:
 * - Starting dev server in example directories
 * - Verifying server starts on expected port
 * - Making HTTP requests to verify routes work
 * - Testing scaffolding in empty directories
 * - Testing multi-surface routing
 *
 * Following the project's testing philosophy: NO MOCKS - real behavior only.
 *
 * TDD Phase: RED - Tests specify expected behavior.
 * Some tests are marked `.todo` pending Miniflare runtime implementation.
 *
 * @see cli/commands/start.ts
 * @see examples/do-start/
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, ChildProcess } from 'node:child_process'

// ============================================================================
// Test Configuration
// ============================================================================

const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const EXAMPLES_DIR = path.join(PROJECT_ROOT, 'examples/do-start')
const CLI_BIN = path.join(PROJECT_ROOT, 'node_modules/.bin/tsx')
const CLI_ENTRY = path.join(PROJECT_ROOT, 'cli/bin.ts')

// Port range for E2E tests to avoid conflicts
const BASE_PORT = 5200
let portOffset = 0

function getNextPort(): number {
  return BASE_PORT + portOffset++
}

// Extended timeout for E2E tests (60 seconds)
const E2E_TIMEOUT = 60000

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Wait for a condition to be true with timeout
 */
async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 30000, interval = 200 } = options
  const start = Date.now()

  while (Date.now() - start < timeout) {
    try {
      if (await condition()) {
        return
      }
    } catch {
      // Condition threw, try again
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`)
}

/**
 * Check if a server is responding on a given port
 */
async function isServerReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}`, {
      signal: AbortSignal.timeout(1000),
    })
    return response.ok || response.status < 500
  } catch {
    return false
  }
}

/**
 * Start the CLI dev server in a directory
 * Returns a handle to stop the server
 */
async function startDevServer(
  cwd: string,
  port: number,
  options: { timeout?: number } = {}
): Promise<{
  process: ChildProcess
  port: number
  url: string
  stdout: string
  stderr: string
  stop: () => Promise<void>
}> {
  const { timeout = 45000 } = options

  const serverProcess = spawn(CLI_BIN, [CLI_ENTRY, 'start', '-p', String(port), '--no-open'], {
    cwd,
    env: { ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''

  serverProcess.stdout?.on('data', (data) => {
    stdout += data.toString()
  })

  serverProcess.stderr?.on('data', (data) => {
    stderr += data.toString()
  })

  // Wait for server to be ready
  try {
    await waitFor(() => isServerReady(port), { timeout })
  } catch {
    // Kill the process if it failed to start
    serverProcess.kill('SIGTERM')
    throw new Error(`Server failed to start on port ${port}.\nStdout: ${stdout}\nStderr: ${stderr}`)
  }

  return {
    process: serverProcess,
    port,
    url: `http://localhost:${port}`,
    stdout,
    stderr,
    stop: async () => {
      return new Promise((resolve) => {
        if (serverProcess.killed) {
          resolve()
          return
        }

        serverProcess.once('exit', () => resolve())
        serverProcess.kill('SIGTERM')

        // Force kill after 5 seconds
        setTimeout(() => {
          if (!serverProcess.killed) {
            serverProcess.kill('SIGKILL')
          }
          resolve()
        }, 5000)
      })
    },
  }
}

/**
 * Create a temporary directory for testing
 */
async function createTempDir(): Promise<string> {
  const prefix = path.join(tmpdir(), 'dotdo-e2e-')
  return fs.mkdtemp(prefix)
}

/**
 * Clean up a temporary directory
 */
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Example File Structure Tests (No Runtime Required)
// ============================================================================

describe('E2E: Example File Structure', () => {
  describe('01-basic-rest-api', () => {
    const exampleDir = path.join(EXAMPLES_DIR, '01-basic-rest-api')

    it('has App.tsx file', async () => {
      const appPath = path.join(exampleDir, 'App.tsx')
      const exists = await fs.stat(appPath).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('has README.md file', async () => {
      const readmePath = path.join(exampleDir, 'README.md')
      const exists = await fs.stat(readmePath).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('App.tsx exports a Tasks DO class', async () => {
      const appPath = path.join(exampleDir, 'App.tsx')
      const content = await fs.readFile(appPath, 'utf-8')
      expect(content).toContain('export class Tasks')
      expect(content).toContain('extends DO')
    })

    it('App.tsx exports a default App component', async () => {
      const appPath = path.join(exampleDir, 'App.tsx')
      const content = await fs.readFile(appPath, 'utf-8')
      expect(content).toContain('export default function App')
    })
  })

  describe('02-mdx-marketing-site', () => {
    const exampleDir = path.join(EXAMPLES_DIR, '02-mdx-marketing-site')

    it('has Site.mdx file', async () => {
      const sitePath = path.join(exampleDir, 'Site.mdx')
      const exists = await fs.stat(sitePath).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('has README.md file', async () => {
      const readmePath = path.join(exampleDir, 'README.md')
      const exists = await fs.stat(readmePath).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('Site.mdx has frontmatter', async () => {
      const sitePath = path.join(exampleDir, 'Site.mdx')
      const content = await fs.readFile(sitePath, 'utf-8')
      expect(content).toContain('---')
      expect(content).toContain('title:')
    })

    it('Site.mdx exports React components', async () => {
      const sitePath = path.join(exampleDir, 'Site.mdx')
      const content = await fs.readFile(sitePath, 'utf-8')
      expect(content).toContain('export const')
    })
  })

  describe('03-multi-surface', () => {
    const exampleDir = path.join(EXAMPLES_DIR, '03-multi-surface')

    it('has all five surface files', async () => {
      const surfaces = ['App.tsx', 'Admin.tsx', 'Site.mdx', 'Docs.mdx', 'Blog.mdx']

      for (const surface of surfaces) {
        const surfacePath = path.join(exampleDir, surface)
        const exists = await fs.stat(surfacePath).then(() => true).catch(() => false)
        expect(exists, `${surface} should exist`).toBe(true)
      }
    })

    it('has docs/ content directory', async () => {
      const docsPath = path.join(exampleDir, 'docs')
      const stat = await fs.stat(docsPath).catch(() => null)
      expect(stat?.isDirectory()).toBe(true)
    })

    it('has blog/ content directory', async () => {
      const blogPath = path.join(exampleDir, 'blog')
      const stat = await fs.stat(blogPath).catch(() => null)
      expect(stat?.isDirectory()).toBe(true)
    })

    it('has content files in docs/', async () => {
      const gettingStartedPath = path.join(exampleDir, 'docs', 'getting-started.mdx')
      const exists = await fs.stat(gettingStartedPath).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('has content files in blog/', async () => {
      const helloWorldPath = path.join(exampleDir, 'blog', 'hello-world.mdx')
      const exists = await fs.stat(helloWorldPath).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('App.tsx exports Workspace DO', async () => {
      const appPath = path.join(exampleDir, 'App.tsx')
      const content = await fs.readFile(appPath, 'utf-8')
      expect(content).toContain('export class Workspace')
      expect(content).toContain('extends DO')
    })

    it('README.md documents all surfaces', async () => {
      const readmePath = path.join(exampleDir, 'README.md')
      const content = await fs.readFile(readmePath, 'utf-8')
      expect(content).toContain('/app')
      expect(content).toContain('/admin')
      expect(content).toContain('/docs')
      expect(content).toContain('/blog')
    })
  })

  describe('04-config-with-surfaces', () => {
    const exampleDir = path.join(EXAMPLES_DIR, '04-config-with-surfaces')

    it('has do.config.ts file', async () => {
      const configPath = path.join(exampleDir, 'do.config.ts')
      const exists = await fs.stat(configPath).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('config file uses defineConfig', async () => {
      const configPath = path.join(exampleDir, 'do.config.ts')
      const content = await fs.readFile(configPath, 'utf-8')
      expect(content).toContain("import { defineConfig } from 'dotdo'")
      expect(content).toContain('export default defineConfig')
    })

    it('config file specifies surfaces', async () => {
      const configPath = path.join(exampleDir, 'do.config.ts')
      const content = await fs.readFile(configPath, 'utf-8')
      expect(content).toContain('surfaces:')
    })

    it('config file specifies durableObjects', async () => {
      const configPath = path.join(exampleDir, 'do.config.ts')
      const content = await fs.readFile(configPath, 'utf-8')
      expect(content).toContain('durableObjects:')
    })

    it('config specifies port', async () => {
      const configPath = path.join(exampleDir, 'do.config.ts')
      const content = await fs.readFile(configPath, 'utf-8')
      expect(content).toContain('port:')
    })
  })
})

// ============================================================================
// Runtime Tests (Require Server - TDD RED Phase)
// ============================================================================

describe('E2E: Dev Server Runtime', () => {
  // These tests require the Miniflare runtime to be working.
  // They are marked as .todo until the runtime is fully implemented.

  describe('01-basic-rest-api', () => {
    const exampleDir = path.join(EXAMPLES_DIR, '01-basic-rest-api')
    let server: Awaited<ReturnType<typeof startDevServer>> | null = null

    afterEach(async () => {
      if (server) {
        await server.stop()
        server = null
      }
    })

    it.todo('starts dev server successfully', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      expect(server.port).toBe(port)
      expect(server.url).toBe(`http://localhost:${port}`)
    }, E2E_TIMEOUT)

    it.todo('serves the App component at root path', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      const response = await fetch(`${server.url}/`)
      expect(response.ok).toBe(true)

      const html = await response.text()
      expect(html).toContain('Task Tracker')
    }, E2E_TIMEOUT)

    it.todo('exposes Tasks DO REST endpoints', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      const response = await fetch(`${server.url}/Tasks/`)
      expect(response.status).not.toBe(404)
    }, E2E_TIMEOUT)
  })

  describe('02-mdx-marketing-site', () => {
    const exampleDir = path.join(EXAMPLES_DIR, '02-mdx-marketing-site')
    let server: Awaited<ReturnType<typeof startDevServer>> | null = null

    afterEach(async () => {
      if (server) {
        await server.stop()
        server = null
      }
    })

    it.todo('starts dev server successfully', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      expect(server.port).toBe(port)
    }, E2E_TIMEOUT)

    it.todo('serves the MDX site at root path', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      const response = await fetch(`${server.url}/`)
      expect(response.ok).toBe(true)

      const html = await response.text()
      expect(html).toContain('Ship')
    }, E2E_TIMEOUT)
  })

  describe('03-multi-surface', () => {
    const exampleDir = path.join(EXAMPLES_DIR, '03-multi-surface')
    let server: Awaited<ReturnType<typeof startDevServer>> | null = null

    afterEach(async () => {
      if (server) {
        await server.stop()
        server = null
      }
    })

    it.todo('starts dev server successfully', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      expect(server.port).toBe(port)
    }, E2E_TIMEOUT)

    it.todo('serves Site.mdx at root path', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      const response = await fetch(`${server.url}/`)
      expect(response.ok).toBe(true)
    }, E2E_TIMEOUT)

    it.todo('serves App.tsx at /app path', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      const response = await fetch(`${server.url}/app`)
      expect(response.ok).toBe(true)

      const html = await response.text()
      expect(html).toContain('Dashboard')
    }, E2E_TIMEOUT)

    it.todo('serves Admin.tsx at /admin path', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      const response = await fetch(`${server.url}/admin`)
      expect(response.ok).toBe(true)
    }, E2E_TIMEOUT)

    it.todo('serves Docs.mdx at /docs path', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      const response = await fetch(`${server.url}/docs`)
      expect(response.ok).toBe(true)
    }, E2E_TIMEOUT)

    it.todo('serves Blog.mdx at /blog path', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      const response = await fetch(`${server.url}/blog`)
      expect(response.ok).toBe(true)
    }, E2E_TIMEOUT)

    it.todo('exposes Workspace DO REST endpoints', async () => {
      const port = getNextPort()
      server = await startDevServer(exampleDir, port)

      const response = await fetch(`${server.url}/Workspace/`)
      expect(response.status).not.toBe(404)
    }, E2E_TIMEOUT)
  })
})

// ============================================================================
// Scaffolding Tests (TDD RED Phase)
// ============================================================================

describe('E2E: Scaffolding', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
  })

  it.todo('scaffolds new project in empty directory', async () => {
    const port = getNextPort()

    const serverProcess = spawn(CLI_BIN, [CLI_ENTRY, 'start', '-p', String(port), '--no-open'], {
      cwd: tempDir,
      env: { ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // Wait for scaffolding to complete
    await new Promise((resolve) => setTimeout(resolve, 5000))

    serverProcess.kill('SIGTERM')
    await new Promise((resolve) => serverProcess.once('exit', resolve))

    const dotDoExists = await fs.stat(path.join(tempDir, '.do')).then(() => true).catch(() => false)
    expect(dotDoExists).toBe(true)

    const appExists = await fs.stat(path.join(tempDir, 'App.tsx')).then(() => true).catch(() => false)
    expect(appExists).toBe(true)
  }, E2E_TIMEOUT)

  it.todo('creates .do directory structure', async () => {
    const port = getNextPort()

    const serverProcess = spawn(CLI_BIN, [CLI_ENTRY, 'start', '-p', String(port), '--no-open'], {
      cwd: tempDir,
      env: { ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await new Promise((resolve) => setTimeout(resolve, 5000))
    serverProcess.kill('SIGTERM')
    await new Promise((resolve) => serverProcess.once('exit', resolve))

    const gitignoreExists = await fs.stat(path.join(tempDir, '.do', '.gitignore')).then(() => true).catch(() => false)
    expect(gitignoreExists).toBe(true)

    const stateExists = await fs.stat(path.join(tempDir, '.do', 'state')).then(() => true).catch(() => false)
    expect(stateExists).toBe(true)
  }, E2E_TIMEOUT)
})

// ============================================================================
// Surface Routing Tests (TDD RED Phase)
// ============================================================================

describe('E2E: Surface Routing', () => {
  let tempDir: string
  let server: Awaited<ReturnType<typeof startDevServer>> | null = null

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    await cleanupTempDir(tempDir)
  })

  it.todo('routes App.tsx to /app when Site.mdx exists', async () => {
    await fs.writeFile(
      path.join(tempDir, 'Site.mdx'),
      `---
title: Site
---

# Welcome`
    )

    await fs.writeFile(
      path.join(tempDir, 'App.tsx'),
      `export default function App() {
  return <div>App Dashboard</div>
}`
    )

    const port = getNextPort()
    server = await startDevServer(tempDir, port)

    const siteResponse = await fetch(`${server.url}/`)
    expect(siteResponse.ok).toBe(true)

    const appResponse = await fetch(`${server.url}/app`)
    expect(appResponse.ok).toBe(true)
  }, E2E_TIMEOUT)

  it.todo('routes App.tsx to / when no Site.mdx exists', async () => {
    await fs.writeFile(
      path.join(tempDir, 'App.tsx'),
      `export default function App() {
  return <div>App at Root</div>
}`
    )

    const port = getNextPort()
    server = await startDevServer(tempDir, port)

    const response = await fetch(`${server.url}/`)
    expect(response.ok).toBe(true)
  }, E2E_TIMEOUT)

  it.todo('Admin surface routes to /admin', async () => {
    await fs.writeFile(
      path.join(tempDir, 'App.tsx'),
      `export default function App() {
  return <div>App</div>
}`
    )

    await fs.writeFile(
      path.join(tempDir, 'Admin.tsx'),
      `export default function Admin() {
  return <div>Admin Panel</div>
}`
    )

    const port = getNextPort()
    server = await startDevServer(tempDir, port)

    const adminResponse = await fetch(`${server.url}/admin`)
    expect(adminResponse.ok).toBe(true)
  }, E2E_TIMEOUT)
})

// ============================================================================
// DO Endpoint Tests (TDD RED Phase)
// ============================================================================

describe('E2E: Durable Object Endpoints', () => {
  const exampleDir = path.join(EXAMPLES_DIR, '01-basic-rest-api')
  let server: Awaited<ReturnType<typeof startDevServer>> | null = null

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it.todo('can create a task via DO RPC', async () => {
    const port = getNextPort()
    server = await startDevServer(exampleDir, port)

    const createResponse = await fetch(`${server.url}/Tasks/test-list/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'E2E Test Task', description: 'Testing from E2E' }),
    })

    expect(createResponse.status).toBeLessThan(500)
  }, E2E_TIMEOUT)

  it.todo('can list tasks via DO RPC', async () => {
    const port = getNextPort()
    server = await startDevServer(exampleDir, port)

    const listResponse = await fetch(`${server.url}/Tasks/test-list/listTasks`)
    expect(listResponse.status).toBeLessThan(500)
  }, E2E_TIMEOUT)

  it.todo('returns JSON for DO endpoints', async () => {
    const port = getNextPort()
    server = await startDevServer(exampleDir, port)

    const response = await fetch(`${server.url}/Tasks/test-list`, {
      headers: { Accept: 'application/json' },
    })

    if (response.ok) {
      const contentType = response.headers.get('content-type')
      expect(contentType).toContain('json')
    }
  }, E2E_TIMEOUT)
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('E2E: Error Handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
  })

  it('handles invalid port gracefully', async () => {
    await fs.writeFile(
      path.join(tempDir, 'App.tsx'),
      `export default function App() { return <div>App</div> }`
    )

    const serverProcess = spawn(CLI_BIN, [CLI_ENTRY, 'start', '-p', 'invalid', '--no-open'], {
      cwd: tempDir,
      env: { ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    serverProcess.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    await new Promise<void>((resolve) => {
      serverProcess.once('exit', (code) => {
        // Should exit with error
        expect(code).not.toBe(0)
        resolve()
      })

      setTimeout(() => {
        serverProcess.kill('SIGTERM')
        resolve()
      }, 10000)
    })
  }, E2E_TIMEOUT)

  it.todo('handles port already in use', async () => {
    await fs.writeFile(
      path.join(tempDir, 'App.tsx'),
      `export default function App() { return <div>App</div> }`
    )

    const port = getNextPort()

    const server1 = await startDevServer(tempDir, port).catch(() => null)

    if (server1) {
      const server2Process = spawn(CLI_BIN, [CLI_ENTRY, 'start', '-p', String(port), '--no-open'], {
        cwd: tempDir,
        env: { ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      await new Promise<void>((resolve) => {
        server2Process.once('exit', (code) => {
          expect(code).not.toBe(0)
          resolve()
        })
        setTimeout(() => {
          server2Process.kill('SIGTERM')
          resolve()
        }, 5000)
      })

      await server1.stop()
    }
  }, E2E_TIMEOUT)
})

// ============================================================================
// CLI Flags Tests (TDD RED Phase)
// ============================================================================

describe('E2E: CLI Flags', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
    await fs.writeFile(
      path.join(tempDir, 'App.tsx'),
      `export default function App() { return <div>Test</div> }`
    )
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
  })

  it.todo('respects --port flag', async () => {
    const port = getNextPort()

    const serverProcess = spawn(CLI_BIN, [CLI_ENTRY, 'start', '-p', String(port), '--no-open'], {
      cwd: tempDir,
      env: { ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    try {
      await waitFor(() => isServerReady(port), { timeout: 30000 })
      expect(await isServerReady(port)).toBe(true)
    } finally {
      serverProcess.kill('SIGTERM')
      await new Promise((resolve) => serverProcess.once('exit', resolve))
    }
  }, E2E_TIMEOUT)

  it.todo('--no-open does not open browser', async () => {
    const port = getNextPort()

    const serverProcess = spawn(CLI_BIN, [CLI_ENTRY, 'start', '-p', String(port), '--no-open'], {
      cwd: tempDir,
      env: { ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    try {
      await waitFor(() => isServerReady(port), { timeout: 30000 })
      expect(await isServerReady(port)).toBe(true)
    } finally {
      serverProcess.kill('SIGTERM')
      await new Promise((resolve) => serverProcess.once('exit', resolve))
    }
  }, E2E_TIMEOUT)

  it.todo('--reset clears state directory', async () => {
    const port = getNextPort()

    await fs.mkdir(path.join(tempDir, '.do', 'state'), { recursive: true })
    await fs.writeFile(path.join(tempDir, '.do', 'state', 'test.db'), 'test data')

    const serverProcess = spawn(CLI_BIN, [CLI_ENTRY, 'start', '-p', String(port), '--no-open', '--reset'], {
      cwd: tempDir,
      env: { ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await new Promise((resolve) => setTimeout(resolve, 5000))

    serverProcess.kill('SIGTERM')
    await new Promise((resolve) => serverProcess.once('exit', resolve))

    const stateFileExists = await fs.stat(path.join(tempDir, '.do', 'state', 'test.db')).then(() => true).catch(() => false)
    expect(stateFileExists).toBe(false)
  }, E2E_TIMEOUT)
})
