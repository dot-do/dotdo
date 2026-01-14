/**
 * Dashboard Error Boundary Tests
 *
 * Comprehensive tests for the dashboard-specific error boundary that provides:
 * - Section-level error isolation
 * - Graceful degradation with retry capability
 * - Compact and full error display modes
 * - Error logging and reporting hooks
 * - HOC wrapper for easy integration
 *
 * @see app/components/cockpit/dashboard-error-boundary.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  DashboardErrorBoundary,
  DashboardErrorFallback,
  withDashboardErrorBoundary,
} from '../dashboard-error-boundary'

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Component that throws an error for testing
 */
function ThrowingComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error from dashboard section')
  }
  return <div data-testid="child-content">Section rendered successfully</div>
}

/**
 * Component that throws on specific render count
 */
function ThrowsOnSecondRender() {
  const [count, setCount] = React.useState(0)

  if (count > 0) {
    throw new Error('Error on re-render')
  }

  return (
    <button data-testid="trigger-error" onClick={() => setCount((c) => c + 1)}>
      Click to trigger error
    </button>
  )
}

/**
 * Custom fallback component for testing
 */
function CustomDashboardFallback({
  error,
  resetErrorBoundary,
  sectionTitle,
  compact,
}: {
  error: Error
  resetErrorBoundary: () => void
  sectionTitle?: string
  compact?: boolean
}) {
  return (
    <div data-testid="custom-dashboard-fallback">
      <h2>Custom Dashboard Error</h2>
      <p data-testid="custom-error-message">{error.message}</p>
      <p data-testid="custom-section-title">{sectionTitle || 'Unknown Section'}</p>
      <p data-testid="custom-compact-mode">{compact ? 'compact' : 'full'}</p>
      <button onClick={resetErrorBoundary} data-testid="custom-retry-button">
        Custom Retry
      </button>
    </div>
  )
}

// Suppress console.error during tests to avoid noise from expected errors
const originalError = console.error
beforeEach(() => {
  console.error = vi.fn()
})

afterEach(() => {
  console.error = originalError
  vi.restoreAllMocks()
})

// =============================================================================
// DashboardErrorFallback Tests
// =============================================================================

describe('DashboardErrorFallback', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
  })

  describe('full mode (default)', () => {
    it('renders error message', () => {
      render(
        <DashboardErrorFallback
          error={new Error('Something went wrong')}
          resetErrorBoundary={vi.fn()}
        />
      )

      expect(screen.getByTestId('dashboard-error-fallback')).toBeInTheDocument()
      expect(screen.getByTestId('dashboard-error-message')).toHaveTextContent('Something went wrong')
    })

    it('renders section title when provided', () => {
      render(
        <DashboardErrorFallback
          error={new Error('Test error')}
          resetErrorBoundary={vi.fn()}
          sectionTitle="Analytics"
        />
      )

      expect(screen.getByText('Analytics Error')).toBeInTheDocument()
    })

    it('renders generic title when no section title', () => {
      render(
        <DashboardErrorFallback
          error={new Error('Test error')}
          resetErrorBoundary={vi.fn()}
        />
      )

      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })

    it('calls resetErrorBoundary when retry button clicked', async () => {
      const resetFn = vi.fn()
      render(
        <DashboardErrorFallback
          error={new Error('Test error')}
          resetErrorBoundary={resetFn}
        />
      )

      await user.click(screen.getByText('Try Again'))
      expect(resetFn).toHaveBeenCalledOnce()
    })

    it('renders with alert role for accessibility', () => {
      render(
        <DashboardErrorFallback
          error={new Error('Test error')}
          resetErrorBoundary={vi.fn()}
        />
      )

      expect(screen.getByTestId('dashboard-error-fallback')).toHaveAttribute('role', 'alert')
    })

    it('shows default message for empty error message', () => {
      render(
        <DashboardErrorFallback
          error={new Error('')}
          resetErrorBoundary={vi.fn()}
        />
      )

      expect(screen.getByTestId('dashboard-error-message')).toHaveTextContent('An unexpected error occurred')
    })
  })

  describe('compact mode', () => {
    it('renders compact fallback', () => {
      render(
        <DashboardErrorFallback
          error={new Error('Test error')}
          resetErrorBoundary={vi.fn()}
          compact
        />
      )

      expect(screen.getByTestId('dashboard-error-fallback-compact')).toBeInTheDocument()
    })

    it('shows section unavailable message', () => {
      render(
        <DashboardErrorFallback
          error={new Error('Test error')}
          resetErrorBoundary={vi.fn()}
          sectionTitle="Revenue"
          compact
        />
      )

      expect(screen.getByText('Revenue unavailable')).toBeInTheDocument()
    })

    it('shows generic unavailable message without section title', () => {
      render(
        <DashboardErrorFallback
          error={new Error('Test error')}
          resetErrorBoundary={vi.fn()}
          compact
        />
      )

      expect(screen.getByText('Section unavailable')).toBeInTheDocument()
    })

    it('has compact retry button', async () => {
      const resetFn = vi.fn()
      render(
        <DashboardErrorFallback
          error={new Error('Test error')}
          resetErrorBoundary={resetFn}
          compact
        />
      )

      await user.click(screen.getByText('Retry'))
      expect(resetFn).toHaveBeenCalledOnce()
    })
  })
})

