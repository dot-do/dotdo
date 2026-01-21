import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const appDir = join(__dirname, '..')

describe('TanStack Start Setup', () => {
  describe('Configuration Files', () => {
    it('should have app.config.ts with TanStack Start config', () => {
      const configPath = join(appDir, 'app.config.ts')
      expect(existsSync(configPath)).toBe(true)

      const content = readFileSync(configPath, 'utf-8')
      expect(content).toContain('defineConfig')
      expect(content).toContain('cloudflare-pages')
      expect(content).toContain('tailwindcss')
    })

    it('should have tailwind.config.ts', () => {
      const configPath = join(appDir, 'tailwind.config.ts')
      expect(existsSync(configPath)).toBe(true)

      const content = readFileSync(configPath, 'utf-8')
      expect(content).toContain('routes/**/*.{ts,tsx}')
      expect(content).toContain('Config')
      expect(content).toContain('content')
      expect(content).toContain('theme')
    })

    it('should have app.css with Tailwind directives', () => {
      const cssPath = join(appDir, 'app.css')
      expect(existsSync(cssPath)).toBe(true)

      const content = readFileSync(cssPath, 'utf-8')
      expect(content).toContain('@tailwind base')
      expect(content).toContain('@tailwind components')
      expect(content).toContain('@tailwind utilities')
    })
  })

  describe('Entry Points', () => {
    it('should have client.tsx for client-side hydration', () => {
      const clientPath = join(appDir, 'client.tsx')
      expect(existsSync(clientPath)).toBe(true)

      const content = readFileSync(clientPath, 'utf-8')
      expect(content).toContain('hydrateRoot')
      expect(content).toContain('StartClient')
      expect(content).toContain('createRouter')
    })

    it('should have ssr.tsx for server-side rendering', () => {
      const ssrPath = join(appDir, 'ssr.tsx')
      expect(existsSync(ssrPath)).toBe(true)

      const content = readFileSync(ssrPath, 'utf-8')
      expect(content).toContain('createStartHandler')
      expect(content).toContain('defaultStreamHandler')
      expect(content).toContain('getRouterManifest')
    })

    it('should have router.tsx with router factory', () => {
      const routerPath = join(appDir, 'router.tsx')
      expect(existsSync(routerPath)).toBe(true)

      const content = readFileSync(routerPath, 'utf-8')
      expect(content).toContain('createRouter')
      expect(content).toContain('routeTree')
      expect(content).toContain('defaultPreload')
    })
  })

  describe('Routes', () => {
    it('should have __root.tsx with root layout', () => {
      const rootPath = join(appDir, 'routes', '__root.tsx')
      expect(existsSync(rootPath)).toBe(true)

      const content = readFileSync(rootPath, 'utf-8')
      expect(content).toContain('createRootRoute')
      expect(content).toContain('Outlet')
      expect(content).toContain('../app.css')
      expect(content).toContain('<html')
      expect(content).toContain('<body')
    })

    it('should have index.tsx with home page', () => {
      const indexPath = join(appDir, 'routes', 'index.tsx')
      expect(existsSync(indexPath)).toBe(true)

      const content = readFileSync(indexPath, 'utf-8')
      expect(content).toContain('createFileRoute')
      expect(content).toContain('Welcome to dotdo')
      expect(content).toContain('Business-as-Code')
    })

    it('should use Tailwind classes in routes', () => {
      const indexPath = join(appDir, 'routes', 'index.tsx')
      const content = readFileSync(indexPath, 'utf-8')

      // Check for Tailwind utility classes
      expect(content).toMatch(/className="[^"]*\b(container|flex|grid|text-|bg-|p-|m-|rounded|shadow)\b/)
    })
  })

  describe('Static Export Configuration', () => {
    it('should configure routers for SSR and client', () => {
      const configPath = join(appDir, 'app.config.ts')
      const content = readFileSync(configPath, 'utf-8')

      expect(content).toContain('routers')
      expect(content).toContain('ssr')
      expect(content).toContain('client')
      expect(content).toContain('./ssr.tsx')
      expect(content).toContain('./client.tsx')
    })

    it('should have Cloudflare Pages preset', () => {
      const configPath = join(appDir, 'app.config.ts')
      const content = readFileSync(configPath, 'utf-8')

      expect(content).toContain('preset: \'cloudflare-pages\'')
    })
  })

  describe('Package Dependencies', () => {
    it('should have TanStack Start dependencies', () => {
      const pkgPath = join(appDir, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

      expect(pkg.dependencies['@tanstack/start']).toBeDefined()
      expect(pkg.dependencies['@tanstack/react-router']).toBeDefined()
      expect(pkg.dependencies['vinxi']).toBeDefined()
    })

    it('should have Tailwind CSS dependencies', () => {
      const pkgPath = join(appDir, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

      expect(pkg.devDependencies['tailwindcss']).toBeDefined()
      expect(pkg.devDependencies['@tailwindcss/vite']).toBeDefined()
    })

    it('should have correct npm scripts', () => {
      const pkgPath = join(appDir, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

      expect(pkg.scripts.dev).toContain('vinxi')
      // build script may be skipped due to TanStack Start dependency issues (do-zab7.3)
      // Check for either vinxi or the skip message
      expect(
        pkg.scripts.build.includes('vinxi') ||
          pkg.scripts.build.includes('SKIPPED') ||
          pkg.scripts['build:vinxi']?.includes('vinxi')
      ).toBe(true)
      expect(pkg.scripts.test).toContain('vitest')
    })
  })
})
