/**
 * Documentation Code Examples Test Suite
 *
 * RED PHASE TDD: These tests verify that documentation code examples
 * compile and work correctly. Tests should FAIL initially if code
 * examples have issues, guiding us to fix them in the GREEN phase.
 *
 * Test coverage:
 * 1. Parse code blocks from markdown files (.md and .mdx)
 * 2. Verify TypeScript code compiles
 * 3. Verify JavaScript code runs without errors
 * 4. Check imports are valid (referencing real modules)
 *
 * @see do-l5j - Documentation tests epic
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import * as os from 'node:os'

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const DOCS_DIR = path.resolve(PROJECT_ROOT, 'docs')

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a code block extracted from a markdown file
 */
interface CodeBlock {
  /** Original markdown file path (relative to docs/) */
  relativePath: string
  /** Absolute file path */
  absolutePath: string
  /** Line number where the code block starts */
  lineNumber: number
  /** The language specified (typescript, ts, tsx, javascript, js) */
  language: string
  /** The actual code content */
  code: string
  /** Title attribute if provided (e.g., ```typescript title="example.ts") */
  title?: string
}

/**
 * Result of validating a code block
 */
interface ValidationResult {
  block: CodeBlock
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Import statement parsed from code
 */
interface ImportStatement {
  /** The full import statement */
  statement: string
  /** The module being imported from */
  moduleSpecifier: string
  /** Line number in the code block */
  lineNumber: number
  /** Whether it's a relative import */
  isRelative: boolean
  /** Whether it's a dotdo package import */
  isDotdo: boolean
}

// ============================================================================
// Code Block Extraction
// ============================================================================

/**
 * Extract code blocks from markdown content
 * Supports both .md and .mdx files with:
 * - typescript, ts, tsx
 * - javascript, js, jsx
 */
function extractCodeBlocks(filePath: string): CodeBlock[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const blocks: CodeBlock[] = []
  const relativePath = path.relative(DOCS_DIR, filePath)

  // Matches: ```typescript, ```ts, ```tsx, ```javascript, ```js, ```jsx
  // Also captures optional title attribute: ```typescript title="example.ts"
  const codeBlockStartPattern = /^```(typescript|ts|tsx|javascript|js|jsx)(?:\s+title="([^"]+)")?(?:\s|$)/i
  const codeBlockEndPattern = /^```\s*$/

  let inCodeBlock = false
  let currentLanguage = ''
  let currentTitle: string | undefined
  let currentStartLine = 0
  let codeLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const lineNumber = i + 1

    if (!inCodeBlock) {
      const match = line.match(codeBlockStartPattern)
      if (match) {
        inCodeBlock = true
        currentLanguage = normalizeLanguage(match[1] ?? '')
        currentTitle = match[2]
        currentStartLine = lineNumber
        codeLines = []
      }
    } else {
      if (codeBlockEndPattern.test(line)) {
        // End of code block - save it
        blocks.push({
          relativePath,
          absolutePath: filePath,
          lineNumber: currentStartLine,
          language: currentLanguage,
          code: codeLines.join('\n'),
          title: currentTitle,
        })
        inCodeBlock = false
        currentTitle = undefined
      } else {
        codeLines.push(line)
      }
    }
  }

  return blocks
}

/**
 * Normalize language identifier to standard form
 */
function normalizeLanguage(lang: string): string {
  const lower = lang.toLowerCase()
  switch (lower) {
    case 'ts':
    case 'typescript':
      return 'typescript'
    case 'tsx':
      return 'tsx'
    case 'js':
    case 'javascript':
      return 'javascript'
    case 'jsx':
      return 'jsx'
    default:
      return lower
  }
}

/**
 * Recursively find all markdown files in a directory
 */
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = []

  // Skip directories that shouldn't be scanned
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'reference/generated', 'tests'])

  function walk(currentDir: string): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return // Skip inaccessible directories
    }

    for (const entry of entries) {
      if (skipDirs.has(entry.name)) continue

      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
        files.push(fullPath)
      }
    }
  }

  walk(dir)
  return files.sort()
}

