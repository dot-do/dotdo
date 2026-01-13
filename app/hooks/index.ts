/**
 * App Hooks
 *
 * Central export for all app-level React hooks.
 */

export { usePrefetch } from './use-prefetch'
export type { PrefetchHandlers } from './use-prefetch'

export { useSidebarPersistence } from './use-sidebar-persistence'
export type {
  SidebarState,
  SidebarPersistenceOptions,
  SidebarPersistenceReturn,
} from './use-sidebar-persistence'

export { useIsMobile } from './use-is-mobile'

export { useSwipeGesture } from './use-swipe-gesture'
export type { SwipeGestureOptions, SwipeGestureHandlers } from './use-swipe-gesture'

export { useKeyboardShortcuts } from './use-keyboard-shortcuts'
export type { KeyboardShortcut } from './use-keyboard-shortcuts'

export { useDashboardPreferences } from './use-dashboard-preferences'
export type {
  WidgetId,
  WidgetConfig,
  OnboardingStep,
  DashboardPreferences,
  DashboardPreferencesReturn,
} from './use-dashboard-preferences'
