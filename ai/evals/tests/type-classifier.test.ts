/**
 * RED Phase Tests for Type Classifier Eval
 *
 * These tests validate the type classifier evaluation system that determines
 * if a function spec should be classified as: code, generative, agentic, or human.
 *
 * The type classifier is a GenerativeFunction that uses AI to classify function specs:
 * ```typescript
 * const type = ai`what type of function is this? ${spec}`
 * // Returns: { type: 'code' | 'generative' | 'agentic' | 'human', reasoning: string }
 * ```
 *
 * These tests should FAIL initially (RED phase of TDD).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// Project root
const PROJECT_ROOT = join(__dirname, '../..')

// Dataset path
const DATASET_PATH = join(PROJECT_ROOT, 'evals/datasets/type-classifier.jsonl')

// Type classifier eval path (to be implemented in GREEN phase)
const EVAL_PATH = join(PROJECT_ROOT, 'evals/evals/type-classifier.eval.ts')

// Types for the type classifier
type FunctionType = 'code' | 'generative' | 'agentic' | 'human'

interface TypeClassifierResult {
  type: FunctionType
  reasoning: string
}

interface DatasetEntry {
  input: string
  expected: FunctionType
  description?: string
}

// Placeholder for the type classifier function (to be implemented)
// This will FAIL because the implementation doesn't exist yet
async function classifyFunctionType(_spec: string): Promise<TypeClassifierResult> {
  // Import the actual classifier - this should fail because it doesn't exist
  const { classifyFunctionType: classify } = await import('../../lib/type-classifier')
  return classify(_spec)
}

// Placeholder scorer function (to be implemented)
function typeMatchScorer(result: TypeClassifierResult, expected: FunctionType): number {
  return result.type === expected ? 1 : 0
}

describe('Type Classifier Eval', () => {
  describe('Dataset', () => {
    it('dataset file exists at evals/datasets/type-classifier.jsonl', () => {
      expect(existsSync(DATASET_PATH)).toBe(true)
    })

    it('dataset contains valid JSONL entries', () => {
      const content = readFileSync(DATASET_PATH, 'utf-8')
      const lines = content.trim().split('\n')

      expect(lines.length).toBeGreaterThan(0)

      for (const line of lines) {
        const entry = JSON.parse(line) as DatasetEntry
        expect(entry).toHaveProperty('input')
        expect(entry).toHaveProperty('expected')
        expect(['code', 'generative', 'agentic', 'human']).toContain(entry.expected)
      }
    })

    it('dataset has at least 10 examples', () => {
      const content = readFileSync(DATASET_PATH, 'utf-8')
      const lines = content.trim().split('\n')
      expect(lines.length).toBeGreaterThanOrEqual(10)
    })

    it('dataset covers all four function types', () => {
      const content = readFileSync(DATASET_PATH, 'utf-8')
      const lines = content.trim().split('\n')
      const types = new Set<string>()

      for (const line of lines) {
        const entry = JSON.parse(line) as DatasetEntry
        types.add(entry.expected)
      }

      expect(types.has('code')).toBe(true)
      expect(types.has('generative')).toBe(true)
      expect(types.has('agentic')).toBe(true)
      expect(types.has('human')).toBe(true)
    })

    it('can load dataset entries as structured data', () => {
      const content = readFileSync(DATASET_PATH, 'utf-8')
      const entries: DatasetEntry[] = content
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))

      expect(entries.length).toBeGreaterThan(0)
      expect(entries[0]).toMatchObject({
        input: expect.any(String),
        expected: expect.stringMatching(/^(code|generative|agentic|human)$/),
      })
    })
  })

  describe('Eval File Structure', () => {
    it('eval file exists at evals/evals/type-classifier.eval.ts', () => {
      // This will FAIL - the eval file doesn't exist yet (RED phase)
      expect(existsSync(EVAL_PATH)).toBe(true)
    })

    it('eval file exports evalite configuration', async () => {
      // This will FAIL - the eval file doesn't exist yet (RED phase)
      const evalModule = await import('../../evals/evals/type-classifier.eval')
      expect(evalModule).toBeDefined()
    })
  })

  describe('Type Classifier Function', () => {
    it('classifyFunctionType module exists', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      const module = await import('../../lib/type-classifier')
      expect(module.classifyFunctionType).toBeDefined()
    })

    it('classifyFunctionType returns correct structure', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      const result = await classifyFunctionType('export const sum = (a, b) => a + b')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('reasoning')
      expect(['code', 'generative', 'agentic', 'human']).toContain(result.type)
      expect(typeof result.reasoning).toBe('string')
    })

    it('correctly classifies a pure code function', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      const result = await classifyFunctionType('export const sum = (a: number, b: number) => a + b')
      expect(result.type).toBe('code')
    })

    it('correctly classifies a generative function', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      const result = await classifyFunctionType("const summary = ai`summarize this: ${doc}`")
      expect(result.type).toBe('generative')
    })

    it('correctly classifies an agentic function', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      const result = await classifyFunctionType('const research = amy`research ${topic} deeply`')
      expect(result.type).toBe('agentic')
    })

    it('correctly classifies a human function', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      const result = await classifyFunctionType('const approval = user`approve ${request}`')
      expect(result.type).toBe('human')
    })
  })

  describe('Scorer', () => {
    it('scorer module exists', async () => {
      // This will FAIL - the scorer doesn't exist yet (RED phase)
      const module = await import('../../evals/scorers/type-match')
      expect(module.TypeMatch).toBeDefined()
    })

    it('scorer returns 1 for correct classification', () => {
      const result: TypeClassifierResult = { type: 'code', reasoning: 'Pure arithmetic' }
      expect(typeMatchScorer(result, 'code')).toBe(1)
    })

    it('scorer returns 0 for incorrect classification', () => {
      const result: TypeClassifierResult = { type: 'generative', reasoning: 'Uses AI' }
      expect(typeMatchScorer(result, 'code')).toBe(0)
    })
  })

  describe('Edge Cases', () => {
    it('handles ambiguous specs that could be multiple types', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      // A function that does some computation but might need AI for complex cases
      const ambiguousSpec = `
        export const processData = async (data: unknown) => {
          if (isSimple(data)) return transform(data)
          // Complex cases might need AI
          return ai\`transform this complex data: \${data}\`
        }
      `
      const result = await classifyFunctionType(ambiguousSpec)
      // Should still return a valid type
      expect(['code', 'generative', 'agentic', 'human']).toContain(result.type)
      // Should provide reasoning for the choice
      expect(result.reasoning.length).toBeGreaterThan(0)
    })

    it('handles multi-step specs that involve both AI and human', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      const multiTypeSpec = `
        export const reviewPR = async (pr: PR) => {
          const aiReview = await ai\`review this PR: \${pr.diff}\`
          if (aiReview.needsHumanReview) {
            return user\`please review: \${pr.title}\`
          }
          return aiReview
        }
      `
      const result = await classifyFunctionType(multiTypeSpec)
      // Should classify based on the "highest" type in the cascade
      // human > agentic > generative > code
      expect(['generative', 'human']).toContain(result.type)
    })

    it('handles empty or minimal specs', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      const result = await classifyFunctionType('() => {}')
      expect(result.type).toBe('code')
    })

    it('handles specs with external dependencies', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      const spec = `
        import { openai } from '@ai-sdk/openai'
        export const chat = (prompt: string) => openai.chat(prompt)
      `
      const result = await classifyFunctionType(spec)
      // External AI SDK import suggests generative
      expect(result.type).toBe('generative')
    })
  })

  describe('Accuracy Metric', () => {
    let dataset: DatasetEntry[]

    beforeAll(() => {
      const content = readFileSync(DATASET_PATH, 'utf-8')
      dataset = content
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    })

    it('eval produces accuracy metric', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      let correct = 0
      const total = dataset.length

      for (const entry of dataset) {
        const result = await classifyFunctionType(entry.input)
        if (result.type === entry.expected) {
          correct++
        }
      }

      const accuracy = correct / total
      // We expect the classifier to achieve at least 80% accuracy
      expect(accuracy).toBeGreaterThanOrEqual(0.8)
    })

    it('eval results can be serialized for storage', async () => {
      // This will FAIL - the classifier doesn't exist yet (RED phase)
      const results: Array<{
        input: string
        expected: FunctionType
        actual: FunctionType
        reasoning: string
        score: number
      }> = []

      for (const entry of dataset) {
        const result = await classifyFunctionType(entry.input)
        results.push({
          input: entry.input,
          expected: entry.expected,
          actual: result.type,
          reasoning: result.reasoning,
          score: result.type === entry.expected ? 1 : 0,
        })
      }

      // Should be serializable to JSON
      const serialized = JSON.stringify(results)
      expect(typeof serialized).toBe('string')

      // Should roundtrip correctly
      const deserialized = JSON.parse(serialized)
      expect(deserialized).toHaveLength(results.length)
    })
  })
})
