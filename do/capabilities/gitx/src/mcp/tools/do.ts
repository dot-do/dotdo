import { ObjectStoreProxy } from '../sandbox/object-store-proxy'
import { validateUserCode } from '../sandbox/template'
import { evaluateWithMiniflare } from '../sandbox/miniflare-evaluator'

export interface DoToolInput {
  code: string
  timeout?: number
}

export interface DoToolOutput {
  success: boolean
  result?: unknown
  error?: string
  logs: string[]
  duration: number
}

const DEFAULT_TIMEOUT = 5000

/**
 * Additional security validations beyond validateUserCode
 */
function validateSecurity(code: string): { valid: boolean; error?: string } {
  // Check for globalThis manipulation
  if (/\bglobalThis\b/.test(code)) {
    return { valid: false, error: 'globalThis access is forbidden' }
  }

  return { valid: true }
}

/**
 * Check for basic syntax issues in code without using eval/Function constructor.
 *
 * SECURITY: We do NOT use the Function constructor for syntax checking as it
 * can execute code in unexpected ways. Instead, we perform basic structural
 * validation and let the Miniflare sandbox catch actual syntax errors during
 * safe Worker-based execution.
 */
function checkSyntax(code: string): { valid: boolean; error?: string } {
  // Check for balanced brackets, braces, and parentheses
  const brackets: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const closingBrackets = new Set([')', ']', '}'])
  const stack: string[] = []
  let inString: string | null = null
  let escaped = false

  for (let i = 0; i < code.length; i++) {
    const char = code[i]

    // Handle escape sequences in strings
    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\' && inString) {
      escaped = true
      continue
    }

    // Track string boundaries
    if ((char === '"' || char === "'" || char === '`') && !inString) {
      inString = char
      continue
    }
    if (char === inString) {
      inString = null
      continue
    }

    // Skip characters inside strings
    if (inString) continue

    // Track bracket balance
    if (brackets[char]) {
      stack.push(brackets[char])
    } else if (closingBrackets.has(char)) {
      if (stack.length === 0 || stack.pop() !== char) {
        return { valid: false, error: `Syntax error: unbalanced '${char}'` }
      }
    }
  }

  // Check for unclosed strings
  if (inString) {
    return { valid: false, error: `Syntax error: unclosed string literal` }
  }

  // Check for unclosed brackets
  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1]
    const opening = Object.entries(brackets).find(([_, v]) => v === unclosed)?.[0]
    return { valid: false, error: `Syntax error: unclosed '${opening}'` }
  }

  // Check for common syntax patterns that indicate issues
  // Empty return statements at the end are valid
  const trimmed = code.trim()

  // Check for obviously incomplete statements
  if (/^\s*(const|let|var|function|class|import|export)\s*$/.test(trimmed)) {
    return { valid: false, error: 'Syntax error: incomplete statement' }
  }

  // Check for trailing operators that suggest incomplete expressions
  if (/[+\-*/%=<>!&|,]\s*$/.test(trimmed) && !trimmed.endsWith('=>') && !trimmed.endsWith('++') && !trimmed.endsWith('--')) {
    return { valid: false, error: 'Syntax error: expression expected after operator' }
  }

  return { valid: true }
}

/**
 * Wrap user code to inject store access
 * @internal Reserved for future sandboxed code execution
 */
function _wrapCodeWithStore(code: string, _objectStore: ObjectStoreProxy): string {
  // Serialize store methods for injection
  return `
    const store = {
      getObject: async (sha) => {
        return await __store__.getObject(sha);
      },
      putObject: async (type, data) => {
        return await __store__.putObject(type, data);
      },
      listObjects: async (options) => {
        return await __store__.listObjects(options);
      }
    };
    ${code}
  `
}
void _wrapCodeWithStore // Preserve for future sandboxed execution

export async function executeDo(
  input: DoToolInput,
  objectStore: ObjectStoreProxy
): Promise<DoToolOutput> {
  const startTime = performance.now()
  const timeout = input.timeout ?? DEFAULT_TIMEOUT

  // Validate empty code
  if (!input.code || input.code.trim() === '') {
    return {
      success: false,
      error: 'Code is required and cannot be empty',
      logs: [],
      duration: performance.now() - startTime
    }
  }

  // Validate code for dangerous patterns using the sandbox template validation
  const validation = validateUserCode(input.code)
  if (!validation.valid) {
    return {
      success: false,
      error: `Security: ${validation.error}`,
      logs: [],
      duration: performance.now() - startTime
    }
  }

  // Additional security checks
  const securityCheck = validateSecurity(input.code)
  if (!securityCheck.valid) {
    return {
      success: false,
      error: `Security: ${securityCheck.error}`,
      logs: [],
      duration: performance.now() - startTime
    }
  }

  // Check for syntax errors
  const syntaxCheck = checkSyntax(input.code)
  if (!syntaxCheck.valid) {
    return {
      success: false,
      error: syntaxCheck.error,
      logs: [],
      duration: performance.now() - startTime
    }
  }

  // Execute using miniflare evaluator - store is injected via the evaluator
  const result = await evaluateWithMiniflare(input.code, {
    timeout,
    objectStore
  })

  return {
    success: result.success,
    result: result.value,
    error: result.error,
    logs: result.logs,
    duration: result.duration
  }
}

export const doToolDefinition = {
  name: 'do',
  description: 'Execute JavaScript code with access to the git object store',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 5000)' }
    },
    required: ['code']
  }
}
