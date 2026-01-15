/**
 * TanStack Start App Scaffolding Tests
 *
 * RED phase: These tests verify the TanStack Start app structure exists
 * and is properly configured. All tests should FAIL until the GREEN phase
 * implements the actual files.
 *
 * @see https://tanstack.com/start/latest
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const APP_ROOT = path.resolve(import.meta.dirname, '../app')

describe('TanStack Start App Structure', () => {
  describe('app/routes/__root.tsx', () => {
    const rootRoutePath = path.join(APP_ROOT, 'routes/__root.tsx')

    it('should exist', () => {
      expect(fs.existsSync(rootRoutePath)).toBe(true)
    })

    it('should export Route', async () => {
      const module = await import(rootRoutePath)
      expect(module.Route).toBeDefined()
    })
  })

  describe('app/routes/index.tsx', () => {
    const indexRoutePath = path.join(APP_ROOT, 'routes/index.tsx')

    it('should exist', () => {
      expect(fs.existsSync(indexRoutePath)).toBe(true)
    })

    it('should export Route', async () => {
      const module = await import(indexRoutePath)
      expect(module.Route).toBeDefined()
    })
  })

  describe('app/routes/docs.tsx', () => {
    const docsRoutePath = path.join(APP_ROOT, 'routes/docs.tsx')

    it('should exist', () => {
      expect(fs.existsSync(docsRoutePath)).toBe(true)
    })

    it('should export Route', async () => {
      const module = await import(docsRoutePath)
      expect(module.Route).toBeDefined()
    })
  })

  describe('app/router.tsx', () => {
    const routerPath = path.join(APP_ROOT, 'router.tsx')

    it('should exist', () => {
      expect(fs.existsSync(routerPath)).toBe(true)
    })

    it('should export createRouter function', async () => {
      const module = await import(routerPath)
      expect(module.createRouter).toBeDefined()
      expect(typeof module.createRouter).toBe('function')
    })
  })

  describe('vite.config.ts', () => {
    const viteConfigPath = path.resolve(import.meta.dirname, '../vite.config.ts')

    it('should exist', () => {
      expect(fs.existsSync(viteConfigPath)).toBe(true)
    })

    it('should have tanstackStart plugin configured', async () => {
      // Read the vite config as text to check for plugin import
      const configContent = fs.readFileSync(viteConfigPath, 'utf-8')

      // Check for TanStack Start plugin import
      expect(configContent).toMatch(/@tanstack\/start/)

      // Check for plugin usage in config
      expect(configContent).toMatch(/tanstackStart|TanStackStart/)
    })
  })
})
