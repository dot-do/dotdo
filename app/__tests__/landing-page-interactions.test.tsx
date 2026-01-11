/**
 * Landing Page Component Interaction Tests (TDD RED Phase)
 *
 * These tests verify interactive behaviors and edge cases for the landing page.
 * They are expected to FAIL until the features are implemented.
 *
 * Focus areas:
 * - Interactive behaviors (mobile menu, scroll, animations)
 * - Edge cases and error handling
 * - Advanced accessibility (keyboard navigation, screen readers)
 * - Responsive breakpoint behaviors
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

// =============================================================================
// Test Suite: Hero Section Interactive Behaviors
// =============================================================================

describe('Hero Section Interactions', () => {
  describe('video variant', () => {
    it('should play video on hero when autoplay is enabled', async () => {
      // Import actual component - will fail until video variant is implemented
      const { Hero } = await import('@mdxui/beacon')

      render(
        <Hero
          title="Test Hero"
          variant="video"
          videoSrc="/hero-demo.mp4"
          autoplay
        />
      )

      const video = screen.getByTestId('hero-video')
      expect(video).toBeInTheDocument()
      expect(video).toHaveAttribute('autoplay')
    })

    it('should pause video when user scrolls past hero', async () => {
      const { Hero } = await import('@mdxui/beacon')

      render(
        <Hero
          title="Test Hero"
          variant="video"
          videoSrc="/hero-demo.mp4"
          pauseOnScroll
        />
      )

      const video = screen.getByTestId('hero-video') as HTMLVideoElement

      // Simulate scroll past hero
      fireEvent.scroll(window, { target: { scrollY: 1000 } })

      await waitFor(() => {
        expect(video.paused).toBe(true)
      })
    })

    it('should have video play/pause controls', async () => {
      const { Hero } = await import('@mdxui/beacon')

      render(
        <Hero
          title="Test Hero"
          variant="video"
          videoSrc="/hero-demo.mp4"
          showControls
        />
      )

      expect(screen.getByRole('button', { name: /play|pause/i })).toBeInTheDocument()
    })
  })

  describe('code-side variant animations', () => {
    it('should animate code typing effect when visible', async () => {
      const { Hero } = await import('@mdxui/beacon')

      render(
        <Hero
          title="Test Hero"
          variant="code-side"
          typewriterEffect
        >
          <pre>const x = 1;</pre>
        </Hero>
      )

      const codeBlock = screen.getByTestId('hero-code-block')
      expect(codeBlock).toHaveAttribute('data-typing', 'true')
    })

    it('should highlight syntax in code block', async () => {
      const { Hero } = await import('@mdxui/beacon')

      render(
        <Hero
          title="Test Hero"
          variant="code-side"
          highlightSyntax
          language="typescript"
        >
          <pre>const x: number = 1;</pre>
        </Hero>
      )

      // Should have syntax highlighted tokens
      expect(screen.getByTestId('hero-code-block')).toContainElement(
        screen.getByText('const', { selector: '.token-keyword' })
      )
    })
  })

  describe('scroll indicator', () => {
    it('should show scroll indicator when enabled', async () => {
      const { Hero } = await import('@mdxui/beacon')

      render(
        <Hero
          title="Test Hero"
          showScrollIndicator
        />
      )

      expect(screen.getByTestId('scroll-indicator')).toBeInTheDocument()
    })

    it('should scroll to next section when indicator clicked', async () => {
      const user = userEvent.setup()
      const { Hero, Features } = await import('@mdxui/beacon')

      render(
        <div>
          <Hero
            title="Test Hero"
            showScrollIndicator
          />
          <Features
            id="features"
            items={[{ title: 'Feature 1', description: 'Desc 1' }]}
          />
        </div>
      )

      const scrollIndicator = screen.getByTestId('scroll-indicator')
      await user.click(scrollIndicator)

      await waitFor(() => {
        const featuresSection = screen.getByTestId('features')
        expect(featuresSection).toHaveFocus()
      })
    })

    it('should hide scroll indicator after scrolling', async () => {
      const { Hero } = await import('@mdxui/beacon')

      render(
        <Hero
          title="Test Hero"
          showScrollIndicator
          hideIndicatorOnScroll
        />
      )

      fireEvent.scroll(window, { target: { scrollY: 200 } })

      await waitFor(() => {
        expect(screen.queryByTestId('scroll-indicator')).not.toBeVisible()
      })
    })
  })
})

// =============================================================================
// Test Suite: Features Section Interactions
// =============================================================================

describe('Features Section Interactions', () => {
  describe('hover effects', () => {
    it('should expand feature card on hover', async () => {
      const user = userEvent.setup()
      const { Features } = await import('@mdxui/beacon')

      render(
        <Features
          items={[
            { title: 'Feature 1', description: 'Desc 1', expandOnHover: true },
          ]}
          hoverEffect="expand"
        />
      )

      const featureCard = screen.getByTestId('feature-item')
      await user.hover(featureCard)

      await waitFor(() => {
        expect(featureCard).toHaveAttribute('data-expanded', 'true')
      })
    })

    it('should show additional details on feature hover', async () => {
      const user = userEvent.setup()
      const { Features } = await import('@mdxui/beacon')

      render(
        <Features
          items={[
            {
              title: 'Feature 1',
              description: 'Short desc',
              details: 'Extended details shown on hover',
            },
          ]}
          showDetailsOnHover
        />
      )

      const featureCard = screen.getByTestId('feature-item')
      expect(screen.queryByText('Extended details shown on hover')).not.toBeVisible()

      await user.hover(featureCard)

      await waitFor(() => {
        expect(screen.getByText('Extended details shown on hover')).toBeVisible()
      })
    })
  })

  describe('filtering and categories', () => {
    it('should filter features by category', async () => {
      const user = userEvent.setup()
      const { Features } = await import('@mdxui/beacon')

      render(
        <Features
          items={[
            { title: 'Feature A', description: 'Desc', category: 'performance' },
            { title: 'Feature B', description: 'Desc', category: 'security' },
            { title: 'Feature C', description: 'Desc', category: 'performance' },
          ]}
          showCategoryFilter
        />
      )

      const filterButton = screen.getByRole('button', { name: /security/i })
      await user.click(filterButton)

      await waitFor(() => {
        expect(screen.queryByText('Feature A')).not.toBeVisible()
        expect(screen.getByText('Feature B')).toBeVisible()
        expect(screen.queryByText('Feature C')).not.toBeVisible()
      })
    })

    it('should show all features when "All" filter selected', async () => {
      const user = userEvent.setup()
      const { Features } = await import('@mdxui/beacon')

      render(
        <Features
          items={[
            { title: 'Feature A', description: 'Desc', category: 'performance' },
            { title: 'Feature B', description: 'Desc', category: 'security' },
          ]}
          showCategoryFilter
          defaultCategory="security"
        />
      )

      const allButton = screen.getByRole('button', { name: /all/i })
      await user.click(allButton)

      await waitFor(() => {
        expect(screen.getByText('Feature A')).toBeVisible()
        expect(screen.getByText('Feature B')).toBeVisible()
      })
    })
  })

  describe('animation on scroll', () => {
    it('should animate features into view on scroll', async () => {
      const { Features } = await import('@mdxui/beacon')

      render(
        <Features
          items={[
            { title: 'Feature 1', description: 'Desc 1' },
            { title: 'Feature 2', description: 'Desc 2' },
          ]}
          animateOnScroll
        />
      )

      const featureItems = screen.getAllByTestId('feature-item')

      // Initially hidden
      featureItems.forEach((item) => {
        expect(item).toHaveAttribute('data-visible', 'false')
      })

      // Trigger intersection observer
      fireEvent.scroll(window, { target: { scrollY: 500 } })

      await waitFor(() => {
        featureItems.forEach((item) => {
          expect(item).toHaveAttribute('data-visible', 'true')
        })
      })
    })

    it('should stagger feature animations', async () => {
      const { Features } = await import('@mdxui/beacon')

      render(
        <Features
          items={[
            { title: 'Feature 1', description: 'Desc 1' },
            { title: 'Feature 2', description: 'Desc 2' },
            { title: 'Feature 3', description: 'Desc 3' },
          ]}
          animateOnScroll
          staggerDelay={100}
        />
      )

      const featureItems = screen.getAllByTestId('feature-item')

      // Each item should have increasing animation delay
      expect(featureItems[0]).toHaveStyle('animation-delay: 0ms')
      expect(featureItems[1]).toHaveStyle('animation-delay: 100ms')
      expect(featureItems[2]).toHaveStyle('animation-delay: 200ms')
    })
  })
})

// =============================================================================
// Test Suite: CTA Button Interactions
// =============================================================================

describe('CTA Button Interactions', () => {
  describe('loading states', () => {
    it('should show loading spinner when CTA is clicked', async () => {
      const user = userEvent.setup()
      const { CTA } = await import('@mdxui/beacon')

      const onAction = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 1000)))

      render(
        <CTA
          title="Get Started"
          primaryAction={{
            label: 'Start Building',
            onClick: onAction,
            showLoading: true,
          }}
        />
      )

      const ctaButton = screen.getByRole('button', { name: /start building/i })
      await user.click(ctaButton)

      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
      expect(ctaButton).toBeDisabled()
    })

    it('should restore button state after action completes', async () => {
      const user = userEvent.setup()
      const { CTA } = await import('@mdxui/beacon')

      const onAction = vi.fn(() => Promise.resolve())

      render(
        <CTA
          title="Get Started"
          primaryAction={{
            label: 'Start Building',
            onClick: onAction,
            showLoading: true,
          }}
        />
      )

      const ctaButton = screen.getByRole('button', { name: /start building/i })
      await user.click(ctaButton)

      await waitFor(() => {
        expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument()
        expect(ctaButton).not.toBeDisabled()
      })
    })
  })

  describe('analytics tracking', () => {
    it('should track CTA click events', async () => {
      const user = userEvent.setup()
      const { CTA } = await import('@mdxui/beacon')

      const onTrack = vi.fn()

      render(
        <CTA
          title="Get Started"
          primaryAction={{
            label: 'Start Building',
            href: '/docs',
            trackingId: 'hero-cta-primary',
          }}
          onTrack={onTrack}
        />
      )

      const ctaButton = screen.getByRole('link', { name: /start building/i })
      await user.click(ctaButton)

      expect(onTrack).toHaveBeenCalledWith({
        event: 'cta_click',
        id: 'hero-cta-primary',
        label: 'Start Building',
      })
    })
  })

  describe('hover animations', () => {
    it('should animate button on hover', async () => {
      const user = userEvent.setup()
      const { CTA } = await import('@mdxui/beacon')

      render(
        <CTA
          title="Get Started"
          primaryAction={{
            label: 'Start Building',
            href: '/docs',
            hoverAnimation: 'scale',
          }}
        />
      )

      const ctaButton = screen.getByRole('link', { name: /start building/i })
      await user.hover(ctaButton)

      expect(ctaButton).toHaveClass('hover-scale')
    })
  })
})

// =============================================================================
// Test Suite: Navigation Responsive Behaviors
// =============================================================================

describe('Navigation Responsive Behaviors', () => {
  describe('mobile menu', () => {
    beforeEach(() => {
      // Mock mobile viewport
      Object.defineProperty(window, 'innerWidth', { value: 375, writable: true })
      Object.defineProperty(window, 'innerHeight', { value: 667, writable: true })
      window.dispatchEvent(new Event('resize'))
    })

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true })
      Object.defineProperty(window, 'innerHeight', { value: 768, writable: true })
      window.dispatchEvent(new Event('resize'))
    })

    it('should show hamburger menu on mobile', async () => {
      const { Navigation } = await import('@mdxui/beacon')

      render(
        <Navigation
          items={[
            { label: 'Docs', href: '/docs' },
            { label: 'GitHub', href: 'https://github.com' },
          ]}
        />
      )

      expect(screen.getByRole('button', { name: /menu|toggle navigation/i })).toBeInTheDocument()
    })

    it('should open mobile menu on hamburger click', async () => {
      const user = userEvent.setup()
      const { Navigation } = await import('@mdxui/beacon')

      render(
        <Navigation
          items={[
            { label: 'Docs', href: '/docs' },
            { label: 'GitHub', href: 'https://github.com' },
          ]}
        />
      )

      const hamburger = screen.getByRole('button', { name: /menu|toggle navigation/i })
      await user.click(hamburger)

      expect(screen.getByTestId('mobile-menu')).toHaveAttribute('aria-expanded', 'true')
    })

    it('should close mobile menu when nav item clicked', async () => {
      const user = userEvent.setup()
      const { Navigation } = await import('@mdxui/beacon')

      render(
        <Navigation
          items={[
            { label: 'Docs', href: '/docs' },
          ]}
          closeOnNavigation
        />
      )

      const hamburger = screen.getByRole('button', { name: /menu|toggle navigation/i })
      await user.click(hamburger)

      const docsLink = screen.getByRole('link', { name: /docs/i })
      await user.click(docsLink)

      await waitFor(() => {
        expect(screen.getByTestId('mobile-menu')).toHaveAttribute('aria-expanded', 'false')
      })
    })

    it('should close mobile menu on escape key', async () => {
      const user = userEvent.setup()
      const { Navigation } = await import('@mdxui/beacon')

      render(
        <Navigation
          items={[{ label: 'Docs', href: '/docs' }]}
        />
      )

      const hamburger = screen.getByRole('button', { name: /menu|toggle navigation/i })
      await user.click(hamburger)

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.getByTestId('mobile-menu')).toHaveAttribute('aria-expanded', 'false')
      })
    })

    it('should trap focus within mobile menu when open', async () => {
      const user = userEvent.setup()
      const { Navigation } = await import('@mdxui/beacon')

      render(
        <Navigation
          items={[
            { label: 'Docs', href: '/docs' },
            { label: 'GitHub', href: 'https://github.com' },
          ]}
        />
      )

      const hamburger = screen.getByRole('button', { name: /menu|toggle navigation/i })
      await user.click(hamburger)

      // Tab through all items and expect focus to cycle back
      await user.tab() // First item
      await user.tab() // Second item
      await user.tab() // Close button
      await user.tab() // Should cycle back to first

      expect(screen.getAllByRole('link')[0]).toHaveFocus()
    })
  })

  describe('sticky navigation', () => {
    it('should become sticky on scroll', async () => {
      const { Navigation } = await import('@mdxui/beacon')

      render(
        <Navigation
          items={[{ label: 'Docs', href: '/docs' }]}
          sticky
        />
      )

      fireEvent.scroll(window, { target: { scrollY: 100 } })

      await waitFor(() => {
        expect(screen.getByRole('navigation')).toHaveClass('sticky')
      })
    })

    it('should show compact navigation after scrolling threshold', async () => {
      const { Navigation } = await import('@mdxui/beacon')

      render(
        <Navigation
          items={[{ label: 'Docs', href: '/docs' }]}
          sticky
          compactOnScroll
          compactThreshold={200}
        />
      )

      fireEvent.scroll(window, { target: { scrollY: 250 } })

      await waitFor(() => {
        expect(screen.getByRole('navigation')).toHaveClass('compact')
      })
    })
  })
})

// =============================================================================
// Test Suite: Testimonials Carousel Interactions
// =============================================================================

describe('Testimonials Carousel Interactions', () => {
  describe('navigation controls', () => {
    it('should navigate to next testimonial on arrow click', async () => {
      const user = userEvent.setup()
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            { quote: 'Quote 1', author: 'Author 1' },
            { quote: 'Quote 2', author: 'Author 2' },
          ]}
          showArrows
        />
      )

      expect(screen.getByText('Quote 1')).toBeVisible()

      const nextButton = screen.getByRole('button', { name: /next/i })
      await user.click(nextButton)

      await waitFor(() => {
        expect(screen.getByText('Quote 2')).toBeVisible()
        expect(screen.queryByText('Quote 1')).not.toBeVisible()
      })
    })

    it('should navigate to previous testimonial on arrow click', async () => {
      const user = userEvent.setup()
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            { quote: 'Quote 1', author: 'Author 1' },
            { quote: 'Quote 2', author: 'Author 2' },
          ]}
          showArrows
          initialIndex={1}
        />
      )

      expect(screen.getByText('Quote 2')).toBeVisible()

      const prevButton = screen.getByRole('button', { name: /previous/i })
      await user.click(prevButton)

      await waitFor(() => {
        expect(screen.getByText('Quote 1')).toBeVisible()
      })
    })

    it('should loop to first testimonial after last', async () => {
      const user = userEvent.setup()
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            { quote: 'Quote 1', author: 'Author 1' },
            { quote: 'Quote 2', author: 'Author 2' },
          ]}
          showArrows
          loop
          initialIndex={1}
        />
      )

      const nextButton = screen.getByRole('button', { name: /next/i })
      await user.click(nextButton)

      await waitFor(() => {
        expect(screen.getByText('Quote 1')).toBeVisible()
      })
    })
  })

  describe('dot indicators', () => {
    it('should show dot indicators for each testimonial', async () => {
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            { quote: 'Quote 1', author: 'Author 1' },
            { quote: 'Quote 2', author: 'Author 2' },
            { quote: 'Quote 3', author: 'Author 3' },
          ]}
          showDots
        />
      )

      const dots = screen.getAllByTestId('carousel-dot')
      expect(dots).toHaveLength(3)
    })

    it('should navigate to specific testimonial on dot click', async () => {
      const user = userEvent.setup()
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            { quote: 'Quote 1', author: 'Author 1' },
            { quote: 'Quote 2', author: 'Author 2' },
            { quote: 'Quote 3', author: 'Author 3' },
          ]}
          showDots
        />
      )

      const dots = screen.getAllByTestId('carousel-dot')
      await user.click(dots[2])

      await waitFor(() => {
        expect(screen.getByText('Quote 3')).toBeVisible()
      })
    })

    it('should highlight active dot indicator', async () => {
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            { quote: 'Quote 1', author: 'Author 1' },
            { quote: 'Quote 2', author: 'Author 2' },
          ]}
          showDots
          initialIndex={1}
        />
      )

      const dots = screen.getAllByTestId('carousel-dot')
      expect(dots[1]).toHaveAttribute('aria-current', 'true')
    })
  })

  describe('autoplay', () => {
    it('should auto-advance testimonials when autoplay enabled', async () => {
      vi.useFakeTimers()
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            { quote: 'Quote 1', author: 'Author 1' },
            { quote: 'Quote 2', author: 'Author 2' },
          ]}
          autoplay
          autoplayInterval={3000}
        />
      )

      expect(screen.getByText('Quote 1')).toBeVisible()

      vi.advanceTimersByTime(3000)

      await waitFor(() => {
        expect(screen.getByText('Quote 2')).toBeVisible()
      })

      vi.useRealTimers()
    })

    it('should pause autoplay on hover', async () => {
      vi.useFakeTimers()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            { quote: 'Quote 1', author: 'Author 1' },
            { quote: 'Quote 2', author: 'Author 2' },
          ]}
          autoplay
          autoplayInterval={3000}
          pauseOnHover
        />
      )

      const carousel = screen.getByTestId('testimonials')
      await user.hover(carousel)

      vi.advanceTimersByTime(5000)

      // Should still be on first quote because autoplay is paused
      expect(screen.getByText('Quote 1')).toBeVisible()

      vi.useRealTimers()
    })
  })

  describe('swipe gestures', () => {
    it('should navigate on swipe left', async () => {
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            { quote: 'Quote 1', author: 'Author 1' },
            { quote: 'Quote 2', author: 'Author 2' },
          ]}
          swipeable
        />
      )

      const carousel = screen.getByTestId('testimonials')

      // Simulate swipe left
      fireEvent.touchStart(carousel, { touches: [{ clientX: 300, clientY: 0 }] })
      fireEvent.touchMove(carousel, { touches: [{ clientX: 100, clientY: 0 }] })
      fireEvent.touchEnd(carousel)

      await waitFor(() => {
        expect(screen.getByText('Quote 2')).toBeVisible()
      })
    })
  })
})

// =============================================================================
// Test Suite: Pricing Section Interactions
// =============================================================================

describe('Pricing Section Interactions', () => {
  describe('toggle annual/monthly', () => {
    it('should show monthly prices by default', async () => {
      const { Pricing } = await import('@mdxui/beacon')

      render(
        <Pricing
          tiers={[
            {
              name: 'Pro',
              monthlyPrice: '$49',
              annualPrice: '$39',
              features: ['Feature 1'],
            },
          ]}
          showBillingToggle
        />
      )

      expect(screen.getByText('$49')).toBeInTheDocument()
    })

    it('should switch to annual prices on toggle', async () => {
      const user = userEvent.setup()
      const { Pricing } = await import('@mdxui/beacon')

      render(
        <Pricing
          tiers={[
            {
              name: 'Pro',
              monthlyPrice: '$49',
              annualPrice: '$39',
              features: ['Feature 1'],
            },
          ]}
          showBillingToggle
        />
      )

      const toggle = screen.getByRole('switch', { name: /annual|billing/i })
      await user.click(toggle)

      await waitFor(() => {
        expect(screen.getByText('$39')).toBeInTheDocument()
        expect(screen.queryByText('$49')).not.toBeInTheDocument()
      })
    })

    it('should show savings badge for annual billing', async () => {
      const user = userEvent.setup()
      const { Pricing } = await import('@mdxui/beacon')

      render(
        <Pricing
          tiers={[
            {
              name: 'Pro',
              monthlyPrice: '$49',
              annualPrice: '$39',
              annualSavings: '20%',
              features: ['Feature 1'],
            },
          ]}
          showBillingToggle
        />
      )

      const toggle = screen.getByRole('switch', { name: /annual|billing/i })
      await user.click(toggle)

      await waitFor(() => {
        expect(screen.getByText(/save 20%/i)).toBeInTheDocument()
      })
    })
  })

  describe('feature comparison', () => {
    it('should expand feature comparison table', async () => {
      const user = userEvent.setup()
      const { Pricing } = await import('@mdxui/beacon')

      render(
        <Pricing
          tiers={[
            { name: 'Free', price: '$0', features: ['Basic'] },
            { name: 'Pro', price: '$49', features: ['Basic', 'Advanced'] },
          ]}
          showComparisonTable
        />
      )

      const compareButton = screen.getByRole('button', { name: /compare|details/i })
      await user.click(compareButton)

      await waitFor(() => {
        expect(screen.getByTestId('comparison-table')).toBeVisible()
      })
    })
  })
})

// =============================================================================
// Test Suite: Advanced Accessibility
// =============================================================================

describe('Advanced Accessibility', () => {
  describe('screen reader announcements', () => {
    it('should announce hero section on page load', async () => {
      const { LandingPage, Hero } = await import('@mdxui/beacon')

      render(
        <LandingPage>
          <Hero title="Build your 1-Person Unicorn" />
        </LandingPage>
      )

      const liveRegion = screen.getByRole('status')
      expect(liveRegion).toHaveTextContent(/welcome|build your 1-person unicorn/i)
    })

    it('should announce carousel slide changes', async () => {
      const user = userEvent.setup()
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            { quote: 'Quote 1', author: 'Author 1' },
            { quote: 'Quote 2', author: 'Author 2' },
          ]}
          showArrows
        />
      )

      const nextButton = screen.getByRole('button', { name: /next/i })
      await user.click(nextButton)

      const liveRegion = screen.getByRole('status')
      expect(liveRegion).toHaveTextContent(/testimonial 2 of 2/i)
    })
  })

  describe('keyboard navigation', () => {
    it('should allow arrow key navigation in features grid', async () => {
      const user = userEvent.setup()
      const { Features } = await import('@mdxui/beacon')

      render(
        <Features
          items={[
            { title: 'Feature 1', description: 'Desc 1' },
            { title: 'Feature 2', description: 'Desc 2' },
            { title: 'Feature 3', description: 'Desc 3' },
          ]}
          keyboardNavigation
        />
      )

      const firstFeature = screen.getAllByTestId('feature-item')[0]
      firstFeature.focus()

      await user.keyboard('{ArrowRight}')

      expect(screen.getAllByTestId('feature-item')[1]).toHaveFocus()
    })

    it('should support Enter/Space to activate feature links', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      const { Features } = await import('@mdxui/beacon')

      render(
        <Features
          items={[
            { title: 'Feature 1', description: 'Desc 1', onClick },
          ]}
        />
      )

      const featureItem = screen.getByTestId('feature-item')
      featureItem.focus()

      await user.keyboard('{Enter}')

      expect(onClick).toHaveBeenCalled()
    })
  })

  describe('reduced motion', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        value: vi.fn().mockImplementation((query) => ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
        })),
        writable: true,
      })
    })

    it('should disable animations when reduced motion preferred', async () => {
      const { Hero } = await import('@mdxui/beacon')

      render(
        <Hero
          title="Test Hero"
          variant="code-side"
          typewriterEffect
        />
      )

      const hero = screen.getByTestId('hero')
      expect(hero).toHaveAttribute('data-reduced-motion', 'true')
    })

    it('should disable carousel autoplay when reduced motion preferred', async () => {
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            { quote: 'Quote 1', author: 'Author 1' },
            { quote: 'Quote 2', author: 'Author 2' },
          ]}
          autoplay
        />
      )

      expect(screen.getByTestId('testimonials')).toHaveAttribute('data-autoplay', 'false')
    })
  })

  describe('color contrast', () => {
    it('should support high contrast mode', async () => {
      const { LandingPage, Hero } = await import('@mdxui/beacon')

      render(
        <LandingPage highContrast>
          <Hero title="Test" />
        </LandingPage>
      )

      expect(screen.getByTestId('landing-page')).toHaveClass('high-contrast')
    })
  })
})

// =============================================================================
// Test Suite: Error Handling
// =============================================================================

describe('Error Handling', () => {
  describe('missing required props', () => {
    it('should render fallback when Hero has no title', async () => {
      const { Hero } = await import('@mdxui/beacon')

      // @ts-expect-error - Testing runtime behavior with missing props
      render(<Hero />)

      expect(screen.getByTestId('hero-error')).toHaveTextContent(/title is required/i)
    })

    it('should render empty state when Features has no items', async () => {
      const { Features } = await import('@mdxui/beacon')

      render(<Features items={[]} />)

      expect(screen.getByTestId('features-empty')).toBeInTheDocument()
    })
  })

  describe('error boundaries', () => {
    it('should catch and display errors in hero', async () => {
      const { Hero } = await import('@mdxui/beacon')

      // Simulate error-causing props
      render(
        <Hero
          title="Test"
          // @ts-expect-error - Testing runtime error handling
          cta={{ label: null, href: '/docs' }}
        />
      )

      expect(screen.getByTestId('hero-error-boundary')).toBeInTheDocument()
    })
  })
})

// =============================================================================
// Test Suite: Performance Optimizations
// =============================================================================

describe('Performance Optimizations', () => {
  describe('lazy loading', () => {
    it('should lazy load testimonial images', async () => {
      const { Testimonials } = await import('@mdxui/beacon')

      render(
        <Testimonials
          items={[
            {
              quote: 'Quote 1',
              author: 'Author 1',
              avatar: '/avatar1.jpg',
            },
          ]}
        />
      )

      const avatar = screen.getByRole('img')
      expect(avatar).toHaveAttribute('loading', 'lazy')
    })

    it('should defer loading below-fold sections', async () => {
      const { LandingPage, Hero, Features, Testimonials, Pricing } = await import('@mdxui/beacon')

      render(
        <LandingPage deferBelowFold>
          <Hero title="Test" />
          <Features items={[{ title: 'F1', description: 'D1' }]} />
          <Testimonials items={[{ quote: 'Q', author: 'A' }]} />
          <Pricing tiers={[{ name: 'Free', price: '$0', features: ['Basic'] }]} />
        </LandingPage>
      )

      // Below-fold sections should have data-deferred attribute
      expect(screen.getByTestId('testimonials')).toHaveAttribute('data-deferred', 'true')
      expect(screen.getByTestId('pricing')).toHaveAttribute('data-deferred', 'true')
    })
  })

  describe('memoization', () => {
    it('should not re-render features when unrelated props change', async () => {
      const { Features } = await import('@mdxui/beacon')
      const renderSpy = vi.fn()

      const TestComponent = () => {
        const [count, setCount] = React.useState(0)
        return (
          <>
            <button onClick={() => setCount((c) => c + 1)}>Increment</button>
            <Features
              items={[{ title: 'F1', description: 'D1' }]}
              onRender={renderSpy}
            />
          </>
        )
      }

      const user = userEvent.setup()
      render(<TestComponent />)

      expect(renderSpy).toHaveBeenCalledTimes(1)

      await user.click(screen.getByText('Increment'))

      // Should not re-render because items didn't change
      expect(renderSpy).toHaveBeenCalledTimes(1)
    })
  })
})
