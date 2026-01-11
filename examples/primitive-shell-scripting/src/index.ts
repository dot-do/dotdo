/**
 * Primitive Shell Scripting Example
 *
 * Shell scripts. Zero VMs. Pennies per million.
 *
 * This example demonstrates bashx - shell execution on Cloudflare's edge
 * network without spinning up VMs. Commands are AST-parsed for safety,
 * executed in the optimal tier, and dangerous operations are blocked.
 *
 * @example
 * ```bash
 * # Start dev server
 * npm run dev
 *
 * # Build a project
 * curl -X POST http://localhost:8787/build \
 *   -H 'Content-Type: application/json' \
 *   -d '{"repo": "https://github.com/user/app"}'
 *
 * # Process an image
 * curl -X POST http://localhost:8787/image/process \
 *   -H 'Content-Type: application/json' \
 *   -d '{"url": "https://example.com/photo.jpg"}'
 *
 * # Analyze a command for safety
 * curl -X POST http://localhost:8787/analyze \
 *   -H 'Content-Type: application/json' \
 *   -d '{"command": "rm -rf /"}'
 * ```
 */

import { Hono } from 'hono'
import { ShellDO } from './ShellDO'

// Export the Durable Object class
export { ShellDO }

// ============================================================================
// APPLICATION
// ============================================================================

interface Env {
  DO: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Env }>()

// ============================================================================
// ROUTES
// ============================================================================

/**
 * Health check
 */
app.get('/', (c) => {
  return c.json({
    name: 'Primitive Shell Scripting',
    description: 'Shell scripts. Zero VMs. Pennies per million.',
    endpoints: {
      'POST /build': 'Build a project from git repository',
      'POST /pipeline': 'Run CI/CD pipeline',
      'POST /image/process': 'Process an image with ImageMagick',
      'POST /image/responsive': 'Generate responsive image variants',
      'POST /python/analyze': 'Run Python data analysis',
      'POST /python/script': 'Execute custom Python script',
      'POST /logs/analyze': 'Analyze log files',
      'POST /exec': 'Execute a shell command',
      'POST /analyze': 'Analyze command safety without executing',
      'POST /environment': 'Set up development environment'
    },
    architecture: {
      tier1: 'Native in-worker (<1ms) - cat, ls, echo, curl',
      tier2: 'RPC services (<5ms) - jq, git, npm',
      tier3: 'Dynamic modules (<10ms) - npm packages',
      tier4: 'Full sandbox (2-3s cold) - bash, python, ffmpeg'
    }
  })
})

/**
 * Build a project from git repository
 *
 * @example
 * curl -X POST http://localhost:8787/build \
 *   -d '{"repo": "https://github.com/user/app"}'
 */
app.post('/build', async (c) => {
  const { repo } = await c.req.json<{ repo: string }>()

  if (!repo) {
    return c.json({ error: 'Missing repo URL' }, 400)
  }

  const id = c.env.DO.idFromName('shell')
  const stub = c.env.DO.get(id)

  const result = await stub.fetch(new Request('http://do/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo })
  }))

  return c.json(await result.json())
})

/**
 * Run CI/CD pipeline
 *
 * @example
 * curl -X POST http://localhost:8787/pipeline \
 *   -d '{"lint": true, "test": true, "build": true}'
 */
