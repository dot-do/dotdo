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

// =============================================================================
// Nested Route Transition Tests
// =============================================================================

describe('Nested Route Transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockUseRouterState.mockReturnValue({
      isLoading: false,
      location: { pathname: '/app' },
    })
    mockRouter.preloadRoute.mockClear()
    mockRouter.navigate.mockClear()

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('should transition from parent to child route', async () => {
    mockUseRouterState.mockReturnValue({
      isLoading: false,
      location: { pathname: '/app' },
    })

    const { rerender } = render(
      <FadeTransition transitionKey="/app" duration={200}>
        <div>Parent Content</div>
      </FadeTransition>
    )

    // Navigate to child
    mockUseRouterState.mockReturnValue({
      isLoading: false,
      location: { pathname: '/app/projects' },
    })

    rerender(
      <FadeTransition transitionKey="/app/projects" duration={200}>
        <div>Child Content</div>
      </FadeTransition>
    )

    // Should fade out
    const wrapper = screen.getByTestId('fade-transition')
    expect(wrapper).toHaveStyle({ opacity: '0' })

    // Wait for fade in
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    expect(wrapper).toHaveStyle({ opacity: '1' })
  })

  it('should transition from child to sibling route', async () => {
    const { rerender } = render(
      <FadeTransition transitionKey="/app/projects" duration={200}>
        <div>Projects</div>
      </FadeTransition>
    )

    // Navigate to sibling
    rerender(
      <FadeTransition transitionKey="/app/settings" duration={200}>
        <div>Settings</div>
      </FadeTransition>
    )

    const wrapper = screen.getByTestId('fade-transition')
    expect(wrapper).toHaveStyle({ opacity: '0' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    expect(wrapper).toHaveStyle({ opacity: '1' })
  })

  it('should transition from deeply nested route to root', async () => {
    const { rerender } = render(
      <FadeTransition transitionKey="/app/projects/123/edit" duration={200}>
        <div>Edit Project</div>
      </FadeTransition>
    )

    // Navigate back to root
    rerender(
      <FadeTransition transitionKey="/app" duration={200}>
        <div>Dashboard</div>
      </FadeTransition>
    )

    const wrapper = screen.getByTestId('fade-transition')
    expect(wrapper).toHaveStyle({ opacity: '0' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    expect(wrapper).toHaveStyle({ opacity: '1' })
  })

  it('should not transition when navigating within same route (query params only)', async () => {
    const { rerender } = render(
      <FadeTransition transitionKey="/app/projects" duration={200}>
        <div>Projects</div>
      </FadeTransition>
    )

    // Same route (query params wouldn't change transitionKey in practice)
    rerender(
      <FadeTransition transitionKey="/app/projects" duration={200}>
        <div>Projects with different query</div>
      </FadeTransition>
    )

    // Should remain visible since key didn't change
    const wrapper = screen.getByTestId('fade-transition')
    expect(wrapper).toHaveStyle({ opacity: '1' })
  })

  it('should handle multiple rapid nested route changes', async () => {
    const { rerender } = render(
      <FadeTransition transitionKey="/app" duration={100}>
        <div>Content</div>
      </FadeTransition>
    )

    // Rapid navigation through nested routes
    const routes = ['/app/projects', '/app/projects/123', '/app/settings', '/app']

    for (const route of routes) {
      rerender(
        <FadeTransition transitionKey={route} duration={100}>
          <div>Content</div>
        </FadeTransition>
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
    }

    // Component should still be rendered without errors
    expect(screen.getByTestId('fade-transition')).toBeInTheDocument()
  })
})

// =============================================================================
// Error Boundary Edge Cases
// =============================================================================

describe('RouteError Edge Cases', () => {
  beforeEach(() => {
    mockRouter.invalidate.mockClear()
    mockRouter.navigate.mockClear()
  })

  it('should handle error with very long message', () => {
    const longMessage = 'E'.repeat(500)
    const error = new Error(longMessage)
    render(<RouteError error={error} />)

    expect(screen.getByText(longMessage)).toBeInTheDocument()
  })

  it('should handle error with special characters in message', () => {
    const error = new Error('<script>alert("xss")</script> & more')
    render(<RouteError error={error} />)

    // Should render as text, not HTML
    expect(screen.getByText('<script>alert("xss")</script> & more')).toBeInTheDocument()
  })

  it('should handle error with undefined message property', () => {
    const error = { name: 'CustomError' } as Error
    render(<RouteError error={error} />)

    expect(
      screen.getByText('An unexpected error occurred while loading this page.')
    ).toBeInTheDocument()
  })

  it('should call reset function when retry is clicked', () => {
    const error = new Error('Test error')
    const resetFn = vi.fn()

    render(<RouteError error={error} reset={resetFn} />)

    const retryButton = screen.getByTestId('route-error-retry')
    fireEvent.click(retryButton)

    expect(resetFn).toHaveBeenCalledTimes(1)
  })

  it('should call navigate with correct path when going home', () => {
    const error = new Error('Test')
    render(<RouteError error={error} />)

    fireEvent.click(screen.getByTestId('route-error-home'))

    expect(mockRouter.navigate).toHaveBeenCalledWith({ to: '/' })
    expect(mockRouter.navigate).toHaveBeenCalledTimes(1)
  })

  it('should render with network error message', () => {
    const error = new Error('Failed to fetch')
    render(<RouteError error={error} />)

    expect(screen.getByText('Failed to fetch')).toBeInTheDocument()
  })

  it('should render with timeout error', () => {
    const error = new Error('Request timeout')
    render(<RouteError error={error} />)

    expect(screen.getByText('Request timeout')).toBeInTheDocument()
  })
})

// =============================================================================
// Navigation Handling Tests
// =============================================================================

describe('Navigation Handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockRouter.preloadRoute.mockClear()
    mockRouter.navigate.mockClear()
    mockRouter.invalidate.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should handle back navigation (simulated by pathname change)', async () => {
    mockUseRouterState.mockReturnValue({
      isLoading: true,
      location: { pathname: '/app/projects' },
    })

    const { rerender } = render(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    // Simulate back navigation
    mockUseRouterState.mockReturnValue({
      isLoading: true,
      location: { pathname: '/app' },
    })
    rerender(<RouteProgressBar />)

    expect(screen.getByTestId('route-progress-bar')).toBeInTheDocument()
  })

  it('should handle forward navigation (simulated by pathname change)', async () => {
    mockUseRouterState.mockReturnValue({
      isLoading: true,
      location: { pathname: '/app' },
    })

    const { rerender } = render(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    // Simulate forward navigation
    mockUseRouterState.mockReturnValue({
      isLoading: true,
      location: { pathname: '/app/projects' },
    })
    rerender(<RouteProgressBar />)

    expect(screen.getByTestId('route-progress-bar')).toBeInTheDocument()
  })

  it('should cleanup on unmount without errors', async () => {
    // This test verifies that unmounting during prefetch doesn't cause errors
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    function TestComponent({ routes }: { routes: string[] }) {
      usePrefetchRoutes({ routes, staggerDelay: 100 })
      return <div>Test</div>
    }

    const { unmount } = render(
      <TestComponent routes={['/a', '/b', '/c']} />
    )

    // Immediately unmount
    unmount()

    // Advance timers - should not cause any errors
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    // Test passes if no errors occurred
    expect(true).toBe(true)
  })

  it('should handle navigate to same route', () => {
    render(<RouteNotFound />)

    // Click home when already at root (edge case)
    mockRouter.navigate.mockClear()
    fireEvent.click(screen.getByTestId('not-found-home'))

    expect(mockRouter.navigate).toHaveBeenCalledWith({ to: '/' })
  })
})

// =============================================================================
// Component Cleanup Tests
// =============================================================================

describe('Component Cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should clear timers on RouteProgressBar unmount', async () => {
    mockUseRouterState.mockReturnValue({ isLoading: true })

    const { unmount } = render(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    // Unmount while loading
    unmount()

    // Advancing timers should not cause issues
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    // No errors should occur - test passes if we reach here
    expect(true).toBe(true)
  })

  it('should clear timers on FadeTransition unmount', async () => {
    const { unmount, rerender } = render(
      <FadeTransition transitionKey="key1" duration={200}>
        <div>Content</div>
      </FadeTransition>
    )

    // Trigger transition
    rerender(
      <FadeTransition transitionKey="key2" duration={200}>
        <div>Content</div>
      </FadeTransition>
    )

    // Unmount during transition
    unmount()

    // Advancing timers should not cause issues
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(true).toBe(true)
  })

  it('should disconnect IntersectionObserver on ViewportPrefetch unmount', () => {
    const disconnectSpy = vi.fn()

    global.IntersectionObserver = vi.fn(() => ({
      observe: vi.fn(),
      disconnect: disconnectSpy,
    })) as unknown as typeof IntersectionObserver

    const { unmount } = render(
      <ViewportPrefetch to="/test">
        <span>Link</span>
      </ViewportPrefetch>
    )

    unmount()

    expect(disconnectSpy).toHaveBeenCalled()
  })

  it('should remove event listener on useReducedMotion unmount', () => {
    const removeEventListenerSpy = vi.fn()

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: removeEventListenerSpy,
    }))

    function TestComponent() {
      useReducedMotion()
      return <div>Test</div>
    }

    const { unmount } = render(<TestComponent />)
    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function))
  })
})

