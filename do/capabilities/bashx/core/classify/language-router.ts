/**
 * Language Router Module
 *
 * Provides unified language routing by combining language detection
 * with execution routing logic. This module serves as the single source
 * of truth for:
 *
 * 1. Language detection (delegates to language-detector.ts)
 * 2. Package manager to language mappings
 * 3. Worker availability-based routing decisions
 *
 * The LanguageRouter facade pattern allows tiered-executor and other
 * consumers to make routing decisions without duplicating language
 * detection and package manager mapping logic.
 *
 * @packageDocumentation
 */

import {
  detectLanguage,
  type SupportedLanguage,
  type LanguageDetectionResult,
} from './language-detector.js'

/**
 * Routing destinations for language execution.
 *
 * - 'polyglot': Route to language-specific worker when available
 * - 'sandbox': Route to container sandbox when no worker available
 */
export type RoutingDestination = 'polyglot' | 'sandbox'

/**
 * Result of routing analysis.
 */
export interface RoutingResult {
  /**
   * The detected language.
   */
  language: SupportedLanguage

  /**
   * Language detection details from the underlying detector.
   */
  detection: LanguageDetectionResult

  /**
   * Where to route the execution.
   */
  routeTo: RoutingDestination

  /**
   * Worker name to use (only set if routeTo is 'polyglot').
   */
  worker?: string

  /**
   * Package manager name if detected (e.g., 'pip', 'gem').
   */
  packageManager?: string
}

/**
 * Package manager to language mappings.
 *
 * Maps package manager commands to their associated language.
 * Note: npm/npx/yarn/pnpm are excluded as they go through RPC, not polyglot.
 */
const PACKAGE_MANAGER_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  // Python package managers
  pip: 'python',
  pip3: 'python',
  pipx: 'python',
  uvx: 'python',
  pyx: 'python',

  // Ruby package managers
  gem: 'ruby',
  bundle: 'ruby',

  // Note: npm, npx, yarn, pnpm go through RPC tier, not polyglot
}

/**
 * LanguageRouter - Unified facade for language detection and routing.
 *
 * Combines language detection with worker availability to determine
 * the optimal execution path for commands.
 *
 * @example
 * ```typescript
 * const router = new LanguageRouter()
 *
 * // Route Python code to polyglot worker
 * const result = router.route('python3 script.py', ['python', 'node'])
 * // { language: 'python', routeTo: 'polyglot', worker: 'python', ... }
 *
 * // Route to sandbox when no worker available
 * const result = router.route('python3 script.py', [])
 * // { language: 'python', routeTo: 'sandbox', ... }
 *
 * // Package manager routing
 * const result = router.route('pip install requests', ['python'])
 * // { language: 'python', routeTo: 'polyglot', worker: 'python', packageManager: 'pip' }
 * ```
 */
export class LanguageRouter {
  /**
   * Route a command or code snippet to the appropriate execution target.
   *
   * @param input - The command or code to route
   * @param availableWorkers - List of available language workers (e.g., ['python', 'node'])
   * @returns Routing result with language, destination, and optional worker
   */
  route(input: string, availableWorkers?: string[]): RoutingResult {
    const trimmed = input.trim()
    const workers = availableWorkers ?? []

    // Extract command name for package manager check
    const cmd = this.extractCommandName(trimmed)

    // Check if it's a package manager command
    const packageManagerLanguage = PACKAGE_MANAGER_TO_LANGUAGE[cmd]

    // Detect language using the underlying detector
    const detection = detectLanguage(trimmed)

    // Determine the effective language (package manager takes precedence if matched)
    const effectiveLanguage = packageManagerLanguage ?? detection.language

    // Check if we have a worker available for this language
    const hasWorker = workers.includes(effectiveLanguage)

    // Build the result
    const result: RoutingResult = {
      language: effectiveLanguage,
      detection,
      routeTo: hasWorker && effectiveLanguage !== 'bash' ? 'polyglot' : 'sandbox',
    }

    // Set worker if routing to polyglot
    if (result.routeTo === 'polyglot') {
      result.worker = effectiveLanguage
    }

    // Set package manager if detected
    if (packageManagerLanguage) {
      result.packageManager = cmd
    }

    return result
  }

  /**
   * Extract the command name from input.
   *
   * @param input - The input string
   * @returns The first word (command name)
   */
  private extractCommandName(input: string): string {
    const parts = input.trim().split(/\s+/)
    return parts[0] ?? ''
  }

  /**
   * Get all package manager to language mappings.
   *
   * @returns A copy of the package manager mappings
   */
  static getPackageManagerMappings(): Record<string, SupportedLanguage> {
    return { ...PACKAGE_MANAGER_TO_LANGUAGE }
  }

  /**
   * Check if a command is a known package manager.
   *
   * @param command - The command name to check
   * @returns True if the command is a package manager
   */
  static isPackageManager(command: string): boolean {
    return command in PACKAGE_MANAGER_TO_LANGUAGE
  }
}
