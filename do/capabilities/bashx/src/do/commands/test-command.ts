/**
 * Test Command Implementation
 *
 * Implements the POSIX `test` / `[` command for condition evaluation.
 * Supports file tests, string tests, numeric comparisons, and logical operations.
 *
 * @module bashx/do/commands/test-command
 */

import type { FsCapability, FsStats } from '../../types.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Result from test command execution
 */
export interface TestResult {
  /** Exit code: 0 for true, 1 for false, 2 for error */
  exitCode: number
  /** Standard error output (for errors only) */
  stderr: string
}

/**
 * File information needed for test operations
 */
export interface FileInfo {
  exists: boolean
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
  isBlockDevice: boolean
  isCharDevice: boolean
  isPipe: boolean
  isSocket: boolean
  size: number
  mode: number
  mtime: Date
  readable: boolean
  writable: boolean
  executable: boolean
}

/**
 * Function to get file information
 */
export type FileInfoProvider = (path: string) => Promise<FileInfo | null>

// ============================================================================
// Test Command Implementation
// ============================================================================

/**
 * Execute the test command.
 *
 * Evaluates conditional expressions for file tests, string comparisons,
 * numeric comparisons, and logical operations.
 *
 * @param args - Command arguments (expression to evaluate)
 * @param getFileInfo - Optional function to get file info (for file tests)
 * @returns Promise resolving to TestResult with exitCode and stderr
 *
 * @example
 * ```typescript
 * // String test
 * await executeTest(['-n', 'hello'])  // { exitCode: 0, stderr: '' }
 *
 * // Numeric comparison
 * await executeTest(['5', '-gt', '3'])  // { exitCode: 0, stderr: '' }
 *
 * // File test (with fs provider)
 * await executeTest(['-f', '/path/to/file'], getFileInfo)
 * ```
 */
export async function executeTest(
  args: string[],
  getFileInfo?: FileInfoProvider
): Promise<TestResult> {
  // Handle [ ] bracket form - must end with ]
  if (args[0] === '[') {
    args = args.slice(1)
    if (args.length > 0 && args[args.length - 1] === ']') {
      args = args.slice(0, -1)
    } else {
      return { exitCode: 2, stderr: 'test: missing ]' }
    }
  }

  // Empty expression is false
  if (args.length === 0) {
    return { exitCode: 1, stderr: '' }
  }

  try {
    const result = await evaluateExpression(args, getFileInfo)
    return { exitCode: result ? 0 : 1, stderr: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stderr: `test: ${message}` }
  }
}

/**
 * Create a file info provider from FsCapability
 */
export function createFileInfoProvider(fs: FsCapability): FileInfoProvider {
  return async (path: string): Promise<FileInfo | null> => {
    try {
      const exists = await fs.exists(path)
      if (!exists) {
        return null
      }

      const stats = await fs.stat(path)

      // Cast to extended stats type for optional method access
      type ExtendedStats = FsStats & {
        mode?: number
        isSymbolicLink?: () => boolean
        isBlockDevice?: () => boolean
        isCharacterDevice?: () => boolean
        isFIFO?: () => boolean
        isSocket?: () => boolean
      }
      const extStats = stats as ExtendedStats

      // Get mode from stats if available, otherwise use defaults
      const mode = extStats.mode ?? 0o644

      return {
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        isSymlink: typeof extStats.isSymbolicLink === 'function'
          ? extStats.isSymbolicLink()
          : false,
        isBlockDevice: typeof extStats.isBlockDevice === 'function'
          ? extStats.isBlockDevice()
          : false,
        isCharDevice: typeof extStats.isCharacterDevice === 'function'
          ? extStats.isCharacterDevice()
          : false,
        isPipe: typeof extStats.isFIFO === 'function'
          ? extStats.isFIFO()
          : false,
        isSocket: typeof extStats.isSocket === 'function'
          ? extStats.isSocket()
          : false,
        size: stats.size,
        mode,
        mtime: stats.mtime,
        readable: (mode & 0o444) !== 0,
        writable: (mode & 0o222) !== 0,
        executable: (mode & 0o111) !== 0,
      }
    } catch {
      return null
    }
  }
}

