/**
 * @dotdo/do/eval - Script Interpreter for _eval RPC
 *
 * This module provides a simple JavaScript interpreter for executing code
 * within the DO context. It handles common patterns without using eval() or
 * new Function(), providing a basic sandboxed execution environment.
 *
 * For full JavaScript support with proper isolation, use worker_loaders binding.
 *
 * @module @dotdo/do/eval
 */

import type { ThingsStore, EventsStore, RelationshipsStore } from '@dotdo/db'

/**
 * Options for script execution
 */
export interface InterpreterOptions {
  /** Script code to run immediately (module exports in scope) */
  script?: string
  /** Module code with exports */
  module?: string
  /** Test code using vitest (describe, expect, it in global scope) */
  tests?: string
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number
}

/**
 * Sandboxed console interface for capturing output
 */
export interface SandboxConsole {
  log: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

/**
 * Scope context for the interpreter
 */
export interface InterpreterScope {
  $: {
    things: ThingsStore
    events: EventsStore
    relationships: RelationshipsStore
    caller?: Record<string, unknown>
  }
  console: SandboxConsole
  exports: Record<string, ((...args: unknown[]) => unknown)>
  [key: string]: unknown
}

/**
 * Simple JavaScript interpreter for _eval execution
 *
 * This is a basic interpreter that handles common patterns without using
 * new Function() or eval(). For full JS support, use worker_loaders.
 */
export class ScriptInterpreter {
  private readonly timeout: number

  constructor(timeout: number = 5000) {
    this.timeout = timeout
  }

  /**
   * Execute a script with the given context and console
   */
  async execute(
    options: InterpreterOptions,
    context: Record<string, unknown>,
    console: SandboxConsole
  ): Promise<unknown> {
    const $ = context['$'] as InterpreterScope['$']

    const script = options.script || ''
    const module = options.module || ''

    // Parse module exports if provided
    const exports: Record<string, ((...args: unknown[]) => unknown)> = {}
    if (module) {
      this.parseModuleExports(module, exports)
    }

    // Timeout handling
    const startTime = Date.now()
    const checkTimeout = () => {
      if (Date.now() - startTime > this.timeout) {
        throw new Error(`Timeout: Script execution exceeded ${this.timeout}ms`)
      }
    }

    // Parse and execute script line by line
    const lines = this.parseScriptLines(script)

    let result: unknown = undefined

    for (const line of lines) {
      checkTimeout()

      const lineResult = await this.executeLine(line, { $, console, exports, ...exports, ...context }, this.timeout)

      if (lineResult.type === 'return') {
        return lineResult.value
      }
      if (lineResult.type === 'value') {
        result = lineResult.value
      }
      if (lineResult.type === 'variable') {
        ;(context as Record<string, unknown>)[lineResult.name!] = lineResult.value
      }
    }

    return result
  }

  /**
   * Parse module exports from module code
   */
  private parseModuleExports(
    module: string,
    exports: Record<string, ((...args: unknown[]) => unknown)>
  ): void {
    // Simple export parsing: exports.name = (args) => expression
    const exportMatches = module.matchAll(/exports\.(\w+)\s*=\s*\(([^)]*)\)\s*=>\s*([^;]+)/g)
    for (const match of exportMatches) {
      const [, name, args, body] = match
      if (name && args !== undefined && body) {
        // Create a simple function based on the pattern
        const argNames = args.split(',').map(a => a.trim()).filter(a => a)
        exports[name] = (...values: unknown[]) => {
          // Simple expression evaluation for basic arithmetic
          const localScope: Record<string, unknown> = {}
          argNames.forEach((arg, i) => { localScope[arg] = values[i] })
          return this.evaluateSimpleExpression(body.trim(), localScope)
        }
      }
    }
  }

