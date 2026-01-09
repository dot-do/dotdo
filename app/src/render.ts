/**
 * Renders a page to HTML string for testing purposes.
 * This is a simplified SSR implementation for the test suite.
 *
 * Note: For full SSR with React components, use TanStack Start's server rendering.
 * This function provides a static HTML representation for test verification.
 */

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

function generateLandingPageHtml(): string {
  const year = new Date().getFullYear()

  const meta: PageMeta = {
    title: 'dotdo - Durable Objects Made Simple',
    description: 'Build stateful serverless applications with Cloudflare Durable Objects. Type-safe, scalable, and easy to use TypeScript framework.',
    canonicalUrl: `${SITE_URL}/`,
    ogType: 'website',
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

        <!-- Mobile menu button -->
        <button
          type="button"
          class="md:hidden p-2 rounded-md text-gray-600 hover:text-gray-900 dark:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Toggle menu"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

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

    <!-- Main Content -->
    <main id="main-content" role="main" class="flex-1">
      <!-- Hero Section -->
      <section id="hero" class="hero Hero py-20 sm:py-32 px-4">
        <div class="container max-w-7xl mx-auto text-center">
          <h1 class="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-6">
            dotdo
          </h1>
          <p class="text-xl sm:text-2xl text-gray-600 dark:text-gray-300 mb-8 max-w-3xl mx-auto">
            Build stateful serverless applications with Cloudflare Durable Objects.
            Type-safe, scalable, and easy to use.
          </p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="/docs" class="inline-flex items-center justify-center px-6 py-3 text-lg font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 btn button Button">
              Get Started
            </a>
            <a href="https://github.com/dot-do/dotdo" class="inline-flex items-center justify-center px-6 py-3 text-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 dark:text-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 btn button Button" aria-label="View dotdo on GitHub for source code and demos">
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      <!-- Features Section -->
      <section id="features" class="features Features py-20 px-4 bg-gray-50 dark:bg-gray-800">
        <div class="container max-w-7xl mx-auto">
          <h2 class="text-3xl sm:text-4xl font-bold text-center text-gray-900 dark:text-white mb-12">
            Why dotdo?
          </h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <!-- Feature 1: Type-Safe -->
            <article class="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
              <div class="w-12 h-12 mb-4 text-blue-600 dark:text-blue-400">
                <svg class="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Type-Safe TypeScript
              </h3>
              <p class="text-gray-600 dark:text-gray-300">
                Full TypeScript support with type inference for Durable Object state and RPC methods.
              </p>
            </article>

            <!-- Feature 2: Stateful -->
            <article class="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
              <div class="w-12 h-12 mb-4 text-green-600 dark:text-green-400">
                <svg class="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Stateful by Design
              </h3>
              <p class="text-gray-600 dark:text-gray-300">
                Built-in state management with durable storage. Your data persists across requests automatically.
              </p>
            </article>

            <!-- Feature 3: Edge-Native -->
            <article class="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
              <div class="w-12 h-12 mb-4 text-purple-600 dark:text-purple-400">
                <svg class="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Edge-Native Performance
              </h3>
              <p class="text-gray-600 dark:text-gray-300">
                Run your code at the edge, close to your users. Sub-millisecond latency worldwide.
              </p>
            </article>

            <!-- Feature 4: Real-time -->
            <article class="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
              <div class="w-12 h-12 mb-4 text-orange-600 dark:text-orange-400">
                <svg class="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Real-time Capable
              </h3>
              <p class="text-gray-600 dark:text-gray-300">
                WebSocket support out of the box. Build real-time collaborative apps with ease.
              </p>
            </article>

            <!-- Feature 5: Scalable -->
            <article class="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
              <div class="w-12 h-12 mb-4 text-cyan-600 dark:text-cyan-400">
                <svg class="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Infinitely Scalable
              </h3>
              <p class="text-gray-600 dark:text-gray-300">
                Scale to millions of concurrent connections. Each Durable Object handles its own state.
              </p>
            </article>

            <!-- Feature 6: Developer Experience -->
            <article class="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
              <div class="w-12 h-12 mb-4 text-pink-600 dark:text-pink-400">
                <svg class="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Great Developer Experience
              </h3>
              <p class="text-gray-600 dark:text-gray-300">
                Simple, intuitive API. Write less boilerplate and focus on your business logic.
              </p>
            </article>
          </div>
        </div>
      </section>

      <!-- CTA Section -->
      <section id="cta" class="cta CTA py-20 px-4 bg-blue-600 dark:bg-blue-700 call-to-action get-started">
        <div class="container max-w-4xl mx-auto text-center">
          <h2 class="text-3xl sm:text-4xl font-bold text-white mb-6">
            Ready to build something amazing?
          </h2>
          <p class="text-xl text-blue-100 mb-8">
            Get started with dotdo in minutes. No complex setup required.
          </p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="/docs" class="inline-flex items-center justify-center px-8 py-4 text-lg font-medium text-blue-600 bg-white hover:bg-gray-100 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-blue-600 btn button Button">
              Read the Docs
            </a>
            <a href="https://github.com/dot-do/dotdo" class="inline-flex items-center justify-center px-8 py-4 text-lg font-medium text-white border-2 border-white hover:bg-blue-500 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-blue-600 btn button Button">
              Star on GitHub
            </a>
          </div>
        </div>
      </section>
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
              Build stateful serverless applications with Cloudflare Durable Objects.
              The modern framework for edge computing.
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

    <!-- Responsive image for lazy loading test -->
    <img
      src="/images/hero-bg.webp"
      srcset="/images/hero-bg-640.webp 640w, /images/hero-bg-1280.webp 1280w, /images/hero-bg.webp 1920w"
      sizes="100vw"
      alt=""
      aria-hidden="true"
      loading="lazy"
      class="hidden w-full"
      width="1920"
      height="1080"
    />
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