app.post('/pipeline', async (c) => {
  const options = await c.req.json<{
    lint?: boolean
    test?: boolean
    build?: boolean
    deploy?: boolean
  }>()

  const id = c.env.DO.idFromName('shell')
  const stub = c.env.DO.get(id)

  const result = await stub.fetch(new Request('http://do/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  }))

  return c.json(await result.json())
})

/**
 * Process an image with ImageMagick
 *
 * @example
 * curl -X POST http://localhost:8787/image/process \
 *   -d '{"url": "https://example.com/photo.jpg"}'
 */
app.post('/image/process', async (c) => {
  const { url } = await c.req.json<{ url: string }>()

  if (!url) {
    return c.json({ error: 'Missing image URL' }, 400)
  }

  const id = c.env.DO.idFromName('shell')
  const stub = c.env.DO.get(id)

  const result = await stub.fetch(new Request('http://do/image/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  }))

  return c.json(await result.json())
})

/**
 * Generate responsive image variants
 *
 * @example
 * curl -X POST http://localhost:8787/image/responsive \
 *   -d '{"path": "hero.jpg", "widths": [320, 640, 1024, 1920]}'
 */
app.post('/image/responsive', async (c) => {
  const { path, widths } = await c.req.json<{ path: string; widths: number[] }>()

  if (!path || !widths) {
    return c.json({ error: 'Missing path or widths' }, 400)
  }

  const id = c.env.DO.idFromName('shell')
  const stub = c.env.DO.get(id)

  const result = await stub.fetch(new Request('http://do/image/responsive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, widths })
  }))

  return c.json(await result.json())
})

/**
 * Run Python data analysis
 *
 * @example
 * curl -X POST http://localhost:8787/python/analyze \
 *   -d '{"values": [1, 2, 3, 4, 5]}'
 */
app.post('/python/analyze', async (c) => {
  const data = await c.req.json()

  const id = c.env.DO.idFromName('shell')
  const stub = c.env.DO.get(id)

  const result = await stub.fetch(new Request('http://do/python/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }))

  return c.json(await result.json())
})

/**
 * Execute custom Python script
 *
 * @example
 * curl -X POST http://localhost:8787/python/script \
 *   -d '{"script": "print(2 + 2)", "args": []}'
 */
app.post('/python/script', async (c) => {
  const { script, args } = await c.req.json<{ script: string; args?: string[] }>()

  if (!script) {
    return c.json({ error: 'Missing script' }, 400)
  }

  const id = c.env.DO.idFromName('shell')
  const stub = c.env.DO.get(id)

  const result = await stub.fetch(new Request('http://do/python/script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script, args: args || [] })
  }))

  return c.json(await result.json())
})

/**
 * Analyze log files
 *
 * @example
 * curl -X POST http://localhost:8787/logs/analyze \
 *   -d '{"path": "access.log", "pattern": "ERROR"}'
 */
app.post('/logs/analyze', async (c) => {
  const { path, pattern } = await c.req.json<{ path: string; pattern: string }>()

  if (!path || !pattern) {
    return c.json({ error: 'Missing path or pattern' }, 400)
  }

  const id = c.env.DO.idFromName('shell')
  const stub = c.env.DO.get(id)

  const result = await stub.fetch(new Request('http://do/logs/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, pattern })
  }))

  return c.json(await result.json())
})

/**
 * Execute a shell command (with safety checks)
 *
 * @example
 * curl -X POST http://localhost:8787/exec \
 *   -d '{"command": "ls -la"}'
 */
app.post('/exec', async (c) => {
  const { command, confirm } = await c.req.json<{ command: string; confirm?: boolean }>()

  if (!command) {
    return c.json({ error: 'Missing command' }, 400)
  }

  const id = c.env.DO.idFromName('shell')
  const stub = c.env.DO.get(id)

  const result = await stub.fetch(new Request('http://do/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, confirm })
  }))

  return c.json(await result.json())
})

/**
 * Analyze command safety without executing
 *
 * @example
 * curl -X POST http://localhost:8787/analyze \
 *   -d '{"command": "rm -rf /"}'
 *
 * Response:
 * {
 *   "classification": {
 *     "type": "delete",
 *     "impact": "critical",
 *     "reversible": false,
 *     "reason": "Recursive delete targeting root filesystem"
 *   },
 *   "dangerous": true,
 *   "dangerReason": "Recursive delete targeting root filesystem"
 * }
 */
app.post('/analyze', async (c) => {
  const { command } = await c.req.json<{ command: string }>()

  if (!command) {
    return c.json({ error: 'Missing command' }, 400)
  }

  const id = c.env.DO.idFromName('shell')
  const stub = c.env.DO.get(id)

  const result = await stub.fetch(new Request('http://do/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command })
  }))

  return c.json(await result.json())
})

/**
 * Set up development environment
 *
 * @example
 * curl -X POST http://localhost:8787/environment \
 *   -d '{"node": "20", "packages": ["typescript", "vitest"]}'
 */
app.post('/environment', async (c) => {
  const config = await c.req.json<{
    node?: string
    python?: string
    packages?: string[]
    env?: Record<string, string>
  }>()

  const id = c.env.DO.idFromName('shell')
  const stub = c.env.DO.get(id)

  const result = await stub.fetch(new Request('http://do/environment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  }))

  return c.json(await result.json())
})

// ============================================================================
// EXPORT
// ============================================================================

export default app
