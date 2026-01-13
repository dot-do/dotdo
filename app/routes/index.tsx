'use client'

import { createFileRoute, Link } from '@tanstack/react-router'
import * as React from 'react'

// Temporarily remove beacon components to test prerender
// import { Hero, Features, Pricing, CTA, Testimonials } from '@mdxui/beacon'

// Local Navigation component since @mdxui/beacon doesn't export it
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

export const Route = createFileRoute('/')({
  component: Home,
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

const features = [
  { title: 'Promise Pipelining', description: 'Multiple agent calls execute in one network round trip. The server receives your entire pipeline and runs it in a single pass.' },
  { title: 'Magic Map', description: 'The .map() isn\'t JavaScript\'s array method. It records your callback, sends it to the server, and replays it for each result.' },
  { title: 'V8 Isolates', description: 'Virtual Chrome tabs with persistent state. 0ms cold starts. Runs in 300+ cities worldwide.' },
  { title: '38 Compat SDKs', description: 'Use APIs you know - Supabase, MongoDB, Kafka, Redis. Same code, scales to millions of agents.' },
  { title: 'Extended Primitives', description: 'fsx (filesystem), gitx (version control), bashx (shell) - all rebuilt for edge without VMs.' },
  { title: 'Human Escalation', description: 'AI does the work. Humans make decisions. Route to Slack, email, SMS with full audit trail.' },
]

const pricingTiers = [
  {
    name: 'Free',
    price: '$0',
    description: 'For getting started',
    features: ['10 agents', 'Basic support', '1GB storage', '$0 egress'],
    cta: { label: 'Start Free', href: '/signup' },
  },
  {
    name: 'Pro',
    price: '$49/mo',
    description: 'For growing teams',
    features: ['Unlimited agents', 'Priority support', '100GB storage', 'Custom integrations'],
    cta: { label: 'Upgrade to Pro', href: '/upgrade' },
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'For large organizations',
    features: ['Unlimited everything', '24/7 support', 'SLA guarantee', 'On-premise option'],
    cta: { label: 'Contact Sales', href: '/contact' },
  },
]

const testimonials = [
  {
    quote: 'dotdo completely transformed how we build products.',
    author: 'Sarah Chen',
    role: 'CTO',
    company: 'TechStartup Inc.',
  },
  {
    quote: 'The AI agents are incredibly effective. We shipped in half the time.',
    author: 'Mike Johnson',
    role: 'Founder',
    company: 'SoloFounder Labs',
  },
  {
    quote: 'Best developer experience I have ever had.',
    author: 'Alex Rivera',
    role: 'Lead Engineer',
    company: 'DevShop Co.',
  },
]

function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation
        logo={<span>.do</span>}
        items={[
          { label: 'Docs', href: '/docs' },
          { label: 'GitHub', href: 'https://github.com/dot-do/dotdo' },
        ]}
        cta={{ label: 'Get Started', href: '/signup' }}
      />

      {/* Simplified hero for SSR-safe prerender testing */}
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

      {/* Simplified features */}
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
    </div>
  )
}

export default Home
