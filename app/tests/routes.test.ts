import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const appDir = join(__dirname, '..')

describe('Route Structure and App Shell', () => {
  describe('Root Route', () => {
    const rootPath = join(appDir, 'routes', '__root.tsx')

    it('should exist and import Layout component', () => {
      expect(existsSync(rootPath)).toBe(true)
      const content = readFileSync(rootPath, 'utf-8')
      expect(content).toContain('import { Layout }')
      expect(content).toContain('../components/Layout')
    })

    it('should use createRootRoute from TanStack Router', () => {
      const content = readFileSync(rootPath, 'utf-8')
      expect(content).toContain('createRootRoute')
      expect(content).toContain('@tanstack/react-router')
    })

    it('should render HTML structure with Layout', () => {
      const content = readFileSync(rootPath, 'utf-8')
      expect(content).toContain('<html')
      expect(content).toContain('<head>')
      expect(content).toContain('<body>')
      expect(content).toContain('<Layout>')
      expect(content).toContain('<Outlet')
    })

    it('should include meta tags for SEO', () => {
      const content = readFileSync(rootPath, 'utf-8')
      expect(content).toContain('charSet')
      expect(content).toContain('viewport')
      expect(content).toContain('<title>')
      expect(content).toContain('description')
    })

    it('should import app.css for global styles', () => {
      const content = readFileSync(rootPath, 'utf-8')
      expect(content).toContain('../app.css')
    })
  })

  describe('Home Page Route', () => {
    const indexPath = join(appDir, 'routes', 'index.tsx')

    it('should exist and use PageLayout component', () => {
      expect(existsSync(indexPath)).toBe(true)
      const content = readFileSync(indexPath, 'utf-8')
      expect(content).toContain('import { PageLayout }')
      expect(content).toContain('../components/Layout')
    })

    it('should use createFileRoute with / path', () => {
      const content = readFileSync(indexPath, 'utf-8')
      expect(content).toContain('createFileRoute(\'/\')')
    })

    it('should display dotdo branding', () => {
      const content = readFileSync(indexPath, 'utf-8')
      expect(content).toContain('Welcome to dotdo')
      expect(content).toContain('Business-as-Code')
    })

    it('should render feature cards', () => {
      const content = readFileSync(indexPath, 'utf-8')
      expect(content).toContain('FeatureCard')
      expect(content).toContain('Durable Objects')
      expect(content).toContain('Event Streams')
      expect(content).toContain('RPC Layer')
    })

    it('should use responsive grid layout', () => {
      const content = readFileSync(indexPath, 'utf-8')
      expect(content).toMatch(/className="[^"]*grid[^"]*"/)
      expect(content).toMatch(/md:grid-cols-/)
    })
  })

  describe('Admin Route', () => {
    const adminPath = join(appDir, 'routes', 'admin.tsx')

    it('should exist and use PageLayout component', () => {
      expect(existsSync(adminPath)).toBe(true)
      const content = readFileSync(adminPath, 'utf-8')
      expect(content).toContain('import { PageLayout }')
      expect(content).toContain('../components/Layout')
    })

    it('should use createFileRoute with /admin path', () => {
      const content = readFileSync(adminPath, 'utf-8')
      expect(content).toContain('createFileRoute(\'/admin\')')
    })

    it('should have admin title and description', () => {
      const content = readFileSync(adminPath, 'utf-8')
      expect(content).toContain('Admin Portal')
      expect(content).toContain('infrastructure')
    })

    it('should reference do-7rf.8.4 issue for @mdxui/do integration', () => {
      const content = readFileSync(adminPath, 'utf-8')
      expect(content).toContain('do-7rf.8.4')
    })

    it('should display admin feature cards', () => {
      const content = readFileSync(adminPath, 'utf-8')
      expect(content).toContain('AdminCard')
      expect(content).toContain('Durable Objects')
      expect(content).toContain('Event Streams')
      expect(content).toContain('Storage')
    })

    it('should have status indicators', () => {
      const content = readFileSync(adminPath, 'utf-8')
      expect(content).toContain('status')
      expect(content).toContain('planned')
    })
  })

  describe('Docs Route', () => {
    const docsPath = join(appDir, 'routes', 'docs.tsx')

    it('should exist and use PageLayout component', () => {
      expect(existsSync(docsPath)).toBe(true)
      const content = readFileSync(docsPath, 'utf-8')
      expect(content).toContain('import { PageLayout }')
      expect(content).toContain('../components/Layout')
    })

    it('should use createFileRoute with /docs path', () => {
      const content = readFileSync(docsPath, 'utf-8')
      expect(content).toContain('createFileRoute(\'/docs\')')
    })

    it('should have documentation title', () => {
      const content = readFileSync(docsPath, 'utf-8')
      expect(content).toContain('Documentation')
      expect(content).toContain('Learn')
    })

    it('should reference do-7rf.8.3 issue for fumadocs integration', () => {
      const content = readFileSync(docsPath, 'utf-8')
      expect(content).toContain('do-7rf.8.3')
      expect(content).toContain('fumadocs')
    })

    it('should have navigation sidebar', () => {
      const content = readFileSync(docsPath, 'utf-8')
      expect(content).toContain('Quick Links')
      expect(content).toContain('Core Concepts')
      expect(content).toContain('API Reference')
    })

    it('should display documentation sections', () => {
      const content = readFileSync(docsPath, 'utf-8')
      expect(content).toContain('DocCard')
      expect(content).toContain('Durable Objects')
      expect(content).toContain('WorkflowContext')
      expect(content).toContain('Event System')
    })

    it('should have guides and examples sections', () => {
      const content = readFileSync(docsPath, 'utf-8')
      expect(content).toContain('Guides')
      expect(content).toContain('Examples')
      expect(content).toContain('GuideCard')
    })
  })

  describe('Shared Components', () => {
    describe('Layout Component', () => {
      const layoutPath = join(appDir, 'components', 'Layout.tsx')

      it('should exist in components directory', () => {
        expect(existsSync(layoutPath)).toBe(true)
      })

      it('should export Layout and PageLayout components', () => {
        const content = readFileSync(layoutPath, 'utf-8')
        expect(content).toContain('export function Layout')
        expect(content).toContain('export function PageLayout')
      })

      it('should import Nav component', () => {
        const content = readFileSync(layoutPath, 'utf-8')
        expect(content).toContain('import { Nav')
        expect(content).toContain('./Nav')
      })

      it('should accept children prop', () => {
        const content = readFileSync(layoutPath, 'utf-8')
        expect(content).toContain('children')
        expect(content).toContain('ReactNode')
      })

      it('should have header, main, and footer sections', () => {
        const content = readFileSync(layoutPath, 'utf-8')
        expect(content).toContain('<header')
        expect(content).toContain('<main')
        expect(content).toContain('<footer')
      })

      it('should use Tailwind classes for styling', () => {
        const content = readFileSync(layoutPath, 'utf-8')
        expect(content).toContain('min-h-screen')
        expect(content).toContain('flex-1')
      })

      it('should support customization props', () => {
        const content = readFileSync(layoutPath, 'utf-8')
        expect(content).toContain('title')
        expect(content).toContain('description')
        expect(content).toContain('showHeader')
        expect(content).toContain('showFooter')
      })

      it('should have PageLayout with maxWidth options', () => {
        const content = readFileSync(layoutPath, 'utf-8')
        expect(content).toContain('maxWidth')
        expect(content).toContain('max-w-')
      })
    })

    describe('Nav Component', () => {
      const navPath = join(appDir, 'components', 'Nav.tsx')

      it('should exist in components directory', () => {
        expect(existsSync(navPath)).toBe(true)
      })

      it('should export Nav component', () => {
        const content = readFileSync(navPath, 'utf-8')
        expect(content).toContain('export function Nav')
      })

      it('should import Link from TanStack Router', () => {
        const content = readFileSync(navPath, 'utf-8')
        expect(content).toContain('import { Link }')
        expect(content).toContain('@tanstack/react-router')
      })

      it('should have default navigation links', () => {
        const content = readFileSync(navPath, 'utf-8')
        expect(content).toContain('defaultLinks')
        expect(content).toContain('Home')
        expect(content).toContain('Docs')
        expect(content).toContain('Admin')
      })

      it('should support custom links prop', () => {
        const content = readFileSync(navPath, 'utf-8')
        expect(content).toContain('links')
        expect(content).toContain('NavLink')
      })

      it('should support external links', () => {
        const content = readFileSync(navPath, 'utf-8')
        expect(content).toContain('external')
        expect(content).toContain('target="_blank"')
        expect(content).toContain('rel="noopener noreferrer"')
      })

      it('should use activeProps for active link styling', () => {
        const content = readFileSync(navPath, 'utf-8')
        expect(content).toContain('activeProps')
      })

      it('should have aria-label for accessibility', () => {
        const content = readFileSync(navPath, 'utf-8')
        expect(content).toContain('aria-label')
      })
    })

    describe('Component Index', () => {
      const indexPath = join(appDir, 'components', 'index.ts')

      it('should exist and export all components', () => {
        expect(existsSync(indexPath)).toBe(true)
        const content = readFileSync(indexPath, 'utf-8')
        expect(content).toContain('export { Layout')
        expect(content).toContain('export { Nav')
      })

      it('should export TypeScript types', () => {
        const content = readFileSync(indexPath, 'utf-8')
        expect(content).toContain('export type {')
        expect(content).toContain('LayoutProps')
        expect(content).toContain('NavProps')
      })
    })
  })

  describe('Route Integration', () => {
    it('should have consistent component imports across routes', () => {
      const routes = ['index.tsx', 'admin.tsx', 'docs.tsx']

      routes.forEach((route) => {
        const routePath = join(appDir, 'routes', route)
        const content = readFileSync(routePath, 'utf-8')
        expect(content).toContain('../components/Layout')
      })
    })

    it('should use createFileRoute for all non-root routes', () => {
      const routes = ['index.tsx', 'admin.tsx', 'docs.tsx']

      routes.forEach((route) => {
        const routePath = join(appDir, 'routes', route)
        const content = readFileSync(routePath, 'utf-8')
        expect(content).toContain('createFileRoute')
      })
    })

    it('should have consistent Tailwind usage', () => {
      const routes = ['index.tsx', 'admin.tsx', 'docs.tsx']

      routes.forEach((route) => {
        const routePath = join(appDir, 'routes', route)
        const content = readFileSync(routePath, 'utf-8')
        // Check for at least one Tailwind class
        expect(content).toMatch(/className=/)
      })
    })

    it('should have proper TypeScript types', () => {
      const files = [
        'components/Layout.tsx',
        'components/Nav.tsx',
        'routes/admin.tsx',
        'routes/docs.tsx',
      ]

      files.forEach((file) => {
        const filePath = join(appDir, file)
        const content = readFileSync(filePath, 'utf-8')
        // Should have interface or type definitions
        expect(content).toMatch(/interface \w+/)
      })
    })
  })

  describe('Accessibility', () => {
    it('should have semantic HTML in Layout', () => {
      const layoutPath = join(appDir, 'components', 'Layout.tsx')
      const content = readFileSync(layoutPath, 'utf-8')
      expect(content).toContain('<header')
      expect(content).toContain('<main')
      expect(content).toContain('<footer')
      // Nav component is used via <Nav />, not <nav> directly
      expect(content).toContain('<Nav')
    })

    it('should have aria-label in Nav component', () => {
      const navPath = join(appDir, 'components', 'Nav.tsx')
      const content = readFileSync(navPath, 'utf-8')
      expect(content).toContain('aria-label')
    })

    it('should have proper heading hierarchy in routes', () => {
      const routes = ['index.tsx', 'admin.tsx', 'docs.tsx']

      routes.forEach((route) => {
        const routePath = join(appDir, 'routes', route)
        const content = readFileSync(routePath, 'utf-8')
        // Should have h1, h2, or h3 tags
        expect(content).toMatch(/<h[1-3]/)
      })
    })
  })

  describe('Responsive Design', () => {
    it('should use responsive grid classes', () => {
      const routes = ['index.tsx', 'admin.tsx', 'docs.tsx']

      routes.forEach((route) => {
        const routePath = join(appDir, 'routes', route)
        const content = readFileSync(routePath, 'utf-8')
        // Should have responsive grid classes
        expect(content).toMatch(/md:grid-cols-|lg:grid-cols-/)
      })
    })

    it('should have container classes for content width', () => {
      const layoutPath = join(appDir, 'components', 'Layout.tsx')
      const content = readFileSync(layoutPath, 'utf-8')
      expect(content).toContain('container')
    })

    it('should have max-width utilities in PageLayout', () => {
      const layoutPath = join(appDir, 'components', 'Layout.tsx')
      const content = readFileSync(layoutPath, 'utf-8')
      expect(content).toContain('max-w-')
    })
  })
})
