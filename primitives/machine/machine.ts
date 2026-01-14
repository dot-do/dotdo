/**
 * Machine - Durable State Machines (XState v5)
 *
 * DO-backed durable state machines for payment flows, call sessions,
 * and stateful workflows. Thin wrapper around XState v5 with DO persistence.
 */
import { createMachine, createActor, assign, type Snapshot, type AnyMachineSnapshot, type Actor, type AnyStateMachine } from 'xstate'
import type {
  MachineConfig,
  MachineFactory,
  Machine as IMachine,
  MachineStorage,
  TransitionHandler,
  StateHandler,
  StateConfig,
} from './types.js'

// Storage key prefix for persisted snapshots
const STORAGE_KEY_PREFIX = 'machine:'

/**
 * Internal machine implementation wrapping XState actor
 */
class MachineImpl<TState extends string, TEvent extends { type: string }, TContext>
  implements IMachine<TState, TEvent, TContext>
{
  private actor: Actor<AnyStateMachine>
  private xstateMachine: AnyStateMachine
  private storage?: MachineStorage
  private machineId: string
  private originalConfig: MachineConfig<TState, TEvent, TContext>
  private transitionHandlers: Set<TransitionHandler<TState, TEvent>> = new Set()
  private stateHandlers: Map<TState, Set<StateHandler<TContext>>> = new Map()
  private previousState: TState

  constructor(
    config: MachineConfig<TState, TEvent, TContext>,
    initialContext?: Partial<TContext>,
    storage?: MachineStorage
  ) {
    this.storage = storage
    this.machineId = config.id
    this.originalConfig = config

    // Merge initial context with overrides
    const mergedContext = {
      ...(config.context ?? {}),
      ...(initialContext ?? {}),
    } as TContext

    // Convert our config to XState machine config
    this.xstateMachine = this.createXStateMachine(config, mergedContext)

    // Create and start the actor
    this.actor = createActor(this.xstateMachine)
    this.previousState = config.initial
    this.actor.start()
  }

  /**
   * Convert our MachineConfig to XState machine config
   */
  private createXStateMachine(config: MachineConfig<TState, TEvent, TContext>, context: TContext): AnyStateMachine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const states: Record<string, any> = {}

    for (const [stateName, stateConfig] of Object.entries(config.states) as [
      TState,
      StateConfig<TState, TEvent, TContext>,
    ][]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const xstateConfig: Record<string, any> = {}

      // Handle transitions
      if (stateConfig.on) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const on: Record<string, any> = {}
        for (const [eventType, transition] of Object.entries(stateConfig.on)) {
          if (typeof transition === 'string') {
            on[eventType] = { target: transition }
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const transitionConfig: Record<string, any> = {
              target: transition.target,
            }

            // Add guard if present
            if (transition.guard) {
              const guardFn = transition.guard
              transitionConfig.guard = ({ context, event }: { context: TContext; event: TEvent }) => guardFn(context, event)
            }

            // Add actions if present (for context updates)
            if (transition.actions && transition.actions.length > 0) {
              transitionConfig.actions = transition.actions.map((action) =>
                assign(({ context, event }: { context: TContext; event: TEvent }) => {
                  const result = action(context, event)
                  return result ?? context
                })
              )
            }

            on[eventType] = transitionConfig
          }
        }
        xstateConfig.on = on
      }

      // Handle entry actions
      if (stateConfig.entry && stateConfig.entry.length > 0) {
        xstateConfig.entry = stateConfig.entry.map((action) =>
          assign(({ context, event }: { context: TContext; event: TEvent }) => {
            const result = action(context, event)
            return result ?? context
          })
        )
      }

      // Handle exit actions
      if (stateConfig.exit && stateConfig.exit.length > 0) {
        xstateConfig.exit = stateConfig.exit.map((action) =>
          assign(({ context, event }: { context: TContext; event: TEvent }) => {
            const result = action(context, event)
            return result ?? context
          })
        )
      }

      // Handle final state
      if (stateConfig.type === 'final') {
        xstateConfig.type = 'final'
      }

      states[stateName] = xstateConfig
    }

    return createMachine({
      id: config.id,
      initial: config.initial,
      context,
      states,
    })
  }

  get state(): TState {
    return this.actor.getSnapshot().value as TState
  }

  get context(): TContext {
    return this.actor.getSnapshot().context as TContext
  }

  async send(event: TEvent): Promise<TState> {
    const prevState = this.state
    this.actor.send(event)

    // Small delay to let XState process
    await Promise.resolve()

    const newState = this.state

    // Notify handlers if we actually transitioned
    if (newState !== prevState) {
      for (const handler of this.transitionHandlers) {
        handler(prevState, newState, event)
      }

      const handlers = this.stateHandlers.get(newState)
      if (handlers) {
        for (const handler of handlers) {
          handler(this.context)
        }
      }
    }

    return newState
  }

  can(event: TEvent): boolean {
    const currentState = this.state
    const stateConfig = this.originalConfig.states[currentState]

    if (!stateConfig?.on) {
      return false
    }

    const transition = stateConfig.on[event.type]
    if (!transition) {
      return false
    }

    // Check guard if present
    if (typeof transition === 'object' && 'guard' in transition && transition.guard) {
      return transition.guard(this.context, event)
    }

    return true
  }

  onTransition(handler: TransitionHandler<TState, TEvent>): () => void {
    this.transitionHandlers.add(handler)
    return () => {
      this.transitionHandlers.delete(handler)
    }
  }

  onState(state: TState, handler: StateHandler<TContext>): () => void {
    if (!this.stateHandlers.has(state)) {
      this.stateHandlers.set(state, new Set())
    }
    this.stateHandlers.get(state)!.add(handler)
    return () => {
      this.stateHandlers.get(state)?.delete(handler)
    }
  }

  async persist(): Promise<void> {
    if (!this.storage) {
      throw new Error('No storage configured for persistence')
    }

    const snapshot = this.actor.getPersistedSnapshot()
    await this.storage.put(`${STORAGE_KEY_PREFIX}${this.machineId}`, snapshot)
  }

  async restore(id: string): Promise<void> {
    if (!this.storage) {
      throw new Error('No storage configured for persistence')
    }

    const snapshot = await this.storage.get<Snapshot<unknown>>(`${STORAGE_KEY_PREFIX}${id}`)
    if (!snapshot) {
      // No persisted state, stay in current state
      return
    }

    // Stop current actor and create new one with restored snapshot
    this.actor.stop()
    this.actor = createActor(this.xstateMachine, { snapshot })
    this.previousState = (snapshot as AnyMachineSnapshot).value as TState
    this.actor.start()
  }

  stop(): void {
    this.actor.stop()
  }
}

/**
 * Machine factory and static methods
 */
export const Machine = {
  /**
   * Define a state machine configuration and return a factory
   */
  define<TState extends string, TEvent extends { type: string }, TContext>(
    config: MachineConfig<TState, TEvent, TContext>
  ): MachineFactory<TState, TEvent, TContext> {
    return {
      create(initialContext?: Partial<TContext>, storage?: MachineStorage): IMachine<TState, TEvent, TContext> {
        return new MachineImpl(config, initialContext, storage)
      },
    }
  },
}