// =============================================================================
// DashboardErrorBoundary Tests
// =============================================================================

describe('DashboardErrorBoundary', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
  })

  describe('error catching', () => {
    it('catches errors thrown by child components', () => {
      render(
        <DashboardErrorBoundary>
          <ThrowingComponent />
        </DashboardErrorBoundary>
      )

      expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
      expect(screen.getByTestId('dashboard-error-fallback')).toBeInTheDocument()
    })

    it('renders children when no error', () => {
      render(
        <DashboardErrorBoundary>
          <ThrowingComponent shouldThrow={false} />
        </DashboardErrorBoundary>
      )

      expect(screen.getByTestId('child-content')).toBeInTheDocument()
      expect(screen.queryByTestId('dashboard-error-fallback')).not.toBeInTheDocument()
    })

    it('catches errors thrown during re-renders', async () => {
      render(
        <DashboardErrorBoundary>
          <ThrowsOnSecondRender />
        </DashboardErrorBoundary>
      )

      expect(screen.getByTestId('trigger-error')).toBeInTheDocument()

      await user.click(screen.getByTestId('trigger-error'))

      expect(screen.queryByTestId('trigger-error')).not.toBeInTheDocument()
      expect(screen.getByTestId('dashboard-error-fallback')).toBeInTheDocument()
    })
  })

  describe('error recovery', () => {
    it('resets error state when retry button is clicked', async () => {
      let shouldThrow = true

      function ConditionalThrow() {
        if (shouldThrow) {
          throw new Error('Conditional error')
        }
        return <div data-testid="recovered-content">Recovered!</div>
      }

      render(
        <DashboardErrorBoundary>
          <ConditionalThrow />
        </DashboardErrorBoundary>
      )

      // Error state
      expect(screen.getByTestId('dashboard-error-fallback')).toBeInTheDocument()

      // Fix the condition before retry
      shouldThrow = false

      // Click retry
      await user.click(screen.getByText('Try Again'))

      // Should recover
      expect(screen.getByTestId('recovered-content')).toBeInTheDocument()
      expect(screen.queryByTestId('dashboard-error-fallback')).not.toBeInTheDocument()
    })

    it('calls onReset callback when boundary is reset', async () => {
      let shouldThrow = true
      const onReset = vi.fn()

      function ConditionalThrow() {
        if (shouldThrow) {
          throw new Error('Test error')
        }
        return <div>Content</div>
      }

      render(
        <DashboardErrorBoundary onReset={onReset}>
          <ConditionalThrow />
        </DashboardErrorBoundary>
      )

      shouldThrow = false
      await user.click(screen.getByText('Try Again'))

      expect(onReset).toHaveBeenCalledOnce()
    })
  })

  describe('callbacks', () => {
    it('calls onError when error is caught', () => {
      const onError = vi.fn()

      render(
        <DashboardErrorBoundary onError={onError}>
          <ThrowingComponent />
        </DashboardErrorBoundary>
      )

      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          componentStack: expect.any(String),
        })
      )
    })

    it('passes section title to error callback context', () => {
      const onError = vi.fn()

      render(
        <DashboardErrorBoundary sectionTitle="Revenue Chart" onError={onError}>
          <ThrowingComponent />
        </DashboardErrorBoundary>
      )

      expect(onError).toHaveBeenCalled()
    })
  })

  describe('section title', () => {
    it('passes section title to fallback', () => {
      render(
        <DashboardErrorBoundary sectionTitle="User Analytics">
          <ThrowingComponent />
        </DashboardErrorBoundary>
      )

      expect(screen.getByText('User Analytics Error')).toBeInTheDocument()
    })
  })

  describe('compact mode', () => {
    it('renders compact fallback when compact prop is true', () => {
      render(
        <DashboardErrorBoundary compact>
          <ThrowingComponent />
        </DashboardErrorBoundary>
      )

      expect(screen.getByTestId('dashboard-error-fallback-compact')).toBeInTheDocument()
      expect(screen.queryByTestId('dashboard-error-fallback')).not.toBeInTheDocument()
    })
  })

  describe('custom fallback', () => {
    it('renders custom fallback component when provided', () => {
      render(
        <DashboardErrorBoundary fallback={CustomDashboardFallback} sectionTitle="Custom Section">
          <ThrowingComponent />
        </DashboardErrorBoundary>
      )

      expect(screen.getByTestId('custom-dashboard-fallback')).toBeInTheDocument()
      expect(screen.getByTestId('custom-error-message')).toHaveTextContent('Test error from dashboard section')
      expect(screen.getByTestId('custom-section-title')).toHaveTextContent('Custom Section')
    })

    it('custom fallback receives compact prop', () => {
      render(
        <DashboardErrorBoundary fallback={CustomDashboardFallback} compact>
          <ThrowingComponent />
        </DashboardErrorBoundary>
      )

      expect(screen.getByTestId('custom-compact-mode')).toHaveTextContent('compact')
    })

    it('custom fallback reset works', async () => {
      let shouldThrow = true

      function ConditionalThrow() {
        if (shouldThrow) {
          throw new Error('Custom error')
        }
        return <div data-testid="recovered">Recovered</div>
      }

      render(
        <DashboardErrorBoundary fallback={CustomDashboardFallback}>
          <ConditionalThrow />
        </DashboardErrorBoundary>
      )

      shouldThrow = false
      await user.click(screen.getByTestId('custom-retry-button'))

      expect(screen.getByTestId('recovered')).toBeInTheDocument()
    })
  })

  describe('resetKeys', () => {
    it('resets error state when resetKeys change', async () => {
      let shouldThrow = true
      let resetKey = 'initial'

      function ConditionalThrow() {
        if (shouldThrow) {
          throw new Error('Reset key error')
        }
        return <div data-testid="content">Content</div>
      }

      const { rerender } = render(
        <DashboardErrorBoundary resetKeys={[resetKey]}>
          <ConditionalThrow />
        </DashboardErrorBoundary>
      )

      // Error state
      expect(screen.getByTestId('dashboard-error-fallback')).toBeInTheDocument()

      // Fix condition and change resetKey
      shouldThrow = false
      resetKey = 'changed'

      rerender(
        <DashboardErrorBoundary resetKeys={[resetKey]}>
          <ConditionalThrow />
        </DashboardErrorBoundary>
      )

      // Should auto-recover due to resetKey change
      expect(screen.getByTestId('content')).toBeInTheDocument()
    })

    it('does not reset when resetKeys are the same', async () => {
      let shouldThrow = true
      const resetKey = 'same'

      function ConditionalThrow() {
        if (shouldThrow) {
          throw new Error('Reset key error')
        }
        return <div data-testid="content">Content</div>
      }

      const { rerender } = render(
        <DashboardErrorBoundary resetKeys={[resetKey]}>
          <ConditionalThrow />
        </DashboardErrorBoundary>
      )

      // Error state
      expect(screen.getByTestId('dashboard-error-fallback')).toBeInTheDocument()

      // Fix condition but keep same resetKey
      shouldThrow = false

      rerender(
        <DashboardErrorBoundary resetKeys={[resetKey]}>
          <ConditionalThrow />
        </DashboardErrorBoundary>
      )

      // Should still show error (no auto-recovery)
      expect(screen.getByTestId('dashboard-error-fallback')).toBeInTheDocument()
    })
  })
})

