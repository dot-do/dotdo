/**
 * Theme Selector Component
 *
 * Provides UI for selecting theme preset and mode (light/dark/system).
 * Uses @mdxui/themes for state management.
 */

import { useThemeStore, themePresets, type ThemePreset, type ThemeMode } from '@mdxui/themes'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'

const themeDisplayNames: Record<ThemePreset, string> = {
  airbnb: 'Airbnb',
  anthropic: 'Anthropic',
  arc: 'Arc',
  aurora: 'Aurora',
  blueprint: 'Blueprint',
  bubblegum: 'Bubblegum',
  bumble: 'Bumble',
  cappuccino: 'Cappuccino',
  clay: 'Clay',
  cyan: 'Cyan',
  dev: 'Dev',
  dusk: 'Dusk',
  ember: 'Ember',
  frost: 'Frost',
  linear: 'Linear',
  midnight: 'Midnight',
  mocha: 'Mocha',
  monica: 'Monica',
  mono: 'Mono',
  neural: 'Neural',
  notation: 'Notation',
  notepad: 'Notepad',
  obsidian: 'Obsidian',
  phosphor: 'Phosphor',
  polaris: 'Polaris',
  sage: 'Sage',
  star: 'Star',
  starlink: 'Starlink',
  stripe: 'Stripe',
  x: 'X',
}

const modeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

export function ThemeSelector() {
  const { preset, mode, setPreset, setMode, applyTheme } = useThemeStore()

  const handlePresetChange = (value: string) => {
    setPreset(value as ThemePreset)
    applyTheme()
  }

  const handleModeChange = (value: string) => {
    setMode(value as ThemeMode)
    applyTheme()
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-2">Theme Preset</label>
        <Select value={preset} onValueChange={handlePresetChange}>
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue placeholder="Select a theme" />
          </SelectTrigger>
          <SelectContent>
            {themePresets.map((presetName) => (
              <SelectItem key={presetName} value={presetName}>
                {themeDisplayNames[presetName] || presetName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a color theme for the application.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Appearance</label>
        <Select value={mode} onValueChange={handleModeChange}>
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue placeholder="Select mode" />
          </SelectTrigger>
          <SelectContent>
            {modeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground mt-1">
          Select light, dark, or follow your system preference.
        </p>
      </div>
    </div>
  )
}

/**
 * Compact theme mode toggle for headers/navbars
 */
export function ThemeModeToggle() {
  const { resolvedMode, setMode, applyTheme } = useThemeStore()

  const toggleMode = () => {
    setMode(resolvedMode === 'dark' ? 'light' : 'dark')
    applyTheme()
  }

  return (
    <button
      type="button"
      onClick={toggleMode}
      className="p-2 rounded-md hover:bg-accent text-foreground"
      aria-label={`Switch to ${resolvedMode === 'dark' ? 'light' : 'dark'} mode`}
      aria-pressed={resolvedMode === 'dark'}
    >
      {resolvedMode === 'dark' ? (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  )
}
