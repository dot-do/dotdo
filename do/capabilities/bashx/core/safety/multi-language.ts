/**
 * Multi-Language Safety Gate
 *
 * Unified entry point for multi-language safety analysis. Detects the
 * programming language of input, routes to the appropriate language-specific
 * analyzer (Python/Ruby/Node/bash), and produces a consistent analysis result
 * with sandbox strategy recommendations.
 *
 * Flow:
 * 1. Detect language using language-detector
 * 2. Route to appropriate language analyzer (Python/Ruby/Node/bash)
 * 3. Produce unified MultiLanguageAnalysis with sandbox strategy
 *
 * Sandbox strategies are determined by:
 * - Impact level (critical -> most restrictive)
 * - Operation type (execute/system -> restricted network, delete -> restricted filesystem)
 * - Detected patterns (eval, system calls -> enhanced isolation)
 *
 * @packageDocumentation
 */

import type { SafetyClassification } from '../types.js'
import { detectLanguage, type SupportedLanguage } from '../classify/language-detector.js'
import { analyzePythonSafety } from './patterns/python.js'
import { analyzeRubySafety } from './patterns/ruby.js'
import { analyzeNodeSafety } from './patterns/nodejs.js'
import { classifyCommand } from './analyze.js'

/**
 * Sandbox strategy configuration for code execution.
 *
 * Defines resource limits, network access, and filesystem permissions
 * based on the safety analysis of the code.
 */
export interface SandboxStrategy {
  /**
   * Maximum execution time in milliseconds.
   * Lower values for dangerous code patterns.
   */
  timeout: number

  /**
   * Resource limits for the sandbox.
   */
  resources: {
    /** Memory limit in megabytes */
    memoryMB: number
    /** Disk usage limit in megabytes */
    diskMB: number
  }

  /**
   * Network access level.
   * - 'none': No network access (most restrictive)
   * - 'filtered': Limited to specific domains/ports
   * - 'unrestricted': Full network access (least restrictive)
   */
  network: 'none' | 'filtered' | 'unrestricted'

  /**
   * Filesystem access level.
   * - 'read-only': Can only read files (most restrictive)
   * - 'temp-only': Can only write to temporary directories
   * - 'unrestricted': Full filesystem access (least restrictive)
   */
  filesystem: 'read-only' | 'temp-only' | 'unrestricted'
}

/**
 * A detected pattern from language-specific analysis.
 */
export interface DetectedPattern {
  /** Pattern type identifier (e.g., 'eval', 'system', 'subprocess') */
  type: string
  /** Impact description of the pattern */
  impact: string
}

/**
 * Unified result of multi-language safety analysis.
 *
 * Combines language detection, safety classification, detected patterns,
 * and recommended sandbox strategy into a single consistent format.
 */
export interface MultiLanguageAnalysis {
  /**
   * Detected programming language.
   */
  language: SupportedLanguage

  /**
   * Safety classification from the language-specific analyzer.
   */
  classification: SafetyClassification

  /**
   * Dangerous patterns detected in the code.
   */
  patterns: DetectedPattern[]

  /**
   * Recommended sandbox strategy for executing the code.
   */
  sandboxStrategy: SandboxStrategy

  /**
   * Whether the code is considered safe to execute.
   * false for critical impact or high-risk patterns.
   */
  isSafe: boolean

  /**
   * Human-readable explanation of the safety determination.
   * Included when isSafe is false.
   */
  reason?: string
}

/**
 * Analyze code for safety using multi-language detection.
 *
 * This function:
 * 1. Detects the programming language of the input
 * 2. Routes to the appropriate language-specific analyzer
 * 3. Computes a sandbox strategy based on the analysis
 * 4. Returns a unified MultiLanguageAnalysis result
 *
 * @param code - The code string to analyze (may be any supported language)
 * @returns Promise resolving to MultiLanguageAnalysis with classification and sandbox strategy
 * @throws {Error} Not implemented yet (RED phase stub)
 *
 * @example
 * ```typescript
 * // Python code with dangerous pattern
 * const result = await analyzeMultiLanguage('eval(user_input)')
 * // result.language === 'python'
 * // result.isSafe === false
 * // result.sandboxStrategy.network === 'none'
 *
 * // Safe bash command
 * const safeResult = await analyzeMultiLanguage('ls -la')
 * // safeResult.language === 'bash'
 * // safeResult.isSafe === true
 * // safeResult.sandboxStrategy.filesystem === 'unrestricted'
 * ```
 */
/**
 * Determine sandbox strategy based on classification and detected patterns.
 */
function determineSandboxStrategy(
  classification: SafetyClassification,
  patterns: DetectedPattern[]
): SandboxStrategy {
  const hasSystemExecution = patterns.some(
    (p) => p.type === 'system' || p.type === 'subprocess' || p.type === 'child_process'
  )
  const hasCodeExecution = patterns.some(
    (p) => p.type === 'eval' || p.type === 'exec' || p.type === 'compile'
  )

  // Critical impact: most restrictive sandbox
  if (classification.impact === 'critical') {
    return {
      timeout: 5000,
      resources: {
        memoryMB: 64,
        diskMB: 32,
      },
      network: 'none',
      filesystem: 'read-only',
    }
  }

  // High impact: restricted sandbox
  if (classification.impact === 'high') {
    return {
      timeout: 10000,
      resources: {
        memoryMB: 128,
        diskMB: 64,
      },
      network: hasSystemExecution ? 'none' : 'filtered',
      filesystem: 'read-only',
    }
  }

  // Medium impact: moderate restrictions
  if (classification.impact === 'medium') {
    return {
      timeout: 30000,
      resources: {
        memoryMB: 256,
        diskMB: 128,
      },
      network: hasCodeExecution ? 'none' : 'filtered',
      filesystem: 'temp-only',
    }
  }

  // Low/none impact: permissive sandbox
  return {
    timeout: 60000,
    resources: {
      memoryMB: 512,
      diskMB: 256,
    },
    network: 'unrestricted',
    filesystem: 'unrestricted',
  }
}

