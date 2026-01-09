import { test, expect } from '@playwright/test'

/**
 * E2E tests for .do/Site.mdx rendering with @dotdo/landing (TDD RED Phase)
 *
 * These tests verify:
 * 1. The / route renders content from .do/Site.mdx
 * 2. Uses PrimitivePage from @dotdo/landing package
 * 3. MDX components (AgentGrid, Agent, FeatureGrid, Feature, CTA) render correctly
 * 4. Content matches Site.mdx structure
 *
 * EXPECTED TO FAIL: @dotdo/landing package doesn't exist yet.
 * This is the RED phase of TDD.
 *
 * Implementation requirements:
 * - Create @dotdo/landing package with PrimitivePage component
 * - PrimitivePage should accept MDX content and render with proper layout
 * - MDX components: AgentGrid, Agent, FeatureGrid, Feature, CTA
 * - Route handler should load .do/Site.mdx and render via PrimitivePage
 */

test.describe('Site.mdx Rendering via @dotdo/landing', () => {
  test.describe('MDX Content Loading', () => {
    test('should render content from .do/Site.mdx file', async ({ page }) => {
      await page.goto('/')

      // Verify the exact h1 from Site.mdx
      const headline = page.locator('h1')
      await expect(headline).toHaveText('Build your 1-Person Unicorn.')
    })

    test('should render the hero subtitle from MDX', async ({ page }) => {
      await page.goto('/')

      // Exact text from Site.mdx line 3-4
      const subtitle = page.getByText("Deploy a startup with product, engineering, marketing, and sales.")
      await expect(subtitle).toBeVisible()

      const tagline = page.getByText("It's Tuesday. You're one person.")
      await expect(tagline).toBeVisible()
    })

    test('should render all MDX sections in order', async ({ page }) => {
      await page.goto('/')

      // Verify section headings appear in order from Site.mdx
      const sections = [
        'How This Actually Works',
        'Meet Your Team',
        'The $ Context',
        'Why We Rebuilt Everything',
        '$0 Egress. Forever.',
        'Ready to build your 1-Person Unicorn?',
      ]

      const h2s = page.locator('h2')
      const count = await h2s.count()
      expect(count).toBeGreaterThanOrEqual(sections.length)

      for (let i = 0; i < sections.length; i++) {
        await expect(h2s.nth(i)).toContainText(sections[i])
      }
    })

    test('should render code blocks from MDX with syntax highlighting', async ({ page }) => {
      await page.goto('/')

      // First code block - the startup example
      const startupCode = page.locator('pre code').first()
      await expect(startupCode).toContainText('import { Startup }')
      await expect(startupCode).toContainText("from 'dotdo'")
      await expect(startupCode).toContainText('class MyStartup extends Startup')
      await expect(startupCode).toContainText('await priya`define the MVP')
      await expect(startupCode).toContainText('await ralph`build ${spec}`')
      await expect(startupCode).toContainText('await tom`ship ${app}`')
    })

    test('should render horizontal rules as section dividers', async ({ page }) => {
      await page.goto('/')

      // Site.mdx has --- dividers between sections
      const dividers = page.locator('hr')
      await expect(dividers).toHaveCount(6) // 6 horizontal rules in Site.mdx
    })
  })

  test.describe('PrimitivePage Component', () => {
    test('should use PrimitivePage layout wrapper', async ({ page }) => {
      await page.goto('/')

      // PrimitivePage should add data attribute for identification
      const primitivePageWrapper = page.locator('[data-primitive-page="true"]')
      await expect(primitivePageWrapper).toBeVisible()
    })

    test('should have PrimitivePage header with navigation', async ({ page }) => {
      await page.goto('/')

      const header = page.locator('[data-primitive-header]')
      await expect(header).toBeVisible()
    })

    test('should have PrimitivePage footer', async ({ page }) => {
      await page.goto('/')

      const footer = page.locator('[data-primitive-footer]')
      await expect(footer).toBeVisible()
    })

    test('should render MDX content in main content area', async ({ page }) => {
      await page.goto('/')

      const main = page.locator('[data-primitive-content], main')
      await expect(main).toBeVisible()
      await expect(main).toContainText('Build your 1-Person Unicorn')
    })
  })

  test.describe('AgentGrid Component', () => {
    test('should render AgentGrid container', async ({ page }) => {
      await page.goto('/')

      const agentGrid = page.locator('[data-component="AgentGrid"]')
      await expect(agentGrid).toBeVisible()
    })

    test('should render exactly 7 Agent cards', async ({ page }) => {
      await page.goto('/')

      const agentCards = page.locator('[data-component="Agent"]')
      await expect(agentCards).toHaveCount(7)
    })

    test('should render Agent: Priya (Product)', async ({ page }) => {
      await page.goto('/')

      const priyaCard = page.locator('[data-component="Agent"][data-agent-name="Priya"]')
      await expect(priyaCard).toBeVisible()
      await expect(priyaCard).toContainText('Product')
      await expect(priyaCard).toContainText('specs, roadmaps, priorities')

      // Should display avatar
      const avatar = priyaCard.locator('[data-agent-avatar]')
      await expect(avatar).toContainText('P')
    })

    test('should render Agent: Ralph (Engineering)', async ({ page }) => {
      await page.goto('/')

      const ralphCard = page.locator('[data-component="Agent"][data-agent-name="Ralph"]')
      await expect(ralphCard).toBeVisible()
      await expect(ralphCard).toContainText('Engineering')
      await expect(ralphCard).toContainText('builds what you need')
    })

    test('should render Agent: Tom (Tech Lead)', async ({ page }) => {
      await page.goto('/')

      const tomCard = page.locator('[data-component="Agent"][data-agent-name="Tom"]')
      await expect(tomCard).toBeVisible()
      await expect(tomCard).toContainText('Tech Lead')
      await expect(tomCard).toContainText('architecture, code review')
    })

    test('should render Agent: Rae (Frontend)', async ({ page }) => {
      await page.goto('/')

      const raeCard = page.locator('[data-component="Agent"][data-agent-name="Rae"]')
      await expect(raeCard).toBeVisible()
      await expect(raeCard).toContainText('Frontend')
      await expect(raeCard).toContainText('React, UI, accessibility')
    })

    test('should render Agent: Mark (Marketing)', async ({ page }) => {
      await page.goto('/')

      const markCard = page.locator('[data-component="Agent"][data-agent-name="Mark"]')
      await expect(markCard).toBeVisible()
      await expect(markCard).toContainText('Marketing')
      await expect(markCard).toContainText('copy, content, launches')
    })

    test('should render Agent: Sally (Sales)', async ({ page }) => {
      await page.goto('/')

      const sallyCard = page.locator('[data-component="Agent"][data-agent-name="Sally"]')
      await expect(sallyCard).toBeVisible()
      await expect(sallyCard).toContainText('Sales')
      await expect(sallyCard).toContainText('outreach, demos, closing')
    })

    test('should render Agent: Quinn (QA)', async ({ page }) => {
      await page.goto('/')

      const quinnCard = page.locator('[data-component="Agent"][data-agent-name="Quinn"]')
      await expect(quinnCard).toBeVisible()
      await expect(quinnCard).toContainText('QA')
      await expect(quinnCard).toContainText('testing, edge cases, quality')
    })

    test('should render AgentGrid in responsive grid layout', async ({ page }) => {
      await page.goto('/')

      const agentGrid = page.locator('[data-component="AgentGrid"]')
      const gridStyle = await agentGrid.evaluate((el) => window.getComputedStyle(el).display)
      expect(gridStyle).toBe('grid')
    })
  })

  test.describe('FeatureGrid Component', () => {
    test('should render FeatureGrid container', async ({ page }) => {
      await page.goto('/')

      const featureGrid = page.locator('[data-component="FeatureGrid"]')
      await expect(featureGrid).toBeVisible()
    })

    test('should render exactly 6 Feature cards', async ({ page }) => {
      await page.goto('/')

      const featureCards = page.locator('[data-component="Feature"]')
      await expect(featureCards).toHaveCount(6)
    })

    test('should render Feature: Promise Pipelining with icon', async ({ page }) => {
      await page.goto('/')

      const feature = page.locator('[data-component="Feature"]:has-text("Promise Pipelining")')
      await expect(feature).toBeVisible()
      await expect(feature).toContainText('Multiple agent calls execute in one network round trip')

      // Should have icon
      const icon = feature.locator('[data-feature-icon]')
      await expect(icon).toHaveText('\u26A1') // lightning bolt emoji
    })

    test('should render Feature: Magic Map with icon', async ({ page }) => {
      await page.goto('/')

      const feature = page.locator('[data-component="Feature"]:has-text("Magic Map")')
      await expect(feature).toBeVisible()
      await expect(feature).toContainText('.map() isn\'t JavaScript\'s array method')

      const icon = feature.locator('[data-feature-icon]')
      await expect(icon).toHaveText('\uD83D\uDDFA\uFE0F') // world map emoji
    })

    test('should render Feature: V8 Isolates with icon', async ({ page }) => {
      await page.goto('/')

      const feature = page.locator('[data-component="Feature"]:has-text("V8 Isolates")')
      await expect(feature).toBeVisible()
      await expect(feature).toContainText('Virtual Chrome tabs with persistent state')
      await expect(feature).toContainText('300+ cities')
    })

    test('should render Feature: 38 Compat SDKs with icon', async ({ page }) => {
      await page.goto('/')

      const feature = page.locator('[data-component="Feature"]:has-text("Compat SDKs")')
      await expect(feature).toBeVisible()
      await expect(feature).toContainText('Supabase, MongoDB, Kafka, Redis')
    })

    test('should render Feature: Extended Primitives with icon', async ({ page }) => {
      await page.goto('/')

      const feature = page.locator('[data-component="Feature"]:has-text("Extended Primitives")')
      await expect(feature).toBeVisible()
      await expect(feature).toContainText('fsx (filesystem), gitx (version control), bashx (shell)')
    })

    test('should render Feature: Human Escalation with icon', async ({ page }) => {
      await page.goto('/')

      const feature = page.locator('[data-component="Feature"]:has-text("Human Escalation")')
      await expect(feature).toBeVisible()
      await expect(feature).toContainText('AI does the work. Humans make decisions')
      await expect(feature).toContainText('Slack, email, SMS')
    })

    test('should render FeatureGrid in responsive grid layout', async ({ page }) => {
      await page.goto('/')

      const featureGrid = page.locator('[data-component="FeatureGrid"]')
      const gridStyle = await featureGrid.evaluate((el) => window.getComputedStyle(el).display)
      expect(gridStyle).toBe('grid')
    })
  })

  test.describe('CTA Component', () => {
    test('should render CTA component', async ({ page }) => {
      await page.goto('/')

      const cta = page.locator('[data-component="CTA"]')
      await expect(cta).toBeVisible()
    })

    test('should render CTA with primary link to /docs', async ({ page }) => {
      await page.goto('/')

      const cta = page.locator('[data-component="CTA"]')
      const primaryButton = cta.locator('[data-cta-primary]')

      await expect(primaryButton).toBeVisible()
      await expect(primaryButton).toHaveAttribute('href', '/docs')
    })

    test('should render CTA with secondary link to GitHub', async ({ page }) => {
      await page.goto('/')

      const cta = page.locator('[data-component="CTA"]')
      const secondaryButton = cta.locator('[data-cta-secondary]')

      await expect(secondaryButton).toBeVisible()
      await expect(secondaryButton).toHaveAttribute('href', 'https://github.com/dot-do/dotdo')
    })

    test('should render CTA button text from children', async ({ page }) => {
      await page.goto('/')

      const cta = page.locator('[data-component="CTA"]')
      await expect(cta).toContainText('Get Started')
    })
  })

  test.describe('MDX Markdown Elements', () => {
    test('should render markdown table from Site.mdx', async ({ page }) => {
      await page.goto('/')

      const table = page.locator('table')
      await expect(table).toBeVisible()

      // Verify table headers
      const headers = table.locator('th')
      await expect(headers.nth(0)).toContainText('Service')
      await expect(headers.nth(1)).toContainText('Egress')
      await expect(headers.nth(2)).toContainText('Storage')

      // Verify Cloudflare R2 row
      const r2Row = table.locator('tr:has-text("Cloudflare R2")')
      await expect(r2Row).toContainText('$0')
      await expect(r2Row).toContainText('$0.015/GB-mo')

      // Verify competitors
      const awsRow = table.locator('tr:has-text("AWS S3")')
      await expect(awsRow).toContainText('$0.09/GB')

      const snowflakeRow = table.locator('tr:has-text("Snowflake")')
      await expect(snowflakeRow).toContainText('$0.05-0.12/GB')

      const bigQueryRow = table.locator('tr:has-text("BigQuery")')
      await expect(bigQueryRow).toContainText('$0.05-0.12/GB')
    })

    test('should render markdown links correctly', async ({ page }) => {
      await page.goto('/')

      // Verify Cap'n Web link from Site.mdx
      const capnWebLink = page.locator('a[href="https://github.com/cloudflare/capnweb"]')
      await expect(capnWebLink).toBeVisible()
      await expect(capnWebLink).toContainText("Cap'n Web")

      // Verify footer links
      const platformLink = page.locator('a[href="https://platform.do"]')
      await expect(platformLink).toBeVisible()

      const agentsLink = page.locator('a[href="https://agents.do"]')
      await expect(agentsLink).toBeVisible()

      const workersLink = page.locator('a[href="https://workers.do"]')
      await expect(workersLink).toBeVisible()
    })

    test('should render inline code snippets', async ({ page }) => {
      await page.goto('/')

      // Check for inline code in various sections
      const inlineCode = page.locator('code:not(pre code)')

      // The .map() reference
      const mapCode = page.locator('code:has-text(".map()")')
      await expect(mapCode.first()).toBeVisible()
    })

    test('should render strong/bold text', async ({ page }) => {
      await page.goto('/')

      // Check for bold text in sections
      const boldText = page.locator('strong')

      // "Solo founders", "Small teams", "Growing startups" should be bold
      await expect(boldText.filter({ hasText: 'Solo founders' })).toBeVisible()
      await expect(boldText.filter({ hasText: 'Small teams' })).toBeVisible()
      await expect(boldText.filter({ hasText: 'Growing startups' })).toBeVisible()
    })
  })

  test.describe('@dotdo/landing Package Integration', () => {
    test('should load @dotdo/landing styles', async ({ page }) => {
      await page.goto('/')

      // Verify CSS is loaded from @dotdo/landing
      const styles = await page.evaluate(() => {
        const styleSheets = Array.from(document.styleSheets)
        return styleSheets.some(
          (sheet) => sheet.href?.includes('dotdo-landing') || sheet.href?.includes('@dotdo/landing')
        )
      })

      // If no external stylesheet, check for inline styles or CSS modules
      const hasLandingClasses = await page.evaluate(() => {
        const body = document.body.innerHTML
        return body.includes('data-primitive') || body.includes('landing-')
      })

      expect(styles || hasLandingClasses).toBe(true)
    })

    test('should apply consistent design system', async ({ page }) => {
      await page.goto('/')

      // Verify design tokens are applied (colors, spacing, typography)
      const h1 = page.locator('h1')
      const h1Styles = await h1.evaluate((el) => {
        const styles = window.getComputedStyle(el)
        return {
          fontSize: styles.fontSize,
          fontWeight: styles.fontWeight,
          lineHeight: styles.lineHeight,
        }
      })

      // Should have appropriate heading styles
      expect(parseFloat(h1Styles.fontSize)).toBeGreaterThan(24)
      expect(parseInt(h1Styles.fontWeight)).toBeGreaterThanOrEqual(600)
    })

    test('should support dark mode', async ({ page }) => {
      await page.goto('/')

      // Check for dark mode support
      const hasDarkMode = await page.evaluate(() => {
        const html = document.documentElement
        return (
          html.classList.contains('dark') ||
          html.getAttribute('data-theme') === 'dark' ||
          window.matchMedia('(prefers-color-scheme: dark)').matches
        )
      })

      // Page should at minimum respond to dark mode
      const darkModeClasses = await page.evaluate(() => {
        const body = document.body.innerHTML
        return body.includes('dark:')
      })

      expect(hasDarkMode || darkModeClasses).toBe(true)
    })
  })

  test.describe('Route Configuration', () => {
    test('should serve / route from Site.mdx', async ({ page }) => {
      const response = await page.goto('/')

      // Should be successful
      expect(response?.status()).toBe(200)

      // Content type should be HTML
      const contentType = response?.headers()['content-type']
      expect(contentType).toContain('text/html')
    })

    test('should not serve .do/Site.mdx directly', async ({ page }) => {
      // The MDX file should not be directly accessible
      const response = await page.goto('/.do/Site.mdx')

      // Should either 404 or redirect
      expect([301, 302, 404]).toContain(response?.status())
    })

    test('should use server-side rendering for MDX', async ({ page }) => {
      await page.goto('/')

      // Check that content is present in initial HTML (not just client-rendered)
      const html = await page.content()

      // The h1 should be in the initial HTML
      expect(html).toContain('Build your 1-Person Unicorn')

      // Agent names should be in initial HTML
      expect(html).toContain('Priya')
      expect(html).toContain('Ralph')
      expect(html).toContain('Tom')
    })

    test('should have proper meta tags from MDX frontmatter', async ({ page }) => {
      await page.goto('/')

      // Check for essential meta tags that PrimitivePage should set
      const title = await page.title()
      expect(title).toContain('dotdo')

      const description = page.locator('meta[name="description"]')
      await expect(description).toHaveAttribute('content', /.+/)

      const ogTitle = page.locator('meta[property="og:title"]')
      await expect(ogTitle).toBeAttached()

      const ogDescription = page.locator('meta[property="og:description"]')
      await expect(ogDescription).toBeAttached()
    })
  })

  test.describe('Interactive Behavior', () => {
    test('should navigate via CTA primary button', async ({ page }) => {
      await page.goto('/')

      const primaryCta = page.locator('[data-cta-primary]')
      await primaryCta.click()

      await expect(page).toHaveURL(/\/docs/)
    })

    test('should open GitHub in new tab via CTA secondary button', async ({ page }) => {
      await page.goto('/')

      const secondaryCta = page.locator('[data-cta-secondary]')

      // GitHub link should open in new tab
      await expect(secondaryCta).toHaveAttribute('target', '_blank')
      await expect(secondaryCta).toHaveAttribute('rel', /noopener/)
    })

    test('should handle keyboard navigation through agent cards', async ({ page }) => {
      await page.goto('/')

      // Tab through the page and verify focus lands on interactive elements
      await page.keyboard.press('Tab')

      // Should be able to navigate to and through agent cards if they have interactive elements
      const focusedElement = await page.evaluate(() => document.activeElement?.tagName)
      expect(focusedElement).toBeTruthy()
    })

    test('should scroll to sections via anchor links', async ({ page }) => {
      await page.goto('/')

      // If there are anchor links in navigation, clicking should scroll
      const howItWorksLink = page.locator('a[href="#how-this-actually-works"]')

      if ((await howItWorksLink.count()) > 0) {
        await howItWorksLink.click()
        await expect(page).toHaveURL(/#how-this-actually-works/)
      }
    })
  })

  test.describe('Performance', () => {
    test('should load initial page in under 3 seconds', async ({ page }) => {
      const startTime = Date.now()
      await page.goto('/')
      const loadTime = Date.now() - startTime

      expect(loadTime).toBeLessThan(3000)
    })

    test('should have LCP element visible quickly', async ({ page }) => {
      await page.goto('/')

      // The h1 should be the LCP element and visible immediately
      const h1 = page.locator('h1')
      await expect(h1).toBeVisible({ timeout: 1000 })
    })

    test('should not have layout shift on agent cards', async ({ page }) => {
      await page.goto('/')

      // Agent cards should not cause layout shifts
      const agentGrid = page.locator('[data-component="AgentGrid"]')

      // Wait for page to stabilize
      await page.waitForLoadState('networkidle')

      // The grid should maintain its position
      const box1 = await agentGrid.boundingBox()
      await page.waitForTimeout(100)
      const box2 = await agentGrid.boundingBox()

      expect(box1?.y).toBe(box2?.y)
    })
  })

  test.describe('Accessibility', () => {
    test('should have accessible AgentGrid with proper roles', async ({ page }) => {
      await page.goto('/')

      const agentGrid = page.locator('[data-component="AgentGrid"]')

      // Should have proper list semantics
      const role = await agentGrid.getAttribute('role')
      expect(role === 'list' || (await agentGrid.evaluate((el) => el.tagName === 'UL'))).toBe(true)
    })

    test('should have accessible Agent cards', async ({ page }) => {
      await page.goto('/')

      const agentCards = page.locator('[data-component="Agent"]')
      const firstCard = agentCards.first()

      // Should be listitem or article
      const role = await firstCard.getAttribute('role')
      const tagName = await firstCard.evaluate((el) => el.tagName)

      expect(role === 'listitem' || role === 'article' || tagName === 'LI' || tagName === 'ARTICLE').toBe(true)
    })

    test('should have accessible FeatureGrid with proper roles', async ({ page }) => {
      await page.goto('/')

      const featureGrid = page.locator('[data-component="FeatureGrid"]')

      const role = await featureGrid.getAttribute('role')
      expect(role === 'list' || (await featureGrid.evaluate((el) => el.tagName === 'UL'))).toBe(true)
    })

    test('should have sufficient color contrast', async ({ page }) => {
      await page.goto('/')

      // Test that text is readable (basic contrast check)
      const h1 = page.locator('h1')
      const h1Color = await h1.evaluate((el) => {
        const styles = window.getComputedStyle(el)
        return {
          color: styles.color,
          backgroundColor: styles.backgroundColor,
        }
      })

      // H1 should not be invisible (same color as background)
      expect(h1Color.color).not.toBe(h1Color.backgroundColor)
    })

    test('should have aria-label on icon-only elements', async ({ page }) => {
      await page.goto('/')

      // Feature icons should have aria-label for screen readers
      const featureIcons = page.locator('[data-feature-icon]')
      const iconCount = await featureIcons.count()

      for (let i = 0; i < iconCount; i++) {
        const icon = featureIcons.nth(i)
        const ariaLabel = await icon.getAttribute('aria-label')
        const ariaHidden = await icon.getAttribute('aria-hidden')

        // Either has aria-label or is hidden from screen readers
        expect(ariaLabel || ariaHidden === 'true').toBe(true)
      }
    })
  })
})
