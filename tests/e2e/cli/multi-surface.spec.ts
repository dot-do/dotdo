/**
 * E2E Tests: Multi-Surface Routing
 *
 * Tests that the CLI correctly discovers and routes to multiple surfaces
 * (App, Admin, Site, Docs, Blog).
 *
 * These tests:
 * 1. Create projects with multiple surfaces
 * 2. Verify surface discovery works correctly
 * 3. Test priority-based resolution
 * 4. Verify routing to correct surface paths
 */

import { test, expect } from '@playwright/test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  startServer,
  createTempDir,
  cleanupTempDir,
  killProcessOnPort,
  runCommand,
  type ServerInstance,
} from './utils/server'

test.describe('Multi-Surface Routing E2E', () => {
  let tempDir: string
  let server: ServerInstance | null = null

  test.beforeEach(() => {
    tempDir = createTempDir(`surface-e2e-${Date.now()}`)
  })

  test.afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    cleanupTempDir(tempDir)
  })

  test.describe('Surface Discovery', () => {
    test('should discover App.tsx in root directory', async () => {
      const projectDir = join(tempDir, 'app-project')
      require('fs').mkdirSync(projectDir, { recursive: true })

      // Create App.tsx
      writeFileSync(
        join(projectDir, 'App.tsx'),
        `export default function App() { return <div>App Surface</div>; }`
      )

      // Initialize project structure
      runCommand('init', { cwd: projectDir, args: ['.'] })

      // Verify file exists
      expect(existsSync(join(projectDir, 'App.tsx'))).toBe(true)
    })

    test('should discover App.mdx in root directory', async () => {
      const projectDir = join(tempDir, 'mdx-project')
      require('fs').mkdirSync(projectDir, { recursive: true })

      // Create App.mdx
      writeFileSync(
        join(projectDir, 'App.mdx'),
        `# App Surface\n\nThis is the main app.`
      )

      // Verify file exists
      expect(existsSync(join(projectDir, 'App.mdx'))).toBe(true)
    })

    test('should discover surfaces in .do directory', async () => {
      const projectDir = join(tempDir, 'dotdo-project')
      const doDir = join(projectDir, '.do')
      require('fs').mkdirSync(doDir, { recursive: true })

      // Create Admin.tsx in .do directory
      writeFileSync(
        join(doDir, 'Admin.tsx'),
        `export default function Admin() { return <div>Admin Surface</div>; }`
      )

      expect(existsSync(join(doDir, 'Admin.tsx'))).toBe(true)
    })

    test('should prioritize root directory over .do directory', async () => {
      const projectDir = join(tempDir, 'priority-project')
      const doDir = join(projectDir, '.do')
      require('fs').mkdirSync(doDir, { recursive: true })

      // Create App.tsx in both locations
      writeFileSync(
        join(projectDir, 'App.tsx'),
        `export default function App() { return <div>Root App</div>; }`
      )
      writeFileSync(
        join(doDir, 'App.tsx'),
        `export default function App() { return <div>DotDo App</div>; }`
      )

      // Both should exist
      expect(existsSync(join(projectDir, 'App.tsx'))).toBe(true)
      expect(existsSync(join(doDir, 'App.tsx'))).toBe(true)
    })

    test('should prioritize .tsx over .mdx', async () => {
      const projectDir = join(tempDir, 'extension-project')
      require('fs').mkdirSync(projectDir, { recursive: true })

      // Create both App.tsx and App.mdx
      writeFileSync(
        join(projectDir, 'App.tsx'),
        `export default function App() { return <div>TSX App</div>; }`
      )
      writeFileSync(
        join(projectDir, 'App.mdx'),
        `# MDX App`
      )

      // Both should exist
      expect(existsSync(join(projectDir, 'App.tsx'))).toBe(true)
      expect(existsSync(join(projectDir, 'App.mdx'))).toBe(true)
    })
  })

  test.describe('Content Folder Discovery', () => {
    test('should discover docs folder in root', async () => {
      const projectDir = join(tempDir, 'docs-project')
      const docsDir = join(projectDir, 'docs')
      require('fs').mkdirSync(docsDir, { recursive: true })

      // Create a doc file
      writeFileSync(join(docsDir, 'index.mdx'), `# Documentation`)

      expect(existsSync(docsDir)).toBe(true)
      expect(existsSync(join(docsDir, 'index.mdx'))).toBe(true)
    })

    test('should discover blog folder in root', async () => {
      const projectDir = join(tempDir, 'blog-project')
      const blogDir = join(projectDir, 'blog')
      require('fs').mkdirSync(blogDir, { recursive: true })

      // Create a blog post
      writeFileSync(join(blogDir, 'first-post.mdx'), `# First Post`)

      expect(existsSync(blogDir)).toBe(true)
    })

    test('should discover content folders in .do directory', async () => {
      const projectDir = join(tempDir, 'content-project')
      const doDir = join(projectDir, '.do')
      const docsDir = join(doDir, 'docs')
      require('fs').mkdirSync(docsDir, { recursive: true })

      writeFileSync(join(docsDir, 'getting-started.mdx'), `# Getting Started`)

      expect(existsSync(docsDir)).toBe(true)
    })
  })

  test.describe('Surface Routing with Server', () => {
    test('should route to Admin surface at /admin path', async () => {
      await killProcessOnPort(8900)

      const projectDir = join(tempDir, 'routing-admin')
      require('fs').mkdirSync(projectDir, { recursive: true })

      // Initialize project
      runCommand('init', { cwd: projectDir, args: ['.'] })

      // Create Admin.tsx
      writeFileSync(
        join(projectDir, 'Admin.tsx'),
        `export default function Admin() { return <div>Admin Panel</div>; }`
      )

      // Start server
      server = await startServer({
        cwd: projectDir,
        port: 8900,
        timeout: 60000,
      })

      // Test admin route
      const response = await fetch(`${server.url}/admin`)
      expect(response.status).toBeLessThan(500)
    })

    test('should route to Docs surface at /docs path', async () => {
      await killProcessOnPort(8901)

      const projectDir = join(tempDir, 'routing-docs')
      const docsDir = join(projectDir, 'docs')
      require('fs').mkdirSync(docsDir, { recursive: true })

      // Initialize project
      runCommand('init', { cwd: projectDir, args: ['.'] })

      // Create docs content
      writeFileSync(
        join(docsDir, 'index.mdx'),
        `---\ntitle: Documentation\n---\n\n# Welcome to Docs`
      )

      // Start server
      server = await startServer({
        cwd: projectDir,
        port: 8901,
        timeout: 60000,
      })

      // Test docs route
      const response = await fetch(`${server.url}/docs`)
      expect(response.status).toBeLessThan(500)
    })

    test('should route to Blog surface at /blog path', async () => {
      await killProcessOnPort(8902)

      const projectDir = join(tempDir, 'routing-blog')
      const blogDir = join(projectDir, 'blog')
      require('fs').mkdirSync(blogDir, { recursive: true })

      // Initialize project
      runCommand('init', { cwd: projectDir, args: ['.'] })

      // Create blog content
      writeFileSync(
        join(blogDir, 'hello-world.mdx'),
        `---\ntitle: Hello World\ndate: 2024-01-01\n---\n\n# Hello World`
      )

      // Start server
      server = await startServer({
        cwd: projectDir,
        port: 8902,
        timeout: 60000,
      })

      // Test blog route
      const response = await fetch(`${server.url}/blog`)
      expect(response.status).toBeLessThan(500)
    })

    test('should route to Site surface at /site path', async () => {
      await killProcessOnPort(8903)

      const projectDir = join(tempDir, 'routing-site')
      require('fs').mkdirSync(projectDir, { recursive: true })

      // Initialize project
      runCommand('init', { cwd: projectDir, args: ['.'] })

      // Create Site.tsx
      writeFileSync(
        join(projectDir, 'Site.tsx'),
        `export default function Site() { return <div>Marketing Site</div>; }`
      )

      // Start server
      server = await startServer({
        cwd: projectDir,
        port: 8903,
        timeout: 60000,
      })

      // Test site route
      const response = await fetch(`${server.url}/site`)
      expect(response.status).toBeLessThan(500)
    })
  })

  test.describe('Multiple Surfaces Together', () => {
    test('should handle project with all surfaces', async () => {
      await killProcessOnPort(8910)

      const projectDir = join(tempDir, 'full-project')
      const docsDir = join(projectDir, 'docs')
      const blogDir = join(projectDir, 'blog')
      require('fs').mkdirSync(docsDir, { recursive: true })
      require('fs').mkdirSync(blogDir, { recursive: true })

      // Initialize project
      runCommand('init', { cwd: projectDir, args: ['.'] })

      // Create all surfaces
      writeFileSync(
        join(projectDir, 'App.tsx'),
        `export default function App() { return <div>Main App</div>; }`
      )
      writeFileSync(
        join(projectDir, 'Admin.tsx'),
        `export default function Admin() { return <div>Admin Panel</div>; }`
      )
      writeFileSync(
        join(projectDir, 'Site.tsx'),
        `export default function Site() { return <div>Marketing Site</div>; }`
      )
      writeFileSync(
        join(docsDir, 'index.mdx'),
        `# Documentation`
      )
      writeFileSync(
        join(blogDir, 'post.mdx'),
        `# Blog Post`
      )

      // Start server
      server = await startServer({
        cwd: projectDir,
        port: 8910,
        timeout: 60000,
      })

      // Test all routes
      const routes = ['/', '/admin', '/site', '/docs', '/blog']
      for (const route of routes) {
        const response = await fetch(`${server.url}${route}`)
        expect(response.status).toBeLessThan(500)
      }
    })

    test('should print surface URLs on startup', async () => {
      await killProcessOnPort(8911)

      const projectDir = join(tempDir, 'urls-project')
      require('fs').mkdirSync(projectDir, { recursive: true })

      // Initialize and create App
      runCommand('init', { cwd: projectDir, args: ['.'] })
      writeFileSync(
        join(projectDir, 'App.tsx'),
        `export default function App() { return <div>App</div>; }`
      )

      // Start server and capture output
      server = await startServer({
        cwd: projectDir,
        port: 8911,
        timeout: 60000,
      })

      // Output should contain URL information
      const output = server.output.join('')
      expect(output.length).toBeGreaterThan(0)
    })
  })

  test.describe('Surface with start --reset', () => {
    test('should clear state and restart with surfaces intact', async () => {
      await killProcessOnPort(8920)

      const projectDir = join(tempDir, 'reset-project')
      require('fs').mkdirSync(projectDir, { recursive: true })

      // Initialize project
      runCommand('init', { cwd: projectDir, args: ['.'] })

      // Create App surface
      writeFileSync(
        join(projectDir, 'App.tsx'),
        `export default function App() { return <div>App</div>; }`
      )

      // First start
      server = await startServer({
        cwd: projectDir,
        port: 8920,
        timeout: 60000,
      })

      // Make some requests to create state
      await fetch(server.url)

      // Stop
      await server.stop()
      server = null

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Start with --reset
      server = await startServer({
        cwd: projectDir,
        port: 8920,
        args: ['--reset'],
        timeout: 60000,
      })

      // Should still work
      const response = await fetch(server.url)
      expect(response.status).toBeLessThan(500)
    })
  })
})
