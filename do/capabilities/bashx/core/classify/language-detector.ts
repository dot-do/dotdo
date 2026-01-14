/**
 * Language Detection Module
 *
 * Detects the programming language of input for multi-language shell support.
 * This module analyzes input using multiple detection strategies:
 * 1. Shebang detection (highest confidence)
 * 2. Interpreter command detection
 * 3. File extension detection
 * 4. Syntax pattern detection (lowest confidence)
 *
 * Detection priority: shebang > interpreter > extension > syntax > default(bash)
 *
 * @packageDocumentation
 */

import type { SupportedLanguage } from '../types.js'

// Re-export SupportedLanguage for backward compatibility
export type { SupportedLanguage } from '../types.js'

/**
 * Confidence score constants for language detection.
 *
 * These values represent the certainty level of different detection methods:
 * - Higher values indicate more reliable detection methods
 * - Values range from 0.0 (no confidence) to 1.0 (absolute certainty)
 *
 * Detection reliability order (highest to lowest):
 * 1. SHEBANG (0.95) - Explicit language declaration in script header
 * 2. INTERPRETER (0.90) - Command starts with known interpreter (python, ruby, node)
 * 3. EXTENSION (0.85) - File has recognizable language extension (.py, .rb, .js)
 * 4. SYNTAX_HIGH (0.75) - Strong syntax patterns (def with parens/colon, import/class)
 * 5. SYNTAX_MEDIUM (0.70) - Medium syntax patterns (puts, end keywords)
 * 6. SYNTAX_LOW (0.65) - Weaker syntax patterns (const, let, async)
 * 7. SYNTAX_LOWER (0.60) - Common function patterns (print, eval)
 * 8. SYNTAX_LOWEST (0.55) - Ambiguous patterns (assignment with function call)
 * 9. DEFAULT (0.50) - No patterns matched, defaulting to bash
 */
export const CONFIDENCE = {
  /** Shebang detection - explicit language declaration (#!/usr/bin/env python3) */
  SHEBANG: 0.95,
  /** Interpreter command detection (python script.py, ruby -e, node app.js) */
  INTERPRETER: 0.90,
  /** File extension detection (.py, .rb, .js, .go, .rs) */
  EXTENSION: 0.85,
  /** High confidence syntax patterns (def with parens/colon, import, class) */
  SYNTAX_HIGH: 0.75,
  /** Medium confidence syntax patterns (puts, end keywords) */
  SYNTAX_MEDIUM: 0.70,
  /** Low confidence syntax patterns (const, let, async) */
  SYNTAX_LOW: 0.65,
  /** Lower confidence syntax patterns (print, eval, exec) */
  SYNTAX_LOWER: 0.60,
  /** Lowest confidence syntax patterns (ambiguous assignment patterns) */
  SYNTAX_LOWEST: 0.55,
  /** Default when no patterns match - assumes bash */
  DEFAULT: 0.50,
} as const

/**
 * Detection method used to identify the language.
 */
export type DetectionMethod = 'shebang' | 'interpreter' | 'extension' | 'syntax' | 'default'

/**
 * Additional details about the detected language.
 */
export interface LanguageDetectionDetails {
  /**
   * Runtime version if detectable (e.g., 'python3', 'node18')
   */
  runtime?: string

  /**
   * True if the code is inline (using -c, -e, --eval flags)
   */
  inline?: boolean

  /**
   * Target file if detected from command
   */
  file?: string
}

/**
 * Result of language detection analysis.
 */
export interface LanguageDetectionResult {
  /**
   * The detected programming language.
   */
  language: SupportedLanguage

  /**
   * Confidence score between 0 and 1.
   * Higher values indicate more certainty:
   * - 0.95: Shebang detection
   * - 0.90: Interpreter command
   * - 0.85: File extension
   * - 0.60-0.75: Syntax patterns
   * - 0.50: Default (bash)
   */
  confidence: number

  /**
   * Detection method used to identify the language.
   */
  method: DetectionMethod

  /**
   * Additional details about the detection.
   */
  details: LanguageDetectionDetails
}

/**
 * Shebang patterns for language detection
 */
const SHEBANG_MAP: Record<string, { pattern: RegExp; language: SupportedLanguage }> = {
  python: { pattern: /python[\d.]*/, language: 'python' },
  ruby: { pattern: /ruby[\d.]*/, language: 'ruby' },
  node: { pattern: /node(js)?/, language: 'node' },
  bash: { pattern: /(bash|sh|zsh)/, language: 'bash' },
}

/**
 * Interpreter commands mapped to languages.
 * Note: Package managers (pip, npm, gem) are excluded because they should
 * go through Tier 2 RPC, not polyglot language execution.
 */
const INTERPRETERS: Record<SupportedLanguage, string[]> = {
  python: ['python', 'python3', 'python3.11'],
  ruby: ['ruby'],
  node: ['node'],
  go: ['go'],
  rust: ['cargo', 'rustc'],
  bash: ['bash', 'sh', 'zsh'],
}

/**
 * Inline code execution flags for each language
 */
const INLINE_FLAGS: Record<string, string[]> = {
  python: ['-c', '--command'],
  ruby: ['-e', '--execute'],
  node: ['-e', '--eval'],
}

/**
 * File extensions mapped to languages
 */
const EXTENSIONS: Record<string, SupportedLanguage> = {
  '.py': 'python',
  '.rb': 'ruby',
  '.js': 'node',
  '.mjs': 'node',
  '.go': 'go',
  '.rs': 'rust',
}

/**
 * Syntax patterns for language detection
 * Note: Order matters - more specific patterns should come first
 */
