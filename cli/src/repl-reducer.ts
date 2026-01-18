/**
 * REPL State Reducer
 *
 * Consolidates REPL useState calls into a useReducer pattern.
 * Provides centralized state management with clear action-based transitions.
 */

/**
 * Represents a single output entry in the REPL.
 */
export interface OutputEntry {
  type: 'input' | 'result' | 'error' | 'info' | 'system'
  content: unknown
  timestamp: number
}

/**
 * Completion item for autocomplete functionality.
 */
export interface CompletionItem {
  label: string
  kind: 'function' | 'property' | 'variable' | 'method' | 'keyword'
  detail?: string
  insertText?: string
}

/**
 * Schema type for RPC methods.
 */
export interface Schema {
  name: string
  methods: Array<{ name: string; [key: string]: unknown }>
}

/**
 * Complete REPL state.
 */
export interface ReplState {
  // Input state
  inputValue: string

  // Output state
  outputEntries: OutputEntry[]

  // History state
  history: string[]
  historyIndex: number

  // Completions state
  completions: CompletionItem[]
  showCompletions: boolean

  // Connection state
  connected: boolean
  schema: Schema | null

  // Evaluation state
  isEvaluating: boolean
  error: string | null
  evalContext: Record<string, unknown>

  // Undo/redo stacks
  undoStack: ReplState[]
  redoStack: ReplState[]
}

/**
 * Initial REPL state.
 */
export const initialReplState: ReplState = {
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
}

/**
 * Discriminated union of all REPL actions.
 */
export type ReplAction =
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'SUBMIT' }
  | { type: 'CLEAR' }
  | { type: 'ADD_OUTPUT'; payload: OutputEntry }
  | { type: 'SET_ERROR'; payload: Error }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_SCHEMA'; payload: Schema }
  | { type: 'SET_COMPLETIONS'; payload: CompletionItem[] }
  | { type: 'TOGGLE_COMPLETIONS'; payload?: boolean }
  | { type: 'HISTORY_PREV' }
  | { type: 'HISTORY_NEXT' }
  | {
      type: 'EVALUATION_COMPLETE'
      payload: { success: true; value: unknown } | { success: false; error: string }
    }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESET' }
  | { type: 'SET_EVAL_CONTEXT'; payload: Record<string, unknown> }

/**
 * Helper to create a state snapshot for undo/redo (without stacks to prevent nesting).
 */
function createSnapshot(state: ReplState): ReplState {
  return {
    ...state,
    undoStack: [],
    redoStack: [],
  }
}

/**
 * REPL reducer function implementing all state transitions.
 */
