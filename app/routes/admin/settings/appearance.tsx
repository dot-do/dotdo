/**
 * Admin Appearance Settings Route
 *
 * Theme and appearance customization with UX polish.
 *
 * Features:
 * - Visual theme preview with color swatches
 * - Instant theme application with success feedback
 * - Keyboard navigation support
 * - Accessible theme selection
 */

import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback } from 'react'
import { Shell } from '~/components/ui/shell'
import { ThemeSelector } from '~/components/ui/theme-selector'
import { useThemeStore } from '@mdxui/themes'

export const Route = createFileRoute('/admin/settings/appearance')({
  component: AppearanceSettingsPage,
})

// =============================================================================
// Success Icon Component
// =============================================================================

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  )
}

// =============================================================================
// Component
// =============================================================================

/**
 * Available Theme Presets
 *
 * @mdxui/themes provides 30 professionally designed theme presets:
 *
 * **Popular Themes:**
 * - Stripe - Clean indigo/purple palette inspired by Stripe's design
 * - Linear - Minimal modern design inspired by Linear
 * - Anthropic - Warm orange/coral tones from Anthropic's brand
 * - Obsidian - Dark-first theme with purple accents
 *
 * **Nature & Calm:**
 * - Sage - Soft green earth tones
 * - Aurora - Northern lights inspired gradients
 * - Frost - Cool ice blue theme
 * - Dusk - Warm sunset colors
 *
 * **Productivity:**
 * - Blueprint - Engineering/technical blue theme
 * - Mono - Grayscale minimalist theme
 * - Notation - Note-taking focused neutral theme
 * - Notepad - Warm paper-like background
 *
 * **Dark Themes:**
 * - Midnight - Deep blue-black theme
 * - Mocha - Warm brown coffee theme
 * - Neural - AI/tech focused dark theme
 *
 * **Playful:**
 * - Bubblegum - Pink/magenta vibrant theme
 * - Bumble - Yellow/gold honey theme
 * - Cappuccino - Warm beige cafe theme
 *
 * **Tech-Inspired:**
 * - Arc - Browser-inspired theme
 * - Dev - Developer-focused dark theme
 * - X - Minimal black and white
 * - Starlink - Space-tech inspired
 *
 * Each theme includes:
 * - Full light and dark mode variants
 * - Semantic colors (success, warning, error, info)
 * - Chart colors for data visualization
 * - Sidebar-specific color variants
 * - Shadow system with theme-matched colors
 */
function AppearanceSettingsPage() {
  const { preset, mode } = useThemeStore()
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [lastSavedPreset, setLastSavedPreset] = useState(preset)
  const [lastSavedMode, setLastSavedMode] = useState(mode)

  // Show confirmation when theme changes
  useEffect(() => {
    if (preset !== lastSavedPreset || mode !== lastSavedMode) {
      setShowSaveConfirmation(true)
      setLastSavedPreset(preset)
      setLastSavedMode(mode)

      // Hide confirmation after 3 seconds
      const timer = setTimeout(() => {
        setShowSaveConfirmation(false)
      }, 3000)

      return () => clearTimeout(timer)
    }
  }, [preset, mode, lastSavedPreset, lastSavedMode])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Escape to dismiss notification
    if (e.key === 'Escape' && showSaveConfirmation) {
      setShowSaveConfirmation(false)
    }
  }, [showSaveConfirmation])

  return (
    <Shell>
      <div className="p-6" data-testid="settings-content" onKeyDown={handleKeyDown}>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Appearance</h1>
          <p className="text-muted-foreground mt-1">
            Customize the look and feel of the application.
          </p>
        </div>

        {/* Save Confirmation Banner */}
        {showSaveConfirmation && (
          <div
            className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200 animate-in fade-in slide-in-from-top-2 duration-300"
            role="status"
            aria-live="polite"
            data-testid="appearance-save-confirmation"
          >
            <div className="flex items-center gap-2">
              <CheckIcon className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium">Theme preferences saved automatically.</span>
            </div>
          </div>
        )}

        <div className="bg-card rounded-lg shadow p-6 max-w-xl" data-testid="settings-form-appearance">
          <div data-testid="settings-theme-selector">
            <ThemeSelector />
          </div>

          <div className="mt-8 pt-6 border-t" data-testid="settings-theme-preview">
            <h3 className="text-sm font-medium mb-3">Theme Preview</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Changes are applied instantly and saved automatically.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-primary text-primary-foreground transition-colors duration-300">
                Primary
              </div>
              <div className="p-4 rounded-lg bg-secondary text-secondary-foreground transition-colors duration-300">
                Secondary
              </div>
              <div className="p-4 rounded-lg bg-accent text-accent-foreground transition-colors duration-300">
                Accent
              </div>
              <div className="p-4 rounded-lg bg-muted text-muted-foreground transition-colors duration-300">
                Muted
              </div>
              <div className="p-4 rounded-lg bg-destructive text-destructive-foreground transition-colors duration-300">
                Destructive
              </div>
              <div className="p-4 rounded-lg border bg-card text-card-foreground transition-colors duration-300">
                Card
              </div>
            </div>
          </div>
        </div>

        {/* Keyboard shortcuts hint */}
        <p className="text-xs text-muted-foreground mt-4 max-w-xl">
          Tip: Use <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Tab</kbd> to navigate between themes and <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Enter</kbd> to select.
        </p>
      </div>
    </Shell>
  )
}
