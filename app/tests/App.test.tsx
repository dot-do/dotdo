import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Nav, NavProps, NavLink } from '../components/Nav'
import { Layout, LayoutProps, PageLayout, PageLayoutProps } from '../components/Layout'

// Mock TanStack Router's Link component
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className, activeProps, ...props }: any) => (
    <a href={to} className={className} data-testid="router-link" {...props}>
      {children}
    </a>
  ),
}))

describe('Nav Component', () => {
  describe('rendering', () => {
    it('should render with default links', () => {
      render(<Nav />)

      expect(screen.getByText('Home')).toBeInTheDocument()
      expect(screen.getByText('Docs')).toBeInTheDocument()
      expect(screen.getByText('Admin')).toBeInTheDocument()
    })

    it('should render custom links', () => {
      const customLinks: NavLink[] = [
        { href: '/custom', label: 'Custom' },
        { href: '/another', label: 'Another' },
      ]

      render(<Nav links={customLinks} />)

      expect(screen.getByText('Custom')).toBeInTheDocument()
      expect(screen.getByText('Another')).toBeInTheDocument()
      expect(screen.queryByText('Home')).not.toBeInTheDocument()
    })

    it('should render external links with correct attributes', () => {
      const links: NavLink[] = [
        { href: 'https://external.com', label: 'External', external: true },
      ]

      render(<Nav links={links} />)

      const externalLink = screen.getByText('External')
      expect(externalLink).toHaveAttribute('target', '_blank')
      expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer')
      expect(externalLink).toHaveAttribute('href', 'https://external.com')
    })

    it('should render internal links using router Link', () => {
      const links: NavLink[] = [
        { href: '/internal', label: 'Internal' },
      ]

      render(<Nav links={links} />)

      const link = screen.getByText('Internal')
      expect(link.closest('[data-testid="router-link"]')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      render(<Nav className="custom-nav-class" />)

      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('custom-nav-class')
    })

    it('should have proper ARIA label', () => {
      render(<Nav />)

      const nav = screen.getByRole('navigation')
      expect(nav).toHaveAttribute('aria-label', 'Main navigation')
    })
  })

  describe('mixed link types', () => {
    it('should correctly differentiate between internal and external links', () => {
      const links: NavLink[] = [
        { href: '/', label: 'Home' },
        { href: 'https://github.com', label: 'GitHub', external: true },
        { href: '/about', label: 'About' },
      ]

      render(<Nav links={links} />)

      // Internal links should use router Link
      expect(screen.getByText('Home').closest('[data-testid="router-link"]')).toBeInTheDocument()
      expect(screen.getByText('About').closest('[data-testid="router-link"]')).toBeInTheDocument()

      // External link should be a regular anchor with target blank
      const githubLink = screen.getByText('GitHub')
      expect(githubLink).toHaveAttribute('target', '_blank')
    })
  })
})

describe('Layout Component', () => {
  describe('rendering', () => {
    it('should render children', () => {
      render(
        <Layout>
          <div data-testid="child-content">Test Content</div>
        </Layout>
      )

      expect(screen.getByTestId('child-content')).toBeInTheDocument()
      expect(screen.getByText('Test Content')).toBeInTheDocument()
    })

    it('should render with default title', () => {
      render(<Layout>Content</Layout>)

      expect(screen.getByText('dotdo')).toBeInTheDocument()
    })

    it('should render with custom title', () => {
      render(<Layout title="Custom Title">Content</Layout>)

      expect(screen.getByText('Custom Title')).toBeInTheDocument()
    })

    it('should render with default description', () => {
      render(<Layout>Content</Layout>)

      expect(screen.getByText('Business-as-Code. Services-as-Software.')).toBeInTheDocument()
    })

    it('should render with custom description', () => {
      render(<Layout description="Custom Description">Content</Layout>)

      expect(screen.getByText('Custom Description')).toBeInTheDocument()
    })

    it('should not render description when empty string', () => {
      render(<Layout description="">Content</Layout>)

      expect(screen.queryByText('Business-as-Code. Services-as-Software.')).not.toBeInTheDocument()
    })
  })

  describe('header visibility', () => {
    it('should show header by default', () => {
      render(<Layout>Content</Layout>)

      const header = screen.getByRole('banner')
      expect(header).toBeInTheDocument()
    })

    it('should hide header when showHeader is false', () => {
      render(<Layout showHeader={false}>Content</Layout>)

      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    })
  })

  describe('footer visibility', () => {
    it('should show footer by default', () => {
      render(<Layout>Content</Layout>)

      const footer = screen.getByRole('contentinfo')
      expect(footer).toBeInTheDocument()
    })

    it('should hide footer when showFooter is false', () => {
      render(<Layout showFooter={false}>Content</Layout>)

      expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
    })

    it('should display copyright with current year', () => {
      render(<Layout>Content</Layout>)

      const currentYear = new Date().getFullYear()
      expect(screen.getByText(new RegExp(`${currentYear}`))).toBeInTheDocument()
    })
  })

  describe('navigation', () => {
    it('should include navigation component', () => {
      render(<Layout>Content</Layout>)

      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('should pass custom navLinks to Nav component', () => {
      const customLinks: NavLink[] = [
        { href: '/custom1', label: 'Custom Link 1' },
        { href: '/custom2', label: 'Custom Link 2' },
      ]

      render(<Layout navLinks={customLinks}>Content</Layout>)

      expect(screen.getByText('Custom Link 1')).toBeInTheDocument()
      expect(screen.getByText('Custom Link 2')).toBeInTheDocument()
    })
  })

  describe('className', () => {
    it('should apply custom className', () => {
      const { container } = render(<Layout className="custom-class">Content</Layout>)

      const wrapper = container.firstChild
      expect(wrapper).toHaveClass('custom-class')
    })

    it('should maintain base classes with custom className', () => {
      const { container } = render(<Layout className="custom-class">Content</Layout>)

      const wrapper = container.firstChild
      expect(wrapper).toHaveClass('min-h-screen')
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('flex-col')
    })
  })
})

describe('PageLayout Component', () => {
  describe('rendering', () => {
    it('should render children', () => {
      render(
        <PageLayout>
          <div data-testid="page-content">Page Content</div>
        </PageLayout>
      )

      expect(screen.getByTestId('page-content')).toBeInTheDocument()
    })

    it('should render title when provided', () => {
      render(<PageLayout title="Page Title">Content</PageLayout>)

      expect(screen.getByText('Page Title')).toBeInTheDocument()
    })

    it('should not render title when not provided', () => {
      render(<PageLayout>Content</PageLayout>)

      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    })

    it('should render subtitle when provided', () => {
      render(<PageLayout title="Title" subtitle="Page Subtitle">Content</PageLayout>)

      expect(screen.getByText('Page Subtitle')).toBeInTheDocument()
    })

    it('should not render subtitle when not provided', () => {
      render(<PageLayout title="Title">Content</PageLayout>)

      // Only the title heading should exist
      const headings = screen.getAllByRole('heading')
      expect(headings).toHaveLength(1)
    })
  })

  describe('max width variants', () => {
    const maxWidthTestCases: Array<{ width: PageLayoutProps['maxWidth']; expectedClass: string }> = [
      { width: 'sm', expectedClass: 'max-w-sm' },
      { width: 'md', expectedClass: 'max-w-md' },
      { width: 'lg', expectedClass: 'max-w-lg' },
      { width: 'xl', expectedClass: 'max-w-xl' },
      { width: '2xl', expectedClass: 'max-w-2xl' },
      { width: '4xl', expectedClass: 'max-w-4xl' },
      { width: 'full', expectedClass: 'max-w-full' },
    ]

    it.each(maxWidthTestCases)(
      'should apply $expectedClass class when maxWidth is "$width"',
      ({ width, expectedClass }) => {
        const { container } = render(<PageLayout maxWidth={width}>Content</PageLayout>)

        const innerDiv = container.querySelector('.mx-auto')
        expect(innerDiv).toHaveClass(expectedClass)
      }
    )

    it('should use 4xl as default maxWidth', () => {
      const { container } = render(<PageLayout>Content</PageLayout>)

      const innerDiv = container.querySelector('.mx-auto')
      expect(innerDiv).toHaveClass('max-w-4xl')
    })
  })

  describe('className', () => {
    it('should apply custom className to inner container', () => {
      const { container } = render(<PageLayout className="custom-page-class">Content</PageLayout>)

      const innerDiv = container.querySelector('.mx-auto')
      expect(innerDiv).toHaveClass('custom-page-class')
    })
  })
})

describe('Component Integration', () => {
  describe('Layout with PageLayout', () => {
    it('should render Layout with PageLayout as child', () => {
      render(
        <Layout title="Site Title">
          <PageLayout title="Page Title" subtitle="Page Subtitle">
            <p>Page content goes here</p>
          </PageLayout>
        </Layout>
      )

      // Layout title in header
      expect(screen.getByRole('banner')).toContainElement(screen.getByText('Site Title'))

      // PageLayout title and subtitle
      expect(screen.getByText('Page Title')).toBeInTheDocument()
      expect(screen.getByText('Page Subtitle')).toBeInTheDocument()

      // Content
      expect(screen.getByText('Page content goes here')).toBeInTheDocument()
    })
  })
})

describe('User Interactions', () => {
  describe('Nav link clicks', () => {
    it('should allow clicking internal links', () => {
      render(<Nav />)

      const homeLink = screen.getByText('Home')

      // Ensure link is clickable (not disabled)
      expect(homeLink).not.toHaveAttribute('disabled')

      // Can fire click event without errors
      fireEvent.click(homeLink)
    })

    it('should allow clicking external links', () => {
      const links: NavLink[] = [
        { href: 'https://github.com', label: 'GitHub', external: true },
      ]

      render(<Nav links={links} />)

      const githubLink = screen.getByText('GitHub')

      expect(githubLink).not.toHaveAttribute('disabled')
      fireEvent.click(githubLink)
    })
  })

  describe('keyboard navigation', () => {
    it('should allow keyboard focus on nav links', () => {
      render(<Nav />)

      const homeLink = screen.getByText('Home')
      homeLink.focus()

      expect(document.activeElement).toBe(homeLink)
    })
  })
})

describe('Accessibility', () => {
  describe('Nav', () => {
    it('should have navigation landmark', () => {
      render(<Nav />)

      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('should have accessible name for navigation', () => {
      render(<Nav />)

      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
    })
  })

  describe('Layout', () => {
    it('should have header landmark', () => {
      render(<Layout>Content</Layout>)

      expect(screen.getByRole('banner')).toBeInTheDocument()
    })

    it('should have main landmark', () => {
      render(<Layout>Content</Layout>)

      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('should have footer landmark', () => {
      render(<Layout>Content</Layout>)

      expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    })
  })

  describe('PageLayout', () => {
    it('should use proper heading hierarchy', () => {
      render(<PageLayout title="Main Title">Content</PageLayout>)

      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveTextContent('Main Title')
    })
  })
})

describe('State Management', () => {
  describe('Props-based state', () => {
    it('should re-render Nav when links prop changes', () => {
      const initialLinks: NavLink[] = [{ href: '/a', label: 'Link A' }]
      const updatedLinks: NavLink[] = [{ href: '/b', label: 'Link B' }]

      const { rerender } = render(<Nav links={initialLinks} />)

      expect(screen.getByText('Link A')).toBeInTheDocument()
      expect(screen.queryByText('Link B')).not.toBeInTheDocument()

      rerender(<Nav links={updatedLinks} />)

      expect(screen.queryByText('Link A')).not.toBeInTheDocument()
      expect(screen.getByText('Link B')).toBeInTheDocument()
    })

    it('should re-render Layout when title changes', () => {
      const { rerender } = render(<Layout title="Original Title">Content</Layout>)

      expect(screen.getByText('Original Title')).toBeInTheDocument()

      rerender(<Layout title="Updated Title">Content</Layout>)

      expect(screen.queryByText('Original Title')).not.toBeInTheDocument()
      expect(screen.getByText('Updated Title')).toBeInTheDocument()
    })

    it('should re-render Layout when visibility props change', () => {
      const { rerender } = render(<Layout showHeader={true} showFooter={true}>Content</Layout>)

      expect(screen.getByRole('banner')).toBeInTheDocument()
      expect(screen.getByRole('contentinfo')).toBeInTheDocument()

      rerender(<Layout showHeader={false} showFooter={false}>Content</Layout>)

      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
      expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
    })

    it('should re-render PageLayout when maxWidth changes', () => {
      const { container, rerender } = render(<PageLayout maxWidth="sm">Content</PageLayout>)

      let innerDiv = container.querySelector('.mx-auto')
      expect(innerDiv).toHaveClass('max-w-sm')

      rerender(<PageLayout maxWidth="xl">Content</PageLayout>)

      innerDiv = container.querySelector('.mx-auto')
      expect(innerDiv).toHaveClass('max-w-xl')
    })
  })
})
