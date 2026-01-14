/**
 * Safety Module for @dotdo/bashx
 *
 * Provides safety analysis, classification, and intent extraction
 * for bash commands. Platform-agnostic with zero Cloudflare dependencies.
 *
 * @packageDocumentation
 */

export type {
  SafetyClassification,
  CommandClassification,
  SafetyAnalysis,
  DangerCheck,
  Intent,
  OperationType,
  ImpactLevel,
} from '../types.js'

export {
  analyze,
  isDangerous,
  classifyCommand,
  extractIntent,
  extractIntentFromAST,
  describeIntent,
} from './analyze.js'

export type { ExtendedIntent } from './analyze.js'

// Pattern infrastructure exports
export {
  type DetectedPattern,
  type PatternDefinition,
  type ImpactLevel as PatternImpactLevel,
  IMPACT_ORDER,
  detectPatterns,
  compareImpact,
  getHighestImpact,
  buildReasonString,
} from './patterns/shared.js'

// Language-specific analyzers
export { analyzePythonSafety, type PythonSafetyAnalysis } from './patterns/python.js'
export { analyzeRubySafety, type RubySafetyAnalysis } from './patterns/ruby.js'
export { analyzeNodeSafety, type NodeSafetyAnalysis } from './patterns/nodejs.js'

// Multi-language analysis
export {
  analyzeMultiLanguage,
  analyzeMultiLanguageSync,
  type MultiLanguageAnalysis,
  type SandboxStrategy,
} from './multi-language.js'

// Safety policies
export {
  type SafetyPolicy,
  type PolicyInput,
  DEFAULT_POLICY,
  PERMISSIVE_POLICY,
  STRICT_POLICY,
} from './policy.js'
