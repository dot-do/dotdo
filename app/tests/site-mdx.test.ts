import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'

/**
 * Site.mdx Rendering Tests (TDD RED Phase)
 *
 * These tests verify that the landing page (/) renders content from Site.mdx
 * rather than being hardcoded in app/routes/index.tsx.
 *
 * These tests are expected to FAIL until Site.mdx is properly integrated.
 *
 * Current state: app/routes/index.tsx has hardcoded content
 * Target state: / route renders parsed content from Site.mdx
 *
 * Site.mdx locations (in priority order):
 * 1. .do/Site.mdx
 * 2. Site.mdx (root)
 *
 * @see https://github.com/dot-do/dotdo/issues/dotdo-xiavo
 */

// Helper to render the landing page
async function fetchPage(path: string): Promise<string> {
  const { renderPage } = await import('../src/render')
  return renderPage(path)
}

// Helper to get the Site.mdx content
async function getSiteMdxContent(): Promise<string> {
  const rootDir = join(__dirname, '../..')
  const dotDoPath = join(rootDir, '.do/Site.mdx')
  const rootPath = join(rootDir, 'Site.mdx')

  if (existsSync(dotDoPath)) {
    return readFile(dotDoPath, 'utf-8')
  }
  if (existsSync(rootPath)) {
    return readFile(rootPath, 'utf-8')
  }
  throw new Error('Site.mdx not found in .do/ or root directory')
}

// =============================================================================
// Site.mdx File Existence Tests
// =============================================================================

describe('Site.mdx File', () => {
  it('should exist in root or .do folder', () => {
    const rootDir = join(__dirname, '../..')
    const dotDoExists = existsSync(join(rootDir, '.do/Site.mdx'))
    const rootExists = existsSync(join(rootDir, 'Site.mdx'))

    expect(dotDoExists || rootExists).toBe(true)
  })

  it('should contain MDX content with unique identifiers', async () => {
    const content = await getSiteMdxContent()

    // Site.mdx should have the headline
    expect(content).toContain('Build your 1-Person Unicorn')

    // Site.mdx has unique content not in hardcoded index.tsx
    expect(content).toContain("It's Tuesday. You're one person.")
    expect(content).toContain('Your business is running. Go back to bed.')
  })

  it('should contain MDX components', async () => {
    const content = await getSiteMdxContent()

    // Site.mdx uses custom MDX components
    expect(content).toContain('<AgentGrid>')
    expect(content).toContain('<Agent')
    expect(content).toContain('<FeatureGrid>')
    expect(content).toContain('<Feature')
    expect(content).toContain('<CTA')
  })
})

// =============================================================================
// Landing Page Renders from Site.mdx (These should FAIL in RED phase)
// =============================================================================