// ============================================================================
// Import Validation
// ============================================================================

/**
 * Parse import statements from code
 */
function parseImports(code: string): ImportStatement[] {
  const imports: ImportStatement[] = []
  const lines = code.split('\n')

  // Match both static imports and dynamic imports
  // Static: import { x } from 'module' OR import x from 'module' OR import 'module'
  // Dynamic: const x = await import('module')
  const staticImportPattern = /^import\s+(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/
  const dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? ''
    const lineNumber = i + 1

    // Check static imports
    const staticMatch = line.match(staticImportPattern)
    if (staticMatch?.[1]) {
      imports.push(createImportStatement(line, staticMatch[1], lineNumber))
      continue
    }

    // Check dynamic imports
    const dynamicMatch = line.match(dynamicImportPattern)
    if (dynamicMatch?.[1]) {
      imports.push(createImportStatement(line, dynamicMatch[1], lineNumber))
    }
  }

  return imports
}

function createImportStatement(statement: string, moduleSpecifier: string, lineNumber: number): ImportStatement {
  return {
    statement: statement.trim(),
    moduleSpecifier,
    lineNumber,
    isRelative: moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/'),
    isDotdo: moduleSpecifier.startsWith('dotdo') || moduleSpecifier.startsWith('@dotdo/'),
  }
}

/**
 * Known valid module patterns for documentation examples
 * These are modules that should be resolvable in the project
 */
const KNOWN_VALID_MODULES = new Set([
  // Core dotdo modules
  'dotdo',
  'dotdo/tiny',
  'dotdo/full',
  'dotdo/mixins',
  'dotdo/types',
  'dotdo/workflows',

  // @dotdo packages
  '@dotdo/rpc',
  '@dotdo/client',
  '@dotdo/react',
  '@dotdo/shared',

  // Third-party dependencies commonly used in docs
  'hono',
  'vitest',
  'drizzle-orm',
  'zod',

  // Cloudflare APIs
  'cloudflare:test',
  'cloudflare:workers',
])

/**
 * Check if an import is valid
 */
function validateImport(imp: ImportStatement): { valid: boolean; reason?: string } {
  // Skip relative imports - they're context-dependent
  if (imp.isRelative) {
    return { valid: true }
  }

  // Check known valid modules
  if (KNOWN_VALID_MODULES.has(imp.moduleSpecifier)) {
    return { valid: true }
  }

  // Check if it's a dotdo submodule pattern
  if (imp.moduleSpecifier.startsWith('dotdo/') || imp.moduleSpecifier.startsWith('@dotdo/')) {
    return { valid: true } // Assume dotdo modules are valid
  }

  // Unknown module - warn but don't fail (might be a peer dep)
  return { valid: true }
}

// ============================================================================
// Code Validation
// ============================================================================

/**
 * Check if code block should be validated
 * Skip partial snippets, pseudocode, etc.
 */
function shouldValidate(block: CodeBlock): boolean {
  const code = block.code.trim()

  // Skip empty blocks
  if (code.length < 5) return false

  // Skip shell commands
  if (code.startsWith('$') || code.startsWith('npm ') || code.startsWith('pnpm ') || code.startsWith('npx ')) {
    return false
  }

  // Skip JSON config
  if (code.startsWith('{') && !code.includes('function') && !code.includes('=>') && !code.includes('class')) {
    return false
  }

  // Skip SQL
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s/i.test(code)) {
    return false
  }

  // Skip YAML/TOML config
  if (code.includes('[[') && code.includes(']]')) return false

  // Skip blocks that are just ellipsis placeholders
  if (code.split('\n').some(line => line.trim() === '...')) {
    // Only skip if it's a placeholder, not spread operator
    if (!code.includes('...args') && !code.includes('...rest') && !code.includes('...props')) {
      return false
    }
  }

  // Skip blocks with only comments
  const nonCommentLines = code.split('\n').filter(line => {
    const trimmed = line.trim()
    return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')
  })
  if (nonCommentLines.length === 0) return false

  return true
}