// =============================================================================
// Loading State Edge Cases
// =============================================================================

describe('Loading State Edge Cases', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockUseRouterState.mockReturnValue({ isLoading: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should handle instant load completion (no visible progress)', async () => {
    // Start loading
    mockUseRouterState.mockReturnValue({ isLoading: true })
    const { rerender } = render(<RouteProgressBar />)

    // Immediately complete before progress bar becomes visible
    mockUseRouterState.mockReturnValue({ isLoading: false })
    rerender(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    // Progress bar should have hidden cleanly
    expect(screen.queryByTestId('route-progress-bar')).not.toBeInTheDocument()
  })

  it('should handle very long loading time', async () => {
    mockUseRouterState.mockReturnValue({ isLoading: true })
    render(<RouteProgressBar />)

    // Wait a long time
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })

    // Should still be showing progress bar (stuck at 80%)
    const progressBar = screen.getByTestId('route-progress-bar')
    expect(progressBar).toBeInTheDocument()
    expect(progressBar).toHaveAttribute('aria-valuenow', '80')
  })

  it('should show custom loading message in RoutePending', () => {
    render(<RoutePending message="Fetching user data..." />)

    expect(screen.getByText('Fetching user data...')).toBeInTheDocument()
  })

  it('should render skeleton with correct structure', () => {
    render(<RoutePending showSkeleton />)

    const pending = screen.getByTestId('route-pending')
    const skeletonLines = pending.querySelectorAll('.bg-muted')

    // Should have multiple skeleton lines
    expect(skeletonLines.length).toBeGreaterThan(3)
  })

  it('should not show message when showSkeleton is true', () => {
    render(<RoutePending showSkeleton message="This should not show" />)

    // With skeleton, the spinner and message are not shown
    expect(screen.queryByText('This should not show')).not.toBeInTheDocument()
  })
})

