/**
 * State Machine Module
 *
 * Provides declarative state machine functionality for the Cascade Generation System.
 */

// Main StateMachine class and helpers
export {
  StateMachine,
  validateTransition,
  createTransition,
  TransitionError,
} from './machine'

// Types from machine
export type {
  Entity,
  StateConfig,
  StateDefinition,
  TransitionDefinition,
  TransitionContext,
  TransitionResult,
  StateHistory,
  GuardFunction,
  ActionFunction,
  TransitionMiddleware,
} from './machine'

// Transition utilities
export {
  TransitionBuilder,
  TransitionChain,
  serializeState,
  deserializeState,
  parseTransitionConfig,
} from './transitions'

// Types from transitions
export type {
  Transition,
  TransitionConfig,
  ParsedTransitionConfig,
} from './transitions'
