/**
 * Promote Lifecycle Module
 *
 * Handles promote and demote operations for Durable Objects:
 * - promote: Elevate a Thing to its own DO
 * - demote: Fold a DO back into a parent as a Thing
 */

import { eq } from 'drizzle-orm'
import * as schema from '../../db'
import type { LifecycleContext, LifecycleModule } from './types'

// Type helper for valid noun names
function isValidNounName(name: string): boolean {
  // Must start with uppercase, contain only alphanumeric
  return /^[A-Z][a-zA-Z0-9]*$/.test(name) && name.length <= 64
}

/**
 * Promote result interface
 */
export interface PromoteResult {
  ns: string
  doId: string
  previousId: string
  parentLinked?: boolean
  actionsMigrated?: number
  eventsMigrated?: number
  relationshipsMigrated?: number
  durationMs?: number
}

/**
 * Demote result interface
 */
export interface DemoteResult {
  thingId: string
  parentNs: string
  deletedNs: string
  stagedToken?: string
}

/**
 * Promote lifecycle module.
 */
export class PromoteModule implements LifecycleModule {
  private ctx!: LifecycleContext

  // Track in-progress promotions for concurrent access detection
  private _promotingThings: Set<string> = new Set()

  initialize(context: LifecycleContext): void {
    this.ctx = context
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMOTE OPERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Promote a Thing to its own Durable Object
   */
  async promote(
    thingId: string,
    options: {
      newId?: string
      preserveHistory?: boolean
      linkParent?: boolean
      type?: string
      colo?: string
      region?: string
      namespace?: string
      correlationId?: string
    } = {}
  ): Promise<PromoteResult> {
    const startTime = Date.now()
    const {
      newId,
      preserveHistory = true,
      linkParent = true,
      type,
      colo,
      namespace: namespaceBinding,
      correlationId: providedCorrelationId,
    } = options

    const correlationId =
      providedCorrelationId || `promote-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    // Validate thingId
    if (thingId === undefined || thingId === null || typeof thingId !== 'string') {
      throw new Error('thingId is required')
    }

    if (thingId === '') {
      throw new Error('Cannot promote root: empty thingId cannot be promoted as it represents the DO root')
    }

    if (/\.\.[\\/]|[\\/]\.\./.test(thingId) || /[\x00-\x1f]/.test(thingId)) {
      throw new Error(`Invalid thingId format: '${thingId}' contains invalid characters`)
    }

    // Check for concurrent promotion
    if (this._promotingThings.has(thingId)) {
      throw new Error(`Thing '${thingId}' is already being promoted (concurrent promotion detected)`)
    }
    this._promotingThings.add(thingId)

    // Validate type if provided
    if (type) {
      if (!isValidNounName(type)) {
        this._promotingThings.delete(thingId)
        throw new Error(`Invalid type: '${type}' is not a valid DO type`)
      }
      if (/^(Invalid|Mock|Fake|Stub|Test)/.test(type)) {
        this._promotingThings.delete(thingId)
        throw new Error(`Invalid type: '${type}' uses a reserved prefix`)
      }
      if (type.length > 64) {
        this._promotingThings.delete(thingId)
        throw new Error(`Invalid type: '${type}' exceeds maximum length of 64 characters`)
      }
    }

    // Check DO binding
    if (!this.ctx.env.DO) {
      this._promotingThings.delete(thingId)
      throw new Error('DO binding unavailable: DO namespace not configured')
    }

    // Find the thing to promote
    let things: Array<{
      id: string
      deleted: boolean | null
      data: unknown
      type: number | null
      branch: string | null
      name: string | null
      visibility: string | null
    }>
    try {
      things = await this.ctx.db.select().from(schema.things)
    } catch (error) {
      this._promotingThings.delete(thingId)
      throw error
    }
    const thing = things.find((t) => t.id === thingId && !t.deleted)

    if (!thing) {
      this._promotingThings.delete(thingId)
      throw new Error(`Thing not found: ${thingId}`)
    }

    const thingData = (thing.data as Record<string, unknown> | null | undefined) ?? null
    if (thingData?._promoted === true || thingData?.$promotedTo) {
      this._promotingThings.delete(thingId)
      throw new Error(`Thing '${thingId}' was already promoted`)
    }

    // Validate custom namespace binding
    if (namespaceBinding) {
      const customNamespace = (this.ctx.env as Record<string, unknown>)[namespaceBinding]
      if (!customNamespace) {
        this._promotingThings.delete(thingId)
        throw new Error(`Namespace binding '${namespaceBinding}' not found or unavailable`)
      }
    }

    // Use blockConcurrencyWhile for atomicity
    return this.ctx.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.emitEvent('promote.started', {
        thingId,
        correlationId,
        thingName: thing.name,
        preserveHistory,
        linkParent,
      })

      try {
        if (!this.ctx.env.DO) {
          throw new Error('DO namespace not configured')
        }

        // Create new DO
        type DONamespace = {
          newUniqueId(options?: { locationHint?: string }): { toString(): string }
          get(id: { toString(): string }): { fetch(req: Request): Promise<Response> }
        }

        let newDoId: { toString(): string }
        if (colo) {
          newDoId = (this.ctx.env.DO as DONamespace).newUniqueId({ locationHint: colo })
        } else {
          newDoId = (this.ctx.env.DO as DONamespace).newUniqueId()
        }

        const doIdString = newId || newDoId.toString()
        const newNs = `https://${doIdString}.do`
        const stub = (this.ctx.env.DO as DONamespace).get(newDoId)

        // Collect history
        let actionsToTransfer: unknown[] = []
        let eventsToTransfer: unknown[] = []

        if (preserveHistory) {
          const allActions = await this.ctx.db.select().from(schema.actions)
          const allEvents = await this.ctx.db.select().from(schema.events)

          actionsToTransfer = allActions.filter(
            (a) => a.target === `Thing/${thingId}` || a.target?.includes(thingId)
          )
          eventsToTransfer = allEvents.filter((e) => e.source?.includes(thingId))
        }

        // Initialize new DO
        await stub.fetch(
          new Request(`${newNs}/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promotedFrom: this.ctx.ns, thingId }),
          })
        )

        // Transfer state
        const transferPayload = {
          things: [{ ...thing, id: 'root' }],
          actions: actionsToTransfer,
          events: eventsToTransfer,
          parentNs: linkParent ? this.ctx.ns : null,
          promotedFrom: { ns: this.ctx.ns, thingId, thingName: thing.name },
        }

        await stub.fetch(
          new Request(`${newNs}/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(transferPayload),
          })
        )

        // Finalize
        await stub.fetch(
          new Request(`${newNs}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promotedFrom: this.ctx.ns, thingId, linkParent }),
          })
        )

        // Update relationships
        const relationships = await this.ctx.db.select().from(schema.relationships)
        const thingRelationships = relationships.filter(
          (r) => r.from?.includes(thingId) || r.to?.includes(thingId)
        )

        if (linkParent) {
          await this.ctx.db.insert(schema.relationships).values({
            id: `rel-promote-${Date.now()}`,
            verb: 'promotedFrom',
            from: newNs,
            to: `${this.ctx.ns}/Thing/${thingId}`,
            data: { promotedAt: new Date().toISOString() },
            createdAt: new Date(),
          })
        }

        // Record in objects table
        await this.ctx.db.insert(schema.objects).values({
          ns: newNs,
          id: doIdString,
          class: type || 'DO',
          region: colo || null,
          primary: true,
          createdAt: new Date(),
        })

        // Remove migrated actions
        if (preserveHistory && actionsToTransfer.length > 0) {
          for (const action of actionsToTransfer as Array<{ id: string }>) {
            await this.ctx.db.delete(schema.actions).where(eq(schema.actions.id, action.id))
          }
        }

        // Remove migrated events
        if (preserveHistory && eventsToTransfer.length > 0) {
          for (const event of eventsToTransfer as Array<{ id: string }>) {
            await this.ctx.db.delete(schema.events).where(eq(schema.events.id, event.id))
          }
        }

        // Delete original thing
        await this.ctx.db.delete(schema.things).where(eq(schema.things.id, thingId))

        this._promotingThings.delete(thingId)

        const durationMs = Date.now() - startTime

        await this.ctx.emitEvent('promote.completed', {
          thingId,
          correlationId,
          newNs,
          doId: doIdString,
          actionsMigrated: actionsToTransfer.length,
          eventsMigrated: eventsToTransfer.length,
          parentLinked: linkParent,
          relationshipsUpdated: thingRelationships.length,
          duration: durationMs,
        })

        await this.ctx.emitEvent('thing.promoted', {
          thingId,
          correlationId,
          newNs,
          doId: doIdString,
        })

        return {
          ns: newNs,
          doId: doIdString,
          previousId: thingId,
          parentLinked: linkParent,
          actionsMigrated: actionsToTransfer.length,
          eventsMigrated: eventsToTransfer.length,
          relationshipsMigrated: thingRelationships.length,
          durationMs,
        }
      } catch (error) {
        this._promotingThings.delete(thingId)

        const errorMessage = (error as Error).message || String(error)
        await this.ctx.emitEvent('promote.failed', { thingId, correlationId, error: errorMessage })
        await this.ctx.emitEvent('promote.rollback', { thingId, correlationId, reason: errorMessage })

        throw error
      }
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEMOTE OPERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Demote this DO back into a parent DO as a Thing
   */
  async demote(
    targetNs: string,
    options?: {
      thingId?: string
      preserveHistory?: boolean
      type?: string
      force?: boolean
      compress?: boolean
      mode?: 'atomic' | 'staged'
      preserveId?: boolean
    }
  ): Promise<DemoteResult> {
    if (targetNs === undefined || targetNs === null || typeof targetNs !== 'string') {
      throw new Error('targetNs is required for demote')
    }

    if (targetNs === '' || targetNs.trim() === '') {
      throw new Error('Invalid namespace: targetNs cannot be empty')
    }

    const parentNs = targetNs
    const {
      thingId: customThingId,
      preserveHistory = true,
      type,
      force = false,
      compress = false,
      mode = 'atomic',
      preserveId = false,
    } = options ?? {}

    try {
      new URL(parentNs)
    } catch {
      throw new Error(`Invalid target URL: ${parentNs}`)
    }

    if (parentNs === this.ctx.ns) {
      throw new Error('Cannot demote to self')
    }

    if (!this.ctx.env.DO) {
      throw new Error('DO binding is unavailable')
    }

    // Validate type
    if (type) {
      if (!/^[A-Z][a-zA-Z0-9]*$/.test(type) || type.length > 25) {
        throw new Error(`Invalid type: "${type}"`)
      }
    }

    // Check circular relationship
    const relationships = await this.ctx.db.select().from(schema.relationships)
    const isChildOf = relationships.some(
      (r) => r.verb === 'parent-child' && r.from === this.ctx.ns && r.to === parentNs
    )
    if (isChildOf) {
      throw new Error(`Cannot demote into child - circular relationship detected with ${parentNs}`)
    }

    // Handle staged mode
    if (mode === 'staged') {
      return this.prepareStagedDemote(parentNs, { customThingId, compress, preserveId })
    }

    // Atomic mode
    return this.ctx.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.emitEvent('demote.started', {
        targetNs: parentNs,
        sourceNs: this.ctx.ns,
        parentNs,
        compress,
        mode,
        preserveId,
      })

      try {
        const things = await this.ctx.db.select().from(schema.things)
        const actions = await this.ctx.db.select().from(schema.actions)
        const events = await this.ctx.db.select().from(schema.events)
        const allRelationships = await this.ctx.db.select().from(schema.relationships)

        const activeThings = things.filter((t) => !t.deleted)

        const newThingId = customThingId
          ? customThingId
          : preserveId
            ? this.ctx.ns.replace(/^https?:\/\//, '').replace(/\.do$/, '')
            : `demoted-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

        let actionsToTransfer = actions
        let eventsToTransfer = events

        if (compress) {
          actionsToTransfer = []
          eventsToTransfer = events.filter(
            (e) => e.verb === 'demote.started' || e.verb === 'demote.completed'
          )
        }

        const transferPayload = {
          things:
            activeThings.length > 0
              ? activeThings.map((t) => ({
                  ...t,
                  id: t.id === 'root' ? newThingId : `${newThingId}/${t.id}`,
                }))
              : [
                  {
                    id: newThingId,
                    type: 0,
                    branch: null,
                    name: `Demoted from ${this.ctx.ns}`,
                    data: { $demotedFrom: this.ctx.ns },
                    deleted: false,
                  },
                ],
          actions: actionsToTransfer.map((a) => ({
            ...a,
            target: a.target?.replace(/^Thing\//, `Thing/${newThingId}/`),
          })),
          events: eventsToTransfer.map((e) => ({
            ...e,
            source: e.source?.replace(this.ctx.ns, parentNs),
          })),
          relationships: allRelationships.map((r) => ({
            ...r,
            from: r.from?.replace(this.ctx.ns, `${parentNs}/Thing/${newThingId}`),
            to: r.to?.replace(this.ctx.ns, `${parentNs}/Thing/${newThingId}`),
          })),
          demotedFrom: { ns: this.ctx.ns, thingsCount: activeThings.length, compress },
        }

        if (!this.ctx.env.DO) {
          throw new Error('DO namespace not configured')
        }

        type DONamespace = {
          idFromName(name: string): { toString(): string }
          get(id: { toString(): string }): { fetch(req: Request): Promise<Response> }
        }

        const parentId = (this.ctx.env.DO as DONamespace).idFromName(parentNs)
        const parentStub = (this.ctx.env.DO as DONamespace).get(parentId)

        try {
          const response = await parentStub.fetch(
            new Request(`${parentNs}/transfer`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(transferPayload),
            })
          )

          if (!response.ok) {
            throw new Error(`Transfer to ${parentNs} failed: ${response.status} ${response.statusText}`)
          }

          const confirmResponse = await parentStub.fetch(
            new Request(`${parentNs}/confirm-transfer`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ thingId: newThingId, sourceNs: this.ctx.ns }),
            })
          )

          if (!confirmResponse.ok) {
            throw new Error(
              `Transfer confirmation to ${parentNs} failed: ${confirmResponse.status} ${confirmResponse.statusText}`
            )
          }

          const finalizeResponse = await parentStub.fetch(
            new Request(`${parentNs}/finalize-demote`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                thingId: newThingId,
                sourceNs: this.ctx.ns,
                thingsCount: activeThings.length,
              }),
            })
          )

          if (!finalizeResponse.ok) {
            throw new Error(
              `Demote finalization to ${parentNs} failed: ${finalizeResponse.status} ${finalizeResponse.statusText}`
            )
          }
        } catch (fetchError) {
          const errorMessage = (fetchError as Error).message || String(fetchError)
          if (errorMessage.includes('not found') || errorMessage.includes('unavailable')) {
            throw new Error(`Parent DO not found: ${parentNs} - ${errorMessage}`)
          }
          if (
            errorMessage.includes('Access denied') ||
            errorMessage.includes('permission') ||
            errorMessage.includes('unauthorized')
          ) {
            throw new Error(`Access denied to parent DO: ${parentNs} - ${errorMessage}`)
          }
          throw new Error(`Transfer to ${parentNs} failed: ${errorMessage}`)
        }

        const deletedNs = this.ctx.ns

        await this.ctx.ctx.storage.sql.exec('DELETE FROM things')
        await this.ctx.ctx.storage.sql.exec('DELETE FROM actions')
        await this.ctx.ctx.storage.sql.exec('DELETE FROM events')
        await this.ctx.ctx.storage.sql.exec('DELETE FROM relationships')

        await this.ctx.emitEvent('demote.completed', {
          thingId: newThingId,
          parentNs,
          deletedNs,
          thingsFolded: activeThings.length,
          actionsMigrated: actionsToTransfer.length,
          eventsMigrated: eventsToTransfer.length,
          compress,
        })

        return { thingId: newThingId, parentNs, deletedNs }
      } catch (error) {
        const errorMessage = (error as Error).message || String(error)
        await this.ctx.emitEvent('demote.failed', { parentNs, error: errorMessage })
        await this.ctx.emitEvent('demote.rollback', { parentNs, reason: errorMessage })
        throw error
      }
    })
  }

  private async prepareStagedDemote(
    parentNs: string,
    options: { customThingId?: string; compress?: boolean; preserveId?: boolean }
  ): Promise<DemoteResult> {
    const { customThingId, compress = false, preserveId = false } = options

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

    const things = await this.ctx.db.select().from(schema.things)
    const activeThings = things.filter((t) => !t.deleted)

    if (activeThings.length === 0) {
      throw new Error('No state to demote: source is empty')
    }

    const newThingId = customThingId
      ? customThingId
      : preserveId
        ? this.ctx.ns.replace(/^https?:\/\//, '').replace(/\.do$/, '')
        : `demoted-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

    const stagingData = {
      token,
      parentNs,
      newThingId,
      things: activeThings,
      compress,
      expiresAt: expiresAt.toISOString(),
      status: 'prepared' as const,
    }

    await this.ctx.ctx.storage.put(`demote-staging:${token}`, stagingData)

    await this.ctx.emitEvent('demote.staging.started', { token, parentNs })
    await this.ctx.emitEvent('demote.prepared', { token, parentNs, expiresAt: expiresAt.toISOString() })

    return { thingId: newThingId, parentNs, deletedNs: this.ctx.ns, stagedToken: token }
  }

  /**
   * Commit a staged demote operation
   */
  async commitDemote(token: string): Promise<{ thingId: string; parentNs: string; deletedNs: string }> {
    const staging = await this.ctx.ctx.storage.get<{
      token: string
      parentNs: string
      newThingId: string
      things: unknown[]
      compress: boolean
      expiresAt: string
      status: 'prepared' | 'committed' | 'aborted'
    }>(`demote-staging:${token}`)

    if (!staging) {
      throw new Error('Invalid or not found: staging token')
    }

    if (staging.status === 'committed') {
      throw new Error('Demote already committed')
    }

    if (staging.status === 'aborted') {
      throw new Error('Demote was aborted')
    }

    if (new Date(staging.expiresAt) < new Date()) {
      throw new Error('Token expired')
    }

    staging.status = 'committed'
    await this.ctx.ctx.storage.put(`demote-staging:${token}`, staging)

    await this.ctx.emitEvent('demote.commit.started', { token, parentNs: staging.parentNs })
    await this.ctx.emitEvent('demote.committed', {
      token,
      parentNs: staging.parentNs,
      thingId: staging.newThingId,
    })

    return { thingId: staging.newThingId, parentNs: staging.parentNs, deletedNs: this.ctx.ns }
  }

  /**
   * Abort a staged demote operation
   */
  async abortDemote(token: string, reason?: string): Promise<void> {
    const staging = await this.ctx.ctx.storage.get<{
      token: string
      parentNs: string
      status: 'prepared' | 'committed' | 'aborted'
    }>(`demote-staging:${token}`)

    if (!staging) {
      throw new Error('Invalid or not found: staging token')
    }

    if (staging.status === 'committed') {
      throw new Error('Cannot abort committed demote')
    }

    staging.status = 'aborted'
    await this.ctx.ctx.storage.put(`demote-staging:${token}`, staging)

    await this.ctx.emitEvent('demote.aborted', { token, parentNs: staging.parentNs, reason })
  }
}

// Export singleton factory
export function createPromoteModule(): PromoteModule {
  return new PromoteModule()
}
