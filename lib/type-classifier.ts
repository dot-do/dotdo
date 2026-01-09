/**
 * Type Classifier
 *
 * A GenerativeFunction that determines if a function spec should be classified as:
 * - code: Pure deterministic functions with no AI or human involvement
 * - generative: Functions that use AI for single-shot generation (ai`...`)
 * - agentic: Functions that use agents with tools and iteration (amy`...`)
 * - human: Functions that require human input/approval (user`...`)
 *
 * Classification hierarchy (highest type wins when multiple are present):
 * human > agentic > generative > code
 */

export type FunctionType = 'code' | 'generative' | 'agentic' | 'human'

export interface TypeClassifierResult {
  type: FunctionType
  reasoning: string
}

/**
 * Pattern matchers for each function type.
 * Order matters - we check from highest priority (human) to lowest (code).
 */
const patterns = {
  human: [
    // user template literal
    /\buser`/,
    /\buser\s*\(/,
    // Human-in-the-loop indicators
    /human[_-]?in[_-]?the[_-]?loop/i,
    /\bapproval\b.*\buser\b/i,
    /\buser\b.*\bapproval\b/i,
    /\brequest\b.*\buser\b.*\binput\b/i,
    /\bmanual\s+review\b/i,
    /\bmanual\s+approval\b/i,
  ],
  agentic: [
    // amy template literal (agent marker)
    /\bamy`/,
    /\bamy\s*\(/,
    // Agent indicators
    /\bagent\b/i,
    /\.deploy\s*\(/,
    /\.research\s*\(/,
    // Tool usage patterns
    /\btools\s*:/,
    /\bwith[_-]?tools\b/i,
    // Multi-step/iteration patterns
    /\bloop\s*\(/,
    /\bwhile\s*\(/,
    /\bretry\b/i,
    /\bverify\s+health/i,
  ],
  generative: [
    // ai template literal
    /\bai`/,
    /\bai\s*\(/,
    /\bai\./,
    // AI SDK imports
    /@ai-sdk\//,
    /\bopenai\b/i,
    /\banthropic\b/i,
    /\bclaude\b/i,
    /\bgpt[_-]?\d/i,
    // Generation patterns
    /\bgenerate\s*(Text|Object|Response)\b/,
    /\bsummarize\b/i,
    /\bsentiment\b/i,
    /\banalyze\b/i,
    /\.chat\s*\(/,
    /\.complete\s*\(/,
    /\.generate\s*\(/,
    // LLM patterns
    /\bllm\b/i,
    /\bprompt\b/i,
    /\bstoryBrand\b/,
  ],
}

/**
 * Classifies a function spec into one of four types: code, generative, agentic, or human.
 *
 * Uses pattern matching to detect AI/agent/human markers in the code.
 * When multiple types are detected, returns the highest priority type:
 * human > agentic > generative > code
 *
 * @param spec - The function specification to classify
 * @returns A TypeClassifierResult with the classified type and reasoning
 */
export function classifyFunctionType(spec: string): TypeClassifierResult {
  // Check for human patterns first (highest priority)
  for (const pattern of patterns.human) {
    if (pattern.test(spec)) {
      return {
        type: 'human',
        reasoning: `Detected human-in-the-loop pattern: ${pattern.toString()}. This function requires human input or approval.`,
      }
    }
  }

  // Check for agentic patterns
  for (const pattern of patterns.agentic) {
    if (pattern.test(spec)) {
      return {
        type: 'agentic',
        reasoning: `Detected agentic pattern: ${pattern.toString()}. This function uses an agent with tools or multi-step reasoning.`,
      }
    }
  }

  // Check for generative patterns
  for (const pattern of patterns.generative) {
    if (pattern.test(spec)) {
      return {
        type: 'generative',
        reasoning: `Detected generative AI pattern: ${pattern.toString()}. This function uses AI for single-shot generation.`,
      }
    }
  }

  // Default to code (pure deterministic function)
  return {
    type: 'code',
    reasoning: 'No AI, agent, or human-in-the-loop patterns detected. This is a pure deterministic code function.',
  }
}

/**
 * Async version of classifyFunctionType for compatibility with async workflows.
 * This allows for future AI-based classification without breaking the API.
 */
export async function classifyFunctionTypeAsync(spec: string): Promise<TypeClassifierResult> {
  // Currently uses synchronous classification, but could be upgraded to use AI
  return classifyFunctionType(spec)
}

// Default export for convenience
export default classifyFunctionType
