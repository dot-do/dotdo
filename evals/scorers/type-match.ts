/**
 * Type Match Scorer
 *
 * Scores type classifier results by comparing the predicted type against the expected type.
 * Returns 1 for exact match, 0 for mismatch.
 */

import type { FunctionType, TypeClassifierResult } from '../../lib/type-classifier'

export interface TypeMatchInput {
  result: TypeClassifierResult
  expected: FunctionType
}

export interface TypeMatchOutput {
  score: number
  match: boolean
  predicted: FunctionType
  expected: FunctionType
  reasoning: string
}

/**
 * Scores a type classifier result against an expected type.
 *
 * @param result - The TypeClassifierResult from the classifier
 * @param expected - The expected FunctionType
 * @returns A score of 1 for match, 0 for mismatch
 */
export function typeMatchScorer(result: TypeClassifierResult, expected: FunctionType): number {
  return result.type === expected ? 1 : 0
}

/**
 * Detailed scoring with additional metadata for analysis.
 *
 * @param result - The TypeClassifierResult from the classifier
 * @param expected - The expected FunctionType
 * @returns Detailed scoring output with match info and reasoning
 */
export function typeMatchScorerDetailed(result: TypeClassifierResult, expected: FunctionType): TypeMatchOutput {
  const match = result.type === expected
  return {
    score: match ? 1 : 0,
    match,
    predicted: result.type,
    expected,
    reasoning: match
      ? `Correct classification as "${result.type}": ${result.reasoning}`
      : `Misclassified as "${result.type}" instead of "${expected}": ${result.reasoning}`,
  }
}

/**
 * TypeMatch scorer class for use with evalite.
 *
 * Implements the evalite Scorer interface:
 * - name: identifier for the scorer
 * - score: function that takes output and expected, returns a score
 */
export const TypeMatch = {
  name: 'TypeMatch',
  description: 'Scores type classifier results by exact match against expected type',

  /**
   * Score function compatible with evalite.
   *
   * @param output - The output from the type classifier
   * @param expected - The expected classification
   * @returns Score between 0 and 1
   */
  score(output: TypeClassifierResult, expected: FunctionType): number {
    return typeMatchScorer(output, expected)
  },

  /**
   * Detailed score with reasoning.
   *
   * @param output - The output from the type classifier
   * @param expected - The expected classification
   * @returns Detailed scoring result
   */
  scoreDetailed(output: TypeClassifierResult, expected: FunctionType): TypeMatchOutput {
    return typeMatchScorerDetailed(output, expected)
  },
}

export default TypeMatch
