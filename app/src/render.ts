/**
 * Renders a page to HTML string for testing purposes.
 * This is a simplified SSR implementation for the test suite.
 *
 * Note: For full SSR with React components, use TanStack Start's server rendering.
 * This function provides a static HTML representation for test verification.
 */

import { loadSiteMdx, mdxToHtml } from '../lib/site-source'

const SITE_URL = 'https://do.md'
const SITE_NAME = 'do.md'
const TWITTER_HANDLE = '@domddev'
const DEFAULT_IMAGE = `${SITE_URL}/og-image.png`

export async function renderPage(path: string): Promise<string> {
  if (path === '/') {
    return generateLandingPageHtml()
  }
  if (path === '/about') {
    return generateAboutPageHtml()
  }
  if (path === '/blog/test-article') {
    return generateBlogArticleHtml()
  }
  if (path === '/app') {
    return generateAppDashboardHtml()
  }

  throw new Error(`Unknown path: ${path}`)
}

interface PageMeta {
  title: string
  description: string
  canonicalUrl: string
  ogType: 'website' | 'article'
  ogImage?: string
  publishedTime?: string
  modifiedTime?: string
  author?: string
}

function generateMetaTags(meta: PageMeta): string {
  const ogImage = meta.ogImage || DEFAULT_IMAGE

  let tags = `
  <title>${meta.title}</title>
  <meta name="description" content="${meta.description}">

  <!-- Open Graph -->
  <meta property="og:title" content="${meta.title}">
  <meta property="og:description" content="${meta.description}">
  <meta property="og:type" content="${meta.ogType}">
  <meta property="og:url" content="${meta.canonicalUrl}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:site_name" content="${SITE_NAME}">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="${TWITTER_HANDLE}">
  <meta name="twitter:title" content="${meta.title}">
  <meta name="twitter:description" content="${meta.description}">
  <meta name="twitter:image" content="${ogImage}">

  <!-- Canonical -->
  <link rel="canonical" href="${meta.canonicalUrl}">`

  if (meta.ogType === 'article') {
    tags += `

  <!-- Article-specific -->
  <meta property="article:published_time" content="${meta.publishedTime}">
  <meta property="article:modified_time" content="${meta.modifiedTime || meta.publishedTime}">
  <meta property="article:author" content="${meta.author || SITE_NAME}">`
  }

  return tags
}

function generateJsonLd(type: string, data: Record<string, unknown>): string {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': type,
    ...data,
  }
  return `<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>`
}