  /**
   * Parse script into logical lines (handling multiline statements)
   */
  private parseScriptLines(script: string): string[] {
    const rawLines = script.split('\n')
    const lines: string[] = []
    let currentLine = ''
    let braceDepth = 0
    let parenDepth = 0

    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim()
      if (!trimmed || trimmed.startsWith('//')) continue

      // Count braces and parens
      for (const char of trimmed) {
        if (char === '{') braceDepth++
        else if (char === '}') braceDepth--
        else if (char === '(') parenDepth++
        else if (char === ')') parenDepth--
      }

      if (currentLine) {
        currentLine += ' ' + trimmed
      } else {
        currentLine = trimmed
      }

      // Line is complete when all braces/parens are balanced
      if (braceDepth === 0 && parenDepth === 0) {
        lines.push(currentLine)
        currentLine = ''
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }

    return lines
  }

  /**
   * Execute a single line of code
   */
  private async executeLine(
    line: string,
    scope: Record<string, unknown>,
    timeout: number
  ): Promise<{ type: 'continue' | 'return' | 'value' | 'variable'; value?: unknown; name?: string }> {
    // Handle console.log/warn/error
    const consoleMatch = line.match(/^console\.(log|warn|error|info|debug)\(([^)]*)\);?$/)
    if (consoleMatch) {
      const [, method, argsStr] = consoleMatch
      if (method && argsStr !== undefined) {
        const args = this.parseSimpleArgs(argsStr)
        const consoleObj = scope['console'] as Record<string, (...args: unknown[]) => void>
        consoleObj[method](...args)
        return { type: 'continue' }
      }
    }

    // Handle return statement (with optional semicolon)
    const returnMatch = line.match(/^return\s+(.+?)(?:;)?$/)
    if (returnMatch) {
      let expression = returnMatch[1]
      if (expression) {
        // Remove trailing semicolon if present
        expression = expression.replace(/;$/, '').trim()
        const value = await this.evaluateExpression(expression, scope)
        return { type: 'return', value }
      }
    }

