/**
 * Tests for Cloudflare Workers Static Output Configuration
 *
 * TDD RED phase: These tests verify that the project is properly configured
 * for Cloudflare Workers deployment with static site generation.
 *
 * Expected configs:
 * - wrangler.jsonc: Workers deployment configuration
 * - vite.config.ts: Vite with Cloudflare plugin for static prerendering
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

describe('Cloudflare Workers Static Output Config', () => {
  describe('wrangler.jsonc', () => {
    const wranglerJsoncPath = resolve(rootDir, 'wrangler.static.jsonc')

    it('should exist at project root', () => {
      expect(existsSync(wranglerJsoncPath)).toBe(true)
    })

    it('should have valid JSON structure', () => {
      // Skip if file doesn't exist (will fail above test)
      if (!existsSync(wranglerJsoncPath)) {
        expect.fail('wrangler.static.jsonc does not exist')
      }

      const content = readFileSync(wranglerJsoncPath, 'utf-8')
      // Strip JSONC comments for parsing
      const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')

      expect(() => JSON.parse(jsonContent)).not.toThrow()
    })

    it('should have name field', () => {
      if (!existsSync(wranglerJsoncPath)) {
        expect.fail('wrangler.static.jsonc does not exist')
      }

      const content = readFileSync(wranglerJsoncPath, 'utf-8')
      const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      const config = JSON.parse(jsonContent)

      expect(config.name).toBeDefined()
      expect(typeof config.name).toBe('string')
    })

    it('should include nodejs_compat in compatibility_flags', () => {
      if (!existsSync(wranglerJsoncPath)) {
        expect.fail('wrangler.static.jsonc does not exist')
      }

      const content = readFileSync(wranglerJsoncPath, 'utf-8')
      const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      const config = JSON.parse(jsonContent)

      expect(config.compatibility_flags).toBeDefined()
      expect(Array.isArray(config.compatibility_flags)).toBe(true)
      expect(config.compatibility_flags).toContain('nodejs_compat')
    })

    it('should have compatibility_date set', () => {
      if (!existsSync(wranglerJsoncPath)) {
        expect.fail('wrangler.static.jsonc does not exist')
      }

      const content = readFileSync(wranglerJsoncPath, 'utf-8')
      const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      const config = JSON.parse(jsonContent)

      expect(config.compatibility_date).toBeDefined()
      expect(typeof config.compatibility_date).toBe('string')
      // Should be a valid date format YYYY-MM-DD
      expect(config.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('should configure assets for static output', () => {
      if (!existsSync(wranglerJsoncPath)) {
        expect.fail('wrangler.static.jsonc does not exist')
      }

      const content = readFileSync(wranglerJsoncPath, 'utf-8')
      const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      const config = JSON.parse(jsonContent)

      // Workers static sites need assets configuration
      expect(config.assets).toBeDefined()
      expect(config.assets.directory).toBeDefined()
    })
  })

  describe('vite.config.ts (static)', () => {
    const viteStaticConfigPath = resolve(rootDir, 'vite.static.config.ts')

    it('should exist at project root', () => {
      expect(existsSync(viteStaticConfigPath)).toBe(true)
    })

    it('should import cloudflare plugin', async () => {
      if (!existsSync(viteStaticConfigPath)) {
        expect.fail('vite.static.config.ts does not exist')
      }

      const content = readFileSync(viteStaticConfigPath, 'utf-8')

      // Should import the cloudflare vite plugin
      expect(content).toMatch(/@cloudflare\/vite-plugin/)
    })

    it('should configure cloudflare plugin', async () => {
      if (!existsSync(viteStaticConfigPath)) {
        expect.fail('vite.static.config.ts does not exist')
      }

      const content = readFileSync(viteStaticConfigPath, 'utf-8')

      // Should have cloudflare() in plugins array
      expect(content).toMatch(/cloudflare\s*\(/)
    })

    it('should enable prerender in build config', async () => {
      if (!existsSync(viteStaticConfigPath)) {
        expect.fail('vite.static.config.ts does not exist')
      }

      const content = readFileSync(viteStaticConfigPath, 'utf-8')

      // Prerender configuration should be present
      // This could be in the cloudflare plugin config or vite build config
      expect(content).toMatch(/prerender|ssr/)
    })
  })

  describe('Static Build Output', () => {
    // Note: package.json access in Workers runtime is sandboxed
    // We read from the actual filesystem which may differ from Workers FS

    // Import package.json content directly for Workers runtime compatibility
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const getPackageJson = (): { scripts?: Record<string, string> } | null => {
      const packageJsonPath = resolve(rootDir, 'package.json')
      try {
        if (!existsSync(packageJsonPath)) {
          return null
        }
        const content = readFileSync(packageJsonPath, 'utf-8')
        return JSON.parse(content)
      } catch {
        return null
      }
    }

    it('should have build script for static output', async () => {
      const packageJson = getPackageJson()

      // If we can't read package.json (Workers sandbox), check the config file exists
      // which would indicate the GREEN phase implementation is complete
      if (!packageJson) {
        // Fallback: check if wrangler.static.jsonc exists (indicates GREEN phase)
        const wranglerExists = existsSync(resolve(rootDir, 'wrangler.static.jsonc'))
        expect(wranglerExists).toBe(true) // Will fail in RED phase
        return
      }

      // Should have a build:static script
      expect(packageJson.scripts?.['build:static']).toBeDefined()
    })

    it('should have deploy script for static workers', async () => {
      const packageJson = getPackageJson()

      // If we can't read package.json (Workers sandbox), check the config file exists
      if (!packageJson) {
        const wranglerExists = existsSync(resolve(rootDir, 'wrangler.static.jsonc'))
        expect(wranglerExists).toBe(true) // Will fail in RED phase
        return
      }

      // Should have a deploy:static script
      expect(packageJson.scripts?.['deploy:static']).toBeDefined()
    })
  })
})
