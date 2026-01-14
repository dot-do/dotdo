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
 * Check for syntax errors in code
 */
function checkSyntax(code: string): { valid: boolean; error?: string } {
  try {
    // Try to parse the code as an async function body to support await
    new Function(`return (async () => { ${code} })()`)
    return { valid: true }
  } catch (e) {
    const error = e as Error
    return { valid: false, error: `Syntax error: ${error.message}` }
  }
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