const SYNTAX_PATTERNS: { lang: SupportedLanguage; pattern: RegExp; confidence: number }[] = [
  // Ruby patterns - check before Python since Ruby uses 'def' without parentheses/colons
  { lang: 'ruby', pattern: /\b(puts|end)\b/m, confidence: CONFIDENCE.SYNTAX_MEDIUM },
  // Python patterns - 'def' with parens and colon, or import/from/class
  { lang: 'python', pattern: /^(import|from|class)\s+|^def\s+\w+\s*\(/m, confidence: CONFIDENCE.SYNTAX_HIGH },
  // Python functions - print, eval, exec, open (common Python builtins)
  { lang: 'python', pattern: /\b(print|eval|exec|compile)\s*\(/, confidence: CONFIDENCE.SYNTAX_LOWER },
  // Python-style assignment with function call (bash doesn't allow spaces around =)
  { lang: 'python', pattern: /^\w+\s+=\s+\w+\s*\(/m, confidence: CONFIDENCE.SYNTAX_LOWEST },
  { lang: 'node', pattern: /\b(const|let|async|await|=>)\s+/m, confidence: CONFIDENCE.SYNTAX_LOW },
]

/**
 * Detect language from shebang line
 */
function detectShebang(input: string): LanguageDetectionResult | null {
  // Match shebang at the start of input
  const shebangMatch = input.match(/^#!\s*(.+)/)
  if (!shebangMatch) return null

  const shebangLine = shebangMatch[1]

  for (const [_key, { pattern, language }] of Object.entries(SHEBANG_MAP)) {
    const match = shebangLine.match(pattern)
    if (match) {
      return {
        language,
        confidence: CONFIDENCE.SHEBANG,
        method: 'shebang',
        details: {
          runtime: match[0],
        },
      }
    }
  }

  return null
}

/**
 * Detect language from interpreter command
 */
function detectInterpreter(input: string): LanguageDetectionResult | null {
  // Split input by whitespace to get command and args
  const parts = input.trim().split(/\s+/)
  if (parts.length === 0) return null

  const command = parts[0]

  // Find which language this interpreter belongs to
  for (const [lang, interpreters] of Object.entries(INTERPRETERS)) {
    const language = lang as SupportedLanguage
    if (interpreters.some((interp) => command === interp || command.startsWith(interp))) {
      const details: LanguageDetectionDetails = {}

      // Check for inline flags
      const flags = INLINE_FLAGS[language]
      if (flags) {
        const hasInlineFlag = parts.slice(1).some((arg) => flags.includes(arg))
        if (hasInlineFlag) {
          details.inline = true
        }
      }

      // Check for file argument (look for extension-based file)
      if (!details.inline) {
        for (const part of parts.slice(1)) {
          // Skip flags
          if (part.startsWith('-')) continue
          // Check for known extensions or common file patterns
          for (const ext of Object.keys(EXTENSIONS)) {
            if (part.endsWith(ext)) {
              details.file = part
              break
            }
          }
          if (details.file) break
        }
      }

      return {
        language,
        confidence: CONFIDENCE.INTERPRETER,
        method: 'interpreter',
        details,
      }
    }
  }

  return null
}

/**
 * Detect language from file extension
 */
function detectExtension(input: string): LanguageDetectionResult | null {
  // Check if input looks like a file path
  const trimmed = input.trim()

  // Look for file extensions
  for (const [ext, language] of Object.entries(EXTENSIONS)) {
    if (trimmed.endsWith(ext)) {
      return {
        language,
        confidence: CONFIDENCE.EXTENSION,
        method: 'extension',
        details: {
          file: trimmed,
        },
      }
    }
  }

  return null
}

/**
 * Detect language from syntax patterns
 */
function detectSyntax(input: string): LanguageDetectionResult | null {
  for (const { lang, pattern, confidence } of SYNTAX_PATTERNS) {
    if (pattern.test(input)) {
      return {
        language: lang,
        confidence,
        method: 'syntax',
        details: {},
      }
    }
  }

  return null
}

/**
 * Detect the programming language of the given input.
 *
 * Detection priority (highest to lowest confidence):
 * 1. Shebang (#!/usr/bin/env python3) - confidence ~0.95
 * 2. Interpreter command (python script.py) - confidence ~0.90
 * 3. File extension (.py, .rb, .js) - confidence ~0.85
 * 4. Syntax patterns (def, import, puts) - confidence ~0.60-0.75
 * 5. Default to bash - confidence ~0.50
 *
 * @param input - The input string to analyze (command or code)
 * @returns Language detection result with confidence and method
 *
 * @example
 * ```typescript
 * // Shebang detection
 * detectLanguage('#!/usr/bin/env python3\nprint("hello")')
 * // { language: 'python', confidence: 0.95, method: 'shebang', details: { runtime: 'python3' } }
 *
 * // Interpreter detection
 * detectLanguage('python3 script.py')
 * // { language: 'python', confidence: 0.90, method: 'interpreter', details: { file: 'script.py' } }
 *
 * // Syntax detection
 * detectLanguage('def hello():\n  print("world")')
 * // { language: 'python', confidence: 0.75, method: 'syntax', details: {} }
 * ```
 */
export function detectLanguage(input: string): LanguageDetectionResult {
  // Try detection methods in priority order

  // 1. Shebang detection (highest confidence)
  const shebangResult = detectShebang(input)
  if (shebangResult) return shebangResult

  // 2. Interpreter command detection
  const interpreterResult = detectInterpreter(input)
  if (interpreterResult) return interpreterResult

  // 3. File extension detection
  const extensionResult = detectExtension(input)
  if (extensionResult) return extensionResult

  // 4. Syntax pattern detection
  const syntaxResult = detectSyntax(input)
  if (syntaxResult) return syntaxResult

  // 5. Default to bash
  return {
    language: 'bash',
    confidence: CONFIDENCE.DEFAULT,
    method: 'default',
    details: {},
  }
}
