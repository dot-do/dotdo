import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock TanStack Router's Link component
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
    activeProps,
  }: {
    to: string
    children: React.ReactNode
    className?: string
    activeProps?: { className?: string }
  }) => (
    <a href={to} className={className} data-active-class={activeProps?.className}>
      {children}
    </a>
  ),
}))

// Import Nav after mocking
import { Nav } from '../../components/Nav'
import type { NavLink } from '../../components/Nav'

describe('Nav', () => {
  it('should render default navigation links', () => {
    render(<Nav />)

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Docs')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('should render custom links when provided', () => {
    const customLinks: NavLink[] = [
      { href: '/custom', label: 'Custom Link' },
      { href: '/another', label: 'Another Link' },
    ]

    render(<Nav links={customLinks} />)

    expect(screen.getByText('Custom Link')).toBeInTheDocument()
    expect(screen.getByText('Another Link')).toBeInTheDocument()
    expect(screen.queryByText('Home')).not.toBeInTheDocument()
  })

  it('should render external links with target="_blank"', () => {
    const links: NavLink[] = [
      { href: 'https://example.com', label: 'External', external: true },
    ]

    render(<Nav links={links} />)

    const externalLink = screen.getByText('External')
    expect(externalLink).toHaveAttribute('target', '_blank')
    expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('should apply custom className', () => {
    const { container } = render(<Nav className="custom-nav-class" />)

    const nav = container.querySelector('nav')
    expect(nav).toHaveClass('custom-nav-class')
  })

  it('should have proper aria-label for accessibility', () => {
    render(<Nav />)

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(nav).toBeInTheDocument()
  })

  it('should render internal links without target attribute', () => {
    const links: NavLink[] = [{ href: '/internal', label: 'Internal' }]

    render(<Nav links={links} />)

    const internalLink = screen.getByText('Internal')
    expect(internalLink).not.toHaveAttribute('target')
  })

  it('should handle empty links array', () => {
    render(<Nav links={[]} />)

    const nav = screen.getByRole('navigation')
    expect(nav.children.length).toBe(0)
  })

  it('should render links with correct href', () => {
    render(<Nav />)

    expect(screen.getByText('Home').closest('a')).toHaveAttribute('href', '/')
    expect(screen.getByText('Docs').closest('a')).toHaveAttribute('href', '/docs')
    expect(screen.getByText('Admin').closest('a')).toHaveAttribute('href', '/admin')
  })
})
