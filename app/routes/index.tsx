import { createFileRoute, Link } from '@tanstack/react-router'
import { LandingPage, Hero, Features, Pricing, CTA, Testimonials } from '@mdxui/beacon'
import * as React from 'react'

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
  { icon: '1', title: 'Promise Pipelining', description: 'Multiple agent calls execute in one network round trip. The server receives your entire pipeline and runs it in a single pass.' },
  { icon: '2', title: 'Magic Map', description: 'The .map() isn\'t JavaScript\'s array method. It records your callback, sends it to the server, and replays it for each result.' },
  { icon: '3', title: 'V8 Isolates', description: 'Virtual Chrome tabs with persistent state. 0ms cold starts. Runs in 300+ cities worldwide.' },
  { icon: '4', title: '38 Compat SDKs', description: 'Use APIs you know - Supabase, MongoDB, Kafka, Redis. Same code, scales to millions of agents.' },
  { icon: '5', title: 'Extended Primitives', description: 'fsx (filesystem), gitx (version control), bashx (shell) - all rebuilt for edge without VMs.' },
  { icon: '6', title: 'Human Escalation', description: 'AI does the work. Humans make decisions. Route to Slack, email, SMS with full audit trail.' },
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
    <LandingPage>
      <Navigation
        logo={<span>.do</span>}
        items={[
          { label: 'Docs', href: '/docs' },
          { label: 'GitHub', href: 'https://github.com/dot-do/dotdo' },
        ]}
        cta={{ label: 'Get Started', href: '/signup' }}
      />
      <Hero
        title="Build your 1-Person Unicorn"
        subtitle="Deploy a startup with product, engineering, marketing, and sales. Business-as-Code for autonomous businesses run by AI agents."
        cta={{ label: 'Get Started', href: '/docs' }}
        variant="code-side"
      >
        <pre>{`import { Startup } from 'dotdo'
import { priya, ralph, tom, mark, sally } from 'agents.do'

export class MyStartup extends Startup {
  async launch() {
    const spec = await priya\`define the MVP for \${this.hypothesis}\`
    const app = await ralph\`build \${spec}\`
    const reviewed = await tom\`ship \${app}\`

    await mark\`announce the launch\`
    await sally\`start selling\`
  }
}`}</pre>
      </Hero>
      <Features items={features} />
      <Pricing tiers={pricingTiers} />
      <Testimonials items={testimonials} />
      <CTA
        title="Ready to build your 1-Person Unicorn?"
        subtitle="Solo founders get a team. Small teams scale. AI does the work. Humans decide."
        primaryAction={{ label: 'Get Started', href: '/docs' }}
        secondaryAction={{ label: 'View on GitHub', href: 'https://github.com/dot-do/dotdo' }}
      />
    </LandingPage>
  )
}

export default Home
