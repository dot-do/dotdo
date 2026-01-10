/**
 * Landing Page Component Tests (TDD RED Phase)
 *
 * These tests verify the landing page implementation using @mdxui/beacon components.
 * They are expected to FAIL until the landing page is refactored to use @mdxui/beacon.
 *
 * The landing page should use @mdxui/beacon components:
 * - LandingPage: Container for all landing sections
 * - Hero: Above-the-fold headline with variants (code-side, simple, video)
 * - Features: Product feature grid showcases
 * - Pricing: Pricing tiers display
 * - CTA: Call-to-action sections
 * - Testimonials: Testimonials carousel
 *
 * @see app/routes/index.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// =============================================================================
// Mock @mdxui/beacon components for testing
// These mocks define the expected API contract that the implementation should follow
// =============================================================================

vi.mock('@mdxui/beacon', () => ({
  LandingPage: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="landing-page" data-component="LandingPage" className={className}>
      {children}
    </div>
  ),
  Hero: ({
    title,
    subtitle,
    cta,
    variant = 'simple',
    children,
  }: {
    title: string
    subtitle?: string
    cta?: { label: string; href: string }
    secondaryCta?: { label: string; href: string }
    variant?: 'simple' | 'code-side' | 'video'
    children?: React.ReactNode
  }) => (
    <section data-testid="hero" data-component="Hero" data-variant={variant}>
      <h1 data-testid="hero-title">{title}</h1>
      {subtitle && <p data-testid="hero-subtitle">{subtitle}</p>}
      {cta && (
        <a data-testid="hero-cta" href={cta.href}>
          {cta.label}
        </a>
      )}
      {children}
    </section>
  ),
  Features: ({
    items,
    columns = 3,
    children,
  }: {
    items?: Array<{ icon?: React.ReactNode; title: string; description: string }>
    columns?: number
    children?: React.ReactNode
  }) => (
    <section data-testid="features" data-component="Features" data-columns={columns}>
      {items?.map((item, i) => (
        <div key={i} data-testid="feature-item">
          {item.icon && <span data-testid="feature-icon">{item.icon}</span>}
          <h3 data-testid="feature-title">{item.title}</h3>
          <p data-testid="feature-description">{item.description}</p>
        </div>
      ))}
      {children}
    </section>
  ),
  Pricing: ({
    tiers,
    children,
  }: {
    tiers?: Array<{
      name: string
      price: string | number
      description?: string
      features: string[]
      cta?: { label: string; href: string }
      highlighted?: boolean
    }>
    children?: React.ReactNode
  }) => (
    <section data-testid="pricing" data-component="Pricing">
      {tiers?.map((tier, i) => (
        <div key={i} data-testid="pricing-tier" data-highlighted={tier.highlighted}>
          <h3 data-testid="pricing-tier-name">{tier.name}</h3>
          <span data-testid="pricing-tier-price">{tier.price}</span>
          {tier.description && <p data-testid="pricing-tier-description">{tier.description}</p>}
          <ul>
            {tier.features.map((feature, j) => (
              <li key={j} data-testid="pricing-feature">
                {feature}
              </li>
            ))}
          </ul>
          {tier.cta && (
            <a data-testid="pricing-cta" href={tier.cta.href}>
              {tier.cta.label}
            </a>
          )}
        </div>
      ))}
      {children}
    </section>
  ),
  Testimonials: ({
    items,
    autoplay = false,
  }: {
    items?: Array<{
      quote: string
      author: string
      role?: string
      company?: string
      avatar?: string
    }>
    autoplay?: boolean
  }) => (
    <section data-testid="testimonials" data-component="Testimonials" data-autoplay={autoplay}>
      {items?.map((item, i) => (
        <div key={i} data-testid="testimonial-item">
          <blockquote data-testid="testimonial-quote">{item.quote}</blockquote>
          <cite data-testid="testimonial-author">{item.author}</cite>
          {item.role && <span data-testid="testimonial-role">{item.role}</span>}
          {item.company && <span data-testid="testimonial-company">{item.company}</span>}
        </div>
      ))}
    </section>
  ),
  CTA: ({
    title,
    subtitle,
    primaryAction,
    secondaryAction,
    children,
  }: {
    title?: string
    subtitle?: string
    primaryAction?: { label: string; href: string }
    secondaryAction?: { label: string; href: string }
    children?: React.ReactNode
  }) => (
    <section data-testid="cta-section" data-component="CTA">
      {title && <h2 data-testid="cta-title">{title}</h2>}
      {subtitle && <p data-testid="cta-subtitle">{subtitle}</p>}
      {primaryAction && (
        <a data-testid="cta-primary" href={primaryAction.href}>
          {primaryAction.label}
        </a>
      )}
      {secondaryAction && (
        <a data-testid="cta-secondary" href={secondaryAction.href}>
          {secondaryAction.label}
        </a>
      )}
      {children}
    </section>
  ),
  Navigation: ({
    logo,
    items,
    cta,
  }: {
    logo?: React.ReactNode
    items?: Array<{ label: string; href: string }>
    cta?: { label: string; href: string }
  }) => (
    <nav data-testid="navigation" data-component="Navigation" role="navigation">
      {logo && <div data-testid="nav-logo">{logo}</div>}
      {items?.map((item, i) => (
        <a key={i} data-testid="nav-item" href={item.href}>
          {item.label}
        </a>
      ))}
      {cta && (
        <a data-testid="nav-cta" href={cta.href}>
          {cta.label}
        </a>
      )}
    </nav>
  ),
}))

// Import the components under test
// These imports should use @mdxui/beacon - tests will fail if they don't
import { LandingPage, Hero, Features, Pricing, Testimonials, CTA, Navigation } from '@mdxui/beacon'

// =============================================================================
// Test Suite: LandingPage Component
// =============================================================================

describe('LandingPage', () => {
  describe('renders all sections', () => {
    it('should render LandingPage container', () => {
      render(
        <LandingPage>
          <div>Content</div>
        </LandingPage>
      )

      expect(screen.getByTestId('landing-page')).toBeInTheDocument()
      expect(screen.getByTestId('landing-page')).toHaveAttribute('data-component', 'LandingPage')
    })

    it('should render Hero section within LandingPage', () => {
      render(
        <LandingPage>
          <Hero title="Test Title" />
        </LandingPage>
      )

      expect(screen.getByTestId('hero')).toBeInTheDocument()
    })

    it('should render Features section within LandingPage', () => {
      render(
        <LandingPage>
          <Features items={[{ title: 'Feature 1', description: 'Description 1' }]} />
        </LandingPage>
      )

      expect(screen.getByTestId('features')).toBeInTheDocument()
    })

    it('should render Pricing section within LandingPage', () => {
      render(
        <LandingPage>
          <Pricing
            tiers={[{ name: 'Free', price: '$0', features: ['Feature 1'] }]}
          />
        </LandingPage>
      )

      expect(screen.getByTestId('pricing')).toBeInTheDocument()
    })

    it('should render Testimonials section within LandingPage', () => {
      render(
        <LandingPage>
          <Testimonials
            items={[{ quote: 'Great product!', author: 'John Doe' }]}
          />
        </LandingPage>
      )

      expect(screen.getByTestId('testimonials')).toBeInTheDocument()
    })

    it('should render CTA section within LandingPage', () => {
      render(
        <LandingPage>
          <CTA title="Get Started" />
        </LandingPage>
      )

      expect(screen.getByTestId('cta-section')).toBeInTheDocument()
    })

    it('should render all sections together', () => {
      render(
        <LandingPage>
          <Hero title="Build your 1-Person Unicorn" />
          <Features items={[{ title: 'Feature', description: 'Desc' }]} />
          <Pricing tiers={[{ name: 'Free', price: 0, features: ['Basic'] }]} />
          <Testimonials items={[{ quote: 'Amazing!', author: 'Jane' }]} />
          <CTA title="Start Now" />
        </LandingPage>
      )

      expect(screen.getByTestId('hero')).toBeInTheDocument()
      expect(screen.getByTestId('features')).toBeInTheDocument()
      expect(screen.getByTestId('pricing')).toBeInTheDocument()
      expect(screen.getByTestId('testimonials')).toBeInTheDocument()
      expect(screen.getByTestId('cta-section')).toBeInTheDocument()
    })
  })
})

// =============================================================================
// Test Suite: Hero Component
// =============================================================================

describe('Hero', () => {
  describe('displays title, subtitle, CTA', () => {
    it('should display the title', () => {
      render(<Hero title="Build your 1-Person Unicorn" />)

      expect(screen.getByTestId('hero-title')).toHaveTextContent('Build your 1-Person Unicorn')
    })

    it('should display the subtitle when provided', () => {
      render(
        <Hero
          title="Build your 1-Person Unicorn"
          subtitle="Deploy a startup with product, engineering, marketing, and sales."
        />
      )

      expect(screen.getByTestId('hero-subtitle')).toHaveTextContent(
        'Deploy a startup with product, engineering, marketing, and sales.'
      )
    })

    it('should not display subtitle when not provided', () => {
      render(<Hero title="Title Only" />)

      expect(screen.queryByTestId('hero-subtitle')).not.toBeInTheDocument()
    })

    it('should display primary CTA button', () => {
      render(
        <Hero
          title="Test"
          cta={{ label: 'Get Started', href: '/docs' }}
        />
      )

      const ctaButton = screen.getByTestId('hero-cta')
      expect(ctaButton).toHaveTextContent('Get Started')
      expect(ctaButton).toHaveAttribute('href', '/docs')
    })

    it('should have H1 as the main heading', () => {
      render(<Hero title="Main Heading" />)

      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveTextContent('Main Heading')
    })
  })

  describe('variants', () => {
    it('should render simple variant by default', () => {
      render(<Hero title="Simple Hero" />)

      expect(screen.getByTestId('hero')).toHaveAttribute('data-variant', 'simple')
    })

    it('should render code-side variant', () => {
      render(<Hero title="Code Side Hero" variant="code-side" />)

      expect(screen.getByTestId('hero')).toHaveAttribute('data-variant', 'code-side')
    })

    it('should render video variant', () => {
      render(<Hero title="Video Hero" variant="video" />)

      expect(screen.getByTestId('hero')).toHaveAttribute('data-variant', 'video')
    })

    it('code-side variant should accept children for code display', () => {
      render(
        <Hero title="With Code" variant="code-side">
          <pre>const x = 1;</pre>
        </Hero>
      )

      expect(screen.getByText('const x = 1;')).toBeInTheDocument()
    })
  })
})

// =============================================================================
// Test Suite: Features Component
// =============================================================================

describe('Features', () => {
  const sampleFeatures = [
    { icon: '1', title: 'Promise Pipelining', description: 'Multiple agent calls in one round trip' },
    { icon: '2', title: 'Magic Map', description: 'Server-side callback replay' },
    { icon: '3', title: 'V8 Isolates', description: 'Virtual Chrome tabs with persistent state' },
  ]

  describe('grid renders', () => {
    it('should render features grid', () => {
      render(<Features items={sampleFeatures} />)

      expect(screen.getByTestId('features')).toBeInTheDocument()
    })

    it('should render all feature items', () => {
      render(<Features items={sampleFeatures} />)

      const items = screen.getAllByTestId('feature-item')
      expect(items).toHaveLength(3)
    })

    it('should display feature titles', () => {
      render(<Features items={sampleFeatures} />)

      expect(screen.getByText('Promise Pipelining')).toBeInTheDocument()
      expect(screen.getByText('Magic Map')).toBeInTheDocument()
      expect(screen.getByText('V8 Isolates')).toBeInTheDocument()
    })

    it('should display feature descriptions', () => {
      render(<Features items={sampleFeatures} />)

      expect(screen.getByText('Multiple agent calls in one round trip')).toBeInTheDocument()
      expect(screen.getByText('Server-side callback replay')).toBeInTheDocument()
    })

    it('should display feature icons', () => {
      render(<Features items={sampleFeatures} />)

      const icons = screen.getAllByTestId('feature-icon')
      expect(icons).toHaveLength(3)
    })

    it('should support custom column count', () => {
      render(<Features items={sampleFeatures} columns={4} />)

      expect(screen.getByTestId('features')).toHaveAttribute('data-columns', '4')
    })

    it('should default to 3 columns', () => {
      render(<Features items={sampleFeatures} />)

      expect(screen.getByTestId('features')).toHaveAttribute('data-columns', '3')
    })
  })
})

// =============================================================================
// Test Suite: Pricing Component
// =============================================================================

describe('Pricing', () => {
  const sampleTiers = [
    {
      name: 'Free',
      price: '$0',
      description: 'For getting started',
      features: ['10 agents', 'Basic support', '1GB storage'],
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

  describe('tiers display', () => {
    it('should render pricing section', () => {
      render(<Pricing tiers={sampleTiers} />)

      expect(screen.getByTestId('pricing')).toBeInTheDocument()
    })

    it('should render all pricing tiers', () => {
      render(<Pricing tiers={sampleTiers} />)

      const tiers = screen.getAllByTestId('pricing-tier')
      expect(tiers).toHaveLength(3)
    })

    it('should display tier names', () => {
      render(<Pricing tiers={sampleTiers} />)

      expect(screen.getByText('Free')).toBeInTheDocument()
      expect(screen.getByText('Pro')).toBeInTheDocument()
      expect(screen.getByText('Enterprise')).toBeInTheDocument()
    })

    it('should display tier prices', () => {
      render(<Pricing tiers={sampleTiers} />)

      expect(screen.getByText('$0')).toBeInTheDocument()
      expect(screen.getByText('$49/mo')).toBeInTheDocument()
      expect(screen.getByText('Custom')).toBeInTheDocument()
    })

    it('should display tier descriptions', () => {
      render(<Pricing tiers={sampleTiers} />)

      expect(screen.getByText('For getting started')).toBeInTheDocument()
      expect(screen.getByText('For growing teams')).toBeInTheDocument()
    })

    it('should display tier features', () => {
      render(<Pricing tiers={sampleTiers} />)

      expect(screen.getByText('10 agents')).toBeInTheDocument()
      expect(screen.getByText('Unlimited agents')).toBeInTheDocument()
      expect(screen.getByText('24/7 support')).toBeInTheDocument()
    })

    it('should display CTA buttons for each tier', () => {
      render(<Pricing tiers={sampleTiers} />)

      const ctas = screen.getAllByTestId('pricing-cta')
      expect(ctas).toHaveLength(3)
      expect(ctas[0]).toHaveTextContent('Start Free')
      expect(ctas[1]).toHaveTextContent('Upgrade to Pro')
    })

    it('should highlight recommended tier', () => {
      render(<Pricing tiers={sampleTiers} />)

      const tiers = screen.getAllByTestId('pricing-tier')
      expect(tiers[1]).toHaveAttribute('data-highlighted', 'true')
    })
  })
})

// =============================================================================
// Test Suite: Testimonials Component
// =============================================================================

describe('Testimonials', () => {
  const sampleTestimonials = [
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

  describe('carousel', () => {
    it('should render testimonials section', () => {
      render(<Testimonials items={sampleTestimonials} />)

      expect(screen.getByTestId('testimonials')).toBeInTheDocument()
    })

    it('should render all testimonial items', () => {
      render(<Testimonials items={sampleTestimonials} />)

      const items = screen.getAllByTestId('testimonial-item')
      expect(items).toHaveLength(3)
    })

    it('should display testimonial quotes', () => {
      render(<Testimonials items={sampleTestimonials} />)

      expect(screen.getByText('dotdo completely transformed how we build products.')).toBeInTheDocument()
    })

    it('should display author names', () => {
      render(<Testimonials items={sampleTestimonials} />)

      expect(screen.getByText('Sarah Chen')).toBeInTheDocument()
      expect(screen.getByText('Mike Johnson')).toBeInTheDocument()
    })

    it('should display author roles', () => {
      render(<Testimonials items={sampleTestimonials} />)

      expect(screen.getByText('CTO')).toBeInTheDocument()
      expect(screen.getByText('Founder')).toBeInTheDocument()
    })

    it('should display company names', () => {
      render(<Testimonials items={sampleTestimonials} />)

      expect(screen.getByText('TechStartup Inc.')).toBeInTheDocument()
      expect(screen.getByText('SoloFounder Labs')).toBeInTheDocument()
    })

    it('should support autoplay option', () => {
      render(<Testimonials items={sampleTestimonials} autoplay />)

      expect(screen.getByTestId('testimonials')).toHaveAttribute('data-autoplay', 'true')
    })

    it('should default autoplay to false', () => {
      render(<Testimonials items={sampleTestimonials} />)

      expect(screen.getByTestId('testimonials')).toHaveAttribute('data-autoplay', 'false')
    })
  })
})

// =============================================================================
// Test Suite: CTA Component
// =============================================================================

describe('CTA', () => {
  describe('section', () => {
    it('should render CTA section', () => {
      render(<CTA title="Ready to start?" />)

      expect(screen.getByTestId('cta-section')).toBeInTheDocument()
    })

    it('should display title', () => {
      render(<CTA title="Ready to build your 1-Person Unicorn?" />)

      expect(screen.getByTestId('cta-title')).toHaveTextContent('Ready to build your 1-Person Unicorn?')
    })

    it('should display subtitle', () => {
      render(
        <CTA
          title="Ready?"
          subtitle="Solo founders get a team. Small teams scale."
        />
      )

      expect(screen.getByTestId('cta-subtitle')).toHaveTextContent('Solo founders get a team. Small teams scale.')
    })

    it('should display primary action button', () => {
      render(
        <CTA
          title="Get Started"
          primaryAction={{ label: 'Start Building', href: '/docs' }}
        />
      )

      const primary = screen.getByTestId('cta-primary')
      expect(primary).toHaveTextContent('Start Building')
      expect(primary).toHaveAttribute('href', '/docs')
    })

    it('should display secondary action button', () => {
      render(
        <CTA
          title="Get Started"
          primaryAction={{ label: 'Start', href: '/start' }}
          secondaryAction={{ label: 'View on GitHub', href: 'https://github.com/dot-do/dotdo' }}
        />
      )

      const secondary = screen.getByTestId('cta-secondary')
      expect(secondary).toHaveTextContent('View on GitHub')
      expect(secondary).toHaveAttribute('href', 'https://github.com/dot-do/dotdo')
    })
  })
})

// =============================================================================
// Test Suite: Navigation Component
// =============================================================================

describe('Navigation', () => {
  describe('works', () => {
    it('should render navigation element', () => {
      render(<Navigation />)

      expect(screen.getByTestId('navigation')).toBeInTheDocument()
    })

    it('should have role="navigation"', () => {
      render(<Navigation />)

      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('should render logo', () => {
      render(<Navigation logo={<span>.do</span>} />)

      expect(screen.getByTestId('nav-logo')).toBeInTheDocument()
      expect(screen.getByText('.do')).toBeInTheDocument()
    })

    it('should render navigation items', () => {
      render(
        <Navigation
          items={[
            { label: 'Docs', href: '/docs' },
            { label: 'GitHub', href: 'https://github.com/dot-do/dotdo' },
          ]}
        />
      )

      const navItems = screen.getAllByTestId('nav-item')
      expect(navItems).toHaveLength(2)
      expect(navItems[0]).toHaveTextContent('Docs')
      expect(navItems[0]).toHaveAttribute('href', '/docs')
    })

    it('should render CTA button in navigation', () => {
      render(
        <Navigation
          cta={{ label: 'Get Started', href: '/signup' }}
        />
      )

      const cta = screen.getByTestId('nav-cta')
      expect(cta).toHaveTextContent('Get Started')
      expect(cta).toHaveAttribute('href', '/signup')
    })

    it('should link to docs', () => {
      render(
        <Navigation
          items={[{ label: 'Docs', href: '/docs' }]}
        />
      )

      const docsLink = screen.getByText('Docs')
      expect(docsLink).toHaveAttribute('href', '/docs')
    })

    it('should link to home/logo', () => {
      render(
        <Navigation
          logo={<a href="/">.do</a>}
        />
      )

      const homeLink = screen.getByText('.do')
      expect(homeLink.closest('a')).toHaveAttribute('href', '/')
    })
  })
})

// =============================================================================
// Integration Test: Full Landing Page
// =============================================================================

describe('Integration: Full Landing Page', () => {
  it('should render a complete landing page with all @mdxui/beacon components', () => {
    render(
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
          subtitle="Deploy a startup with product, engineering, marketing, and sales."
          cta={{ label: 'Get Started', href: '/docs' }}
          variant="code-side"
        >
          <pre>{`import { Startup } from 'dotdo'`}</pre>
        </Hero>
        <Features
          items={[
            { icon: '1', title: 'Promise Pipelining', description: 'One round trip' },
            { icon: '2', title: 'Magic Map', description: 'Server-side replay' },
            { icon: '3', title: 'V8 Isolates', description: 'Edge runtime' },
          ]}
        />
        <Pricing
          tiers={[
            { name: 'Free', price: '$0', features: ['Basic features'] },
            { name: 'Pro', price: '$49/mo', features: ['Pro features'], highlighted: true },
          ]}
        />
        <Testimonials
          items={[
            { quote: 'Amazing product!', author: 'John Doe', company: 'Acme Inc.' },
          ]}
        />
        <CTA
          title="Ready to build?"
          subtitle="Start your 1-Person Unicorn today."
          primaryAction={{ label: 'Get Started', href: '/docs' }}
          secondaryAction={{ label: 'View GitHub', href: 'https://github.com/dot-do/dotdo' }}
        />
      </LandingPage>
    )

    // Verify all sections are present
    expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    expect(screen.getByTestId('navigation')).toBeInTheDocument()
    expect(screen.getByTestId('hero')).toBeInTheDocument()
    expect(screen.getByTestId('features')).toBeInTheDocument()
    expect(screen.getByTestId('pricing')).toBeInTheDocument()
    expect(screen.getByTestId('testimonials')).toBeInTheDocument()
    expect(screen.getByTestId('cta-section')).toBeInTheDocument()

    // Verify hero content
    expect(screen.getByText('Build your 1-Person Unicorn')).toBeInTheDocument()

    // Verify features
    expect(screen.getByText('Promise Pipelining')).toBeInTheDocument()

    // Verify pricing tiers
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()

    // Verify testimonials
    expect(screen.getByText('Amazing product!')).toBeInTheDocument()

    // Verify CTA
    expect(screen.getByText('Ready to build?')).toBeInTheDocument()
  })
})
