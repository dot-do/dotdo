import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

/**
 * App MDX Tests (TDD RED Phase)
 *
 * These tests verify that the /app route renders content from App.mdx.
 * They are expected to FAIL until App.mdx rendering is implemented.
 *
 * Current state: App routes are hardcoded React components in:
 * - app/routes/app/_app.tsx (layout)
 * - app/routes/app/_app.index.tsx (dashboard)
 *
 * Target state: Consumer-facing app comes from App.mdx (root or .do/ folder)
 *
 * App.mdx should provide:
 * - Dashboard layout with DashboardLayout component
 * - Sidebar navigation
 * - KPI cards for Active Agents, Workflows Running, Events Today
 * - AgentStatus component showing Priya, Ralph, Tom, etc.
 * - CommandPalette with agent commands
 */

// Mock page fetcher - will need actual implementation for /app route
async function fetchAppPage(): Promise<string> {
  // TODO: Replace with actual page rendering/fetching
  // This should render the /app route and return HTML
  const { renderPage } = await import('../src/render')
  // Extend renderPage to support /app route from App.mdx
  try {
    return await renderPage('/app')
  } catch {
    // Currently /app is not supported, so fall back to reading the actual route file
    // to show that it doesn't contain App.mdx content
    const routeContent = await readFile('routes/app/_app.index.tsx', 'utf-8')
    return routeContent
  }
}

// Helper to check if content contains MDX-specific patterns from App.mdx
function containsAppMdxContent(content: string): boolean {
  // These are unique identifiers from App.mdx that should appear in rendered output
  const appMdxMarkers = [
    'Your autonomous business control center', // From App.mdx description
    'Active Agents', // KPICard in App.mdx
    'Workflows Running', // KPICard in App.mdx
    'Events Today', // KPICard in App.mdx
    'AgentStatus', // Component from App.mdx
    'Monitor your AI agents in real-time', // AgentStatus description
    'CommandPalette', // Component from App.mdx
    'Ask Priya for product direction', // CommandItem in App.mdx
    'Have Ralph start building', // CommandItem in App.mdx
    'Request code review from Tom', // CommandItem in App.mdx
  ]

  return appMdxMarkers.some((marker) => content.includes(marker))
}

// ============================================================================
// App.mdx File Existence Tests
// ============================================================================

describe('App.mdx Source Files', () => {
  it('should have App.mdx in root directory', () => {
    // App.mdx exists in the project root (one level up from app/)
    expect(existsSync('../App.mdx')).toBe(true)
  })

  it('should have App.mdx in .do/ directory', () => {
    // App.mdx also exists in .do/ folder (one level up from app/)
    expect(existsSync('../.do/App.mdx')).toBe(true)
  })

  it('App.mdx should contain dashboard content', async () => {
    const content = await readFile('../App.mdx', 'utf-8')

    // App.mdx should have the dashboard heading
    expect(content).toContain('# dotdo Dashboard')

    // App.mdx should use DashboardLayout component
    expect(content).toContain('<DashboardLayout>')

    // App.mdx should have KPICards
    expect(content).toContain('KPICard')

    // App.mdx should reference the agents
    expect(content).toContain('priya')
    expect(content).toContain('ralph')
    expect(content).toContain('tom')
  })
})

// ============================================================================
// App Route Renders from App.mdx Tests
// ============================================================================

describe('App Route Renders from App.mdx', () => {
  it('should render content from App.mdx at /app route', async () => {
    // This test will FAIL because currently /app renders hardcoded React
    // The test expects the route to render content from App.mdx
    const html = await fetchAppPage()

    // The rendered HTML should contain App.mdx-specific content
    expect(containsAppMdxContent(html)).toBe(true)
  })

  it('should render the dashboard title from App.mdx', async () => {
    const html = await fetchAppPage()

    // App.mdx starts with "# dotdo Dashboard"
    // The rendered HTML should include this or rendered version of it
    expect(html).toContain('dotdo Dashboard')
  })

  it('should render the dashboard description from App.mdx', async () => {
    const html = await fetchAppPage()

    // App.mdx contains "Your autonomous business control center."
    expect(html).toContain('Your autonomous business control center')
  })

  it('should render KPI cards from App.mdx', async () => {
    const html = await fetchAppPage()

    // App.mdx defines three KPICards with these titles
    expect(html).toContain('Active Agents')
    expect(html).toContain('Workflows Running')
    expect(html).toContain('Events Today')
  })

  it('should render AgentStatus component from App.mdx', async () => {
    const html = await fetchAppPage()

    // App.mdx has AgentStatus with description about AI agents
    expect(html).toContain('Monitor your AI agents in real-time')
  })

  it('should render CommandPalette with agent commands from App.mdx', async () => {
    const html = await fetchAppPage()

    // App.mdx has CommandPalette with agent-specific commands
    expect(html).toContain('Ask Priya for product direction')
    expect(html).toContain('Have Ralph start building')
    expect(html).toContain('Request code review from Tom')
  })

  it('should render sidebar navigation from App.mdx', async () => {
    const html = await fetchAppPage()

    // App.mdx defines Sidebar with NavItems
    expect(html).toContain('Startups')
    expect(html).toContain('Agents')
    expect(html).toContain('Workflows')
  })
})

// ============================================================================
// MDX Components Available Tests
// ============================================================================

describe('MDX Components from @mdxui/cockpit', () => {
  it('should make DashboardLayout available in MDX', async () => {
    // This test verifies that @mdxui/cockpit components are configured
    // Currently fails because MDX rendering is not set up
    const html = await fetchAppPage()

    // If DashboardLayout is rendered, the output should have dashboard structure
    // We check for semantic markers that indicate proper component rendering
    expect(html).toMatch(/dashboard|Dashboard/i)
  })

  it('should make KPICard component available in MDX', async () => {
    const html = await fetchAppPage()

    // KPICard should render stat cards with titles and values
    // The rendered output should show the stats structure
    expect(html).toContain('Active Agents')
  })

  it('should make AgentCard component available in MDX', async () => {
    const html = await fetchAppPage()

    // App.mdx uses AgentCard for priya, ralph, tom, mark, sally, quinn
    // At least one agent name should appear in the rendered output
    expect(html).toMatch(/priya|ralph|tom|mark|sally|quinn/i)
  })
})

// ============================================================================
// Current Implementation Check (Negative Tests)
// ============================================================================

describe('Current Implementation Uses Hardcoded React', () => {
  it('current app route does NOT use App.mdx content', async () => {
    // Read the current implementation
    const routeContent = await readFile('routes/app/_app.index.tsx', 'utf-8')

    // The current implementation uses mock data, not App.mdx content
    expect(routeContent).toContain('Mock data for the dashboard')
    expect(routeContent).toContain('mockMetrics')

    // The current implementation does NOT reference App.mdx-specific content
    expect(routeContent).not.toContain('Your autonomous business control center')
    expect(routeContent).not.toContain('Ask Priya for product direction')
    expect(routeContent).not.toContain('Monitor your AI agents in real-time')
  })

  it('current app route imports from React, not MDX', async () => {
    const routeContent = await readFile('routes/app/_app.index.tsx', 'utf-8')

    // Current implementation imports React components directly
    expect(routeContent).toContain("from '@tanstack/react-router'")
    expect(routeContent).toContain("from 'react'")

    // Current implementation does NOT import MDX
    expect(routeContent).not.toContain("from 'App.mdx'")
    expect(routeContent).not.toContain('@mdx-js')
  })
})
