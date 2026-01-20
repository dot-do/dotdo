/**
 * DO List Command - do-tqkb
 *
 * List Durable Objects via wrangler or direct API.
 * Shows namespaces and their associated objects.
 */

import { spawn, type ChildProcess } from 'child_process'
import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'

export const name = 'do-list'
export const description = 'List Durable Objects'

export interface DoListOptions {
  /** Filter by namespace */
  namespace?: string
  /** Output format */
  format?: 'table' | 'json'
  /** Path to wrangler config */
  config?: string
  /** Enable verbose output */
  verbose?: boolean
}

export interface DurableObjectNamespace {
  id: string
  name: string
  className: string
  scriptName?: string
}

export interface DurableObjectInfo {
  id: string
  name?: string
  namespace: string
  hasStorage: boolean
}

/**
 * Find wrangler binary in node_modules or global install
 */
function findWrangler(): string {
  const localWrangler = resolve(process.cwd(), 'node_modules', '.bin', 'wrangler')
  if (existsSync(localWrangler)) {
    return localWrangler
  }

  const workspaceWrangler = resolve(process.cwd(), '..', '..', 'node_modules', '.bin', 'wrangler')
  if (existsSync(workspaceWrangler)) {
    return workspaceWrangler
  }

  return 'wrangler'
}

/**
 * Parse wrangler.toml/jsonc to find DO bindings
 */
function parseWranglerConfig(configPath?: string): DurableObjectNamespace[] {
  const paths = configPath
    ? [configPath]
    : [
        resolve(process.cwd(), 'wrangler.toml'),
        resolve(process.cwd(), 'wrangler.jsonc'),
        resolve(process.cwd(), 'wrangler.json'),
      ]

  for (const path of paths) {
    if (!existsSync(path)) continue

    try {
      const content = readFileSync(path, 'utf-8')

      if (path.endsWith('.toml')) {
        // Parse TOML - basic parser for DO bindings
        const namespaces: DurableObjectNamespace[] = []
        const doBindingRegex = /\[\[durable_objects\.bindings\]\]\s*name\s*=\s*"([^"]+)"\s*class_name\s*=\s*"([^"]+)"(?:\s*script_name\s*=\s*"([^"]+)")?/g

        let match
        while ((match = doBindingRegex.exec(content)) !== null) {
          namespaces.push({
            id: `binding:${match[1]}`,
            name: match[1],
            className: match[2],
            scriptName: match[3],
          })
        }

        // Also check for new format
        const newFormatRegex = /name\s*=\s*"([^"]+)"[\s\S]*?class_name\s*=\s*"([^"]+)"/g
        while ((match = newFormatRegex.exec(content)) !== null) {
          const existing = namespaces.find((n) => n.name === match[1])
          if (!existing) {
            namespaces.push({
              id: `binding:${match[1]}`,
              name: match[1],
              className: match[2],
            })
          }
        }

        return namespaces
      } else {
        // Parse JSON/JSONC
        // Remove comments for JSONC
        const jsonContent = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
        const config = JSON.parse(jsonContent)

        const bindings = config.durable_objects?.bindings || []
        return bindings.map((binding: any) => ({
          id: `binding:${binding.name}`,
          name: binding.name,
          className: binding.class_name,
          scriptName: binding.script_name,
        }))
      }
    } catch (error) {
      // Continue to next path
    }
  }

  return []
}

/**
 * Format namespaces as a table
 */
function formatTable(namespaces: DurableObjectNamespace[]): string {
  if (namespaces.length === 0) {
    return 'No Durable Object bindings found in configuration.'
  }

  // Calculate column widths
  const nameWidth = Math.max(
    'BINDING'.length,
    ...namespaces.map((n) => n.name.length)
  )
  const classWidth = Math.max(
    'CLASS'.length,
    ...namespaces.map((n) => n.className.length)
  )
  const scriptWidth = Math.max(
    'SCRIPT'.length,
    ...namespaces.map((n) => (n.scriptName || 'local').length)
  )

  // Build table
  const lines: string[] = []

  // Header
  lines.push(
    `  ${'BINDING'.padEnd(nameWidth)}  ${'CLASS'.padEnd(classWidth)}  ${'SCRIPT'.padEnd(scriptWidth)}`
  )
  lines.push(`  ${'-'.repeat(nameWidth)}  ${'-'.repeat(classWidth)}  ${'-'.repeat(scriptWidth)}`)

  // Rows
  for (const ns of namespaces) {
    lines.push(
      `  ${ns.name.padEnd(nameWidth)}  ${ns.className.padEnd(classWidth)}  ${(ns.scriptName || 'local').padEnd(scriptWidth)}`
    )
  }

  return lines.join('\n')
}

/**
 * Main do list command function
 */
export async function doList(options: DoListOptions = {}): Promise<DurableObjectNamespace[]> {
  const { namespace, format = 'table', config, verbose = false } = options

  if (verbose) {
    console.log('[do list] Options:', options)
  }

  // Parse local config to find DO bindings
  const namespaces = parseWranglerConfig(config)

  // Filter by namespace if specified
  const filtered = namespace
    ? namespaces.filter((ns) => ns.name === namespace || ns.className === namespace)
    : namespaces

  // Output
  if (format === 'json') {
    console.log(JSON.stringify(filtered, null, 2))
  } else {
    console.log('')
    console.log('  \x1b[36mDurable Object Bindings\x1b[0m')
    console.log('')
    console.log(formatTable(filtered))
    console.log('')
  }

  return filtered
}

/**
 * CLI command handler
 */
export function doListCommand(options: DoListOptions = {}): Promise<DurableObjectNamespace[]> {
  return doList(options)
}