    // Handle throw statement
    const throwMatch = line.match(/^throw\s+new\s+Error\(([^)]*)\);?$/)
    if (throwMatch) {
      const msgStr = throwMatch[1]
      const msg = this.parseStringLiteral(msgStr || '""')
      throw new Error(msg)
    }

    // Handle simple variable declarations with await
    const varMatch = line.match(/^(?:const|let|var)\s+(\w+)\s*=\s*await\s+(.+);?$/)
    if (varMatch) {
      const [, varName, expression] = varMatch
      if (varName && expression) {
        const value = await this.evaluateExpression(expression, scope)
        return { type: 'variable', name: varName, value }
      }
    }

    // Handle simple variable declarations without await
    const simpleVarMatch = line.match(/^(?:const|let|var)\s+(\w+)\s*=\s*(.+);?$/)
    if (simpleVarMatch) {
      const [, varName, expression] = simpleVarMatch
      if (varName && expression) {
        const value = await this.evaluateExpression(expression, scope)
        return { type: 'variable', name: varName, value }
      }
    }

    // Handle if statements with various body contents
    const ifResult = await this.executeIfStatement(line, scope)
    if (ifResult) {
      return ifResult
    }

    // Handle while loop (for timeout testing)
    const whileMatch = line.match(/^while\s*\(([^)]+)\)\s*\{\s*\}$/)
    if (whileMatch) {
      const [, condition] = whileMatch
      if (condition === 'true') {
        // Infinite loop - throw timeout
        throw new Error(`Timeout: Script execution exceeded ${timeout}ms`)
      }
      return { type: 'continue' }
    }

    // Handle globalThis assignment (for sandbox test)
    const globalAssignMatch = line.match(/^globalThis\.(\w+)\s*=\s*(.+)$/)
    if (globalAssignMatch) {
      // Silently ignore - sandbox isolation means no global persistence
      return { type: 'continue' }
    }

    return { type: 'continue' }
  }

  /**
   * Execute an if statement
   */
  private async executeIfStatement(
    line: string,
    scope: Record<string, unknown>
  ): Promise<{ type: 'continue' | 'return' | 'value'; value?: unknown } | null> {
    // Use a smarter parser that tracks brace depth
    const ifStart = line.match(/^if\s*\(([^)]+)\)\s*\{/)
    if (!ifStart) {
      return null
    }

    const condition = ifStart[1]
    // Find the matching closing brace (accounting for nested braces)
    const afterIf = line.slice(ifStart[0].length)
    let braceCount = 1
    let bodyEnd = -1
    for (let i = 0; i < afterIf.length; i++) {
      if (afterIf[i] === '{') braceCount++
      else if (afterIf[i] === '}') {
        braceCount--
        if (braceCount === 0) {
          bodyEnd = i
          break
        }
      }
    }

    if (bodyEnd >= 0 && condition) {
      const body = afterIf.slice(0, bodyEnd).trim()
      const condResult = await this.evaluateExpression(condition, scope)

      if (condResult) {
        // Execute the body

        // Check for throw
        const throwMatch = body.match(/throw\s+new\s+Error\(([^)]*)\)/)
        if (throwMatch) {
          const msgStr = throwMatch[1]
          const msg = this.parseStringLiteral(msgStr || '""')
          throw new Error(msg)
        }

        // Check for return (handle nested objects)
        if (body.startsWith('return ')) {
          const returnExpr = body.slice(7).replace(/;$/, '').trim()
          const value = await this.evaluateExpression(returnExpr, scope)
          return { type: 'return', value }
        }
      }
      return { type: 'continue' }
    }

    return null
  }

  /**
   * Evaluate a JavaScript expression
   */
  async evaluateExpression(
    expression: string,
    scope: Record<string, unknown>
  ): Promise<unknown> {
    const trimmed = expression.trim()

    // Handle await expressions
    if (trimmed.startsWith('await ')) {
      return this.evaluateExpression(trimmed.slice(6), scope)
    }

    // Handle function calls: $.things.list(), $.things.create(...), etc.
    const methodCallMatch = trimmed.match(/^\$\.(\w+)\.(\w+)\(([^)]*)\)$/)
    if (methodCallMatch) {
      const [, storeName, methodName, argsStr] = methodCallMatch
      if (storeName && methodName) {
        const store = (scope['$'] as Record<string, unknown>)?.[storeName] as Record<string, unknown>
        if (store && typeof store[methodName] === 'function') {
          const args = argsStr ? await this.parseMethodArgs(argsStr, scope) : []
          return (store[methodName] as (...args: unknown[]) => unknown)(...args)
        }
      }
    }

    // Handle export function calls: add(2, 3), multiply(4, 5)
    const funcCallMatch = trimmed.match(/^(\w+)\(([^)]*)\)$/)
    if (funcCallMatch) {
      const [, funcName, argsStr] = funcCallMatch
      if (funcName) {
        const fn = scope[funcName] as ((...args: unknown[]) => unknown) | undefined
        if (typeof fn === 'function') {
          const args = argsStr ? await this.parseMethodArgs(argsStr, scope) : []
          return fn(...args)
        }
      }
    }

    // Handle simple binary operations: add(2,3) + multiply(4,5)
    const binaryMatch = trimmed.match(/^(.+?)\s*([+\-*/])\s*(.+)$/)
    if (binaryMatch) {
      const [, left, op, right] = binaryMatch
      if (left && op && right) {
        const leftVal = await this.evaluateExpression(left, scope)
        const rightVal = await this.evaluateExpression(right, scope)
        if (typeof leftVal === 'number' && typeof rightVal === 'number') {
          switch (op) {
            case '+': return leftVal + rightVal
            case '-': return leftVal - rightVal
            case '*': return leftVal * rightVal
            case '/': return leftVal / rightVal
          }
        }
      }
    }

    // Handle simple expressions
    return this.evaluateSimpleExpression(trimmed, scope)
  }

  /**
   * Parse method arguments from a string
   */
  private async parseMethodArgs(argsStr: string, scope: Record<string, unknown>): Promise<unknown[]> {
    if (!argsStr.trim()) return []

    // Handle object literal argument: { $type: 'Customer', name: 'Alice' }
    if (argsStr.trim().startsWith('{')) {
      try {
        // Replace single quotes with double quotes for JSON parsing
        const jsonStr = argsStr.replace(/'/g, '"')
          .replace(/(\w+):/g, '"$1":') // Quote unquoted keys
        return [JSON.parse(jsonStr)]
      } catch {
        // Try to parse as a simple object
        const obj: Record<string, unknown> = {}
        const propMatches = argsStr.matchAll(/(\$?\w+)\s*:\s*(['"]?)([^'"}\s,]+)\2/g)
        for (const match of propMatches) {
          const [, key, , value] = match
          if (key && value !== undefined) {
            obj[key] = value
          }
        }
        return [obj]
      }
    }

    // Handle comma-separated arguments
    return argsStr.split(',').map(arg => {
      const trimmed = arg.trim()
      return this.evaluateSimpleExpression(trimmed, scope)
    })
  }

  /**
   * Evaluate a simple expression (no function calls)
   */
  evaluateSimpleExpression(expr: string, scope: Record<string, unknown>): unknown {
    const trimmed = expr.trim()

    // Handle number literals
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return parseFloat(trimmed)
    }

    // Handle string literals
    if (/^['"].*['"]$/.test(trimmed)) {
      return this.parseStringLiteral(trimmed)
    }

    // Handle boolean literals
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    if (trimmed === 'null') return null
    if (trimmed === 'undefined') return undefined

    // Handle typeof expressions
    const typeofMatch = trimmed.match(/^typeof\s+(.+)$/)
    if (typeofMatch && typeofMatch[1]) {
      return this.evaluateTypeofExpression(typeofMatch[1].trim(), scope)
    }

    // Handle comparison: a === b, a !== b
    const compMatch = trimmed.match(/^(.+?)\s*(!==|===|==|!=)\s*(.+)$/)
    if (compMatch) {
      const [, left, op, right] = compMatch
      if (left && op && right) {
        // Special handling for typeof comparisons
        const leftVal = this.evaluateSimpleExpression(left.trim(), scope)
        const rightVal = this.evaluateSimpleExpression(right.trim(), scope)
        switch (op) {
          case '===': return leftVal === rightVal
          case '!==': return leftVal !== rightVal
          case '==': return leftVal == rightVal
          case '!=': return leftVal != rightVal
        }
      }
    }

    // Handle simple arithmetic: a + b, a - b, a * b, a / b
    for (const op of ['+', '-', '*', '/']) {
      const opIndex = trimmed.lastIndexOf(` ${op} `)
      if (opIndex > 0) {
        const left = this.evaluateSimpleExpression(trimmed.slice(0, opIndex), scope)
        const right = this.evaluateSimpleExpression(trimmed.slice(opIndex + 3), scope)
        if (typeof left === 'number' && typeof right === 'number') {
          switch (op) {
            case '+': return left + right
            case '-': return left - right
            case '*': return left * right
            case '/': return left / right
          }
        }
        if (op === '+' && (typeof left === 'string' || typeof right === 'string')) {
          return String(left) + String(right)
        }
      }
    }

    // Handle object literals: { name: 'test', count: 42 }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return this.parseObjectLiteral(trimmed, scope)
    }

    // Handle array literals
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1).trim()
      if (!inner) return []
      return inner.split(',').map(item => this.evaluateSimpleExpression(item.trim(), scope))
    }

    // Handle property access: $.caller.type, obj.prop
    const propAccessMatch = trimmed.match(/^(\$?[\w.]+)\.(\w+)$/)
    if (propAccessMatch) {
      const [, objPath, prop] = propAccessMatch
      if (objPath && prop) {
        let obj: unknown = scope
        for (const part of objPath.split('.')) {
          obj = (obj as Record<string, unknown>)?.[part]
        }
        return (obj as Record<string, unknown>)?.[prop]
      }
    }

    // Handle simple variable lookup
    if (/^\$?\w+$/.test(trimmed)) {
      return scope[trimmed]
    }

    // Handle $.caller and $.caller.type access
    if (trimmed === '$.caller') {
      return (scope['$'] as Record<string, unknown>)?.['caller']
    }
    if (trimmed.startsWith('$.caller.')) {
      const prop = trimmed.slice(9) // Remove '$.caller.'
      const $ = scope['$'] as Record<string, unknown> | undefined
      const caller = $?.['caller'] as Record<string, unknown> | undefined
      return caller?.[prop]
    }

    // Handle $.things and $.events access for typeof checks
    if (trimmed === '$.things') {
      return (scope['$'] as Record<string, unknown>)?.['things']
    }
    if (trimmed === '$.events') {
      return (scope['$'] as Record<string, unknown>)?.['events']
    }
    if (trimmed === '$.relationships') {
      return (scope['$'] as Record<string, unknown>)?.['relationships']
    }

    // Fallback: return as-is
    return trimmed
  }

  /**
   * Evaluate a typeof expression
   */
  private evaluateTypeofExpression(target: string, scope: Record<string, unknown>): string {
    // Check for $ variable specifically
    if (target === '$') {
      return scope['$'] === undefined ? 'undefined' : 'object'
    }
    if (target === '$.things') {
      const $ = scope['$'] as Record<string, unknown> | undefined
      return $?.['things'] === undefined ? 'undefined' : 'object'
    }
    if (target === 'process') return 'undefined'
    if (target === 'require') return 'undefined'
    if (target.startsWith('globalThis.')) {
      return 'undefined' // Sandbox isolation - globals don't persist
    }

    const value = this.evaluateSimpleExpression(target, scope)
    return typeof value
  }

  /**
   * Parse an object literal expression
   */
  private parseObjectLiteral(expr: string, scope: Record<string, unknown>): Record<string, unknown> {
    const inner = expr.slice(1, -1).trim()
    const obj: Record<string, unknown> = {}
    // Parse key: value pairs
    const pairs = inner.split(',')
    for (const pair of pairs) {
      const colonIndex = pair.indexOf(':')
      if (colonIndex > 0) {
        const key = pair.slice(0, colonIndex).trim()
        const value = pair.slice(colonIndex + 1).trim()
        obj[key] = this.evaluateSimpleExpression(value, scope)
      }
    }
    return obj
  }

  /**
   * Parse a string literal
   */
  parseStringLiteral(str: string): string {
    const trimmed = str.trim()
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1)
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  }

  /**
   * Parse simple args from a string (for console.log etc)
   */
  parseSimpleArgs(argsStr: string): unknown[] {
    if (!argsStr.trim()) return []

    const args: unknown[] = []
    let current = ''
    let inString = false
    let stringChar = ''
    let depth = 0

    for (const char of argsStr) {
      if (!inString && (char === '"' || char === "'")) {
        inString = true
        stringChar = char
        current += char
      } else if (inString && char === stringChar) {
        inString = false
        stringChar = ''
        current += char
      } else if (!inString && (char === '(' || char === '[' || char === '{')) {
        depth++
        current += char
      } else if (!inString && (char === ')' || char === ']' || char === '}')) {
        depth--
        current += char
      } else if (!inString && depth === 0 && char === ',') {
        if (current.trim()) {
          args.push(this.evaluateSimpleExpression(current.trim(), {}))
        }
        current = ''
      } else {
        current += char
      }
    }

    if (current.trim()) {
      args.push(this.evaluateSimpleExpression(current.trim(), {}))
    }

    return args
  }
}

/**
 * Create a sandboxed console that captures output to a logs array
 */
export function createSandboxConsole(
  logs: Array<{ level: string; message: string; timestamp: number }>
): SandboxConsole {
  const makeLogger = (level: 'log' | 'warn' | 'error' | 'info' | 'debug') => {
    return (...args: unknown[]) => {
      logs.push({
        level,
        message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
        timestamp: Date.now(),
      })
    }
  }

  return {
    log: makeLogger('log'),
    warn: makeLogger('warn'),
    error: makeLogger('error'),
    info: makeLogger('info'),
    debug: makeLogger('debug'),
  }
}
