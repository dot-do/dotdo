/**
 * Theme Selector Component
 *
 * Provides UI for selecting theme preset and mode (light/dark/system).
 * Uses @mdxui/themes for state management.
 *
 * Features:
 * - Visual theme preview grid with color swatches
 * - Themes organized by category
 * - Mode selector with visual icons
 * - Smooth transitions when switching themes
 * - Keyboard navigation support
 */

import { useState, useMemo } from 'react'
import { useThemeStore, themePresets, type ThemePreset, type ThemeMode } from '@mdxui/themes'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Sun, Moon, Monitor, Check } from 'lucide-react'

// =============================================================================
// Theme Metadata
// =============================================================================

interface ThemeInfo {
  name: string
  category: 'popular' | 'nature' | 'productivity' | 'dark' | 'playful' | 'tech' | 'brand'
  description: string
  /** Preview colors in order: primary, secondary, accent, muted */
  colors: {
    light: [string, string, string, string]
    dark: [string, string, string, string]
  }
}

const themeMetadata: Record<string, ThemeInfo> = {
  stripe: {
    name: 'Stripe',
    category: 'popular',
    description: 'Clean indigo/purple palette',
    colors: {
      light: ['#635bff', '#f6f9fc', '#0a2540', '#8898aa'],
      dark: ['#7a73ff', '#0a2540', '#f6f9fc', '#8898aa'],
    },
  },
  linear: {
    name: 'Linear',
    category: 'popular',
    description: 'Minimal modern design',
    colors: {
      light: ['#5e6ad2', '#f7f8f9', '#222326', '#6b6f76'],
      dark: ['#5e6ad2', '#0f1011', '#f7f8f9', '#6b6f76'],
    },
  },
  anthropic: {
    name: 'Anthropic',
    category: 'brand',
    description: 'Warm orange/coral tones',
    colors: {
      light: ['#d97756', '#faf9f7', '#1a1a1a', '#8b8680'],
      dark: ['#d97756', '#1a1a1a', '#faf9f7', '#8b8680'],
    },
  },
  obsidian: {
    name: 'Obsidian',
    category: 'dark',
    description: 'Dark-first with purple accents',
    colors: {
      light: ['#7c3aed', '#fafafa', '#1e1e1e', '#71717a'],
      dark: ['#a78bfa', '#1e1e1e', '#fafafa', '#52525b'],
    },
  },
  cyan: {
    name: 'Cyan',
    category: 'popular',
    description: 'Fresh teal and cyan',
    colors: {
      light: ['#06b6d4', '#fafafa', '#171717', '#737373'],
      dark: ['#22d3ee', '#171717', '#fafafa', '#525252'],
    },
  },
  sage: {
    name: 'Sage',
    category: 'nature',
    description: 'Soft green earth tones',
    colors: {
      light: ['#65a30d', '#fafaf9', '#1c1917', '#78716c'],
      dark: ['#84cc16', '#1c1917', '#fafaf9', '#57534e'],
    },
  },
  aurora: {
    name: 'Aurora',
    category: 'nature',
    description: 'Northern lights gradients',
    colors: {
      light: ['#10b981', '#f0fdf4', '#064e3b', '#6ee7b7'],
      dark: ['#34d399', '#022c22', '#ecfdf5', '#059669'],
    },
  },
  frost: {
    name: 'Frost',
    category: 'nature',
    description: 'Cool ice blue theme',
    colors: {
      light: ['#0ea5e9', '#f0f9ff', '#0c4a6e', '#7dd3fc'],
      dark: ['#38bdf8', '#0c4a6e', '#f0f9ff', '#0284c7'],
    },
  },
  dusk: {
    name: 'Dusk',
    category: 'nature',
    description: 'Warm sunset colors',
    colors: {
      light: ['#f97316', '#fff7ed', '#7c2d12', '#fdba74'],
      dark: ['#fb923c', '#431407', '#fff7ed', '#ea580c'],
    },
  },
  blueprint: {
    name: 'Blueprint',
    category: 'productivity',
    description: 'Engineering/technical blue',
    colors: {
      light: ['#2563eb', '#eff6ff', '#1e3a8a', '#93c5fd'],
      dark: ['#3b82f6', '#1e3a8a', '#eff6ff', '#1d4ed8'],
    },
  },
  mono: {
    name: 'Mono',
    category: 'productivity',
    description: 'Grayscale minimalist',
    colors: {
      light: ['#262626', '#fafafa', '#171717', '#a3a3a3'],
      dark: ['#e5e5e5', '#171717', '#fafafa', '#525252'],
    },
  },
  notation: {
    name: 'Notation',
    category: 'productivity',
    description: 'Note-taking neutral theme',
    colors: {
      light: ['#78716c', '#fafaf9', '#1c1917', '#a8a29e'],
      dark: ['#a8a29e', '#1c1917', '#fafaf9', '#57534e'],
    },
  },
  notepad: {
    name: 'Notepad',
    category: 'productivity',
    description: 'Warm paper-like background',
    colors: {
      light: ['#ca8a04', '#fefce8', '#713f12', '#facc15'],
      dark: ['#eab308', '#422006', '#fef9c3', '#a16207'],
    },
  },
  midnight: {
    name: 'Midnight',
    category: 'dark',
    description: 'Deep blue-black theme',
    colors: {
      light: ['#6366f1', '#eef2ff', '#1e1b4b', '#a5b4fc'],
      dark: ['#818cf8', '#1e1b4b', '#eef2ff', '#4f46e5'],
    },
  },
  mocha: {
    name: 'Mocha',
    category: 'dark',
    description: 'Warm brown coffee theme',
    colors: {
      light: ['#78350f', '#fffbeb', '#451a03', '#fbbf24'],
      dark: ['#d97706', '#292524', '#fef3c7', '#92400e'],
    },
  },
  neural: {
    name: 'Neural',
    category: 'dark',
    description: 'AI/tech focused dark',
    colors: {
      light: ['#7c3aed', '#faf5ff', '#3b0764', '#c4b5fd'],
      dark: ['#a78bfa', '#1a1625', '#faf5ff', '#6d28d9'],
    },
  },
  bubblegum: {
    name: 'Bubblegum',
    category: 'playful',
    description: 'Pink/magenta vibrant',
    colors: {
      light: ['#ec4899', '#fdf2f8', '#831843', '#f9a8d4'],
      dark: ['#f472b6', '#500724', '#fdf2f8', '#db2777'],
    },
  },
  bumble: {
    name: 'Bumble',
    category: 'playful',
    description: 'Yellow/gold honey theme',
    colors: {
      light: ['#eab308', '#fefce8', '#713f12', '#fde047'],
      dark: ['#facc15', '#422006', '#fefce8', '#ca8a04'],
    },
  },
  cappuccino: {
    name: 'Cappuccino',
    category: 'playful',
    description: 'Warm beige cafe theme',
    colors: {
      light: ['#a16207', '#fef3c7', '#451a03', '#fcd34d'],
      dark: ['#d97706', '#292524', '#fef3c7', '#92400e'],
    },
  },
  arc: {
    name: 'Arc',
    category: 'tech',
    description: 'Browser-inspired theme',
    colors: {
      light: ['#8b5cf6', '#faf5ff', '#4c1d95', '#c4b5fd'],
      dark: ['#a78bfa', '#1c1033', '#faf5ff', '#7c3aed'],
    },
  },
  dev: {
    name: 'Dev',
    category: 'tech',
    description: 'Developer-focused dark',
    colors: {
      light: ['#22c55e', '#f0fdf4', '#14532d', '#86efac'],
      dark: ['#4ade80', '#052e16', '#f0fdf4', '#16a34a'],
    },
  },
  x: {
    name: 'X',
    category: 'tech',
    description: 'Minimal black and white',
    colors: {
      light: ['#0f0f0f', '#ffffff', '#171717', '#a3a3a3'],
      dark: ['#ffffff', '#0f0f0f', '#fafafa', '#525252'],
    },
  },
  starlink: {
    name: 'Starlink',
    category: 'tech',
    description: 'Space-tech inspired',
    colors: {
      light: ['#0369a1', '#f0f9ff', '#0c4a6e', '#7dd3fc'],
      dark: ['#0ea5e9', '#0c4a6e', '#f0f9ff', '#0284c7'],
    },
  },
  airbnb: {
    name: 'Airbnb',
    category: 'brand',
    description: 'Coral/red brand colors',
    colors: {
      light: ['#ff385c', '#fff5f5', '#8b0000', '#fca5a5'],
      dark: ['#ff5a5f', '#1f1f1f', '#fff5f5', '#dc2626'],
    },
  },
  clay: {
    name: 'Clay',
    category: 'nature',
    description: 'Earthy terracotta',
    colors: {
      light: ['#c2410c', '#fff7ed', '#7c2d12', '#fdba74'],
      dark: ['#ea580c', '#431407', '#fff7ed', '#9a3412'],
    },
  },
  ember: {
    name: 'Ember',
    category: 'nature',
    description: 'Warm fire orange',
    colors: {
      light: ['#ea580c', '#fff7ed', '#7c2d12', '#fb923c'],
      dark: ['#f97316', '#431407', '#fff7ed', '#c2410c'],
    },
  },
  monica: {
    name: 'Monica',
    category: 'brand',
    description: 'Soft purple gradient',
    colors: {
      light: ['#9333ea', '#faf5ff', '#581c87', '#d8b4fe'],
      dark: ['#a855f7', '#3b0764', '#faf5ff', '#7e22ce'],
    },
  },
  polaris: {
    name: 'Polaris',
    category: 'brand',
    description: 'Shopify-inspired green',
    colors: {
      light: ['#008060', '#f1f8f5', '#004c3f', '#95c9b4'],
      dark: ['#00a47c', '#0d1f17', '#f1f8f5', '#006e52'],
    },
  },
  phosphor: {
    name: 'Phosphor',
    category: 'tech',
    description: 'Green terminal glow',
    colors: {
      light: ['#16a34a', '#f0fdf4', '#14532d', '#86efac'],
      dark: ['#22c55e', '#052e16', '#f0fdf4', '#15803d'],
    },
  },
  star: {
    name: 'Star',
    category: 'playful',
    description: 'Golden star bright',
    colors: {
      light: ['#ca8a04', '#fefce8', '#713f12', '#fde047'],
      dark: ['#eab308', '#422006', '#fefce8', '#a16207'],
    },
  },
}

