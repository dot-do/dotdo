import { createFileRoute } from '@tanstack/react-router'
// Type imports from @mdxui/beacon for design patterns
import type { HeroProps, FeaturesProps, CTAProps } from '@mdxui/beacon'
// This landing page implements patterns from @mdxui/beacon:
// - Hero: above-the-fold headline with CTAs
// - Features: product feature showcases
// - CTA: call-to-action sections

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  const currentYear = new Date().getFullYear()

  return (
    <div className="min-h-screen flex flex-col dark:bg-gray-900 dark:text-white">
      {/* Skip to content link for accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        Skip to main content
      </a>

      {/* Header / Navigation */}
      <header role="banner">
        <nav role="navigation" className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          {/* Logo */}
          <a href="/" className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <svg className="w-8 h-8" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" />
              <circle cx="16" cy="16" r="6" fill="currentColor" />
            </svg>
            dotdo
          </a>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            <a href="/docs" className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
              Docs
            </a>
            <a href="/docs/getting-started" className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
              Guide
            </a>
            <a href="https://github.com/dot-do/dotdo" className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
              GitHub
            </a>
          </div>

          {/* Mobile menu button */}
          <button
            type="button"
            className="md:hidden p-2 rounded-md text-gray-600 hover:text-gray-900 dark:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Toggle menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* CTA Buttons */}
          <div className="hidden md:flex items-center gap-3">
            <a
              href="/admin"
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            >
              Dashboard
            </a>
            <a
              href="/docs"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 btn button Button"
            >
              Get Started
            </a>
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main id="main-content" role="main" className="flex-1">
        {/* Hero Section */}
        <section id="hero" className="hero Hero py-20 sm:py-32 px-4">
          <div className="container max-w-7xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-6">
              dotdo
            </h1>
            <p className="text-xl sm:text-2xl text-gray-600 dark:text-gray-300 mb-8 max-w-3xl mx-auto">
              Build stateful serverless applications with Cloudflare Durable Objects.
              Type-safe, scalable, and easy to use.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="/docs"
                className="inline-flex items-center justify-center px-6 py-3 text-lg font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 btn button Button"
              >
                Get Started
              </a>
              <a
                href="https://github.com/dot-do/dotdo"
                className="inline-flex items-center justify-center px-6 py-3 text-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 dark:text-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 btn button Button"
                aria-label="View dotdo on GitHub for source code and demos"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="features Features py-20 px-4 bg-gray-50 dark:bg-gray-800">
          <div className="container max-w-7xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-center text-gray-900 dark:text-white mb-12">
              Why dotdo?
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {/* Feature 1: Type-Safe */}
              <article className="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
                <div className="w-12 h-12 mb-4 text-blue-600 dark:text-blue-400">
                  <svg className="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  Type-Safe TypeScript
                </h3>
                <p className="text-gray-600 dark:text-gray-300">
                  Full TypeScript support with type inference for Durable Object state and RPC methods.
                </p>
              </article>

              {/* Feature 2: Stateful */}
              <article className="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
                <div className="w-12 h-12 mb-4 text-green-600 dark:text-green-400">
                  <svg className="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  Stateful by Design
                </h3>
                <p className="text-gray-600 dark:text-gray-300">
                  Built-in state management with durable storage. Your data persists across requests automatically.
                </p>
              </article>

              {/* Feature 3: Edge-Native */}
              <article className="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
                <div className="w-12 h-12 mb-4 text-purple-600 dark:text-purple-400">
                  <svg className="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  Edge-Native Performance
                </h3>
                <p className="text-gray-600 dark:text-gray-300">
                  Run your code at the edge, close to your users. Sub-millisecond latency worldwide.
                </p>
              </article>

              {/* Feature 4: Real-time */}
              <article className="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
                <div className="w-12 h-12 mb-4 text-orange-600 dark:text-orange-400">
                  <svg className="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  Real-time Capable
                </h3>
                <p className="text-gray-600 dark:text-gray-300">
                  WebSocket support out of the box. Build real-time collaborative apps with ease.
                </p>
              </article>

              {/* Feature 5: Scalable */}
              <article className="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
                <div className="w-12 h-12 mb-4 text-cyan-600 dark:text-cyan-400">
                  <svg className="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  Infinitely Scalable
                </h3>
                <p className="text-gray-600 dark:text-gray-300">
                  Scale to millions of concurrent connections. Each Durable Object handles its own state.
                </p>
              </article>

              {/* Feature 6: Developer Experience */}
              <article className="feature-card feature-item p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
                <div className="w-12 h-12 mb-4 text-pink-600 dark:text-pink-400">
                  <svg className="w-full h-full icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  Great Developer Experience
                </h3>
                <p className="text-gray-600 dark:text-gray-300">
                  Simple, intuitive API. Write less boilerplate and focus on your business logic.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section id="cta" className="cta CTA py-20 px-4 bg-blue-600 dark:bg-blue-700 call-to-action get-started">
          <div className="container max-w-4xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
              Ready to build something amazing?
            </h2>
            <p className="text-xl text-blue-100 mb-8">
              Get started with dotdo in minutes. No complex setup required.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="/docs"
                className="inline-flex items-center justify-center px-8 py-4 text-lg font-medium text-blue-600 bg-white hover:bg-gray-100 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-blue-600 btn button Button"
              >
                Read the Docs
              </a>
              <a
                href="https://github.com/dot-do/dotdo"
                className="inline-flex items-center justify-center px-8 py-4 text-lg font-medium text-white border-2 border-white hover:bg-blue-500 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-blue-600 btn button Button"
              >
                Star on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer role="contentinfo" className="bg-gray-900 text-gray-300 py-12 px-4">
        <div className="container max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            {/* Brand Column */}
            <div className="col-span-1 md:col-span-2">
              <a href="/" className="text-xl font-bold text-white flex items-center gap-2 mb-4">
                <svg className="w-8 h-8" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" />
                  <circle cx="16" cy="16" r="6" fill="currentColor" />
                </svg>
                dotdo
              </a>
              <p className="text-gray-400 max-w-md">
                Build stateful serverless applications with Cloudflare Durable Objects.
                The modern framework for edge computing.
              </p>
            </div>

            {/* Links Column */}
            <div>
              <h3 className="text-white font-semibold mb-4">Resources</h3>
              <ul className="space-y-2">
                <li>
                  <a href="/docs" className="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                    Documentation
                  </a>
                </li>
                <li>
                  <a href="/docs/getting-started" className="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                    Getting Started
                  </a>
                </li>
                <li>
                  <a href="/docs/api" className="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                    API Reference
                  </a>
                </li>
              </ul>
            </div>

            {/* Social Column */}
            <div>
              <h3 className="text-white font-semibold mb-4">Community</h3>
              <ul className="space-y-2">
                <li>
                  <a href="https://github.com/dot-do/dotdo" className="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                    GitHub
                  </a>
                </li>
                <li>
                  <a href="https://twitter.com/dotdodev" className="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                    Twitter
                  </a>
                </li>
                <li>
                  <a href="https://discord.gg/dotdo" className="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                    Discord
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Copyright */}
          <div className="pt-8 border-t border-gray-800 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-gray-400">
              &copy; {currentYear} dotdo. All rights reserved.
            </p>
            <div className="flex gap-6">
              <a href="/privacy" className="text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                Privacy
              </a>
              <a href="/terms" className="text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                Terms
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* Responsive image for lazy loading test */}
      <img
        src="/images/hero-bg.webp"
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="hidden w-full"
        width="1920"
        height="1080"
      />
    </div>
  )
}

export default LandingPage
