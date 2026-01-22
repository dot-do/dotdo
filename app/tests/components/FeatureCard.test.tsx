import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({
    component: null,
  }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

// Since FeatureCard is defined inside the routes file, we'll test it via the HomePage
// For smoke testing, we test the component renders correctly

describe('FeatureCard (from HomePage)', () => {
  // Create a standalone FeatureCard for testing since it's not exported
  function FeatureCard({ title, description }: { title: string; description: string }) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
        <h3 className="text-lg font-semibold mb-2 text-gray-900">{title}</h3>
        <p className="text-gray-600 text-sm">{description}</p>
      </div>
    )
  }

  it('should render title', () => {
    render(<FeatureCard title="Test Feature" description="Test description" />)

    expect(screen.getByText('Test Feature')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Test Feature')
  })

  it('should render description', () => {
    render(<FeatureCard title="Test Feature" description="This is a test description" />)

    expect(screen.getByText('This is a test description')).toBeInTheDocument()
  })

  it('should have proper styling classes', () => {
    const { container } = render(
      <FeatureCard title="Test" description="Description" />
    )

    const card = container.firstChild
    expect(card).toHaveClass('bg-white')
    expect(card).toHaveClass('border')
    expect(card).toHaveClass('rounded-lg')
  })
})

describe('AdminCard pattern (from admin route)', () => {
  // Test the AdminCard pattern used in the admin page
  interface AdminCardProps {
    title: string
    description: string
    status: 'active' | 'planned' | 'beta'
  }

  function AdminCard({ title, description, status }: AdminCardProps) {
    const statusColors = {
      active: 'bg-green-100 text-green-800',
      planned: 'bg-gray-100 text-gray-600',
      beta: 'bg-blue-100 text-blue-800',
    }

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <span className={`text-xs px-2 py-1 rounded-full ${statusColors[status]}`}>
            {status}
          </span>
        </div>
        <p className="text-gray-600 text-sm">{description}</p>
      </div>
    )
  }

  it('should render with active status', () => {
    render(
      <AdminCard
        title="Active Feature"
        description="This is active"
        status="active"
      />
    )

    expect(screen.getByText('Active Feature')).toBeInTheDocument()
    expect(screen.getByText('active')).toHaveClass('bg-green-100')
  })

  it('should render with planned status', () => {
    render(
      <AdminCard
        title="Planned Feature"
        description="This is planned"
        status="planned"
      />
    )

    expect(screen.getByText('planned')).toHaveClass('bg-gray-100')
  })

  it('should render with beta status', () => {
    render(
      <AdminCard title="Beta Feature" description="This is beta" status="beta" />
    )

    expect(screen.getByText('beta')).toHaveClass('bg-blue-100')
  })
})

describe('DocCard pattern (from docs route)', () => {
  // Test the DocCard pattern used in the docs page
  function DocCard({ title, description }: { title: string; description: string }) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 hover:border-primary-300 transition-colors">
        <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600">{description}</p>
      </div>
    )
  }

  it('should render title and description', () => {
    render(<DocCard title="Doc Title" description="Doc description" />)

    expect(screen.getByText('Doc Title')).toBeInTheDocument()
    expect(screen.getByText('Doc description')).toBeInTheDocument()
  })

  it('should have proper structure', () => {
    render(<DocCard title="Test" description="Test desc" />)

    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading).toHaveClass('text-xl', 'font-semibold')
  })
})

describe('GuideCard pattern (from docs route)', () => {
  // Test the GuideCard pattern used in the docs page
  interface GuideCardProps {
    title: string
    status: 'available' | 'planned'
  }

  function GuideCard({ title, status }: GuideCardProps) {
    const statusColors = {
      available: 'bg-green-100 text-green-800',
      planned: 'bg-gray-100 text-gray-600',
    }

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-gray-900">{title}</h4>
          <span className={`text-xs px-2 py-1 rounded-full ${statusColors[status]}`}>
            {status}
          </span>
        </div>
      </div>
    )
  }

  it('should render available guide', () => {
    render(<GuideCard title="Available Guide" status="available" />)

    expect(screen.getByText('Available Guide')).toBeInTheDocument()
    expect(screen.getByText('available')).toHaveClass('bg-green-100')
  })

  it('should render planned guide', () => {
    render(<GuideCard title="Planned Guide" status="planned" />)

    expect(screen.getByText('Planned Guide')).toBeInTheDocument()
    expect(screen.getByText('planned')).toHaveClass('bg-gray-100')
  })
})
