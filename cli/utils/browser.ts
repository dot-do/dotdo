/**
 * Browser Utility
 *
 * Provides cross-platform browser opening functionality for OAuth flows
 * and other CLI operations that require user interaction in a browser.
 */

import { exec } from 'child_process'
import { platform } from 'os'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for opening a browser
 */
export interface BrowserOptions {
  /** Preferred browser to use (e.g., 'chrome', 'firefox', 'safari') */
  browser?: string
  /** Wait for the browser to close before resolving */
  wait?: boolean
  /** Additional arguments to pass to the browser */
  args?: string[]
}

/**
 * Result of opening a browser
 */
export interface BrowserResult {
  success: boolean
  url: string
  error?: string
}

// ============================================================================
// Platform-specific browser commands
// ============================================================================

/**
 * Get the command to open the default browser on the current platform
 */
function getDefaultBrowserCommand(): string {
  const os = platform()

  switch (os) {
    case 'darwin':
      return 'open'
    case 'win32':
      return 'start'
    case 'linux':
    default:
      return 'xdg-open'
  }
}

/**
 * Get the command to open a specific browser on the current platform
 */
function getSpecificBrowserCommand(browser: string): string {
  const os = platform()
  const browserLower = browser.toLowerCase()

  switch (os) {
    case 'darwin':
      // macOS uses 'open -a' to specify an application
      const macBrowsers: Record<string, string> = {
        chrome: 'Google Chrome',
        firefox: 'Firefox',
        safari: 'Safari',
        edge: 'Microsoft Edge',
        brave: 'Brave Browser',
        arc: 'Arc',
      }
      return macBrowsers[browserLower] ? `open -a "${macBrowsers[browserLower]}"` : `open -a "${browser}"`

    case 'win32':
      // Windows uses the browser executable directly
      const winBrowsers: Record<string, string> = {
        chrome: 'chrome',
        firefox: 'firefox',
        edge: 'msedge',
        brave: 'brave',
      }
      return winBrowsers[browserLower] || browser

    case 'linux':
    default:
      // Linux uses the browser executable directly
      const linuxBrowsers: Record<string, string> = {
        chrome: 'google-chrome',
        chromium: 'chromium-browser',
        firefox: 'firefox',
        brave: 'brave-browser',
      }
      return linuxBrowsers[browserLower] || browser
  }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Open a URL in the default or specified browser
 *
 * @param url - The URL to open
 * @param options - Optional browser options
 * @returns Promise resolving to the result of the operation
 *
 * @example
 * ```typescript
 * // Open in default browser
 * await openBrowser('https://example.com')
 *
 * // Open in specific browser
 * await openBrowser('https://example.com', { browser: 'chrome' })
 * ```
 */
export async function openBrowser(url: string, options?: BrowserOptions): Promise<BrowserResult> {
  return new Promise((resolve) => {
    let command: string

    if (options?.browser) {
      const browserCommand = getSpecificBrowserCommand(options.browser)
      const os = platform()

      if (os === 'darwin') {
        // macOS: open -a "App" URL
        command = `${browserCommand} "${url}"`
      } else if (os === 'win32') {
        // Windows: start browser URL
        command = `start "" "${browserCommand}" "${url}"`
      } else {
        // Linux: browser URL
        command = `${browserCommand} "${url}"`
      }
    } else {
      // Use default browser
      const defaultCommand = getDefaultBrowserCommand()

      if (platform() === 'win32') {
        command = `${defaultCommand} "" "${url}"`
      } else {
        command = `${defaultCommand} "${url}"`
      }
    }

    // Add any additional arguments
    if (options?.args?.length) {
      command += ' ' + options.args.join(' ')
    }

    exec(command, (error) => {
      if (error) {
        resolve({
          success: false,
          url,
          error: error.message,
        })
      } else {
        resolve({
          success: true,
          url,
        })
      }
    })
  })
}

/**
 * Check if a browser is available on the current platform
 *
 * @param browser - The browser to check for
 * @returns Promise resolving to true if the browser is available
 */
export async function isBrowserAvailable(browser?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const command = browser
      ? getSpecificBrowserCommand(browser)
      : getDefaultBrowserCommand()

    const checkCommand = platform() === 'win32'
      ? `where ${command.split(' ')[0]}`
      : `which ${command.split(' ')[0]}`

    exec(checkCommand, (error) => {
      resolve(!error)
    })
  })
}
