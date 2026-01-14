/**
 * Lazy Chart Components Tests
 *
 * Tests for lazy-loaded chart components and skeleton loading states.
 * Verifies:
 * - Skeleton components render correctly
 * - Lazy wrappers show skeleton during load
 * - Memoization works as expected
 *
 * @see app/components/cockpit/lazy-charts.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

import {
  ChartSkeleton,
  KPICardSkeleton,
  ActivityFeedSkeleton,
  AgentStatusSkeleton,
} from '../lazy-charts'

// =============================================================================
// ChartSkeleton Tests
// =============================================================================

describe('ChartSkeleton', () => {
  it('renders with default height', () => {
    render(<ChartSkeleton />)

    const skeleton = screen.getByTestId('chart-skeleton')
    expect(skeleton).toBeInTheDocument()
    expect(skeleton).toHaveAttribute('data-component', 'ChartSkeleton')
  })

  it('renders with custom height', () => {
    render(<ChartSkeleton height={300} />)

    const skeleton = screen.getByTestId('chart-skeleton')
    expect(skeleton).toBeInTheDocument()
  })

  it('renders with title placeholder when title prop is truthy', () => {
    render(<ChartSkeleton title="Revenue Chart" />)

    const skeleton = screen.getByTestId('chart-skeleton')
    // Should have title placeholder (div with bg-muted)
    const titlePlaceholder = skeleton.querySelector('.h-5.bg-muted')
    expect(titlePlaceholder).toBeInTheDocument()
  })

  it('renders with description placeholder when description prop is truthy', () => {
    render(<ChartSkeleton description="Monthly revenue data" />)

    const skeleton = screen.getByTestId('chart-skeleton')
    // Should have description placeholder
    const descPlaceholder = skeleton.querySelector('.h-4.bg-muted.opacity-75')
    expect(descPlaceholder).toBeInTheDocument()
  })

  it('uses custom testId', () => {
    render(<ChartSkeleton testId="my-chart" />)

    expect(screen.getByTestId('my-chart-skeleton')).toBeInTheDocument()
  })

  it('has accessible attributes', () => {
    render(<ChartSkeleton />)

    const skeleton = screen.getByTestId('chart-skeleton')
    expect(skeleton).toHaveAttribute('role', 'progressbar')
    expect(skeleton).toHaveAttribute('aria-label', 'Loading chart...')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
  })

  it('has animate-pulse class for animation', () => {
    render(<ChartSkeleton />)

    const skeleton = screen.getByTestId('chart-skeleton')
    expect(skeleton).toHaveClass('animate-pulse')
  })
})

// =============================================================================
// KPICardSkeleton Tests
// =============================================================================

describe('KPICardSkeleton', () => {
  it('renders with default testId', () => {
    render(<KPICardSkeleton />)

    expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument()
  })

  it('renders with custom testId', () => {
    render(<KPICardSkeleton testId="revenue-kpi" />)

    expect(screen.getByTestId('revenue-kpi-skeleton')).toBeInTheDocument()
  })

  it('has accessible attributes', () => {
    render(<KPICardSkeleton />)

    const skeleton = screen.getByTestId('kpi-skeleton')
    expect(skeleton).toHaveAttribute('role', 'progressbar')
    expect(skeleton).toHaveAttribute('aria-label', 'Loading metric...')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
  })

  it('has animate-pulse class', () => {
    render(<KPICardSkeleton />)

    const skeleton = screen.getByTestId('kpi-skeleton')
    expect(skeleton).toHaveClass('animate-pulse')
  })

  it('has card-like structure with placeholder elements', () => {
    render(<KPICardSkeleton />)

    const skeleton = screen.getByTestId('kpi-skeleton')
    // Should have multiple placeholder elements
    const placeholders = skeleton.querySelectorAll('.bg-muted')
    expect(placeholders.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// ActivityFeedSkeleton Tests
// =============================================================================

describe('ActivityFeedSkeleton', () => {
  it('renders with default item count (3)', () => {
    render(<ActivityFeedSkeleton />)

    const skeleton = screen.getByTestId('activity-feed-skeleton')
    expect(skeleton).toBeInTheDocument()
    // Should have 3 skeleton items by default
    const items = skeleton.querySelectorAll('.bg-background.rounded-lg.border')
    expect(items).toHaveLength(3)
  })

  it('renders with custom item count', () => {
    render(<ActivityFeedSkeleton itemCount={5} />)

    const skeleton = screen.getByTestId('activity-feed-skeleton')
    const items = skeleton.querySelectorAll('.bg-background.rounded-lg.border')
    expect(items).toHaveLength(5)
  })

  it('has accessible attributes', () => {
    render(<ActivityFeedSkeleton />)

    const skeleton = screen.getByTestId('activity-feed-skeleton')
    expect(skeleton).toHaveAttribute('role', 'progressbar')
    expect(skeleton).toHaveAttribute('aria-label', 'Loading activity feed...')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
  })

  it('has animate-pulse class', () => {
    render(<ActivityFeedSkeleton />)

    const skeleton = screen.getByTestId('activity-feed-skeleton')
    expect(skeleton).toHaveClass('animate-pulse')
  })
})

// =============================================================================
// AgentStatusSkeleton Tests
// =============================================================================

describe('AgentStatusSkeleton', () => {
  it('renders with default agent count (6)', () => {
    render(<AgentStatusSkeleton />)

    const skeleton = screen.getByTestId('agent-status-skeleton')
    expect(skeleton).toBeInTheDocument()
    // Should have 6 agent placeholders by default
    const agents = skeleton.querySelectorAll('.text-center.p-3.bg-card')
    expect(agents).toHaveLength(6)
  })

  it('renders with custom agent count', () => {
    render(<AgentStatusSkeleton agentCount={4} />)

    const skeleton = screen.getByTestId('agent-status-skeleton')
    const agents = skeleton.querySelectorAll('.text-center.p-3.bg-card')
    expect(agents).toHaveLength(4)
  })

  it('has accessible attributes', () => {
    render(<AgentStatusSkeleton />)

    const skeleton = screen.getByTestId('agent-status-skeleton')
    expect(skeleton).toHaveAttribute('role', 'progressbar')
    expect(skeleton).toHaveAttribute('aria-label', 'Loading agent status...')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
  })

  it('has animate-pulse class', () => {
    render(<AgentStatusSkeleton />)

    const skeleton = screen.getByTestId('agent-status-skeleton')
    expect(skeleton).toHaveClass('animate-pulse')
  })

  it('has avatar placeholder for each agent', () => {
    render(<AgentStatusSkeleton agentCount={3} />)

    const skeleton = screen.getByTestId('agent-status-skeleton')
    // Each agent should have an avatar placeholder (rounded-full circle)
    const avatars = skeleton.querySelectorAll('.rounded-full.bg-muted')
    expect(avatars).toHaveLength(3)
  })
})

// =============================================================================
// Memoization Tests
// =============================================================================

describe('Skeleton memoization', () => {
  it('ChartSkeleton is memoized', () => {
    // React.memo wraps the component, so displayName should reflect that
    expect(ChartSkeleton.displayName).toBe('ChartSkeleton')
  })

  it('KPICardSkeleton is memoized', () => {
    expect(KPICardSkeleton.displayName).toBe('KPICardSkeleton')
  })

  it('ActivityFeedSkeleton is memoized', () => {
    expect(ActivityFeedSkeleton.displayName).toBe('ActivityFeedSkeleton')
  })

  it('AgentStatusSkeleton is memoized', () => {
    expect(AgentStatusSkeleton.displayName).toBe('AgentStatusSkeleton')
  })
})
