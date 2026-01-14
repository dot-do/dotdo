/**
 * Safety rules for Python code analysis
 */

import type { ViolationType, Severity } from './types'

export interface SafetyRule {
  type: ViolationType
  patterns: RegExp[]
  getMessage: (match: RegExpMatchArray) => string
  severity: Severity
  /** Optional condition to skip the rule */
  skipIf?: (code: string, match: RegExpMatchArray) => boolean
}

// Dangerous imports that allow system access
export const dangerousImportRules: SafetyRule[] = [
  {
    type: 'dangerous_import',
    patterns: [
      /\bimport\s+os\b/,
      /\bfrom\s+os\s+import\b/,
    ],
    getMessage: () => 'Dangerous import: os module allows system access',
    severity: 'error',
  },
  {
    type: 'dangerous_import',
    patterns: [
      /\bimport\s+subprocess\b/,
      /\bfrom\s+subprocess\s+import\b/,
    ],
    getMessage: () => 'Dangerous import: subprocess module allows command execution',
    severity: 'error',
  },
  {
    type: 'dangerous_import',
    patterns: [
      /\bimport\s+socket\b/,
      /\bfrom\s+socket\s+import\b/,
    ],
    getMessage: () => 'Dangerous import: socket module allows network access',
    severity: 'error',
  },
  {
    type: 'dangerous_import',
    patterns: [
      /\bimport\s+pty\b/,
      /\bfrom\s+pty\s+import\b/,
    ],
    getMessage: () => 'Dangerous import: pty module allows pseudo-terminal access',
    severity: 'error',
  },
]

