/**
 * Security rules for JavaScript/TypeScript code analysis
 *
 * Rules are organized by category for maintainability.
 */

import type { ViolationType, Severity, SecurityRule } from './types'

// ============================================================================
// DANGEROUS FUNCTION RULES
// ============================================================================

/**
 * Rules for detecting dangerous function calls like eval, Function constructor
 */
export const dangerousFunctionRules: SecurityRule[] = [
  {
    type: 'dangerous_function',
    patterns: [
      /\beval\s*\(/,
    ],
    getMessage: () => 'Dangerous function: eval() can execute arbitrary code',
    severity: 'error',
    suggestion: 'Use JSON.parse() for JSON data or consider a safer alternative',
  },
  {
    type: 'dangerous_function',
    patterns: [
      /\bnew\s+Function\s*\(/,
      /\bFunction\s*\(/,
    ],
    getMessage: () => 'Dangerous function: Function constructor can execute arbitrary code',
    severity: 'error',
    suggestion: 'Define functions normally or use a pre-compiled approach',
  },
  {
    type: 'dangerous_function',
    patterns: [
      /\bsetTimeout\s*\(\s*['"]/,
      /\bsetInterval\s*\(\s*['"]/,
    ],
    getMessage: (match) => {
      const fn = match[0].includes('setTimeout') ? 'setTimeout' : 'setInterval'
      return `Dangerous usage: ${fn}() with string argument executes code like eval`
    },
    severity: 'error',
    suggestion: 'Pass a function reference instead of a string',
  },
]

// ============================================================================
// CODE EXECUTION RULES
// ============================================================================

/**
 * Rules for detecting dynamic code execution patterns
 */
export const codeExecutionRules: SecurityRule[] = [
  {
    type: 'code_execution',
    patterns: [
      /\bimport\s*\(\s*[^'"]/,
    ],
    getMessage: () => 'Dynamic import: import() with variable can load arbitrary modules',
    severity: 'warning',
    skipIf: (code, match) => {
      // Allow if it's a static string import
      const afterImport = code.slice((match.index || 0) + 7).trim()
      return /^['"`]/.test(afterImport)
    },
    suggestion: 'Use static imports when possible',
  },
  {
    type: 'code_execution',
    patterns: [
      /\brequire\s*\(\s*[^'"]/,
    ],
    getMessage: () => 'Dynamic require: require() with variable can load arbitrary modules',
    severity: 'warning',
    skipIf: (code, match) => {
      // Allow if it's a static string require
      const afterRequire = code.slice((match.index || 0) + 8).trim()
      return /^['"`]/.test(afterRequire)
    },
    suggestion: 'Use static require paths',
  },
  {
    type: 'code_execution',
    patterns: [
      /\.constructor\s*\(\s*['"`]return/,
    ],
    getMessage: () => 'Constructor injection: using .constructor to create functions is dangerous',
    severity: 'error',
  },
]

// ============================================================================
// FILESYSTEM ACCESS RULES
// ============================================================================

/**
 * Rules for detecting filesystem access patterns
 */
export const filesystemRules: SecurityRule[] = [
  {
    type: 'filesystem_access',
    patterns: [
      /\bfs\s*\.\s*(?:readFile|writeFile|appendFile|unlink|rmdir|mkdir|readdir|access|stat|chmod|chown)\s*\(/,
      /\brequire\s*\(\s*['"]fs['"]\s*\)/,
      /\bfrom\s+['"]fs['"]/,
      /\bimport\s+.*\s+from\s+['"]fs['"]/,
    ],
    getMessage: () => 'Filesystem access: fs module allows reading/writing files',
    severity: 'error',
    suggestion: 'Use approved filesystem APIs or sandboxed alternatives',
  },
  {
    type: 'filesystem_access',
    patterns: [
      /\brequire\s*\(\s*['"]fs\/promises['"]\s*\)/,
      /\bfrom\s+['"]fs\/promises['"]/,
    ],
    getMessage: () => 'Filesystem access: fs/promises module allows file operations',
    severity: 'error',
    suggestion: 'Use approved filesystem APIs or sandboxed alternatives',
  },
  {
    type: 'filesystem_access',
    patterns: [
      /['"]\/etc\/[^'"]*['"]/,
      /['"]\/proc\/[^'"]*['"]/,
      /['"]\/dev\/[^'"]*['"]/,
      /['"]\/sys\/[^'"]*['"]/,
    ],
    getMessage: (match) => `Filesystem access: Attempting to access sensitive system path ${match[0]}`,
    severity: 'error',
  },
  {
    type: 'filesystem_access',
    patterns: [
      /\bpath\s*\.\s*(?:join|resolve|dirname|basename)\s*\(/,
    ],
    getMessage: () => 'Path manipulation: path module usage detected',
    severity: 'warning',
    suggestion: 'Ensure paths are properly validated and sandboxed',
  },
]

// ============================================================================
// NETWORK ACCESS RULES
// ============================================================================

/**
 * Rules for detecting network access patterns
 */
export const networkRules: SecurityRule[] = [
  {
    type: 'network_access',
    patterns: [
      /\bfetch\s*\(\s*[^'"]/,
    ],
    getMessage: () => 'Network access: fetch() with variable URL can access arbitrary endpoints',
    severity: 'warning',
    skipIf: (code, match) => {
      // Allow static URLs
      const afterFetch = code.slice((match.index || 0) + 6).trim()
      return /^['"`]/.test(afterFetch)
    },
    suggestion: 'Use an allowlist for permitted URLs',
  },
  {
    type: 'network_access',
    patterns: [
      /\brequire\s*\(\s*['"](?:http|https|net|dgram|dns)['"]\s*\)/,
      /\bfrom\s+['"](?:http|https|net|dgram|dns)['"]/,
    ],
    getMessage: () => 'Network access: Low-level network module allows arbitrary connections',
    severity: 'error',
    suggestion: 'Use approved network APIs with proper restrictions',
  },
  {
    type: 'network_access',
    patterns: [
      /\bnew\s+WebSocket\s*\(/,
    ],
    getMessage: () => 'Network access: WebSocket can establish persistent connections',
    severity: 'warning',
    suggestion: 'Ensure WebSocket endpoints are from an allowlist',
  },
  {
    type: 'network_access',
    patterns: [
      /\bXMLHttpRequest\s*\(/,
      /\bnew\s+XMLHttpRequest\b/,
    ],
    getMessage: () => 'Network access: XMLHttpRequest can make HTTP requests',
    severity: 'warning',
  },
]

// ============================================================================
// PROCESS ACCESS RULES
// ============================================================================

/**
 * Rules for detecting process/system access patterns
 */
export const processRules: SecurityRule[] = [
  {
    type: 'process_access',
    patterns: [
      /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
      /\bfrom\s+['"]child_process['"]/,
    ],
    getMessage: () => 'Process access: child_process allows executing system commands',
    severity: 'error',
    suggestion: 'Use bashx.do or approved command execution APIs',
  },
  {
    type: 'process_access',
    patterns: [
      /\bprocess\s*\.\s*(?:exit|kill|abort)\s*\(/,
    ],
    getMessage: () => 'Process control: attempting to terminate or control the process',
    severity: 'error',
  },
  {
    type: 'process_access',
    patterns: [
      /\bprocess\s*\.\s*env\b/,
    ],
    getMessage: () => 'Environment access: process.env may expose sensitive configuration',
    severity: 'warning',
    suggestion: 'Use approved secrets management instead of process.env',
  },
  {
    type: 'process_access',
    patterns: [
      /\bexecSync\s*\(/,
      /\bspawnSync\s*\(/,
      /\bexec\s*\(/,
      /\bspawn\s*\(/,
      /\bfork\s*\(/,
    ],
    getMessage: (match) => {
      const fn = match[0].replace(/\s*\($/, '')
      return `Process execution: ${fn}() can execute arbitrary system commands`
    },
    severity: 'error',
    suggestion: 'Use bashx.do for controlled command execution',
  },
]

// ============================================================================
// SECRET/CREDENTIAL EXPOSURE RULES
// ============================================================================

/**
 * Rules for detecting potential secret exposure
 */
export const secretRules: SecurityRule[] = [
  {
    type: 'secret_exposure',
    patterns: [
      /['"](?:sk|pk|api|secret|token|password|auth|key|credential)[-_]?[a-zA-Z0-9]{16,}['"]/i,
    ],
    getMessage: () => 'Secret exposure: Hardcoded API key or secret detected',
    severity: 'error',
    suggestion: 'Use environment variables or a secrets manager',
  },
  {
    type: 'secret_exposure',
    patterns: [
      /(?:password|passwd|pwd|secret|api_key|apikey|auth_token|access_token)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    ],
    getMessage: () => 'Secret exposure: Hardcoded credential assignment detected',
    severity: 'error',
    suggestion: 'Never hardcode credentials; use secure configuration',
  },
  {
    type: 'secret_exposure',
    patterns: [
      /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
      /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/,
      /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----/,
    ],
    getMessage: () => 'Secret exposure: Private key embedded in code',
    severity: 'error',
    suggestion: 'Load private keys from secure storage at runtime',
  },
  {
    type: 'secret_exposure',
    patterns: [
      /\bAKIA[0-9A-Z]{16}\b/,  // AWS Access Key
    ],
    getMessage: () => 'Secret exposure: AWS Access Key ID detected',
    severity: 'error',
    suggestion: 'Use IAM roles or secrets manager for AWS credentials',
  },
  {
    type: 'secret_exposure',
    patterns: [
      /\bghp_[a-zA-Z0-9]{36}\b/,  // GitHub Personal Access Token
      /\bgho_[a-zA-Z0-9]{36}\b/,  // GitHub OAuth Token
      /\bghu_[a-zA-Z0-9]{36}\b/,  // GitHub User-to-Server Token
      /\bghs_[a-zA-Z0-9]{36}\b/,  // GitHub Server-to-Server Token
    ],
    getMessage: () => 'Secret exposure: GitHub token detected',
    severity: 'error',
    suggestion: 'Use GitHub Apps or secrets manager for tokens',
  },
]

// ============================================================================
// PROTOTYPE POLLUTION RULES
// ============================================================================

/**
 * Rules for detecting prototype pollution vulnerabilities
 */
export const prototypePollutionRules: SecurityRule[] = [
  {
    type: 'prototype_pollution',
    patterns: [
      /__proto__/,
    ],
    getMessage: () => 'Prototype pollution: __proto__ access can modify object prototypes',
    severity: 'error',
    suggestion: 'Use Object.create(null) for dictionary objects',
  },
  {
    type: 'prototype_pollution',
    patterns: [
      /\bconstructor\s*\[\s*['"]prototype['"]\s*\]/,
      /\[\s*['"]constructor['"]\s*\]\s*\[\s*['"]prototype['"]\s*\]/,
    ],
    getMessage: () => 'Prototype pollution: Dynamic prototype access detected',
    severity: 'error',
  },
  {
    type: 'prototype_pollution',
    patterns: [
      /Object\s*\.\s*prototype\s*\[/,
      /Object\s*\.\s*prototype\s*\.\s*\w+\s*=/,
    ],
    getMessage: () => 'Prototype pollution: Modifying Object.prototype affects all objects',
    severity: 'error',
    suggestion: 'Never modify built-in prototypes',
  },
]

// ============================================================================
// INFINITE LOOP RULES
// ============================================================================

/**
 * Rules for detecting potential infinite loops
 */
export const infiniteLoopRules: SecurityRule[] = [
  {
    type: 'infinite_loop',
    patterns: [
      /while\s*\(\s*true\s*\)/i,
      /while\s*\(\s*1\s*\)/,
    ],
    getMessage: () => 'Potential infinite loop: while(true) without apparent break',
    severity: 'warning',
    skipIf: (code) => /\bbreak\b/.test(code),
    suggestion: 'Ensure the loop has a proper exit condition',
  },
  {
    type: 'infinite_loop',
    patterns: [
      /for\s*\(\s*;\s*;\s*\)/,
    ],
    getMessage: () => 'Potential infinite loop: for(;;) without apparent break',
    severity: 'warning',
    skipIf: (code) => /\bbreak\b/.test(code),
    suggestion: 'Ensure the loop has a proper exit condition',
  },
]

// ============================================================================
// RESOURCE EXHAUSTION RULES
// ============================================================================

/**
 * Rules for detecting resource exhaustion patterns
 */
export const resourceExhaustionRules: SecurityRule[] = [
  {
    type: 'resource_exhaustion',
    patterns: [
      /new\s+Array\s*\(\s*(?:1e[789]|10\s*\*\*\s*[789]|\d{8,})\s*\)/,
      /Array\s*\(\s*(?:1e[789]|10\s*\*\*\s*[789]|\d{8,})\s*\)/,
    ],
    getMessage: () => 'Resource exhaustion: Attempting to allocate extremely large array',
    severity: 'error',
    suggestion: 'Use reasonable array sizes and streaming for large data',
  },
  {
    type: 'resource_exhaustion',
    patterns: [
      /\.repeat\s*\(\s*(?:1e[6-9]|10\s*\*\*\s*[6-9]|\d{7,})\s*\)/,
    ],
    getMessage: () => 'Resource exhaustion: String.repeat() with very large count',
    severity: 'error',
    suggestion: 'Use reasonable repeat counts',
  },
  {
    type: 'resource_exhaustion',
    patterns: [
      /\*\*\s*(?:1e[3-9]|10\s*\*\*\s*[3-9]|\d{4,})/,
    ],
    getMessage: () => 'Resource exhaustion: Exponentiation with very large exponent',
    severity: 'warning',
    suggestion: 'Use BigInt for large number calculations',
  },
]

// ============================================================================
// UNSAFE DESERIALIZATION RULES
// ============================================================================

/**
 * Rules for detecting unsafe deserialization
 */
export const deserializationRules: SecurityRule[] = [
  {
    type: 'unsafe_deserialization',
    patterns: [
      /\bvm\s*\.\s*(?:runInContext|runInNewContext|runInThisContext)\s*\(/,
      /\brequire\s*\(\s*['"]vm['"]\s*\)/,
      /\bfrom\s+['"]vm['"]/,
    ],
    getMessage: () => 'Unsafe execution: vm module can execute arbitrary code',
    severity: 'error',
  },
  {
    type: 'unsafe_deserialization',
    patterns: [
      /\bvm2\b/,
      /\brequire\s*\(\s*['"]vm2['"]\s*\)/,
    ],
    getMessage: () => 'Unsafe execution: vm2 has known sandbox escapes',
    severity: 'error',
    suggestion: 'Use Workers/isolates for secure code execution',
  },
  {
    type: 'unsafe_deserialization',
    patterns: [
      /JSON\s*\.\s*parse\s*\([^)]*,\s*(?:function|=>)/,
    ],
    getMessage: () => 'Deserialization: JSON.parse with reviver function needs careful review',
    severity: 'warning',
    suggestion: 'Ensure the reviver does not execute untrusted code',
  },
]

// ============================================================================
// COMBINED RULES
// ============================================================================

/**
 * All security rules combined
 */
export const allRules: SecurityRule[] = [
  ...dangerousFunctionRules,
  ...codeExecutionRules,
  ...filesystemRules,
  ...networkRules,
  ...processRules,
  ...secretRules,
  ...prototypePollutionRules,
  ...infiniteLoopRules,
  ...resourceExhaustionRules,
  ...deserializationRules,
]
