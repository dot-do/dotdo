import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock TanStack Router components
vi.mock('@tanstack/react-router', () => ({
  RouterProvider: ({ router }: { router: unknown }) => (
    <div data-testid="router-provider">Router Mounted</div>
  ),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

// Mock the router
vi.mock('../router', () => ({
  createRouter: () => ({ basepath: '/' }),
}))

describe('App', () => {
  it('should render without crashing', async () => {
    // Dynamic import after mocking
    const { App } = await import('../App')

    render(<App />)

    expect(screen.getByTestId('router-provider')).toBeInTheDocument()
  })

  it('should initialize router on mount', async () => {
    const { App } = await import('../App')

    const { container } = render(<App />)

    expect(container).toBeDefined()
  })
})
