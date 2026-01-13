/**
 * useDashboardPreferences Hook
 *
 * Manages dashboard personalization with localStorage persistence.
 * Supports widget visibility, ordering, and new user onboarding state.
 *
 * @example
 * ```tsx
 * import { useDashboardPreferences } from '~/hooks/use-dashboard-preferences'
 *
 * function Dashboard() {
 *   const {
 *     widgets,
 *     toggleWidget,
 *     reorderWidgets,
 *     isNewUser,
 *     completeOnboardingStep,
 *   } = useDashboardPreferences()
 *
 *   return (
 *     <DashboardWidgets widgets={widgets} />
 *   )
 * }
 * ```
 */

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'dashboard-preferences'

// =============================================================================
// Types
// =============================================================================

export type WidgetId = 'recent-projects' | 'pending-tasks' | 'active-workflows' | 'activity-feed'

export interface WidgetConfig {
  id: WidgetId
  label: string
  visible: boolean
  order: number
}

export interface OnboardingStep {
  id: string
  label: string
  completed: boolean
}

export interface DashboardPreferences {
  widgets: WidgetConfig[]
  onboardingSteps: OnboardingStep[]
  onboardingDismissed: boolean
  lastVisit: string | null
  visitCount: number
}

export interface DashboardPreferencesReturn {
  /** Current widget configurations */
  widgets: WidgetConfig[]
  /** Toggle a widget's visibility */
  toggleWidget: (widgetId: WidgetId) => void
  /** Reorder widgets by providing new order */
  reorderWidgets: (orderedIds: WidgetId[]) => void
  /** Whether the user is new (fewer than 3 visits and onboarding not dismissed) */
  isNewUser: boolean
  /** Onboarding steps with completion status */
  onboardingSteps: OnboardingStep[]
  /** Mark an onboarding step as complete */
  completeOnboardingStep: (stepId: string) => void
  /** Dismiss the onboarding widget */
  dismissOnboarding: () => void
  /** Reset all preferences to defaults */
  resetPreferences: () => void
  /** Total visit count */
  visitCount: number
  /** Get visible widgets in order */
  visibleWidgets: WidgetConfig[]
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'recent-projects', label: 'Recent Projects', visible: true, order: 0 },
  { id: 'pending-tasks', label: 'Pending Tasks', visible: true, order: 1 },
  { id: 'active-workflows', label: 'Active Workflows', visible: true, order: 2 },
  { id: 'activity-feed', label: 'Activity Feed', visible: true, order: 3 },
]

const DEFAULT_ONBOARDING_STEPS: OnboardingStep[] = [
  { id: 'create-project', label: 'Create your first project', completed: false },
  { id: 'invite-team', label: 'Invite a team member', completed: false },
  { id: 'create-workflow', label: 'Set up your first workflow', completed: false },
]

const DEFAULT_PREFERENCES: DashboardPreferences = {
  widgets: DEFAULT_WIDGETS,
  onboardingSteps: DEFAULT_ONBOARDING_STEPS,
  onboardingDismissed: false,
  lastVisit: null,
  visitCount: 0,
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useDashboardPreferences(): DashboardPreferencesReturn {
  // Initialize state from localStorage or defaults
  const [preferences, setPreferences] = useState<DashboardPreferences>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_PREFERENCES
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<DashboardPreferences>
        // Merge with defaults to ensure all fields exist
        return {
          widgets: parsed.widgets ?? DEFAULT_WIDGETS,
          onboardingSteps: parsed.onboardingSteps ?? DEFAULT_ONBOARDING_STEPS,
          onboardingDismissed: parsed.onboardingDismissed ?? false,
          lastVisit: parsed.lastVisit ?? null,
          visitCount: parsed.visitCount ?? 0,
        }
      }
    } catch {
      // Ignore parse errors
    }

    return DEFAULT_PREFERENCES
  })

  // Persist preferences to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    } catch {
      // Ignore storage errors
    }
  }, [preferences])

  // Track visits on mount
  useEffect(() => {
    if (typeof window === 'undefined') return

    setPreferences((prev) => ({
      ...prev,
      lastVisit: new Date().toISOString(),
      visitCount: prev.visitCount + 1,
    }))
  }, [])

  // Hydrate from localStorage on mount (for SSR)
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<DashboardPreferences>
        setPreferences({
          widgets: parsed.widgets ?? DEFAULT_WIDGETS,
          onboardingSteps: parsed.onboardingSteps ?? DEFAULT_ONBOARDING_STEPS,
          onboardingDismissed: parsed.onboardingDismissed ?? false,
          lastVisit: parsed.lastVisit ?? null,
          visitCount: parsed.visitCount ?? 0,
        })
      }
    } catch {
      // Ignore parse errors
    }
  }, [])

  // Toggle widget visibility
  const toggleWidget = useCallback((widgetId: WidgetId) => {
    setPreferences((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) =>
        w.id === widgetId ? { ...w, visible: !w.visible } : w
      ),
    }))
  }, [])

  // Reorder widgets
  const reorderWidgets = useCallback((orderedIds: WidgetId[]) => {
    setPreferences((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) => ({
        ...w,
        order: orderedIds.indexOf(w.id),
      })),
    }))
  }, [])

  // Complete an onboarding step
  const completeOnboardingStep = useCallback((stepId: string) => {
    setPreferences((prev) => ({
      ...prev,
      onboardingSteps: prev.onboardingSteps.map((s) =>
        s.id === stepId ? { ...s, completed: true } : s
      ),
    }))
  }, [])

  // Dismiss onboarding
  const dismissOnboarding = useCallback(() => {
    setPreferences((prev) => ({
      ...prev,
      onboardingDismissed: true,
    }))
  }, [])

  // Reset to defaults
  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES)
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  // Compute derived values
  const isNewUser = preferences.visitCount <= 3 && !preferences.onboardingDismissed
  const visibleWidgets = [...preferences.widgets]
    .filter((w) => w.visible)
    .sort((a, b) => a.order - b.order)

  return {
    widgets: preferences.widgets,
    toggleWidget,
    reorderWidgets,
    isNewUser,
    onboardingSteps: preferences.onboardingSteps,
    completeOnboardingStep,
    dismissOnboarding,
    resetPreferences,
    visitCount: preferences.visitCount,
    visibleWidgets,
  }
}
