/**
 * Type Classifier Eval
 *
 * Evaluates the type classifier's accuracy in determining whether a function spec
 * should be classified as: code, generative, agentic, or human.
 *
 * Dataset: evals/datasets/type-classifier.jsonl
 * Scorer: evals/scorers/type-match.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { classifyFunctionType, type FunctionType, type TypeClassifierResult } from '../../../lib/type-classifier'
import { TypeMatch } from '../scorers/type-match'

// ============================================================================
// Types
// ============================================================================

export interface DatasetEntry {
  input: string
  expected: FunctionType
  description?: string
}

export interface EvalResult {
  input: string
  expected: FunctionType
  output: TypeClassifierResult
  score: number
  description?: string
}

export interface EvalSummary {
  total: number
  correct: number
  accuracy: number
  results: EvalResult[]
  byType: Record<FunctionType, { total: number; correct: number; accuracy: number }>
}

// ============================================================================
// Dataset Loading
// ============================================================================

/**
 * Loads the type classifier dataset from JSONL file.
 */
export function loadDataset(datasetPath?: string): DatasetEntry[] {
  const path = datasetPath ?? join(__dirname, '../datasets/type-classifier.jsonl')
  const content = readFileSync(path, 'utf-8')
  return content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as DatasetEntry)
}

// ============================================================================
// Evaluation Runner
// ============================================================================

/**
 * Runs the type classifier evaluation on the dataset.
 *
 * @param dataset - Array of dataset entries to evaluate
 * @returns EvalSummary with accuracy metrics and individual results
 */
export async function runEval(dataset?: DatasetEntry[]): Promise<EvalSummary> {
  const entries = dataset ?? loadDataset()
  const results: EvalResult[] = []

  // Initialize by-type counters
  const byType: Record<FunctionType, { total: number; correct: number; accuracy: number }> = {
    code: { total: 0, correct: 0, accuracy: 0 },
    generative: { total: 0, correct: 0, accuracy: 0 },
    agentic: { total: 0, correct: 0, accuracy: 0 },
    human: { total: 0, correct: 0, accuracy: 0 },
  }

  // Run classifier on each entry
  for (const entry of entries) {
    const output = classifyFunctionType(entry.input)
    const score = TypeMatch.score(output, entry.expected)

    results.push({
      input: entry.input,
      expected: entry.expected,
      output,
      score,
      description: entry.description,
    })

    // Update by-type counters
    byType[entry.expected].total++
    if (score === 1) {
      byType[entry.expected].correct++
    }
  }

  // Calculate accuracies
  const total = results.length
  const correct = results.filter((r) => r.score === 1).length
  const accuracy = total > 0 ? correct / total : 0

  for (const type of Object.keys(byType) as FunctionType[]) {
    const typeData = byType[type]
    typeData.accuracy = typeData.total > 0 ? typeData.correct / typeData.total : 0
  }

  return {
    total,
    correct,
    accuracy,
    results,
    byType,
  }
}

/**
 * Formats eval results for display/logging.
 */
export function formatResults(summary: EvalSummary): string {
  const lines: string[] = [
    '='.repeat(60),
    'Type Classifier Evaluation Results',
    '='.repeat(60),
    '',
    `Overall Accuracy: ${(summary.accuracy * 100).toFixed(1)}% (${summary.correct}/${summary.total})`,
    '',
    'By Type:',
  ]

  for (const [type, data] of Object.entries(summary.byType)) {
    if (data.total > 0) {
      lines.push(`  ${type}: ${(data.accuracy * 100).toFixed(1)}% (${data.correct}/${data.total})`)
    }
  }

  lines.push('')
  lines.push('Failures:')

  const failures = summary.results.filter((r) => r.score === 0)
  if (failures.length === 0) {
    lines.push('  None')
  } else {
    for (const failure of failures) {
      lines.push(`  - Expected: ${failure.expected}, Got: ${failure.output.type}`)
      lines.push(`    Input: ${failure.input.substring(0, 80)}${failure.input.length > 80 ? '...' : ''}`)
      if (failure.description) {
        lines.push(`    Description: ${failure.description}`)
      }
    }
  }

  lines.push('')
  lines.push('='.repeat(60))

  return lines.join('\n')
}

// ============================================================================
// Evalite Configuration Export
// ============================================================================

/**
 * Evalite-compatible configuration for the type classifier eval.
 */
export const evalConfig = {
  name: 'type-classifier',
  description: 'Evaluates function type classification (code, generative, agentic, human)',

  // Load dataset
  data: loadDataset,

  // Classification task
  task: async (input: string) => classifyFunctionType(input),

  // Scorers
  scorers: [TypeMatch],

  // Threshold for passing (80% accuracy)
  threshold: 0.8,
}

export default evalConfig
