/**
 * Command-line option parsing utilities
 */

/**
 * Known option flags and their aliases
 */
const FLAG_MAP: Record<string, string> = {
  // Long options
  save: 'save',
  'save-dev': 'saveDev',
  'save-exact': 'saveExact',
  'save-optional': 'saveOptional',
  global: 'global',
  production: 'production',
  dev: 'dev',
  json: 'json',
  long: 'long',
  depth: 'depth',
  registry: 'registry',
  force: 'force',
  dry: 'dryRun',
  'dry-run': 'dryRun',
  // Short options
  S: 'save',
  D: 'saveDev',
  E: 'saveExact',
  O: 'saveOptional',
  g: 'global',
  l: 'long',
  f: 'force',
}

/**
 * Parsed options result
 */
export interface ParsedOptions {
  options: Record<string, boolean | string>
  packages: string[]
}

/**
 * Parse command arguments into options and package names
 *
 * Supports:
 * - Long options: --save, --global
 * - Short options: -S, -g
 * - Value options: --registry=url, --depth=2
 */
export function parseOptions(args: string[]): ParsedOptions {
  const options: Record<string, boolean | string> = {}
  const packages: string[] = []
  let stopFlags = false

  for (const arg of args) {
    // Handle -- to stop flag parsing
    if (arg === '--') {
      stopFlags = true
      continue
    }

    if (!stopFlags && arg.startsWith('-')) {
      if (arg.startsWith('--')) {
        // Long options
        const opt = arg.slice(2)
        const eqIndex = opt.indexOf('=')

        if (eqIndex !== -1) {
          // Value option: --registry=url
          const key = opt.slice(0, eqIndex)
          const value = opt.slice(eqIndex + 1)
          const mapped = FLAG_MAP[key] ?? key
          options[mapped] = value
        } else {
          // Boolean option
          const mapped = FLAG_MAP[opt] ?? opt
          options[mapped] = true
        }
      } else {
        // Short options
        const flags = arg.slice(1)
        for (const f of flags) {
          const mapped = FLAG_MAP[f]
          if (mapped) {
            options[mapped] = true
          }
        }
      }
    } else {
      packages.push(arg)
    }
  }

  return { options, packages }
}