// =============================================================================
// RouteTransitionContainer Advanced Tests
// =============================================================================

describe('RouteTransitionContainer Advanced', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockUseRouterState.mockReturnValue({
      isLoading: false,
      location: { pathname: '/initial' },
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

  it('should respect transitionDuration prop', () => {
    mockUseRouterState.mockReturnValue({
      isLoading: false,
      location: { pathname: '/test' },
    })

    render(
      <RouteTransitionContainer transitionDuration={300}>
        <div>Content</div>
      </RouteTransitionContainer>
    )

    const fadeTransition = screen.getByTestId('fade-transition')
    expect(fadeTransition).toHaveStyle({ transitionDuration: '150ms' }) // Half of 300
  })

  it('should not prefetch when prefetchRoutes is empty', async () => {
    render(
      <RouteTransitionContainer prefetchRoutes={[]}>
        <div>Content</div>
      </RouteTransitionContainer>
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(mockRouter.preloadRoute).not.toHaveBeenCalled()
  })

  it('should render children without transitions when disabled', () => {
    render(
      <RouteTransitionContainer enableTransitions={false}>
        <div data-testid="child">Content</div>
      </RouteTransitionContainer>
    )

    // Should render child directly without FadeTransition wrapper
    expect(screen.getByTestId('child')).toBeInTheDocument()
    const container = screen.getByTestId('route-transition-container')
    expect(container.querySelector('[data-testid="fade-transition"]')).not.toBeInTheDocument()
  })

  it('should update pathname key when route changes', async () => {
    mockUseRouterState.mockReturnValue({
      isLoading: false,
      location: { pathname: '/page1' },
    })

    const { rerender } = render(
      <RouteTransitionContainer>
        <div>Page 1</div>
      </RouteTransitionContainer>
    )

    // Change pathname
    mockUseRouterState.mockReturnValue({
      isLoading: false,
      location: { pathname: '/page2' },
    })

    rerender(
      <RouteTransitionContainer>
        <div>Page 2</div>
      </RouteTransitionContainer>
    )

    // FadeTransition should have triggered
    const fadeTransition = screen.getByTestId('fade-transition')
    expect(fadeTransition).toHaveStyle({ opacity: '0' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(fadeTransition).toHaveStyle({ opacity: '1' })
  })
})

// =============================================================================
// Accessibility Tests
// =============================================================================

describe('Accessibility', () => {
  it('should announce route loading to screen readers', async () => {
    vi.useFakeTimers()
    mockUseRouterState.mockReturnValue({ isLoading: true })

    render(<RouteProgressBar />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    const progressBar = screen.getByRole('progressbar')
    expect(progressBar).toHaveAttribute('aria-label', 'Page loading')

    vi.useRealTimers()
  })

  it('should have proper alert role on error component', () => {
    const error = new Error('Test')
    render(<RouteError error={error} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('should have descriptive button text', () => {
    const error = new Error('Test')
    render(<RouteError error={error} />)

    expect(screen.getByText('Try Again')).toBeInTheDocument()
    expect(screen.getByText('Go Home')).toBeInTheDocument()
  })

  it('should have descriptive heading on not found page', () => {
    render(<RouteNotFound />)

    expect(screen.getByText('Page Not Found')).toBeInTheDocument()
    expect(screen.getByText('404')).toBeInTheDocument()
  })

  it('should hide decorative spinner from screen readers', () => {
    render(<RoutePending />)

    const spinner = screen.getByTestId('route-pending').querySelector('[aria-hidden="true"]')
    expect(spinner).toBeInTheDocument()
  })
})
