/**
 * ErrorBoundary Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the ErrorBoundary component.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The ErrorBoundary component provides:
 * - Catches JavaScript errors in child component tree
 * - Renders fallback UI when an error occurs
 * - Supports custom fallback components
 * - Provides error recovery/retry mechanism
 * - Logs errors appropriately via onError callback
 * - Integrates with Shell in __root.tsx for app-wide error handling
 *
 * @see app/components/ui/error-boundary.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ErrorBoundary, ErrorBoundaryFallback } from '../error-boundary'

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Component that throws an error for testing
 */
function ThrowingComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error from child component')
  }
  return <div data-testid="child-content">Child rendered successfully</div>
}

/**
 * Component that throws async error
 */
function AsyncThrowingComponent() {
  React.useEffect(() => {
    throw new Error('Async error in useEffect')
  }, [])
  return <div>Should not render</div>
}

/**
 * Custom fallback component for testing
 */
function CustomFallback({
  error,
  resetErrorBoundary,
}: {
  error: Error
  resetErrorBoundary: () => void
}) {
  return (
    <div data-testid="custom-fallback">
      <h2>Custom Error UI</h2>
      <p data-testid="error-message">{error.message}</p>
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
// Test Suite
// =============================================================================

describe('ErrorBoundary', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
  })

  // ===========================================================================
  // Error Catching Tests
  // ===========================================================================

  describe('error catching', () => {
    it('catches errors thrown by child components', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      // The throwing child should not render
      expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()

      // ErrorBoundary should catch the error and render fallback
      expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()
    })

    it('catches errors thrown during render', () => {
      const ErrorDuringRender = () => {
        throw new Error('Error during render phase')
      }

      render(
        <ErrorBoundary>
          <ErrorDuringRender />
        </ErrorBoundary>
      )

      expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()
    })

    it('catches errors thrown in componentDidMount lifecycle', () => {
      class ThrowsOnMount extends React.Component {
        componentDidMount() {
          throw new Error('Error in componentDidMount')
        }
        render() {
          return <div>Should not stay rendered</div>
        }
      }

      render(
        <ErrorBoundary>
          <ThrowsOnMount />
        </ErrorBoundary>
      )

      expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()
    })

    it('catches errors thrown in componentDidUpdate lifecycle', async () => {
      let shouldThrow = false

      class ThrowsOnUpdate extends React.Component<{ trigger: boolean }> {
        componentDidUpdate() {
          if (shouldThrow) {
            throw new Error('Error in componentDidUpdate')
          }
        }
        render() {
          return <div data-testid="update-component">Content: {String(this.props.trigger)}</div>
        }
      }

      const { rerender } = render(
        <ErrorBoundary>
          <ThrowsOnUpdate trigger={false} />
        </ErrorBoundary>
      )

      expect(screen.getByTestId('update-component')).toBeInTheDocument()

      // Trigger an update that will throw
      shouldThrow = true
      rerender(
        <ErrorBoundary>
          <ThrowsOnUpdate trigger={true} />
        </ErrorBoundary>
      )

      expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()
    })

    it('renders children normally when no error occurs', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={false} />
        </ErrorBoundary>
      )

      expect(screen.getByTestId('child-content')).toBeInTheDocument()
      expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument()
    })

    it('does not catch errors from event handlers', async () => {
      const onError = vi.fn()
      let thrownError: Error | null = null

      // Temporarily catch uncaught errors to prevent test noise
      const uncaughtHandler = (event: ErrorEvent) => {
        if (event.error?.message === 'Error from event handler') {
          event.preventDefault()
        }
      }
      window.addEventListener('error', uncaughtHandler)

      const eventHandler = () => {
        thrownError = new Error('Error from event handler')
        throw thrownError
      }

      render(
        <ErrorBoundary onError={onError}>
          <button onClick={eventHandler}>Click Me</button>
        </ErrorBoundary>
      )

      // Event handler errors are not caught by ErrorBoundary
      // They need to be handled separately (try/catch in the handler)
      // This test documents that expected behavior
      try {
        await user.click(screen.getByRole('button', { name: 'Click Me' }))
      } catch {
        // Error propagates - this is expected behavior
      }

      window.removeEventListener('error', uncaughtHandler)

      // Verify the error was thrown
      expect(thrownError).toBeInstanceOf(Error)
      expect(thrownError?.message).toBe('Error from event handler')

      // ErrorBoundary's onError should NOT be called for event handler errors
      expect(onError).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Fallback UI Tests
  // ===========================================================================

  describe('fallback UI rendering', () => {
    it('renders default fallback UI when error occurs', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      // Default fallback should show error indication
      expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })

    it('displays the error message in fallback', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      expect(screen.getByText('Test error from child component')).toBeInTheDocument()
    })

    it('renders custom fallback component when provided', () => {
      render(
        <ErrorBoundary fallback={CustomFallback}>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
      expect(screen.getByText('Custom Error UI')).toBeInTheDocument()
      expect(screen.getByTestId('error-message')).toHaveTextContent(
        'Test error from child component'
      )
    })

    it('passes error and resetErrorBoundary to custom fallback', () => {
      render(
        <ErrorBoundary fallback={CustomFallback}>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      // Custom fallback should have access to error
      expect(screen.getByTestId('error-message')).toHaveTextContent(
        'Test error from child component'
      )

      // Custom fallback should have access to resetErrorBoundary
      expect(screen.getByTestId('custom-retry-button')).toBeInTheDocument()
    })

    it('renders fallback render prop when provided as function', () => {
      render(
        <ErrorBoundary
          fallbackRender={({ error, resetErrorBoundary }) => (
            <div data-testid="render-prop-fallback">
              <span>Error: {error.message}</span>
              <button onClick={resetErrorBoundary}>Reset</button>
            </div>
          )}
        >
          <ThrowingComponent />
        </ErrorBoundary>
      )

      expect(screen.getByTestId('render-prop-fallback')).toBeInTheDocument()
      expect(screen.getByText(/Error: Test error from child component/)).toBeInTheDocument()
    })

    it('renders inline fallback element when FallbackComponent not specified', () => {
      render(
        <ErrorBoundary fallbackUI={<div data-testid="inline-fallback">Inline Error UI</div>}>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      expect(screen.getByTestId('inline-fallback')).toBeInTheDocument()
      expect(screen.getByText('Inline Error UI')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Error Recovery/Retry Tests
  // ===========================================================================

  describe('error recovery and retry', () => {
    it('provides retry button in default fallback', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
    })

    it('resets error state when retry button is clicked', async () => {
      let shouldThrow = true

      function ToggleableThrow() {
        if (shouldThrow) {
          throw new Error('Toggleable error')
        }
        return <div data-testid="recovered-content">Recovered!</div>
      }

      render(
        <ErrorBoundary>
          <ToggleableThrow />
        </ErrorBoundary>
      )

      // Initially errored
      expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()

      // Fix the error condition
      shouldThrow = false

      // Click retry
      await user.click(screen.getByRole('button', { name: /try again|retry/i }))

      // Should now render the recovered content
      await waitFor(() => {
        expect(screen.getByTestId('recovered-content')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument()
    })

    it('calls onReset callback when reset is triggered', async () => {
      const onReset = vi.fn()
      let shouldThrow = true

      function ToggleableThrow() {
        if (shouldThrow) {
          throw new Error('Error')
        }
        return <div>OK</div>
      }

      render(
        <ErrorBoundary onReset={onReset}>
          <ToggleableThrow />
        </ErrorBoundary>
      )

      shouldThrow = false

      await user.click(screen.getByRole('button', { name: /try again|retry/i }))

      expect(onReset).toHaveBeenCalledTimes(1)
    })

    it('resets error boundary when resetKeys change', async () => {
      let shouldThrow = true

      function ToggleableThrow() {
        if (shouldThrow) {
          throw new Error('Error')
        }
        return <div data-testid="content">Content</div>
      }

      const { rerender } = render(
        <ErrorBoundary resetKeys={['key1']}>
          <ToggleableThrow />
        </ErrorBoundary>
      )

      expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()

      // Fix error and change resetKey
      shouldThrow = false

      rerender(
        <ErrorBoundary resetKeys={['key2']}>
          <ToggleableThrow />
        </ErrorBoundary>
      )

      await waitFor(() => {
        expect(screen.getByTestId('content')).toBeInTheDocument()
      })
    })

    it('custom fallback can trigger reset via resetErrorBoundary prop', async () => {
      let shouldThrow = true

      function ToggleableThrow() {
        if (shouldThrow) {
          throw new Error('Error')
        }
        return <div data-testid="content">Content</div>
      }

      render(
        <ErrorBoundary fallback={CustomFallback}>
          <ToggleableThrow />
        </ErrorBoundary>
      )

      expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()

      shouldThrow = false

      await user.click(screen.getByTestId('custom-retry-button'))

      await waitFor(() => {
        expect(screen.getByTestId('content')).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Error Logging Tests
  // ===========================================================================

  describe('error logging', () => {
    it('calls onError callback when error is caught', () => {
      const onError = vi.fn()

      render(
        <ErrorBoundary onError={onError}>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          componentStack: expect.any(String),
        })
      )
    })

    it('passes error object with correct message to onError', () => {
      const onError = vi.fn()

      render(
        <ErrorBoundary onError={onError}>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      const [error] = onError.mock.calls[0]
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Test error from child component')
    })

    it('passes component stack to onError callback', () => {
      const onError = vi.fn()

      render(
        <ErrorBoundary onError={onError}>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      const [, errorInfo] = onError.mock.calls[0]
      expect(errorInfo).toHaveProperty('componentStack')
      expect(typeof errorInfo.componentStack).toBe('string')
      expect(errorInfo.componentStack).toContain('ThrowingComponent')
    })

    it('logs error to console in development mode', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error')

      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      // React's error boundary will log to console
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('does not call onError when no error occurs', () => {
      const onError = vi.fn()

      render(
        <ErrorBoundary onError={onError}>
          <ThrowingComponent shouldThrow={false} />
        </ErrorBoundary>
      )

      expect(onError).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Data Slot Attribute Tests
  // ===========================================================================

  describe('data-slot attributes', () => {
    it('applies data-slot="error-boundary" to wrapper', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={false} />
        </ErrorBoundary>
      )

      const wrapper = document.querySelector('[data-slot="error-boundary"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('applies data-slot="error-boundary-fallback" to default fallback', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      const fallback = document.querySelector('[data-slot="error-boundary-fallback"]')
      expect(fallback).toBeInTheDocument()
    })

    it('applies data-slot="error-boundary-message" to error message', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      const message = document.querySelector('[data-slot="error-boundary-message"]')
      expect(message).toBeInTheDocument()
    })

    it('applies data-slot="error-boundary-retry" to retry button', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      const retryButton = document.querySelector('[data-slot="error-boundary-retry"]')
      expect(retryButton).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('fallback has role="alert" for screen readers', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('retry button is keyboard accessible', async () => {
      let shouldThrow = true

      function ToggleableThrow() {
        if (shouldThrow) throw new Error('Error')
        return <div data-testid="content">OK</div>
      }

      render(
        <ErrorBoundary>
          <ToggleableThrow />
        </ErrorBoundary>
      )

      const retryButton = screen.getByRole('button', { name: /try again|retry/i })

      // Should be focusable
      retryButton.focus()
      expect(document.activeElement).toBe(retryButton)

      // Should respond to Enter key
      shouldThrow = false
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByTestId('content')).toBeInTheDocument()
      })
    })

    it('error message is announced to screen readers', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      // The error message should be within an alert role for announcement
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('Test error from child component')
    })
  })

  // ===========================================================================
  // Nested ErrorBoundary Tests
  // ===========================================================================

  describe('nested error boundaries', () => {
    it('inner boundary catches errors first', () => {
      const outerOnError = vi.fn()
      const innerOnError = vi.fn()

      render(
        <ErrorBoundary onError={outerOnError}>
          <div>Outer content</div>
          <ErrorBoundary onError={innerOnError}>
            <ThrowingComponent />
          </ErrorBoundary>
        </ErrorBoundary>
      )

      // Inner boundary should catch the error
      expect(innerOnError).toHaveBeenCalledTimes(1)
      expect(outerOnError).not.toHaveBeenCalled()

      // Outer content should still render
      expect(screen.getByText('Outer content')).toBeInTheDocument()
    })

    it('outer boundary catches if inner has no fallback and re-throws', () => {
      // This tests propagation behavior if configured
      const outerOnError = vi.fn()

      // Note: Default behavior is to catch, but this documents behavior
      render(
        <ErrorBoundary onError={outerOnError}>
          <div>Outer</div>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      expect(outerOnError).toHaveBeenCalledTimes(1)
    })
  })
})

// =============================================================================
// ErrorBoundaryFallback Component Tests
// =============================================================================

describe('ErrorBoundaryFallback', () => {
  it('renders with error and reset function props', () => {
    const resetFn = vi.fn()
    const error = new Error('Test error message')

    render(<ErrorBoundaryFallback error={error} resetErrorBoundary={resetFn} />)

    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()
    expect(screen.getByText('Test error message')).toBeInTheDocument()
  })

  it('calls resetErrorBoundary when retry is clicked', async () => {
    const user = userEvent.setup()
    const resetFn = vi.fn()
    const error = new Error('Test error')

    render(<ErrorBoundaryFallback error={error} resetErrorBoundary={resetFn} />)

    await user.click(screen.getByRole('button', { name: /try again|retry/i }))

    expect(resetFn).toHaveBeenCalledTimes(1)
  })

  it('displays custom title when provided', () => {
    const error = new Error('Error')

    render(
      <ErrorBoundaryFallback
        error={error}
        resetErrorBoundary={() => {}}
        title="Custom Error Title"
      />
    )

    expect(screen.getByText('Custom Error Title')).toBeInTheDocument()
  })

  it('displays custom retry text when provided', () => {
    const error = new Error('Error')

    render(
      <ErrorBoundaryFallback
        error={error}
        resetErrorBoundary={() => {}}
        retryText="Reload Page"
      />
    )

    expect(screen.getByRole('button', { name: 'Reload Page' })).toBeInTheDocument()
  })

  it('integrates with ErrorState component styling pattern', () => {
    const error = new Error('Error')

    render(<ErrorBoundaryFallback error={error} resetErrorBoundary={() => {}} />)

    // Should follow ErrorState component patterns from shared.tsx
    const fallback = screen.getByTestId('error-boundary-fallback')
    expect(fallback).toHaveClass('text-center')
  })
})

// =============================================================================
// Shell Integration Tests (for __root.tsx)
// =============================================================================

describe('Shell integration with ErrorBoundary', () => {
  it('Shell should wrap content with ErrorBoundary', () => {
    // This test documents the requirement that Shell in __root.tsx
    // should wrap its content with ErrorBoundary
    // The implementation will need to modify __root.tsx

    // For now, test that we can compose ErrorBoundary with a Shell-like structure
    function MockShell({ children }: { children: React.ReactNode }) {
      return (
        <ErrorBoundary>
          <div data-testid="shell-content">{children}</div>
        </ErrorBoundary>
      )
    }

    render(
      <MockShell>
        <ThrowingComponent shouldThrow={false} />
      </MockShell>
    )

    expect(screen.getByTestId('shell-content')).toBeInTheDocument()
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('Shell ErrorBoundary catches errors from route content', () => {
    function MockShell({ children }: { children: React.ReactNode }) {
      return (
        <ErrorBoundary>
          <div data-testid="shell-wrapper">{children}</div>
        </ErrorBoundary>
      )
    }

    render(
      <MockShell>
        <ThrowingComponent />
      </MockShell>
    )

    // Error should be caught by Shell's ErrorBoundary
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('shell-wrapper')).not.toBeInTheDocument()
  })

  it('Shell ErrorBoundary allows recovery without full page reload', async () => {
    const user = userEvent.setup()
    let shouldThrow = true

    function MockRouteContent() {
      if (shouldThrow) {
        throw new Error('Route error')
      }
      return <div data-testid="route-content">Route loaded</div>
    }

    function MockShell({ children }: { children: React.ReactNode }) {
      return (
        <ErrorBoundary>
          <nav data-testid="shell-nav">Navigation</nav>
          <main>{children}</main>
        </ErrorBoundary>
      )
    }

    render(
      <MockShell>
        <MockRouteContent />
      </MockShell>
    )

    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()

    // Fix error and retry
    shouldThrow = false
    await user.click(screen.getByRole('button', { name: /try again|retry/i }))

    await waitFor(() => {
      expect(screen.getByTestId('route-content')).toBeInTheDocument()
    })
  })
})
