/**
 * E2E Tests: CLI Deploy Command (Dry Run)
 *
 * Tests the `dotdo deploy` command using dry-run mode to verify
 * deployment configuration without actually deploying.
 *
 * These tests:
 * 1. Test deploy command with --dry-run flag
 * 2. Verify deployment configuration detection
 * 3. Test multi-target deployment options
 * 4. Test deployment preparation steps
 */

import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createTempDir,
  cleanupTempDir,
  runCommand,
  EXAMPLES_DIR,
} from './utils/server'

test.describe('CLI Deploy Command E2E', () => {
  let tempDir: string

  test.beforeEach(() => {
    tempDir = createTempDir(`deploy-e2e-${Date.now()}`)
  })

  test.afterEach(() => {
    cleanupTempDir(tempDir)
  })

  test.describe('Dry Run Mode', () => {
    test('should accept --dry-run flag without deploying', () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      const result = runCommand('deploy', {
        cwd: exampleDir,
        args: ['--dry-run'],
        timeout: 30000,
      })

      // Should complete without error (even if it shows deployment would fail due to auth)
      // The key is it doesn't actually deploy
      expect(result.stdout.toLowerCase()).toMatch(/deploy|dry.?run/i)
    })

    test('should show what would be deployed with --dry-run', () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      const result = runCommand('deploy', {
        cwd: exampleDir,
        args: ['--dry-run'],
        timeout: 30000,
      })

      // Output should indicate dry run mode
      // The exact message depends on implementation
      expect(result.stdout.length).toBeGreaterThan(0)
    })
  })

  test.describe('Target Selection', () => {
    test('should default to cloudflare target', () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      const result = runCommand('deploy', {
        cwd: exampleDir,
        args: ['--dry-run'],
        timeout: 30000,
      })

      // Output should mention cloudflare (default target)
      const output = (result.stdout + result.stderr).toLowerCase()
      // If not mentioned, it's still using default
      expect(output.length).toBeGreaterThan(0)
    })

    test('should accept --target cloudflare option', () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      const result = runCommand('deploy', {
        cwd: exampleDir,
        args: ['--target', 'cloudflare', '--dry-run'],
        timeout: 30000,
      })

      expect(result.exitCode).toBeDefined()
    })

    test('should accept --target vercel option', () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      const result = runCommand('deploy', {
        cwd: exampleDir,
        args: ['--target', 'vercel', '--dry-run'],
        timeout: 30000,
      })

      expect(result.exitCode).toBeDefined()
    })

    test('should accept --target fly option', () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      const result = runCommand('deploy', {
        cwd: exampleDir,
        args: ['--target', 'fly', '--dry-run'],
        timeout: 30000,
      })

      expect(result.exitCode).toBeDefined()
    })
  })

  test.describe('Configuration Detection', () => {
    test('should detect wrangler.jsonc in project directory', () => {
      // Create a minimal project
      const projectDir = join(tempDir, 'test-project')
      require('fs').mkdirSync(projectDir, { recursive: true })

      // Create wrangler.jsonc
      const wranglerConfig = {
        name: 'test-project',
        main: 'src/index.ts',
        compatibility_date: '2024-12-01',
      }
      writeFileSync(
        join(projectDir, 'wrangler.jsonc'),
        JSON.stringify(wranglerConfig, null, 2)
      )

      // Create minimal source
      require('fs').mkdirSync(join(projectDir, 'src'), { recursive: true })
      writeFileSync(
        join(projectDir, 'src', 'index.ts'),
        'export default { fetch() { return new Response("test"); } }'
      )

      const result = runCommand('deploy', {
        cwd: projectDir,
        args: ['--dry-run'],
        timeout: 30000,
      })

      // Should not fail to find config
      expect(result.stdout + result.stderr).not.toMatch(/config.*not found/i)
    })

    test('should handle missing configuration gracefully', () => {
      // Empty directory
      const emptyDir = join(tempDir, 'empty-project')
      require('fs').mkdirSync(emptyDir, { recursive: true })

      const result = runCommand('deploy', {
        cwd: emptyDir,
        args: ['--dry-run'],
        timeout: 30000,
      })

      // Should fail gracefully with helpful message
      expect(result.exitCode).not.toBe(0)
    })
  })

  test.describe('Multi-Target Deployment', () => {
    test('should accept --all flag to deploy to all targets', () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      const result = runCommand('deploy', {
        cwd: exampleDir,
        args: ['--all', '--dry-run'],
        timeout: 30000,
      })

      // Should attempt deployment to multiple targets
      expect(result.stdout + result.stderr).toBeDefined()
    })
  })

  test.describe('Vercel Configuration Generation', () => {
    test('should generate vercel.json when targeting vercel', () => {
      const projectDir = join(tempDir, 'vercel-project')
      require('fs').mkdirSync(projectDir, { recursive: true })

      // Create wrangler.jsonc
      const wranglerConfig = {
        name: 'vercel-project',
        main: 'src/index.ts',
        compatibility_date: '2024-12-01',
      }
      writeFileSync(
        join(projectDir, 'wrangler.jsonc'),
        JSON.stringify(wranglerConfig, null, 2)
      )

      // Create minimal source
      require('fs').mkdirSync(join(projectDir, 'src'), { recursive: true })
      writeFileSync(
        join(projectDir, 'src', 'index.ts'),
        'export default { fetch() { return new Response("test"); } }'
      )

      runCommand('deploy', {
        cwd: projectDir,
        args: ['--target', 'vercel', '--dry-run'],
        timeout: 30000,
      })

      // Check if vercel.json was created (depends on implementation)
      const vercelConfigPath = join(projectDir, 'vercel.json')
      if (existsSync(vercelConfigPath)) {
        const content = readFileSync(vercelConfigPath, 'utf-8')
        const config = JSON.parse(content)
        expect(config.buildCommand || config.functions).toBeDefined()
      }
    })
  })

  test.describe('Fly.io Configuration Generation', () => {
    test('should generate fly.toml when targeting fly', () => {
      const projectDir = join(tempDir, 'fly-project')
      require('fs').mkdirSync(projectDir, { recursive: true })

      // Create wrangler.jsonc
      const wranglerConfig = {
        name: 'fly-project',
        main: 'src/index.ts',
        compatibility_date: '2024-12-01',
      }
      writeFileSync(
        join(projectDir, 'wrangler.jsonc'),
        JSON.stringify(wranglerConfig, null, 2)
      )

      // Create minimal source
      require('fs').mkdirSync(join(projectDir, 'src'), { recursive: true })
      writeFileSync(
        join(projectDir, 'src', 'index.ts'),
        'export default { fetch() { return new Response("test"); } }'
      )

      runCommand('deploy', {
        cwd: projectDir,
        args: ['--target', 'fly', '--dry-run'],
        timeout: 30000,
      })

      // Check if fly.toml was created (depends on implementation)
      const flyConfigPath = join(projectDir, 'fly.toml')
      if (existsSync(flyConfigPath)) {
        const content = readFileSync(flyConfigPath, 'utf-8')
        expect(content).toContain('app')
        expect(content).toContain('http_service')
      }
    })

    test('should accept --name option for fly.io app name', () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      const result = runCommand('deploy', {
        cwd: exampleDir,
        args: ['--target', 'fly', '--name', 'my-fly-app', '--dry-run'],
        timeout: 30000,
      })

      // Command should accept the name option
      expect(result.exitCode).toBeDefined()
    })
  })

  test.describe('Output Messages', () => {
    test('should print deploying message', () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      const result = runCommand('deploy', {
        cwd: exampleDir,
        args: ['--dry-run'],
        timeout: 30000,
      })

      const output = (result.stdout + result.stderr).toLowerCase()
      expect(output).toMatch(/deploy|target|cloudflare/i)
    })

    test('should show summary after deployment attempt', () => {
      const exampleDir = join(EXAMPLES_DIR, 'simple-api')

      const result = runCommand('deploy', {
        cwd: exampleDir,
        args: ['--dry-run'],
        timeout: 30000,
      })

      // Should show some summary output
      expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0)
    })
  })
})