// ============================================================================
// Expression Evaluation
// ============================================================================

/**
 * Evaluate a test expression
 */
async function evaluateExpression(
  tokens: string[],
  getFileInfo?: FileInfoProvider
): Promise<boolean> {
  // Process parentheses first
  tokens = await processParentheses(tokens, getFileInfo)

  // Handle negation (!)
  if (tokens[0] === '!') {
    return !(await evaluateExpression(tokens.slice(1), getFileInfo))
  }

  // Handle OR (-o) - lowest precedence
  const orIdx = findOperator(tokens, '-o')
  if (orIdx > 0) {
    const left = await evaluateExpression(tokens.slice(0, orIdx), getFileInfo)
    const right = await evaluateExpression(tokens.slice(orIdx + 1), getFileInfo)
    return left || right
  }

  // Handle AND (-a)
  const andIdx = findOperator(tokens, '-a')
  if (andIdx > 0) {
    const left = await evaluateExpression(tokens.slice(0, andIdx), getFileInfo)
    const right = await evaluateExpression(tokens.slice(andIdx + 1), getFileInfo)
    return left && right
  }

  // Single value - non-empty string is true
  if (tokens.length === 1) {
    return tokens[0] !== ''
  }

  // Unary operators
  if (tokens.length === 2) {
    return evaluateUnary(tokens[0], tokens[1], getFileInfo)
  }

  // Binary operators
  if (tokens.length === 3) {
    return evaluateBinary(tokens[0], tokens[1], tokens[2], getFileInfo)
  }

  throw new Error('too many arguments')
}

/**
 * Process parentheses in expression
 */
async function processParentheses(
  tokens: string[],
  getFileInfo?: FileInfoProvider
): Promise<string[]> {
  const result = [...tokens]
  let i = 0

  while (i < result.length) {
    if (result[i] === '(') {
      let depth = 1
      let j = i + 1
      while (j < result.length && depth > 0) {
        if (result[j] === '(') depth++
        if (result[j] === ')') depth--
        j++
      }
      if (depth !== 0) {
        throw new Error('unmatched (')
      }
      const subExpr = result.slice(i + 1, j - 1)
      const subResult = await evaluateExpression(subExpr, getFileInfo)
      result.splice(i, j - i, subResult ? '1' : '')
    }
    i++
  }

  return result
}

/**
 * Find operator in tokens
 */
function findOperator(tokens: string[], op: string): number {
  // Skip parenthesized groups
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '(') depth++
    else if (tokens[i] === ')') depth--
    else if (depth === 0 && tokens[i] === op) {
      return i
    }
  }
  return -1
}

/**
 * Evaluate unary test operators
 */
