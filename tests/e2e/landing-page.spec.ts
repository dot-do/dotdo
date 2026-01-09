import { test, expect } from '@playwright/test'

/**
 * E2E tests for the "Build your 1-Person Unicorn" Landing Page
 *
 * Tests the new landing page with:
 * - Hero section with startup code example
 * - Named AI agents (Priya, Ralph, Tom, etc.)
 * - How it works section (Cap'n Web, Promise Pipelining)
 * - $ Context section
 * - Features grid
 * - Pricing table
 * - CTA section
 */

test.describe('Landing Page - 1-Person Unicorn', () => {
  test.describe('Hero Section', () => {
    test('should display "Build your 1-Person Unicorn" headline', async ({ page }) => {
      await page.goto('/')
      const headline = page.locator('h1')
      await expect(headline).toContainText('1-Person Unicorn')
    })

    test('should display startup code example', async ({ page }) => {
      await page.goto('/')
      const codeBlock = page.locator('pre code')
      await expect(codeBlock.first()).toBeVisible()
      // Should contain the startup code with agents
      const codeText = await codeBlock.first().textContent()
      expect(codeText).toContain('Startup')
      expect(codeText).toContain('agents.do')
    })

    test('should have Get Started CTA button', async ({ page }) => {
      await page.goto('/')
      const ctaButton = page.locator('a:has-text("Get Started")')
      await expect(ctaButton.first()).toBeVisible()
    })

    test('should have GitHub link', async ({ page }) => {
      await page.goto('/')
      const githubLink = page.locator('a:has-text("GitHub"), a[href*="github"]')
      await expect(githubLink.first()).toBeVisible()
    })
  })

  test.describe('How It Works Section', () => {
    test('should display Cap\'n Web reference', async ({ page }) => {
      await page.goto('/')
      const capnWebLink = page.locator('a[href*="capnweb"]')
      await expect(capnWebLink).toBeVisible()
    })

    test('should display pipeline code example', async ({ page }) => {
      await page.goto('/')
      const pipelineCode = page.locator('pre code:has-text(".map")')
      await expect(pipelineCode).toBeVisible()
    })

    test('should mention Promise Pipelining or Magic Map', async ({ page }) => {
      await page.goto('/')
      const content = await page.textContent('body')
      expect(content).toMatch(/Promise Pipelining|Magic Map/i)
    })
  })

  test.describe('Meet Your Team Section', () => {
    const agents = ['Priya', 'Ralph', 'Tom', 'Rae', 'Mark', 'Sally', 'Quinn']

    test('should display all 7 AI agents', async ({ page }) => {
      await page.goto('/')
      for (const agent of agents) {
        const agentCard = page.locator(`text=${agent}`).first()
        await expect(agentCard).toBeVisible()
      }
    })

    test('should display agent roles', async ({ page }) => {
      await page.goto('/')
      const roles = ['Product', 'Engineering', 'Tech Lead', 'Frontend', 'Marketing', 'Sales', 'QA']
      for (const role of roles) {
        const roleText = page.locator(`text=${role}`).first()
        await expect(roleText).toBeVisible()
      }
    })

    test('should mention @tom-do GitHub identity', async ({ page }) => {
      await page.goto('/')
      const tomDo = page.locator('text=@tom-do')
      await expect(tomDo).toBeVisible()
    })
  })

  test.describe('$ Context Section', () => {
    test('should display durability levels code', async ({ page }) => {
      await page.goto('/')
      const durabilityCode = page.locator('pre code:has-text("$.send"), pre code:has-text("$.try"), pre code:has-text("$.do")')
      await expect(durabilityCode.first()).toBeVisible()
    })

    test('should display event handler examples', async ({ page }) => {
      await page.goto('/')
      const eventCode = page.locator('pre code:has-text("$.on.Customer")')
      await expect(eventCode).toBeVisible()
    })

    test('should display scheduling examples', async ({ page }) => {
      await page.goto('/')
      const scheduleCode = page.locator('pre code:has-text("$.every")')
      await expect(scheduleCode).toBeVisible()
    })
  })

  test.describe('Features Grid', () => {
    const features = [
      'Promise Pipelining',
      'Magic Map',
      'V8 Isolates',
      'Compat SDKs',
      'Extended Primitives',
      'Human Escalation',
    ]

    test('should display all feature cards', async ({ page }) => {
      await page.goto('/')
      for (const feature of features) {
        const featureCard = page.locator(`text=${feature}`).first()
        await expect(featureCard).toBeVisible()
      }
    })

    test('should mention 10,000 parallel agents', async ({ page }) => {
      await page.goto('/')
      const content = await page.textContent('body')
      expect(content).toContain('10,000')
    })
  })

  test.describe('Pricing Section', () => {
    test('should display $0 Egress heading', async ({ page }) => {
      await page.goto('/')
      const priceHeading = page.locator('text=$0 Egress')
      await expect(priceHeading).toBeVisible()
    })

    test('should display pricing comparison table', async ({ page }) => {
      await page.goto('/')
      const table = page.locator('table')
      await expect(table).toBeVisible()
    })

    test('should show Cloudflare R2 with $0 egress', async ({ page }) => {
      await page.goto('/')
      const r2Row = page.locator('tr:has-text("Cloudflare R2")')
      await expect(r2Row).toBeVisible()
      // Use exact text match to avoid matching "$0.015/GB-mo"
      const r2Egress = r2Row.getByRole('cell', { name: '$0', exact: true })
      await expect(r2Egress).toBeVisible()
    })

    test('should show competitor pricing', async ({ page }) => {
      await page.goto('/')
      const competitors = ['AWS S3', 'Snowflake', 'BigQuery']
      for (const competitor of competitors) {
        const row = page.locator(`tr:has-text("${competitor}")`)
        await expect(row).toBeVisible()
      }
    })
  })

  test.describe('CTA Section', () => {
    test('should display final CTA headline', async ({ page }) => {
      await page.goto('/')
      const ctaHeadline = page.locator('text=Ready to build your 1-Person Unicorn')
      await expect(ctaHeadline).toBeVisible()
    })

    test('should have Read the Docs button', async ({ page }) => {
      await page.goto('/')
      const docsButton = page.locator('a:has-text("Read the Docs")')
      await expect(docsButton).toBeVisible()
    })

    test('should have Star on GitHub button', async ({ page }) => {
      await page.goto('/')
      const githubButton = page.locator('a:has-text("Star on GitHub")')
      await expect(githubButton).toBeVisible()
    })
  })

  test.describe('Footer', () => {
    test('should display .do brand', async ({ page }) => {
      await page.goto('/')
      const footer = page.locator('footer')
      await expect(footer).toBeVisible()
      await expect(footer.locator('text=.do').first()).toBeVisible()
    })

    test('should have platform links', async ({ page }) => {
      await page.goto('/')
      const links = ['platform.do', 'agents.do', 'workers.do']
      for (const link of links) {
        const linkElement = page.locator(`a:has-text("${link}")`)
        await expect(linkElement).toBeVisible()
      }
    })

    test('should have MIT License text', async ({ page }) => {
      await page.goto('/')
      const license = page.locator('footer:has-text("MIT")')
      await expect(license).toBeVisible()
    })
  })

  test.describe('Navigation', () => {
    test('should navigate to docs', async ({ page }) => {
      await page.goto('/')
      // Use exact "Docs" text to avoid matching "Get Started" which also links to /docs
      const docsLink = page.getByRole('link', { name: 'Docs', exact: true })
      await docsLink.click()
      await expect(page).toHaveURL(/\/docs/)
    })

    test('should have working Get Started button', async ({ page }) => {
      await page.goto('/')
      const ctaButton = page.locator('a:has-text("Get Started")').first()
      await ctaButton.click()
      // Should navigate to docs or platform.do
      await expect(page).toHaveURL(/\/docs|platform\.do/)
    })
  })

  test.describe('Accessibility', () => {
    test('should have skip to content link', async ({ page }) => {
      await page.goto('/')
      const skipLink = page.locator('a[href="#main-content"]')
      await expect(skipLink).toBeAttached()
    })

    test('should have single h1', async ({ page }) => {
      await page.goto('/')
      const h1s = page.locator('h1')
      await expect(h1s).toHaveCount(1)
    })

    test('should be keyboard navigable', async ({ page }) => {
      await page.goto('/')
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => document.activeElement?.tagName)
      expect(focused).toBe('A')
    })
  })

  test.describe('Responsive Design', () => {
    test('should work on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')
      const headline = page.locator('h1')
      await expect(headline).toBeVisible()
    })

    test('should work on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 })
      await page.goto('/')
      const headline = page.locator('h1')
      await expect(headline).toBeVisible()
    })

    test('should stack agent cards on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')
      // Agent grid should be visible
      const priya = page.locator('text=Priya').first()
      await expect(priya).toBeVisible()
    })
  })
})