describe('Landing Page Renders Site.mdx Content', () => {
  let html: string
  let siteMdxContent: string

  beforeAll(async () => {
    html = await fetchPage('/')
    siteMdxContent = await getSiteMdxContent()
  })

  describe('unique Site.mdx content appears in rendered page', () => {
    /**
     * RED TEST: This test MUST fail because index.tsx is hardcoded.
     *
     * Site.mdx contains "It's Tuesday. You're one person." which is
     * NOT present in the current hardcoded app/routes/index.tsx.
     *
     * This test will pass only when Site.mdx is being rendered.
     */
    it('should render the unique tagline from Site.mdx', () => {
      // This unique phrase is in Site.mdx but NOT in hardcoded index.tsx
      expect(html).toContain("It's Tuesday. You're one person.")
    })

    /**
     * RED TEST: This test MUST fail because index.tsx is hardcoded.
     *
     * Site.mdx contains "Your business is running. Go back to bed."
     * in the code example comment, which is NOT in hardcoded index.tsx.
     */
    it('should render the code comment from Site.mdx', () => {
      // This unique phrase is in Site.mdx code block but NOT in hardcoded index.tsx
      expect(html).toContain('Your business is running. Go back to bed.')
    })

    /**
     * RED TEST: This test MUST fail because index.tsx is hardcoded.
     *
     * Site.mdx has a "Meet Your Team" section that introduces the agents.
     * The hardcoded index.tsx does NOT have this section.
     */
    it('should render the Meet Your Team section from Site.mdx', () => {
      expect(html).toContain('Meet Your Team')
    })

    /**
     * RED TEST: This test MUST fail because index.tsx is hardcoded.
     *
     * Site.mdx has "$0 Egress. Forever." as a section header.
     * The hardcoded index.tsx does NOT have this exact text.
     */
    it('should render the $0 Egress section from Site.mdx', () => {
      expect(html).toContain('$0 Egress. Forever.')
    })

    /**
     * RED TEST: This test MUST fail because index.tsx is hardcoded.
     *
     * Site.mdx describes agents having "real identity" with email and GitHub.
     * The hardcoded index.tsx does NOT have this content.
     */
    it('should render the agent identity description from Site.mdx', () => {
      expect(html).toContain('Each agent has real identity')
      expect(html).toContain('@tom-do')
    })

    /**
     * RED TEST: This test MUST fail because index.tsx is hardcoded.
     *
     * Site.mdx has "How This Actually Works" section explaining Cap'n Web.
     * The hardcoded index.tsx does NOT have this section header.
     */
    it('should render the How This Actually Works section from Site.mdx', () => {
      expect(html).toContain('How This Actually Works')
    })

    /**
     * RED TEST: This test MUST fail because index.tsx is hardcoded.
     *
     * Site.mdx has "Why We Rebuilt Everything" section.
     * The hardcoded index.tsx does NOT have this section.
     */
    it('should render the Why We Rebuilt Everything section from Site.mdx', () => {
      expect(html).toContain('Why We Rebuilt Everything')
    })

    /**
     * RED TEST: This test MUST fail because index.tsx is hardcoded.
     *
     * Site.mdx mentions "10,000 parallel AI agents" in the Why section.
     * The hardcoded index.tsx does NOT contain this specific metric.
     */
    it('should render the scale metric from Site.mdx', () => {
      expect(html).toContain('10,000 parallel AI agents')
    })
  })

  describe('Site.mdx MDX components are rendered', () => {
    /**
     * RED TEST: Site.mdx uses AgentGrid component with Agent children.
     *
     * The rendered HTML should contain agent information like:
     * - Priya (Product)
     * - Ralph (Engineering)
     * - Tom (Tech Lead)
     * - Rae (Frontend)
     * - Mark (Marketing)
     * - Sally (Sales)
     * - Quinn (QA)
     */
    it('should render all agents from AgentGrid component', () => {
      // Check for agent names and roles that are in Site.mdx AgentGrid
      expect(html).toContain('Priya')
      expect(html).toContain('Product')
      expect(html).toContain('Ralph')
      expect(html).toContain('Engineering')
      expect(html).toContain('Tom')
      expect(html).toContain('Tech Lead')
      expect(html).toContain('Rae')
      expect(html).toContain('Frontend')
      expect(html).toContain('Mark')
      expect(html).toContain('Marketing')
      expect(html).toContain('Sally')
      expect(html).toContain('Sales')
      expect(html).toContain('Quinn')
      expect(html).toContain('QA')
    })

    /**
     * RED TEST: Site.mdx uses FeatureGrid with Feature children.
     *
     * The Feature components in Site.mdx have different titles than
     * the hardcoded features array in index.tsx. Site.mdx uses emoji icons.
     */
    it('should render FeatureGrid with emoji icons from Site.mdx', () => {
      // Site.mdx has emoji icons in Feature components
      // The hardcoded index.tsx uses '1', '2', '3', etc. as icons
      // This test checks for the emoji-based Feature rendering
      expect(html).toMatch(/Promise Pipelining/i)
      expect(html).toMatch(/Magic Map/i)
    })

    /**
     * RED TEST: Site.mdx has a pricing table comparing services.
     *
     * The Site.mdx has a markdown table showing Cloudflare R2 vs AWS S3
     * vs Snowflake vs BigQuery. This is NOT in the hardcoded index.tsx.
     */
    it('should render the egress comparison table from Site.mdx', () => {
      expect(html).toContain('Cloudflare R2')
      expect(html).toContain('AWS S3')
      expect(html).toContain('Snowflake')
      expect(html).toContain('BigQuery')
    })
  })
})

// =============================================================================
// Site.mdx Frontmatter Metadata Tests
// =============================================================================

describe('Site.mdx Frontmatter Metadata', () => {
  /**
   * Future test: Site.mdx should have frontmatter for SEO.
   *
   * Expected frontmatter:
   * ---
   * title: "Build your 1-Person Unicorn"
   * description: "Deploy a startup with product, engineering, marketing, and sales."
   * ---
   *
   * This frontmatter should be used for:
   * - <title> tag
   * - meta description
   * - og:title
   * - og:description
   * - twitter:title
   * - twitter:description
   */
  it.todo('should extract frontmatter for SEO metadata')
  it.todo('should use frontmatter title for page title')
  it.todo('should use frontmatter description for meta description')
})

// =============================================================================
// Site.mdx Source Detection Tests
// =============================================================================

describe('Site.mdx Source Loading', () => {
  /**
   * The site source loader should:
   * 1. Check .do/Site.mdx first
   * 2. Fall back to Site.mdx in root
   * 3. Parse MDX and extract content + frontmatter
   * 4. Provide components for @mdxui/beacon
   */
  it.todo('should load Site.mdx from .do/ folder if it exists')
  it.todo('should fall back to root Site.mdx if .do/Site.mdx missing')
  it.todo('should parse MDX content correctly')
  it.todo('should provide @mdxui/beacon components for MDX rendering')
})