async function evaluateUnary(
  op: string,
  arg: string,
  getFileInfo?: FileInfoProvider
): Promise<boolean> {
  // String tests (no filesystem required)
  switch (op) {
    case '-n':
      return arg.length > 0
    case '-z':
      return arg.length === 0
    case '-t':
      // File descriptor is terminal (arg is fd number)
      // In our context, return true for fd 0,1,2
      const fd = parseInt(arg, 10)
      return fd >= 0 && fd <= 2
  }

  // Known file test operators
  const fileTestOps = [
    '-e', '-a', '-f', '-d', '-L', '-h', '-b', '-c', '-p', '-S',
    '-r', '-w', '-x', '-s', '-g', '-u', '-k', '-O', '-G', '-N'
  ]

  // Check for unknown operator
  if (!fileTestOps.includes(op)) {
    throw new Error(`unknown operator: ${op}`)
  }

  // File tests require getFileInfo
  if (!getFileInfo) {
    // Without filesystem access, file tests return false
    return false
  }

  const info = await getFileInfo(arg)

  switch (op) {
    // File existence tests
    case '-e':
      return info !== null

    case '-a':
      // -a as unary is same as -e (POSIX deprecated)
      return info !== null

    // File type tests
    case '-f':
      return info?.isFile ?? false

    case '-d':
      return info?.isDirectory ?? false

    case '-L':
    case '-h':
      return info?.isSymlink ?? false

    case '-b':
      return info?.isBlockDevice ?? false

    case '-c':
      return info?.isCharDevice ?? false

    case '-p':
      return info?.isPipe ?? false

    case '-S':
      return info?.isSocket ?? false

    // File permission tests
    case '-r':
      return info?.readable ?? false

    case '-w':
      return info?.writable ?? false

    case '-x':
      return info?.executable ?? false

    // File size test
    case '-s':
      return (info?.size ?? 0) > 0

    // Additional file tests
    case '-g':
      // Set-group-ID bit
      return ((info?.mode ?? 0) & 0o2000) !== 0

    case '-u':
      // Set-user-ID bit
      return ((info?.mode ?? 0) & 0o4000) !== 0

    case '-k':
      // Sticky bit
      return ((info?.mode ?? 0) & 0o1000) !== 0

    case '-O':
      // Owned by effective UID (assume true in our context)
      return info !== null

    case '-G':
      // Owned by effective GID (assume true in our context)
      return info !== null

    case '-N':
      // Modified since last read (not trackable, assume false)
      return false

    default:
      // Should never reach here due to fileTestOps check above
      throw new Error(`unknown operator: ${op}`)
  }
}

/**
 * Evaluate binary test operators
 */
