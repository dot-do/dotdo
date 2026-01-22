/**
 * Tests for full-client.ts
 *
 * Tests for the combineClients function that merges DBClient, ActionsClient, and EventsClient.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  combineClients,
  type DBClient,
  type ActionsClient,
  type EventsClient,
  type Thing,
  type Action,
  type Event,
  type Relationship,
} from '../src/index'

describe('combineClients', () => {
  // Create mock implementations

  function createMockDBClient(): DBClient {
    return {
      get: vi.fn(async () => null),
      getById: vi.fn(async () => null),
      create: vi.fn(async (opts) => ({
        ns: opts.ns,
        type: opts.type,
        id: 'id-1',
        url: `https://${opts.ns}/${opts.type}/id-1`,
        createdAt: new Date(),
        updatedAt: new Date(),
        data: opts.data,
      })),
      update: vi.fn(async () => ({
        ns: 'ns',
        type: 'type',
        id: 'id-1',
        url: 'https://ns/type/id-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        data: {},
      })),
      upsert: vi.fn(async (opts) => ({
        ns: opts.ns,
        type: opts.type,
        id: opts.id,
        url: `https://${opts.ns}/${opts.type}/${opts.id}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        data: opts.data,
      })),
      delete: vi.fn(async () => true),
      list: vi.fn(async () => []),
      find: vi.fn(async () => []),
      search: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      relate: vi.fn(async () => ({
        id: 'rel-1',
        type: 'test',
        from: 'a',
        to: 'b',
        createdAt: new Date(),
      })),
      unrelate: vi.fn(async () => true),
      related: vi.fn(async () => []),
      references: vi.fn(async () => []),
      relationships: vi.fn(async () => []),
      batchGet: vi.fn(async () => new Map()),
      batchCreate: vi.fn(async () => []),
    }
  }

  function createMockActionsClient(): ActionsClient {
    return {
      createAction: vi.fn(async (opts) => ({
        id: 'action-1',
        type: opts.type,
        trigger: opts.trigger ?? { type: 'manual', source: 'test' },
        target: opts.target,
        input: opts.input,
        status: 'pending' as const,
        createdAt: new Date(),
        attempts: 0,
        maxAttempts: opts.maxAttempts ?? 3,
      })),
      getAction: vi.fn(async () => null),
      updateAction: vi.fn(async (id, update) => ({
        id,
        type: 'Test.action',
        trigger: { type: 'manual' as const, source: 'test' },
        target: 'target',
        input: {},
        status: update.status ?? ('running' as const),
        createdAt: new Date(),
        attempts: 1,
        maxAttempts: 3,
      })),
      findActions: vi.fn(async () => []),
      claimActions: vi.fn(async () => []),
    }
  }

  function createMockEventsClient(): EventsClient {
    return {
      emit: vi.fn(async (opts) => ({
        id: 'event-1',
        type: opts.type,
        subject: opts.subject,
        data: opts.data,
        actor: opts.actor ?? 'system',
        source: opts.source ?? 'test',
        timestamp: new Date(),
      })),
      getEvent: vi.fn(async () => null),
      queryEvents: vi.fn(async () => []),
      subscribeEvents: vi.fn(() => {
        async function* generator() {
          // Empty async generator
        }
        return generator()
      }),
    }
  }

  it('should combine all required DBClient methods', async () => {
    const dbClient = createMockDBClient()
    const actionsClient = createMockActionsClient()
    const eventsClient = createMockEventsClient()

    const combined = combineClients(dbClient, actionsClient, eventsClient)

    // Test DBClient methods
    await combined.get('url')
    expect(dbClient.get).toHaveBeenCalledWith('url')

    await combined.getById('ns', 'type', 'id')
    expect(dbClient.getById).toHaveBeenCalledWith('ns', 'type', 'id')

    await combined.create({ ns: 'ns', type: 'Type', data: { key: 'value' } })
    expect(dbClient.create).toHaveBeenCalled()

    await combined.update('url', { key: 'new' })
    expect(dbClient.update).toHaveBeenCalledWith('url', { key: 'new' })

    await combined.upsert({ ns: 'ns', type: 'Type', id: 'id', data: {} })
    expect(dbClient.upsert).toHaveBeenCalled()

    await combined.delete('url')
    expect(dbClient.delete).toHaveBeenCalledWith('url')

    await combined.list()
    expect(dbClient.list).toHaveBeenCalled()

    await combined.find({ type: 'Test' })
    expect(dbClient.find).toHaveBeenCalledWith({ type: 'Test' })

    await combined.search({ query: 'test' })
    expect(dbClient.search).toHaveBeenCalledWith({ query: 'test' })

    await combined.count()
    expect(dbClient.count).toHaveBeenCalled()

    await combined.relate({ type: 'rel', from: 'a', to: 'b' })
    expect(dbClient.relate).toHaveBeenCalled()

    await combined.unrelate('a', 'rel', 'b')
    expect(dbClient.unrelate).toHaveBeenCalledWith('a', 'rel', 'b')

    await combined.related('url')
    expect(dbClient.related).toHaveBeenCalledWith('url')

    await combined.references('url')
    expect(dbClient.references).toHaveBeenCalledWith('url')

    await combined.relationships('url')
    expect(dbClient.relationships).toHaveBeenCalledWith('url')

    await combined.batchGet(['url1', 'url2'])
    expect(dbClient.batchGet).toHaveBeenCalledWith(['url1', 'url2'])

    await combined.batchCreate([])
    expect(dbClient.batchCreate).toHaveBeenCalled()
  })

  it('should combine all required ActionsClient methods', async () => {
    const dbClient = createMockDBClient()
    const actionsClient = createMockActionsClient()
    const eventsClient = createMockEventsClient()

    const combined = combineClients(dbClient, actionsClient, eventsClient)

    // Test ActionsClient methods
    await combined.createAction({
      type: 'Test.action',
      target: 'target',
      input: { data: 'test' },
    })
    expect(actionsClient.createAction).toHaveBeenCalled()

    await combined.getAction('action-id')
    expect(actionsClient.getAction).toHaveBeenCalledWith('action-id')

    await combined.updateAction('action-id', { status: 'completed' })
    expect(actionsClient.updateAction).toHaveBeenCalledWith('action-id', { status: 'completed' })

    await combined.findActions({ status: 'pending' })
    expect(actionsClient.findActions).toHaveBeenCalledWith({ status: 'pending' })

    await combined.claimActions({ limit: 5 })
    expect(actionsClient.claimActions).toHaveBeenCalledWith({ limit: 5 })
  })

  it('should combine all required EventsClient methods', async () => {
    const dbClient = createMockDBClient()
    const actionsClient = createMockActionsClient()
    const eventsClient = createMockEventsClient()

    const combined = combineClients(dbClient, actionsClient, eventsClient)

    // Test EventsClient methods
    await combined.emit({
      type: 'Test.event',
      subject: 'subject',
      data: { key: 'value' },
    })
    expect(eventsClient.emit).toHaveBeenCalled()

    await combined.getEvent('event-id')
    expect(eventsClient.getEvent).toHaveBeenCalledWith('event-id')

    await combined.queryEvents({ type: 'Test.event' })
    expect(eventsClient.queryEvents).toHaveBeenCalledWith({ type: 'Test.event' })

    combined.subscribeEvents({ type: 'Test.*' })
    expect(eventsClient.subscribeEvents).toHaveBeenCalledWith({ type: 'Test.*' })
  })

  it('should include optional DBClient methods when available', async () => {
    const dbClient = createMockDBClient()
    dbClient.batchUpdate = vi.fn(async () => [])
    dbClient.batchDelete = vi.fn(async () => 0)
    dbClient.close = vi.fn(async () => {})

    const actionsClient = createMockActionsClient()
    const eventsClient = createMockEventsClient()

    const combined = combineClients(dbClient, actionsClient, eventsClient)

    expect(combined.batchUpdate).toBeDefined()
    expect(combined.batchDelete).toBeDefined()
    expect(combined.close).toBeDefined()

    await combined.batchUpdate!([{ url: 'url', data: {} }])
    expect(dbClient.batchUpdate).toHaveBeenCalled()

    await combined.batchDelete!(['url'])
    expect(dbClient.batchDelete).toHaveBeenCalled()

    await combined.close!()
    expect(dbClient.close).toHaveBeenCalled()
  })

  it('should include optional ActionsClient methods when available', async () => {
    const dbClient = createMockDBClient()
    const actionsClient = createMockActionsClient()
    actionsClient.cancelAction = vi.fn(async () => true)
    actionsClient.retryAction = vi.fn(async () => ({
      id: 'action-1',
      type: 'Test',
      trigger: { type: 'manual' as const, source: 'test' },
      target: 'target',
      input: {},
      status: 'pending' as const,
      createdAt: new Date(),
      attempts: 0,
      maxAttempts: 3,
    }))
    actionsClient.getActionHistory = vi.fn(async () => [])

    const eventsClient = createMockEventsClient()

    const combined = combineClients(dbClient, actionsClient, eventsClient)

    expect(combined.cancelAction).toBeDefined()
    expect(combined.retryAction).toBeDefined()
    expect(combined.getActionHistory).toBeDefined()

    await combined.cancelAction!('action-id')
    expect(actionsClient.cancelAction).toHaveBeenCalledWith('action-id')

    await combined.retryAction!('action-id')
    expect(actionsClient.retryAction).toHaveBeenCalledWith('action-id')

    await combined.getActionHistory!('action-id')
    expect(actionsClient.getActionHistory).toHaveBeenCalledWith('action-id')
  })

  it('should include optional EventsClient methods when available', async () => {
    const dbClient = createMockDBClient()
    const actionsClient = createMockActionsClient()
    const eventsClient = createMockEventsClient()
    eventsClient.countEvents = vi.fn(async () => 42)

    const combined = combineClients(dbClient, actionsClient, eventsClient)

    expect(combined.countEvents).toBeDefined()

    const count = await combined.countEvents!({ type: 'Test.*' })
    expect(eventsClient.countEvents).toHaveBeenCalledWith({ type: 'Test.*' })
    expect(count).toBe(42)
  })

  it('should not include optional methods when not available', () => {
    const dbClient = createMockDBClient()
    const actionsClient = createMockActionsClient()
    const eventsClient = createMockEventsClient()

    const combined = combineClients(dbClient, actionsClient, eventsClient)

    expect(combined.batchUpdate).toBeUndefined()
    expect(combined.batchDelete).toBeUndefined()
    expect(combined.close).toBeUndefined()
    expect(combined.cancelAction).toBeUndefined()
    expect(combined.retryAction).toBeUndefined()
    expect(combined.getActionHistory).toBeUndefined()
    expect(combined.countEvents).toBeUndefined()
  })

  it('should bind methods to their original clients', async () => {
    const dbClient = createMockDBClient()
    const actionsClient = createMockActionsClient()
    const eventsClient = createMockEventsClient()

    // Add a custom property to track binding
    let dbThisRef: unknown
    dbClient.get = vi.fn(async function(this: unknown) {
      dbThisRef = this
      return null
    })

    const combined = combineClients(dbClient, actionsClient, eventsClient)

    // Even when called on combined, should be bound to dbClient
    await combined.get('url')
    expect(dbThisRef).toBe(dbClient)
  })
})