// =============================================================================
// withDashboardErrorBoundary HOC Tests
// =============================================================================

describe('withDashboardErrorBoundary', () => {
  it('wraps component with error boundary', () => {
    function FailingWidget() {
      throw new Error('Widget error')
    }

    const SafeWidget = withDashboardErrorBoundary(FailingWidget)

    render(<SafeWidget />)

    expect(screen.getByTestId('dashboard-error-fallback')).toBeInTheDocument()
  })

  it('renders wrapped component when no error', () => {
    function WorkingWidget() {
      return <div data-testid="widget">Widget content</div>
    }

    const SafeWidget = withDashboardErrorBoundary(WorkingWidget)

    render(<SafeWidget />)

    expect(screen.getByTestId('widget')).toBeInTheDocument()
  })

  it('passes props to wrapped component', () => {
    function PropsWidget({ message }: { message: string }) {
      return <div data-testid="widget">{message}</div>
    }

    const SafeWidget = withDashboardErrorBoundary(PropsWidget)

    render(<SafeWidget message="Hello World" />)

    expect(screen.getByTestId('widget')).toHaveTextContent('Hello World')
  })

  it('applies boundary props from HOC config', () => {
    function FailingWidget() {
      throw new Error('Widget error')
    }

    const SafeWidget = withDashboardErrorBoundary(FailingWidget, {
      sectionTitle: 'Important Widget',
      compact: true,
    })

    render(<SafeWidget />)

    expect(screen.getByTestId('dashboard-error-fallback-compact')).toBeInTheDocument()
    expect(screen.getByText('Important Widget unavailable')).toBeInTheDocument()
  })

  it('sets displayName on wrapped component', () => {
    function MyWidget() {
      return <div>Content</div>
    }
    MyWidget.displayName = 'MyWidget'

    const SafeWidget = withDashboardErrorBoundary(MyWidget)

    expect(SafeWidget.displayName).toBe('withDashboardErrorBoundary(MyWidget)')
  })

  it('uses function name when displayName not set', () => {
    function AnotherWidget() {
      return <div>Content</div>
    }

    const SafeWidget = withDashboardErrorBoundary(AnotherWidget)

    expect(SafeWidget.displayName).toBe('withDashboardErrorBoundary(AnotherWidget)')
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('DashboardErrorBoundary integration', () => {
  it('isolates errors to individual sections', () => {
    function FailingSection() {
      throw new Error('Section 1 failed')
    }

    function WorkingSection() {
      return <div data-testid="working-section">This section works</div>
    }

    render(
      <div>
        <DashboardErrorBoundary sectionTitle="Failing Section">
          <FailingSection />
        </DashboardErrorBoundary>
        <DashboardErrorBoundary sectionTitle="Working Section">
          <WorkingSection />
        </DashboardErrorBoundary>
      </div>
    )

    // First section shows error
    expect(screen.getByText('Failing Section Error')).toBeInTheDocument()

    // Second section still works
    expect(screen.getByTestId('working-section')).toBeInTheDocument()
  })

  it('multiple boundaries can recover independently', async () => {
    const user = userEvent.setup()
    let section1Throw = true
    let section2Throw = true

    function Section1() {
      if (section1Throw) throw new Error('Section 1 error')
      return <div data-testid="section-1">Section 1 OK</div>
    }

    function Section2() {
      if (section2Throw) throw new Error('Section 2 error')
      return <div data-testid="section-2">Section 2 OK</div>
    }

    render(
      <div>
        <DashboardErrorBoundary sectionTitle="Section 1">
          <Section1 />
        </DashboardErrorBoundary>
        <DashboardErrorBoundary sectionTitle="Section 2">
          <Section2 />
        </DashboardErrorBoundary>
      </div>
    )

    // Both show errors
    expect(screen.getByText('Section 1 Error')).toBeInTheDocument()
    expect(screen.getByText('Section 2 Error')).toBeInTheDocument()

    // Recover section 1 only
    section1Throw = false
    const retryButtons = screen.getAllByText('Try Again')
    await user.click(retryButtons[0])

    // Section 1 recovered, Section 2 still in error
    expect(screen.getByTestId('section-1')).toBeInTheDocument()
    expect(screen.getByText('Section 2 Error')).toBeInTheDocument()
  })
})