// Code execution patterns
export const codeExecutionRules: SafetyRule[] = [
  {
    type: 'code_execution',
    patterns: [/\bexec\s*\(/],
    getMessage: () => 'Dangerous function: exec() can execute arbitrary code',
    severity: 'error',
  },
  {
    type: 'code_execution',
    patterns: [/\beval\s*\(/],
    getMessage: () => 'Dangerous function: eval() can execute arbitrary code',
    severity: 'error',
  },
  {
    type: 'code_execution',
    patterns: [/\bcompile\s*\(/],
    getMessage: () => 'Dangerous function: compile() can compile arbitrary code',
    severity: 'error',
  },
  {
    type: 'code_execution',
    patterns: [/__import__\s*\(/],
    getMessage: () => 'Dangerous function: __import__() can import arbitrary modules',
    severity: 'error',
  },
]

// File system access patterns
export const filesystemRules: SafetyRule[] = [
  {
    type: 'filesystem_access',
    patterns: [/open\s*\(\s*['"](\/etc\/[^'"]*)['"]/],
    getMessage: (match) => `Filesystem access: Attempting to access /etc/ (${match[1]})`,
    severity: 'error',
  },
  {
    type: 'filesystem_access',
    patterns: [/open\s*\(\s*['"](\/proc\/[^'"]*)['"]/],
    getMessage: (match) => `Filesystem access: Attempting to access /proc/ (${match[1]})`,
    severity: 'error',
  },
  {
    type: 'filesystem_access',
    patterns: [/open\s*\(\s*['"](\/.+?)['"]\s*,\s*['"][wa]/],
    getMessage: (match) => `Filesystem access: Writing to absolute path ${match[1]}`,
    severity: 'error',
  },
]

// Network access patterns
export const networkRules: SafetyRule[] = [
  {
    type: 'network_access',
    patterns: [
      /\bimport\s+urllib\b/,
      /\bfrom\s+urllib\b/,
    ],
    getMessage: () => 'Network access: urllib allows HTTP requests',
    severity: 'error',
  },
  {
    type: 'network_access',
    patterns: [
      /\bimport\s+http\.client\b/,
      /\bfrom\s+http\.client\s+import\b/,
    ],
    getMessage: () => 'Network access: http.client allows HTTP connections',
    severity: 'error',
  },
  {
    type: 'network_access',
    patterns: [
      /\bimport\s+requests\b/,
      /\bfrom\s+requests\s+import\b/,
    ],
    getMessage: () => 'Network access: requests library allows HTTP requests',
    severity: 'error',
  },
  {
    type: 'network_access',
    patterns: [
      /\bimport\s+ftplib\b/,
      /\bfrom\s+ftplib\s+import\b/,
    ],
    getMessage: () => 'Network access: ftplib allows FTP connections',
    severity: 'error',
  },
]

// Dangerous attribute access patterns
export const dangerousAttributeRules: SafetyRule[] = [
  {
    type: 'dangerous_attribute',
    patterns: [/__builtins__/],
    getMessage: () => 'Dangerous attribute: __builtins__ access can bypass sandboxing',
    severity: 'error',
  },
  {
    type: 'dangerous_attribute',
    patterns: [/__globals__/],
    getMessage: () => 'Dangerous attribute: __globals__ access can expose sensitive data',
    severity: 'error',
  },
  {
    type: 'dangerous_attribute',
    patterns: [/__code__/],
    getMessage: () => 'Dangerous attribute: __code__ access can modify function behavior',
    severity: 'error',
  },
  {
    type: 'dangerous_attribute',
    patterns: [/__subclasses__/],
    getMessage: () => 'Dangerous attribute: __subclasses__ access enables class traversal attacks',
    severity: 'error',
  },
  {
    type: 'dangerous_attribute',
    patterns: [/__mro__/],
    getMessage: () => 'Dangerous attribute: __mro__ access enables method resolution order traversal',
    severity: 'error',
  },
]

// Serialization danger patterns
export const serializationRules: SafetyRule[] = [
  {
    type: 'serialization_danger',
    patterns: [
      /\bimport\s+pickle\b/,
      /\bfrom\s+pickle\s+import\b/,
    ],
    getMessage: () => 'Serialization danger: pickle can execute arbitrary code during deserialization',
    severity: 'error',
  },
  {
    type: 'serialization_danger',
    patterns: [
      /\bimport\s+cPickle\b/,
      /\bfrom\s+cPickle\s+import\b/,
    ],
    getMessage: () => 'Serialization danger: cPickle can execute arbitrary code during deserialization',
    severity: 'error',
  },
  {
    type: 'serialization_danger',
    patterns: [
      /\bimport\s+marshal\b/,
      /\bfrom\s+marshal\s+import\b/,
    ],
    getMessage: () => 'Serialization danger: marshal can execute arbitrary code',
    severity: 'error',
  },
  {
    type: 'serialization_danger',
    patterns: [
      /\bimport\s+shelve\b/,
      /\bfrom\s+shelve\s+import\b/,
    ],
    getMessage: () => 'Serialization danger: shelve uses pickle internally',
    severity: 'error',
  },
]

// FFI (Foreign Function Interface) danger patterns
export const ffiRules: SafetyRule[] = [
  {
    type: 'ffi_danger',
    patterns: [
      /\bimport\s+ctypes\b/,
      /\bfrom\s+ctypes\s+import\b/,
    ],
    getMessage: () => 'FFI danger: ctypes allows calling native libraries',
    severity: 'error',
  },
  {
    type: 'ffi_danger',
    patterns: [
      /\bimport\s+cffi\b/,
      /\bfrom\s+cffi\s+import\b/,
    ],
    getMessage: () => 'FFI danger: cffi allows calling native libraries',
    severity: 'error',
  },
]

// Infinite loop patterns
export const infiniteLoopRules: SafetyRule[] = [
  {
    type: 'infinite_loop',
    patterns: [/while\s+True\s*:/],
    getMessage: () => 'Potential infinite loop: while True without apparent break',
    severity: 'warning',
    skipIf: (code) => /\bbreak\b/.test(code),
  },
  {
    type: 'infinite_loop',
    patterns: [/while\s+1\s*:/],
    getMessage: () => 'Potential infinite loop: while 1 without apparent break',
    severity: 'warning',
    skipIf: (code) => /\bbreak\b/.test(code),
  },
]

// Resource exhaustion patterns
export const resourceExhaustionRules: SafetyRule[] = [
  {
    type: 'resource_exhaustion',
    patterns: [/range\s*\(\s*10\s*\*\*\s*[789]\s*\)/],
    getMessage: () => 'Resource exhaustion: range() with extremely large value (10^7+)',
    severity: 'error',
  },
  {
    type: 'resource_exhaustion',
    patterns: [/range\s*\(\s*2\s*\*\*\s*[3-9][0-9]+\s*\)/],
    getMessage: () => 'Resource exhaustion: range() with exponential value',
    severity: 'error',
  },
  {
    type: 'resource_exhaustion',
    patterns: [/\*\s*\(\s*10\s*\*\*\s*[789]\s*\)/],
    getMessage: () => 'Resource exhaustion: multiplication with extremely large value',
    severity: 'error',
  },
  {
    type: 'resource_exhaustion',
    patterns: [/\[\s*[^\]]*\]\s*\*\s*10000\s*\]\s*\*\s*10000/],
    getMessage: () => 'Resource exhaustion: nested list multiplication creating huge array',
    severity: 'error',
  },
]

// Command injection patterns
export const commandInjectionRules: SafetyRule[] = [
  {
    type: 'command_injection',
    patterns: [/os\.popen\s*\(/],
    getMessage: () => 'Command injection risk: os.popen() with potential user input',
    severity: 'error',
  },
  {
    type: 'command_injection',
    patterns: [/shell\s*=\s*True/],
    getMessage: () => 'Command injection risk: shell=True allows shell injection',
    severity: 'error',
  },
  {
    type: 'command_injection',
    patterns: [/os\.system\s*\(\s*f['"]/],
    getMessage: () => 'Command injection risk: os.system() with f-string',
    severity: 'error',
  },
]

// All rules combined
export const allRules: SafetyRule[] = [
  ...dangerousImportRules,
  ...codeExecutionRules,
  ...filesystemRules,
  ...networkRules,
  ...dangerousAttributeRules,
  ...serializationRules,
  ...ffiRules,
  ...infiniteLoopRules,
  ...resourceExhaustionRules,
  ...commandInjectionRules,
]