// Category display info
const categoryInfo: Record<string, { label: string; description: string }> = {
  popular: { label: 'Popular', description: 'Most used themes' },
  nature: { label: 'Nature & Calm', description: 'Inspired by natural elements' },
  productivity: { label: 'Productivity', description: 'Focused and minimal' },
  dark: { label: 'Dark Themes', description: 'Dark-first designs' },
  playful: { label: 'Playful', description: 'Vibrant and fun' },
  tech: { label: 'Tech-Inspired', description: 'Modern tech aesthetics' },
  brand: { label: 'Brand Colors', description: 'Inspired by popular brands' },
}

const modeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

// =============================================================================
// Theme Color Swatch Component
// =============================================================================

interface ThemeSwatchProps {
  colors: [string, string, string, string]
}

function ThemeSwatch({ colors }: ThemeSwatchProps) {
  return (
    <div className="theme-swatch-grid w-12 h-12 rounded-md overflow-hidden border">
      {colors.map((color, i) => (
        <div
          key={i}
          className="theme-swatch"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}

// =============================================================================
// Theme Preview Card Component
// =============================================================================

interface ThemePreviewCardProps {
  preset: string
  info: ThemeInfo
  isSelected: boolean
  isDark: boolean
  onSelect: () => void
}

function ThemePreviewCard({ preset, info, isSelected, isDark, onSelect }: ThemePreviewCardProps) {
  const colors = isDark ? info.colors.dark : info.colors.light

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`theme-preview-${preset}`}
      data-selected={isSelected}
      className={`
        theme-preview-card
        relative flex items-center gap-3 p-3 rounded-lg border bg-card text-left w-full
        hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring
        ${isSelected ? 'ring-2 ring-primary' : ''}
      `}
      aria-pressed={isSelected}
      aria-label={`Select ${info.name} theme`}
    >
      <ThemeSwatch colors={colors} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{info.name}</span>
          {isSelected && (
            <Check className="w-4 h-4 text-primary" aria-hidden="true" />
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{info.description}</p>
      </div>
    </button>
  )
}

// =============================================================================
// Theme Category Section
// =============================================================================

interface ThemeCategorySectionProps {
  category: string
  themes: [string, ThemeInfo][]
  selectedPreset: string
  isDark: boolean
  onSelect: (preset: string) => void
}

function ThemeCategorySection({
  category,
  themes,
  selectedPreset,
  isDark,
  onSelect,
}: ThemeCategorySectionProps) {
  const info = categoryInfo[category]

  return (
    <div data-testid={`theme-category-${category}`}>
      <h4 className="text-sm font-medium mb-2">{info?.label || category}</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {themes.map(([preset, themeInfo]) => (
          <ThemePreviewCard
            key={preset}
            preset={preset}
            info={themeInfo}
            isSelected={selectedPreset === preset}
            isDark={isDark}
            onSelect={() => onSelect(preset)}
          />
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// Main ThemeSelector Component
// =============================================================================

export function ThemeSelector() {
  const { preset, mode, resolvedMode, setPreset, setMode, applyTheme } = useThemeStore()
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const handlePresetChange = (value: string) => {
    setPreset(value as ThemePreset)
    applyTheme()
  }

  const handleModeChange = (value: ThemeMode) => {
    setMode(value)
    applyTheme()
  }

  // Group themes by category
  const themesByCategory = useMemo(() => {
    const grouped: Record<string, [string, ThemeInfo][]> = {}

    for (const presetName of themePresets) {
      const info = themeMetadata[presetName]
      if (info) {
        const category = info.category
        if (!grouped[category]) {
          grouped[category] = []
        }
        grouped[category].push([presetName, info])
      }
    }

    // Sort categories by display order
    const categoryOrder = ['popular', 'nature', 'productivity', 'dark', 'playful', 'tech', 'brand']
    return categoryOrder
      .filter((cat) => grouped[cat]?.length > 0)
      .map((cat) => ({ category: cat, themes: grouped[cat] }))
  }, [])

  const isDark = resolvedMode === 'dark'

  return (
    <div className="space-y-6" data-testid="theme-selector">
      {/* Mode Selection */}
      <div>
        <label className="block text-sm font-medium mb-3">Appearance</label>
        <div className="flex gap-2" role="radiogroup" aria-label="Theme mode">
          {modeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleModeChange(option.value)}
              data-testid={`theme-mode-${option.value}`}
              data-selected={mode === option.value}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-md border transition-colors
                ${mode === option.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-accent border-border'
                }
              `}
              role="radio"
              aria-checked={mode === option.value}
            >
              <option.icon className="w-4 h-4" aria-hidden="true" />
              <span className="text-sm font-medium">{option.label}</span>
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          {mode === 'system'
            ? 'Following your system preference'
            : `Using ${mode} mode`}
        </p>
      </div>

      {/* Theme Selection */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium">Theme Preset</label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-accent' : 'hover:bg-accent/50'}`}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-accent' : 'hover:bg-accent/50'}`}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>

        {viewMode === 'list' ? (
          // List view - dropdown selector
          <Select value={preset} onValueChange={handlePresetChange}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder="Select a theme" />
            </SelectTrigger>
            <SelectContent>
              {themesByCategory.map(({ category, themes }) => (
                <div key={category}>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    {categoryInfo[category]?.label || category}
                  </div>
                  {themes.map(([presetName, info]) => (
                    <SelectItem key={presetName} value={presetName}>
                      {info.name}
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        ) : (
          // Grid view - visual preview cards
          <div className="space-y-6 max-h-[400px] overflow-y-auto pr-2">
            {themesByCategory.map(({ category, themes }) => (
              <ThemeCategorySection
                key={category}
                category={category}
                themes={themes}
                selectedPreset={preset}
                isDark={isDark}
                onSelect={handlePresetChange}
              />
            ))}
          </div>
        )}

        <p className="text-sm text-muted-foreground mt-3">
          Choose a color theme for the application. Preview updates instantly.
        </p>
      </div>
    </div>
  )
}

// =============================================================================
// Compact Theme Toggle
// =============================================================================

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
      data-testid="theme-toggle"
      className="p-2 rounded-md hover:bg-accent text-foreground transition-colors"
      aria-label={`Switch to ${resolvedMode === 'dark' ? 'light' : 'dark'} mode`}
      aria-pressed={resolvedMode === 'dark'}
    >
      {resolvedMode === 'dark' ? (
        <Sun className="w-5 h-5" aria-hidden="true" />
      ) : (
        <Moon className="w-5 h-5" aria-hidden="true" />
      )}
    </button>
  )
}

// =============================================================================
// Quick Theme Selector (Compact)
// =============================================================================

/**
 * Compact theme preset selector for quick access
 * Shows popular themes as buttons
 */
export function QuickThemeSelector() {
  const { preset, setPreset, applyTheme, resolvedMode } = useThemeStore()

  const quickThemes = ['stripe', 'linear', 'obsidian', 'cyan', 'mono'] as const
  const isDark = resolvedMode === 'dark'

  const handleSelect = (theme: string) => {
    setPreset(theme as ThemePreset)
    applyTheme()
  }

  return (
    <div className="flex gap-2" data-testid="quick-theme-selector">
      {quickThemes.map((theme) => {
        const info = themeMetadata[theme]
        if (!info) return null
        const colors = isDark ? info.colors.dark : info.colors.light

        return (
          <button
            key={theme}
            type="button"
            onClick={() => handleSelect(theme)}
            data-testid={`quick-theme-${theme}`}
            data-selected={preset === theme}
            className={`
              relative p-1 rounded-md border transition-all
              ${preset === theme ? 'ring-2 ring-primary ring-offset-2' : 'hover:scale-105'}
            `}
            aria-label={`Select ${info.name} theme`}
            aria-pressed={preset === theme}
            title={info.name}
          >
            <ThemeSwatch colors={colors} />
          </button>
        )
      })}
    </div>
  )
}

