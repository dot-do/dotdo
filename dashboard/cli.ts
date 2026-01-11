/**
 * CLI Dashboard Entry Point
 *
 * The CLI() factory creates a terminal-based dashboard for inspecting
 * Durable Objects. It provides the same introspection capabilities as
 * the REST API and Web Admin, rendered in a TUI format.
 *
 * Features:
 * - Navigator panel for browsing Schema, Data, Compute, Platform, Storage
 * - Content area for viewing selected items
 * - REPL for search and commands
 * - Full keyboard navigation
 */

export interface CLIOptions {
  /** Path to do.config.ts file */
  config?: string
  /** Namespace to connect to */
  ns?: string
  /** Enable debug output */
  debug?: boolean
  /** Custom theme */
  theme?: 'dark' | 'light' | 'system'
  /** Output format for non-interactive mode */
  format?: 'table' | 'json' | 'yaml'
}

export interface CLIConfig {
  /** Loaded from do.config.ts */
  endpoints?: {
    api?: string
    ws?: string
  }
  /** Auth configuration */
  auth?: {
    token?: string
    provider?: string
  }
  /** Default namespace */
  defaultNs?: string
}

/** Navigator sections in the dashboard */
export type NavigatorSection = 'Schema' | 'Data' | 'Compute' | 'Platform' | 'Storage'

/** Focus areas in the dashboard */
export type FocusArea = 'navigator' | 'content' | 'repl'

/** Key event types for navigation */
export interface KeyEvent {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

/**
 * Dashboard state interface
 */
export interface DashboardState {
  /** Current focus area */
  focus: FocusArea
  /** Currently selected navigator section */
  section: NavigatorSection
  /** Selected item within current section */
  selectedItem?: string
  /** Loading state */
  loading: boolean
  /** Error message if any */
  error?: string
  /** Navigation history for escape key */
  history: Array<{ section: NavigatorSection; item?: string }>
}

/**
 * CLI Dashboard factory
 *
 * Returns a runnable async function that starts the dashboard.
 *
 * @example
 * ```typescript
 * import { CLI } from 'dotdo/dashboard'
 *
 * // Basic usage
 * const run = CLI()
 * await run()
 *
 * // With configuration
 * const run = CLI({ config: './do.config.ts', ns: 'production' })
 * await run()
 * ```
 */
export function CLI(options?: CLIOptions): () => Promise<void> {
  throw new Error('Not implemented: CLI')
}

/**
 * Load configuration from do.config.ts
 */
export function loadConfig(configPath?: string): Promise<CLIConfig> {
  throw new Error('Not implemented: loadConfig')
}

/**
 * Validate CLI options
 */
export function validateOptions(options: CLIOptions): void {
  throw new Error('Not implemented: validateOptions')
}

/**
 * Create initial dashboard state
 */
export function createInitialState(): DashboardState {
  throw new Error('Not implemented: createInitialState')
}

/**
 * Handle key press events
 */
export function handleKeyPress(state: DashboardState, event: KeyEvent): DashboardState {
  throw new Error('Not implemented: handleKeyPress')
}

/**
 * Render the dashboard layout
 */
export function renderDashboard(state: DashboardState): string {
  throw new Error('Not implemented: renderDashboard')
}

/**
 * Get items for a navigator section
 */
export function getSectionItems(section: NavigatorSection): Promise<string[]> {
  throw new Error('Not implemented: getSectionItems')
}

/**
 * Get content for selected item
 */
export function getItemContent(section: NavigatorSection, item: string): Promise<unknown> {
  throw new Error('Not implemented: getItemContent')
}
