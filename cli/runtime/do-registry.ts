/**
 * DO Registry
 *
 * Discovers, tracks, and manages Durable Object classes in the project.
 * Scans source files for DO class definitions and maintains a registry.
 *
 * OPTIMIZATION: TypeScript module is lazy-loaded (~100ms savings on cold start)
 */

import { Logger, createLogger } from '../utils/logger'
import * as fs from 'fs'
import * as path from 'path'

// Lazy-loaded TypeScript module for cold start optimization
// The typescript module is ~100ms to load, so we defer it until actually needed
let tsModule: typeof import('typescript') | null = null

async function getTypeScript(): Promise<typeof import('typescript')> {
  if (!tsModule) {
    tsModule = await import('typescript')
  }
  return tsModule
}

/**
 * Simple DO class info returned by AST detection
 */
export interface DOClass {
  name: string
  filePath: string
}

/**
 * Cache for parsed ASTs to avoid re-parsing the same file
 */
const astCache = new Map<string, unknown>() // ts.SourceFile, but typed as unknown for lazy loading

/**
 * Detect Durable Object classes using TypeScript AST parsing.
 * This replaces the fragile regex-based detection with proper AST analysis.
 *
 * @param content - TypeScript source code content
 * @param filePath - Path to the file (for error reporting)
 * @returns Array of detected DO classes
 */
export async function detectDOClassesAST(content: string, filePath: string): Promise<DOClass[]> {
  const ts = await getTypeScript()

  // Check cache first
  const cacheKey = `${filePath}:${content.length}:${content.slice(0, 100)}`
  let sourceFile = astCache.get(cacheKey) as import('typescript').SourceFile | undefined

  if (!sourceFile) {
    sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true // setParentNodes
    )
    astCache.set(cacheKey, sourceFile)

    // Keep cache bounded
    if (astCache.size > 100) {
      const firstKey = astCache.keys().next().value
      if (firstKey) astCache.delete(firstKey)
    }
  }

  const classes: DOClass[] = []

  function visit(node: import('typescript').Node) {
    if (ts.isClassDeclaration(node)) {
      // Check heritage clause for DurableObject or DO
      const extendsClause = node.heritageClauses?.find(
        (h) => h.token === ts.SyntaxKind.ExtendsKeyword
      )

      if (extendsClause) {
        for (const type of extendsClause.types) {
          // Get the base type name - handle both simple and namespaced references
          let typeName: string

          if (ts.isIdentifier(type.expression)) {
            typeName = type.expression.text
          } else if (ts.isPropertyAccessExpression(type.expression)) {
            // For namespaced references like cloudflare.DurableObject
            typeName = type.expression.name.text
          } else {
            // Fallback to getText for complex expressions
            typeName = type.expression.getText(sourceFile)
          }

          if (typeName === 'DurableObject' || typeName === 'DO') {
            // Get the class name
            const className = node.name?.text
            if (className) {
              classes.push({ name: className, filePath })
            }
            // Don't add anonymous classes to the list
            break
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return classes
}

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
   * Extract DO class definitions from a TypeScript file using AST parsing.
   * This replaces the old regex-based detection which had false positives.
   */
  private async extractDOClasses(filePath: string): Promise<DOClassInfo[]> {
    const content = fs.readFileSync(filePath, 'utf-8')

    // Use AST-based detection (now async)
    const detected = await detectDOClassesAST(content, filePath)

    // Enrich with method detection using AST
    const results: DOClassInfo[] = []
    for (const cls of detected) {
      const methods = await this.detectClassMethods(content, cls.name)
      results.push({
        className: cls.name,
        filePath: cls.filePath,
        exports: [cls.name],
        hasAlarm: methods.has('alarm'),
        hasFetch: methods.has('fetch'),
        hasWebSocket: methods.has('webSocketMessage') || methods.has('webSocketClose') || methods.has('webSocketError'),
      })
    }
    return results
  }

  /**
   * Detect methods in a class using AST parsing
   */
  private async detectClassMethods(content: string, className: string): Promise<Set<string>> {
    const ts = await getTypeScript()
    const methods = new Set<string>()

    const sourceFile = ts.createSourceFile(
      'temp.ts',
      content,
      ts.ScriptTarget.Latest,
      true
    )

    function visit(node: import('typescript').Node) {
      if (ts.isClassDeclaration(node) && node.name?.text === className) {
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && member.name) {
            if (ts.isIdentifier(member.name)) {
              methods.add(member.name.text)
            }
          } else if (ts.isPropertyDeclaration(member) && member.name) {
            // Check for arrow function properties like: alarm = async () => {}
            if (ts.isIdentifier(member.name) && member.initializer) {
              if (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer)) {
                methods.add(member.name.text)
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    return methods
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
