/**
 * CLI Router Tests (TDD RED Phase)
 *
 * Tests for CLI entry point and command routing.
 * These tests are written BEFORE implementation exists and should FAIL.
 *
 * Test coverage:
 * - `do` with no args shows help
 * - `do --help` and `do -h` show help
 * - `do --version` shows version
 * - Known commands route to handlers
 * - Unknown commands fall through to AI fallback
 * - Commands receive correct args array
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { route, parseArgv, helpText, version } from '../index'
import { commands } from '../commands'
// Note: bin.ts is imported dynamically in tests due to Commander dependency chain
import { fallback } from '../fallback'
import pkg from '../../package.json'

// Types for the CLI structure (these don't exist yet)
type CommandHandler = (args: string[]) => Promise<void> | void
type CommandRegistry = Map<string, CommandHandler>
type RouteResult =
  | { type: 'help' }
  | { type: 'version' }
  | { type: 'command'; name: string; args: string[] }
  | { type: 'fallback'; input: string[] }

describe('CLI Router', () => {
  // Mock command handlers
  const mockHandlers = {
    login: vi.fn(),
    logout: vi.fn(),
    dev: vi.fn(),
    build: vi.fn(),
    deploy: vi.fn(),
    init: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Help Display', () => {
    it('shows help when invoked with no arguments', () => {
      const result = route([])
      expect(result).toEqual({ type: 'help' })
    })

    it('shows help when invoked with --help flag', () => {
      const result = route(['--help'])
      expect(result).toEqual({ type: 'help' })
    })

    it('shows help when invoked with -h flag', () => {
      const result = route(['-h'])
      expect(result).toEqual({ type: 'help' })
    })

    it('shows help when help command is used', () => {
      const result = route(['help'])
      expect(result).toEqual({ type: 'help' })
    })
  })

  describe('Version Display', () => {
    it('shows version when invoked with --version flag', () => {
      const result = route(['--version'])
      expect(result).toEqual({ type: 'version' })
    })

    it('shows version when invoked with -v flag', () => {
      const result = route(['-v'])
      expect(result).toEqual({ type: 'version' })
    })
  })

  describe('Command Routing', () => {
    it('routes login command to login handler', () => {
      const result = route(['login'])
      expect(result).toEqual({ type: 'command', name: 'login', args: [] })
    })

    it('routes logout command to logout handler', () => {
      const result = route(['logout'])
      expect(result).toEqual({ type: 'command', name: 'logout', args: [] })
    })

    it('routes dev command to dev handler', () => {
      const result = route(['dev'])
      expect(result).toEqual({ type: 'command', name: 'dev', args: [] })
    })

    it('routes build command to build handler', () => {
      const result = route(['build'])
      expect(result).toEqual({ type: 'command', name: 'build', args: [] })
    })

    it('routes deploy command to deploy handler', () => {
      const result = route(['deploy'])
      expect(result).toEqual({ type: 'command', name: 'deploy', args: [] })
    })

    it('routes init command to init handler', () => {
      const result = route(['init'])
      expect(result).toEqual({ type: 'command', name: 'init', args: [] })
    })
  })

  describe('Argument Passing', () => {
    it('passes arguments to dev command correctly', () => {
      const result = route(['dev', '--port', '3000'])
      expect(result).toEqual({
        type: 'command',
        name: 'dev',
        args: ['--port', '3000'],
      })
    })

    it('passes multiple arguments to build command', () => {
      const result = route(['build', '--minify', '--sourcemap', '--outdir', 'dist'])
      expect(result).toEqual({
        type: 'command',
        name: 'build',
        args: ['--minify', '--sourcemap', '--outdir', 'dist'],
      })
    })

    it('passes arguments with values correctly', () => {
      const result = route(['deploy', '--env', 'production', '--workers', '4'])
      expect(result).toEqual({
        type: 'command',
        name: 'deploy',
        args: ['--env', 'production', '--workers', '4'],
      })
    })

    it('handles positional arguments', () => {
      const result = route(['init', 'my-project', '--template', 'basic'])
      expect(result).toEqual({
        type: 'command',
        name: 'init',
        args: ['my-project', '--template', 'basic'],
      })
    })
  })

  describe('AI Fallback', () => {
    it('falls through to AI for unknown commands', () => {
      const result = route(['unknown-command'])
      expect(result).toEqual({ type: 'fallback', input: ['unknown-command'] })
    })

    it('falls through to AI for natural language input', () => {
      const result = route(['create', 'a', 'new', 'react', 'component'])
      expect(result).toEqual({
        type: 'fallback',
        input: ['create', 'a', 'new', 'react', 'component'],
      })
    })

    it('falls through to AI for commands starting with common phrases', () => {
      const result = route(['help', 'me', 'debug', 'this', 'error'])
      expect(result).toEqual({
        type: 'fallback',
        input: ['help', 'me', 'debug', 'this', 'error'],
      })
    })

    it('falls through to AI for question-like input', () => {
      const result = route(['what', 'is', 'wrong', 'with', 'my', 'code'])
      expect(result).toEqual({
        type: 'fallback',
        input: ['what', 'is', 'wrong', 'with', 'my', 'code'],
      })
    })

    it('falls through to AI for multi-word unknown commands', () => {
      const result = route(['fix', 'the', 'bug', 'in', 'main.ts'])
      expect(result).toEqual({
        type: 'fallback',
        input: ['fix', 'the', 'bug', 'in', 'main.ts'],
      })
    })
  })

  describe('Argv Parsing', () => {
    it('parseArgv strips node and script path from process.argv', () => {
      // Simulating process.argv: ['node', '/path/to/bin.ts', 'dev', '--port', '3000']
      const parsed = parseArgv(['node', '/path/to/bin.ts', 'dev', '--port', '3000'])
      expect(parsed).toEqual(['dev', '--port', '3000'])
    })

    it('parseArgv handles empty argv after stripping', () => {
      const parsed = parseArgv(['node', '/path/to/bin.ts'])
      expect(parsed).toEqual([])
    })

    it('parseArgv handles bun runtime path', () => {
      const parsed = parseArgv(['bun', '/path/to/bin.ts', 'login'])
      expect(parsed).toEqual(['login'])
    })
  })

  describe('Command Registry', () => {
    it('exports a command registry with known commands', () => {
      expect(commands).toBeDefined()
      expect(commands instanceof Map || typeof commands === 'object').toBe(true)
    })

    it('has login command registered', () => {
      expect(commands.has?.('login') ?? 'login' in commands).toBe(true)
    })

    it('has dev command registered', () => {
      expect(commands.has?.('dev') ?? 'dev' in commands).toBe(true)
    })

    it('has build command registered', () => {
      expect(commands.has?.('build') ?? 'build' in commands).toBe(true)
    })

    it('has deploy command registered', () => {
      expect(commands.has?.('deploy') ?? 'deploy' in commands).toBe(true)
    })

    it('has init command registered', () => {
      expect(commands.has?.('init') ?? 'init' in commands).toBe(true)
    })
  })

  describe('Entry Point (main.ts)', () => {
    it('exports a Commander program', async () => {
      // main.ts exports the Commander program for CLI usage
      // bin.ts imports and uses this program
      const mainModule = await import('../main')
      expect(mainModule.program).toBeDefined()
      expect(mainModule.program.name()).toBe('dotdo')
    })

    it('program has all expected commands', async () => {
      const mainModule = await import('../main')
      const commandNames = mainModule.program.commands.map((cmd: { name: () => string }) => cmd.name())

      // Dev commands
      expect(commandNames).toContain('start')
      expect(commandNames).toContain('dev')
      expect(commandNames).toContain('deploy')

      // Service commands
      expect(commandNames).toContain('call')
      expect(commandNames).toContain('text')
      expect(commandNames).toContain('email')
      expect(commandNames).toContain('charge')
      expect(commandNames).toContain('queue')
      expect(commandNames).toContain('llm')
      expect(commandNames).toContain('config')
    })
  })

  describe('Fallback Handler', () => {
    it('exports a fallback handler', () => {
      expect(fallback).toBeDefined()
      expect(typeof fallback).toBe('function')
    })

    it('fallback handler accepts string array input', async () => {
      // Should not throw when called with array of strings
      await expect(fallback(['some', 'natural', 'language', 'input'])).resolves.not.toThrow()
    })
  })

  describe('Help Text Content', () => {
    it('exports help text', () => {
      expect(helpText).toBeDefined()
      expect(typeof helpText).toBe('string')
    })

    it('help text includes usage information', () => {
      expect(helpText).toContain('Usage')
    })

    it('help text includes available commands', () => {
      expect(helpText).toContain('Commands')
      expect(helpText).toContain('login')
      expect(helpText).toContain('dev')
      expect(helpText).toContain('build')
      expect(helpText).toContain('deploy')
    })

    it('help text includes AI fallback mention', () => {
      // Should mention that unrecognized commands go to AI
      expect(helpText.toLowerCase()).toMatch(/ai|natural language|fallback/)
    })
  })

  describe('Version Information', () => {
    it('exports version string', () => {
      expect(version).toBeDefined()
      expect(typeof version).toBe('string')
    })

    it('version matches package.json', () => {
      expect(version).toBe(pkg.version)
    })
  })
})

/**
 * Surface Router Tests (TDD RED Phase)
 *
 * Tests for multi-surface HTTP routing.
 * Routes discovered surfaces to their respective URL paths:
 * - Site -> / (root)
 * - App -> /app/*
 * - Admin -> /admin/*
 * - Docs -> /docs/*
 * - Blog -> /blog/*
 */
