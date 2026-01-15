/**
 * Fumadocs Icon Configuration
 *
 * Provides icon mappings for documentation navigation sections.
 * Icons are referenced by name in meta.json files and rendered
 * using Lucide React icons.
 *
 * @see https://fumadocs.dev/docs/ui/navigation
 * @see https://lucide.dev/icons
 *
 * @example
 * In meta.json:
 * ```json
 * {
 *   "title": "Getting Started",
 *   "icon": "Rocket"
 * }
 * ```
 */

import {
  Rocket,
  Code,
  Database,
  Workflow,
  Shield,
  Plug,
  Server,
  FileCode,
  BookOpen,
  Settings,
  Zap,
  GitBranch,
  Terminal,
  Network,
  type LucideIcon,
} from 'lucide-react'

/**
 * Icon name to component mapping.
 * Add new icons here as they're used in meta.json files.
 */
export const iconMap: Record<string, LucideIcon> = {
  // Getting Started / Basics
  Rocket,
  BookOpen,
  Zap,

  // Core Concepts
  Code,
  FileCode,
  Terminal,

  // Storage & Data
  Database,
  Server,

  // Workflows & Events
  Workflow,
  Network,
  GitBranch,

  // Security & Auth
  Shield,

  // Integration & APIs
  Plug,
  Settings,
}

/**
 * Get icon component by name.
 * Returns undefined if icon name is not found.
 *
 * @param name - Icon name from meta.json
 * @returns Lucide icon component or undefined
 *
 * @example
 * ```tsx
 * const Icon = getIcon('Rocket')
 * if (Icon) return <Icon className="h-4 w-4" />
 * ```
 */
export function getIcon(name: string | undefined): LucideIcon | undefined {
  if (!name) return undefined
  return iconMap[name]
}

/**
 * Default icons for documentation sections.
 * Used when no icon is specified in meta.json.
 */
export const defaultSectionIcons: Record<string, LucideIcon> = {
  'getting-started': Rocket,
  'core': Code,
  'storage': Database,
  'workflows': Workflow,
  'security': Shield,
  'api': Plug,
  'patterns': BookOpen,
  'mcp': Network,
  'fanout': GitBranch,
}

/**
 * Get icon for a section by path.
 * Falls back to default icons based on section name.
 *
 * @param sectionPath - Path segment (e.g., 'getting-started')
 * @param explicitIcon - Explicit icon name from meta.json
 * @returns Lucide icon component or undefined
 */
export function getSectionIcon(
  sectionPath: string,
  explicitIcon?: string
): LucideIcon | undefined {
  if (explicitIcon) {
    return getIcon(explicitIcon)
  }
  return defaultSectionIcons[sectionPath]
}
