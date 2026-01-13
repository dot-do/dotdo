/**
 * PauseResumeStore - Workflow pause/resume state management via verb form relationships
 *
 * GREEN PHASE: Implementation to pass all tests in workflows/graph/tests/pause-resume.test.ts
 *
 * The key insight: verb form IS the state - no separate status column needed.
 *
 * State Machine (via verb forms):
 * - Pause lifecycle: 'pause' (action) -> 'pausing' (activity) -> 'paused' (event)
 * - Resume lifecycle: 'resume' (action) -> 'resuming' (activity) -> 'resumed' (event)
 * - WaitForEvent: 'waitFor' (action) -> 'waitingFor' (activity) -> 'waitedFor' (event)
 *
 * @see dotdo-g23h2 - Workflow pause/resume via verb forms
 */

import { VerbFormStateMachine } from '../../db/graph/verb-forms'
import type { SQLiteGraphStore } from '../../db/graph/stores/sqlite'
import type { GraphRelationship } from '../../db/graph/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Semantic workflow pause/resume states
 */
export type PauseResumeState = 'pending' | 'in_progress' | 'completed'

/**
 * Pause reason data stored in the relationship
 */
export interface PauseData {
  /** Reason for the pause */
  reason?: string
  /** Event that triggered the pause */
  triggerEvent?: string
  /** When the pause was initiated */
  initiatedAt?: number
  /** When the pause completed */
  completedAt?: number
  /** Who/what requested the pause */
  requestedBy?: string
}

/**
 * Resume data stored in the relationship
 */
export interface ResumeData {
  /** Reason for the resume */
  reason?: string
  /** Event that triggered the resume */
  triggerEvent?: string
  /** When the resume was initiated */
  initiatedAt?: number
  /** When the resume completed */
  completedAt?: number
  /** Who/what approved the resume */
  approvedBy?: string
}

/**
 * WaitForEvent data stored in the relationship
 */
export interface WaitForEventData {
  /** Event name being waited for */
  eventName: string
  /** Timeout in milliseconds */
  timeout?: number
  /** When the wait was registered */
  registeredAt?: number
  /** When the event was received */
  receivedAt?: number
  /** Event payload when received */
  payload?: unknown
  /** Duration waited */
  duration?: number
}

/**
 * Pause/Resume relationship extending GraphRelationship with typed data
 */
export interface PauseResumeRelationship extends Omit<GraphRelationship, 'data'> {
  verb: 'pause' | 'pausing' | 'paused' | 'resume' | 'resuming' | 'resumed'
  data: PauseData | ResumeData | null
}

/**
 * WaitForEvent relationship extending GraphRelationship with typed data
 */
export interface WaitForEventRelationship extends Omit<GraphRelationship, 'data'> {
  verb: 'waitFor' | 'waitingFor' | 'waitedFor'
  data: WaitForEventData | null
}

/**
 * Input for initiating a pause
 */
export interface PauseInput {
  instanceId: string
  reason?: string
  requestedBy?: string
  triggerEvent?: string
}

/**
 * Input for initiating a resume
 */
export interface ResumeInput {
  instanceId: string
  reason?: string
  approvedBy?: string
  triggerEvent?: string
}

/**
 * Input for registering a waitForEvent
 */
export interface WaitForEventInput {
  instanceId: string
  eventName: string
  timeout?: number
}

// ============================================================================
// STATE MACHINES
// ============================================================================

/**
 * State machine for the 'pause' verb lifecycle
 * pause (pending) -> pausing (in-progress) -> paused (completed)
 */
const pauseMachine = new VerbFormStateMachine({
  action: 'pause',
  activity: 'pausing',
  event: 'paused',
})

/**
 * State machine for the 'resume' verb lifecycle
 * resume (pending) -> resuming (in-progress) -> resumed (completed)
 */
const resumeMachine = new VerbFormStateMachine({
  action: 'resume',
  activity: 'resuming',
  event: 'resumed',
})