describe('Surface Router', () => {
  // Import the router factory - this doesn't exist yet (RED phase)
  let createSurfaceRouter: typeof import('../runtime/surface-router').createSurfaceRouter

  beforeEach(async () => {
    vi.clearAllMocks()
    const module = await import('../runtime/surface-router')
    createSurfaceRouter = module.createSurfaceRouter
  })

  // Mock render function that returns surface name in response
  const mockRenderSurface = vi.fn(async (surfacePath: string, _request: Request) => {
    // Extract surface name from path for easy testing
    const surfaceName = surfacePath.split('/').pop()?.replace(/\.(tsx|mdx)$/, '') ?? 'unknown'
    return new Response(`Rendered: ${surfaceName}`, {
      headers: { 'Content-Type': 'text/html' },
    })
  })

  describe('Site surface at root (/)', () => {
    it('GET / returns Site surface content when Site exists', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: '/project/Site.tsx',
          App: null,
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: Site')
      expect(mockRenderSurface).toHaveBeenCalledWith('/project/Site.tsx', request)
    })

    it('GET / returns 404 when no Site surface exists and no App fallback', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: null,
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/')
      const response = await router.fetch(request)

      expect(response.status).toBe(404)
      expect(mockRenderSurface).not.toHaveBeenCalled()
    })

    it('GET / returns App surface when no Site but App exists', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: '/project/App.tsx',
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: App')
      expect(mockRenderSurface).toHaveBeenCalledWith('/project/App.tsx', request)
    })
  })

  describe('App surface (/app/*)', () => {
    it('GET /app routes to App surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: '/project/Site.tsx',
          App: '/project/App.tsx',
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/app')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: App')
      expect(mockRenderSurface).toHaveBeenCalledWith('/project/App.tsx', request)
    })

    it('GET /app/dashboard routes to App surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: '/project/Site.tsx',
          App: '/project/App.tsx',
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/app/dashboard')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: App')
    })

    it('GET /app/* returns 404 when App surface not configured', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: '/project/Site.tsx',
          App: null,
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/app/dashboard')
      const response = await router.fetch(request)

      expect(response.status).toBe(404)
    })
  })

  describe('Admin surface (/admin/*)', () => {
    it('GET /admin routes to Admin surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: null,
          Admin: '/project/Admin.tsx',
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/admin')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: Admin')
      expect(mockRenderSurface).toHaveBeenCalledWith('/project/Admin.tsx', request)
    })

    it('GET /admin/users routes to Admin surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: null,
          Admin: '/project/Admin.tsx',
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/admin/users')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: Admin')
    })

    it('GET /admin/* returns 404 when Admin surface not configured', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: null,
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/admin/settings')
      const response = await router.fetch(request)

      expect(response.status).toBe(404)
    })
  })

  describe('Docs surface (/docs/*)', () => {
    it('GET /docs routes to Docs surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: null,
          Admin: null,
          Docs: '/project/Docs.mdx',
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/docs')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: Docs')
      expect(mockRenderSurface).toHaveBeenCalledWith('/project/Docs.mdx', request)
    })

    it('GET /docs/getting-started routes to Docs surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: null,
          Admin: null,
          Docs: '/project/Docs.mdx',
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/docs/getting-started')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: Docs')
    })

    it('GET /docs/* returns 404 when Docs surface not configured', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: null,
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/docs/api')
      const response = await router.fetch(request)

      expect(response.status).toBe(404)
    })
  })

  describe('Blog surface (/blog/*)', () => {
    it('GET /blog routes to Blog surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: null,
          Admin: null,
          Docs: null,
          Blog: '/project/Blog.tsx',
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/blog')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: Blog')
      expect(mockRenderSurface).toHaveBeenCalledWith('/project/Blog.tsx', request)
    })

    it('GET /blog/my-first-post routes to Blog surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: null,
          Admin: null,
          Docs: null,
          Blog: '/project/Blog.tsx',
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/blog/my-first-post')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: Blog')
    })

    it('GET /blog/* returns 404 when Blog surface not configured', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: null,
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/blog/hello')
      const response = await router.fetch(request)

      expect(response.status).toBe(404)
    })
  })

  describe('Unknown routes (404 fallback)', () => {
    it('GET /unknown returns 404', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: '/project/Site.tsx',
          App: '/project/App.tsx',
          Admin: '/project/Admin.tsx',
          Docs: '/project/Docs.mdx',
          Blog: '/project/Blog.tsx',
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/unknown')
      const response = await router.fetch(request)

      expect(response.status).toBe(404)
      expect(await response.text()).toBe('Not Found')
    })

    it('GET /api/something returns 404 (not a surface path)', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: '/project/Site.tsx',
          App: '/project/App.tsx',
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/api/something')
      const response = await router.fetch(request)

      expect(response.status).toBe(404)
    })

    it('GET /random/nested/path returns 404', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: '/project/Site.tsx',
          App: null,
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/random/nested/path')
      const response = await router.fetch(request)

      expect(response.status).toBe(404)
    })
  })

  describe('Site surface at /site/* path', () => {
    it('GET /site routes to Site surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: '/project/Site.tsx',
          App: null,
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/site')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: Site')
    })

    it('GET /site/about routes to Site surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: '/project/Site.tsx',
          App: null,
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/site/about')
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Rendered: Site')
    })
  })

  describe('All surfaces configured', () => {
    it('routes all surfaces correctly when all are configured', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: '/project/Site.tsx',
          App: '/project/App.tsx',
          Admin: '/project/Admin.tsx',
          Docs: '/project/Docs.mdx',
          Blog: '/project/Blog.tsx',
        },
        renderSurface: mockRenderSurface,
      })

      // Test each surface route
      const routes = [
        { path: '/', expected: 'Site' },
        { path: '/site/pricing', expected: 'Site' },
        { path: '/app', expected: 'App' },
        { path: '/app/settings', expected: 'App' },
        { path: '/admin', expected: 'Admin' },
        { path: '/admin/dashboard', expected: 'Admin' },
        { path: '/docs', expected: 'Docs' },
        { path: '/docs/api/reference', expected: 'Docs' },
        { path: '/blog', expected: 'Blog' },
        { path: '/blog/2024/01/hello', expected: 'Blog' },
      ]

      for (const { path, expected } of routes) {
        mockRenderSurface.mockClear()
        const request = new Request(`http://localhost${path}`)
        const response = await router.fetch(request)
        expect(response.status).toBe(200)
        expect(await response.text()).toBe(`Rendered: ${expected}`)
      }
    })
  })

  describe('HTTP methods', () => {
    it('handles POST requests to App surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: '/project/App.tsx',
          Admin: null,
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/app/submit', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      })
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
    })

    it('handles PUT requests to Admin surface', async () => {
      const router = createSurfaceRouter({
        surfaces: {
          Site: null,
          App: null,
          Admin: '/project/Admin.tsx',
          Docs: null,
          Blog: null,
        },
        renderSurface: mockRenderSurface,
      })

      const request = new Request('http://localhost/admin/users/1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Updated' }),
      })
      const response = await router.fetch(request)

      expect(response.status).toBe(200)
    })
  })
})
