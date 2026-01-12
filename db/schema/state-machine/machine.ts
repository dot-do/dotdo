/**
 * State Machine Implementation for the Cascade Generation System
 *
 * Provides a declarative state machine with:
 * - $initial: Required starting state
 * - State names as object keys
 * - Transitions as values (string, object with guard/action, or null for terminal)
 * - Entry/exit actions via $entry/$exit hooks
 * - Guard conditions to prevent invalid transitions
 * - State history for auditing
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type GuardFunction<T = Entity> = (entity: T, context: TransitionContext) => boolean | Promise<boolean>
export type ActionFunction<T = Entity> = (entity: T, context: TransitionContext) => void | Promise<void>

export interface Entity {
  id: string
  $state?: string | null
  $terminated?: boolean
  $history?: StateHistory[]
  $enteredState?: string | null  // Track which state we've called $entry for
  [key: string]: unknown
}

export interface StateHistory {
  from: string | null
  to: string | null
  event: string
  timestamp: number
}

export interface TransitionDefinition {
  to: string | null
  if?: GuardFunction | GuardFunction[]
  do?: ActionFunction | ActionFunction[]
  meta?: Record<string, unknown>
}

export interface StateDefinition {
  $entry?: ActionFunction
  $exit?: ActionFunction
  [event: string]: string | null | TransitionDefinition | ActionFunction | undefined
}

export interface StateConfig {
  $initial: string
  $trackHistory?: boolean
  $timeout?: number
  $retryPolicy?: { maxRetries: number }
  [state: string]: string | boolean | number | StateDefinition | { maxRetries: number } | undefined
}

export interface TransitionContext {
  event: string
  from: string | null
  to: string | null
  timestamp: number
  machine: StateMachine
  [key: string]: unknown
}

export interface TransitionResult {
  success: boolean
  from: string | null
  to: string | null
  event: string
  timestamp?: number
}

export interface TransitionMiddleware {
  before?: (entity: Entity, context: TransitionContext) => boolean | void | Promise<boolean | void>
  after?: (entity: Entity, result: TransitionResult & { success: true }) => void | Promise<void>
  error?: (entity: Entity, error: Error, context: TransitionContext) => Entity | void | Promise<Entity | void>
}

// ============================================================================
// TransitionError Class
// ============================================================================

export class TransitionError extends Error {
  code: string
  event: string
  from: string | null
  to: string | null
  entityId: string

  constructor(
    message: string,
    code: string,
    event: string,
    from: string | null,
    to: string | null,
    entityId: string
  ) {
    super(message)
    this.name = 'TransitionError'
    this.code = code
    this.event = event
    this.from = from
    this.to = to
    this.entityId = entityId
  }
}

// ============================================================================
// StateMachine Class
// ============================================================================

export class StateMachine {
  private config: StateConfig
  private states: string[]
  private middlewares: TransitionMiddleware[] = []
  private transitionLocks: Map<string, Promise<Entity>> = new Map()

  constructor(config: StateConfig) {
    this.config = config
    this.validateConfig()
    this.states = this.extractStates()
  }

  private validateConfig(): void {
    if (!this.config.$initial) {
      throw new Error('$initial is required in state machine config')
    }

    const states = this.extractStates()

    if (!states.includes(this.config.$initial)) {
      throw new Error(`Invalid initial state: ${this.config.$initial} does not exist`)
    }

    // Validate all transition targets exist
    for (const state of states) {
      const stateConfig = this.config[state] as StateDefinition
      if (!stateConfig || typeof stateConfig !== 'object') continue

      for (const [event, transition] of Object.entries(stateConfig)) {
        if (event.startsWith('$')) continue // Skip directives

        const targetState = this.getTargetState(transition)
        if (targetState !== null && !states.includes(targetState)) {
          throw new Error(`Invalid target state: ${targetState} in transition ${event} from ${state}`)
        }
      }
    }
  }

  private extractStates(): string[] {
    return Object.keys(this.config).filter((key) => !key.startsWith('$'))
  }

  private getTargetState(transition: string | null | TransitionDefinition | ActionFunction<Entity> | undefined): string | null {
    if (transition === null) return null
    if (typeof transition === 'string') return transition
    if (typeof transition === 'function') return null // ActionFunction doesn't define a target state
    if (typeof transition === 'object' && transition !== null && 'to' in transition) {
      return transition.to
    }
    return null
  }

  private getStateConfig(state: string): StateDefinition | undefined {
    const config = this.config[state]
    if (typeof config === 'object' && config !== null) {
      return config as StateDefinition
    }
    return undefined
  }

  // ============================================================================
  // Public API - State Queries
  // ============================================================================

  getStates(): string[] {
    return [...this.states]
  }

  getTransitions(state: string): string[] {
    const stateConfig = this.getStateConfig(state)
    if (!stateConfig) return []

    return Object.keys(stateConfig).filter((key) => !key.startsWith('$'))
  }

  getCurrentState(entity: Entity): string | null {
    return entity.$state ?? this.config.$initial
  }

  isInState(entity: Entity, state: string): boolean {
    return this.getCurrentState(entity) === state
  }

  isTerminated(entity: Entity): boolean {
    return entity.$terminated === true
  }

  getAvailableTransitions(entity: Entity): string[] {
    const currentState = this.getCurrentState(entity)
    if (!currentState || entity.$terminated) return []

    return this.getTransitions(currentState)
  }

  async canTransition(entity: Entity, event: string): Promise<boolean> {
    const currentState = this.getCurrentState(entity)
    if (!currentState || entity.$terminated) return false

    const stateConfig = this.getStateConfig(currentState)
    if (!stateConfig) return false

    const transition = stateConfig[event]
    if (transition === undefined) return false

    // Check guard if present
    const parsed = this.parseTransition(transition)
    if (parsed.guards && parsed.guards.length > 0) {
      const context = this.createContext(event, currentState, parsed.to, {})
      try {
        for (const guard of parsed.guards) {
          const result = await guard(entity, context)
          if (!result) return false
        }
      } catch {
        return false
      }
    }

    return true
  }

  // ============================================================================
  // History Methods
  // ============================================================================

  getHistory(entity: Entity): StateHistory[] {
    return entity.$history ?? []
  }

  getPreviousState(entity: Entity): string | null {
    const history = this.getHistory(entity)
    if (history.length < 2) return null
    return history[history.length - 2]?.to ?? null
  }

  getStateAt(entity: Entity, index: number): string | null {
    const history = this.getHistory(entity)
    if (index < 0 || index >= history.length) return null
    return history[index]?.to ?? null
  }

  wasInState(entity: Entity, state: string): boolean {
    const history = this.getHistory(entity)
    return history.some((h) => h.to === state)
  }

  private addHistory(entity: Entity, from: string | null, to: string | null, event: string): void {
    if (!this.config.$trackHistory) return

    if (!entity.$history) {
      entity.$history = []
    }

    entity.$history.push({
      from,
      to,
      event,
      timestamp: Date.now(),
    })
  }

  // ============================================================================
  // Middleware
  // ============================================================================

  use(middleware: TransitionMiddleware): void {
    this.middlewares.push(middleware)
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  async initialize(entity: Entity): Promise<Entity> {
    if (entity.$state !== undefined) {
      return entity
    }

    const initialState = this.config.$initial
    entity.$state = initialState

    this.addHistory(entity, null, initialState, '$init')

    // Call $entry on initial state
    const stateConfig = this.getStateConfig(initialState)
    if (stateConfig?.$entry) {
      const context = this.createContext('$init', null, initialState, {})
      await stateConfig.$entry(entity, context)
    }

    // Track that we've entered this state
    entity.$enteredState = initialState

    return entity
  }

  // ============================================================================
  // Transition
  // ============================================================================

  async transition(entity: Entity, event: string, customContext: Record<string, unknown> = {}): Promise<Entity> {
    // Serialize concurrent transitions on the same entity
    const lockKey = entity.id
    const existingLock = this.transitionLocks.get(lockKey)

    if (existingLock) {
      // Wait for existing transition, then try ours
      try {
        await existingLock
      } catch {
        // Ignore errors from other transitions
      }
    }

    const transitionPromise = this.executeTransition(entity, event, customContext)
    this.transitionLocks.set(lockKey, transitionPromise)

    try {
      return await transitionPromise
    } finally {
      this.transitionLocks.delete(lockKey)
    }
  }

  private async executeTransition(
    entity: Entity,
    event: string,
    customContext: Record<string, unknown>
  ): Promise<Entity> {
    // Check if entity is terminated
    if (entity.$terminated) {
      throw new TransitionError('Entity is terminated', 'TERMINATED', event, entity.$state ?? null, null, entity.id)
    }

    const currentState = this.getCurrentState(entity)

    // Validate current state exists
    if (currentState && !this.states.includes(currentState)) {
      throw new TransitionError(
        `Invalid current state: ${currentState}`,
        'INVALID_STATE',
        event,
        currentState,
        null,
        entity.id
      )
    }

    const stateConfig = currentState ? this.getStateConfig(currentState) : undefined
    if (!stateConfig) {
      throw new TransitionError(
        `No transition for event ${event} from state ${currentState}`,
        'INVALID_EVENT',
        event,
        currentState,
        null,
        entity.id
      )
    }

    const transition = stateConfig[event]
    if (transition === undefined) {
      throw new TransitionError(
        `No transition for event ${event} from state ${currentState}`,
        'INVALID_EVENT',
        event,
        currentState,
        null,
        entity.id
      )
    }

    const parsed = this.parseTransition(transition)
    const targetState = parsed.to
    const context = this.createContext(event, currentState, targetState, customContext)

    // Snapshot entity for rollback
    const snapshot = JSON.parse(JSON.stringify(entity))

    try {
      // Run before middleware
      for (const middleware of this.middlewares) {
        if (middleware.before) {
          const result = await middleware.before(entity, context)
          if (result === false) {
            throw new TransitionError('Transition cancelled by middleware', 'CANCELLED', event, currentState, targetState, entity.id)
          }
        }
      }

      // Execute guards
      if (parsed.guards && parsed.guards.length > 0) {
        for (const guard of parsed.guards) {
          const result = await guard(entity, context)
          if (!result) {
            throw new TransitionError(
              'Guard condition failed',
              'GUARD_FAILED',
              event,
              currentState,
              targetState,
              entity.id
            )
          }
        }
      }

      // Execute $exit of current state
      if (stateConfig.$exit) {
        await stateConfig.$exit(entity, context)
      }

      // Execute transition action(s)
      if (parsed.actions && parsed.actions.length > 0) {
        for (const action of parsed.actions) {
          await action(entity, context)
        }
      }

      // Update state
      if (targetState === null) {
        entity.$state = null
        entity.$terminated = true
      } else {
        entity.$state = targetState
      }

      // Execute $entry of target state
      // Only call $entry if we haven't already "entered" this state
      // (allows self-loops to call $entry only on first entry, unless entity was manually set to state)
      const needsEntry = targetState !== null && entity.$enteredState !== targetState
      if (needsEntry) {
        const targetConfig = this.getStateConfig(targetState)
        if (targetConfig?.$entry) {
          await targetConfig.$entry(entity, context)
        }
        entity.$enteredState = targetState
      }

      // Add history
      this.addHistory(entity, currentState, targetState, event)

      // Run after middleware (in reverse order for proper unwinding)
      const result: TransitionResult & { success: true } = {
        success: true,
        from: currentState,
        to: targetState,
        event,
        timestamp: Date.now(),
      }

      for (let i = this.middlewares.length - 1; i >= 0; i--) {
        const middleware = this.middlewares[i]!
        if (middleware!.after) {
          await middleware!.after(entity, result)
        }
      }

      return entity
    } catch (error) {
      // Rollback entity state
      Object.keys(entity).forEach((key) => {
        if (key !== 'id') {
          delete entity[key]
        }
      })
      Object.assign(entity, snapshot)

      // Run error middleware
      for (const middleware of this.middlewares) {
        if (middleware.error) {
          const recovered = await middleware.error(entity, error as Error, context)
          if (recovered) {
            return recovered
          }
        }
      }

      throw error
    }
  }

  private parseTransition(transition: string | null | TransitionDefinition | ActionFunction | undefined): {
    to: string | null
    guards?: GuardFunction[]
    actions?: ActionFunction[]
    meta?: Record<string, unknown>
    isTerminal?: boolean
  } {
    if (transition === null) {
      return { to: null, isTerminal: true }
    }

    if (typeof transition === 'string') {
      return { to: transition }
    }

    if (typeof transition === 'object' && transition !== null && 'to' in transition) {
      const def = transition as TransitionDefinition

      const guards: GuardFunction[] = []
      if (def.if) {
        if (Array.isArray(def.if)) {
          guards.push(...def.if)
        } else {
          guards.push(def.if)
        }
      }

      const actions: ActionFunction[] = []
      if (def.do) {
        if (Array.isArray(def.do)) {
          actions.push(...def.do)
        } else {
          actions.push(def.do)
        }
      }

      return {
        to: def.to,
        guards: guards.length > 0 ? guards : undefined,
        actions: actions.length > 0 ? actions : undefined,
        meta: def.meta,
        isTerminal: def.to === null,
      }
    }

    return { to: null }
  }

  private createContext(
    event: string,
    from: string | null,
    to: string | null,
    customContext: Record<string, unknown>
  ): TransitionContext {
    return {
      event,
      from,
      to,
      timestamp: Date.now(),
      machine: this,
      ...customContext,
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

export function validateTransition(
  config: StateConfig,
  sourceState: string,
  event: string
): { valid: boolean; targetState?: string | null; isTerminal?: boolean; error?: string } {
  const states = Object.keys(config).filter((k) => !k.startsWith('$'))

  if (!states.includes(sourceState)) {
    return { valid: false, error: 'State not found' }
  }

  const stateConfig = config[sourceState]
  if (typeof stateConfig !== 'object' || stateConfig === null) {
    return { valid: false, error: 'State not found' }
  }

  const transition = (stateConfig as StateDefinition)[event]
  if (transition === undefined) {
    return { valid: false, error: 'Event not defined' }
  }

  let targetState: string | null
  if (transition === null) {
    targetState = null
  } else if (typeof transition === 'string') {
    targetState = transition
  } else if (typeof transition === 'object' && 'to' in transition) {
    targetState = transition.to
  } else {
    return { valid: false, error: 'Invalid transition configuration' }
  }

  if (targetState !== null && !states.includes(targetState)) {
    return { valid: false, error: 'Target state invalid' }
  }

  return {
    valid: true,
    targetState,
    isTerminal: targetState === null,
  }
}

export interface ParsedTransition {
  to: string | null
  guard?: GuardFunction
  guards?: GuardFunction[]
  action?: ActionFunction
  actions?: ActionFunction[]
  meta?: Record<string, unknown>
  isTerminal?: boolean
}

export function createTransition(
  config: string | null | { to: string | null; if?: GuardFunction; do?: ActionFunction; meta?: Record<string, unknown> }
): ParsedTransition {
  if (config === null) {
    return { to: null, isTerminal: true }
  }

  if (typeof config === 'string') {
    return { to: config }
  }

  return {
    to: config.to,
    guard: config.if,
    action: config.do,
    meta: config.meta,
    isTerminal: config.to === null,
  }
}