/**
 * State machine for the 'waitFor' verb lifecycle
 * waitFor (pending) -> waitingFor (in-progress) -> waitedFor (completed)
 */
const waitForMachine = new VerbFormStateMachine({
  action: 'waitFor',
  activity: 'waitingFor',
  event: 'waitedFor',
})

// ============================================================================
// ID GENERATION
// ============================================================================

let idCounter = 0

/**
 * Generate a unique relationship ID
 */
function generateRelationshipId(prefix: string): string {
  idCounter++
  return `rel:${prefix}:${Date.now().toString(36)}-${idCounter.toString(36)}`
}

// ============================================================================
// PAUSE RESUME STORE CLASS
// ============================================================================

/**
 * PauseResumeStore manages workflow pause/resume state via verb form relationships.
 *
 * Instead of a separate status column, the verb form itself encodes the state:
 * - Action form (pause/resume/waitFor) = pending
 * - Activity form (pausing/resuming/waitingFor) = in_progress
 * - Event form (paused/resumed/waitedFor) = completed
 */
export class PauseResumeStore {
  constructor(private readonly graphStore: SQLiteGraphStore) {}

  // ==========================================================================
  // PAUSE LIFECYCLE
  // ==========================================================================

  /**
   * Initiate a pause on a workflow instance.
   * Creates a 'pause' relationship (action form = pending state).
   */
  async initiatePause(input: PauseInput): Promise<PauseResumeRelationship> {
    const id = generateRelationshipId('pause')
    const now = Date.now()

    const data: PauseData = {
      reason: input.reason,
      requestedBy: input.requestedBy,
      triggerEvent: input.triggerEvent,
      initiatedAt: now,
    }

    const rel = await this.graphStore.createRelationship({
      id,
      verb: 'pause',
      from: input.instanceId,
      to: input.instanceId, // Self-referencing for state action
      data,
    })

    return this.toPauseResumeRelationship(rel, 'pause')
  }

  /**
   * Start the pausing process (transition pending -> in_progress).
   * Transitions from 'pause' to 'pausing' verb form.
   */
  async startPausing(instanceId: string): Promise<PauseResumeRelationship> {
    // Find the existing pause relationship
    const pauseRels = await this.graphStore.queryRelationshipsFrom(instanceId, { verb: 'pause' })

    if (pauseRels.length === 0) {
      throw new Error(`No pending pause found for instance ${instanceId}`)
    }

    const existingRel = pauseRels[0]!
    const data = existingRel.data as PauseData

    // Delete the old relationship
    await this.graphStore.deleteRelationship(existingRel.id)

    // Create the new 'pausing' relationship
    const id = generateRelationshipId('pausing')
    const rel = await this.graphStore.createRelationship({
      id,
      verb: 'pausing',
      from: instanceId,
      to: instanceId,
      data,
    })

    return this.toPauseResumeRelationship(rel, 'pausing')
  }

  /**
   * Complete the pause (transition in_progress -> completed).
   * Transitions from 'pausing' to 'paused' verb form.
   */
  async completePause(instanceId: string, triggerEvent?: string): Promise<PauseResumeRelationship> {
    // Find the existing pausing relationship
    const pausingRels = await this.graphStore.queryRelationshipsFrom(instanceId, { verb: 'pausing' })

    if (pausingRels.length === 0) {
      throw new Error(`No in-progress pause found for instance ${instanceId}`)
    }

    const existingRel = pausingRels[0]!
    const data = existingRel.data as PauseData

    // Delete the old relationship
    await this.graphStore.deleteRelationship(existingRel.id)

    // Create the new 'paused' relationship
    const id = generateRelationshipId('paused')
    const now = Date.now()

    const updatedData: PauseData = {
      ...data,
      triggerEvent: triggerEvent ?? data.triggerEvent,
      completedAt: now,
    }

    const rel = await this.graphStore.createRelationship({
      id,
      verb: 'paused',
      from: instanceId,
      to: triggerEvent ?? instanceId, // Point to trigger event or self
      data: updatedData,
    })

    return this.toPauseResumeRelationship(rel, 'paused')
  }