export function replReducer(state: ReplState, action: ReplAction): ReplState {
  switch (action.type) {
    case 'SET_INPUT': {
      return {
        ...state,
        inputValue: action.payload,
        historyIndex: -1,
        redoStack: [], // Clear redo stack on new action
      }
    }

    case 'SUBMIT': {
      // Don't submit if already evaluating
      if (state.isEvaluating) {
        return state
      }

      const trimmedInput = state.inputValue.trim()

      // Don't submit empty input
      if (!trimmedInput) {
        return state
      }

      // Don't duplicate consecutive history entries
      const newHistory =
        state.history[state.history.length - 1] === trimmedInput
          ? state.history
          : [...state.history, trimmedInput]

      // Create input entry for output
      const inputEntry: OutputEntry = {
        type: 'input',
        content: trimmedInput,
        timestamp: Date.now(),
      }

      return {
        ...state,
        inputValue: '',
        history: newHistory,
        historyIndex: -1,
        isEvaluating: true,
        showCompletions: false,
        outputEntries: [...state.outputEntries, inputEntry],
        undoStack: [...state.undoStack, createSnapshot(state)],
        redoStack: [],
      }
    }

    case 'CLEAR': {
      return {
        ...state,
        outputEntries: [],
      }
    }

    case 'ADD_OUTPUT': {
      return {
        ...state,
        outputEntries: [...state.outputEntries, action.payload],
      }
    }

    case 'SET_ERROR': {
      const errorMessage = action.payload.message

      const errorEntry: OutputEntry = {
        type: 'error',
        content: errorMessage,
        timestamp: Date.now(),
      }

      return {
        ...state,
        error: errorMessage,
        isEvaluating: false,
        outputEntries: [...state.outputEntries, errorEntry],
      }
    }

    case 'SET_CONNECTED': {
      const systemEntry: OutputEntry = {
        type: 'system',
        content: action.payload ? 'Connected' : 'Disconnected',
        timestamp: Date.now(),
      }

      return {
        ...state,
        connected: action.payload,
        outputEntries: [...state.outputEntries, systemEntry],
      }
    }

    case 'SET_SCHEMA': {
      return {
        ...state,
        schema: action.payload,
      }
    }

    case 'SET_COMPLETIONS': {
      return {
        ...state,
        completions: action.payload,
      }
    }

    case 'TOGGLE_COMPLETIONS': {
      const newValue = action.payload !== undefined ? action.payload : !state.showCompletions

      return {
        ...state,
        showCompletions: newValue,
      }
    }

    case 'HISTORY_PREV': {
      // No history to navigate
      if (state.history.length === 0) {
        return state
      }

      // Already at the beginning
      if (state.historyIndex === 0) {
        return state
      }

      // Starting navigation from current input
      if (state.historyIndex === -1) {
        const newIndex = state.history.length - 1
        const historyValue = state.history[newIndex]
        return {
          ...state,
          historyIndex: newIndex,
          inputValue: historyValue ?? '',
        }
      }

      // Navigate backwards
      const newIndex = state.historyIndex - 1
      const historyValue = state.history[newIndex]
      return {
        ...state,
        historyIndex: newIndex,
        inputValue: historyValue ?? '',
      }
    }

    case 'HISTORY_NEXT': {
      // Not navigating history
      if (state.historyIndex === -1) {
        return state
      }

      // At the last entry, go back to empty input
      if (state.historyIndex === state.history.length - 1) {
        return {
          ...state,
          historyIndex: -1,
          inputValue: '',
        }
      }

      // Navigate forwards
      const newIndex = state.historyIndex + 1
      const nextHistoryValue = state.history[newIndex]
      return {
        ...state,
        historyIndex: newIndex,
        inputValue: nextHistoryValue ?? '',
      }
    }

    case 'EVALUATION_COMPLETE': {
      if (action.payload.success) {
        const resultEntry: OutputEntry = {
          type: 'result',
          content: action.payload.value,
          timestamp: Date.now(),
        }

        return {
          ...state,
          isEvaluating: false,
          error: null,
          outputEntries: [...state.outputEntries, resultEntry],
        }
      } else {
        const errorEntry: OutputEntry = {
          type: 'error',
          content: action.payload.error,
          timestamp: Date.now(),
        }

        return {
          ...state,
          isEvaluating: false,
          error: action.payload.error,
          outputEntries: [...state.outputEntries, errorEntry],
        }
      }
    }

    case 'UNDO': {
      const previousState = state.undoStack[state.undoStack.length - 1]
      if (!previousState) {
        return state
      }

      const newUndoStack = state.undoStack.slice(0, -1)

      return {
        ...previousState,
        undoStack: newUndoStack,
        redoStack: [...state.redoStack, createSnapshot(state)],
      }
    }

    case 'REDO': {
      const nextState = state.redoStack[state.redoStack.length - 1]
      if (!nextState) {
        return state
      }

      const newRedoStack = state.redoStack.slice(0, -1)

      return {
        ...nextState,
        undoStack: [...state.undoStack, createSnapshot(state)],
        redoStack: newRedoStack,
      }
    }

    case 'RESET': {
      return { ...initialReplState }
    }

    case 'SET_EVAL_CONTEXT': {
      return {
        ...state,
        evalContext: action.payload,
      }
    }

    default: {
      // Handle unknown actions gracefully - return current state
      return state
    }
  }
}
