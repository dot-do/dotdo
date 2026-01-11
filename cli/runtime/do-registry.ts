/**
 * DO Registry
 *
 * Discovers, tracks, and manages Durable Object classes in the project.
 * Scans source files for DO class definitions and maintains a registry.
 */

import { Logger, createLogger } from '../utils/logger'
import * as fs from 'fs'
import * as path from 'path'

export interface DOClassInfo {
  className: string
  filePath: string
  exports: string[]
  hasAlarm?: boolean
  hasFetch?: boolean
  hasWebSocket?: boolean
}

export interface DORegistryOptions {
  logger?: Logger
}

/**
 * Registry for discovering and managing Durable Object classes
 */
export class DORegistry {
  private logger: Logger
  private classes: Map<string, DOClassInfo> = new Map()

  constructor(options: DORegistryOptions = {}) {
    this.logger = options.logger ?? createLogger('registry')
  }

  /**
   * Discover DO classes from source directory
   */
  async discover(srcDir: string): Promise<Record<string, { className: string }>> {
    this.logger.debug(`Scanning ${srcDir} for Durable Objects...`)

    const files = await this.findTypeScriptFiles(srcDir)
    const discovered: Record<string, { className: string }> = {}

    for (const file of files) {
      const classes = await this.extractDOClasses(file)
      for (const cls of classes) {
        this.classes.set(cls.className, cls)
        discovered[cls.className] = { className: cls.className }
        this.logger.debug(`Found DO: ${cls.className} in ${file}`)
      }
    }

    this.logger.info(`Discovered ${Object.keys(discovered).length} Durable Objects`)
    return discovered
  }

  /**
   * Find all TypeScript files in directory recursively
   */
  private async findTypeScriptFiles(dir: string): Promise<string[]> {
    const results: string[] = []

    if (!fs.existsSync(dir)) {
      return results
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      // Skip node_modules and hidden directories
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
          continue
        }
        results.push(...await this.findTypeScriptFiles(fullPath))
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        results.push(fullPath)
      }
    }

    return results
  }

  /**
   * Extract DO class definitions from a TypeScript file
   */
  private async extractDOClasses(filePath: string): Promise<DOClassInfo[]> {
    const content = fs.readFileSync(filePath, 'utf-8')
    const classes: DOClassInfo[] = []

    // Pattern to match DO class exports
    // Matches: export class MyDO extends DurableObject
    // Matches: export class MyDO implements DurableObject
    const classPattern = /export\s+class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+[\w,\s]+)?\s*\{/g

    let match: RegExpExecArray | null
    while ((match = classPattern.exec(content)) !== null) {
      const className = match[1]
      const extendsClass = match[2]

      // Check if it's a Durable Object
      const isDO =
        extendsClass === 'DurableObject' ||
        extendsClass === 'DO' ||
        content.includes(`DurableObjectState`) ||
        content.includes(`DurableObject`) ||
        className.endsWith('DO')

      if (isDO) {
        // Extract class body for method detection
        const classBody = this.extractClassBody(content, match.index)

        classes.push({
          className,
          filePath,
          exports: [className],
          hasAlarm: classBody.includes('alarm(') || classBody.includes('alarm ='),
          hasFetch: classBody.includes('fetch(') || classBody.includes('fetch ='),
          hasWebSocket: classBody.includes('webSocketMessage') || classBody.includes('WebSocket'),
        })
      }
    }

    return classes
  }

  /**
   * Extract class body from content starting at given index
   */
  private extractClassBody(content: string, startIndex: number): string {
    let braceCount = 0
    let started = false
    let body = ''

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i]

      if (char === '{') {
        braceCount++
        started = true
      } else if (char === '}') {
        braceCount--
      }

      if (started) {
        body += char
        if (braceCount === 0) {
          break
        }
      }
    }

    return body
  }

  /**
   * Get all registered DO classes
   */
  getClasses(): DOClassInfo[] {
    return Array.from(this.classes.values())
  }

  /**
   * Get a specific DO class by name
   */
  getClass(name: string): DOClassInfo | undefined {
    return this.classes.get(name)
  }

  /**
   * List all DO class names
   */
  listNames(): string[] {
    return Array.from(this.classes.keys())
  }

  /**
   * Clear the registry
   */
  clear(): void {
    this.classes.clear()
  }
}

/**
 * Create a new DO registry instance
 */
export function createRegistry(options?: DORegistryOptions): DORegistry {
  return new DORegistry(options)
}
