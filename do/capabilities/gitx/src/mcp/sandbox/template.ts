/**
 * @fileoverview Code Template Generator for Sandbox Execution
 *
 * Generates secure wrapper code for sandboxed execution.
 */

/**
 * Validates user code for dangerous patterns that could escape the sandbox
 *
 * SECURITY: This function blocks patterns that could be used to escape
 * V8 isolate sandboxing, including indirect access to Function constructor.
 */
export function validateUserCode(code: string): { valid: boolean; error?: string } {
  // Check for eval()
  if (/\beval\s*\(/.test(code)) {
    return { valid: false, error: 'eval is not allowed' }
  }

  // Check for new Function() - direct usage
  if (/\bnew\s+Function\s*\(/.test(code)) {
    return { valid: false, error: 'Function constructor not allowed' }
  }

  // Check for Function constructor via .constructor property access
  // This catches: (function(){}).constructor, (()=>{}).constructor,
  // "".constructor.constructor, [].constructor.constructor, etc.
  if (/\.constructor\b/.test(code)) {
    return { valid: false, error: 'constructor access not allowed - potential Function constructor escape' }
  }

  // Check for Function.prototype access
  if (/\bFunction\s*\.\s*prototype\b/.test(code)) {
    return { valid: false, error: 'Function.prototype access not allowed' }
  }

  // Check for process access
  if (/\bprocess\s*\./.test(code)) {
    return { valid: false, error: 'process access not allowed' }
  }

  // Check for require()
  if (/\brequire\s*\(/.test(code)) {
    return { valid: false, error: 'require is not allowed' }
  }

  // Check for dynamic import()
  // Match import( but not import statements (import x from 'y')
  if (/\bimport\s*\(/.test(code)) {
    return { valid: false, error: 'dynamic import not allowed' }
  }

  // Check for __proto__ access (prototype pollution)
  if (/__proto__/.test(code)) {
    return { valid: false, error: '__proto__ access not allowed' }
  }

  // Check for globalThis access
  if (/\bglobalThis\b/.test(code)) {
    return { valid: false, error: 'globalThis access not allowed' }
  }

  return { valid: true }
}

/**
 * Generates sandbox wrapper code for user code execution
 */
export function generateSandboxCode(userCode: string): string {
  return `
// Sandbox wrapper - intercept console.log
const logs = [];
const console = {
  log: (...args) => logs.push(args),
  error: (...args) => logs.push(['[ERROR]', ...args]),
  warn: (...args) => logs.push(['[WARN]', ...args]),
};

// Store API access
const store = globalThis.store;

export default {
  async fetch(request, env, ctx) {
    // Execute user code in async context
    const handler = async () => {
      ${userCode}
    };

    try {
      const result = await handler();
      return new Response(JSON.stringify({ result, logs }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message, logs }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
`
}
