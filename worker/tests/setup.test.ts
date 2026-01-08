import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const WORKER_ROOT = join(__dirname, '..')

describe('Worker Package Setup', () => {
  describe('package.json', () => {
    const packageJsonPath = join(WORKER_ROOT, 'package.json')

    it('exists', () => {
      expect(existsSync(packageJsonPath)).toBe(true)
    })

    it('has hono dependency', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(pkg.dependencies?.hono || pkg.devDependencies?.hono).toBeDefined()
    })

    it('has @cloudflare/workers-types devDependency', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(pkg.devDependencies?.['@cloudflare/workers-types']).toBeDefined()
    })

    it('has vitest devDependency', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(pkg.devDependencies?.vitest).toBeDefined()
    })

    it('has @cloudflare/vitest-pool-workers devDependency', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(pkg.devDependencies?.['@cloudflare/vitest-pool-workers']).toBeDefined()
    })
  })

  describe('wrangler.toml', () => {
    const wranglerPath = join(WORKER_ROOT, 'wrangler.toml')

    it('exists', () => {
      expect(existsSync(wranglerPath)).toBe(true)
    })

    it('has [assets] section configured', () => {
      const content = readFileSync(wranglerPath, 'utf-8')
      expect(content).toMatch(/\[assets\]/)
    })
  })

  describe('vite.config.ts', () => {
    const viteConfigPath = join(WORKER_ROOT, 'vite.config.ts')

    it('exists', () => {
      expect(existsSync(viteConfigPath)).toBe(true)
    })

    it('uses @cloudflare/vite-plugin', () => {
      const content = readFileSync(viteConfigPath, 'utf-8')
      expect(content).toContain('@cloudflare/vite-plugin')
    })
  })

  describe('tsconfig.json', () => {
    const tsconfigPath = join(WORKER_ROOT, 'tsconfig.json')

    it('exists', () => {
      expect(existsSync(tsconfigPath)).toBe(true)
    })

    it('has jsx configuration for hono', () => {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))
      expect(tsconfig.compilerOptions?.jsx).toBeDefined()
      expect(tsconfig.compilerOptions?.jsxImportSource).toBe('hono/jsx')
    })
  })

  describe('src/ directory', () => {
    const srcPath = join(WORKER_ROOT, 'src')

    it('exists', () => {
      expect(existsSync(srcPath)).toBe(true)
    })
  })

  describe('Worker entry point', () => {
    it('can be imported and has a fetch handler', async () => {
      const worker = await import('../src/index')
      expect(worker.default).toBeDefined()
      expect(typeof worker.default.fetch).toBe('function')
    })
  })
})