  // ==========================================================================
  // RESUME LIFECYCLE
  // ==========================================================================

  /**
   * Initiate a resume on a workflow instance.
   * Creates a 'resume' relationship (action form = pending state).
   */
  async initiateResume(input: ResumeInput): Promise<PauseResumeRelationship> {
    const id = generateRelationshipId('resume')
    const now = Date.now()

    const data: ResumeData = {
      reason: input.reason,
      approvedBy: input.approvedBy,
      triggerEvent: input.triggerEvent,
      initiatedAt: now,
    }

    const rel = await this.graphStore.createRelationship({
      id,
      verb: 'resume',
      from: input.instanceId,
      to: input.instanceId,
      data,
    })

    return this.toPauseResumeRelationship(rel, 'resume')
  }

  /**
   * Start the resuming process (transition pending -> in_progress).
   * Transitions from 'resume' to 'resuming' verb form.
   */
  async startResuming(instanceId: string): Promise<PauseResumeRelationship> {
    // Find the existing resume relationship
    const resumeRels = await this.graphStore.queryRelationshipsFrom(instanceId, { verb: 'resume' })

    if (resumeRels.length === 0) {
      throw new Error(`No pending resume found for instance ${instanceId}`)
    }

    const existingRel = resumeRels[0]!
    const data = existingRel.data as ResumeData

    // Delete the old relationship
    await this.graphStore.deleteRelationship(existingRel.id)

    // Create the new 'resuming' relationship
    const id = generateRelationshipId('resuming')
    const rel = await this.graphStore.createRelationship({
      id,
      verb: 'resuming',
      from: instanceId,
      to: instanceId,
      data,
    })

    return this.toPauseResumeRelationship(rel, 'resuming')
  }

  /**
   * Complete the resume (transition in_progress -> completed).
   * Transitions from 'resuming' to 'resumed' verb form.
   */
  async completeResume(instanceId: string, triggerEvent?: string): Promise<PauseResumeRelationship> {
    // Find the existing resuming relationship
    const resumingRels = await this.graphStore.queryRelationshipsFrom(instanceId, { verb: 'resuming' })

    if (resumingRels.length === 0) {
      throw new Error(`No in-progress resume found for instance ${instanceId}`)
    }

    const existingRel = resumingRels[0]!
    const data = existingRel.data as ResumeData

    // Delete the old relationship
    await this.graphStore.deleteRelationship(existingRel.id)

    // Create the new 'resumed' relationship
    const id = generateRelationshipId('resumed')
    const now = Date.now()

    const updatedData: ResumeData = {
      ...data,
      triggerEvent: triggerEvent ?? data.triggerEvent,
      completedAt: now,
    }

    const rel = await this.graphStore.createRelationship({
      id,
      verb: 'resumed',
      from: instanceId,
      to: triggerEvent ?? instanceId,
      data: updatedData,
    })

    return this.toPauseResumeRelationship(rel, 'resumed')
  }

  // ==========================================================================
  // WAIT FOR EVENT LIFECYCLE
  // ==========================================================================

  /**
   * Register a wait for an event.
   * Creates a 'waitFor' relationship (action form = pending state).
   */
  async registerWaitFor(input: WaitForEventInput): Promise<WaitForEventRelationship> {
    const id = generateRelationshipId('waitFor')
    const now = Date.now()

    const data: WaitForEventData = {
      eventName: input.eventName,
      timeout: input.timeout,
      registeredAt: now,
    }

    const rel = await this.graphStore.createRelationship({
      id,
      verb: 'waitFor',
      from: input.instanceId,
      to: `event:${input.eventName}`,
      data,
    })

    return this.toWaitForEventRelationship(rel, 'waitFor')
  }

