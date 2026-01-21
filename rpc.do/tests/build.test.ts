import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const ROOT_DIR = resolve(import.meta.dirname, '..')
const DIST_CLI_PATH = resolve(ROOT_DIR, 'dist/cli/index.js')

describe('rpc.do build', () => {
  describe('dist/cli/index.js', () => {
    beforeAll(() => {
      // Ensure we have a fresh build before running tests
      // This is idempotent - if already built, it's a no-op
      try {
        execSync('npm run build', { cwd: ROOT_DIR, stdio: 'pipe' })
      } catch {
        // Build might fail initially - that's expected in RED phase
      }
    })

    it('dist/cli/index.js exists after build', () => {
      expect(existsSync(DIST_CLI_PATH)).toBe(true)
    })

    it('the built file is valid JavaScript (can be parsed)', () => {
      expect(existsSync(DIST_CLI_PATH)).toBe(true)

      // For ESM, we can't use new Function() since it doesn't support import statements.
      // Instead, we verify the file can be syntax-checked by Node.js
      // The --check flag validates syntax without executing the file
      expect(() => {
        execSync(`node --check "${DIST_CLI_PATH}"`, { cwd: ROOT_DIR, stdio: 'pipe' })
      }).not.toThrow()
    })

    it('has shebang for node execution', () => {
      expect(existsSync(DIST_CLI_PATH)).toBe(true)
      const content = readFileSync(DIST_CLI_PATH, 'utf-8')

      expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
    })

    it('is executable (on Unix systems)', () => {
      if (process.platform === 'win32') {
        // Skip on Windows
        return
      }

      expect(existsSync(DIST_CLI_PATH)).toBe(true)

      // Check file permissions
      const { statSync } = require('node:fs')
      const stats = statSync(DIST_CLI_PATH)
      const isExecutable = (stats.mode & 0o111) !== 0

      expect(isExecutable).toBe(true)
    })
  })

  describe('CLI commands', () => {
    it('npx rpc.do --help outputs help text', () => {
      const result = execSync('node dist/cli/index.js --help', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      })

      expect(result).toContain('rpc.do')
      expect(result).toContain('CLI for rpc.do')
      expect(result).toContain('Commands:')
      expect(result).toContain('pull')
      expect(result).toContain('eval')
      expect(result).toContain('run')
      expect(result).toContain('repl')
    })

    it('npx rpc.do --version outputs version', () => {
      const result = execSync('node dist/cli/index.js --version', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      })

      // Should output the version from package.json
      expect(result.trim()).toBe('0.0.1')
    })

    it('CLI exports the expected commands (pull, eval, run, repl)', () => {
      const helpOutput = execSync('node dist/cli/index.js --help', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      })

      // Verify all expected commands are present
      const expectedCommands = ['pull', 'eval', 'run', 'repl']
      for (const cmd of expectedCommands) {
        expect(helpOutput).toContain(cmd)
      }
    })
  })

  describe('sourcemaps', () => {
    it('generates sourcemap file', () => {
      const sourcemapPath = DIST_CLI_PATH + '.map'
      expect(existsSync(sourcemapPath)).toBe(true)
    })

    it('sourcemap references the source file', () => {
      const sourcemapPath = DIST_CLI_PATH + '.map'
      expect(existsSync(sourcemapPath)).toBe(true)

      const sourcemap = JSON.parse(readFileSync(sourcemapPath, 'utf-8'))
      expect(sourcemap.sources).toBeDefined()
      expect(Array.isArray(sourcemap.sources)).toBe(true)
      expect(sourcemap.sources.length).toBeGreaterThan(0)
    })
  })

  describe('bundle optimization', () => {
    it('externalizes node_modules (bundle is not massive)', () => {
      expect(existsSync(DIST_CLI_PATH)).toBe(true)
      const content = readFileSync(DIST_CLI_PATH, 'utf-8')

      // Bundle should be relatively small since we externalize deps
      // commander alone is 25KB minified, so if we include it we'd be much larger
      // Our CLI code should be < 50KB bundled without dependencies
      const sizeKB = content.length / 1024
      expect(sizeKB).toBeLessThan(100)
    })

    it('uses ESM format', () => {
      expect(existsSync(DIST_CLI_PATH)).toBe(true)
      const content = readFileSync(DIST_CLI_PATH, 'utf-8')

      // Should have ESM imports/exports
      expect(content).toMatch(/import\s+.*from/)
    })
  })
})
