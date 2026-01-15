/**
 * Docs Layout Components Tests
 *
 * RED phase: These tests verify the documentation layout components exist and are properly configured.
 * All tests should FAIL until the GREEN phase implements the actual components.
 *
 * Tests cover:
 * - DocsLayout component (wraps documentation pages)
 * - Sidebar navigation component
 * - Table of contents component
 * - Breadcrumb component
 * - Page navigation (prev/next)
 * - Search bar integration
 * - MDX component overrides
 *
 * @see https://fumadocs.dev/docs/ui/layouts/docs
 * @see https://fumadocs.dev/docs/ui/components
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP_DIR = path.join(ROOT, 'app')
const LIB_DIR = path.join(ROOT, 'lib')
const COMPONENTS_DIR = path.join(ROOT, 'components')

describe('Docs Layout Components', () => {
  describe('DocsLayout component', () => {
    const layoutPath = path.join(COMPONENTS_DIR, 'docs/layout.tsx')

    it('should exist at components/docs/layout.tsx', () => {
      expect(fs.existsSync(layoutPath)).toBe(true)
    })

    it('should export DocsLayout component', async () => {
      const module = await import(layoutPath)
      expect(module.DocsLayout).toBeDefined()
      expect(typeof module.DocsLayout).toBe('function')
    })

    it('should import fumadocs-ui/layouts/docs', async () => {
      const content = fs.readFileSync(layoutPath, 'utf-8')
      expect(content).toMatch(/fumadocs-ui\/layouts\/docs/)
    })

    it('should use source.getPageTree() for navigation', async () => {
      const content = fs.readFileSync(layoutPath, 'utf-8')
      // Should use the page tree from source
      expect(content).toMatch(/getPageTree|pageTree|tree/)
    })

    it('should import from lib/source', async () => {
      const content = fs.readFileSync(layoutPath, 'utf-8')
      // Should import source for page tree generation
      expect(content).toMatch(/from\s+['"].*source['"]/)
    })
  })

  describe('Sidebar navigation component', () => {
    const sidebarPath = path.join(COMPONENTS_DIR, 'docs/sidebar.tsx')

    it('should exist at components/docs/sidebar.tsx', () => {
      expect(fs.existsSync(sidebarPath)).toBe(true)
    })

    it('should export Sidebar component', async () => {
      const module = await import(sidebarPath)
      expect(module.Sidebar).toBeDefined()
      expect(typeof module.Sidebar).toBe('function')
    })

    it('should support collapsible sidebar behavior', async () => {
      const content = fs.readFileSync(sidebarPath, 'utf-8')
      // Should reference collapsible functionality
      expect(content).toMatch(/collapsible|collapse|SidebarTrigger|CollapsibleControl/i)
    })

    it('should render page tree items', async () => {
      const content = fs.readFileSync(sidebarPath, 'utf-8')
      // Should use SidebarPageTree or render tree items
      expect(content).toMatch(/SidebarPageTree|SidebarItem|tree|pageTree/i)
    })
  })

  describe('Table of contents component', () => {
    const tocPath = path.join(COMPONENTS_DIR, 'docs/toc.tsx')

    it('should exist at components/docs/toc.tsx', () => {
      expect(fs.existsSync(tocPath)).toBe(true)
    })

    it('should export TableOfContents component', async () => {
      const module = await import(tocPath)
      // Could be named TOC, TableOfContents, or PageTOC
      const hasTOC = module.TableOfContents || module.TOC || module.PageTOC
      expect(hasTOC).toBeDefined()
    })

    it('should use fumadocs-core/toc for heading extraction', async () => {
      const content = fs.readFileSync(tocPath, 'utf-8')
      expect(content).toMatch(/fumadocs-core\/toc|TOCItemType|AnchorProvider/)
    })

    it('should support popover mode for mobile', async () => {
      const content = fs.readFileSync(tocPath, 'utf-8')
      // Should have popover variant for mobile responsiveness
      expect(content).toMatch(/popover|Popover|TOCPopover|mobile/i)
    })

    it('should render heading items with links', async () => {
      const content = fs.readFileSync(tocPath, 'utf-8')
      // Should render TOC items with anchors
      expect(content).toMatch(/TOCItems|href|anchor|#/i)
    })
  })

  describe('Breadcrumb component', () => {
    const breadcrumbPath = path.join(COMPONENTS_DIR, 'docs/breadcrumb.tsx')

    it('should exist at components/docs/breadcrumb.tsx', () => {
      expect(fs.existsSync(breadcrumbPath)).toBe(true)
    })

    it('should export Breadcrumb component', async () => {
      const module = await import(breadcrumbPath)
      // Could be named Breadcrumb or PageBreadcrumb
      const hasBreadcrumb = module.Breadcrumb || module.PageBreadcrumb
      expect(hasBreadcrumb).toBeDefined()
    })

    it('should generate breadcrumbs from page path', async () => {
      const content = fs.readFileSync(breadcrumbPath, 'utf-8')
      // Should reference path, slug, or breadcrumb generation
      expect(content).toMatch(/path|slug|breadcrumb|PageBreadcrumb/i)
    })

    it('should include Home as first breadcrumb item', async () => {
      const content = fs.readFileSync(breadcrumbPath, 'utf-8')
      // Should have home link in breadcrumb
      expect(content).toMatch(/Home|home|\/docs|root/i)
    })

    it('should support JSON-LD BreadcrumbList structured data', async () => {
      const content = fs.readFileSync(breadcrumbPath, 'utf-8')
      // Should support structured data for SEO
      expect(content).toMatch(/BreadcrumbList|structuredData|jsonLd|schema/i)
    })
  })

  describe('Page navigation (prev/next)', () => {
    const navPath = path.join(COMPONENTS_DIR, 'docs/page-nav.tsx')

    it('should exist at components/docs/page-nav.tsx', () => {
      expect(fs.existsSync(navPath)).toBe(true)
    })

    it('should export PageNavigation component', async () => {
      const module = await import(navPath)
      // Could be named PageNavigation, PageNav, Footer, or PageFooter
      const hasNav = module.PageNavigation || module.PageNav || module.Footer || module.PageFooter
      expect(hasNav).toBeDefined()
    })

    it('should show previous page link', async () => {
      const content = fs.readFileSync(navPath, 'utf-8')
      // Should have previous navigation
      expect(content).toMatch(/previous|prev|Previous/i)
    })

    it('should show next page link', async () => {
      const content = fs.readFileSync(navPath, 'utf-8')
      // Should have next navigation
      expect(content).toMatch(/next|Next/i)
    })

    it('should use PageFooter from fumadocs-ui', async () => {
      const content = fs.readFileSync(navPath, 'utf-8')
      expect(content).toMatch(/PageFooter|fumadocs-ui\/page|FooterProps/)
    })
  })

  describe('Search bar integration', () => {
    const searchPath = path.join(COMPONENTS_DIR, 'docs/search.tsx')

    it('should exist at components/docs/search.tsx', () => {
      expect(fs.existsSync(searchPath)).toBe(true)
    })

    it('should export Search component', async () => {
      const module = await import(searchPath)
      // Could be named Search, SearchBar, SearchToggle, or SearchDialog
      const hasSearch = module.Search || module.SearchBar || module.SearchToggle || module.SearchDialog
      expect(hasSearch).toBeDefined()
    })

    it('should integrate with fumadocs search', async () => {
      const content = fs.readFileSync(searchPath, 'utf-8')
      expect(content).toMatch(/fumadocs-ui|SearchToggle|SearchDialog|search/)
    })

    it('should support keyboard shortcut (Cmd+K)', async () => {
      const content = fs.readFileSync(searchPath, 'utf-8')
      // Should reference keyboard shortcut
      expect(content).toMatch(/cmd|Cmd|command|hotkey|shortcut|K|k/i)
    })

    it('should use search API endpoint', async () => {
      const content = fs.readFileSync(searchPath, 'utf-8')
      // Should reference the search API
      expect(content).toMatch(/\/api\/search|searchAPI|fetch.*search/)
    })
  })

  describe('MDX components configuration', () => {
    const mdxPath = path.join(COMPONENTS_DIR, 'docs/mdx-components.tsx')

    it('should exist at components/docs/mdx-components.tsx', () => {
      expect(fs.existsSync(mdxPath)).toBe(true)
    })

    it('should export useMDXComponents or mdxComponents', async () => {
      const module = await import(mdxPath)
      // Standard MDX components export names
      const hasMDX = module.useMDXComponents || module.mdxComponents || module.components || module.default
      expect(hasMDX).toBeDefined()
    })

    it('should use fumadocs-ui/mdx default components', async () => {
      const content = fs.readFileSync(mdxPath, 'utf-8')
      expect(content).toMatch(/fumadocs-ui\/mdx|defaultMdxComponents/)
    })

    it('should override heading components for anchor links', async () => {
      const content = fs.readFileSync(mdxPath, 'utf-8')
      // Should customize heading components
      expect(content).toMatch(/h1|h2|h3|heading|Heading/i)
    })

    it('should include code block components', async () => {
      const content = fs.readFileSync(mdxPath, 'utf-8')
      // Should have code/pre block handling
      expect(content).toMatch(/pre|code|CodeBlock|codeblock/i)
    })

    it('should include Callout component', async () => {
      const content = fs.readFileSync(mdxPath, 'utf-8')
      expect(content).toMatch(/Callout/)
    })
  })

  describe('Docs page layout component', () => {
    const docsPagePath = path.join(COMPONENTS_DIR, 'docs/page.tsx')

    it('should exist at components/docs/page.tsx', () => {
      expect(fs.existsSync(docsPagePath)).toBe(true)
    })

    it('should export DocsPage component', async () => {
      const module = await import(docsPagePath)
      expect(module.DocsPage).toBeDefined()
      expect(typeof module.DocsPage).toBe('function')
    })

    it('should use fumadocs-ui/page components', async () => {
      const content = fs.readFileSync(docsPagePath, 'utf-8')
      expect(content).toMatch(/fumadocs-ui\/page|DocsBody|DocsTitle|DocsDescription/)
    })

    it('should support TOC configuration', async () => {
      const content = fs.readFileSync(docsPagePath, 'utf-8')
      // Should accept toc prop or configure TOC
      expect(content).toMatch(/toc|TOC|tableOfContent/)
    })

    it('should support breadcrumb configuration', async () => {
      const content = fs.readFileSync(docsPagePath, 'utf-8')
      expect(content).toMatch(/breadcrumb|Breadcrumb/)
    })

    it('should support footer navigation', async () => {
      const content = fs.readFileSync(docsPagePath, 'utf-8')
      expect(content).toMatch(/footer|Footer|navigation|prev|next/)
    })
  })

  describe('Responsive design support', () => {
    const layoutPath = path.join(COMPONENTS_DIR, 'docs/layout.tsx')

    it('should support mobile sidebar toggle', async () => {
      const content = fs.readFileSync(layoutPath, 'utf-8')
      // Should have mobile sidebar control
      expect(content).toMatch(/SidebarTrigger|mobile|Menu|hamburger/i)
    })

    it('should have responsive breakpoints', async () => {
      const content = fs.readFileSync(layoutPath, 'utf-8')
      // Should reference responsive design
      expect(content).toMatch(/md:|lg:|sm:|hidden|block|responsive/i)
    })
  })

  describe('Layout integration in app routes', () => {
    const docsRoutePath = path.join(APP_DIR, 'routes/docs.tsx')

    it('should import DocsLayout', async () => {
      const content = fs.readFileSync(docsRoutePath, 'utf-8')
      expect(content).toMatch(/DocsLayout|layout/i)
    })

    it('should wrap content with DocsLayout', async () => {
      const content = fs.readFileSync(docsRoutePath, 'utf-8')
      // Should use layout component
      expect(content).toMatch(/<DocsLayout|DocsLayout>|layout.*children/i)
    })
  })

  describe('lib/layout.ts helper module', () => {
    const layoutHelperPath = path.join(LIB_DIR, 'layout.ts')

    it('should exist at lib/layout.ts', () => {
      expect(fs.existsSync(layoutHelperPath)).toBe(true)
    })

    it('should export getPageNavigation helper', async () => {
      const module = await import(layoutHelperPath)
      expect(module.getPageNavigation).toBeDefined()
      expect(typeof module.getPageNavigation).toBe('function')
    })

    it('should export getBreadcrumbs helper', async () => {
      const module = await import(layoutHelperPath)
      expect(module.getBreadcrumbs).toBeDefined()
      expect(typeof module.getBreadcrumbs).toBe('function')
    })

    it('should export getTOC helper', async () => {
      const module = await import(layoutHelperPath)
      expect(module.getTOC).toBeDefined()
      expect(typeof module.getTOC).toBe('function')
    })
  })

  describe('Provider configuration', () => {
    const providerPath = path.join(COMPONENTS_DIR, 'docs/provider.tsx')

    it('should exist at components/docs/provider.tsx', () => {
      expect(fs.existsSync(providerPath)).toBe(true)
    })

    it('should export DocsProvider component', async () => {
      const module = await import(providerPath)
      expect(module.DocsProvider).toBeDefined()
      expect(typeof module.DocsProvider).toBe('function')
    })

    it('should configure search provider', async () => {
      const content = fs.readFileSync(providerPath, 'utf-8')
      expect(content).toMatch(/SearchProvider|search|SearchDialog/)
    })

    it('should configure theme provider', async () => {
      const content = fs.readFileSync(providerPath, 'utf-8')
      expect(content).toMatch(/ThemeProvider|theme|RootProvider/)
    })
  })

  describe('Navigation configuration', () => {
    const navConfigPath = path.join(LIB_DIR, 'nav-config.ts')

    it('should exist at lib/nav-config.ts', () => {
      expect(fs.existsSync(navConfigPath)).toBe(true)
    })

    it('should export navigation links', async () => {
      const module = await import(navConfigPath)
      expect(module.navLinks || module.links || module.navigation).toBeDefined()
    })

    it('should include docs link', async () => {
      const content = fs.readFileSync(navConfigPath, 'utf-8')
      expect(content).toMatch(/\/docs|docs/i)
    })

    it('should include GitHub link', async () => {
      const content = fs.readFileSync(navConfigPath, 'utf-8')
      expect(content).toMatch(/github|GitHub/i)
    })
  })

  describe('Components directory structure', () => {
    const docsComponentsDir = path.join(COMPONENTS_DIR, 'docs')

    it('should have components/docs/ directory', () => {
      expect(fs.existsSync(docsComponentsDir)).toBe(true)
    })

    it('should have index.ts barrel export', () => {
      const indexPath = path.join(docsComponentsDir, 'index.ts')
      expect(fs.existsSync(indexPath)).toBe(true)
    })

    it('should export all layout components from index', async () => {
      const indexPath = path.join(docsComponentsDir, 'index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')
      // Should re-export main components
      expect(content).toMatch(/export.*DocsLayout/)
      expect(content).toMatch(/export.*DocsPage/)
    })
  })
})
