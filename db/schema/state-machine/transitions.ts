/**
 * Transition utilities for the State Machine
 *
 * Provides:
 * - TransitionBuilder: Fluent API for building transitions
 * - TransitionChain: Chain multiple transitions together
 * - State serialization/deserialization
 * - Transition config parsing
 */

import type { Entity, GuardFunction, ActionFunction, TransitionContext, StateConfig, StateHistory } from './machine'
import { StateMachine } from './machine'

// ============================================================================
// Type Definitions
// ============================================================================

export interface Transition {
  to: string | null
  guard?: GuardFunction
  guards?: GuardFunction[]
  action?: ActionFunction
  actions?: ActionFunction[]
  meta?: Record<string, unknown>
  isTerminal?: boolean
}

export interface TransitionConfig {
  to: string | null
  if?: GuardFunction | GuardFunction[]
  do?: ActionFunction | ActionFunction[]
  meta?: Record<string, unknown>
}

export type { TransitionContext } from './machine'

export interface TransitionError extends Error {
  code: string
  event: string
  from: string | null
  to: string | null
  entityId: string
}

export interface TransitionMiddleware {
  before?: (entity: Entity, context: TransitionContext) => boolean | void | Promise<boolean | void>
  after?: (entity: Entity, result: { success: boolean; from: string | null; to: string | null; event: string }) => void | Promise<void>
  error?: (entity: Entity, error: Error, context: TransitionContext) => Entity | void | Promise<Entity | void>
}

// ============================================================================
// TransitionBuilder
// ============================================================================

export class TransitionBuilder {
  private _to: string | null = null
  private _guards: GuardFunction[] = []
  private _actions: ActionFunction[] = []
  private _meta: Record<string, unknown> = {}
  private _isTerminal = false

  to(state: string): TransitionBuilder {
    this._to = state
    return this
  }

  terminal(): TransitionBuilder {
    this._to = null
    this._isTerminal = true
    return this
  }

  when(guard: GuardFunction): TransitionBuilder {
    this._guards.push(guard)
    return this
  }

  execute(action: ActionFunction): TransitionBuilder {
    this._actions.push(action)
    return this
  }

  meta(metadata: Record<string, unknown>): TransitionBuilder {
    this._meta = { ...this._meta, ...metadata }
    return this
  }

  build(): Transition {
    const result: Transition = {
      to: this._to,
    }

    if (this._guards.length === 1) {
      result.guard = this._guards[0]
    }
    if (this._guards.length > 0) {
      result.guards = [...this._guards]
    }

    if (this._actions.length === 1) {
      result.action = this._actions[0]
    }
    if (this._actions.length > 0) {
      result.actions = [...this._actions]
    }

    if (Object.keys(this._meta).length > 0) {
      result.meta = { ...this._meta }
    }

    if (this._isTerminal) {
      result.isTerminal = true
    }

    return result
  }
}

// ============================================================================
// TransitionChain
// ============================================================================

interface ChainedTransition {
  event: string
  condition?: boolean
  unless?: boolean
}

interface ChainResult {
  from: string | null
  to: string | null
  event: string
}

export class TransitionChain {
  private machine: StateMachine
  private entity: Entity
  private transitions: ChainedTransition[] = []
  private context: Record<string, unknown> = {}

  constructor(machine: StateMachine, entity: Entity) {
    this.machine = machine
    this.entity = entity
  }

  do(event: string): TransitionChain {
    this.transitions.push({ event })
    return this
  }

  doIf(condition: boolean, event: string): TransitionChain {
    this.transitions.push({ event, condition })
    return this
  }

  doUnless(condition: boolean, event: string): TransitionChain {
    this.transitions.push({ event, unless: condition })
    return this
  }

  withContext(ctx: Record<string, unknown>): TransitionChain {
    this.context = { ...this.context, ...ctx }
    return this
  }

  async execute(): Promise<ChainResult[]> {
    const results: ChainResult[] = []

    for (const transition of this.transitions) {
      // Skip if condition is false
      if (transition.condition !== undefined && !transition.condition) {
        continue
      }

      // Skip if unless condition is true
      if (transition.unless !== undefined && transition.unless) {
        continue
      }

      const from = this.machine.getCurrentState(this.entity)
      await this.machine.transition(this.entity, transition.event, this.context)
      const to = this.machine.getCurrentState(this.entity)

      results.push({
        from,
        to,
        event: transition.event,
      })
    }

    return results
  }
}

// ============================================================================
// Serialization Functions
// ============================================================================

export function serializeState(entity: Entity): string {
  const stateProps: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(entity)) {
    if (key.startsWith('$')) {
      stateProps[key] = value
    }
  }

  return JSON.stringify(stateProps)
}

export function deserializeState(entity: Entity, json: string, machine?: StateMachine): void {
  const parsed = JSON.parse(json)

  // Validate state if machine is provided
  if (machine && parsed.$state) {
    const states = machine.getStates()
    if (!states.includes(parsed.$state) && parsed.$state !== null) {
      throw new Error(`Invalid state: ${parsed.$state}`)
    }
  }

  // Merge state properties into entity
  for (const [key, value] of Object.entries(parsed)) {
    if (key.startsWith('$')) {
      entity[key] = value
    }
  }
}

// ============================================================================
// Config Parsing
// ============================================================================

export interface ParsedTransitionConfig {
  to: string | null
  guard?: GuardFunction
  guards?: GuardFunction[]
  action?: ActionFunction
  actions?: ActionFunction[]
  meta?: Record<string, unknown>
  isTerminal?: boolean
}

export function parseTransitionConfig(
  config: string | null | TransitionConfig
): ParsedTransitionConfig {
  if (config === null) {
    return { to: null, isTerminal: true }
  }

  if (typeof config === 'string') {
    return { to: config }
  }

  const result: ParsedTransitionConfig = {
    to: config.to,
  }

  // Handle guards
  if (config.if) {
    if (Array.isArray(config.if)) {
      result.guards = config.if
      if (config.if.length === 1) {
        result.guard = config.if[0]
      }
    } else {
      result.guard = config.if
      result.guards = [config.if]
    }
  }

  // Handle actions
  if (config.do) {
    if (Array.isArray(config.do)) {
      result.actions = config.do
      if (config.do.length === 1) {
        result.action = config.do[0]
      }
    } else {
      result.action = config.do
      result.actions = [config.do]
    }
  }

  if (config.meta) {
    result.meta = config.meta
  }

  if (config.to === null) {
    result.isTerminal = true
  }

  return result
}
