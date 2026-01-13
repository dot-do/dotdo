/**
 * Tests for do/app.ts - Static MDX-based Application Framework
 *
 * The app entry point exports a Hono app that:
 * - Serves static assets via ASSETS binding
 * - Handles SPA routing with index.html fallback
 * - Provides default HTML when no ASSETS binding
 */

import { describe, it, expect, vi } from 'vitest'

// Import the app
import { app, type AppEnv } from '../app'

describe('do/app.ts - Hono Application', () => {
  describe('App Export', () => {
    it('exports app', () => {
      expect(app).toBeDefined()
    })

    it('app is a Hono instance', () => {
      expect(typeof app.fetch).toBe('function')
    })

    it('app has route methods', () => {
      expect(typeof app.get).toBe('function')
      expect(typeof app.post).toBe('function')
      expect(typeof app.put).toBe('function')
      expect(typeof app.delete).toBe('function')
    })
  })

  describe('Static Assets Route', () => {
    it('handles /assets/* path', async () => {
      const mockAssets = {
        fetch: vi.fn().mockResolvedValue(new Response('asset content', { status: 200 })),
      }

      const request = new Request('http://test/assets/script.js')
      const env: AppEnv = { ASSETS: mockAssets as unknown as Fetcher }

      const response = await app.fetch(request, env)

      expect(mockAssets.fetch).toHaveBeenCalled()
      expect(response.status).toBe(200)
    })

    it('returns 404 when ASSETS binding not available', async () => {
      const request = new Request('http://test/assets/script.js')
      const env: AppEnv = {}

      const response = await app.fetch(request, env)

      expect(response.status).toBe(404)
    })
  })

  describe('SPA Routing', () => {
    it('serves exact path from ASSETS when available', async () => {
      const mockAssets = {
        fetch: vi.fn().mockResolvedValue(new Response('page content', { status: 200 })),
      }

      const request = new Request('http://test/some/path')
      const env: AppEnv = { ASSETS: mockAssets as unknown as Fetcher }

      const response = await app.fetch(request, env)

      expect(mockAssets.fetch).toHaveBeenCalled()
      expect(response.status).toBe(200)
    })

    it('falls back to index.html for SPA routing', async () => {
      let callCount = 0
      const mockAssets = {
        fetch: vi.fn().mockImplementation((req: Request) => {
          callCount++
          // First call: exact path (not found)
          // Second call: index.html (found)
          if (callCount === 1) {
            return Promise.resolve(new Response('Not Found', { status: 404 }))
          }
          return Promise.resolve(new Response('<html></html>', { status: 200 }))
        }),
      }

      const request = new Request('http://test/app/dashboard')
      const env: AppEnv = { ASSETS: mockAssets as unknown as Fetcher }

      const response = await app.fetch(request, env)

      expect(mockAssets.fetch).toHaveBeenCalled()
      // Should have tried the path first, then index.html
      expect(callCount).toBe(2)
      expect(response.status).toBe(200)
    })
  })

  describe('Default HTML Response', () => {
    it('returns default HTML when no ASSETS binding', async () => {
      const request = new Request('http://test/')
      const env: AppEnv = {}

      const response = await app.fetch(request, env)

      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('dotdo')
    })

    it('default HTML contains configuration instructions', async () => {
      const request = new Request('http://test/app')
      const env: AppEnv = {}

      const response = await app.fetch(request, env)

      const html = await response.text()
      expect(html).toContain('wrangler.jsonc')
      expect(html).toContain('ASSETS')
    })

    it('default HTML has correct content type', async () => {
      const request = new Request('http://test/')
      const env: AppEnv = {}

      const response = await app.fetch(request, env)

      // Hono's c.html() sets content-type to text/html
      const contentType = response.headers.get('content-type')
      expect(contentType).toContain('text/html')
    })
  })

  describe('Route Priority', () => {
    it('/assets/* is matched before catch-all', async () => {
      const assetFetch = vi.fn().mockResolvedValue(new Response('asset', { status: 200 }))
      const mockAssets = { fetch: assetFetch }

      const request = new Request('http://test/assets/style.css')
      const env: AppEnv = { ASSETS: mockAssets as unknown as Fetcher }

      await app.fetch(request, env)

      // Should have called ASSETS.fetch
      expect(assetFetch).toHaveBeenCalled()
    })
  })
})
