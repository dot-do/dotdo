/**
 * Stop Conditions Tests
 */

import { describe, it, expect } from 'vitest'
import {
  stepCountIs,
  hasToolCall,
  hasText,
  customStop,
  shouldStop,
  all,
  any,
  not,
} from './stopConditions'
import type { StepState } from './types'

describe('Stop Conditions', () => {
  const createState = (overrides: Partial<StepState> = {}): StepState => ({
    stepNumber: 1,
    messages: [],
    lastStep: { finishReason: 'stop' },
    totalTokens: 0,
    ...overrides,
  })

  describe('stepCountIs', () => {
    it('stops when step count equals limit', () => {
      const condition = stepCountIs(5)
      const state = createState({ stepNumber: 5 })
      expect(shouldStop(condition, state)).toBe(true)
    })

    it('stops when step count exceeds limit', () => {
      const condition = stepCountIs(5)
      const state = createState({ stepNumber: 6 })
      expect(shouldStop(condition, state)).toBe(true)
    })

    it('does not stop before limit', () => {
      const condition = stepCountIs(5)
      const state = createState({ stepNumber: 4 })
      expect(shouldStop(condition, state)).toBe(false)
    })
  })

  describe('hasToolCall', () => {
    it('stops when specified tool is called', () => {
      const condition = hasToolCall('finish')
      const state = createState({
        lastStep: {
          finishReason: 'tool_calls',
          toolCalls: [{ id: '1', name: 'finish', arguments: {} }],
        },
      })
      expect(shouldStop(condition, state)).toBe(true)
    })

    it('does not stop for other tools', () => {
      const condition = hasToolCall('finish')
      const state = createState({
        lastStep: {
          finishReason: 'tool_calls',
          toolCalls: [{ id: '1', name: 'search', arguments: {} }],
        },
      })
      expect(shouldStop(condition, state)).toBe(false)
    })

    it('does not stop when no tool calls', () => {
      const condition = hasToolCall('finish')
      const state = createState()
      expect(shouldStop(condition, state)).toBe(false)
    })
  })

  describe('hasText', () => {
    it('stops when text is present', () => {
      const condition = hasText()
      const state = createState({
        lastStep: { text: 'Hello', finishReason: 'stop' },
      })
      expect(shouldStop(condition, state)).toBe(true)
    })

    it('does not stop for empty text', () => {
      const condition = hasText()
      const state = createState({
        lastStep: { text: '', finishReason: 'stop' },
      })
      expect(shouldStop(condition, state)).toBe(false)
    })

    it('does not stop when no text', () => {
      const condition = hasText()
      const state = createState()
      expect(shouldStop(condition, state)).toBe(false)
    })
  })

  describe('customStop', () => {
    it('uses custom check function', () => {
      const condition = customStop((state) => state.totalTokens > 1000)

      expect(shouldStop(condition, createState({ totalTokens: 500 }))).toBe(false)
      expect(shouldStop(condition, createState({ totalTokens: 1001 }))).toBe(true)
    })

    it('receives full state object', () => {
      let receivedState: StepState | null = null
      const condition = customStop((state) => {
        receivedState = state
        return false
      })

      const state = createState({ stepNumber: 3, totalTokens: 500 })
      shouldStop(condition, state)

      expect(receivedState).toBe(state)
    })
  })

  describe('all() combinator', () => {
    it('requires all conditions to be true', () => {
      const condition = all(hasText(), stepCountIs(2))

      // Only has text, step 1
      expect(shouldStop(condition, createState({
        stepNumber: 1,
        lastStep: { text: 'Hello', finishReason: 'stop' },
      }))).toBe(false)

      // Has text and step 2
      expect(shouldStop(condition, createState({
        stepNumber: 2,
        lastStep: { text: 'Hello', finishReason: 'stop' },
      }))).toBe(true)
    })

    it('returns false if any condition is false', () => {
      const condition = all(hasText(), hasToolCall('done'))

      // Has text but no tool call
      expect(shouldStop(condition, createState({
        lastStep: { text: 'Hello', finishReason: 'stop' },
      }))).toBe(false)
    })
  })

  describe('any() combinator', () => {
    it('stops if any condition is true', () => {
      const condition = any(hasToolCall('done'), stepCountIs(10))

      // Has tool call
      expect(shouldStop(condition, createState({
        stepNumber: 1,
        lastStep: {
          finishReason: 'tool_calls',
          toolCalls: [{ id: '1', name: 'done', arguments: {} }],
        },
      }))).toBe(true)

      // At step limit
      expect(shouldStop(condition, createState({ stepNumber: 10 }))).toBe(true)

      // Neither condition
      expect(shouldStop(condition, createState({ stepNumber: 5 }))).toBe(false)
    })
  })

  describe('not() combinator', () => {
    it('inverts condition', () => {
      const condition = not(hasText())

      // No text - should stop
      expect(shouldStop(condition, createState())).toBe(true)

      // Has text - should not stop
      expect(shouldStop(condition, createState({
        lastStep: { text: 'Hello', finishReason: 'stop' },
      }))).toBe(false)
    })
  })

  describe('array of conditions', () => {
    it('treats array as OR (any match stops)', () => {
      const conditions = [hasToolCall('finish'), stepCountIs(5)]

      // Tool call stops
      expect(shouldStop(conditions, createState({
        lastStep: {
          finishReason: 'tool_calls',
          toolCalls: [{ id: '1', name: 'finish', arguments: {} }],
        },
      }))).toBe(true)

      // Step count stops
      expect(shouldStop(conditions, createState({ stepNumber: 5 }))).toBe(true)

      // Neither
      expect(shouldStop(conditions, createState({ stepNumber: 2 }))).toBe(false)
    })
  })
})