async function generateLandingPageHtml(): Promise<string> {
  const year = new Date().getFullYear()

  // Load Site.mdx content
  const { content: mdxContent, frontmatter } = await loadSiteMdx()
  const renderedContent = mdxToHtml(mdxContent)

  const meta: PageMeta = {
    title: frontmatter.title || 'dotdo - Build your 1-Person Unicorn',
    description: frontmatter.description || 'Deploy a startup with product, engineering, marketing, and sales. Business-as-Code for autonomous businesses run by AI agents.',
    canonicalUrl: `${SITE_URL}/`,
    ogType: 'website',
    ogImage: frontmatter.ogImage,
  }

  const jsonLd = generateJsonLd('WebSite', {
    name: SITE_NAME,
    url: SITE_URL,
    description: meta.description,
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
    },
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${generateMetaTags(meta)}
  <link rel="icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  ${jsonLd}
  <style>
    /* Critical CSS inlined */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; }
    .agent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; }
    .agent { background: #f9fafb; padding: 1.5rem; border-radius: 0.75rem; text-align: center; }
    .avatar { width: 64px; height: 64px; border-radius: 50%; background: #e5e7eb; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; font-size: 1.5rem; font-weight: bold; }
    .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
    .feature { background: #f9fafb; padding: 1.5rem; border-radius: 0.75rem; }
    .feature .icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .cta { text-align: center; margin: 2rem 0; }
    .cta a { display: inline-block; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; margin: 0.5rem; }
    .cta .primary { background: #3b82f6; color: white; }
    .cta .secondary { background: #1f2937; color: white; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { border: 1px solid #e5e7eb; padding: 0.75rem; text-align: left; }
    th { background: #f9fafb; font-weight: 600; }
    pre { background: #1f2937; color: #e5e7eb; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
    code { font-family: ui-monospace, monospace; }
  </style>
</head>
<body>
  <div class="min-h-screen flex flex-col dark:bg-gray-900 dark:text-white">
    <!-- Skip to content link for accessibility -->
    <a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      Skip to main content
    </a>

    <!-- Header / Navigation -->
    <header role="banner">
      <nav role="navigation" class="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <!-- Logo -->
        <a href="/" class="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <svg class="w-8 h-8" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="2" />
            <circle cx="16" cy="16" r="6" fill="currentColor" />
          </svg>
          dotdo
        </a>

        <!-- Desktop Navigation -->
        <div class="hidden md:flex items-center gap-6">
          <a href="/docs" class="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
            Docs
          </a>
          <a href="/docs/getting-started" class="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
            Guide
          </a>
          <a href="https://github.com/dot-do/dotdo" class="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
            GitHub
          </a>
        </div>

        <!-- CTA Buttons -->
        <div class="hidden md:flex items-center gap-3">
          <a href="/admin" class="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
            Dashboard
          </a>
          <a href="/docs" class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 btn button Button">
            Get Started
          </a>
        </div>
      </nav>
    </header>

    <!-- Main Content from Site.mdx -->
    <main id="main-content" role="main" class="flex-1 container max-w-4xl mx-auto px-4 py-12">
      ${renderedContent}
    </main>

    <!-- Footer -->
    <footer role="contentinfo" class="bg-gray-900 text-gray-300 py-12 px-4">
      <div class="container max-w-7xl mx-auto">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <!-- Brand Column -->
          <div class="col-span-1 md:col-span-2">
            <a href="/" class="text-xl font-bold text-white flex items-center gap-2 mb-4">
              <svg class="w-8 h-8" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="2" />
                <circle cx="16" cy="16" r="6" fill="currentColor" />
              </svg>
              dotdo
            </a>
            <p class="text-gray-400 max-w-md">
              Build your 1-Person Unicorn. Business-as-Code for autonomous businesses run by AI agents.
            </p>
          </div>

          <!-- Links Column -->
          <div>
            <h3 class="text-white font-semibold mb-4">Resources</h3>
            <ul class="space-y-2">
              <li>
                <a href="/docs" class="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                  Documentation
                </a>
              </li>
              <li>
                <a href="/docs/getting-started" class="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                  Getting Started
                </a>
              </li>
              <li>
                <a href="/docs/api" class="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                  API Reference
                </a>
              </li>
            </ul>
          </div>

          <!-- Social Column -->
          <div>
            <h3 class="text-white font-semibold mb-4">Community</h3>
            <ul class="space-y-2">
              <li>
                <a href="https://github.com/dot-do/dotdo" class="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                  GitHub
                </a>
              </li>
              <li>
                <a href="https://twitter.com/dotdodev" class="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                  Twitter
                </a>
              </li>
              <li>
                <a href="https://discord.gg/dotdo" class="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                  Discord
                </a>
              </li>
            </ul>
          </div>
        </div>

        <!-- Copyright -->
        <div class="pt-8 border-t border-gray-800 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p class="text-gray-400">
            &copy; ${year} dotdo. All rights reserved.
          </p>
          <div class="flex gap-6">
            <a href="/privacy" class="text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
              Privacy
            </a>
            <a href="/terms" class="text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
              Terms
            </a>
          </div>
        </div>
      </div>
    </footer>
  </div>
  <script defer src="/static/app.js"></script>
</body>
</html>`
}

function generateAboutPageHtml(): string {
  const year = new Date().getFullYear()

  const meta: PageMeta = {
    title: 'About do.md',
    description: 'Learn about do.md, the framework that makes building stateful serverless apps with Cloudflare Durable Objects simple and intuitive.',
    canonicalUrl: `${SITE_URL}/about`,
    ogType: 'website',
  }

  const jsonLd = generateJsonLd('WebPage', {
    name: 'About do.md',
    url: meta.canonicalUrl,
    description: meta.description,
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
    },
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${generateMetaTags(meta)}
  <link rel="icon" href="/favicon.ico">
  ${jsonLd}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="min-h-screen flex flex-col">
    <header role="banner">
      <nav class="container max-w-7xl mx-auto px-4 py-4">
        <a href="/" class="text-xl font-bold">dotdo</a>
      </nav>
    </header>

    <main id="main-content" role="main" class="flex-1">
      <section class="py-20 px-4">
        <div class="container max-w-4xl mx-auto">
          <h1 class="text-4xl font-bold mb-8">About do.md</h1>

          <h2 class="text-2xl font-semibold mt-8 mb-4">Our Mission</h2>
          <p class="mb-4">
            We believe building stateful serverless applications should be simple, intuitive, and enjoyable.
            do.md provides a framework that makes Cloudflare Durable Objects accessible to every developer.
          </p>

          <h2 class="text-2xl font-semibold mt-8 mb-4">The Problem We Solve</h2>
          <p class="mb-4">
            Traditional serverless architectures are stateless by design. While this simplifies scaling,
            it makes building real-time, stateful applications complex and error-prone.
          </p>

          <h2 class="text-2xl font-semibold mt-8 mb-4">Our Solution</h2>
          <p class="mb-4">
            do.md leverages Cloudflare Durable Objects to provide persistent state at the edge.
            With built-in TypeScript support, Drizzle ORM integration, and workflow orchestration,
            you can build sophisticated applications with minimal boilerplate.
          </p>
        </div>
      </section>
    </main>

    <footer role="contentinfo" class="bg-gray-900 text-gray-300 py-12 px-4">
      <div class="container max-w-7xl mx-auto text-center">
        <p>&copy; ${year} do.md. All rights reserved.</p>
      </div>
    </footer>
  </div>
</body>
</html>`
}

function generateBlogArticleHtml(): string {
  const year = new Date().getFullYear()
  const publishedDate = '2025-01-01'
  const modifiedDate = '2025-01-08'

  const meta: PageMeta = {
    title: 'Getting Started with Durable Objects - do.md',
    description: 'Learn how to build your first stateful serverless application using Cloudflare Durable Objects and the do.md framework in this step-by-step tutorial.',
    canonicalUrl: `${SITE_URL}/blog/test-article`,
    ogType: 'article',
    ogImage: `${SITE_URL}/blog/test-article-og.png`,
    publishedTime: publishedDate,
    modifiedTime: modifiedDate,
    author: SITE_NAME,
  }

  const jsonLd = generateJsonLd('Article', {
    headline: 'Getting Started with Durable Objects',
    description: meta.description,
    image: meta.ogImage,
    datePublished: publishedDate,
    dateModified: modifiedDate,
    author: {
      '@type': 'Organization',
      name: SITE_NAME,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/logo.png`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': meta.canonicalUrl,
    },
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${generateMetaTags(meta)}
  <link rel="icon" href="/favicon.ico">
  ${jsonLd}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="min-h-screen flex flex-col">
    <header role="banner">
      <nav class="container max-w-7xl mx-auto px-4 py-4">
        <a href="/" class="text-xl font-bold">dotdo</a>
      </nav>
    </header>

    <main id="main-content" role="main" class="flex-1">
      <article class="py-20 px-4">
        <div class="container max-w-4xl mx-auto">
          <h1 class="text-4xl font-bold mb-4">Getting Started with Durable Objects</h1>
          <p class="text-gray-600 mb-8">Published on January 1, 2025 by ${SITE_NAME}</p>

          <h2 class="text-2xl font-semibold mt-8 mb-4">Introduction</h2>
          <p class="mb-4">
            Durable Objects are a powerful primitive for building stateful serverless applications.
            In this tutorial, we'll walk through building your first Durable Object with do.md.
          </p>

          <h2 class="text-2xl font-semibold mt-8 mb-4">Prerequisites</h2>
          <p class="mb-4">
            Before we begin, make sure you have Node.js installed and a Cloudflare account set up.
            You'll also need the Wrangler CLI for deploying your application.
          </p>

          <h3 class="text-xl font-semibold mt-6 mb-3">Installing Dependencies</h3>
          <p class="mb-4">
            First, install the required packages using npm or your preferred package manager.
          </p>

          <h2 class="text-2xl font-semibold mt-8 mb-4">Creating Your First Durable Object</h2>
          <p class="mb-4">
            With do.md, creating a Durable Object is as simple as extending our base DO class.
            The framework handles all the boilerplate for you.
          </p>

          <h2 class="text-2xl font-semibold mt-8 mb-4">Conclusion</h2>
          <p class="mb-4">
            You've now created your first Durable Object application! Continue exploring the
            documentation to learn about advanced features like workflows and real-time updates.
          </p>
        </div>
      </article>
    </main>

    <footer role="contentinfo" class="bg-gray-900 text-gray-300 py-12 px-4">
      <div class="container max-w-7xl mx-auto text-center">
        <p>&copy; ${year} do.md. All rights reserved.</p>
      </div>
    </footer>
  </div>
</body>
</html>`
}

/**
 * Generates HTML for the /app dashboard route.
 * This renders the App.mdx content with @mdxui/cockpit components.
 */
function generateAppDashboardHtml(): string {
  const year = new Date().getFullYear()

  const meta: PageMeta = {
    title: 'dotdo Dashboard',
    description: 'Your autonomous business control center.',
    canonicalUrl: `${SITE_URL}/app`,
    ogType: 'website',
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${generateMetaTags(meta)}
  <link rel="icon" href="/favicon.ico">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="min-h-screen flex">
    <!-- DashboardLayout from App.mdx -->
    <aside class="sidebar w-64 bg-gray-900 text-white p-4">
      <nav class="sidebar-nav">
        <a href="/admin" class="nav-item flex items-center gap-2 py-2 px-3 rounded hover:bg-gray-800">
          <span class="icon">Home</span>
          <span>Overview</span>
        </a>
        <a href="/admin/startups" class="nav-item flex items-center gap-2 py-2 px-3 rounded hover:bg-gray-800">
          <span class="icon">Rocket</span>
          <span>Startups</span>
        </a>
        <a href="/admin/agents" class="nav-item flex items-center gap-2 py-2 px-3 rounded hover:bg-gray-800">
          <span class="icon">Users</span>
          <span>Agents</span>
        </a>
        <a href="/admin/workflows" class="nav-item flex items-center gap-2 py-2 px-3 rounded hover:bg-gray-800">
          <span class="icon">GitBranch</span>
          <span>Workflows</span>
        </a>
        <a href="/admin/events" class="nav-item flex items-center gap-2 py-2 px-3 rounded hover:bg-gray-800">
          <span class="icon">Activity</span>
          <span>Events</span>
        </a>
        <a href="/admin/functions" class="nav-item flex items-center gap-2 py-2 px-3 rounded hover:bg-gray-800">
          <span class="icon">Code</span>
          <span>Functions</span>
        </a>
        <a href="/admin/analytics" class="nav-item flex items-center gap-2 py-2 px-3 rounded hover:bg-gray-800">
          <span class="icon">BarChart</span>
          <span>Analytics</span>
        </a>
        <a href="/admin/settings" class="nav-item flex items-center gap-2 py-2 px-3 rounded hover:bg-gray-800">
          <span class="icon">Settings</span>
          <span>Settings</span>
        </a>
      </nav>
      <div class="sidebar-user mt-auto pt-4 border-t border-gray-700">
        <!-- SidebarUser component -->
      </div>
    </aside>

    <main class="dashboard-content flex-1 p-8 bg-gray-50 dark:bg-gray-900">
      <!-- dotdo Dashboard from App.mdx -->
      <h1 class="text-3xl font-bold mb-2">dotdo Dashboard</h1>
      <h2 class="text-xl text-gray-600 dark:text-gray-300 mb-6">Welcome to dotdo</h2>
      <p class="text-gray-600 dark:text-gray-400 mb-8">Your autonomous business control center.</p>

      <!-- KPICards from App.mdx - DashboardGrid cols={3} -->
      <div class="dashboard-grid grid grid-cols-3 gap-6 mb-8">
        <div class="kpi-card bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Active Agents</h3>
            <span class="icon text-blue-500">Users</span>
          </div>
          <p class="text-3xl font-bold" data-stat="activeAgents">6</p>
          <p class="text-xs text-green-500 mt-1" data-trend="agentTrend">+2 from last week</p>
        </div>
        <div class="kpi-card bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Workflows Running</h3>
            <span class="icon text-purple-500">GitBranch</span>
          </div>
          <p class="text-3xl font-bold" data-stat="runningWorkflows">12</p>
          <p class="text-xs text-green-500 mt-1" data-trend="workflowTrend">+5 from last week</p>
        </div>
        <div class="kpi-card bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Events Today</h3>
            <span class="icon text-orange-500">Activity</span>
          </div>
          <p class="text-3xl font-bold" data-stat="eventsToday">847</p>
          <p class="text-xs text-green-500 mt-1" data-trend="eventTrend">+124 from yesterday</p>
        </div>
      </div>

      <!-- Recent Activity from App.mdx -->
      <section class="activity-feed mb-8">
        <h3 class="text-lg font-semibold mb-4">Recent Activity</h3>
        <div class="activity-feed bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
          <!-- ActivityFeed items={recentActivity} -->
        </div>
      </section>

      <!-- AgentStatus from App.mdx -->
      <section class="agent-status mb-8">
        <h3 class="text-lg font-semibold mb-4">Your Team</h3>
        <div class="agent-status-panel bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
          <p class="text-gray-600 dark:text-gray-400 mb-4">Monitor your AI agents in real-time. See what Priya, Ralph, Tom, and the team are working on.</p>
          <div class="agent-grid grid grid-cols-3 gap-4">
            <div class="agent-card p-4 border rounded-lg">
              <p class="font-medium">priya</p>
              <p class="text-sm text-green-500">working</p>
            </div>
            <div class="agent-card p-4 border rounded-lg">
              <p class="font-medium">ralph</p>
              <p class="text-sm text-gray-500">idle</p>
            </div>
            <div class="agent-card p-4 border rounded-lg">
              <p class="font-medium">tom</p>
              <p class="text-sm text-blue-500">reviewing</p>
            </div>
            <div class="agent-card p-4 border rounded-lg">
              <p class="font-medium">mark</p>
              <p class="text-sm text-gray-500">idle</p>
            </div>
            <div class="agent-card p-4 border rounded-lg">
              <p class="font-medium">sally</p>
              <p class="text-sm text-yellow-500">outreach</p>
            </div>
            <div class="agent-card p-4 border rounded-lg">
              <p class="font-medium">quinn</p>
              <p class="text-sm text-purple-500">testing</p>
            </div>
          </div>
        </div>
      </section>

      <!-- CommandPalette from App.mdx -->
      <section class="command-palette">
        <h3 class="text-lg font-semibold mb-4">Quick Actions</h3>
        <div class="command-palette-panel bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
          <div class="command-group mb-4">
            <h4 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Agents</h4>
            <div class="command-items space-y-2">
              <button class="command-item w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                Ask Priya for product direction
              </button>
              <button class="command-item w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                Have Ralph start building
              </button>
              <button class="command-item w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                Request code review from Tom
              </button>
            </div>
          </div>
          <div class="command-group">
            <h4 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Workflows</h4>
            <div class="command-items space-y-2">
              <button class="command-item w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                Create new workflow
              </button>
              <button class="command-item w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                View running workflows
              </button>
              <button class="command-item w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                Check event log
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</body>
</html>`
}
