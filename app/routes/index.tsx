/**
 * Landing Page Route (/)
 *
 * Renders the landing page with support for Site.mdx content.
 * Also handles content negotiation for API requests (JSON responses).
 *
 * ## Pattern for Static MDX Build
 *
 * This route demonstrates the static MDX build pattern:
 * 1. Server loads metadata from Site.mdx via fumadocs-mdx
 * 2. Client renders using MDX components
 * 3. Falls back to static content if MDX not available
 *
 * Consumers can customize by editing Site.mdx at root.
 */

'use client'

import { createFileRoute, Link } from '@tanstack/react-router'
import * as React from 'react'
import { buildResponse } from '../../lib/response/linked-data'

// =============================================================================
// Navigation Component
// =============================================================================

interface NavItem {
  label: string
  href: string
}

interface NavigationProps {
  logo: React.ReactNode
  items: NavItem[]
  cta?: { label: string; href: string }
}

function Navigation({ logo, items, cta }: NavigationProps) {
  return (
    <nav className="flex items-center justify-between px-6 py-4 border-b">
      <div className="flex items-center gap-8">
        <Link to="/" className="text-xl font-bold">
          {logo}
        </Link>
        <div className="hidden md:flex items-center gap-6">
          {items.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>
      {cta && (
        <a
          href={cta.href}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {cta.label}
        </a>
      )}
    </nav>
  )
}


// =============================================================================
// Route Configuration
// =============================================================================

export const Route = createFileRoute('/')({
  component: Home,
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Content negotiation: return JSON for API requests
        const accept = request.headers.get('Accept') || ''
        if (accept.includes('application/json')) {
          const url = new URL(request.url)
          const baseNs = `${url.protocol}//${url.host}`

          const rootData = {
            name: 'dotdo',
            version: '0.0.1',
            links: {
              customers: `${baseNs}/customers`,
              things: `${baseNs}/things`,
              self: baseNs,
            },
          }

          const response = buildResponse(rootData, {
            ns: baseNs,
            type: 'API',
            isRoot: true,
            parent: `${baseNs}/schema/api`,
          })

          return Response.json(response)
        }
        // Fall through to component rendering for HTML requests
        return undefined
      },
    },
  },
  head: () => ({
    meta: [
      { title: 'dotdo - Build your 1-Person Unicorn' },
      { name: 'description', content: 'Deploy a startup with product, engineering, marketing, and sales. Business-as-Code for autonomous businesses run by AI agents.' },
      // OpenGraph tags
      { property: 'og:title', content: 'dotdo - Build your 1-Person Unicorn' },
      { property: 'og:description', content: 'Deploy a startup with product, engineering, marketing, and sales. Business-as-Code for autonomous businesses run by AI agents.' },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: 'https://dotdo.dev/' },
      { property: 'og:site_name', content: 'dotdo' },
      { property: 'og:image', content: 'https://dotdo.dev/og-image.png' },
      // Twitter Card tags
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:site', content: '@dotdodev' },
      { name: 'twitter:title', content: 'dotdo - Build your 1-Person Unicorn' },
      { name: 'twitter:description', content: 'Deploy a startup with product, engineering, marketing, and sales. Business-as-Code for autonomous businesses run by AI agents.' },
      { name: 'twitter:image', content: 'https://dotdo.dev/og-image.png' },
      // Additional SEO
      { name: 'robots', content: 'index, follow' },
      { name: 'author', content: 'dotdo' },
    ],
  }),
})

// =============================================================================
// Fallback Content (used when Site.mdx is not available)
// =============================================================================

const features = [
  { title: 'Promise Pipelining', description: 'Multiple agent calls execute in one network round trip. The server receives your entire pipeline and runs it in a single pass.' },
  { title: 'Magic Map', description: 'The .map() isn\'t JavaScript\'s array method. It records your callback, sends it to the server, and replays it for each result.' },
  { title: 'V8 Isolates', description: 'Virtual Chrome tabs with persistent state. 0ms cold starts. Runs in 300+ cities worldwide.' },
  { title: '38 Compat SDKs', description: 'Use APIs you know - Supabase, MongoDB, Kafka, Redis. Same code, scales to millions of agents.' },
  { title: 'Extended Primitives', description: 'fsx (filesystem), gitx (version control), bashx (shell) - all rebuilt for edge without VMs.' },
  { title: 'Human Escalation', description: 'AI does the work. Humans make decisions. Route to Slack, email, SMS with full audit trail.' },
]

// =============================================================================
// Footer Component
// =============================================================================

function Footer() {
  return (
    <footer className="border-t px-6 py-12 mt-20">
      <div className="container mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-sm text-muted-foreground">
            <a href="https://platform.do" className="hover:text-foreground mr-4">platform.do</a>
            <a href="https://agents.do" className="hover:text-foreground mr-4">agents.do</a>
            <a href="https://workers.do" className="hover:text-foreground">workers.do</a>
          </div>
          <p className="text-sm text-muted-foreground">
            Built with dotdo
          </p>
        </div>
      </div>
    </footer>
  )
}

// =============================================================================
// Fallback Content Component (when MDX not available)
// =============================================================================

function FallbackContent() {
  return (
    <>
      {/* Hero section */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl font-bold mb-6">Build your 1-Person Unicorn</h1>
          <p className="text-xl text-muted-foreground mb-8">
            Deploy a startup with product, engineering, marketing, and sales.
            Business-as-Code for autonomous businesses run by AI agents.
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              to="/docs"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Get Started
            </Link>
            <a
              href="https://github.com/dot-do/dotdo"
              className="inline-flex items-center justify-center rounded-md border px-6 py-3 text-sm font-medium hover:bg-muted"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Features section */}
      <section className="py-16 px-6 bg-muted/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Features</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {features.map((feature, i) => (
              <div key={i} className="p-6 bg-background rounded-lg">
                <h3 className="font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

// =============================================================================
// Home Page Component
// =============================================================================

function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation
        logo={<span>.do</span>}
        items={[
          { label: 'Docs', href: '/docs' },
          { label: 'GitHub', href: 'https://github.com/dot-do/dotdo' },
        ]}
        cta={{ label: 'Get Started', href: '/login' }}
      />

      <main>
        <FallbackContent />
      </main>

      <Footer />
    </div>
  )
}

export default Home