  /**
   * Start waiting for the event (transition pending -> in_progress).
   * Transitions from 'waitFor' to 'waitingFor' verb form.
   */
  async startWaiting(instanceId: string, eventName: string): Promise<WaitForEventRelationship> {
    // Find the existing waitFor relationship
    const waitForRels = await this.graphStore.queryRelationshipsFrom(instanceId, { verb: 'waitFor' })
    const existingRel = waitForRels.find(
      (r) => (r.data as WaitForEventData)?.eventName === eventName
    )

    if (!existingRel) {
      throw new Error(`No pending waitFor found for instance ${instanceId} and event ${eventName}`)
    }

    const data = existingRel.data as WaitForEventData

    // Delete the old relationship
    await this.graphStore.deleteRelationship(existingRel.id)

    // Create the new 'waitingFor' relationship
    const id = generateRelationshipId('waitingFor')
    const rel = await this.graphStore.createRelationship({
      id,
      verb: 'waitingFor',
      from: instanceId,
      to: instanceId, // Self-reference while waiting
      data,
    })

    return this.toWaitForEventRelationship(rel, 'waitingFor')
  }

  /**
   * Complete the wait for event (transition in_progress -> completed).
   * Transitions from 'waitingFor' to 'waitedFor' verb form.
   */
  async completeWaitFor(
    instanceId: string,
    eventName: string,
    payload: unknown
  ): Promise<WaitForEventRelationship> {
    // Find the existing waitingFor relationship
    const waitingForRels = await this.graphStore.queryRelationshipsFrom(instanceId, {
      verb: 'waitingFor',
    })
    const existingRel = waitingForRels.find(
      (r) => (r.data as WaitForEventData)?.eventName === eventName
    )

    if (!existingRel) {
      throw new Error(
        `No in-progress waitingFor found for instance ${instanceId} and event ${eventName}`
      )
    }

    const data = existingRel.data as WaitForEventData

    // Delete the old relationship
    await this.graphStore.deleteRelationship(existingRel.id)

    // Create the new 'waitedFor' relationship
    const id = generateRelationshipId('waitedFor')
    const now = Date.now()
    const duration = data.registeredAt ? now - data.registeredAt : undefined

    const updatedData: WaitForEventData = {
      ...data,
      receivedAt: now,
      payload,
      duration,
    }

    // Create the event payload as a Thing (for reference)
    const eventThingId = `event:${eventName}:payload:${now}`
    try {
      await this.graphStore.createThing({
        id: eventThingId,
        typeId: 104, // Event type ID
        typeName: 'Event',
        data: { type: eventName, payload },
      })
    } catch {
      // Event Thing might already exist, ignore
    }

    const rel = await this.graphStore.createRelationship({
      id,
      verb: 'waitedFor',
      from: instanceId,
      to: eventThingId,
      data: updatedData,
    })

    return this.toWaitForEventRelationship(rel, 'waitedFor')
  }

  // ==========================================================================
  // STATE QUERIES
  // ==========================================================================

  /**
   * Get the current pause state for an instance.
   * Returns null if no pause relationship exists.
   */
  async getPauseState(instanceId: string): Promise<PauseResumeState | null> {
    // Check for pause (pending)
    const pauseRels = await this.graphStore.queryRelationshipsFrom(instanceId, { verb: 'pause' })
    if (pauseRels.length > 0) return 'pending'

    // Check for pausing (in_progress)
    const pausingRels = await this.graphStore.queryRelationshipsFrom(instanceId, { verb: 'pausing' })
    if (pausingRels.length > 0) return 'in_progress'

    // Check for paused (completed)
    const pausedRels = await this.graphStore.queryRelationshipsFrom(instanceId, { verb: 'paused' })
    if (pausedRels.length > 0) return 'completed'

    return null
  }

