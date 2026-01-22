import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Layout, PageLayout } from '../../components/Layout'

// Mock the Nav component since it uses TanStack Router Link
vi.mock('../../components/Nav', () => ({
  Nav: ({ links }: { links?: { href: string; label: string }[] }) => (
    <nav data-testid="mock-nav">
      {links?.map((link) => (
        <a key={link.href} href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  ),
}))

describe('Layout', () => {
  it('should render with default props', () => {
    render(
      <Layout>
        <div data-testid="child">Content</div>
      </Layout>
    )

    expect(screen.getByText('dotdo')).toBeInTheDocument()
    expect(screen.getByText('Business-as-Code. Services-as-Software.')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('should render with custom title and description', () => {
    render(
      <Layout title="Custom Title" description="Custom description">
        <div>Content</div>
      </Layout>
    )

    expect(screen.getByText('Custom Title')).toBeInTheDocument()
    expect(screen.getByText('Custom description')).toBeInTheDocument()
  })

  it('should hide header when showHeader is false', () => {
    render(
      <Layout showHeader={false}>
        <div>Content</div>
      </Layout>
    )

    expect(screen.queryByText('dotdo')).not.toBeInTheDocument()
  })

  it('should hide footer when showFooter is false', () => {
    render(
      <Layout showFooter={false}>
        <div>Content</div>
      </Layout>
    )

    expect(screen.queryByText(/All rights reserved/)).not.toBeInTheDocument()
  })

  it('should render footer with current year', () => {
    render(
      <Layout>
        <div>Content</div>
      </Layout>
    )

    const currentYear = new Date().getFullYear().toString()
    expect(screen.getByText(new RegExp(currentYear))).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = render(
      <Layout className="custom-class">
        <div>Content</div>
      </Layout>
    )

    expect(container.firstChild).toHaveClass('custom-class')
  })
})

describe('PageLayout', () => {
  it('should render children', () => {
    render(
      <PageLayout>
        <div data-testid="child">Page content</div>
      </PageLayout>
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('should render title when provided', () => {
    render(
      <PageLayout title="Page Title">
        <div>Content</div>
      </PageLayout>
    )

    expect(screen.getByText('Page Title')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page Title')
  })

  it('should render subtitle when provided', () => {
    render(
      <PageLayout title="Title" subtitle="Subtitle text">
        <div>Content</div>
      </PageLayout>
    )

    expect(screen.getByText('Subtitle text')).toBeInTheDocument()
  })

  it('should not render title when not provided', () => {
    render(
      <PageLayout>
        <div>Content</div>
      </PageLayout>
    )

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('should apply maxWidth class', () => {
    const { container } = render(
      <PageLayout maxWidth="sm">
        <div>Content</div>
      </PageLayout>
    )

    const innerDiv = container.querySelector('.max-w-sm')
    expect(innerDiv).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = render(
      <PageLayout className="custom-page-class">
        <div>Content</div>
      </PageLayout>
    )

    const innerDiv = container.querySelector('.custom-page-class')
    expect(innerDiv).toBeInTheDocument()
  })
})
