/**
 * Admin Appearance Settings Route
 *
 * Theme and appearance customization.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'
import { ThemeSelector } from '~/components/ui/theme-selector'

export const Route = createFileRoute('/admin/settings/appearance')({
  component: AppearanceSettingsPage,
})

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
  return (
    <Shell>
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-2">Appearance</h1>
        <p className="text-muted-foreground mb-6">
          Customize the look and feel of the application.
        </p>

        <div className="bg-card rounded-lg shadow p-6 max-w-xl">
          <ThemeSelector />

          <div className="mt-8 pt-6 border-t">
            <h3 className="text-sm font-medium mb-3">Theme Preview</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-primary text-primary-foreground">
                Primary
              </div>
              <div className="p-4 rounded-lg bg-secondary text-secondary-foreground">
                Secondary
              </div>
              <div className="p-4 rounded-lg bg-accent text-accent-foreground">
                Accent
              </div>
              <div className="p-4 rounded-lg bg-muted text-muted-foreground">
                Muted
              </div>
              <div className="p-4 rounded-lg bg-destructive text-destructive-foreground">
                Destructive
              </div>
              <div className="p-4 rounded-lg border bg-card text-card-foreground">
                Card
              </div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  )
}