async function evaluateBinary(
  left: string,
  op: string,
  right: string,
  getFileInfo?: FileInfoProvider
): Promise<boolean> {
  // String comparisons
  switch (op) {
    case '=':
    case '==':
      return left === right

    case '!=':
      return left !== right

    case '<':
      return left < right

    case '>':
      return left > right
  }

  // Numeric comparisons
  const leftNum = parseInt(left, 10)
  const rightNum = parseInt(right, 10)

  if (!isNaN(leftNum) && !isNaN(rightNum)) {
    switch (op) {
      case '-eq':
        return leftNum === rightNum

      case '-ne':
        return leftNum !== rightNum

      case '-lt':
        return leftNum < rightNum

      case '-le':
        return leftNum <= rightNum

      case '-gt':
        return leftNum > rightNum

      case '-ge':
        return leftNum >= rightNum
    }
  } else if (['-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(op)) {
    throw new Error('integer expression expected')
  }

  // File comparisons
  if (getFileInfo) {
    const leftInfo = await getFileInfo(left)
    const rightInfo = await getFileInfo(right)

    switch (op) {
      case '-nt':
        // Newer than (by mtime)
        if (!leftInfo || !rightInfo) return leftInfo !== null
        return leftInfo.mtime > rightInfo.mtime

      case '-ot':
        // Older than (by mtime)
        if (!leftInfo || !rightInfo) return rightInfo !== null
        return leftInfo.mtime < rightInfo.mtime

      case '-ef':
        // Same file (same inode - approximate by path match)
        // In a real implementation, this would compare inodes
        return left === right && leftInfo !== null
    }
  }

  throw new Error(`unknown operator: ${op}`)
}

// ============================================================================
// Synchronous Version (for simple tests without file operations)
// ============================================================================

/**
 * Execute test command synchronously (for non-file tests only).
 *
 * This is a faster version that works without filesystem access.
 * File tests will always return false.
 *
 * @param args - Command arguments
 * @returns TestResult with exitCode and stderr
 */
export function executeTestSync(args: string[]): TestResult {
  // Handle [ ] bracket form
  if (args[0] === '[') {
    args = args.slice(1)
    if (args.length > 0 && args[args.length - 1] === ']') {
      args = args.slice(0, -1)
    } else {
      return { exitCode: 2, stderr: 'test: missing ]' }
    }
  }

  if (args.length === 0) {
    return { exitCode: 1, stderr: '' }
  }

  try {
    const result = evaluateExpressionSync(args)
    return { exitCode: result ? 0 : 1, stderr: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stderr: `test: ${message}` }
  }
}

/**
 * Evaluate expression synchronously
 */
function evaluateExpressionSync(tokens: string[]): boolean {
  // Process parentheses
  tokens = processParenthesesSync(tokens)

  // Handle negation
  if (tokens[0] === '!') {
    return !evaluateExpressionSync(tokens.slice(1))
  }

  // Handle OR
  const orIdx = findOperator(tokens, '-o')
  if (orIdx > 0) {
    return evaluateExpressionSync(tokens.slice(0, orIdx)) ||
           evaluateExpressionSync(tokens.slice(orIdx + 1))
  }

  // Handle AND
  const andIdx = findOperator(tokens, '-a')
  if (andIdx > 0) {
    return evaluateExpressionSync(tokens.slice(0, andIdx)) &&
           evaluateExpressionSync(tokens.slice(andIdx + 1))
  }

  // Single value
  if (tokens.length === 1) {
    return tokens[0] !== ''
  }

  // Unary operators
  if (tokens.length === 2) {
    return evaluateUnarySync(tokens[0], tokens[1])
  }

  // Binary operators
  if (tokens.length === 3) {
    return evaluateBinarySync(tokens[0], tokens[1], tokens[2])
  }

  throw new Error('too many arguments')
}

function processParenthesesSync(tokens: string[]): string[] {
  const result = [...tokens]
  let i = 0

  while (i < result.length) {
    if (result[i] === '(') {
      let depth = 1
      let j = i + 1
      while (j < result.length && depth > 0) {
        if (result[j] === '(') depth++
        if (result[j] === ')') depth--
        j++
      }
      if (depth !== 0) {
        throw new Error('unmatched (')
      }
      const subExpr = result.slice(i + 1, j - 1)
      const subResult = evaluateExpressionSync(subExpr)
      result.splice(i, j - i, subResult ? '1' : '')
    }
    i++
  }

  return result
}

function evaluateUnarySync(op: string, arg: string): boolean {
  switch (op) {
    case '-n':
      return arg.length > 0
    case '-z':
      return arg.length === 0
    // File tests return false without filesystem
    case '-e':
    case '-a':
    case '-f':
    case '-d':
    case '-L':
    case '-h':
    case '-b':
    case '-c':
    case '-p':
    case '-S':
    case '-r':
    case '-w':
    case '-x':
    case '-s':
    case '-g':
    case '-u':
    case '-k':
    case '-O':
    case '-G':
    case '-N':
      return false
    case '-t':
      const fd = parseInt(arg, 10)
      return fd >= 0 && fd <= 2
    default:
      throw new Error(`unknown operator: ${op}`)
  }
}

function evaluateBinarySync(left: string, op: string, right: string): boolean {
  // String comparisons
  switch (op) {
    case '=':
    case '==':
      return left === right
    case '!=':
      return left !== right
    case '<':
      return left < right
    case '>':
      return left > right
  }

  // Numeric comparisons
  const leftNum = parseInt(left, 10)
  const rightNum = parseInt(right, 10)

  if (!isNaN(leftNum) && !isNaN(rightNum)) {
    switch (op) {
      case '-eq':
        return leftNum === rightNum
      case '-ne':
        return leftNum !== rightNum
      case '-lt':
        return leftNum < rightNum
      case '-le':
        return leftNum <= rightNum
      case '-gt':
        return leftNum > rightNum
      case '-ge':
        return leftNum >= rightNum
    }
  } else if (['-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(op)) {
    throw new Error('integer expression expected')
  }

  // File comparisons without filesystem
  if (['-nt', '-ot', '-ef'].includes(op)) {
    return false
  }

  throw new Error(`unknown operator: ${op}`)
}

// ============================================================================
// Command Set Export
// ============================================================================

/**
 * Set of test-related commands handled by this module
 */
export const TEST_COMMANDS = new Set(['test', '['])

/**
 * Check if a command is a test command
 */
export function isTestCommand(cmd: string): boolean {
  return TEST_COMMANDS.has(cmd)
}
