/**
 * Conversation State Machine - XState v5 Implementation
 *
 * DO-backed durable state machine for conversation lifecycle management.
 * Supports multi-channel conversations with persistence and timeouts.
 */
import {
  createMachine,
  createActor,
  assign,
  type Snapshot,
  type AnyMachineSnapshot,
  type Actor,
  type AnyStateMachine,
} from 'xstate'
import type {
  ConversationState,
  ConversationContext,
  CoreConversationEvent,
  ConversationMachine as IConversationMachine,
  ConversationMachineFactory,
  ConversationMachineConfig,
  ConversationStorage,
  TransitionHandler,
  StateHandler,
  TimeoutHandler,
  ConversationStateConfig,
  TimeoutConfig,
  StateHistoryEntry,
} from './types.js'

// Storage key prefix for persisted snapshots
const STORAGE_KEY_PREFIX = 'conversation:'

/**
 * Default conversation context
 */
const defaultContext: ConversationContext = {
  id: '',
  channel: 'chat',
  participants: [],
  messages: [],
  priority: 'normal',
  tags: [],
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  escalationHistory: [],
  stateHistory: [],
}

/**
 * Parse duration string to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2]!

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }

  return value * multipliers[unit]!
}

/**
 * Internal conversation machine implementation wrapping XState actor
 */
