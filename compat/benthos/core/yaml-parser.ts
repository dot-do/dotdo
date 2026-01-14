/**
 * YAML Config Parser for Benthos
 * Issue: dotdo-t7lgq (GREEN phase)
 */
import YAML, { YAMLMap } from 'yaml'
import { BenthosConfig, validateConfig } from './config'

export class YAMLParseError extends Error {
  line?: number
  column?: number

  constructor(message: string, line?: number, column?: number) {
    super(line ? `${message} (line ${line})` : message)
    this.name = 'YAMLParseError'
    this.line = line
    this.column = column
  }
}

interface ParseOptions {
  strict?: boolean
}

/**
 * Parse YAML string to JavaScript object
 */
export function parseYAML(source: string, options?: ParseOptions): Record<string, unknown> {
  if (!source.trim()) {
    return {}
  }

  try {
    const doc = YAML.parseDocument(source, {
      strict: options?.strict ?? false,
      uniqueKeys: options?.strict ?? false,
      merge: true, // Enable << merge key support
      // Enable YAML 1.1 boolean parsing (yes/no, on/off)
      schema: 'yaml-1.1'
    })

    if (doc.errors.length > 0) {
      const error = doc.errors[0]
      const pos = error.pos?.[0]
      let line: number | undefined

      if (pos !== undefined) {
        // Count newlines to find line number
        const beforeError = source.slice(0, pos)
        line = (beforeError.match(/\n/g) || []).length + 1
      }

      throw new YAMLParseError(error.message, line)
    }

    if (options?.strict && doc.warnings.length > 0) {
      for (const warning of doc.warnings) {
        if (warning.message.includes('duplicate') || warning.message.includes('Map keys')) {
          throw new YAMLParseError(`Duplicate key found`, undefined)
        }
      }
    }

    const result = doc.toJS()
    return result ?? {}
  } catch (e) {
    if (e instanceof YAMLParseError) throw e
    if (e instanceof YAML.YAMLParseError) {
      throw new YAMLParseError(e.message, e.linePos?.[0]?.line)
    }
    throw new YAMLParseError(String(e))
  }
}

/**
 * Resolve environment variables in a string
 * Supports: ${VAR}, ${VAR:default}, ${VAR:-default}
 */
export function resolveEnvVars(input: string): string {
  // Match ${VAR}, ${VAR:default}, ${VAR:-default}
  return input.replace(/\$\{([^}]+)\}/g, (match, content) => {
    // Check for :- syntax (use default if empty or unset)
    let colonDashMatch = content.match(/^([^:]+):-(.*)$/)
    if (colonDashMatch) {
      const [, varName, defaultValue] = colonDashMatch
      const value = process.env[varName]
      if (value === undefined || value === '') {
        return defaultValue
      }
      return value
    }

    // Check for : syntax (use default if unset)
    let colonMatch = content.match(/^([^:]+):(.*)$/)
    if (colonMatch) {
      const [, varName, defaultValue] = colonMatch
      const value = process.env[varName]
      if (value === undefined) {
        return defaultValue
      }
      return value
    }

    // Plain variable
    const value = process.env[content]
    if (value === undefined) {
      throw new Error(`Environment variable ${content} is not set`)
    }
    return value
  })
}

/**
 * Recursively resolve environment variables in an object
 */
function resolveEnvVarsInObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return resolveEnvVars(obj)
  }

  if (Array.isArray(obj)) {
    return obj.map(item => resolveEnvVarsInObject(item))
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVarsInObject(value)
    }
    return result
  }

  return obj
}

/**
 * Resolve !include directives in YAML
 * The fileResolver is a function that returns file contents by path
 */
export async function resolveIncludes(
  source: string,
  files: Record<string, string>
): Promise<Record<string, unknown>> {
  // Parse YAML with custom include tag
  function parseWithIncludes(content: string): unknown {
    const doc = YAML.parseDocument(content, {
      customTags: [
        {
          tag: '!include',
          identify: () => false,
          resolve(str: string) {
            return { __include: str }
          }
        }
      ]
    })
    return doc.toJS()
  }

  // Recursively resolve includes
  async function resolve(obj: unknown, baseDir: string): Promise<unknown> {
    if (obj !== null && typeof obj === 'object') {
      if ('__include' in (obj as Record<string, unknown>)) {
        const includePath = (obj as Record<string, unknown>).__include as string
        const fullPath = resolvePath(baseDir, includePath)
        const content = files[fullPath]

        if (!content) {
          throw new Error(`Include file not found: ${fullPath}`)
        }

        // Parse included file and resolve its includes from the correct directory
        const includeDir = dirname(fullPath)
        const parsed = parseWithIncludes(content)
        return resolve(parsed, includeDir)
      }

      if (Array.isArray(obj)) {
        return Promise.all(obj.map(item => resolve(item, baseDir)))
      }

      const entries = await Promise.all(
        Object.entries(obj).map(async ([key, value]) => [key, await resolve(value, baseDir)])
      )
      return Object.fromEntries(entries)
    }
    return obj
  }

  const result = parseWithIncludes(source)
  return await resolve(result, '') as Record<string, unknown>
}

function resolvePath(baseDir: string, includePath: string): string {
  if (includePath.startsWith('./')) {
    // baseDir is already a directory (not a file path)
    return baseDir ? `${baseDir}/${includePath.slice(2)}` : includePath.slice(2)
  }
  return includePath
}

function dirname(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  return lastSlash > 0 ? path.slice(0, lastSlash) : ''
}

/**
 * Parse YAML config with environment variable resolution and validation
 */
export function parseYAMLConfig(source: string): BenthosConfig {
  // Parse YAML
  const raw = parseYAML(source)

  // Resolve environment variables
  const resolved = resolveEnvVarsInObject(raw) as BenthosConfig

  // Validate
  validateConfig(resolved)

  return resolved
}
