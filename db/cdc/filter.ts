/**
 * EventFilter - Filter CDC events by type/source patterns
 *
 * Supports glob-like patterns:
 * - "Thing.created" - exact match
 * - "Thing.*" - match all Thing operations
 * - "*.created" - match all created events
 * - "*.*" - match all events (wildcard)
 */

import type { UnifiedEvent } from './types'

/**
 * Event filter configuration
 */
export interface EventFilterOptions {
  /** Type patterns to include (glob-like) */
  types?: string[]
  /** Source patterns to include (glob-like) */
  sources?: string[]
  /** Type patterns to exclude */
  excludeTypes?: string[]
  /** Source patterns to exclude */
  excludeSources?: string[]
}

/**
 * Convert glob pattern to regex
 *
 * @param pattern - Glob pattern (e.g., "Thing.*", "*.created")
 * @returns RegExp for matching
 */
function globToRegex(pattern: string): RegExp {
  // First replace * with a placeholder that won't be escaped
  const placeholder = '\x00WILDCARD\x00'
  const withPlaceholder = pattern.replace(/\*/g, placeholder)

  // Escape regex special characters
  const escaped = withPlaceholder.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

  // Replace placeholder with regex pattern that matches any characters except dot
  // Use .+ for * so it requires at least one character
  const final = escaped.replace(/\x00WILDCARD\x00/g, '[^.]+')

  return new RegExp(`^${final}$`)
}

/**
 * Check if a value matches any of the patterns
 */
function matchesPatterns(value: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    const regex = globToRegex(pattern)
    return regex.test(value)
  })
}

/**
 * EventFilter - Filters events by type and source patterns
 */
export class EventFilter {
  private types: string[]
  private sources: string[]
  private excludeTypes: string[]
  private excludeSources: string[]

  constructor(options: EventFilterOptions = {}) {
    this.types = options.types ?? []
    this.sources = options.sources ?? []
    this.excludeTypes = options.excludeTypes ?? []
    this.excludeSources = options.excludeSources ?? []
  }

  /**
   * Check if a single event matches the filter
   */
  matches(event: { type?: string; ns?: string }): boolean {
    const type = event.type ?? ''
    const source = event.ns ?? ''

    // Check exclusions first
    if (this.excludeTypes.length > 0 && matchesPatterns(type, this.excludeTypes)) {
      return false
    }

    if (this.excludeSources.length > 0 && matchesPatterns(source, this.excludeSources)) {
      return false
    }

    // Check inclusions (empty means include all)
    const typeMatch = this.types.length === 0 || matchesPatterns(type, this.types)
    const sourceMatch = this.sources.length === 0 || matchesPatterns(source, this.sources)

    return typeMatch && sourceMatch
  }

  /**
   * Filter an array of events
   */
  apply<T extends { type?: string; ns?: string }>(events: T[]): T[] {
    return events.filter(event => this.matches(event))
  }
}