class ConversationMachineImpl<TContext extends ConversationContext = ConversationContext>
  implements IConversationMachine<TContext>
{
  private actor: Actor<AnyStateMachine>
  private xstateMachine: AnyStateMachine
  private storage?: ConversationStorage
  private machineId: string
  private originalConfig: ConversationMachineConfig<TContext>
  private transitionHandlers: Set<TransitionHandler> = new Set()
  private stateHandlers: Map<ConversationState, Set<StateHandler<TContext>>> = new Map()
  private timeoutHandlers: Set<TimeoutHandler> = new Set()
  private activeTimeout?: ReturnType<typeof setTimeout>
  private _context: TContext

  constructor(
    config: ConversationMachineConfig<TContext>,
    initialContext?: Partial<TContext>,
    storage?: ConversationStorage
  ) {
    this.storage = storage
    this.machineId = config.id
    this.originalConfig = config

    // Merge initial context with defaults and overrides
    this._context = {
      ...defaultContext,
      ...(config.context ?? {}),
      ...(initialContext ?? {}),
      id: initialContext?.id ?? config.id ?? `conv_${Date.now()}`,
      createdAt: initialContext?.createdAt ?? new Date(),
      updatedAt: new Date(),
    } as TContext

    // Convert our config to XState machine config
    this.xstateMachine = this.createXStateMachine(config, this._context)

    // Create and start the actor
    this.actor = createActor(this.xstateMachine)
    this.actor.start()
  }

  /**
   * Convert our ConversationMachineConfig to XState machine config
   */
  private createXStateMachine(
    config: ConversationMachineConfig<TContext>,
    context: TContext
  ): AnyStateMachine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const states: Record<string, any> = {}

    for (const [stateName, stateConfig] of Object.entries(config.states) as [
      ConversationState,
      ConversationStateConfig<TContext>,
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
              transitionConfig.guard = ({
                context,
                event,
              }: {
                context: TContext
                event: CoreConversationEvent
              }) => guardFn(context, event)
            }

            // Add actions if present (for context updates)
            if (transition.actions && transition.actions.length > 0) {
              transitionConfig.actions = transition.actions.map((action) =>
                assign(({ context, event }: { context: TContext; event: CoreConversationEvent }) => {
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
          assign(({ context, event }: { context: TContext; event: CoreConversationEvent }) => {
            const result = action(context, event)
            return result ?? context
          })
        )
      }

      // Handle exit actions
      if (stateConfig.exit && stateConfig.exit.length > 0) {
        xstateConfig.exit = stateConfig.exit.map((action) =>
          assign(({ context, event }: { context: TContext; event: CoreConversationEvent }) => {
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

  get state(): ConversationState {
    return this.actor.getSnapshot().value as ConversationState
  }

  get context(): TContext {
    const snapshot = this.actor.getSnapshot()
    return snapshot.context as TContext
  }

  async send(event: CoreConversationEvent): Promise<ConversationState> {
    const prevState = this.state
    const prevContext = this.context

    this.actor.send(event)

    // Small delay to let XState process
    await Promise.resolve()

    const newState = this.state
    const newContext = this.context

    // Update internal context reference
    this._context = newContext

    // Record state history if we actually transitioned
    if (newState !== prevState) {
      const historyEntry: StateHistoryEntry = {
        from: prevState,
        to: newState,
        event: event.type,
        at: new Date(),
        actor: 'actor' in event ? (event as { actor?: string }).actor : undefined,
      }

      // Note: XState handles context updates via assign actions
      // History is tracked separately for our API

      // Notify handlers
      for (const handler of this.transitionHandlers) {
        handler(prevState, newState, event)
      }

      const handlers = this.stateHandlers.get(newState)
      if (handlers) {
        for (const handler of handlers) {
          handler(newContext)
        }
      }

      // Clear timeout on state change
      this.clearTimeout()
    }

    return newState
  }

  can(event: CoreConversationEvent): boolean {
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

  onTransition(handler: TransitionHandler): () => void {
    this.transitionHandlers.add(handler)
    return () => {
      this.transitionHandlers.delete(handler)
    }
  }

  onState(state: ConversationState, handler: StateHandler<TContext>): () => void {
    if (!this.stateHandlers.has(state)) {
      this.stateHandlers.set(state, new Set())
    }
    this.stateHandlers.get(state)!.add(handler)
    return () => {
      this.stateHandlers.get(state)?.delete(handler)
    }
  }

  onTimeout(handler: TimeoutHandler): () => void {
    this.timeoutHandlers.add(handler)
    return () => {
      this.timeoutHandlers.delete(handler)
    }
  }

  setTimeout(duration: string, action: TimeoutConfig['action']): void {
    this.clearTimeout()

    const durationMs = parseDuration(duration)
    const expiresAt = new Date(Date.now() + durationMs)

    // Store timeout config in context (via XState would need action, we handle separately)
    this._context = {
      ...this._context,
      timeout: {
        duration,
        action,
        expiresAt,
      },
    }

    this.activeTimeout = globalThis.setTimeout(() => {
      // Notify timeout handlers
      for (const handler of this.timeoutHandlers) {
        handler(this.context)
      }

      // Auto-send TIMEOUT event
      this.send({ type: 'TIMEOUT' }).catch(() => {
        // Ignore timeout event errors
      })
    }, durationMs)
  }

  clearTimeout(): void {
    if (this.activeTimeout) {
      globalThis.clearTimeout(this.activeTimeout)
      this.activeTimeout = undefined
    }

    if (this._context.timeout) {
      this._context = {
        ...this._context,
        timeout: undefined,
      }
    }
  }

  async persist(): Promise<void> {
    if (!this.storage) {
      throw new Error('No storage configured for persistence')
    }

    const snapshot = this.actor.getPersistedSnapshot()
    const persistedData = {
      snapshot,
      context: this._context,
      timeout: this._context.timeout,
    }

    await this.storage.put(`${STORAGE_KEY_PREFIX}${this.machineId}`, persistedData)
  }

  async restore(id: string): Promise<void> {
    if (!this.storage) {
      throw new Error('No storage configured for persistence')
    }

    const persistedData = await this.storage.get<{
      snapshot: Snapshot<unknown>
      context: TContext
      timeout?: TimeoutConfig
    }>(`${STORAGE_KEY_PREFIX}${id}`)

    if (!persistedData) {
      // No persisted state, stay in current state
      return
    }

    // Stop current actor and create new one with restored snapshot
    this.actor.stop()
    this.actor = createActor(this.xstateMachine, { snapshot: persistedData.snapshot })
    this.actor.start()

    // Restore context
    this._context = persistedData.context

    // Restore timeout if still valid
    if (persistedData.timeout) {
      const remaining = persistedData.timeout.expiresAt.getTime() - Date.now()
      if (remaining > 0) {
        this.activeTimeout = globalThis.setTimeout(() => {
          for (const handler of this.timeoutHandlers) {
            handler(this.context)
          }
          this.send({ type: 'TIMEOUT' }).catch(() => {})
        }, remaining)
      }
    }
  }

  stop(): void {
    this.clearTimeout()
    this.actor.stop()
  }
}

// =============================================================================
// Default Conversation Machine Configuration
// =============================================================================

/**
 * Standard conversation machine configuration
 * States: open -> waiting -> resolved -> closed
 */
export const defaultConversationConfig: ConversationMachineConfig = {
  id: 'conversation',
  initial: 'open',
  states: {
    open: {
      on: {
        WAIT: 'waiting',
        RESOLVE: {
          target: 'resolved',
          actions: [
            (ctx, event) => ({
              ...ctx,
              resolvedAt: new Date(),
              resolveReason: event.type === 'RESOLVE' ? event.reason : undefined,
              updatedAt: new Date(),
            }),
          ],
        },
        CLOSE: {
          target: 'closed',
          actions: [
            (ctx, event) => ({
              ...ctx,
              closedAt: new Date(),
              closeReason: event.type === 'CLOSE' ? event.reason : undefined,
              updatedAt: new Date(),
            }),
          ],
        },
        MESSAGE_RECEIVED: {
          target: 'open',
          actions: [
            (ctx, event) => {
              if (event.type !== 'MESSAGE_RECEIVED') return ctx
              return {
                ...ctx,
                messages: [
                  ...ctx.messages,
                  {
                    id: `msg_${Date.now()}`,
                    from: event.from,
                    content: event.content,
                    contentType: 'text/plain' as const,
                    createdAt: new Date(),
                  },
                ],
                updatedAt: new Date(),
              }
            },
          ],
        },
        ASSIGN: {
          target: 'open',
          actions: [
            (ctx, event) => {
              if (event.type !== 'ASSIGN') return ctx
              return {
                ...ctx,
                assignedTo: event.to,
                updatedAt: new Date(),
              }
            },
          ],
        },
        ESCALATE: {
          target: 'open',
          actions: [
            (ctx, event) => {
              if (event.type !== 'ESCALATE') return ctx
              return {
                ...ctx,
                escalationHistory: [
                  ...ctx.escalationHistory,
                  {
                    from: ctx.assignedTo ?? 'system',
                    to: event.to,
                    reason: event.reason,
                    at: new Date(),
                  },
                ],
                assignedTo: event.to,
                updatedAt: new Date(),
              }
            },
          ],
        },
      },
    },
    waiting: {
      on: {
        RESPOND: 'open',
        MESSAGE_RECEIVED: {
          target: 'open',
          actions: [
            (ctx, event) => {
              if (event.type !== 'MESSAGE_RECEIVED') return ctx
              return {
                ...ctx,
                messages: [
                  ...ctx.messages,
                  {
                    id: `msg_${Date.now()}`,
                    from: event.from,
                    content: event.content,
                    contentType: 'text/plain' as const,
                    createdAt: new Date(),
                  },
                ],
                updatedAt: new Date(),
              }
            },
          ],
        },
        TIMEOUT: {
          target: 'open',
          actions: [
            (ctx) => ({
              ...ctx,
              updatedAt: new Date(),
            }),
          ],
        },
        RESOLVE: {
          target: 'resolved',
          actions: [
            (ctx, event) => ({
              ...ctx,
              resolvedAt: new Date(),
              resolveReason: event.type === 'RESOLVE' ? event.reason : undefined,
              updatedAt: new Date(),
            }),
          ],
        },
        CLOSE: {
          target: 'closed',
          actions: [
            (ctx, event) => ({
              ...ctx,
              closedAt: new Date(),
              closeReason: event.type === 'CLOSE' ? event.reason : undefined,
              updatedAt: new Date(),
            }),
          ],
        },
      },
    },
    resolved: {
      on: {
        REOPEN: {
          target: 'open',
          actions: [
            (ctx) => ({
              ...ctx,
              resolvedAt: undefined,
              resolveReason: undefined,
              updatedAt: new Date(),
            }),
          ],
        },
        CLOSE: {
          target: 'closed',
          actions: [
            (ctx, event) => ({
              ...ctx,
              closedAt: new Date(),
              closeReason: event.type === 'CLOSE' ? event.reason : undefined,
              updatedAt: new Date(),
            }),
          ],
        },
      },
    },
    closed: {
      type: 'final',
      on: {
        REOPEN: {
          target: 'open',
          actions: [
            (ctx) => ({
              ...ctx,
              closedAt: undefined,
              closeReason: undefined,
              resolvedAt: undefined,
              resolveReason: undefined,
              updatedAt: new Date(),
            }),
          ],
        },
      },
    },
  },
}

// =============================================================================
// Factory and Static Methods
// =============================================================================

/**
 * Conversation state machine factory
 */
export const Conversation = {
  /**
   * Define a custom conversation state machine configuration and return a factory
   */
  define<TContext extends ConversationContext = ConversationContext>(
    config: ConversationMachineConfig<TContext>
  ): ConversationMachineFactory<TContext> {
    return {
      create(
        initialContext?: Partial<TContext>,
        storage?: ConversationStorage
      ): IConversationMachine<TContext> {
        return new ConversationMachineImpl(config, initialContext, storage)
      },
    }
  },

  /**
   * Create a conversation machine with default configuration
   */
  create(
    initialContext?: Partial<ConversationContext>,
    storage?: ConversationStorage
  ): IConversationMachine<ConversationContext> {
    const factory = Conversation.define(defaultConversationConfig)
    return factory.create(initialContext, storage)
  },
}
