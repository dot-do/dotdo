/**
 * Route Transition Tests
 *
 * TDD tests for route transition optimization including:
 * - Route prefetching strategies
 * - Transition animations
 * - Loading indicators
 * - Error boundaries at route level
 * - Performance metrics
 *
 * @see /app/components/ui/route-transition.tsx
 * @see /app/src/router.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import * as React from 'react'

// Mock TanStack Router hooks
const mockUseRouterState = vi.fn()
const mockUseRouter = vi.fn()
const mockRouter = {
  preloadRoute: vi.fn(),
  invalidate: vi.fn(),
  navigate: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  state: {
    isLoading: false,
    location: { pathname: '/' },
  },
}

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (options?: { select?: (s: any) => any }) => {
    const state = mockUseRouterState()
    return options?.select ? options.select(state) : state
  },
  useRouter: () => mockRouter,
}))

// Import components after mocking
import {
  RouteProgressBar,
  RoutePending,
  FadeTransition,
  RouteError,
  RouteNotFound,
  PrefetchLink,
  useReducedMotion,
  usePrefetchRoutes,
  RouteTransitionContainer,
  ViewportPrefetch,
} from '../components/ui/route-transition'

// =============================================================================
// RouteProgressBar Tests
// =============================================================================

describe('RouteProgressBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockUseRouterState.mockReturnValue({ isLoading: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('should not render when not loading', () => {
    mockUseRouterState.mockReturnValue({ isLoading: false })
    render(<RouteProgressBar />)

    expect(screen.queryByTestId('route-progress-bar')).not.toBeInTheDocument()
  })

  it('should render and animate when loading', async () => {
    mockUseRouterState.mockReturnValue({ isLoading: true })
    render(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    const progressBar = screen.getByTestId('route-progress-bar')
    expect(progressBar).toBeInTheDocument()
    expect(progressBar).toHaveAttribute('data-loading', 'true')
  })

  it('should have proper ARIA attributes for accessibility', async () => {
    mockUseRouterState.mockReturnValue({ isLoading: true })
    render(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    const progressBar = screen.getByTestId('route-progress-bar')
    expect(progressBar).toHaveAttribute('role', 'progressbar')
    expect(progressBar).toHaveAttribute('aria-valuemin', '0')
    expect(progressBar).toHaveAttribute('aria-valuemax', '100')
    expect(progressBar).toHaveAttribute('aria-label', 'Page loading')
  })

  it('should progress through stages', async () => {
    mockUseRouterState.mockReturnValue({ isLoading: true })
    render(<RouteProgressBar />)

    // Initial state
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    let progressBar = screen.getByTestId('route-progress-bar')
    expect(progressBar).toHaveAttribute('aria-valuenow', '0')

    // After 100ms - should be at 30%
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    progressBar = screen.getByTestId('route-progress-bar')
    expect(progressBar).toHaveAttribute('aria-valuenow', '30')

    // After 300ms - should be at 60%
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    progressBar = screen.getByTestId('route-progress-bar')
    expect(progressBar).toHaveAttribute('aria-valuenow', '60')

    // After 600ms - should be at 80%
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    progressBar = screen.getByTestId('route-progress-bar')
    expect(progressBar).toHaveAttribute('aria-valuenow', '80')
  })

  it('should complete to 100% when loading finishes', async () => {
    mockUseRouterState.mockReturnValue({ isLoading: true })
    const { rerender } = render(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    // Loading finishes
    mockUseRouterState.mockReturnValue({ isLoading: false })
    rerender(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    const progressBar = screen.getByTestId('route-progress-bar')
    expect(progressBar).toHaveAttribute('aria-valuenow', '100')
  })

  it('should hide after animation completes', async () => {
    mockUseRouterState.mockReturnValue({ isLoading: true })
    const { rerender } = render(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    // Loading finishes
    mockUseRouterState.mockReturnValue({ isLoading: false })
    rerender(<RouteProgressBar />)

    // Wait for hide animation
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(screen.queryByTestId('route-progress-bar')).not.toBeInTheDocument()
  })
})

// =============================================================================
// RoutePending Tests
// =============================================================================

describe('RoutePending', () => {
  it('should render loading spinner by default', () => {
    render(<RoutePending />)

    const pending = screen.getByTestId('route-pending')
    expect(pending).toBeInTheDocument()

    // Should have spinner (animated element)
    const spinner = pending.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('should show skeleton when showSkeleton is true', () => {
    render(<RoutePending showSkeleton />)

    const pending = screen.getByTestId('route-pending')

    // Should have skeleton elements with animate-pulse
    const skeleton = pending.querySelector('.animate-pulse')
    expect(skeleton).toBeInTheDocument()
  })

  it('should display custom message', () => {
    render(<RoutePending message="Loading dashboard..." />)

    expect(screen.getByText('Loading dashboard...')).toBeInTheDocument()
  })

  it('should have minimum height to prevent layout shift', () => {
    render(<RoutePending />)

    const pending = screen.getByTestId('route-pending')
    expect(pending).toHaveClass('min-h-[200px]')
  })
})

// =============================================================================
// FadeTransition Tests
// =============================================================================

describe('FadeTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render children', () => {
    render(
      <FadeTransition transitionKey="test">
        <div>Content</div>
      </FadeTransition>
    )

    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('should start visible', () => {
    render(
      <FadeTransition transitionKey="test">
        <div>Content</div>
      </FadeTransition>
    )

    const wrapper = screen.getByTestId('fade-transition')
    expect(wrapper).toHaveStyle({ opacity: '1' })
  })

  it('should fade out and back in when key changes', async () => {
    const { rerender } = render(
      <FadeTransition transitionKey="page-1" duration={200}>
        <div>Content</div>
      </FadeTransition>
    )

    // Change the key to trigger transition
    rerender(
      <FadeTransition transitionKey="page-2" duration={200}>
        <div>Content</div>
      </FadeTransition>
    )

    // Should fade out immediately
    const wrapper = screen.getByTestId('fade-transition')
    expect(wrapper).toHaveStyle({ opacity: '0' })

    // Wait for fade in
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    expect(wrapper).toHaveStyle({ opacity: '1' })
  })

  it('should respect custom duration', async () => {
    const { rerender } = render(
      <FadeTransition transitionKey="page-1" duration={400}>
        <div>Content</div>
      </FadeTransition>
    )

    rerender(
      <FadeTransition transitionKey="page-2" duration={400}>
        <div>Content</div>
      </FadeTransition>
    )

    const wrapper = screen.getByTestId('fade-transition')
    expect(wrapper).toHaveStyle({ transitionDuration: '200ms' }) // half of 400
  })
})

// =============================================================================
// RouteError Tests
// =============================================================================

describe('RouteError', () => {
  beforeEach(() => {
    mockRouter.invalidate.mockClear()
    mockRouter.navigate.mockClear()
  })

  it('should render error message', () => {
    const error = new Error('Failed to load data')
    render(<RouteError error={error} />)

    expect(screen.getByTestId('route-error')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Failed to load data')).toBeInTheDocument()
  })

  it('should have proper ARIA role for accessibility', () => {
    const error = new Error('Test error')
    render(<RouteError error={error} />)

    expect(screen.getByTestId('route-error')).toHaveAttribute('role', 'alert')
  })

  it('should show retry button that calls reset', () => {
    const error = new Error('Test error')
    const resetFn = vi.fn()
    render(<RouteError error={error} reset={resetFn} />)

    const retryButton = screen.getByTestId('route-error-retry')
    fireEvent.click(retryButton)

    expect(resetFn).toHaveBeenCalledOnce()
  })

  it('should invalidate router if no reset function provided', () => {
    const error = new Error('Test error')
    render(<RouteError error={error} />)

    const retryButton = screen.getByTestId('route-error-retry')
    fireEvent.click(retryButton)

    expect(mockRouter.invalidate).toHaveBeenCalledOnce()
  })

  it('should navigate home on go home button click', () => {
    const error = new Error('Test error')
    render(<RouteError error={error} />)

    const homeButton = screen.getByTestId('route-error-home')
    fireEvent.click(homeButton)

    expect(mockRouter.navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('should show default message for errors without message', () => {
    const error = new Error()
    render(<RouteError error={error} />)

    expect(
      screen.getByText('An unexpected error occurred while loading this page.')
    ).toBeInTheDocument()
  })
})

// =============================================================================
// RouteNotFound Tests
// =============================================================================

describe('RouteNotFound', () => {
  beforeEach(() => {
    mockRouter.navigate.mockClear()
  })

  it('should render 404 page', () => {
    render(<RouteNotFound />)

    expect(screen.getByTestId('route-not-found')).toBeInTheDocument()
    expect(screen.getByText('404')).toBeInTheDocument()
    expect(screen.getByText('Page Not Found')).toBeInTheDocument()
  })

  it('should show custom message when provided', () => {
    render(<RouteNotFound message="Custom not found message" />)

    expect(screen.getByText('Custom not found message')).toBeInTheDocument()
  })

  it('should show default message when no custom message', () => {
    render(<RouteNotFound />)

    expect(
      screen.getByText("The page you're looking for doesn't exist or has been moved.")
    ).toBeInTheDocument()
  })

  it('should navigate home on button click', () => {
    render(<RouteNotFound />)

    const homeButton = screen.getByTestId('not-found-home')
    fireEvent.click(homeButton)

    expect(mockRouter.navigate).toHaveBeenCalledWith({ to: '/' })
  })
})

// =============================================================================
// PrefetchLink Tests
// =============================================================================

describe('PrefetchLink', () => {
  beforeEach(() => {
    mockRouter.preloadRoute.mockClear()
  })

  it('should render children', () => {
    render(
      <PrefetchLink to="/dashboard">
        <span>Dashboard Link</span>
      </PrefetchLink>
    )

    expect(screen.getByText('Dashboard Link')).toBeInTheDocument()
  })

  it('should not prefetch by default', () => {
    render(
      <PrefetchLink to="/dashboard">
        <span>Link</span>
      </PrefetchLink>
    )

    expect(mockRouter.preloadRoute).not.toHaveBeenCalled()
  })

  it('should prefetch on render when prefetchOnRender is true', () => {
    render(
      <PrefetchLink to="/dashboard" prefetchOnRender>
        <span>Link</span>
      </PrefetchLink>
    )

    expect(mockRouter.preloadRoute).toHaveBeenCalledWith({ to: '/dashboard' })
  })

  it('should prefetch correct route', () => {
    render(
      <PrefetchLink to="/admin/settings" prefetchOnRender>
        <span>Settings</span>
      </PrefetchLink>
    )

    expect(mockRouter.preloadRoute).toHaveBeenCalledWith({ to: '/admin/settings' })
  })
})

// =============================================================================
// useReducedMotion Tests
// =============================================================================

describe('useReducedMotion', () => {
  let originalMatchMedia: typeof window.matchMedia

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('should return false when reduced motion is not preferred', () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    function TestComponent() {
      const prefersReducedMotion = useReducedMotion()
      return <div data-testid="result">{prefersReducedMotion ? 'true' : 'false'}</div>
    }

    render(<TestComponent />)
    expect(screen.getByTestId('result')).toHaveTextContent('false')
  })

  it('should return true when reduced motion is preferred', () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    function TestComponent() {
      const prefersReducedMotion = useReducedMotion()
      return <div data-testid="result">{prefersReducedMotion ? 'true' : 'false'}</div>
    }

    render(<TestComponent />)
    expect(screen.getByTestId('result')).toHaveTextContent('true')
  })

  it('should update when preference changes', async () => {
    let changeHandler: ((event: MediaQueryListEvent) => void) | null = null

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn((event, handler) => {
        if (event === 'change') {
          changeHandler = handler
        }
      }),
      removeEventListener: vi.fn(),
    }))

    function TestComponent() {
      const prefersReducedMotion = useReducedMotion()
      return <div data-testid="result">{prefersReducedMotion ? 'true' : 'false'}</div>
    }

    render(<TestComponent />)
    expect(screen.getByTestId('result')).toHaveTextContent('false')

    // Simulate preference change
    await act(async () => {
      if (changeHandler) {
        changeHandler({ matches: true } as MediaQueryListEvent)
      }
    })

    expect(screen.getByTestId('result')).toHaveTextContent('true')
  })
})

// =============================================================================
// usePrefetchRoutes Tests
// =============================================================================

describe('usePrefetchRoutes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockRouter.preloadRoute.mockClear()

    // Default: no reduced motion
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should prefetch multiple routes on mount', async () => {
    function TestComponent() {
      usePrefetchRoutes({
        routes: ['/dashboard', '/projects', '/settings'],
        staggerDelay: 50,
      })
      return <div>Test</div>
    }

    render(<TestComponent />)

    // Advance through all staggered delays
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(mockRouter.preloadRoute).toHaveBeenCalledWith({ to: '/dashboard' })
    expect(mockRouter.preloadRoute).toHaveBeenCalledWith({ to: '/projects' })
    expect(mockRouter.preloadRoute).toHaveBeenCalledWith({ to: '/settings' })
  })

  it('should respect prefetch priority order (stagger delays)', async () => {
    const callOrder: string[] = []
    mockRouter.preloadRoute.mockImplementation(({ to }: { to: string }) => {
      callOrder.push(to)
    })

    function TestComponent() {
      usePrefetchRoutes({
        routes: ['/first', '/second', '/third'],
        staggerDelay: 100,
      })
      return <div>Test</div>
    }

    render(<TestComponent />)

    // First route (no delay)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(callOrder).toContain('/first')

    // Second route (100ms delay)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(callOrder).toContain('/second')

    // Third route (200ms delay)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(callOrder).toContain('/third')
  })

  it('should skip already-loaded routes on re-render', async () => {
    function TestComponent({ routes }: { routes: string[] }) {
      usePrefetchRoutes({ routes, staggerDelay: 0 })
      return <div>Test</div>
    }

    const { rerender } = render(<TestComponent routes={['/dashboard']} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(mockRouter.preloadRoute).toHaveBeenCalledTimes(1)

    // Re-render with same route
    rerender(<TestComponent routes={['/dashboard']} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    // Should not call again
    expect(mockRouter.preloadRoute).toHaveBeenCalledTimes(1)
  })

  it('should handle prefetch failures gracefully', async () => {
    mockRouter.preloadRoute.mockImplementation(() => {
      throw new Error('Network error')
    })

    function TestComponent() {
      usePrefetchRoutes({
        routes: ['/dashboard'],
        staggerDelay: 0,
      })
      return <div>Test</div>
    }

    // Should not throw
    expect(() => render(<TestComponent />)).not.toThrow()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
  })

  it('should not prefetch when disabled', async () => {
    function TestComponent() {
      usePrefetchRoutes({
        routes: ['/dashboard'],
        enabled: false,
      })
      return <div>Test</div>
    }

    render(<TestComponent />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(mockRouter.preloadRoute).not.toHaveBeenCalled()
  })

  it('should call onComplete when all routes are prefetched', async () => {
    const onComplete = vi.fn()

    function TestComponent() {
      usePrefetchRoutes({
        routes: ['/a', '/b'],
        staggerDelay: 10,
        onComplete,
      })
      return <div>Test</div>
    }

    render(<TestComponent />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(onComplete).toHaveBeenCalledOnce()
  })
})

// =============================================================================
// RouteTransitionContainer Tests
// =============================================================================

describe('RouteTransitionContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockUseRouterState.mockReturnValue({
      isLoading: false,
      location: { pathname: '/test' },
    })
    mockRouter.preloadRoute.mockClear()

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render children', () => {
    render(
      <RouteTransitionContainer>
        <div data-testid="child">Content</div>
      </RouteTransitionContainer>
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('should render progress bar', () => {
    mockUseRouterState.mockReturnValue({
      isLoading: true,
      location: { pathname: '/test' },
    })

    render(
      <RouteTransitionContainer>
        <div>Content</div>
      </RouteTransitionContainer>
    )

    // Progress bar appears when loading
    expect(screen.getByTestId('route-transition-container')).toBeInTheDocument()
  })

  it('should prefetch routes when provided', async () => {
    render(
      <RouteTransitionContainer prefetchRoutes={['/dashboard', '/projects']}>
        <div>Content</div>
      </RouteTransitionContainer>
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(mockRouter.preloadRoute).toHaveBeenCalledWith({ to: '/dashboard' })
    expect(mockRouter.preloadRoute).toHaveBeenCalledWith({ to: '/projects' })
  })

  it('should disable transitions when reduced motion is preferred', () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: true, // prefers-reduced-motion: reduce
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    render(
      <RouteTransitionContainer enableTransitions>
        <div data-testid="child">Content</div>
      </RouteTransitionContainer>
    )

    // Should not wrap in FadeTransition when reduced motion is preferred
    const container = screen.getByTestId('route-transition-container')
    expect(container.querySelector('[data-testid="fade-transition"]')).not.toBeInTheDocument()
  })

  it('should enable transitions by default', () => {
    render(
      <RouteTransitionContainer>
        <div>Content</div>
      </RouteTransitionContainer>
    )

    const container = screen.getByTestId('route-transition-container')
    expect(container.querySelector('[data-testid="fade-transition"]')).toBeInTheDocument()
  })
})

// =============================================================================
// ViewportPrefetch Tests
// =============================================================================

describe('ViewportPrefetch', () => {
  let mockObserverInstance: {
    observe: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    callback: IntersectionObserverCallback | null
  }

  beforeEach(() => {
    mockRouter.preloadRoute.mockClear()

    mockObserverInstance = {
      observe: vi.fn(),
      disconnect: vi.fn(),
      callback: null,
    }

    // Mock IntersectionObserver
    global.IntersectionObserver = vi.fn((callback) => {
      mockObserverInstance.callback = callback
      return mockObserverInstance as unknown as IntersectionObserver
    }) as unknown as typeof IntersectionObserver
  })

  it('should render children', () => {
    render(
      <ViewportPrefetch to="/dashboard">
        <span>Link</span>
      </ViewportPrefetch>
    )

    expect(screen.getByText('Link')).toBeInTheDocument()
  })

  it('should observe element on mount', () => {
    render(
      <ViewportPrefetch to="/dashboard">
        <span>Link</span>
      </ViewportPrefetch>
    )

    expect(mockObserverInstance.observe).toHaveBeenCalled()
  })

  it('should prefetch when element enters viewport', () => {
    render(
      <ViewportPrefetch to="/dashboard">
        <span>Link</span>
      </ViewportPrefetch>
    )

    // Simulate intersection
    act(() => {
      mockObserverInstance.callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    })

    expect(mockRouter.preloadRoute).toHaveBeenCalledWith({ to: '/dashboard' })
  })

  it('should disconnect observer after prefetching', () => {
    render(
      <ViewportPrefetch to="/dashboard">
        <span>Link</span>
      </ViewportPrefetch>
    )

    act(() => {
      mockObserverInstance.callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    })

    expect(mockObserverInstance.disconnect).toHaveBeenCalled()
  })

  it('should not prefetch when not intersecting', () => {
    render(
      <ViewportPrefetch to="/dashboard">
        <span>Link</span>
      </ViewportPrefetch>
    )

    act(() => {
      mockObserverInstance.callback?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    })

    expect(mockRouter.preloadRoute).not.toHaveBeenCalled()
  })

  it('should only prefetch once', () => {
    render(
      <ViewportPrefetch to="/dashboard">
        <span>Link</span>
      </ViewportPrefetch>
    )

    // First intersection
    act(() => {
      mockObserverInstance.callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    })

    // Second intersection (should be ignored)
    act(() => {
      mockObserverInstance.callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    })

    expect(mockRouter.preloadRoute).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// Route Transition Performance Tests
// =============================================================================

describe('Route Transition Performance', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should complete transition within 300ms budget', async () => {
    const startTime = Date.now()

    mockUseRouterState.mockReturnValue({
      isLoading: true,
      location: { pathname: '/' },
    })

    const { rerender } = render(<RouteProgressBar />)

    // Wait for loading to complete
    mockUseRouterState.mockReturnValue({
      isLoading: false,
      location: { pathname: '/new' },
    })
    rerender(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    // Progress bar should be hidden by now
    expect(screen.queryByTestId('route-progress-bar')).not.toBeInTheDocument()
  })

  it('should not cause layout shift during transitions', () => {
    render(<RoutePending />)

    const pending = screen.getByTestId('route-pending')
    // Should have min-height to prevent layout shift
    expect(pending).toHaveClass('min-h-[200px]')
  })

  it('should respect reduced motion preferences', () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    mockUseRouterState.mockReturnValue({
      isLoading: false,
      location: { pathname: '/test' },
    })

    render(
      <RouteTransitionContainer enableTransitions>
        <div>Content</div>
      </RouteTransitionContainer>
    )

    // Should skip FadeTransition when reduced motion is preferred
    const container = screen.getByTestId('route-transition-container')
    expect(container.querySelector('[data-testid="fade-transition"]')).not.toBeInTheDocument()
  })

  it('should batch multiple prefetch requests with stagger', async () => {
    mockRouter.preloadRoute.mockClear()

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    function TestComponent() {
      usePrefetchRoutes({
        routes: ['/a', '/b', '/c'],
        staggerDelay: 50,
      })
      return <div>Test</div>
    }

    render(<TestComponent />)

    // At t=0, only first should be called
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(mockRouter.preloadRoute).toHaveBeenCalledTimes(1)

    // At t=60, second should be called
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })
    expect(mockRouter.preloadRoute).toHaveBeenCalledTimes(2)

    // At t=120, third should be called
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })
    expect(mockRouter.preloadRoute).toHaveBeenCalledTimes(3)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Route Transition Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should show progress bar during slow navigation', async () => {
    mockUseRouterState.mockReturnValue({
      isLoading: true,
      location: { pathname: '/' },
    })

    render(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(screen.getByTestId('route-progress-bar')).toBeInTheDocument()
    expect(screen.getByTestId('route-progress-bar')).toHaveAttribute('data-loading', 'true')
  })

  it('should show skeleton loading for route loaders', () => {
    render(<RoutePending showSkeleton />)

    const pending = screen.getByTestId('route-pending')
    const skeleton = pending.querySelector('.animate-pulse')
    expect(skeleton).toBeInTheDocument()
  })

  it('should handle rapid navigation without flicker', async () => {
    mockUseRouterState.mockReturnValue({
      isLoading: true,
      location: { pathname: '/page1' },
    })

    const { rerender } = render(<RouteProgressBar />)

    // Quick navigation before animation completes
    mockUseRouterState.mockReturnValue({
      isLoading: true,
      location: { pathname: '/page2' },
    })
    rerender(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    // Should still show progress bar without reset
    expect(screen.getByTestId('route-progress-bar')).toBeInTheDocument()
  })
})