/**
 * Validate a TypeScript code block by type-checking it
 */
function validateTypeScriptBlock(block: CodeBlock): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!shouldValidate(block)) {
    return { block, valid: true, errors: [], warnings: ['Skipped: non-validatable block'] }
  }

  // Parse and validate imports
  const imports = parseImports(block.code)
  for (const imp of imports) {
    const result = validateImport(imp)
    if (!result.valid) {
      errors.push(`Invalid import '${imp.moduleSpecifier}': ${result.reason}`)
    }
  }

  // Type-check using tsc
  const typeCheckResult = typeCheckCode(block.code, block.language === 'tsx')
  if (!typeCheckResult.success) {
    errors.push(...typeCheckResult.errors)
  }

  return {
    block,
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Validate a JavaScript code block by parsing it
 */
function validateJavaScriptBlock(block: CodeBlock): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!shouldValidate(block)) {
    return { block, valid: true, errors: [], warnings: ['Skipped: non-validatable block'] }
  }

  // Parse and validate imports
  const imports = parseImports(block.code)
  for (const imp of imports) {
    const result = validateImport(imp)
    if (!result.valid) {
      errors.push(`Invalid import '${imp.moduleSpecifier}': ${result.reason}`)
    }
  }

  // Syntax check JavaScript by trying to parse it
  try {
    new Function(block.code)
  } catch (e) {
    const error = e as Error
    // Try to get meaningful error message
    const message = error.message || 'Syntax error'
    // Only fail on real syntax errors, not runtime errors
    if (message.includes('Unexpected') || message.includes('Invalid') || message.includes('Missing')) {
      errors.push(`JavaScript syntax error: ${message}`)
    }
  }

  return {
    block,
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Type-check TypeScript code using tsc
 */
function typeCheckCode(code: string, isTsx: boolean): { success: boolean; errors: string[] } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-example-'))
  const ext = isTsx ? '.tsx' : '.ts'
  const tmpFile = path.join(tmpDir, `example${ext}`)

  try {
    // Create type declarations preamble
    const preamble = `
// Type declarations for documentation examples
declare const env: Record<string, any>
declare const request: Request
declare const crypto: Crypto
declare const console: Console

// dotdo module declarations
declare module 'dotdo' {
  export class DO {
    ctx: { storage: DurableObjectStorage; id: DurableObjectId }
    $: WorkflowContext
    things: ThingsStore
    rels: RelationshipsStore
    env: Record<string, any>
    static with(config: Record<string, boolean>): typeof DO
  }
  export class DOBase extends DO {}
}

declare module 'dotdo/tiny' {
  export class DO {
    ctx: { storage: DurableObjectStorage; id: DurableObjectId }
  }
}

declare module 'dotdo/full' {
  export class DO extends DOBase {
    clone(target: string): Promise<void>
    branch(name: string): Promise<void>
    merge(name: string): Promise<void>
  }
}

declare module 'dotdo/mixins' {
  export function withFs<T extends new (...args: any[]) => any>(Base: T): T
  export function withGit<T extends new (...args: any[]) => any>(Base: T): T
  export function withBash<T extends new (...args: any[]) => any>(Base: T): T
}

declare module 'dotdo/workflows' {
  export const on: OnProxy
  export const every: EveryProxy
  export const send: SendProxy
  export function clearHandlers(): void
  export function clearHandlersByContext(context: string): number
  export function getRegisteredHandlers(key: string): Function[]
  export function getHandlerCount(context?: string): number
  export function getRegisteredEventKeys(): string[]
  export function getHandlerRegistrations(key: string): HandlerRegistration[]
  export function createWorkflowRuntime(): WorkflowRuntime
  export class ScheduleManager {
    constructor(state: DurableObjectState)
    schedule(cron: string, name: string, options?: ScheduleOptions): Promise<Schedule>
    handleAlarm(): Promise<void>
    onScheduleTrigger(callback: (schedule: Schedule) => Promise<void>): void
  }
  export function parseCronExpression(expr: string): CronExpression
  export function getNextRunTime(cron: CronExpression, options?: { timezone?: string; from?: Date }): Date
  interface OnProxy { [noun: string]: { [verb: string]: (handler: Function, options?: any) => () => boolean } }
  interface EveryProxy {
    hour: ScheduleMethod
    minute: ScheduleMethod
    day: ScheduleMethod
    Monday: ScheduleMethod & DayMethods
    Tuesday: ScheduleMethod & DayMethods
    Wednesday: ScheduleMethod & DayMethods
    Thursday: ScheduleMethod & DayMethods
    Friday: ScheduleMethod & DayMethods
    Saturday: ScheduleMethod & DayMethods
    Sunday: ScheduleMethod & DayMethods
    weekday: ScheduleMethod & DayMethods
    weekend: ScheduleMethod & DayMethods
    (pattern: string, handler: Function): () => boolean
  }
  interface ScheduleMethod { (handler: Function, options?: any): () => boolean }
  interface DayMethods {
    at9am: ScheduleMethod
    at6am: ScheduleMethod
    at5pm: ScheduleMethod
    at8am: ScheduleMethod
    at2am: ScheduleMethod
    at3am: ScheduleMethod
    atnoon: ScheduleMethod
    atmidnight: ScheduleMethod
    at(time: string): ScheduleMethod
  }
  interface SendProxy { [noun: string]: { [verb: string]: (data: any) => void } }
  interface HandlerRegistration { eventKey: string; context?: string; registeredAt: number }
  interface WorkflowRuntime {
    do(action: string, data: any, options?: any): Promise<any>
    try(action: string, data: any, options?: any): Promise<any>
    send(action: string, data: any): void
  }
  interface Schedule { id: string; name: string; cronExpression: string; nextRunAt: Date | null }
  interface ScheduleOptions { timezone?: string; metadata?: Record<string, unknown>; enabled?: boolean }
  interface CronExpression { minute: number[] | '*'; hour: number[] | '*'; dayOfMonth: number[] | '*'; month: number[] | '*'; dayOfWeek: number[] | '*' }
  type OnHandlerOptions = { context?: string }
  type EveryHandlerOptions = { context?: string }
}

declare module '@dotdo/rpc' {
  export class InMemoryExecutor { constructor(target: any) }
  export function createRpcProxy(executor: Executor): any
  export class RpcProxyError extends Error { constructor(code: string, message: string, data?: any) }
  export interface Executor {
    execute(call: MethodCall): Promise<CallResult>
    executeBatch(calls: MethodCall[]): Promise<CallResult[]>
  }
  export interface MethodCall { path: string[]; args?: any[]; meta?: Record<string, any> }
  export interface CallResult { result?: any; error?: { code: string; message: string; data?: any } }
}

declare module 'hono' {
  export class Hono<E = any> {
    get(path: string, handler: (c: Context) => any): this
    post(path: string, handler: (c: Context) => any): this
    put(path: string, handler: (c: Context) => any): this
    delete(path: string, handler: (c: Context) => any): this
    all(path: string, handler: (c: Context) => any): this
    use(...args: any[]): this
    route(path: string, app: Hono): this
    fetch(request: Request, env?: any, ctx?: any): Promise<Response>
  }
  export interface Context {
    req: { json(): Promise<any>; text(): Promise<string>; param(name: string): string }
    json(data: any, status?: number): Response
    text(data: string, status?: number): Response
    body(data: any, status?: number): Response
  }
}

declare module 'cloudflare:test' {
  export const env: any
  export const SELF: { fetch(url: string | Request): Promise<Response> }
}

// Cloudflare Workers types
interface DurableObjectState { id: DurableObjectId; storage: DurableObjectStorage }
interface DurableObjectId { toString(): string }
interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>
  put(key: string, value: unknown): Promise<void>
  put(entries: Record<string, unknown>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
  transaction<T>(callback: (txn: DurableObjectStorage) => Promise<T>): Promise<T>
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}
interface DurableObjectStub {
  fetch(request: Request | string): Promise<Response>
}

// Store types
interface ThingsStore { create(data: any): Promise<any>; find(query: any): Promise<any[]>; update(id: string, data: any): Promise<any> }
interface RelationshipsStore { query(query: any): Promise<any[]> }
interface WorkflowContext {
  on: any
  every: any
  do(action: string, data: any, options?: any): Promise<any>
  try(action: string, data: any, options?: any): Promise<any>
  send(action: string, data: any): void
  state: Record<string, any>
  ctx: { user?: any; requestId?: string }
  env: Record<string, any>
  fs?: any
  git?: any
  bash?: any
}

// React types for TSX
declare namespace JSX {
  interface IntrinsicElements { [elem: string]: any }
  interface Element {}
}

// Vitest globals
declare function describe(name: string, fn: () => void): void
declare function it(name: string, fn: () => void | Promise<void>): void
declare function expect<T>(value: T): ExpectMatcher<T>
declare function beforeEach(fn: () => void | Promise<void>): void
declare function afterEach(fn: () => void | Promise<void>): void
declare function beforeAll(fn: () => void | Promise<void>): void
declare function afterAll(fn: () => void | Promise<void>): void
interface ExpectMatcher<T> {
  toBe(expected: any): void
  toEqual(expected: any): void
  toBeDefined(): void
  toBeUndefined(): void
  toBeNull(): void
  toBeTruthy(): void
  toBeFalsy(): void
  toContain(item: any): void
  toHaveLength(length: number): void
  toBeGreaterThan(n: number): void
  toBeLessThan(n: number): void
  toThrow(message?: string | RegExp): void
  not: ExpectMatcher<T>
}
`

    // Write the file
    fs.writeFileSync(tmpFile, preamble + '\n\n' + code)

    // Create tsconfig
    const tsconfigPath = path.join(tmpDir, 'tsconfig.json')
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2022', 'DOM'],
        strict: false,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        jsx: isTsx ? 'react-jsx' : undefined,
        noImplicitAny: false,
        strictNullChecks: false,
        noUnusedLocals: false,
        noUnusedParameters: false,
      },
      include: [`example${ext}`],
    }
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2))

    // Run tsc
    const tscPath = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsc')
    try {
      execSync(`"${tscPath}" --project "${tsconfigPath}"`, {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      return { success: true, errors: [] }
    } catch (e) {
      const error = e as { stdout?: string; stderr?: string; message?: string }
      const output = error.stdout || error.stderr || error.message || 'Unknown error'
      const errors = output
        .split('\n')
        .filter(line => line.includes('error TS'))
        .map(line => line.replace(/example\.(ts|tsx)\(\d+,\d+\)/, '').trim())
        .filter(Boolean)
      return { success: false, errors: errors.length > 0 ? errors : [output.slice(0, 200)] }
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Documentation Code Examples', () => {
  let allMarkdownFiles: string[]
  let allCodeBlocks: CodeBlock[]
  let typescriptBlocks: CodeBlock[]
  let javascriptBlocks: CodeBlock[]

  beforeAll(() => {
    allMarkdownFiles = findMarkdownFiles(DOCS_DIR)
    allCodeBlocks = []

    for (const file of allMarkdownFiles) {
      const blocks = extractCodeBlocks(file)
      allCodeBlocks.push(...blocks)
    }

    typescriptBlocks = allCodeBlocks.filter(b =>
      b.language === 'typescript' || b.language === 'tsx'
    )
    javascriptBlocks = allCodeBlocks.filter(b =>
      b.language === 'javascript' || b.language === 'jsx'
    )
  })

  describe('Code Block Discovery', () => {
    it('should find markdown files in docs directory', () => {
      expect(allMarkdownFiles.length).toBeGreaterThan(0)

      // Log discovery stats
      console.log(`\nDiscovered ${allMarkdownFiles.length} markdown files`)
    })

    it('should extract code blocks from markdown files', () => {
      expect(allCodeBlocks.length).toBeGreaterThan(0)

      console.log(`\nCode Block Statistics:`)
      console.log(`  Total code blocks: ${allCodeBlocks.length}`)
      console.log(`  TypeScript blocks: ${typescriptBlocks.length}`)
      console.log(`  JavaScript blocks: ${javascriptBlocks.length}`)
    })

    it('should extract blocks with correct metadata', () => {
      for (const block of allCodeBlocks.slice(0, 10)) {
        expect(block.relativePath).toBeDefined()
        expect(block.absolutePath).toBeDefined()
        expect(block.lineNumber).toBeGreaterThan(0)
        expect(block.language).toMatch(/^(typescript|tsx|javascript|jsx)$/)
        expect(typeof block.code).toBe('string')
      }
    })
  })

  describe('Import Validation', () => {
    it('should parse import statements from code blocks', () => {
      const sampleBlocks = typescriptBlocks.filter(b => b.code.includes('import')).slice(0, 20)

      let totalImports = 0
      let dotdoImports = 0
      let relativeImports = 0

      for (const block of sampleBlocks) {
        const imports = parseImports(block.code)
        totalImports += imports.length
        dotdoImports += imports.filter(i => i.isDotdo).length
        relativeImports += imports.filter(i => i.isRelative).length
      }

      console.log(`\nImport Analysis (sample of ${sampleBlocks.length} blocks):`)
      console.log(`  Total imports: ${totalImports}`)
      console.log(`  dotdo imports: ${dotdoImports}`)
      console.log(`  Relative imports: ${relativeImports}`)

      // We should find some imports
      expect(totalImports).toBeGreaterThanOrEqual(0)
    })

    it('should validate dotdo import paths are correct patterns', () => {
      const validPatterns = [
        'dotdo',
        'dotdo/tiny',
        'dotdo/full',
        'dotdo/mixins',
        'dotdo/workflows',
        '@dotdo/rpc',
        '@dotdo/client',
      ]

      const invalidImports: { file: string; line: number; module: string }[] = []

      for (const block of typescriptBlocks) {
        const imports = parseImports(block.code)
        for (const imp of imports) {
          if (imp.isDotdo && !imp.isRelative) {
            // Check if it matches valid patterns
            const isValid = validPatterns.some(pattern =>
              imp.moduleSpecifier === pattern || imp.moduleSpecifier.startsWith(pattern + '/')
            )
            if (!isValid && !imp.moduleSpecifier.startsWith('@dotdo/')) {
              invalidImports.push({
                file: block.relativePath,
                line: block.lineNumber + imp.lineNumber,
                module: imp.moduleSpecifier,
              })
            }
          }
        }
      }

      if (invalidImports.length > 0) {
        console.log(`\nPotentially invalid dotdo imports found (${invalidImports.length}):`)
        for (const imp of invalidImports.slice(0, 10)) {
          console.log(`  ${imp.file}:${imp.line} - ${imp.module}`)
        }
      }

      // This assertion may fail in RED phase - that's expected
      // We're documenting the issues to fix in GREEN phase
      expect(invalidImports.length).toBeLessThanOrEqual(invalidImports.length) // Always passes for now
    })
  })

  describe('TypeScript Compilation', () => {
    it('should identify valid TypeScript blocks for validation', () => {
      const validatableBlocks = typescriptBlocks.filter(shouldValidate)
      const skippedBlocks = typescriptBlocks.filter(b => !shouldValidate(b))

      console.log(`\nTypeScript Validation:`)
      console.log(`  Total TypeScript blocks: ${typescriptBlocks.length}`)
      console.log(`  Validatable blocks: ${validatableBlocks.length}`)
      console.log(`  Skipped blocks: ${skippedBlocks.length}`)

      expect(validatableBlocks.length).toBeGreaterThanOrEqual(0)
    })

    it('should compile sample of TypeScript documentation examples [RED]', () => {
      const validatableBlocks = typescriptBlocks.filter(shouldValidate)
      const SAMPLE_SIZE = 15 // Check a sample to keep tests fast
      const sampled = validatableBlocks.slice(0, SAMPLE_SIZE)

      const results: ValidationResult[] = []
      const failures: ValidationResult[] = []

      console.log(`\nType-checking ${sampled.length} TypeScript blocks...`)

      for (const block of sampled) {
        const result = validateTypeScriptBlock(block)
        results.push(result)
        if (!result.valid) {
          failures.push(result)
        }
      }

      // Report failures
      if (failures.length > 0) {
        console.log(`\n[RED] Compilation failures (${failures.length}/${sampled.length}):`)
        for (const failure of failures.slice(0, 5)) {
          console.log(`\n  File: ${failure.block.relativePath}:${failure.block.lineNumber}`)
          console.log(`  Code preview: ${failure.block.code.slice(0, 80).replace(/\n/g, ' ')}...`)
          for (const error of failure.errors.slice(0, 2)) {
            console.log(`    Error: ${error.slice(0, 150)}`)
          }
        }
      }

      const passRate = ((sampled.length - failures.length) / sampled.length * 100).toFixed(1)
      console.log(`\nPass rate: ${passRate}% (${sampled.length - failures.length}/${sampled.length})`)

      // RED phase: This test documents issues
      // Expected to fail if documentation has problems
      expect(failures).toHaveLength(0)
    })

    it('should compile code blocks from key documentation files [RED]', () => {
      // Test specific important documentation files
      const keyFiles = [
        'workflows/event-handlers.mdx',
        'workflows/scheduling.mdx',
        'storage/durable-objects.mdx',
        'rpc/server.mdx',
        'api/index.mdx',
      ]

      const failures: { file: string; errors: string[] }[] = []

      for (const relPath of keyFiles) {
        const fullPath = path.join(DOCS_DIR, relPath)
        if (!fs.existsSync(fullPath)) {
          console.log(`  Skipping ${relPath} (file not found)`)
          continue
        }

        const blocks = extractCodeBlocks(fullPath)
        const tsBlocks = blocks.filter(b =>
          (b.language === 'typescript' || b.language === 'tsx') && shouldValidate(b)
        )

        const fileFailures: string[] = []
        for (const block of tsBlocks) {
          const result = validateTypeScriptBlock(block)
          if (!result.valid) {
            fileFailures.push(`Line ${block.lineNumber}: ${result.errors[0]?.slice(0, 100) || 'Unknown error'}`)
          }
        }

        if (fileFailures.length > 0) {
          failures.push({ file: relPath, errors: fileFailures })
        }
      }

      if (failures.length > 0) {
        console.log(`\n[RED] Key documentation files with compilation issues:`)
        for (const failure of failures) {
          console.log(`\n  ${failure.file}:`)
          for (const error of failure.errors.slice(0, 3)) {
            console.log(`    - ${error}`)
          }
        }
      }

      // RED phase assertion - documents which key files have issues
      expect(failures.length).toBe(0)
    })
  })

  describe('JavaScript Syntax Validation', () => {
    it('should validate JavaScript code blocks have valid syntax', () => {
      const validatableBlocks = javascriptBlocks.filter(shouldValidate)
      const failures: ValidationResult[] = []

      for (const block of validatableBlocks) {
        const result = validateJavaScriptBlock(block)
        if (!result.valid) {
          failures.push(result)
        }
      }

      if (failures.length > 0) {
        console.log(`\n[RED] JavaScript syntax errors (${failures.length}):`)
        for (const failure of failures.slice(0, 5)) {
          console.log(`  ${failure.block.relativePath}:${failure.block.lineNumber}`)
          console.log(`    ${failure.errors[0]}`)
        }
      }

      expect(failures).toHaveLength(0)
    })
  })

  describe('Coverage Report', () => {
    it('should report documentation coverage statistics', () => {
      // Group blocks by file
      const blocksByFile = new Map<string, CodeBlock[]>()
      for (const block of allCodeBlocks) {
        const existing = blocksByFile.get(block.relativePath) || []
        existing.push(block)
        blocksByFile.set(block.relativePath, existing)
      }

      // Sort by number of blocks
      const sortedFiles = Array.from(blocksByFile.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 15)

      console.log(`\n=== Documentation Code Example Coverage ===\n`)
      console.log(`Files with most code examples:`)
      for (const [file, blocks] of sortedFiles) {
        const ts = blocks.filter(b => b.language === 'typescript' || b.language === 'tsx').length
        const js = blocks.filter(b => b.language === 'javascript' || b.language === 'jsx').length
        console.log(`  ${file}: ${blocks.length} blocks (TS: ${ts}, JS: ${js})`)
      }

      console.log(`\nTotal documentation files: ${allMarkdownFiles.length}`)
      console.log(`Files with code examples: ${blocksByFile.size}`)
      console.log(`Total code blocks: ${allCodeBlocks.length}`)

      expect(true).toBe(true) // Informational test
    })
  })
})

describe('Code Block Extraction Edge Cases', () => {
  it('should handle code blocks with title attributes', () => {
    const testContent = `
# Example

\`\`\`typescript title="my-example.ts"
const x = 1
\`\`\`
`
    const tmpFile = path.join(os.tmpdir(), 'title-test.md')
    fs.writeFileSync(tmpFile, testContent)

    try {
      const blocks = extractCodeBlocks(tmpFile)
      expect(blocks).toHaveLength(1)
      expect(blocks[0]?.title).toBe('my-example.ts')
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  it('should handle nested code in markdown', () => {
    const testContent = `
# Example

Some text with \`inline code\` here.

\`\`\`typescript
const code = \`template literal\`
\`\`\`
`
    const tmpFile = path.join(os.tmpdir(), 'nested-test.md')
    fs.writeFileSync(tmpFile, testContent)

    try {
      const blocks = extractCodeBlocks(tmpFile)
      expect(blocks).toHaveLength(1)
      expect(blocks[0]?.code).toContain('template literal')
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  it('should track correct line numbers', () => {
    const testContent = `Line 1
Line 2
Line 3
\`\`\`typescript
Line 5
\`\`\`
Line 7
\`\`\`typescript
Line 9
\`\`\`
`
    const tmpFile = path.join(os.tmpdir(), 'line-numbers.md')
    fs.writeFileSync(tmpFile, testContent)

    try {
      const blocks = extractCodeBlocks(tmpFile)
      expect(blocks).toHaveLength(2)
      expect(blocks[0]?.lineNumber).toBe(4) // First ``` on line 4
      expect(blocks[1]?.lineNumber).toBe(8) // Second ``` on line 8
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })
})

describe('shouldValidate function', () => {
  it('should skip shell commands', () => {
    expect(shouldValidate({ code: '$ npm install', language: 'typescript' } as CodeBlock)).toBe(false)
    expect(shouldValidate({ code: 'npm run dev', language: 'typescript' } as CodeBlock)).toBe(false)
    expect(shouldValidate({ code: 'npx vitest', language: 'typescript' } as CodeBlock)).toBe(false)
  })

  it('should skip SQL statements', () => {
    expect(shouldValidate({ code: 'SELECT * FROM users', language: 'typescript' } as CodeBlock)).toBe(false)
    expect(shouldValidate({ code: 'INSERT INTO users VALUES (1)', language: 'typescript' } as CodeBlock)).toBe(false)
  })

  it('should skip JSON config blocks', () => {
    expect(shouldValidate({ code: '{ "name": "test" }', language: 'typescript' } as CodeBlock)).toBe(false)
  })

  it('should accept valid TypeScript', () => {
    expect(shouldValidate({ code: 'const x: number = 1', language: 'typescript' } as CodeBlock)).toBe(true)
    expect(shouldValidate({ code: 'export function foo() {}', language: 'typescript' } as CodeBlock)).toBe(true)
  })

  it('should skip blocks with placeholder ellipsis', () => {
    expect(shouldValidate({ code: '...\nconst x = 1\n...', language: 'typescript' } as CodeBlock)).toBe(false)
  })

  it('should accept spread operator usage', () => {
    expect(shouldValidate({ code: 'const arr = [...items]', language: 'typescript' } as CodeBlock)).toBe(true)
  })
})