/**
 * Analyze bash code for safety classification.
 *
 * Parses the command and classifies it using the bash safety analyzer.
 * Handles complex commands by extracting the primary command.
 */
function analyzeBashSafety(code: string): { classification: SafetyClassification; patterns: DetectedPattern[] } {
  // Handle pipeline and compound commands - extract first command
  const trimmed = code.trim()

  // Split on common command separators to get first command
  const firstCommand = trimmed.split(/\s*(?:&&|\|\||;|\|)\s*/)[0]

  // Parse command into name and arguments
  const parts = firstCommand.trim().split(/\s+/)
  const command = parts[0] || ''
  const args = parts.slice(1)

  const classification = classifyCommand(command, args)

  return {
    classification,
    patterns: [], // Bash patterns are handled via AST analysis, not pattern detection
  }
}

export async function analyzeMultiLanguage(code: string): Promise<MultiLanguageAnalysis> {
  // 1. Detect language
  const detection = detectLanguage(code)

  // 2. Route to appropriate analyzer
  let classification: SafetyClassification
  let patterns: DetectedPattern[] = []

  switch (detection.language) {
    case 'python': {
      const analysis = analyzePythonSafety(code)
      classification = analysis.classification
      patterns = analysis.patterns.map((p) => ({ type: p.type, impact: p.impact }))
      break
    }
    case 'ruby': {
      const analysis = analyzeRubySafety(code)
      classification = analysis.classification
      patterns = analysis.patterns.map((p) => ({ type: p.type, impact: p.impact }))
      break
    }
    case 'node': {
      const analysis = analyzeNodeSafety(code)
      classification = analysis.classification
      patterns = analysis.patterns.map((p) => ({ type: p.type, impact: p.impact }))
      break
    }
    case 'bash':
    default: {
      const analysis = analyzeBashSafety(code)
      classification = analysis.classification
      patterns = analysis.patterns
      break
    }
  }

  // 3. Determine sandbox strategy based on classification
  const sandboxStrategy = determineSandboxStrategy(classification, patterns)

  // 4. Determine if safe
  // Unsafe if critical impact or high impact with dangerous patterns
  const isSafe =
    classification.impact === 'none' ||
    (classification.impact === 'low' && patterns.length === 0)

  const reason = isSafe ? undefined : classification.reason

  return {
    language: detection.language,
    classification,
    patterns,
    sandboxStrategy,
    isSafe,
    reason,
  }
}

/**
 * Synchronous version of analyzeMultiLanguage for use in classification pipeline.
 *
 * This function performs the same analysis as analyzeMultiLanguage but synchronously.
 * All underlying language analyzers are synchronous, so this is safe to use
 * in performance-critical classification code paths.
 *
 * @param code - The code string to analyze
 * @returns MultiLanguageAnalysis with classification and sandbox strategy
 *
 * @example
 * ```typescript
 * // Use in classification pipeline
 * const analysis = analyzeMultiLanguageSync('python -c "eval(input())"')
 * if (analysis.language !== 'bash') {
 *   classification.sandboxStrategy = analysis.sandboxStrategy
 * }
 * ```
 */
export function analyzeMultiLanguageSync(code: string): MultiLanguageAnalysis {
  // 1. Detect language
  const detection = detectLanguage(code)

  // 2. Route to appropriate analyzer
  let classification: SafetyClassification
  let patterns: DetectedPattern[] = []

  switch (detection.language) {
    case 'python': {
      const analysis = analyzePythonSafety(code)
      classification = analysis.classification
      patterns = analysis.patterns.map((p) => ({ type: p.type, impact: p.impact }))
      break
    }
    case 'ruby': {
      const analysis = analyzeRubySafety(code)
      classification = analysis.classification
      patterns = analysis.patterns.map((p) => ({ type: p.type, impact: p.impact }))
      break
    }
    case 'node': {
      const analysis = analyzeNodeSafety(code)
      classification = analysis.classification
      patterns = analysis.patterns.map((p) => ({ type: p.type, impact: p.impact }))
      break
    }
    case 'bash':
    default: {
      const analysis = analyzeBashSafety(code)
      classification = analysis.classification
      patterns = analysis.patterns
      break
    }
  }

  // 3. Determine sandbox strategy based on classification
  const sandboxStrategy = determineSandboxStrategy(classification, patterns)

  // 4. Determine if safe
  // Unsafe if critical impact or high impact with dangerous patterns
  const isSafe =
    classification.impact === 'none' ||
    (classification.impact === 'low' && patterns.length === 0)

  const reason = isSafe ? undefined : classification.reason

  return {
    language: detection.language,
    classification,
    patterns,
    sandboxStrategy,
    isSafe,
    reason,
  }
}
