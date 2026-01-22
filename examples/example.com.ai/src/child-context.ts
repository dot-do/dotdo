/**
 * Child DO Context for Parent Communication
 *
 * Provides the $context interface that child DOs use to:
 * - Emit events to the parent DO
 * - Access parent's shared context
 * - Send heartbeats
 *
 * @module examples/example.com.ai/src/child-context
 */

import type { ParentContext, ParentDOEvent } from './types'

/**
 * Event to emit to parent
 */
export interface ChildEmitEvent {
  type: string
  payload: unknown
}

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Child Context Manager
 *
 * Manages the child DO's connection to its parent.
 */
export class ChildContextManager {
  private childId: string
  private parentStub: DurableObjectStub | null
  private parentContext: ParentContext | null = null

  constructor(childId: string, parentStub?: DurableObjectStub) {
    this.childId = childId
    this.parentStub = parentStub ?? null
  }

  /**
   * Set the parent stub for communication
   */
  setParentStub(stub: DurableObjectStub): void {
    this.parentStub = stub
  }

  /**
   * Emit an event to the parent DO
   */
  async emit(event: ChildEmitEvent): Promise<void> {
    const parentEvent: ParentDOEvent = {
      $id: generateEventId(),
      type: event.type,
      payload: event.payload,
      source: 'child',
      childId: this.childId,
      $timestamp: Date.now(),
    }

    if (this.parentStub) {
      // Send event to parent via RPC
      await this.parentStub.fetch('https://parent/events/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parentEvent),
      })
    }

    // For testing without actual parent stub, we just return
  }

  /**
   * Get parent's shared context
   */
  async getParent(): Promise<ParentContext> {
    if (this.parentContext) {
      return this.parentContext
    }

    if (this.parentStub) {
      const response = await this.parentStub.fetch('https://parent/context')
      this.parentContext = await response.json() as ParentContext
      return this.parentContext
    }

    // Return default context if no parent stub
    return {
      config: {},
      secrets: {},
      metadata: {},
    }
  }

  /**
   * Send heartbeat to parent
   */
  async heartbeat(): Promise<void> {
    if (this.parentStub) {
      await this.parentStub.fetch(`https://parent/children/${this.childId}/heartbeat`, {
        method: 'POST',
      })
    }
  }
}

/**
 * Child context interface expected by tests
 */
export interface ChildContext {
  emit: (event: ChildEmitEvent) => Promise<void>
  getParent: () => Promise<ParentContext>
  heartbeat: () => Promise<void>
}

/**
 * Create the child's $context interface
 */
export function createChildContext(manager: ChildContextManager): ChildContext {
  return {
    emit: (event: ChildEmitEvent) => manager.emit(event),
    getParent: () => manager.getParent(),
    heartbeat: () => manager.heartbeat(),
  }
}