  /**
   * Get the current resume state for an instance.
   * Returns null if no resume relationship exists.
   */
  async getResumeState(instanceId: string): Promise<PauseResumeState | null> {
    // Check for resume (pending)
    const resumeRels = await this.graphStore.queryRelationshipsFrom(instanceId, { verb: 'resume' })
    if (resumeRels.length > 0) return 'pending'

    // Check for resuming (in_progress)
    const resumingRels = await this.graphStore.queryRelationshipsFrom(instanceId, {
      verb: 'resuming',
    })
    if (resumingRels.length > 0) return 'in_progress'

    // Check for resumed (completed)
    const resumedRels = await this.graphStore.queryRelationshipsFrom(instanceId, { verb: 'resumed' })
    if (resumedRels.length > 0) return 'completed'

    return null
  }

  /**
   * Get the current wait state for an instance and event.
   * Returns null if no wait relationship exists.
   */
  async getWaitState(instanceId: string, eventName: string): Promise<PauseResumeState | null> {
    // Check for waitFor (pending)
    const waitForRels = await this.graphStore.queryRelationshipsFrom(instanceId, { verb: 'waitFor' })
    const pendingWait = waitForRels.find(
      (r) => (r.data as WaitForEventData)?.eventName === eventName
    )
    if (pendingWait) return 'pending'

    // Check for waitingFor (in_progress)
    const waitingForRels = await this.graphStore.queryRelationshipsFrom(instanceId, {
      verb: 'waitingFor',
    })
    const activeWait = waitingForRels.find(
      (r) => (r.data as WaitForEventData)?.eventName === eventName
    )
    if (activeWait) return 'in_progress'

    // Check for waitedFor (completed)
    const waitedForRels = await this.graphStore.queryRelationshipsFrom(instanceId, {
      verb: 'waitedFor',
    })
    const completedWait = waitedForRels.find(
      (r) => (r.data as WaitForEventData)?.eventName === eventName
    )
    if (completedWait) return 'completed'

    return null
  }

  // ==========================================================================
  // INSTANCE QUERIES
  // ==========================================================================

  /**
   * Query all instances that are currently paused.
   * Returns relationships with 'paused' verb (completed pause state).
   */
  async queryPausedInstances(): Promise<PauseResumeRelationship[]> {
    const pausedRels = await this.graphStore.queryRelationshipsByVerb('paused')
    return pausedRels.map((rel) => this.toPauseResumeRelationship(rel, 'paused'))
  }

  /**
   * Query all instances that are waiting for events.
   * Optionally filter by event name.
   */
  async queryWaitingInstances(eventName?: string): Promise<WaitForEventRelationship[]> {
    const waitingForRels = await this.graphStore.queryRelationshipsByVerb('waitingFor')

    let filtered = waitingForRels
    if (eventName) {
      filtered = waitingForRels.filter(
        (r) => (r.data as WaitForEventData)?.eventName === eventName
      )
    }

    return filtered.map((rel) => this.toWaitForEventRelationship(rel, 'waitingFor'))
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Convert a GraphRelationship to PauseResumeRelationship with typed verb
   */
  private toPauseResumeRelationship(
    rel: GraphRelationship,
    verb: 'pause' | 'pausing' | 'paused' | 'resume' | 'resuming' | 'resumed'
  ): PauseResumeRelationship {
    return {
      id: rel.id,
      verb,
      from: rel.from,
      to: rel.to,
      data: rel.data as PauseData | ResumeData | null,
      createdAt: rel.createdAt,
    }
  }

  /**
   * Convert a GraphRelationship to WaitForEventRelationship with typed verb
   */
  private toWaitForEventRelationship(
    rel: GraphRelationship,
    verb: 'waitFor' | 'waitingFor' | 'waitedFor'
  ): WaitForEventRelationship {
    return {
      id: rel.id,
      verb,
      from: rel.from,
      to: rel.to,
      data: rel.data as WaitForEventData | null,
      createdAt: rel.createdAt,
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Factory function to create PauseResumeStore.
 */
export function createPauseResumeStore(graphStore: SQLiteGraphStore): PauseResumeStore {
  return new PauseResumeStore(graphStore)
}
