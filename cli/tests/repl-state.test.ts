/**
 * REPL State Reducer Tests - TDD RED Phase
 *
 * Tests for consolidating REPL useState calls into a useReducer pattern.
 * The REPL component has these state values that should be consolidated:
 * - inputValue: string
 * - outputEntries: OutputEntry[]
 * - history: string[]
 * - completions: CompletionItem[]
 * - showCompletions: boolean
 * - connected: boolean
 * - schema: Schema | null
 * - rpcClient: RpcClient | null
 * - evalContext: Record<string, unknown>
 *
 * This reducer provides:
 * - Centralized state management
 * - Clear action-based transitions
 * - State invariants enforcement
 * - Undo/redo capability (history stack)
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import the reducer and types (to be implemented)
import {
  replReducer,
  initialReplState,
  type ReplState,
  type ReplAction,
  type OutputEntry,
} from '../src/repl-reducer.js'

describe('REPL State Reducer', () => {
  let state: ReplState

  beforeEach(() => {
    state = { ...initialReplState }
  })

  describe('initial state', () => {
    it('should have correct initial state', () => {
      expect(initialReplState).toEqual({
        inputValue: '',
        outputEntries: [],
        history: [],
        historyIndex: -1,
        completions: [],
        showCompletions: false,
        connected: false,
        schema: null,
        evalContext: {},
        isEvaluating: false,
        error: null,
        undoStack: [],
        redoStack: [],
      })
    })
  })

  describe('SET_INPUT action', () => {
    it('should set input value', () => {
      const newState = replReducer(state, {
        type: 'SET_INPUT',
        payload: 'hello world',
      })

      expect(newState.inputValue).toBe('hello world')
    })

    it('should preserve other state when setting input', () => {
      state = { ...state, connected: true, history: ['cmd1'] }
      const newState = replReducer(state, {
        type: 'SET_INPUT',
        payload: 'new input',
      })

      expect(newState.inputValue).toBe('new input')
      expect(newState.connected).toBe(true)
      expect(newState.history).toEqual(['cmd1'])
    })

    it('should reset history index when input changes', () => {
      state = { ...state, historyIndex: 2 }
      const newState = replReducer(state, {
        type: 'SET_INPUT',
        payload: 'new input',
      })

      expect(newState.historyIndex).toBe(-1)
    })
  })

  describe('SUBMIT action', () => {
    it('should not submit when evaluating', () => {
      state = { ...state, inputValue: 'test', isEvaluating: true }
      const newState = replReducer(state, { type: 'SUBMIT' })

      // State should be unchanged when already evaluating
      expect(newState).toEqual(state)
    })

    it('should not submit empty input', () => {
      state = { ...state, inputValue: '   ' }
      const newState = replReducer(state, { type: 'SUBMIT' })

      expect(newState.isEvaluating).toBe(false)
      expect(newState.history).toEqual([])
    })

    it('should add input to history and set evaluating flag', () => {
      state = { ...state, inputValue: 'my command' }
      const newState = replReducer(state, { type: 'SUBMIT' })

      expect(newState.history).toContain('my command')
      expect(newState.isEvaluating).toBe(true)
      expect(newState.inputValue).toBe('')
      expect(newState.showCompletions).toBe(false)
    })

    it('should add input entry to output', () => {
      state = { ...state, inputValue: 'my command' }
      const newState = replReducer(state, { type: 'SUBMIT' })

      expect(newState.outputEntries.length).toBe(1)
      expect(newState.outputEntries[0].type).toBe('input')
      expect(newState.outputEntries[0].content).toBe('my command')
    })

    it('should not duplicate consecutive history entries', () => {
      state = { ...state, inputValue: 'cmd1', history: ['cmd1'] }
      const newState = replReducer(state, { type: 'SUBMIT' })

      // Should not add duplicate
      expect(newState.history).toEqual(['cmd1'])
    })
  })

  describe('EVALUATION_COMPLETE action', () => {
    it('should clear evaluating flag on success', () => {
      state = { ...state, isEvaluating: true }
      const newState = replReducer(state, {
        type: 'EVALUATION_COMPLETE',
        payload: { success: true, value: 42 },
      })

      expect(newState.isEvaluating).toBe(false)
      expect(newState.error).toBeNull()
    })

    it('should add result to output on success', () => {
      state = { ...state, isEvaluating: true }
      const newState = replReducer(state, {
        type: 'EVALUATION_COMPLETE',
        payload: { success: true, value: { data: 'test' } },
      })

      const lastEntry = newState.outputEntries[newState.outputEntries.length - 1]
      expect(lastEntry.type).toBe('result')
      expect(lastEntry.content).toEqual({ data: 'test' })
    })

    it('should handle error result', () => {
      state = { ...state, isEvaluating: true }
      const newState = replReducer(state, {
        type: 'EVALUATION_COMPLETE',
        payload: { success: false, error: 'Something went wrong' },
      })

      expect(newState.isEvaluating).toBe(false)
      expect(newState.error).toBe('Something went wrong')
      const lastEntry = newState.outputEntries[newState.outputEntries.length - 1]
      expect(lastEntry.type).toBe('error')
    })
  })

  describe('CLEAR action', () => {
    it('should clear output entries', () => {
      state = {
        ...state,
        outputEntries: [
          { type: 'input', content: 'cmd', timestamp: Date.now() },
          { type: 'result', content: 42, timestamp: Date.now() },
        ],
      }
      const newState = replReducer(state, { type: 'CLEAR' })

      expect(newState.outputEntries).toEqual([])
    })

    it('should preserve history when clearing', () => {
      state = {
        ...state,
        outputEntries: [{ type: 'input', content: 'cmd', timestamp: Date.now() }],
        history: ['cmd1', 'cmd2'],
      }
      const newState = replReducer(state, { type: 'CLEAR' })

      expect(newState.outputEntries).toEqual([])
      expect(newState.history).toEqual(['cmd1', 'cmd2'])
    })
  })

  describe('ADD_OUTPUT action', () => {
    it('should add output entry', () => {
      const entry: OutputEntry = {
        type: 'info',
        content: 'Information message',
        timestamp: Date.now(),
      }
      const newState = replReducer(state, {
        type: 'ADD_OUTPUT',
        payload: entry,
      })

      expect(newState.outputEntries).toContainEqual(entry)
    })

    it('should append to existing entries', () => {
      state = {
        ...state,
        outputEntries: [{ type: 'input', content: 'cmd', timestamp: 1000 }],
      }
      const newEntry: OutputEntry = {
        type: 'result',
        content: 'output',
        timestamp: 2000,
      }
      const newState = replReducer(state, {
        type: 'ADD_OUTPUT',
        payload: newEntry,
      })

      expect(newState.outputEntries.length).toBe(2)
    })
  })

  describe('SET_ERROR action', () => {
    it('should set error', () => {
      const newState = replReducer(state, {
        type: 'SET_ERROR',
        payload: new Error('Test error'),
      })

      expect(newState.error).toBe('Test error')
    })

    it('should add error to output', () => {
      const newState = replReducer(state, {
        type: 'SET_ERROR',
        payload: new Error('Test error'),
      })

      const lastEntry = newState.outputEntries[newState.outputEntries.length - 1]
      expect(lastEntry.type).toBe('error')
      expect(lastEntry.content).toBe('Test error')
    })

    it('should clear evaluating flag on error', () => {
      state = { ...state, isEvaluating: true }
      const newState = replReducer(state, {
        type: 'SET_ERROR',
        payload: new Error('Test error'),
      })

      expect(newState.isEvaluating).toBe(false)
    })
  })

  describe('SET_CONNECTED action', () => {
    it('should set connected status', () => {
      const newState = replReducer(state, {
        type: 'SET_CONNECTED',
        payload: true,
      })

      expect(newState.connected).toBe(true)
    })

    it('should add system message when connected', () => {
      const newState = replReducer(state, {
        type: 'SET_CONNECTED',
        payload: true,
      })

      const lastEntry = newState.outputEntries[newState.outputEntries.length - 1]
      expect(lastEntry.type).toBe('system')
    })
  })

  describe('SET_SCHEMA action', () => {
    it('should set schema', () => {
      const schema = { name: 'test-schema', methods: [] }
      const newState = replReducer(state, {
        type: 'SET_SCHEMA',
        payload: schema,
      })

      expect(newState.schema).toEqual(schema)
    })
  })

  describe('SET_COMPLETIONS action', () => {
    it('should set completions', () => {
      const completions = [
        { label: 'method1', kind: 'function' as const },
        { label: 'method2', kind: 'function' as const },
      ]
      const newState = replReducer(state, {
        type: 'SET_COMPLETIONS',
        payload: completions,
      })

      expect(newState.completions).toEqual(completions)
    })
  })

  describe('TOGGLE_COMPLETIONS action', () => {
    it('should toggle completions visibility', () => {
      state = { ...state, showCompletions: false }
      let newState = replReducer(state, { type: 'TOGGLE_COMPLETIONS' })
      expect(newState.showCompletions).toBe(true)

      newState = replReducer(newState, { type: 'TOGGLE_COMPLETIONS' })
      expect(newState.showCompletions).toBe(false)
    })

    it('should accept explicit value', () => {
      const newState = replReducer(state, {
        type: 'TOGGLE_COMPLETIONS',
        payload: true,
      })
      expect(newState.showCompletions).toBe(true)
    })
  })

  describe('HISTORY_PREV action', () => {
    it('should navigate to previous history entry', () => {
      state = {
        ...state,
        history: ['cmd1', 'cmd2', 'cmd3'],
        historyIndex: -1,
        inputValue: '',
      }
      const newState = replReducer(state, { type: 'HISTORY_PREV' })

      expect(newState.historyIndex).toBe(2)
      expect(newState.inputValue).toBe('cmd3')
    })

    it('should continue navigating backwards', () => {
      state = {
        ...state,
        history: ['cmd1', 'cmd2', 'cmd3'],
        historyIndex: 2,
        inputValue: 'cmd3',
      }
      const newState = replReducer(state, { type: 'HISTORY_PREV' })

      expect(newState.historyIndex).toBe(1)
      expect(newState.inputValue).toBe('cmd2')
    })

    it('should not go beyond first entry', () => {
      state = {
        ...state,
        history: ['cmd1', 'cmd2'],
        historyIndex: 0,
        inputValue: 'cmd1',
      }
      const newState = replReducer(state, { type: 'HISTORY_PREV' })

      expect(newState.historyIndex).toBe(0)
      expect(newState.inputValue).toBe('cmd1')
    })

    it('should do nothing with empty history', () => {
      state = { ...state, history: [], historyIndex: -1 }
      const newState = replReducer(state, { type: 'HISTORY_PREV' })

      expect(newState.historyIndex).toBe(-1)
    })
  })

  describe('HISTORY_NEXT action', () => {
    it('should navigate to next history entry', () => {
      state = {
        ...state,
        history: ['cmd1', 'cmd2', 'cmd3'],
        historyIndex: 0,
        inputValue: 'cmd1',
      }
      const newState = replReducer(state, { type: 'HISTORY_NEXT' })

      expect(newState.historyIndex).toBe(1)
      expect(newState.inputValue).toBe('cmd2')
    })

    it('should clear input when going past last entry', () => {
      state = {
        ...state,
        history: ['cmd1', 'cmd2'],
        historyIndex: 1,
        inputValue: 'cmd2',
      }
      const newState = replReducer(state, { type: 'HISTORY_NEXT' })

      expect(newState.historyIndex).toBe(-1)
      expect(newState.inputValue).toBe('')
    })

    it('should do nothing when already at end', () => {
      state = {
        ...state,
        history: ['cmd1'],
        historyIndex: -1,
        inputValue: '',
      }
      const newState = replReducer(state, { type: 'HISTORY_NEXT' })

      expect(newState.historyIndex).toBe(-1)
    })
  })

  describe('state invariants', () => {
    it('should not allow submission while evaluating', () => {
      state = {
        ...state,
        inputValue: 'test command',
        isEvaluating: true,
      }

      const newState = replReducer(state, { type: 'SUBMIT' })

      // Should not change state
      expect(newState.isEvaluating).toBe(true)
      expect(newState.history).toEqual([])
    })

    it('should enforce historyIndex bounds', () => {
      state = {
        ...state,
        history: ['cmd1', 'cmd2'],
        historyIndex: 1,
      }

      // Try to go beyond end
      let newState = replReducer(state, { type: 'HISTORY_NEXT' })
      newState = replReducer(newState, { type: 'HISTORY_NEXT' })

      expect(newState.historyIndex).toBe(-1) // Should stop at -1

      // Try to go before start
      state = { ...state, historyIndex: 0 }
      newState = replReducer(state, { type: 'HISTORY_PREV' })

      expect(newState.historyIndex).toBe(0) // Should stay at 0
    })
  })

  describe('undo/redo functionality', () => {
    it('should push state to undo stack on significant changes', () => {
      state = { ...state, inputValue: 'original' }
      const newState = replReducer(state, { type: 'SUBMIT' })

      // After submit, should have previous state in undo stack
      // (undo would restore to before submit, though this may not be desired behavior)
      // For now we just check undo stack management exists
      expect(Array.isArray(newState.undoStack)).toBe(true)
    })

    it('should support UNDO action', () => {
      // Setup: make some changes
      let currentState = { ...initialReplState }
      currentState = replReducer(currentState, { type: 'SET_INPUT', payload: 'first' })
      currentState = replReducer(currentState, { type: 'SET_INPUT', payload: 'second' })

      // Add state to undo stack (implementation detail)
      const stateWithUndo = {
        ...currentState,
        undoStack: [{ ...initialReplState }],
      }

      const undoneState = replReducer(stateWithUndo, { type: 'UNDO' })

      expect(undoneState.redoStack.length).toBeGreaterThan(0)
    })

    it('should support REDO action', () => {
      const stateWithRedo = {
        ...initialReplState,
        inputValue: '',
        redoStack: [{ ...initialReplState, inputValue: 'redone' }],
      }

      const redoneState = replReducer(stateWithRedo, { type: 'REDO' })

      expect(redoneState.inputValue).toBe('redone')
      expect(redoneState.undoStack.length).toBeGreaterThan(0)
    })

    it('should clear redo stack on new actions', () => {
      const stateWithRedo = {
        ...initialReplState,
        redoStack: [{ ...initialReplState, inputValue: 'old redo' }],
      }

      const newState = replReducer(stateWithRedo, {
        type: 'SET_INPUT',
        payload: 'new input',
      })

      expect(newState.redoStack).toEqual([])
    })
  })

  describe('RESET action', () => {
    it('should reset to initial state', () => {
      state = {
        ...state,
        inputValue: 'some input',
        history: ['cmd1', 'cmd2'],
        outputEntries: [{ type: 'input', content: 'test', timestamp: Date.now() }],
        connected: true,
        isEvaluating: true,
      }

      const newState = replReducer(state, { type: 'RESET' })

      expect(newState).toEqual(initialReplState)
    })
  })

  describe('SET_EVAL_CONTEXT action', () => {
    it('should set eval context', () => {
      const context = { __output: () => {}, customVar: 42 }
      const newState = replReducer(state, {
        type: 'SET_EVAL_CONTEXT',
        payload: context,
      })

      expect(newState.evalContext).toEqual(context)
    })
  })

  describe('action type safety', () => {
    it('should handle unknown action gracefully', () => {
      // This tests that the reducer doesn't crash on unknown actions
      const unknownAction = { type: 'UNKNOWN_ACTION' } as ReplAction
      const newState = replReducer(state, unknownAction)

      // Should return current state unchanged
      expect(newState).toEqual(state)
    })
  })
})

describe('REPL Reducer - Integration Scenarios', () => {
  it('should handle typical REPL session flow', () => {
    let state = { ...initialReplState }

    // Connect
    state = replReducer(state, { type: 'SET_CONNECTED', payload: true })
    expect(state.connected).toBe(true)

    // Set schema
    state = replReducer(state, {
      type: 'SET_SCHEMA',
      payload: { name: 'test', methods: [{ name: 'greet' }] },
    })
    expect(state.schema?.name).toBe('test')

    // Type input
    state = replReducer(state, { type: 'SET_INPUT', payload: 'greet()' })
    expect(state.inputValue).toBe('greet()')

    // Submit
    state = replReducer(state, { type: 'SUBMIT' })
    expect(state.isEvaluating).toBe(true)
    expect(state.history).toContain('greet()')
    expect(state.inputValue).toBe('')

    // Complete evaluation
    state = replReducer(state, {
      type: 'EVALUATION_COMPLETE',
      payload: { success: true, value: 'Hello!' },
    })
    expect(state.isEvaluating).toBe(false)
    expect(state.outputEntries.some(e => e.type === 'result')).toBe(true)

    // Navigate history
    state = replReducer(state, { type: 'HISTORY_PREV' })
    expect(state.inputValue).toBe('greet()')

    // Clear
    state = replReducer(state, { type: 'CLEAR' })
    expect(state.outputEntries).toEqual([])
    expect(state.history).toContain('greet()') // History preserved
  })

  it('should handle error recovery flow', () => {
    let state = { ...initialReplState, connected: true }

    // Submit bad command
    state = replReducer(state, { type: 'SET_INPUT', payload: 'badCmd()' })
    state = replReducer(state, { type: 'SUBMIT' })
    expect(state.isEvaluating).toBe(true)

    // Error occurs
    state = replReducer(state, {
      type: 'SET_ERROR',
      payload: new Error('Command not found'),
    })
    expect(state.isEvaluating).toBe(false)
    expect(state.error).toBe('Command not found')

    // User can still type new command
    state = replReducer(state, { type: 'SET_INPUT', payload: 'goodCmd()' })
    expect(state.inputValue).toBe('goodCmd()')

    // Can submit again
    state = replReducer(state, { type: 'SUBMIT' })
    expect(state.isEvaluating).toBe(true)
  })
})
