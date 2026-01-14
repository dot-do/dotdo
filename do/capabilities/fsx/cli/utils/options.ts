/**
 * Command-line option parsing utilities
 */

/**
 * Known option flags and their aliases
 */
const FLAG_MAP: Record<string, string> = {
  // Long options
  long: 'long',
  all: 'all',
  parents: 'parents',
  recursive: 'recursive',
  force: 'force',
  // Short options
  l: 'long',
  a: 'all',
  p: 'parents',
  r: 'recursive',
  R: 'recursive',
  f: 'force',
}

/**
 * Parsed options result
 */
export interface ParsedOptions {
  options: Record<string, boolean>
  paths: string[]
}

/**
 * Parse command arguments into options and paths
 *
 * Supports:
 * - Long options: --long, --recursive
 * - Short options: -l, -r
 * - Combined short options: -la, -rf
 * - Stop flag parsing with --
 */
export function parseOptions(args: string[]): ParsedOptions {
  const options: Record<string, boolean> = {}
  const paths: string[] = []
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
        const mapped = FLAG_MAP[opt]
        if (mapped) {
          options[mapped] = true
        }
      } else {
        // Short options - can be combined
        const flags = arg.slice(1)
        for (const f of flags) {
          const mapped = FLAG_MAP[f]
          if (mapped) {
            options[mapped] = true
          }
        }
      }
    } else {
      paths.push(arg)
    }
  }

  return { options, paths }
}
